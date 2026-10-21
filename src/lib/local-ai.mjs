import { api, readDataUrl } from './media.mjs';

/** Shared local model transport. Returned records own no object URLs. */
export async function processLocalImages(frames, operation, options = {}, signal) {
  if (!frames.length) throw new Error('请先导入素材');
  const output = [];
  for (let offset = 0; offset < frames.length; offset += 16) {
  const batch = frames.slice(offset, offset + 16);
  const images = await Promise.all(batch.map(frame => readDataUrl(frame.blob)));
  const result = await api('/process-images', { images, operation, options }, signal);
  if (!Array.isArray(result.images) || result.images.length !== (operation === 'interpolate' ? options.count ?? 3 : batch.length)) throw new Error('本地处理返回的帧数不完整');
  output.push(...await Promise.all(result.images.map(async (uri, index) => {
    const blob = await (await fetch(uri, { signal })).blob();
    const bitmap = await createImageBitmap(blob);
    const record = { blob, width: bitmap.width, height: bitmap.height, time: batch[index]?.time ?? 0 };
    bitmap.close(); return record;
  })));
  }
  return output;
}
