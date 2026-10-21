import { useEffect, useRef, useState } from 'react';
import { Play } from '@phosphor-icons/react/dist/csr/Play';
import { Pause } from '@phosphor-icons/react/dist/csr/Pause';
import { frameDuration, playbackSequence } from './lib/animation-tools.mjs';
import { PREVIEW_STAGE, initialPlacement, fitPlacement, previewSpriteRect, containImageRect } from './lib/scene-preview.mjs';
import './scene-preview.css';

const scenes = [
  { id: 'forest', name: '林间空地', url: '/scenes/forest.png' },
  { id: 'courtyard', name: '小镇庭院', url: '/scenes/courtyard.png' },
  { id: 'plain', name: '纯色试放', url: null },
];

export function ScenePreview({ frames, size, fps, playbackMode, name, onClose }) {
  const dialog = useRef(null), canvas = useRef(null), upload = useRef(null), drag = useRef(null), uploadVersion = useRef(0);
  const [scene, setScene] = useState('forest'), [background, setBackground] = useState(null), [custom, setCustom] = useState(null);
  const [position, setPosition] = useState(() => initialPlacement(size));
  const [playing, setPlaying] = useState(true), [active, setActive] = useState(0), [speed, setSpeed] = useState(1);
  const [message, setMessage] = useState('拖动角色放到场景里，循环检查动作效果。');
  const [loading, setLoading] = useState(false);
  useEffect(() => { dialog.current.showModal(); return () => { dialog.current?.close(); uploadVersion.current++; }; }, []);
  useEffect(() => { const bitmap = custom?.image; return () => bitmap?.close(); }, [custom]);
  useEffect(() => {
    let alive = true; setBackground(null);
    if (scene === 'custom') { setBackground(custom?.image || null); setLoading(false); return; }
    const entry = scenes.find(value => value.id === scene);
    if (!entry?.url) { setLoading(false); return; }
    setLoading(true); const image = new Image();
    image.onload = () => { if (alive) { setBackground(image); setLoading(false); } };
    image.onerror = () => { if (alive) { setLoading(false); setMessage('场景图片未能载入，请切换场景或上传自己的背景。'); } };
    image.src = entry.url;
    return () => { alive = false; image.onload = null; image.onerror = null; };
  }, [scene, custom]);
  useEffect(() => {
    if (!playing || !frames.length) return;
    const sequence = playbackSequence(frames.length, playbackMode);
    let cursor = Math.max(0, sequence.indexOf(active)), timer;
    const advance = () => { cursor = (cursor + 1) % sequence.length; setActive(sequence[cursor]); timer = setTimeout(advance, frameDuration(frames[sequence[cursor]], fps) / speed); };
    timer = setTimeout(advance, frameDuration(frames[sequence[cursor]], fps) / speed);
    return () => clearTimeout(timer);
  }, [playing, frames, fps, playbackMode, speed]);
  useEffect(() => {
    const ctx = canvas.current.getContext('2d');
    ctx.imageSmoothingEnabled = false; ctx.fillStyle = '#e9ede6'; ctx.fillRect(0, 0, PREVIEW_STAGE.width, PREVIEW_STAGE.height);
    if (background) { const r = containImageRect(background.width, background.height); ctx.drawImage(background, r.x, r.y, r.width, r.height); }
    const frame = frames[active]; if (!frame) return;
    const r = previewSpriteRect(position, size);
    ctx.save(); ctx.beginPath(); ctx.rect(r.left, r.top, r.width, r.height); ctx.clip();
    ctx.drawImage(frame.image, r.left + frame.dx * r.scale, r.top + frame.dy * r.scale, frame.image.width * r.scale, frame.image.height * r.scale);
    ctx.restore();
  }, [background, active, frames, size, position]);
  function point(event) {
    const bounds = canvas.current.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) * PREVIEW_STAGE.width / bounds.width, y: (event.clientY - bounds.top) * PREVIEW_STAGE.height / bounds.height };
  }
  function startDrag(event) {
    if (event.button !== 0) return; const at = point(event), r = previewSpriteRect(position, size);
    if (at.x < r.left || at.x > r.left + r.width || at.y < r.top || at.y > r.top + r.height) return;
    event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { at, position };
  }
  function moveDrag(event) {
    if (!drag.current) return; const at = point(event), from = drag.current;
    setPosition(fitPlacement({ ...from.position, x: from.position.x + at.x - from.at.x, y: from.position.y + at.y - from.at.y }, size));
  }
  function keyboard(event) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) return; event.preventDefault();
    if (event.key === ' ') { if (!event.repeat) setPlaying(value => !value); return; }
    const delta = event.shiftKey ? 10 : 1;
    setPosition(p => fitPlacement({ ...p, x: p.x + (event.key === 'ArrowRight' ? delta : event.key === 'ArrowLeft' ? -delta : 0), y: p.y + (event.key === 'ArrowDown' ? delta : event.key === 'ArrowUp' ? -delta : 0) }, size));
  }
  async function loadBackground(file) {
    if (!file) return; const version = ++uploadVersion.current;
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 30 * 1024 * 1024) throw new Error('请选择 30 MB 以内的 PNG、JPG 或 WebP 场景。');
      const image = await createImageBitmap(file);
      if (image.width * image.height > 32_000_000) { image.close(); throw new Error('背景超过 3200 万像素，请先缩小图片。'); }
      if (version !== uploadVersion.current) { image.close(); return; }
      setCustom({ image, name: file.name }); setScene('custom'); setMessage(`已载入 ${file.name}，背景按原比例显示。`);
    } catch (error) { if (version === uploadVersion.current) setMessage(error.message); }
  }
  const fitted = fitPlacement(position, size), maxScale = Math.min(4, PREVIEW_STAGE.width / size.width, PREVIEW_STAGE.height / size.height);
  return <dialog ref={dialog} className="scene-preview-dialog" aria-label="场景预览" onCancel={onClose}>
    <header><div><h2>场景预览</h2><p>{name} · {frames.length} 帧 · {fps} FPS</p></div><button onClick={onClose}>返回编辑</button></header>
    <div className="scene-preview-layout">
      <section className="scene-preview-view"><div className="scene-preview-stage">
        <canvas ref={canvas} width={PREVIEW_STAGE.width} height={PREVIEW_STAGE.height} aria-label="场景动画画布" tabIndex={0} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onKeyDown={keyboard} />
        {loading && <span className="scene-preview-loading">载入场景…</span>}
      </div><div className="scene-preview-transport"><button className="sheet-primary" onClick={() => setPlaying(value => !value)}>{playing ? <Pause weight="fill" /> : <Play weight="fill" />}{playing ? '暂停预览' : '循环播放'}</button>
        <label>速度<select aria-label="场景播放速度" value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value={.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select></label>
        <output aria-label="场景当前帧">第 {active + 1} / {frames.length} 帧</output></div>
        <p className="scene-preview-caption">可边播放边拖动；画布聚焦后方向键微调，Shift + 方向键移动 10 px。</p>
      </section>
      <aside><h3>选择场景</h3><div className="scene-preview-scenes">{scenes.map(entry => <button key={entry.id} aria-pressed={scene === entry.id} className={scene === entry.id ? 'chosen' : ''} onClick={() => setScene(entry.id)}>{entry.url ? <img src={entry.url} alt="" /> : <span className="scene-preview-plain" />}<span>{entry.name}</span></button>)}</div>
        <input hidden ref={upload} type="file" accept="image/png,image/jpeg,image/webp" aria-label="上传自定义场景" onChange={e => { loadBackground(e.target.files[0]); e.target.value = ''; }} />
        <button onClick={() => upload.current.click()}>上传自己的场景</button>
        {custom && <button className={scene === 'custom' ? 'chosen' : ''} aria-pressed={scene === 'custom'} onClick={() => setScene('custom')}>{custom.name}</button>}
        <h3>角色摆放</h3><label>显示大小 · {Math.round(fitted.scale * 100)}%<input type="range" aria-label="场景角色大小" min={Math.min(.01, maxScale)} max={maxScale} step={.01} value={fitted.scale} onChange={e => setPosition(fitPlacement({ ...position, scale: Number(e.target.value) }, size))} /></label>
        <output aria-label="场景角色位置">位置 X {Math.round(fitted.x)} · Y {Math.round(fitted.y)}</output><button onClick={() => setPosition(initialPlacement(size))}>重置摆放</button>
        <p className="scene-preview-note">仅调整预览。角色尺寸、帧位置及导出文件保持原样。带背景的帧会连同背景显示；建议先在修图里抠图。</p>
      </aside>
    </div><p role="status" className="scene-preview-message">{message}</p>
  </dialog>;
}
