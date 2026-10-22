import { sampleTimes, outputSize, chromaKey, frameName, makeManifest } from './core.mjs';

function waitEvent(target, event, timeout = 20000, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const done = error => {
      clearTimeout(timer); target.removeEventListener(event, success); target.removeEventListener('error', failed); signal?.removeEventListener('abort', aborted);
      error ? reject(error) : resolve();
    };
    const success = () => done();
    const failed = () => done(new Error('浏览器无法解码这个视频，请使用 H.264 MP4 或 WebM'));
    const aborted = () => done(new DOMException('已取消', 'AbortError'));
    const timer = setTimeout(() => done(new Error('读取视频超时，请换一个视频重试')), timeout);
    target.addEventListener(event, success, { once: true }); target.addEventListener('error', failed, { once: true });
    signal?.addEventListener('abort', aborted, { once: true });
  });
}
export async function openVideo(url, signal) {
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.preload = 'auto';
  const loaded = waitEvent(video, 'loadeddata', 20000, signal);
  video.src = url;
  try {
    await loaded;
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('视频时长无效');
    return video;
  } catch (error) { disposeVideo(video); throw error; }
}
export function disposeVideo(video) { video?.pause(); video?.removeAttribute('src'); video?.load(); }
export function canvasBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('无法编码 PNG')), 'image/png'));
}
export function disposeFrames(frames) { frames.forEach(f => URL.revokeObjectURL(f.url)); }
export async function extractFrames(url, start, end, count, maxEdge, progress, signal) {
  const video = await openVideo(url, signal);
  const frames = [];
  try {
    if (end > video.duration + 0.01) throw new Error('结束时间超出视频长度');
    const times = sampleTimes(start, Math.min(end, video.duration), count);
    const size = outputSize(video.videoWidth, video.videoHeight, maxEdge);
    const canvas = document.createElement('canvas'); Object.assign(canvas, size);
    const ctx = canvas.getContext('2d');
    for (const [i, time] of times.entries()) {
      signal?.throwIfAborted();
      const sought = waitEvent(video, 'seeked', 20000, signal); video.currentTime = time; await sought;
      signal?.throwIfAborted();
      ctx.drawImage(video, 0, 0, size.width, size.height);
      const blob = await canvasBlob(canvas);
      signal?.throwIfAborted();
      frames.push({ blob, url: URL.createObjectURL(blob), time, ...size }); progress(i + 1, count);
    }
    signal?.throwIfAborted();
    return frames;
  } catch (error) { disposeFrames(frames); throw error; }
  finally { disposeVideo(video); }
}
export async function applyChroma(frames, hex, tolerance, progress, signal) {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const out = [];
  try {
    for (const [i, frame] of frames.entries()) {
      signal?.throwIfAborted();
      const bitmap = await createImageBitmap(frame.blob);
      let canvas, ctx;
      try {
        signal?.throwIfAborted();
        canvas = document.createElement('canvas'); canvas.width = frame.width; canvas.height = frame.height;
        ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
      } finally { bitmap.close(); }
      const pixels = ctx.getImageData(0, 0, frame.width, frame.height);
      pixels.data.set(chromaKey(pixels.data, rgb, tolerance, 24, frame.width, frame.height)); ctx.putImageData(pixels, 0, 0);
      const blob = await canvasBlob(canvas); signal?.throwIfAborted();
      out.push({ ...frame, blob, url: URL.createObjectURL(blob) });
      progress(i + 1, frames.length);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    signal?.throwIfAborted();
    return out;
  } catch (error) { disposeFrames(out); throw error; }
}
export const readDataUrl = blob => new Promise((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob);
});
export async function api(path, body, signal, method) {
  const response = await fetch(`/api${path}`, { method: method ?? (body ? 'POST' : 'GET'),
    headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, signal });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || '处理失败，请重试'); return data;
}
export async function removeAiBackground(frames, signal) {
  const out = [];
  try {
    for (let offset = 0; offset < frames.length; offset += 16) {
      signal?.throwIfAborted();
      const batch = frames.slice(offset, offset + 16);
      const images = await Promise.all(batch.map(frame => readDataUrl(frame.blob)));
      const result = await api('/remove-background', { images }, signal);
      if (!Array.isArray(result.images) || result.images.length !== batch.length) throw new Error('抠图返回的帧数不完整，请重试');
      for (const [i, src] of result.images.entries()) {
        const blob = await (await fetch(src)).blob();
        out.push({ ...batch[i], blob, url: URL.createObjectURL(blob) });
      }
    }
    return out;
  } catch (error) { disposeFrames(out); throw error; }
}
export async function exportArchive(frames, fps, format) {
  const { zip, strToU8 } = await import('fflate');
  const files = {}; const manifest = makeManifest(frames, fps);
  if (format === 'frames') {
    for (const [i, f] of frames.entries()) files[frameName(i)] = [new Uint8Array(await f.blob.arrayBuffer()), { level: 0 }];
  } else {
    const columns = Math.ceil(Math.sqrt(frames.length)); const rows = Math.ceil(frames.length / columns);
    const { width, height } = frames[0];
    const canvas = document.createElement('canvas'); canvas.width = columns * width; canvas.height = rows * height;
    const ctx = canvas.getContext('2d');
    for (const [i, frame] of frames.entries()) {
      const image = await createImageBitmap(frame.blob);
      try { ctx.drawImage(image, (i % columns) * width, Math.floor(i / columns) * height); }
      finally { image.close(); }
    }
    files['sheet.png'] = [new Uint8Array(await (await canvasBlob(canvas)).arrayBuffer()), { level: 0 }];
    manifest.sheet = { file: 'sheet.png', columns, rows };
    manifest.frames = manifest.frames.map((frame, i) => ({ ...frame, x: (i % columns) * width, y: Math.floor(i / columns) * height, width, height }));
  }
  files['frames.json'] = strToU8(JSON.stringify(manifest, null, 2));
  return new Promise((resolve, reject) => zip(files, (error, bytes) => error ? reject(error) : resolve(new Blob([bytes], { type: 'application/zip' }))));
}
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
