/** Suppress excess key-color on alpha/transparent-adjacent edges; preserve alpha and interiors. */
export function cleanKeyEdges(data, width, height, key, strength = .6) {
  const channel = key.indexOf(Math.max(...key));
  const other = [0, 1, 2].filter(c => c !== channel);
  if (key[channel] - Math.max(...other.map(c => key[c])) < 40) throw new Error('边色处理适合绿色、蓝色或红色底');
  const output = new Uint8ClampedArray(data);
  strength = Math.max(0, Math.min(1, strength));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 4, alpha = data[p + 3]; if (!alpha) continue;
    const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    const edge = alpha < 255 || neighbors.some(([nx, ny]) => nx >= 0 && ny >= 0 && nx < width && ny < height && data[(ny * width + nx) * 4 + 3] < 255);
    if (!edge) continue;
    const neutral = Math.max(...other.map(c => data[p + c]));
    output[p + channel] -= Math.round(Math.max(0, data[p + channel] - neutral) * strength);
  }
  return output;
}
