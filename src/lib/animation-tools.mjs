import { alphaBounds } from './sprite-editor.mjs';

export function timelineEntries(frames, renderPreview) {
  return frames.map(frame => ({ frame, preview: renderPreview(frame) }));
}
export function frameDuration(frame, fps = 8) {
  return Number.isFinite(frame.duration) && frame.duration >= 16 ? Math.min(10000, frame.duration) : 1000 / fps;
}
export function playbackSequence(count, mode = 'forward') {
  const indices = Array.from({ length: count }, (_, i) => i);
  if (mode === 'reverse') return indices.reverse();
  if (mode === 'pingpong' && count > 2) return [...indices, ...indices.slice(1, -1).reverse()];
  return indices;
}
export function reorderFrame(frames, index, destination) {
  if (index < 0 || index >= frames.length || destination < 0 || destination >= frames.length) return frames;
  const result = [...frames], [frame] = result.splice(index, 1); result.splice(destination, 0, frame); return result;
}
export function regionRect(start, end, width, height) {
  const left = Math.max(0, Math.min(width - 1, Math.min(start.x, end.x))), top = Math.max(0, Math.min(height - 1, Math.min(start.y, end.y)));
  return { x: left, y: top, width: Math.max(1, Math.min(width, Math.max(start.x, end.x)) - left), height: Math.max(1, Math.min(height, Math.max(start.y, end.y)) - top) };
}

// Template matching estimates a single translation. It never invents a changed pose.
export function matchTranslation(reference, target, width, height, region, radius = 16) {
  radius = Math.max(0, Math.min(32, Math.round(radius)));
  const step = Math.max(1, Math.ceil(Math.sqrt(region.width * region.height / 2500))), samples = [];
  for (let y = region.y; y < region.y + region.height; y += step) for (let x = region.x; x < region.x + region.width; x += step) {
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const p = (y * width + x) * 4, alpha = reference[p + 3] / 255;
    samples.push({ x, y, rgba: [reference[p] * alpha, reference[p + 1] * alpha, reference[p + 2] * alpha, reference[p + 3]] });
  }
  if (!samples.some(s => s.rgba[3] > 8)) throw new Error('参考区域为空，请框选角色的稳定部位');
  let best = { dx: 0, dy: 0, error: Infinity };
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    let error = 0;
    for (const sample of samples) {
      const x = sample.x + dx, y = sample.y + dy, outside = x < 0 || y < 0 || x >= width || y >= height, p = (y * width + x) * 4;
      const alpha = outside ? 0 : target[p + 3] / 255;
      for (let channel = 0; channel < 4; channel++) {
        const value = outside ? 0 : channel === 3 ? target[p + 3] : target[p + channel] * alpha;
        error += Math.abs(value - sample.rgba[channel]);
      }
    }
    error /= samples.length * 4;
    if (error < best.error || error === best.error && dx * dx + dy * dy < best.dx * best.dx + best.dy * best.dy) best = { dx, dy, error };
  }
  return { dx: -best.dx, dy: -best.dy, similarity: Math.max(0, 1 - best.error / 255) };
}
export function translatePixels(data, width, height, dx, dy) {
  const output = new Uint8ClampedArray(data.length); dx = Math.round(dx); dy = Math.round(dy);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const tx = x + dx, ty = y + dy; if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
    const from = (y * width + x) * 4, to = (ty * width + tx) * 4; output.set(data.subarray(from, from + 4), to);
  }
  return output;
}
export function translationSteps(dx, dy, count) {
  if (!Number.isInteger(count) || count < 1 || count > 24) throw new Error('中间帧数量须为 1–24');
  return Array.from({ length: count }, (_, i) => ({ dx: Math.round(dx * (i + 1) / (count + 1)), dy: Math.round(dy * (i + 1) / (count + 1)) }));
}
export function comparePixels(a, b) {
  if (a.length !== b.length) throw new Error('比较帧的尺寸须相同');
  let changed = 0, error = 0, visible = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (!a[i + 3] && !b[i + 3]) continue;
    visible++; let delta = Math.abs(a[i + 3] - b[i + 3]);
    for (let c = 0; c < 3; c++) delta += Math.abs(a[i + c] * a[i + 3] / 255 - b[i + c] * b[i + 3] / 255);
    if (delta > 8) changed++; error += delta / 4;
  }
  return { changedRatio: visible ? changed / visible : 0, averageDifference: visible ? error / visible : 0 };
}
export function inspectFrames(frames, size) {
  const issues = [], seen = new Map();
  frames.forEach((f, index) => {
    const bounds = alphaBounds(f.data, f.width, f.height);
    if (!bounds) issues.push(`第 ${index + 1} 帧为空白帧`);
    if (f.width !== size.width || f.height !== size.height) issues.push(`第 ${index + 1} 帧尺寸不一致`);
    if (bounds && (bounds.left === 0 || bounds.top === 0 || bounds.right === f.width || bounds.bottom === f.height)) issues.push(`第 ${index + 1} 帧轮廓触边，请检查是否裁切`);
    // FNV fingerprint is followed by exact comparison so collisions cannot report false duplicates.
    let hash = 2166136261; for (const byte of f.data) hash = Math.imul(hash ^ byte, 16777619);
    const prior = seen.get(hash) || [], duplicate = prior.find(i => frames[i].data.length === f.data.length && frames[i].data.every((n, p) => n === f.data[p]));
    if (duplicate !== undefined) issues.push(`第 ${index + 1} 帧与第 ${duplicate + 1} 帧完全重复（可用于停顿）`);
    prior.push(index); seen.set(hash, prior);
  });
  return issues;
}
export function atlasLayout(bounds, size, anchor, durations, padding = 2) {
  const cells = bounds.map(b => ({ b, w: b ? b.right - b.left : 1, h: b ? b.bottom - b.top : 1 }));
  const targetWidth = Math.max(...cells.map(c => c.w + padding * 2), Math.ceil(Math.sqrt(cells.reduce((s, c) => s + (c.w + padding * 2) * (c.h + padding * 2), 0))));
  let x = padding, y = padding, rowHeight = 0, width = 1;
  const frames = cells.map((cell, index) => {
    if (x > padding && x + cell.w + padding > targetWidth) { x = padding; y += rowHeight + padding * 2; rowHeight = 0; }
    const frame = { filename: `frame-${String(index + 1).padStart(3, '0')}.png`, frame: { x, y, w: cell.w, h: cell.h }, rotated: false, trimmed: true,
      spriteSourceSize: { x: cell.b?.left || 0, y: cell.b?.top || 0, w: cell.w, h: cell.h }, sourceSize: { w: size.width, h: size.height },
      pivot: { x: anchor.x / size.width, y: anchor.y / size.height }, anchor: { ...anchor }, duration: durations[index], empty: !cell.b };
    x += cell.w + padding * 2; width = Math.max(width, x - padding); rowHeight = Math.max(rowHeight, cell.h); return frame;
  });
  return { width: width + padding, height: y + rowHeight + padding, frames };
}
