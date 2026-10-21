import { Inflate } from 'fflate';
import { saveAsset } from './library.mjs';
import { worldMatrices } from './rig.mjs';
import { tileRectangles } from './scene-terrain.mjs';
import { importedProjectInfo } from './workbenches.mjs';

const MB = 1024 * 1024;
const LIMITS = { archive: 100 * MB, expanded: 256 * MB, image: 30 * MB, json: 4 * MB, entries: 1024, pixels: 128 * MB };
const fail = message => { throw new Error(message); };
const check = (condition, message = '项目数据损坏或不完整') => { if (!condition) fail(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Blob);
const finite = (value, limit = 1e6) => Number.isFinite(value) && Math.abs(value) <= limit;
const integer = (value, low, high) => Number.isInteger(value) && value >= low && value <= high;
const text = new TextDecoder('utf-8', { fatal: true });
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function safePath(name) {
  check(!name.includes('\\') && !name.includes(':') && !name.includes('\0') && !name.startsWith('/') &&
    name.split('/').every(part => part && part !== '.' && part !== '..'), 'ZIP 含不安全的压缩路径');
}

// Inspect both ZIP directories before inflating. Never extract paths to disk.
function entriesOf(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557)) {
    if (view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === bytes.length) break;
    end--;
  }
  check(end >= Math.max(0, bytes.length - 65557), 'ZIP 已损坏或不是 ZIP 文件');
  const count = view.getUint16(end + 10, true), directorySize = view.getUint32(end + 12, true), start = view.getUint32(end + 16, true);
  check(view.getUint16(end + 4, true) === 0 && view.getUint16(end + 6, true) === 0 && view.getUint16(end + 8, true) === count &&
    integer(count, 1, LIMITS.entries) && start + directorySize === end, '不支持分卷、ZIP64 或损坏的 ZIP');
  const entries = [], names = new Set(); let offset = start, total = 0, localEnd = 0;
  for (let i = 0; i < count; i++) {
    check(offset + 46 <= end && view.getUint32(offset, true) === 0x02014b50, 'ZIP 目录损坏');
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true), compressed = view.getUint32(offset + 20, true), size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true), extra = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true), next = offset + 46 + nameLength + extra + comment;
    check(next <= end && nameLength > 0, 'ZIP 文件名损坏');
    const name = text.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)); safePath(name);
    check(!names.has(name), 'ZIP 含重复文件名'); names.add(name);
    check(name === 'project.json' || /^data\/[0-9]+\.png$/.test(name), '请选择素材库导出的项目备份 ZIP（含 project.json）');
    check((flags & ~0x0808) === 0 && [0, 8].includes(method) && view.getUint16(offset + 34, true) === 0 &&
      ((view.getUint32(offset + 38, true) >>> 16) & 0xf000) !== 0xa000, '不支持加密、链接或此 ZIP 压缩格式');
    check(size > 0 && size <= (name === 'project.json' ? LIMITS.json : LIMITS.image), 'ZIP 中的文件过大或为空');
    total += size; check(total <= LIMITS.expanded, 'ZIP 解压总大小超过 256 MB');
    check(local >= localEnd && local + 30 <= start && view.getUint32(local, true) === 0x04034b50, 'ZIP 本地目录损坏或重叠');
    const localNameLength = view.getUint16(local + 26, true), data = local + 30 + localNameLength + view.getUint16(local + 28, true);
    check(data <= start && data + compressed <= start && text.decode(bytes.subarray(local + 30, local + 30 + localNameLength)) === name &&
      view.getUint16(local + 6, true) === flags && view.getUint16(local + 8, true) === method, 'ZIP 目录与文件不一致');
    localEnd = data + compressed;
    if (flags & 8) {
      const descriptor = localEnd + (localEnd + 4 <= start && view.getUint32(localEnd, true) === 0x08074b50 ? 4 : 0);
      check(descriptor + 12 <= start && view.getUint32(descriptor, true) === crc && view.getUint32(descriptor + 4, true) === compressed &&
        view.getUint32(descriptor + 8, true) === size, 'ZIP 数据描述损坏'); localEnd = descriptor + 12;
    } else check(view.getUint32(local + 14, true) === crc && view.getUint32(local + 18, true) === compressed && view.getUint32(local + 22, true) === size, 'ZIP 文件校验信息不一致');
    check(method !== 0 || compressed === size, 'ZIP 文件大小不一致');
    entries.push({ name, data, compressed, size, method, crc }); offset = next;
  }
  check(offset === end && names.has('project.json'), '请选择素材库导出的项目备份 ZIP（含 project.json）');
  return entries;
}

async function unpack(bytes, entries) {
  const files = new Map();
  for (const entry of entries) {
    let result;
    if (entry.method === 0) result = bytes.slice(entry.data, entry.data + entry.size);
    else {
      const chunks = []; let length = 0;
      const inflater = new Inflate((chunk) => { length += chunk.length; check(length <= entry.size, 'ZIP 解压大小与目录不一致'); chunks.push(chunk); });
      // Bounded input chunks also bound allocations if a forged size hides a ZIP bomb.
      for (let i = 0; i < entry.compressed; i += 16384) inflater.push(bytes.subarray(entry.data + i, entry.data + Math.min(i + 16384, entry.compressed)), i + 16384 >= entry.compressed);
      check(length === entry.size, 'ZIP 文件被截断'); result = new Uint8Array(length); let cursor = 0;
      for (const chunk of chunks) { result.set(chunk, cursor); cursor += chunk.length; }
    }
    check(result.length === entry.size && crc32(result) === entry.crc, `ZIP 文件校验失败：${entry.name}`);
    files.set(entry.name, result);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return files;
}

function pngSize(bytes) {
  check(bytes.length >= 45 && [137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v), '项目图片不是有效 PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let cursor = 8, first = true, data = false, ended = false, width, height;
  while (cursor + 12 <= bytes.length) {
    const size = view.getUint32(cursor), end = cursor + 12 + size;
    check(end <= bytes.length && crc32(bytes.subarray(cursor + 4, end - 4)) === view.getUint32(end - 4), 'PNG 图片已损坏');
    const type = String.fromCharCode(...bytes.subarray(cursor + 4, cursor + 8));
    if (first) { check(type === 'IHDR' && size === 13, 'PNG 图片头损坏'); width = view.getUint32(cursor + 8); height = view.getUint32(cursor + 12); first = false; }
    if (type === 'IDAT') data = true;
    if (type === 'IEND') { check(size === 0 && end === bytes.length && data, 'PNG 图片不完整'); ended = true; break; }
    cursor = end;
  }
  check(ended && integer(width, 1, 8192) && integer(height, 1, 8192) && width * height <= 32 * MB, 'PNG 图片不完整或尺寸过大');
  return { width, height };
}

function validateProject(record, dimensions) {
  const image = blob => { check(blob instanceof Blob && dimensions.has(blob), '项目缺少图片'); return dimensions.get(blob); };
  const size = (value, max = 4096) => check(object(value) && integer(value.width, 1, max) && integer(value.height, 1, max), '项目画布尺寸无效');
  const frames = list => {
    check(Array.isArray(list) && integer(list.length, 1, 96), '项目帧数无效');
    for (const frame of list) { check(object(frame)); const actual = image(frame.blob);
      check(frame.width === actual.width && frame.height === actual.height && (frame.time == null || finite(frame.time)) &&
        (frame.duration == null || (finite(frame.duration) && frame.duration > 0)), '项目帧尺寸或时长无效'); }
  };
  check(object(record) && typeof record.name === 'string' && record.name.trim().length > 0 && record.name.length <= 80 &&
    finite(record.fps, 1000) && record.fps > 0 && ['sheet','rig','scene','terrain'].includes(record.kind), '项目名称、类型或播放速度无效');
  frames(record.original); check(Array.isArray(record.cutout) && (record.cutout.length === 0 || record.cutout.length === record.original.length), '透明版帧数不完整');
  if (record.cutout.length) frames(record.cutout);
  const p = record.editorProject;
  check(object(p), 'ZIP 缺少可编辑项目，请使用素材库项目备份');
  if (p.version !== undefined) check(p.version === 1, '暂不支持此工作台项目版本');
  if (record.kind === 'sheet') {
    size(p.size); check(Array.isArray(p.frames) && p.frames.length === record.original.length, '动画编辑帧不完整');
    for (const frame of p.frames) { image(frame.blob); check(finite(frame.dx) && finite(frame.dy) && (frame.duration == null || (finite(frame.duration) && frame.duration > 0)), '动画位移或时长无效'); }
    check(object(p.lines) && ['left','right','top','bottom','center'].every(key => finite(p.lines[key])), '参考线数据无效');
    const reference = value => ['none','previous','next'].includes(value) || integer(Number(value), 0, p.frames.length - 1);
    if (p.reference !== undefined) check(reference(p.reference), '参考帧无效');
    if (p.patchReference !== undefined) check(reference(p.patchReference), '修图参考帧无效');
    if (p.playbackMode !== undefined) check(['forward','reverse','pingpong'].includes(p.playbackMode), '播放模式无效');
    if (p.sourceSheet) { const actual = image(p.sourceSheet.blob); check(p.sourceSheet.width === actual.width && p.sourceSheet.height === actual.height, '原始拼图尺寸无效'); }
    if (p.cropSettings) {
      const c = p.cropSettings; check(object(c) && Array.isArray(c.rects) && c.rects.length <= 36, '裁剪框数据无效');
      for (const r of [...c.rects, ...(c.draftRect ? [c.draftRect] : [])]) check(object(r) && ['x','y','width','height'].every(key => finite(r[key])) && r.width > 0 && r.height > 0, '裁剪矩形无效');
      check(integer(c.selectedBox, 0, Math.max(0, c.rects.length - 1)) && (c.draftIndex === null || integer(c.draftIndex, 0, c.rects.length - 1)) &&
        integer(c.columns, 1, 36) && integer(c.rows, 1, 36) && finite(c.padding) && c.padding >= 0 && typeof c.uniform === 'boolean' && typeof c.autoBackground === 'boolean', '裁剪设置无效');
    }
    if (p.editorSettings) {
      const s = p.editorSettings; size(s.draftSize);
      check(integer(s.active, 0, p.frames.length - 1) && finite(s.zoom, 100) && s.zoom > 0 && finite(s.brush, 4096) && s.brush > 0 &&
        finite(s.tolerance, 1000) && ['bottom','center'].includes(s.anchorMode) && ['move','brush','erase','guides','select','anchor'].includes(s.tool) &&
        ['pixel','sharpen','ai'].includes(s.enhanceMode) && [1,2,4].includes(s.enhanceScale) && ['translation','rife'].includes(s.interpolateMode) &&
        integer(s.interpolateFrom, 0, p.frames.length - 1) && integer(s.interpolateCount, 1, 24) &&
        /^#[0-9a-f]{6}$/i.test(s.paint) && /^#[0-9a-f]{6}$/i.test(s.keyColor) && typeof s.guides === 'boolean' && typeof s.sourceCollapsed === 'boolean', '动画编辑设置无效');
    }
  } else if (record.kind === 'rig') {
    size(p.size); check(Array.isArray(p.parts) && integer(p.parts.length, 1, 512) && Array.isArray(p.poses) && p.poses.length <= 512 &&
      integer(p.count, 1, 96) && finite(p.fps, 1000) && p.fps > 0 && finite(p.hue), '角色项目数据无效');
    const ids = new Set();
    for (const part of p.parts) { const actual = image(part.blob);
      check(actual.width <= 4096 && actual.height <= 4096 && actual.width * actual.height <= 16e6, '角色部件图片过大');
      check(typeof part.id === 'string' && part.id.length > 0 && !ids.has(part.id) && ['x','y','rotation','pivotX','pivotY'].every(key => finite(part[key])) &&
        (part.parent === null || typeof part.parent === 'string') && typeof part.visible === 'boolean', '部件或关节数据无效'); ids.add(part.id); }
    worldMatrices(p.parts);
    for (const pose of p.poses) { check(object(pose)); for (const [id, transform] of Object.entries(pose)) check(ids.has(id) && object(transform) && ['x','y','rotation'].every(key => finite(transform[key])), '姿势数据无效'); }
    if (p.source) image(p.source);
  } else if (record.kind === 'scene') {
    frames(p.spriteFrames); check(p.spriteFrames.length === record.original.length && object(p.settings), '场景帧不完整');
    const s = p.settings; check(['x','y','scale','fps'].every(key => finite(s[key])) && s.scale > 0 && s.scale <= 100 && s.fps > 0 &&
      object(s.anchor) && finite(s.anchor.x) && finite(s.anchor.y) && Array.isArray(s.annotations) && s.annotations.length <= p.spriteFrames.length, '场景位置、锚点或标注无效');
    for (const [index, annotation] of Object.entries(s.annotations)) {
      if (annotation === null) continue; // JSON serialises unannotated sparse frames as null.
      check(/^\d+$/.test(index) && Number(index) < p.spriteFrames.length && object(annotation) && Array.isArray(annotation.boxes) && annotation.boxes.length <= 1000 && Array.isArray(annotation.events) && annotation.events.length <= 1000, '逐帧标注无效');
      for (const box of annotation.boxes) check(object(box) && ['collision','hurt','attack'].includes(box.type) && ['x','y','width','height'].every(key => finite(box[key])) && box.width > 0 && box.height > 0, '碰撞框无效');
      for (const event of annotation.events) check(object(event) && typeof event.type === 'string' && typeof event.value === 'string', '动作事件无效');
    }
    if (p.background) image(p.background);
    if (s.active !== undefined) check(integer(s.active, 0, p.spriteFrames.length - 1), '当前场景帧无效');
  } else {
    const source = image(p.source), s = p.settings;
    check(object(s) && integer(s.columns, 1, 40) && integer(s.rows, 1, 40) && integer(s.tileWidth, 1, 512) && integer(s.tileHeight, 1, 512) &&
      s.columns * s.tileWidth <= 4096 && s.rows * s.tileHeight <= 4096, '地图或图块尺寸无效');
    const tiles = tileRectangles(source.width, source.height, s.tileWidth, s.tileHeight);
    check(Array.isArray(s.map) && s.map.length === s.columns * s.rows && s.map.every(index => integer(index, -1, tiles.length - 1)) && integer(s.selected, 0, tiles.length - 1), '地图索引无效');
  }
}

// Pure validation/decode phase: no editor state, library writes, network calls or object URLs.
export async function importProjectArchive(archive, { decodeImage = blob => createImageBitmap(blob) } = {}) {
  check(archive instanceof Blob && archive.size >= 22 && archive.size <= LIMITS.archive, '请选择不超过 100 MB 的项目 ZIP');
  const bytes = new Uint8Array(await archive.arrayBuffer());
  let files;
  try { files = await unpack(bytes, entriesOf(bytes)); } catch (error) { fail(`无法导入：${error.message}`); }
  let manifest;
  try { manifest = JSON.parse(text.decode(files.get('project.json'))); } catch { fail('project.json 已损坏'); }
  check(object(manifest) && manifest.format === 'frame-studio-project' && manifest.version === 1, '暂不支持此项目格式或版本');
  const dimensions = new Map(), blobs = new Map(), used = new Set(['project.json']); let nodes = 0, pixels = 0;
  async function decode(value, depth = 0) {
    check(depth <= 40 && ++nodes <= 200000, '项目数据过于复杂');
    if (Array.isArray(value)) { const out = []; for (const child of value) out.push(await decode(child, depth + 1)); return out; }
    if (!object(value)) return value;
    for (const key of Object.keys(value)) check(!['__proto__','prototype','constructor'].includes(key), '项目含不安全的对象字段');
    if ('file' in value) {
      check(Object.keys(value).every(key => ['file','type','bytes'].includes(key)) && typeof value.file === 'string', '图片文件引用无效'); safePath(value.file);
      const data = files.get(value.file);
      check(/^data\/[0-9]+\.png$/.test(value.file) && data && data.length === value.bytes && value.type === 'image/png', '项目缺少图片或文件引用不一致'); used.add(value.file);
      if (!blobs.has(value.file)) {
        const expected = pngSize(data); pixels += expected.width * expected.height; check(pixels <= LIMITS.pixels, '项目图片总像素过多');
        const blob = new Blob([data], { type: value.type }); let bitmap;
        try { bitmap = await decodeImage(blob); check(bitmap.width === expected.width && bitmap.height === expected.height, 'PNG 解码尺寸不一致'); }
        catch (error) { fail(`项目图片无法解码：${error.message}`); } finally { bitmap?.close?.(); }
        blobs.set(value.file, blob); dimensions.set(blob, expected);
      }
      return blobs.get(value.file);
    }
    const output = {};
    for (const [key, child] of Object.entries(value)) { check(key !== 'url', '项目不应包含临时或外部图片地址'); output[key] = await decode(child, depth + 1); }
    return output;
  }
  const record = await decode(manifest.record); record.cutout ??= [];
  validateProject(record, dimensions);
  check(used.size === files.size, 'ZIP 含未引用的额外文件');
  return record;
}

// Save a new copy only after all validation succeeds. saveAsset's transaction is atomic
// and generates a new ID; an archive's old ID never overwrites an existing asset.
export async function importProjectToLibrary(archive, options) {
  const record = await importProjectArchive(archive, options);
  const saved = await saveAsset(record);
  return { ...saved, projectInfo: importedProjectInfo(record) };
}
