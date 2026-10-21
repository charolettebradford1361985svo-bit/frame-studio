import { useEffect, useRef, useState } from 'react';
import { TermTip } from './TermTip.jsx';
import { api, applyChroma, canvasBlob, downloadBlob, exportArchive, removeAiBackground } from './lib/media.mjs';
import { getAsset, listAssets, saveAsset } from './lib/library.mjs';
import { processLocalImages } from './lib/local-ai.mjs';
import { inspectFrames } from './lib/animation-tools.mjs';
import { WORKBENCHES } from './lib/workbenches.mjs';
import { cleanKeyEdges } from './lib/edge-cleanup.mjs';
import './shared-tools.css';

async function readImage(blob) {
  const image = await createImageBitmap(blob);
  if (image.width > 4096 || image.height > 4096 || image.width * image.height > 16e6) { image.close(); throw new Error('请选择 4096 px 以内、1600 万像素以内的图片'); }
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  canvas.getContext('2d').drawImage(image, 0, 0); image.close();
  return { blob: await canvasBlob(canvas), width: canvas.width, height: canvas.height, time: 0 };
}
function Thumbnail({ frame, mask }) {
  const canvas = useRef(null);
  useEffect(() => { let alive = true; createImageBitmap(frame.blob).then(image => {
    if (alive) { const ctx = canvas.current.getContext('2d'); canvas.current.width = image.width; canvas.current.height = image.height; ctx.drawImage(image, 0, 0);
      if (mask) { const p = ctx.getImageData(0, 0, image.width, image.height); for (let i = 0; i < p.data.length; i += 4) { p.data[i] = p.data[i + 1] = p.data[i + 2] = p.data[i + 3]; p.data[i + 3] = 255; } ctx.putImageData(p, 0, 0); }
    } image.close();
  }); return () => { alive = false; }; }, [frame, mask]);
  return <canvas ref={canvas} aria-label={mask ? '透明蒙版预览' : '处理结果预览'} />;
}
export function SharedTools({ onClose, onSendTo }) {
  const dialog = useRef(null), input = useRef(null), control = useRef(null);
  const [services, setServices] = useState({}), [assets, setAssets] = useState([]), [assetId, setAssetId] = useState('');
  const [frames, setFrames] = useState([]), [before, setBefore] = useState([]), [name, setName] = useState('通用工具素材'), [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('上传图片或从素材库选择作品。'), [error, setError] = useState('');
  const [scale, setScale] = useState(2), [color, setColor] = useState('#00ff00'), [tolerance, setTolerance] = useState(60), [mask, setMask] = useState(false), [showOriginal, setShowOriginal] = useState(false);
  const [request, setRequest] = useState(''), [reply, setReply] = useState('');
  const [past, setPast] = useState([]), [future, setFuture] = useState([]);
  useEffect(() => {
    dialog.current.showModal(); api('/status').then(setServices).catch(() => setServices({ offline: true }));
    listAssets().then(setAssets).catch(e => setError(e.message));
    return () => control.current?.abort();
  }, []);
  function replace(next) { setPast(items => [...items.slice(-29), frames]); setFuture([]); setFrames(next); setActive(0); setShowOriginal(false); }
  function undo(redo = false) {
    const source = redo ? future : past; if (!source.length) return;
    if (redo) { setPast(items => [...items.slice(-29), frames]); setFuture(items => items.slice(0, -1)); } else { setFuture(items => [...items, frames]); setPast(items => items.slice(0, -1)); }
    setFrames(source.at(-1)); setActive(0); setShowOriginal(false);
  }
  async function run(action) {
    if (control.current) return; const controller = new AbortController(); control.current = controller; setBusy(true); setError('');
    try { await action(controller.signal); } catch (e) { setError(e.name === 'AbortError' ? '已取消，原素材保留。' : e.message); }
    finally { control.current = null; setBusy(false); }
  }
  async function load(files) {
    files = Array.from(files);
    if (!files.length) return; await run(async () => {
      if (files.length > 36 || Array.from(files).some(file => file.size > 30 * 1024 * 1024)) throw new Error('一次最多 36 张图片，每张 30 MB 以内');
      const next = await Promise.all(Array.from(files, readImage)); replace(next); setBefore(next); setName(files[0].name.replace(/\.[^.]+$/, '')); setMessage(`已导入 ${next.length} 张，实际 ${next[0].width} × ${next[0].height} px`);
    });
  }
  async function process(operation) { await run(async signal => {
    const next = await processLocalImages(frames, operation, { scale }, signal); replace(next); setMessage(`已处理 ${next.length} 帧，实际 ${next[0].width} × ${next[0].height} px`);
  }); }
  async function cut(ai) { await run(async signal => {
    const next = ai ? await removeAiBackground(frames, signal) : await applyChroma(frames, color, tolerance, () => {}, signal);
    next.forEach(frame => URL.revokeObjectURL(frame.url)); replace(next.map(({ url, ...frame }) => frame)); setMessage('已保留透明通道，可查看蒙版并发送到动画工作台修边。');
  }); }
  async function check() { await run(async () => {
    const pixels = await Promise.all(frames.map(async frame => { const image = await createImageBitmap(frame.blob), canvas = document.createElement('canvas'); canvas.width = frame.width; canvas.height = frame.height; const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); image.close(); return { ...frame, data: ctx.getImageData(0, 0, frame.width, frame.height).data }; }));
    const issues = inspectFrames(pixels, frames[0]); setMessage(issues.length ? issues.join('；') : '规格检查通过：尺寸统一，无空白、重复或贴边警告。');
  }); }
  async function cleanEdges() { await run(async () => {
    const key = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
    const next = [];
    for (const frame of frames) {
      const image = await createImageBitmap(frame.blob), canvas = document.createElement('canvas'); canvas.width = frame.width; canvas.height = frame.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); image.close();
      const pixels = ctx.getImageData(0, 0, frame.width, frame.height); pixels.data.set(cleanKeyEdges(pixels.data, frame.width, frame.height, key)); ctx.putImageData(pixels, 0, 0);
      next.push({ ...frame, blob: await canvasBlob(canvas) });
    }
    replace(next); setMessage('已弱化透明轮廓附近的底色偏色，透明度和内部像素保留；可对比原图或撤销。');
  }); }
  const record = () => ({ name, original: frames, cutout: [], fps: 8, kind: 'sheet' });
  const shown = (showOriginal ? before : frames)[Math.min(active, (showOriginal ? before : frames).length - 1)];
  return <dialog ref={dialog} className="shared-tools" aria-labelledby="shared-tools-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <header><div><span>所有工作台共用</span><h2 id="shared-tools-title">素材处理工具</h2></div><button disabled={busy} onClick={onClose}>关闭工具</button></header>
    <div className="shared-tools-body"><aside>
      <h3>导入素材</h3><input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={e => { load(e.target.files); e.target.value = ''; }} /><button disabled={busy} onClick={() => input.current.click()}>上传图片 / 图片集</button>
      <label>从素材库选作品<select value={assetId} disabled={busy} onChange={e => setAssetId(e.target.value)}><option value="">请选择</option>{assets.map(asset => <option value={asset.id} key={asset.id}>{asset.name}</option>)}</select></label>
      <button disabled={busy || !assetId} onClick={() => run(async () => { const asset = await getAsset(assetId); const next = asset.showCutout && asset.cutout.length ? asset.cutout : asset.original; replace(next); setBefore(next); setName(asset.name); setMessage(`已导入「${asset.name}」${next.length} 帧`); })}>载入所选素材</button>
      <h3>轻量 AI 高清</h3><p>{services.enhancementAvailable ? services.enhancementModel : '本地模型未就绪'}。逐帧处理，最长边 1024 px。</p><label>输出倍率<select value={scale} disabled={busy} onChange={e => setScale(Number(e.target.value))}><option value="2">2×</option><option value="4">4×</option></select></label><button disabled={busy || !frames.length || !services.enhancementAvailable} onClick={() => process('upscale')}>全帧本地 AI 高清</button>
      <h3>透明背景</h3><label>背景颜色<input type="color" value={color} disabled={busy} onChange={e => setColor(e.target.value)} /></label><label><span>色差容差<TermTip term="色差容差" /></span><input aria-label="色差容差" type="number" min="0" max="240" value={tolerance} disabled={busy} onChange={e => setTolerance(Number(e.target.value))} /></label><button disabled={busy || !frames.length} onClick={() => cut(false)}>全帧去除指定底色</button><button disabled={busy || !frames.length || !services.backgroundAvailable} onClick={() => cut(true)}>全帧轻量 AI 抠图</button><p>rembg / u2netp 小模型。画笔修边合并在动画工作台。</p>
      <button disabled={busy || !frames.length} onClick={cleanEdges}>弱化绿边 / 蓝边 / 红边</button><p>先抠图，再弱化与底色一致的边缘偏色。</p>
      <button disabled={busy || !frames.length} onClick={check}>检查尺寸 / 空白 / 重复 / 边界</button>
    </aside><main><div className="shared-tools-preview">{shown ? <Thumbnail frame={shown} mask={mask} /> : <p>导入后在这里查看结果</p>}</div><div className="shared-tools-controls"><button disabled={busy || !past.length} onClick={() => undo()}>撤销处理</button><button disabled={busy || !future.length} onClick={() => undo(true)}>重做处理</button><label><input type="checkbox" checked={showOriginal} onChange={e => setShowOriginal(e.target.checked)} />原图对比</label><label><input type="checkbox" aria-label="透明蒙版" checked={mask} onChange={e => setMask(e.target.checked)} />透明蒙版<TermTip term="透明蒙版" /></label></div>
      {shown && <p className="shared-tools-size">实际输出 {shown.width} × {shown.height} px · {active + 1} / {frames.length} 帧</p>}
      <div className="shared-frame-strip">{frames.map((_, i) => <button key={i} aria-pressed={active === i} onClick={() => setActive(i)}>{i + 1}</button>)}</div>
      <label>素材名称<input value={name} disabled={busy} maxLength={80} onChange={e => setName(e.target.value)} /></label><div className="shared-tools-controls"><button disabled={busy || !frames.length || !name.trim()} onClick={() => run(async () => { const saved = await saveAsset(record()); setMessage(`已保存「${saved.name}」到素材库`); setAssets(await listAssets()); })}>保存处理结果到素材库</button><button disabled={busy || !frames.length} onClick={() => run(async () => downloadBlob(await exportArchive(frames, 8, 'frames'), 'processed-frames.zip'))}>导出 PNG 图片集</button></div>
      <div className="shared-tools-controls">{WORKBENCHES.map(entry => <button key={entry.id} disabled={busy || !frames.length} onClick={() => onSendTo(entry.id, record())}>送到{entry.title}</button>)}</div>
      <details><summary>DeepSeek · 提示词 / 动作规划</summary><p>{services.deepSeekConfigured ? '已配置，点击后调用云端 API，按服务额度计费。' : '未配置密钥。本地编辑不依赖它，不会自动调用付费服务。'}</p><label>素材需求<textarea value={request} disabled={busy} maxLength={2000} onChange={e => setRequest(e.target.value)} placeholder="例如：给骑士走路的12帧动作做一个简单规划" /></label><button disabled={busy || !request.trim() || !services.deepSeekConfigured} onClick={() => run(async signal => { const result = await api('/assistant', { request }, signal); setReply(result.reply); })}>调用 DeepSeek 帮我规划</button>{reply && <p className="shared-assistant-reply">{reply}</p>}</details>
    </main></div><footer>{error ? <p role="alert">{error}</p> : <p role="status">{busy ? '本机处理中…' : message}</p>}{busy && <button onClick={() => control.current?.abort()}>取消处理</button>}</footer>
  </dialog>;
}
