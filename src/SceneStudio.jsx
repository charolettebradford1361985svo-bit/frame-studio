import { useEffect, useRef, useState } from 'react';
import { canvasBlob, downloadBlob } from './lib/media.mjs';
import { saveAsset } from './lib/library.mjs';
import { rememberPngSource, imagePng } from './lib/image-source.mjs';
import { acceptEditorShortcut } from './lib/editor-history.mjs';
import { BOX_COLORS, rectangleBetween, moveBox, sceneManifest } from './lib/scene-terrain.mjs';
import './scene-terrain.css';
import { draftValue } from './lib/draft-guard.mjs';
import { useDraftGuard, DraftNotice } from './DraftNotice.jsx';

export function useWorkbench(initial, visible) {
  const [state, setState] = useState(() => ({ project: initial(), past: [], future: [] }));
  const edit = (change, remember = true) => setState(old => ({ project: typeof change === 'function' ? change(old.project) : change,
    past: remember ? [...old.past.slice(-29), old.project] : old.past, future: remember ? [] : old.future }));
  const checkpoint = () => edit(value => value);
  const travel = direction => setState(old => {
    const source = direction === 'undo' ? old.past : old.future;
    if (!source.length) return old;
    return direction === 'undo' ? { project: source.at(-1), past: source.slice(0, -1), future: [...old.future, old.project] }
      : { project: source.at(-1), past: [...old.past, old.project], future: source.slice(0, -1) };
  });
  useEffect(() => {
    if (!visible) return;
    const key = event => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (!acceptEditorShortcut(event)) return;
      if (event.key.toLowerCase() === 'z') { event.preventDefault(); travel(event.shiftKey ? 'redo' : 'undo'); }
      if (event.key.toLowerCase() === 'y') { event.preventDefault(); travel('redo'); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [visible]);
  return { project: state.project, edit, checkpoint, travel, canUndo: Boolean(state.past.length), canRedo: Boolean(state.future.length) };
}
export async function imageCanvas(blob) {
  if (!(blob instanceof Blob) || blob.size > 30 * 1024 * 1024) throw new Error('请选择不超过 30 MB 的图片');
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width * bitmap.height > 32 * 1024 * 1024 || bitmap.width > 8192 || bitmap.height > 8192) throw new Error('图片过大，请使用不超过 8192 px 的图片');
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0); return rememberPngSource(canvas, blob);
  } finally { bitmap.close(); }
}
export function makeCanvas(width, height) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
}
export async function imageRecord(image, time = 0) { return { blob: await imagePng(image, canvasBlob), width: image.width, height: image.height, time }; }
async function decodeFrames(records) {
  if (!records.length || records.length > 96) throw new Error('请导入 1–96 张序列帧');
  const frames = []; let pixels = 0;
  for (const [i, frame] of records.entries()) {
    const image = await imageCanvas(frame.blob); pixels += image.width * image.height;
    if (pixels > 64 * 1024 * 1024) throw new Error('序列总像素过多，请减少帧数或单帧尺寸');
    frames.push({ ...await imageRecord(image, frame.time ?? i / 8), ...(frame.duration === undefined ? {} : { duration: frame.duration }), image });
  }
  return frames;
}
export async function projectZip(files) {
  const { zip, strToU8 } = await import('fflate'); const packed = {};
  for (const [name, value] of Object.entries(files)) packed[name] = value instanceof Blob ? [new Uint8Array(await value.arrayBuffer()), { level: 0 }] : strToU8(JSON.stringify(value, null, 2));
  return new Promise((resolve, reject) => zip(packed, (error, bytes) => error ? reject(error) : resolve(new Blob([bytes], { type: 'application/zip' }))));
}
export function WorkbenchHeader({ title, subtitle, history, onHome, onLibrary, busy }) {
  return <header className="st-header"><div><span className="st-eyebrow">FRAME STUDIO</span><h1>{title}</h1><p>{subtitle}</p></div><nav aria-label={`${title}导航`}><button disabled={busy} onClick={onHome}>返回首页</button><button disabled={busy} onClick={onLibrary}>素材库</button><button disabled={busy || !history.canUndo} onClick={() => history.travel('undo')}>撤销</button><button disabled={busy || !history.canRedo} onClick={() => history.travel('redo')}>重做</button></nav></header>;
}
const initialScene = () => ({ name: '场景试放', frames: [], background: null, fps: 8, playing: false, active: 0, x: 320, y: 330, scale: 1, anchor: { x: 0, y: 0 }, annotations: [] });
function drawScene(canvas, project, overlays = true, draft = null) {
  const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, 640, 400);
  ctx.fillStyle = '#eff3e9'; ctx.fillRect(0, 0, 640, 400);
  if (project.background) ctx.drawImage(project.background, 0, 0, 640, 400);
  else { ctx.fillStyle = '#d5dfc7'; ctx.fillRect(0, 330, 640, 70); ctx.strokeStyle = '#7d9675'; ctx.beginPath(); ctx.moveTo(0, 330); ctx.lineTo(640, 330); ctx.stroke(); }
  const frame = project.frames[project.active]; if (!frame) return;
  const left = project.x - project.anchor.x * project.scale, top = project.y - project.anchor.y * project.scale;
  ctx.drawImage(frame.image, left, top, frame.width * project.scale, frame.height * project.scale);
  if (!overlays) return;
  for (const box of [...(project.annotations[project.active]?.boxes || []), ...(draft ? [draft] : [])]) {
    ctx.fillStyle = `${BOX_COLORS[box.type]}22`; ctx.strokeStyle = BOX_COLORS[box.type]; ctx.lineWidth = 2;
    ctx.fillRect(left + box.x * project.scale, top + box.y * project.scale, box.width * project.scale, box.height * project.scale);
    ctx.strokeRect(left + box.x * project.scale, top + box.y * project.scale, box.width * project.scale, box.height * project.scale);
  }
  ctx.strokeStyle = '#edb831'; ctx.beginPath(); ctx.moveTo(project.x - 6, project.y); ctx.lineTo(project.x + 6, project.y); ctx.moveTo(project.x, project.y - 6); ctx.lineTo(project.x, project.y + 6); ctx.stroke();
}
export function SceneStudio({ visible, onHome, onLibrary, record, onBusyChange, onSendTo }) {
  const [busy, setBusy] = useState(false);
  const history = useWorkbench(initialScene, visible && !busy), { project: p, edit } = history;
  const draftGuard = useDraftGuard(draftValue('scene', p));
  const canvas = useRef(null), drag = useRef(null), spriteUpload = useRef(null), backgroundUpload = useRef(null);
  const [tool, setTool] = useState('move'), [boxType, setBoxType] = useState('collision'), [selectedBox, setSelectedBox] = useState(-1), [draft, setDraft] = useState(null);
  const [eventType, setEventType] = useState('footstep'), [eventValue, setEventValue] = useState(''), [message, setMessage] = useState('导入序列帧后，可以在场景中试放并逐帧标记。');
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  async function run(action) { if (busy) return; setBusy(true); try { await action(); } catch (e) { setMessage(e.message); } finally { setBusy(false); } }
  useEffect(() => {
    if (!record) return; let alive = true;
    run(async () => {
      const stored = record.kind === 'scene' ? record.editorProject : null;
      const originals = stored?.spriteFrames || (record.showCutout && record.cutout?.length ? record.cutout : record.original);
      const frames = await decodeFrames(originals);
      const background = stored?.background ? await imageCanvas(stored.background) : null;
      if (alive) { const next = { ...initialScene(), ...(stored?.settings || {}), frames, background, name: record.name, playing: false, active: stored?.settings?.active ?? 0,
        anchor: stored?.settings?.anchor || { x: Math.round(frames[0].width / 2), y: frames[0].height } }; edit(next); if (stored) draftGuard.markSaved(draftValue('scene', next)); setMessage(stored ? '已恢复场景、逐帧框和动作事件。' : `已导入 ${frames.length} 帧。黄色十字为共享锚点。`); }
    }); return () => { alive = false; };
  }, [record]);
  useEffect(() => { if (canvas.current && visible) drawScene(canvas.current, p, true, draft); }, [p, draft, visible]);
  useEffect(() => { if (!visible || !p.playing || !p.frames.length) return; const timer = setInterval(() => edit(old => ({ ...old, active: (old.active + 1) % old.frames.length }), false), 1000 / p.fps); return () => clearInterval(timer); }, [visible, p.playing, p.fps, p.frames.length]);
  const current = p.frames[p.active], annotations = p.annotations[p.active] || { boxes: [], events: [] }, selected = annotations.boxes[selectedBox];
  const update = (key, value) => edit(old => ({ ...old, [key]: value }));
  const updateAnnotation = (change, remember = true) => edit(old => { const annotations = old.annotations.slice(); annotations[old.active] = change(annotations[old.active] || { boxes: [], events: [] }); return { ...old, annotations }; }, remember);
  async function importFiles(files) {
    if (!files.length) return;
    const frames = await decodeFrames([...files].map((blob, i) => ({ blob, time: i / p.fps })));
    edit(old => ({ ...old, frames, active: 0, annotations: [], anchor: { x: Math.round(frames[0].width / 2), y: frames[0].height }, scale: 1, playing: false })); setMessage(`已按选择顺序导入 ${frames.length} 帧。`);
  }
  async function demo() {
    const frames = await Promise.all(Array.from({ length: 4 }, async (_, i) => { const image = makeCanvas(64, 80), ctx = image.getContext('2d'); ctx.fillStyle = '#526d58'; ctx.fillRect(20, 28, 24, 34); ctx.fillStyle = '#dfb789'; ctx.fillRect(20, 7, 24, 23); ctx.fillStyle = '#344d42'; ctx.fillRect(20 - i * 2, 62, 10, 15); ctx.fillRect(35 + i * 2, 62, 10, 15); return { ...await imageRecord(image, i / 8), image }; }));
    edit({ ...initialScene(), frames, anchor: { x: 32, y: 80 }, name: '场景 · 方块角色测试示例', scale: 2 }); setMessage('这是程序绘制的测试角色，可用于检查框选、播放和保存。');
  }
  function point(event) { const bounds = canvas.current.getBoundingClientRect(); return { x: (event.clientX - bounds.left) * 640 / bounds.width, y: (event.clientY - bounds.top) * 400 / bounds.height }; }
  function local(point) { return { x: (point.x - p.x) / p.scale + p.anchor.x, y: (point.y - p.y) / p.scale + p.anchor.y }; }
  function pointerDown(event) {
    if (!current || busy || p.playing) return; const pos = point(event); history.checkpoint(); event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === 'move') drag.current = { type: 'move', start: pos, x: p.x, y: p.y };
    else {
      const a = local(pos), hit = annotations.boxes.findLastIndex(box => a.x >= box.x && a.x <= box.x + box.width && a.y >= box.y && a.y <= box.y + box.height);
      if (hit >= 0) { setSelectedBox(hit); drag.current = { type: 'box', start: a, box: annotations.boxes[hit], index: hit }; }
      else { drag.current = { type: 'draw', start: a }; setSelectedBox(-1); }
    }
  }
  function pointerMove(event) {
    const action = drag.current; if (!action) return; const pos = point(event);
    if (action.type === 'move') edit(old => ({ ...old, x: Math.round(action.x + pos.x - action.start.x), y: Math.round(action.y + pos.y - action.start.y) }), false);
    else { const b = local(pos); if (action.type === 'draw') setDraft({ ...rectangleBetween(action.start, b, current.width, current.height), type: boxType });
      else updateAnnotation(value => ({ ...value, boxes: value.boxes.map((box, i) => i === action.index ? moveBox(action.box, b.x - action.start.x, b.y - action.start.y, current.width, current.height) : box) }), false); }
  }
  function pointerUp() { if (drag.current?.type === 'draw' && draft?.width > 0 && draft?.height > 0) { updateAnnotation(value => ({ ...value, boxes: [...value.boxes, draft] }), false); setSelectedBox(annotations.boxes.length); } drag.current = null; setDraft(null); }
  async function packedRecord() {
    const spriteFrames = p.frames.map(({ blob, width, height, time, duration }) => ({ blob, width, height, time, ...(duration === undefined ? {} : { duration }) }));
    const { frames, background, ...settings } = p; settings.playing = false;
    return { name: p.name, fps: p.fps, original: spriteFrames, kind: 'scene', editorProject: { version: 1, settings, spriteFrames, background: background ? await imagePng(background, canvasBlob) : null } };
  }
  async function save() { const savingDraft = draftValue('scene', p); const saved = await saveAsset(await packedRecord()); draftGuard.markSaved(savingDraft); setMessage(`已保存「${saved.name}」，素材库可恢复场景及逐帧标记。`); }
  async function exportProject() {
    const files = { 'scene.json': sceneManifest(p, p.frames) }; const image = makeCanvas(640, 400); drawScene(image, p, false); files['scene-preview.png'] = await canvasBlob(image);
    for (const [i, frame] of p.frames.entries()) files[`frames/frame-${String(i + 1).padStart(3, '0')}.png`] = await canvasBlob(frame.image);
    if (p.background) files['background.png'] = await canvasBlob(p.background);
    downloadBlob(await projectZip(files), 'scene-project.zip'); setMessage('已导出原尺寸 PNG、场景预览和逐帧框 / 事件 JSON；彩色框不写入图片。');
  }
  return <section className="st-workbench" hidden={!visible} aria-label="场景与碰撞工作台">
    <WorkbenchHeader title="场景与碰撞" subtitle="检查游戏里的大小、位置与动作判定" history={history} onHome={onHome} onLibrary={onLibrary} busy={busy} />
    <div className="st-layout" inert={busy}><aside className="st-panel"><h2>场景设置</h2><button disabled={busy} onClick={() => spriteUpload.current.click()}>导入 PNG 序列帧</button><input className="st-file" ref={spriteUpload} type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={e => { const files = [...e.target.files]; e.target.value = ''; run(() => importFiles(files)); }} />
      <button disabled={busy} onClick={() => run(demo)}>使用测试角色</button><button disabled={busy} onClick={() => backgroundUpload.current.click()}>上传场景背景</button><input className="st-file" ref={backgroundUpload} type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { const file = e.target.files[0]; e.target.value = ''; if (file) run(async () => update('background', await imageCanvas(file))); }} />
      <button disabled={busy || !p.background} onClick={() => update('background', null)}>恢复测试地面</button><p className="st-note">默认地面用于检查脚底锚点；背景适配 640 × 400 的预览区。</p>
      <div className="st-field-pair"><label>位置 X<input type="number" value={p.x} onChange={e => update('x', Number(e.target.value))} /></label><label>位置 Y<input type="number" value={p.y} onChange={e => update('y', Number(e.target.value))} /></label></div>
      <label>角色预览倍数<select value={p.scale} onChange={e => update('scale', Number(e.target.value))}>{[.5, 1, 2, 3, 4].map(scale => <option key={scale} value={scale}>{scale}×</option>)}</select></label><div className="st-field-pair"><label>共享锚点 X<input type="number" value={p.anchor.x} onChange={e => update('anchor', { ...p.anchor, x: Number(e.target.value) })} /></label><label>共享锚点 Y<input type="number" value={p.anchor.y} onChange={e => update('anchor', { ...p.anchor, y: Number(e.target.value) })} /></label></div><p className="st-note">框坐标始终按原帧像素保存，预览缩放不会改变素材大小。</p>
      <h2>保存与导出</h2><label>项目名称<input maxLength={80} value={p.name} onChange={e => update('name', e.target.value)} /></label><button className="st-primary" disabled={busy || !current || !p.name.trim()} onClick={() => run(save)}>保存场景到素材库</button><DraftNotice guard={draftGuard} saveLabel="保存场景到素材库" prerequisite={!current ? '先导入序列帧，再保存场景到素材库。' : null} className="st-note" /><button disabled={busy || !current} onClick={() => run(exportProject)}>导出场景 ZIP</button><button disabled={busy || !current || !onSendTo} onClick={() => run(async () => onSendTo('frames', await packedRecord()))}>送到动画工作台</button>
    </aside><main className="st-main"><div className="st-toolbar"><button aria-pressed={tool === 'move'} onClick={() => setTool('move')}>拖动角色</button><button aria-pressed={tool === 'box'} onClick={() => setTool('box')}>画框 / 拖动框</button><span>黄十字：共享锚点</span></div><div className="st-canvas-wrap"><canvas ref={canvas} width="640" height="400" aria-label="场景预览，拖动角色或框选碰撞区域" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { drag.current = null; setDraft(null); }} /></div>
      <div className="st-toolbar"><button disabled={!current} onClick={() => update('playing', !p.playing)}>{p.playing ? '暂停场景播放' : '播放场景动画'}</button><label>场景 FPS<input type="number" min="1" max="60" value={p.fps} onChange={e => update('fps', Math.max(1, Math.min(60, Number(e.target.value) || 1)))} /></label><span>第 {current ? p.active + 1 : 0} / {p.frames.length} 帧</span></div><div className="st-frame-strip">{p.frames.map((frame, i) => <button key={i} className={i === p.active ? 'is-selected' : ''} onClick={() => edit(old => ({ ...old, active: i, playing: false }))}>帧 {i + 1}<small>{p.annotations[i]?.boxes.length || 0} 个框 · {p.annotations[i]?.events.length || 0} 个事件</small></button>)}</div>
      {!current && <p className="st-empty">从素材库选择动画，或导入有序的 PNG 帧。也可以先使用测试角色。</p>}
    </main><aside className="st-panel"><h2>当前帧的判定框</h2><label>新建框类型<select value={boxType} onChange={e => setBoxType(e.target.value)}><option value="collision">绿色 · 碰撞框</option><option value="hurt">蓝色 · 受击框</option><option value="attack">红色 · 攻击框</option></select></label><p className="st-note">暂停播放，选择画框工具，在角色上拖出矩形。拖动已有框可移动位置。</p>
      <div className="st-item-list">{annotations.boxes.map((box, i) => <button key={i} className={i === selectedBox ? 'is-selected' : ''} onClick={() => setSelectedBox(i)}><i style={{ background: BOX_COLORS[box.type] }} />{({ collision: '碰撞', hurt: '受击', attack: '攻击' })[box.type]} {i + 1} · {box.width} × {box.height}</button>)}</div>
      {selected && <><div className="st-field-pair">{['x', 'y', 'width', 'height'].map(key => <label key={key}>框{({ x: ' X', y: ' Y', width: '宽', height: '高' })[key]}<input type="number" min="0" value={selected[key]} onChange={e => { const max = key === 'x' ? current.width - selected.width : key === 'y' ? current.height - selected.height : key === 'width' ? current.width - selected.x : current.height - selected.y; const value = Math.min(max, Math.max(key === 'width' || key === 'height' ? 1 : 0, Number(e.target.value))); updateAnnotation(data => ({ ...data, boxes: data.boxes.map((box, i) => i === selectedBox ? { ...box, [key]: value } : box) })); }} /></label>)}</div><button onClick={() => { updateAnnotation(data => ({ ...data, boxes: data.boxes.filter((_, i) => i !== selectedBox) })); setSelectedBox(-1); }}>删除当前框</button></>}
      <button disabled={!annotations.boxes.length || p.frames.length < 2} onClick={() => edit(old => ({ ...old, annotations: old.frames.map((frame, i) => ({ boxes: annotations.boxes.map(box => ({ ...rectangleBetween({ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y + box.height }, frame.width, frame.height), type: box.type })).filter(box => box.width > 0 && box.height > 0), events: old.annotations[i]?.events || [] })) }))}>当前框应用到全帧</button>
      <h2>动作事件</h2><label>事件类型<select value={eventType} onChange={e => setEventType(e.target.value)}><option value="footstep">脚步</option><option value="hit">命中 / 伤害</option><option value="sound">音效</option><option value="effect">特效</option><option value="custom">自定义</option></select></label><label>事件参数<input placeholder="例如 footstep_01 / damage=10" maxLength={120} value={eventValue} onChange={e => setEventValue(e.target.value)} /></label><button disabled={!current} onClick={() => updateAnnotation(data => ({ ...data, events: [...data.events, { type: eventType, value: eventValue }] }))}>给当前帧添加事件</button><ul className="st-events">{annotations.events.map((event, i) => <li key={i}><span>{event.type} {event.value}</span><button aria-label={`删除事件 ${i + 1}`} onClick={() => updateAnnotation(data => ({ ...data, events: data.events.filter((_, index) => index !== i) }))}>×</button></li>)}</ul><p className="st-note">事件作为游戏引擎可读的标记导出；音效播放和伤害计算由游戏执行。</p>
    </aside></div><footer className="st-status" role="status">{busy ? '正在处理…' : message}</footer>
  </section>;
}
