// Workbench image edits create a new canvas. Keep original PNG bytes attached to
// decoded, unmodified canvases so saving metadata cannot alter hidden RGB/alpha.
const sources = new WeakMap();
export function rememberPngSource(image, blob) {
  if (blob instanceof Blob && blob.type === 'image/png') sources.set(image, blob);
  return image;
}
export function imagePng(image, encode) {
  // Do not cache newly encoded canvases: an in-progress paint canvas is mutable.
  return sources.has(image) ? Promise.resolve(sources.get(image)) : encode(image);
}
