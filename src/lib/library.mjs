const DATABASE = 'frame-studio-library';
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('assets', { keyPath: 'id' });
      request.result.createObjectStore('summaries', { keyPath: 'id' });
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('请关闭其他 Frame Studio 页面后重试'));
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
}
async function transaction(mode, action) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(['assets', 'summaries'], mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error || new Error('素材保存中断，请重试'));
      try { action(tx, value => { result = value; }); } catch (error) { tx.abort(); reject(error); }
    });
  } catch (error) {
    if (error.name === 'QuotaExceededError') throw new Error('本地存储空间不足，请导出并删除部分素材后重试');
    throw error;
  } finally { db.close(); }
}
function storeFrames(frames) {
  return frames.map(({ blob, width, height, time, duration }) => ({ blob, width, height, time, ...(duration === undefined ? {} : { duration }) }));
}
function blobBytes(value) {
  if (value instanceof Blob) return value.size;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + blobBytes(item), 0);
  if (value && typeof value === 'object') return Object.values(value).reduce((sum, item) => sum + blobBytes(item), 0);
  return 0;
}
export async function saveAsset({ name, original, cutout = [], fps, prompt, showCutout, kind, editorProject }) {
  name = name.trim();
  if (!name || name.length > 80) throw new Error('请填写 1–80 字的素材名称');
  if (!original.length || (cutout.length && cutout.length !== original.length)) throw new Error('序列帧不完整，无法保存');
  if (!Number.isFinite(fps) || fps <= 0) throw new Error('播放速度无效');
  const record = { id: crypto.randomUUID(), name, createdAt: Date.now(), fps, prompt, showCutout,
    original: storeFrames(original), cutout: storeFrames(cutout), kind, editorProject };
  const preview = cutout.length && showCutout ? cutout : original;
  const summary = { id: record.id, name, kind, createdAt: record.createdAt, fps, frameCount: original.length,
    width: original[0].width, height: original[0].height, transparent: Boolean(cutout.length),
    thumbnail: preview[0].blob, bytes: blobBytes(record.original) + blobBytes(record.cutout) + blobBytes(editorProject) };
  await transaction('readwrite', tx => {
    tx.objectStore('assets').add(record); tx.objectStore('summaries').add(summary);
  });
  return summary;
}
export function listAssets() {
  return transaction('readonly', (tx, result) => {
    const request = tx.objectStore('summaries').getAll();
    request.onsuccess = () => result(request.result.sort((a, b) => b.createdAt - a.createdAt));
  });
}
export async function getAsset(id) {
  const record = await transaction('readonly', (tx, result) => {
    const request = tx.objectStore('assets').get(id); request.onsuccess = () => result(request.result);
  });
  if (!record) throw new Error('素材已被删除，请刷新素材库');
  return record;
}
export function deleteAsset(id) {
  return transaction('readwrite', tx => {
    tx.objectStore('assets').delete(id); tx.objectStore('summaries').delete(id);
  });
}
export function restoreFrames(frames) {
  return frames.map(frame => ({ ...frame, url: URL.createObjectURL(frame.blob) }));
}
