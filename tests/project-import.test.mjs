import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, unzipSync, strToU8, strFromU8, zlibSync, unzlibSync } from 'fflate';
import { exportProjectArchive } from '../src/lib/project-export.mjs';
import { importProjectArchive, importProjectToLibrary } from '../src/lib/project-import.mjs';
import { saveAsset, getAsset, listAssets, deleteAsset } from '../src/lib/library.mjs';
import { destinationFor } from '../src/lib/workbenches.mjs';
import { rememberPngSource, imagePng } from '../src/lib/image-source.mjs';

const crc = bytes => { let c = 0xffffffff; for (const byte of bytes) { c ^= byte; for (let i = 0; i < 8; i++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return (c ^ 0xffffffff) >>> 0; };
function chunk(type, bytes) {
  const out = new Uint8Array(bytes.length + 12), view = new DataView(out.buffer);
  view.setUint32(0, bytes.length); out.set(strToU8(type), 4); out.set(bytes, 8); view.setUint32(out.length - 4, crc(out.subarray(4, out.length - 4))); return out;
}
const pixels = new Uint8Array([255,12,32,0, 10,90,200,128, 70,80,90,255, 45,0,80,64]);
function png() {
  const header = new Uint8Array(13), view = new DataView(header.buffer); view.setUint32(0, 2); view.setUint32(4, 2); header[8] = 8; header[9] = 6;
  const rows = new Uint8Array(18); rows.set(pixels.subarray(0, 8), 1); rows.set(pixels.subarray(8), 10);
  const pieces = [new Uint8Array([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', zlibSync(rows)), chunk('IEND', new Uint8Array())];
  const result = new Uint8Array(pieces.reduce((sum, part) => sum + part.length, 0)); let index = 0;
  for (const part of pieces) { result.set(part, index); index += part.length; } return result;
}
// Decode actual RGBA pixels for this PNG fixture rather than returning fake dimensions.
async function decodeImage(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer); let index = 8, rows;
  while (index < bytes.length) { const length = view.getUint32(index); if (strFromU8(bytes.subarray(index + 4, index + 8)) === 'IDAT') rows = unzlibSync(bytes.subarray(index + 8, index + 8 + length)); index += length + 12; }
  assert.deepEqual(rows, new Uint8Array([0,...pixels.subarray(0,8),0,...pixels.subarray(8)]));
  return { width: view.getUint32(16), height: view.getUint32(20), close() {} };
}
const options = { decodeImage };
function fixture(kind) {
  const blob = new Blob([png()], { type: 'image/png' });
  const original = [{ blob, width: 2, height: 2, time: 0, duration: 125 }, { blob, width: 2, height: 2, time: .125, duration: 275 }];
  const base = { id: 'existing-id', createdAt: 10, name: `备份 · ${kind}`, kind, fps: 8, original, cutout: original, showCutout: true };
  if (kind === 'sheet') base.editorProject = {
    version: 1, frames: original.map((f, i) => ({ blob, dx: i - 2, dy: i + 3, duration: f.duration })), size: { width: 16, height: 16 },
    lines: { left: 1, right: 15, top: 2, bottom: 14, center: 8 }, reference: 'none', onion: true, playbackMode: 'pingpong',
    selection: { x: 3, y: 4, width: 5, height: 6 }, patchReference: 'next', patchOffset: { x: -2, y: 3 }, alignRadius: 12,
    sourceSheet: { blob, width: 2, height: 2 }, cropSettings: { rects: [{ x: -1, y: 0, width: 3, height: 2 }], selectedBox: 0, uniform: false, draftRect: { x: 0, y: 0, width: 1, height: 1 }, draftIndex: null, columns: 3, rows: 4, padding: 10, autoBackground: true },
    editorSettings: { draftSize: { width: 20, height: 18 }, active: 1, zoom: 3, sourceCollapsed: false, anchorMode: 'bottom', tool: 'guides', guides: true, brush: 8, paint: '#ffffff', keyColor: '#00ff00', tolerance: 60, enhanceMode: 'pixel', enhanceScale: 2, interpolateFrom: 0, interpolateCount: 3, interpolateMode: 'translation' },
  };
  if (kind === 'rig') base.editorProject = { size: { width: 32, height: 24 }, fps: 8, count: 12, hue: 30, selected: 'head', source: blob,
    parts: [{ id: 'body', name: '身体', blob, parent: null, x: 12, y: 15, pivotX: 1, pivotY: 2, rotation: -5, visible: true }, { id: 'head', name: '头部', blob, parent: 'body', x: 0, y: -3, pivotX: .5, pivotY: 1, rotation: 32, visible: false }],
    poses: [{ body: { x: 12, y: 15, rotation: -5 }, head: { x: 0, y: -3, rotation: 32 } }] };
  if (kind === 'scene') base.editorProject = { version: 1, spriteFrames: original, background: blob, settings: { x: 100, y: 200, scale: 2.5, fps: 8, active: 1, playing: false,
    anchor: { x: 1, y: 2 }, annotations: [null, { boxes: [{ x: 0, y: 0, width: 1, height: 2, type: 'attack' }], events: [{ type: 'sound', value: 'swing_01' }] }] } };
  if (kind === 'terrain') base.editorProject = { version: 1, source: blob, settings: { tileWidth: 1, tileHeight: 1, columns: 3, rows: 2, map: [0,2,1,3,-1,0], selected: 2, erase: true } };
  return base;
}
async function canonical(value) {
  if (value instanceof Blob) return { type: value.type, bytes: Array.from(new Uint8Array(await value.arrayBuffer())) };
  if (Array.isArray(value)) return Promise.all(value.map(canonical));
  if (value && typeof value === 'object') { const result = {}; for (const [key, child] of Object.entries(value)) if (key !== 'url' && child !== undefined) result[key] = await canonical(child); return result; }
  return value;
}
async function editedArchive(record, edit) {
  const files = unzipSync(new Uint8Array(await (await exportProjectArchive(record)).arrayBuffer()));
  const manifest = JSON.parse(strFromU8(files['project.json'])); edit(manifest, files);
  files['project.json'] = strToU8(JSON.stringify(manifest)); return new Blob([zipSync(files)], { type: 'application/zip' });
}

for (const kind of ['sheet','rig','scene','terrain']) test(`${kind} project ZIP round-trip preserves editable state, transparent RGBA and native route`, async () => {
  const before = fixture(kind), blob = await exportProjectArchive(before), after = await importProjectArchive(blob, options);
  assert.deepEqual(await canonical(after), await canonical(before));
  assert.equal(destinationFor(after), { sheet: 'frames', rig: 'rig', scene: 'scene', terrain: 'terrain' }[kind]);
  const saved = await importProjectToLibrary(blob, options);
  assert.equal(saved.projectInfo.title, { sheet:'动画工作台', rig:'角色装配工作台', scene:'场景与碰撞工作台', terrain:'地形工作台' }[kind]);
  assert.deepEqual(saved.projectInfo.facts, {
    sheet:['2 帧','16 × 16 px 画布'], rig:['2 帧','2 个部件','1 个关键姿势'],
    scene:['2 帧','1 个判定框','1 个事件'], terrain:['3 × 2 格地图','1 × 1 px 图块'],
  }[kind]);
  try {
    const restored = await getAsset(saved.id); assert.notEqual(restored.id, before.id); assert.notEqual(restored.createdAt, before.createdAt);
    assert.deepEqual(await canonical(restored.editorProject), await canonical(before.editorProject));
    assert.deepEqual(await canonical(restored.original), await canonical(before.original));
    const twice = await importProjectArchive(await exportProjectArchive(restored), options);
    assert.deepEqual(await canonical(twice), await canonical(restored));
    await decodeImage(twice.original[0].blob); // Includes alpha 0, 64, 128 and 255 plus hidden RGB.
  } finally { await deleteAsset(saved.id); }
});

test('old animation project without version, source sheet or new editor settings still imports', async () => {
  const record = fixture('sheet'); for (const key of ['version','sourceSheet','cropSettings','editorSettings']) delete record.editorProject[key];
  const result = await importProjectArchive(await exportProjectArchive(record), options); assert.equal(result.editorProject.reference, 'none');
});

test('bad JSON, versions, missing files, MIME and dimensions are rejected before library writes', async () => {
  const existing = await saveAsset(fixture('rig')), before = await canonical(await getAsset(existing.id)), ids = (await listAssets()).map(item => item.id);
  try {
    const bad = [
      json => { json.version = 2; },
      json => { json.record.editorProject.version = 2; },
      json => { json.record.original[0].width = 99; },
      json => { json.record.original[0].blob.file = 'data/9999.png'; },
      json => { json.record.original[0].blob.type = 'image/svg+xml'; },
      json => { json.record.original[0].duration = -1; },
      json => { json.record.editorProject.parts[0].parent = 'head'; },
      json => { json.record.editorProject.parts[1].id = 'body'; },
      json => { json.record.editorProject.parts[0].blob.bytes += 1; },
      (json, files) => { files['data/9999.png'] = png(); },
      json => { json.record.editorProject.parts[0].url = 'https://example.com/x.png'; },
      json => { json.record.editorProject.parts[0] = JSON.parse('{"__proto__": {"polluted": true}}'); },
    ];
    for (const edit of bad) await assert.rejects(importProjectToLibrary(await editedArchive(fixture('rig'), edit), options));
    const invalidJson = new Blob([zipSync({ 'project.json': strToU8('broken') })]);
    await assert.rejects(importProjectToLibrary(invalidJson, options), /project.json/);
    assert.deepEqual((await listAssets()).map(item => item.id), ids); assert.deepEqual(await canonical(await getAsset(existing.id)), before);
    assert.equal({}.polluted, undefined);
  } finally { await deleteAsset(existing.id); }
});

test('unsafe ZIP names are rejected, including traversal, absolute, Windows and backslash paths', async () => {
  for (const path of ['../data/1.png','/data/1.png','C:/data/1.png','data\\1.png','data/../1.png','data//1.png','data/./1.png','//server/data.png']) {
    await assert.rejects(importProjectArchive(new Blob([zipSync({ 'project.json': strToU8('{}'), [path]: png() })]), options), /不安全/);
  }
  await assert.rejects(importProjectArchive(await editedArchive(fixture('sheet'), json => { json.record.original[0].blob.file = '../secret.png'; }), options), /不安全/);
});

test('truncated and CRC-corrupted archives fail; central/local ambiguity and duplicate names fail', async () => {
  const good = new Uint8Array(await (await exportProjectArchive(fixture('sheet'))).arrayBuffer());
  await assert.rejects(importProjectArchive(new Blob([good.subarray(0, good.length - 12)]), options), /损坏/);
  const damaged = good.slice(); damaged[50] ^= 1;
  await assert.rejects(importProjectArchive(new Blob([damaged]), options), /校验/);
  const directory = new DataView(good.buffer).getUint32(good.length - 6, true);
  const mismatch = good.slice(); mismatch[30] ^= 1;
  await assert.rejects(importProjectArchive(new Blob([mismatch]), options), /不一致/);
  const duplicate = good.slice(), view = new DataView(duplicate.buffer);
  const second = directory + 46 + view.getUint16(directory + 28, true) + view.getUint16(directory + 30, true) + view.getUint16(directory + 32, true);
  duplicate.set(duplicate.subarray(directory + 46, directory + 59), second + 46);
  await assert.rejects(importProjectArchive(new Blob([duplicate]), options), /重复/);
});

test('size limits and forged compressed sizes bound decompression; corrupt PNG never saves', async () => {
  const excessive = new Uint8Array(await (await exportProjectArchive(fixture('terrain'))).arrayBuffer());
  const directory = new DataView(excessive.buffer).getUint32(excessive.length - 6, true);
  new DataView(excessive.buffer).setUint32(directory + 24, 300 * 1024 * 1024, true);
  await assert.rejects(importProjectArchive(new Blob([excessive]), options), /过大/);
  const bomb = zipSync({ 'data/0001.png': new Uint8Array(2 * 1024 * 1024), 'project.json': strToU8('{}') });
  const v = new DataView(bomb.buffer), dir = v.getUint32(bomb.length - 6, true); v.setUint32(dir + 24, 16, true); v.setUint32(22, 16, true);
  await assert.rejects(importProjectArchive(new Blob([bomb]), options), /解压大小/);
  const corrupt = await editedArchive(fixture('terrain'), (json, files) => { files[json.record.original[0].blob.file][45] ^= 1; });
  await assert.rejects(importProjectArchive(corrupt, options), /PNG 图片已损坏/);
  const valid = await exportProjectArchive(fixture('sheet'));
  await assert.rejects(importProjectArchive(valid, { decodeImage: async () => { throw new Error('decode failed'); } }), /无法解码/);
});

test('invalid map cells, scene events, settings and oversized canvases fail validation', async () => {
  for (const [kind, edit] of [
    ['terrain', json => { json.record.editorProject.settings.map[0] = 99; }],
    ['terrain', json => { json.record.editorProject.settings.columns = 100000; }],
    ['scene', json => { json.record.editorProject.settings.annotations[1].boxes[0].width = -1; }],
    ['scene', json => { json.record.editorProject.settings.active = 10; }],
    ['sheet', json => { json.record.editorProject.editorSettings.tool = 'unknown'; }],
    ['sheet', json => { json.record.editorProject.size.width = 100000; }],
  ]) await assert.rejects(importProjectArchive(await editedArchive(fixture(kind), edit), options));
});

test('import quota failure rolls back the new copy and leaves the existing project intact', async t => {
  const existing = await saveAsset(fixture('terrain'));
  const archive = await exportProjectArchive(fixture('sheet')), before = await canonical(await getAsset(existing.id));
  const add = IDBObjectStore.prototype.add;
  const mock = t.mock.method(IDBObjectStore.prototype, 'add', function (value) {
    if (this.name === 'summaries') throw new DOMException('Disk full', 'QuotaExceededError');
    return add.call(this, value);
  });
  try {
    await assert.rejects(importProjectToLibrary(archive, options), /存储空间不足/);
    assert.deepEqual((await listAssets()).map(item => item.id), [existing.id]);
    assert.deepEqual(await canonical(await getAsset(existing.id)), before);
    const count = await new Promise(resolve => {
      const request = indexedDB.open('frame-studio-library', 1);
      request.onsuccess = () => { const db = request.result, tx = db.transaction('assets'), query = tx.objectStore('assets').count(); tx.oncomplete = () => { db.close(); resolve(query.result); }; };
    });
    assert.equal(count, 1); // No orphaned asset from the aborted transaction.
  } finally { mock.mock.restore(); await deleteAsset(existing.id); }
});

test('all actual animation tools and original-size enhancement settings are restorable', async () => {
  const record = fixture('sheet'); record.editorProject.editorSettings.enhanceScale = 1;
  for (const tool of ['move','brush','erase','guides','select','anchor']) {
    record.editorProject.editorSettings.tool = tool;
    const restored = await importProjectArchive(await exportProjectArchive(record), options);
    assert.equal(restored.editorProject.editorSettings.tool, tool); assert.equal(restored.editorProject.editorSettings.enhanceScale, 1);
  }
});

test('restored PNG source and frames keep original bytes when only translation metadata is edited and resaved', async () => {
  const restored = await importProjectArchive(await exportProjectArchive(fixture('sheet')), options);
  const p = restored.editorProject; let encodes = 0;
  const encode = async () => { encodes++; throw new Error('An unchanged PNG must not be re-encoded'); };
  const source = rememberPngSource({}, p.sourceSheet.blob);
  const editable = p.frames.map(frame => ({ ...frame, image: rememberPngSource({}, frame.blob) }));
  editable[1].dx += 9; // Same image, changed position; keep semi-transparent and hidden RGB bytes.
  const frames = await Promise.all(editable.map(async ({image,...frame}) => ({...frame,blob:await imagePng(image,encode)})));
  const record = { ...restored, editorProject: { ...p, frames, sourceSheet: { ...p.sourceSheet, blob: await imagePng(source,encode) } } };
  const resaved = await importProjectArchive(await exportProjectArchive(record), options);
  assert.equal(encodes,0); assert.equal(resaved.editorProject.frames[1].dx,p.frames[1].dx+9);
  assert.deepEqual(await canonical(resaved.editorProject.sourceSheet),await canonical(p.sourceSheet));
  for (let i=0;i<p.frames.length;i++) assert.deepEqual(await canonical(resaved.editorProject.frames[i].blob),await canonical(p.frames[i].blob));
});

test('new pixel-edit canvases are encoded while the decoded original remains intact; JPEG is normalised to PNG', async () => {
  const pngBlob = new Blob([png()],{type:'image/png'}), original = rememberPngSource({},pngBlob), painted = {};
  let calls=0; const result = new Blob(['new pixels'],{type:'image/png'}), encode = async image => { calls++; return result; };
  assert.equal(await imagePng(original,encode),pngBlob); assert.equal(calls,0);
  assert.equal(await imagePng(painted,encode),result); assert.equal(calls,1);
  assert.equal(await imagePng(original,encode),pngBlob); // Undo restores the original canvas and its bytes.
  const jpeg = rememberPngSource({},new Blob(['jpeg'],{type:'image/jpeg'}));
  assert.equal(await imagePng(jpeg,encode),result); assert.equal(calls,2);
  await imagePng(painted,encode); assert.equal(calls,3); // Mutable paint canvases are never cached.
});
