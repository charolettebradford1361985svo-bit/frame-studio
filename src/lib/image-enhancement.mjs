import { validCanvas } from './sprite-editor.mjs';

// Integer scaling keeps each source pixel and its transparency intact.
export function enhancePixels(data, width, height, scale = 2, sharpen = false) {
  if (![1, 2, 4].includes(scale)) throw new Error('放大倍数须为 1、2 或 4');
  validCanvas(width * scale, height * scale);
  if (data.length !== width * height * 4) throw new Error('图片像素数据尺寸不匹配');
  const source = new Uint8ClampedArray(data);
  if (sharpen) {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (!data[i + 3]) continue;
      const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
        .filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < width && ny < height)
        .map(([nx, ny]) => (ny * width + nx) * 4)
        .filter(j => data[j + 3] === data[i + 3]);
      if (!neighbors.length) continue;
      for (let c = 0; c < 3; c++) source[i + c] = data[i + c] + 0.35 * (data[i + c] - neighbors.reduce((sum, j) => sum + data[j + c], 0) / neighbors.length);
    }
  }
  const outputWidth = width * scale, outputHeight = height * scale;
  const output = new Uint8ClampedArray(outputWidth * outputHeight * 4);
  for (let y = 0; y < outputHeight; y++) for (let x = 0; x < outputWidth; x++) {
    const sourceIndex = (Math.floor(y / scale) * width + Math.floor(x / scale)) * 4;
    const targetIndex = (y * outputWidth + x) * 4;
    for (let c = 0; c < 4; c++) output[targetIndex + c] = source[sourceIndex + c];
  }
  return { data: output, width: outputWidth, height: outputHeight };
}
