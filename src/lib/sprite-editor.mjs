export function gridRects(width, height, columns = 3, rows = 2) {
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1 || columns * rows > 36 || columns > width || rows > height) throw new Error('网格需为正整数，最多 36 帧，不能超过图片尺寸');
  return Array.from({ length: columns * rows }, (_, i) => {
    const col = i % columns, row = Math.floor(i / columns);
    const x = Math.floor(col * width / columns), y = Math.floor(row * height / rows);
    return { x, y, width: Math.floor((col + 1) * width / columns) - x, height: Math.floor((row + 1) * height / rows) - y };
  });
}
export function clampRect(rect, width, height, allowOutside = false) {
  const w = Math.min(allowOutside ? 4096 : width, Math.max(1, Math.round(rect.width))), h = Math.min(allowOutside ? 4096 : height, Math.max(1, Math.round(rect.height)));
  return { x: Math.max(allowOutside ? 1 - w : 0, Math.min(allowOutside ? width - 1 : width - w, Math.round(rect.x))), y: Math.max(allowOutside ? 1 - h : 0, Math.min(allowOutside ? height - 1 : height - h, Math.round(rect.y))), width: w, height: h };
}
export function alphaBounds(data, width, height, threshold = 16) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] > threshold) {
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  return right < 0 ? null : { left, top, right: right + 1, bottom: bottom + 1 };
}
export function anchorShift(point, target) { return { dx: target.x - point.x, dy: target.y - point.y }; }
export function referenceIndex(reference, active, count) {
  if (reference === 'none') return null;
  if (count < 2) return null;
  if (reference === 'previous') return (active + count - 1) % count;
  if (reference === 'next') return (active + 1) % count;
  const fixed = Number(reference);
  return Number.isInteger(fixed) && fixed >= 0 && fixed < count && fixed !== active ? fixed : null;
}
export function confirmRect(rects, draft, index, uniform, width, height) {
  if (!draft) return rects;
  if (index === null && rects.length >= 36) throw new Error('最多支持 36 个裁剪框');
  const confirmed = clampRect(draft, width, height, true);
  const next = rects.map((r, i) => i === index ? confirmed : uniform ? clampRect({ ...r, width: confirmed.width, height: confirmed.height }, width, height, true) : r);
  if (index === null) next.push(confirmed);
  return next;
}
export function detectSheetBackground(data, width, height) {
  const samples = new Map(); let transparent = 0, total = 0;
  const sample = (x, y) => {
    const i = (y * width + x) * 4; total++;
    if (data[i + 3] <= 16) { transparent++; return; }
    const key = `${data[i] >> 3},${data[i + 1] >> 3},${data[i + 2] >> 3}`;
    const item = samples.get(key) || { count: 0, r: 0, g: 0, b: 0 }; item.count++; item.r += data[i]; item.g += data[i + 1]; item.b += data[i + 2]; samples.set(key, item);
  };
  const step = Math.max(1, Math.floor(Math.max(width, height) / 256));
  for (let x = 0; x < width; x += step) { sample(x, 0); sample(x, height - 1); }
  for (let y = 0; y < height; y += step) { sample(0, y); sample(width - 1, y); }
  if (transparent > total / 2) return null;
  const dominant = [...samples.values()].sort((a, b) => b.count - a.count)[0];
  return dominant ? [dominant.r, dominant.g, dominant.b].map(v => Math.round(v / dominant.count)) : null;
}
// Grow connected foreground beyond the proposed boxes, so an ear or tail crossing a grid edge is retained.
// Scanline flood fill bounds memory to one byte per pixel rather than a full-image pixel queue.
export function detectSubjectBounds(data, width, height, rects, background, tolerance = 60) {
  const mask = new Uint8Array(width * height), distance = tolerance * tolerance;
  for (let p = 0; p < mask.length; p++) {
    const i = p * 4;
    if (data[i + 3] <= 16) continue;
    if (!background || (data[i] - background[0]) ** 2 + (data[i + 1] - background[1]) ** 2 + (data[i + 2] - background[2]) ** 2 > distance) mask[p] = 1;
  }
  const bounds = rects.map(() => null); let shared = 0;
  for (let seed = 0; seed < mask.length; seed++) {
    if (mask[seed] !== 1) continue;
    const stack = [seed], overlaps = rects.map(() => 0);
    let left = width, top = height, right = 0, bottom = 0;
    while (stack.length) {
      const p = stack.pop(); if (mask[p] !== 1) continue;
      const y = Math.floor(p / width), x = p % width; let a = x, b = x;
      while (a > 0 && mask[y * width + a - 1] === 1) a--;
      while (b + 1 < width && mask[y * width + b + 1] === 1) b++;
      left = Math.min(left, a); right = Math.max(right, b + 1); top = Math.min(top, y); bottom = Math.max(bottom, y + 1);
      for (let j = a; j <= b; j++) mask[y * width + j] = 2;
      rects.forEach((r, i) => { if (y >= r.y && y < r.y + r.height) overlaps[i] += Math.max(0, Math.min(b + 1, r.x + r.width) - Math.max(a, r.x)); });
      for (const adjacent of [y - 1, y + 1]) {
        if (adjacent < 0 || adjacent >= height) continue;
        let inRun = false;
        for (let j = Math.max(0, a - 1); j <= Math.min(width - 1, b + 1); j++) { const next = adjacent * width + j; if (mask[next] === 1) { if (!inRun) stack.push(next); inRun = true; } else inRun = false; }
      }
    }
    const largest = Math.max(...overlaps); if (!largest) continue;
    if (overlaps.filter(n => n > largest * 0.25).length > 1) shared++;
    const owner = overlaps.indexOf(largest), previous = bounds[owner];
    bounds[owner] = previous ? { left: Math.min(previous.left, left), top: Math.min(previous.top, top), right: Math.max(previous.right, right), bottom: Math.max(previous.bottom, bottom) } : { left, top, right, bottom };
  }
  return { bounds, shared };
}
export function subjectRects(bounds, originals, width, height, padding = 8, uniform = true) {
  const sizes = bounds.map((b, i) => b ? { width: b.right - b.left + padding * 2, height: b.bottom - b.top + padding * 2 } : originals[i]);
  const common = { width: Math.max(...sizes.map(s => s.width)), height: Math.max(...sizes.map(s => s.height)) };
  return bounds.map((b, i) => {
    if (!b) return clampRect(uniform ? { ...originals[i], ...common } : originals[i], width, height, true);
    const size = uniform ? common : sizes[i];
    return clampRect({ ...size, x: Math.floor((b.left + b.right - size.width) / 2), y: Math.floor((b.top + b.bottom - size.height) / 2) }, width, height, true);
  });
}
export function containAlignedBounds(size, bounds, padding = 8) {
  const dx = Math.max(0, Math.ceil(padding - Math.min(...bounds.map(b => b.left))));
  const dy = Math.max(0, Math.ceil(padding - Math.min(...bounds.map(b => b.top))));
  return { dx, dy, width: size.width + dx + Math.max(0, Math.ceil(Math.max(...bounds.map(b => b.right)) + padding - size.width)), height: size.height + dy + Math.max(0, Math.ceil(Math.max(...bounds.map(b => b.bottom)) + padding - size.height)) };
}
export function validCanvas(width, height, count = 1) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096 || width * height * count > 64_000_000) throw new Error('画布须为 1–4096 像素；所有帧总面积不能超过 6400 万像素');
  return { width, height };
}
