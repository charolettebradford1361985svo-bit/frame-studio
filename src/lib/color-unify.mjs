function colorFamily(data, offset) {
  const r = data[offset] / 255, g = data[offset + 1] / 255, b = data[offset + 2] / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const saturation = max ? delta / max : 0;
  let hue = 0;
  if (delta) hue = 60 * (max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4);
  // Protect outlines and highlights before comparing hue: black and white
  // must not match gray merely because all three have low saturation.
  const family = max <= 48 / 255 ? 'black' : min >= 230 / 255 ? 'white' : saturation <= .12 ? 'gray' : 'color';
  return { hue: (hue + 360) % 360, saturation, family };
}

export function unifyRegionColors(reference, target, width, height, region) {
  const data = new Uint8ClampedArray(target);
  let changed = 0, skipped = 0;
  const left = Math.max(0, Math.floor(region.x)), top = Math.max(0, Math.floor(region.y));
  const right = Math.min(width, Math.ceil(region.x + region.width)), bottom = Math.min(height, Math.ceil(region.y + region.height));
  const groups = new Map();
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    const i = (y * width + x) * 4;
    if (!target[i + 3]) continue;
    const key = `${target[i]},${target[i + 1]},${target[i + 2]}`;
    if (!groups.has(key)) groups.set(key, { pixels: [], votes: new Map(), incompatible: false });
    const group = groups.get(key);
    group.pixels.push(i);
    if (!reference[i + 3]) { group.incompatible = true; continue; }
    const a = colorFamily(reference, i), b = colorFamily(target, i);
    const hueDifference = Math.abs(a.hue - b.hue);
    const sameFamily = a.family === b.family && (a.family !== 'color' || Math.min(hueDifference, 360 - hueDifference) <= 12 && Math.abs(a.saturation - b.saturation) <= .15);
    if (!sameFamily) { group.incompatible = true; continue; }
    const referenceKey = `${reference[i]},${reference[i + 1]},${reference[i + 2]}`;
    const vote = group.votes.get(referenceKey) || { count: 0, offset: i };
    vote.count++; group.votes.set(referenceKey, vote);
  }
  // Use a consistent palette mapping rather than stamping reference texture.
  // Ambiguous mappings and isolated details stay untouched.
  for (const group of groups.values()) {
    let best;
    for (const vote of group.votes.values()) if (!best || vote.count > best.count) best = vote;
    if (group.incompatible || group.pixels.length < 3 || !best || best.count / group.pixels.length < .8) {
      skipped += group.pixels.length; continue;
    }
    for (const i of group.pixels) {
      if (reference[best.offset] === target[i] && reference[best.offset + 1] === target[i + 1] && reference[best.offset + 2] === target[i + 2]) continue;
      data.set(reference.subarray(best.offset, best.offset + 3), i); changed++;
    }
  }
  return { data, changed, skipped };
}
