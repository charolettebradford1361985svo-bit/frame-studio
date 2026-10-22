export const FRAME_COUNTS = [8, 12, 16, 24, 36];
export function sampleTimes(start, end, count) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start)
    throw new Error('请选择有效的时间范围');
  if (!FRAME_COUNTS.includes(count)) throw new Error('帧数必须为 8、12、16、24 或 36');
  // 每个时间分桶的中点，避开视频结尾，保证恰好 N 个有序采样点。
  return Array.from({ length: count }, (_, i) => start + ((i + 0.5) / count) * (end - start));
}
export const frameName = index => `frame_${String(index + 1).padStart(4, '0')}.png`;
export function outputSize(width, height, maxEdge) {
  if (![width, height, maxEdge].every(value => Number.isSafeInteger(value) && value > 0))
    throw new RangeError('视频尺寸和最长边必须为有效正整数');
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export function chromaKey(data, rgb, tolerance, feather = 24, width = data.length / 4, height = 1) {
  const out = new Uint8ClampedArray(data);
  const distances = new Float32Array(data.length / 4);
  for (let i = 0; i < out.length; i += 4) {
    const distance = Math.hypot(out[i] - rgb[0], out[i + 1] - rgb[1], out[i + 2] - rgb[2]);
    distances[i / 4] = distance;
    out[i + 3] = Math.round(out[i + 3] * (feather > 0 ? Math.min(1, Math.max(0, (distance - tolerance) / feather)) : Number(distance > tolerance)));
  }
  // Read neighbors from the unmodified mask: repaired pixels must not spread to the next pixel.
  const mask = out.slice();
  const radius = 3;
  const neighbors = [];
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    if (Math.abs(dx) + Math.abs(dy) <= radius && (dx || dy)) neighbors.push([dx, dy]);
  }
  const channel = rgb.indexOf(Math.max(...rgb));
  const other = [0, 1, 2].filter(c => c !== channel);
  const coloredKey = rgb[channel] - Math.max(...other.map(c => rgb[c])) >= 40;
  const excess = i => data[i + channel] - Math.max(data[i + other[0]], data[i + other[1]]);
  const spillLimit = i => Math.abs(data[i + other[0]] - data[i + other[1]]) <= 8 ? 2 : 24;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (!mask[i + 3]) continue;
    let transparent = false, subject = -1, coverage = 0, bestDistance = 0;
    // A wider boundary band includes diagonal corners and several pixels of color spill.
    for (const [dx, dy] of neighbors) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && !mask[(ny * width + nx) * 4 + 3]) { transparent = true; break; }
    }
    if (!transparent) continue;
    for (const [dx, dy] of neighbors) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const j = (ny * width + nx) * 4;
      if (!mask[j + 3] || (coloredKey && excess(j) > spillLimit(j))) continue;
      if (distances[j / 4] <= tolerance + feather || distances[j / 4] <= bestDistance) continue;
      const dr = data[j] - rgb[0], dg = data[j + 1] - rgb[1], db = data[j + 2] - rgb[2];
      const amount = ((data[i] - rgb[0]) * dr + (data[i + 1] - rgb[1]) * dg + (data[i + 2] - rgb[2]) * db) / (dr * dr + dg * dg + db * db);
      const error = Math.hypot(data[i] - rgb[0] - amount * dr, data[i + 1] - rgb[1] - amount * dg, data[i + 2] - rgb[2] - amount * db);
      // Only replace colors explained by a blend of this neighbor and the selected background.
      if (amount > 0 && amount < .98 && error <= Math.max(8, Math.min(24, tolerance))) {
        subject = j; coverage = amount; bestDistance = distances[j / 4];
      }
    }
    if (subject < 0) {
      if (coloredKey && excess(i) > spillLimit(i)) {
        // Keep diffuse smoke's alpha even when no reliable foreground color can be sampled.
        out[i + channel] -= excess(i);
        if (Math.max(out[i + other[0]], out[i + other[1]]) === 0) out.fill(0, i, i + 4);
      }
      else if (mask[i + 3] < data[i + 3]) out.fill(0, i, i + 4);
      continue;
    }
    // Restore foreground RGB and retain continuous coverage instead of punching random holes.
    out.set(data.subarray(subject, subject + 3), i);
    out[i + 3] = Math.round(data[i + 3] * coverage);
  }
  return out;
}
export function makeManifest(frames, fps) {
  return { version: 1, fps, duration: frames.length / fps, frameCount: frames.length,
    width: frames[0]?.width ?? 0, height: frames[0]?.height ?? 0,
    frames: frames.map((frame, i) => ({ file: frameName(i), sourceTime: frame.time, duration: 1 / fps })) };
}
