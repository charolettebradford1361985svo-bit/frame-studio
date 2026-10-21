import { useEffect, useMemo, useRef, useState } from 'react';
import { TermTip } from './TermTip.jsx';
import { zoomCanvasView } from './lib/canvas-zoom.mjs';
import { unifyRegionColors } from './lib/color-unify.mjs';
import { House } from '@phosphor-icons/react/dist/csr/House';
import { FilmStrip } from '@phosphor-icons/react/dist/csr/FilmStrip';
import { Images } from '@phosphor-icons/react/dist/csr/Images';
import { Export } from '@phosphor-icons/react/dist/csr/Export';
import { Copy } from '@phosphor-icons/react/dist/csr/Copy';
import { Trash } from '@phosphor-icons/react/dist/csr/Trash';
import { Plus } from '@phosphor-icons/react/dist/csr/Plus';
import { Play } from '@phosphor-icons/react/dist/csr/Play';
import { Pause } from '@phosphor-icons/react/dist/csr/Pause';
import { SkipBack } from '@phosphor-icons/react/dist/csr/SkipBack';
import { SkipForward } from '@phosphor-icons/react/dist/csr/SkipForward';
import { ArrowCounterClockwise } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise';
import { ArrowClockwise } from '@phosphor-icons/react/dist/csr/ArrowClockwise';
import { Crosshair } from '@phosphor-icons/react/dist/csr/Crosshair';
import { Eye } from '@phosphor-icons/react/dist/csr/Eye';
import { FloppyDisk } from '@phosphor-icons/react/dist/csr/FloppyDisk';
import { ArrowsOut } from '@phosphor-icons/react/dist/csr/ArrowsOut';
import { Crop } from '@phosphor-icons/react/dist/csr/Crop';
import { PaintBrush } from '@phosphor-icons/react/dist/csr/PaintBrush';
import { GridFour } from '@phosphor-icons/react/dist/csr/GridFour';
import { gridRects, clampRect, alphaBounds, anchorShift, validCanvas, confirmRect, detectSheetBackground, detectSubjectBounds, subjectRects, containAlignedBounds, referenceIndex } from './lib/sprite-editor.mjs';
import { canvasBlob, exportArchive, downloadBlob, applyChroma, removeAiBackground, disposeFrames, api } from './lib/media.mjs';
import { saveAsset } from './lib/library.mjs';
import { rememberPngSource, imagePng } from './lib/image-source.mjs';
import './sheet-studio.css';
import { remember, travel, guideHit, dragGuide, acceptEditorShortcut } from './lib/editor-history.mjs';
import { enhancePixels } from './lib/image-enhancement.mjs';
import { timelineEntries, playbackSequence, frameDuration, reorderFrame, regionRect, matchTranslation, translationSteps, comparePixels, inspectFrames, atlasLayout } from './lib/animation-tools.mjs';
import './animation-tools.css';
import './sheet-workspace.css';
import { draftValue } from './lib/draft-guard.mjs';
import { useDraftGuard, DraftNotice } from './DraftNotice.jsx';
import { ScenePreview } from './ScenePreview.jsx';

const makeCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
async function decodeCanvas(blob) {
  const bitmap = await createImageBitmap(blob);
  const c = makeCanvas(bitmap.width, bitmap.height); c.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close(); return rememberPngSource(c, blob);
}
function renderFrame(frame, size) {
  const c = makeCanvas(size.width, size.height), ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
  ctx.drawImage(frame.image, frame.dx, frame.dy); return c;
}
const initialSize = { width: 256, height: 256 };
const prompt = '以我的角色参考图为准，生成同一角色的连续动画六帧，3列2行，从左到右、从上到下。动作：[填写待机/行走/挥手]。每格等宽等高，角色朝向、服装、比例、配色一致，固定镜头，每格脚底位于相同基线。每格保留安全边距，禁止角色跨格。透明背景或纯绿色背景，无文字、无分隔线、无场景，整张图一次生成。';
function NumberField({ label, value, onChange, min = 0, max = 4096, step = 1, disabled = false }) {
  return <label className="sheet-number"><span>{label}<TermTip term={label} /></span><input type="number" aria-label={label} value={value} min={min} max={max} step={step} disabled={disabled} onChange={e => { if (e.target.value !== '') onChange(Number(e.target.value)); }} /></label>;
}
export function SheetStudio({ visible, onHome, onLibrary, record, onBusyChange, onSendTo }) {
  const [sheet, setSheet] = useState(null), [rects, setRects] = useState([]), [selectedBox, setSelectedBox] = useState(0), [uniform, setUniform] = useState(true);
  const [draftRect, setDraftRect] = useState(null);
  const [draftIndex, setDraftIndex] = useState(null), [columns, setColumns] = useState(3), [rows, setRows] = useState(2), [padding, setPadding] = useState(8), [autoBackground, setAutoBackground] = useState(true);
  const [frames, setFrames] = useState([]), [size, setSize] = useState(initialSize), [draftSize, setDraftSize] = useState(initialSize);
  const [active, setActive] = useState(0), [fps, setFps] = useState(8), [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(3), [sourceCollapsed, setSourceCollapsed] = useState(false), [anchorMode, setAnchorMode] = useState('bottom');
  const [previewView, setPreviewView] = useState({ scale: 1, x: 0, y: 0 });
  const [alignmentFeedback, setAlignmentFeedback] = useState(null);
  const [colorReference, setColorReference] = useState(0), [colorScope, setColorScope] = useState('all'), [colorFeedback, setColorFeedback] = useState('');
  const [tool, setTool] = useState('move'), [onion, setOnion] = useState(true), [reference, setReference] = useState('previous'), [guides, setGuides] = useState(true);
  const [showEnhance, setShowEnhance] = useState(false), [enhanceMode, setEnhanceMode] = useState('pixel'), [enhanceScale, setEnhanceScale] = useState(2);
  const [lines, setLines] = useState({ left: 16, right: 240, top: 16, bottom: 240, center: 128 });
  const [brush, setBrush] = useState(8), [paint, setPaint] = useState('#ffffff'), [keyColor, setKeyColor] = useState('#00ff00'), [tolerance, setTolerance] = useState(60);
  const [name, setName] = useState('序列帧动画'), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [history, setHistory] = useState({ past: [], future: [] }), [showPrompt, setShowPrompt] = useState(false);
  const [playbackMode, setPlaybackMode] = useState('forward'), [selection, setSelection] = useState(null), [patchReference, setPatchReference] = useState('previous'), [patchOffset, setPatchOffset] = useState({ x: 0, y: 0 });
  const [alignRadius, setAlignRadius] = useState(16), [alignPreview, setAlignPreview] = useState(null), [interpolateFrom, setInterpolateFrom] = useState(0), [interpolateCount, setInterpolateCount] = useState(3), [interpolateMode, setInterpolateMode] = useState('translation'), [interpolatePreview, setInterpolatePreview] = useState(null), [checkReport, setCheckReport] = useState('');
  const [aiStatus, setAiStatus] = useState(null);
  const [workspaceStep, setWorkspaceStep] = useState('crop'), [showTimeline, setShowTimeline] = useState(false);
  const [showScenePreview, setShowScenePreview] = useState(false);
  const timelineDialog = useRef();
  const inspector = useRef();
  useEffect(() => { inspector.current?.scrollTo({ top: 0 }); }, [workspaceStep]);
  const draftGuard = useDraftGuard(draftValue('sheet', snapshot()));
  const sourceCanvas = useRef(), editCanvas = useRef(), input = useRef(), gesture = useRef(), abort = useRef();
  const pairInput = useRef();
  const enhanceDialog = useRef();
  const frame = frames[active];
  useEffect(() => { setPreviewView({ scale: 1, x: 0, y: 0 }); }, [zoom, size.width, size.height]);
  useEffect(() => {
    const canvas = editCanvas.current;
    if (!canvas || !visible) return;
    const wheel = e => {
      e.preventDefault();
      if (gesture.current) return;
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.parentElement.clientHeight : 1);
      const bounds = canvas.getBoundingClientRect();
      setPreviewView(view => zoomCanvasView(view, bounds, { x: e.clientX, y: e.clientY }, delta));
    };
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => canvas.removeEventListener('wheel', wheel);
  }, [visible]);
  const filmstrip = useMemo(() => timelineEntries(frames, f => renderFrame(f, size).toDataURL()), [frames, size]);
  const onionIndex = referenceIndex(reference, active, frames.length);
  useEffect(() => { if (!visible) setPlaying(false); }, [visible]);
  useEffect(() => {
    const dialog = enhanceDialog.current;
    if (showEnhance && visible) dialog?.showModal();
    return () => dialog?.close();
  }, [showEnhance, visible]);
  useEffect(() => {
    const dialog = timelineDialog.current;
    if (showTimeline && visible) dialog?.showModal();
    return () => dialog?.close();
  }, [showTimeline, visible]);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => {
    if (!visible || showScenePreview || !draftRect || busy || workspaceStep !== 'crop') return;
    const keyDown = e => {
      if (!acceptEditorShortcut(e) || e.target.closest('button')) return;
      if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) confirmBox(); }
      if (e.key === 'Escape') { e.preventDefault(); cancelBox(); }
    };
    window.addEventListener('keydown', keyDown); return () => window.removeEventListener('keydown', keyDown);
  }, [visible, showScenePreview, draftRect, draftIndex, rects, uniform, busy, workspaceStep]);
  useEffect(() => () => { abort.current?.abort(); }, []);
  useEffect(() => { if (!visible) return; let alive = true; api('/status').then(value => { if (alive) setAiStatus(value); }).catch(() => { if (alive) setAiStatus({}); }); return () => { alive = false; }; }, [visible, showEnhance]);
  useEffect(() => {
    if (!playing || !frames.length) return;
    const sequence = playbackSequence(frames.length, playbackMode); let cursor = Math.max(0, sequence.indexOf(active)), timer;
    const advance = () => { cursor = (cursor + 1) % sequence.length; setActive(sequence[cursor]); timer = setTimeout(advance, frameDuration(frames[sequence[cursor]], fps)); };
    timer = setTimeout(advance, frameDuration(frames[sequence[cursor]], fps)); return () => clearTimeout(timer);
  }, [playing, fps, frames, playbackMode]);
  useEffect(() => {
    if (!sheet || !sourceCanvas.current) return;
    const c = sourceCanvas.current, ctx = c.getContext('2d'); c.width = sheet.width; c.height = sheet.height;
    ctx.drawImage(sheet.image, 0, 0); ctx.lineWidth = Math.max(2, sheet.width / 400);
    rects.forEach((r, i) => { if (i === draftIndex && draftRect) return; ctx.strokeStyle = i === selectedBox ? '#ffcf32' : '#21b9c6'; ctx.fillStyle = i === selectedBox ? '#ffcf321c' : '#21b9c60b'; ctx.fillRect(r.x, r.y, r.width, r.height); ctx.strokeRect(r.x, r.y, r.width, r.height); ctx.fillStyle = '#132a24'; ctx.fillRect(r.x, r.y, 30, 28); ctx.fillStyle = 'white'; ctx.font = '20px sans-serif'; ctx.fillText(String(i + 1), r.x + 7, r.y + 22); });
    if (draftRect) {
      const r = draftRect, handle = Math.max(6, c.width / Math.max(1, c.getBoundingClientRect().width) * 9);
      ctx.strokeStyle = '#ed9224'; ctx.fillStyle = '#ed922421'; ctx.fillRect(r.x, r.y, r.width, r.height); ctx.setLineDash([6, 4]); ctx.strokeRect(r.x, r.y, r.width, r.height); ctx.setLineDash([]); ctx.fillStyle = '#ed9224';
      for (const [x, y] of [[r.x, r.y], [r.x + r.width, r.y], [r.x, r.y + r.height], [r.x + r.width, r.y + r.height]]) ctx.fillRect(x - handle / 2, y - handle / 2, handle, handle);
    }
  }, [sheet, rects, selectedBox, visible, draftRect, draftIndex]);
  useEffect(() => {
    if (!editCanvas.current) return; const c = editCanvas.current; c.width = size.width; c.height = size.height; const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
    if (frame) ctx.drawImage(frame.image, frame.dx, frame.dy);
    if (onion && !playing && onionIndex !== null && frames[onionIndex]) { ctx.globalAlpha = 0.28; const f = frames[onionIndex]; ctx.drawImage(f.image, f.dx, f.dy); ctx.globalAlpha = 1; }
    if (!playing && alignPreview?.active === active && frame) { ctx.globalAlpha = 0.4; ctx.drawImage(frame.image, frame.dx + alignPreview.dx, frame.dy + alignPreview.dy); ctx.globalAlpha = 1; }
    if (guides) {
      ctx.lineWidth = Math.max(1, size.width / 600); ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#ecbb18'; ctx.strokeRect(lines.left, lines.top, lines.right - lines.left, lines.bottom - lines.top);
      ctx.strokeStyle = '#298ee6'; ctx.beginPath(); ctx.moveTo(lines.center, 0); ctx.lineTo(lines.center, size.height); ctx.stroke();
      ctx.strokeStyle = '#eb5562'; ctx.beginPath(); ctx.moveTo(0, lines.bottom); ctx.lineTo(size.width, lines.bottom); ctx.stroke();
    }
    if (selection && !playing) { ctx.setLineDash([3, 3]); ctx.strokeStyle = '#00a79c'; ctx.lineWidth = Math.max(1, size.width / 400); ctx.strokeRect(selection.x, selection.y, selection.width, selection.height); }
  }, [frame, size, onion, playing, onionIndex, active, frames, guides, lines, visible, selection, alignPreview]);
  useEffect(() => {
    if (!record) return; let alive = true;
    (async () => {
      try {
        const saved = record.editorProject, stored = saved?.frames || (record.showCutout && record.cutout.length ? record.cutout : record.original);
        const decoded = await Promise.all(stored.map(async (f, i) => ({ image: await decodeCanvas(f.blob), dx: saved ? (f.dx || 0) : 0, dy: saved ? (f.dy || 0) : 0, duration: f.duration ?? null })));
        const sourceSheet = saved?.sourceSheet ? { ...saved.sourceSheet, image: await decodeCanvas(saved.sourceSheet.blob) } : null;
        if (!alive) return;
        const nextSize = saved?.size || { width: stored[0].width, height: stored[0].height };
        const next = { ...snapshot(), frames: decoded, size: nextSize, draftSize: nextSize,
          lines: saved?.lines || { left: 0, top: 0, right: stored[0].width, bottom: stored[0].height, center: stored[0].width / 2 },
          sheet: sourceSheet, rects: [], draftRect: null, draftIndex: null, reference: saved?.reference ?? 'previous', onion: saved?.onion ?? true,
          active: 0, name: record.name, fps: record.fps, playbackMode: saved?.playbackMode || 'forward', selection: saved?.selection || null,
          patchReference: saved?.patchReference ?? 'previous', patchOffset: saved?.patchOffset || { x: 0, y: 0 }, alignRadius: saved?.alignRadius ?? 16,
          alignPreview: null, interpolatePreview: null, interpolateFrom: 0, checkReport: '', ...saved?.cropSettings, ...saved?.editorSettings };
        checkpoint(); restore(next); setWorkspaceStep(!next.frames.length ? 'crop' : ['brush', 'erase'].includes(next.tool) ? 'repair' : 'align');
        if (saved) draftGuard.markSaved(draftValue('sheet', next));
        setMessage('已恢复素材，可继续对齐和修整。');
      } catch (e) { setMessage(e.message); }
    })(); return () => { alive = false; };
  }, [record]);
  function snapshot() { return { sheet, rects, selectedBox, uniform, draftRect, draftIndex, columns, rows, padding, autoBackground, frames, size, draftSize, active, fps, zoom, sourceCollapsed, anchorMode, tool, onion, reference, guides, lines, brush, paint, keyColor, tolerance, name, enhanceMode, enhanceScale, playbackMode, selection, patchReference, patchOffset, alignRadius, alignPreview, colorReference, colorScope, interpolateFrom, interpolateCount, interpolateMode, interpolatePreview, checkReport }; }
  function restore(value) { setColorFeedback(''); setColorReference(value.colorReference ?? 0); setColorScope(value.colorScope ?? 'all'); setAlignmentFeedback(null); setSheet(value.sheet); setRects(value.rects); setSelectedBox(value.selectedBox); setUniform(value.uniform); setDraftRect(value.draftRect); setDraftIndex(value.draftIndex); setColumns(value.columns); setRows(value.rows); setPadding(value.padding); setAutoBackground(value.autoBackground); setFrames(value.frames); setSize(value.size); setDraftSize(value.draftSize); setActive(value.active); setFps(value.fps); setZoom(value.zoom); setSourceCollapsed(value.sourceCollapsed); setAnchorMode(value.anchorMode); setTool(value.tool); setOnion(value.onion); setReference(value.reference); setGuides(value.guides); setLines(value.lines); setBrush(value.brush); setPaint(value.paint); setKeyColor(value.keyColor); setTolerance(value.tolerance); setName(value.name); setEnhanceMode(value.enhanceMode); setEnhanceScale(value.enhanceScale); setPlaybackMode(value.playbackMode || 'forward'); setSelection(value.selection || null); setPatchReference(value.patchReference ?? 'previous'); setPatchOffset(value.patchOffset || { x: 0, y: 0 }); setAlignRadius(value.alignRadius ?? 16); setAlignPreview(value.alignPreview || null); setInterpolateFrom(value.interpolateFrom || 0); setInterpolateCount(value.interpolateCount || 3); setInterpolateMode(value.interpolateMode || 'translation'); setInterpolatePreview(value.interpolatePreview || null); setCheckReport(value.checkReport || ''); setPlaying(false); gesture.current = null; }
  function checkpoint() { setColorFeedback(''); setAlignmentFeedback(null); const current = snapshot(); setPlaying(false); setAlignPreview(null); setInterpolatePreview(null); setHistory(h => remember(h, current)); }
  function change(setter, value) { checkpoint(); setter(value); }
  function stepHistory(direction) {
    if (busy || gesture.current) return;
    const result = travel(history, snapshot(), direction); if (!result) return;
    setHistory(result.history); restore(result.snapshot);
    if (['align', 'repair'].includes(workspaceStep)) {
      if (['brush', 'erase'].includes(result.snapshot.tool)) setWorkspaceStep('repair');
      else if (['anchor', 'guides'].includes(result.snapshot.tool)) setWorkspaceStep('align');
    }
    setMessage(`${direction === 'undo' ? '已撤销' : '已重做'}上一步，当前 ${result.snapshot.size.width} × ${result.snapshot.size.height} px。`);
  }
  function undo() { stepHistory('undo'); }
  function redo() { stepHistory('redo'); }
  useEffect(() => {
    if (!visible || busy || showScenePreview) return;
    const onKey = e => {
      if (!(e.ctrlKey || e.metaKey) || !acceptEditorShortcut(e)) return;
      if (e.key.toLowerCase() === 'z') { e.preventDefault(); stepHistory(e.shiftKey ? 'redo' : 'undo'); }
      else if (e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });
  async function run(action) { setBusy(true); setPlaying(false); setMessage('正在处理…'); abort.current = new AbortController(); try { await action(abort.current.signal); } catch (e) { setMessage(e.message); } finally { setBusy(false); } }
  async function upload(file) {
    if (!file) return; await run(async () => {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 30 * 1024 * 1024) throw new Error('请选择不超过 30 MB 的 PNG、JPG 或 WEBP');
      const bitmap = await createImageBitmap(file); if (bitmap.width * bitmap.height > 32_000_000) { bitmap.close(); throw new Error('源图超过 3200 万像素，请先缩小'); }
      const image = makeCanvas(bitmap.width, bitmap.height); image.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close();
      rememberPngSource(image, file);
      setWorkspaceStep('crop'); checkpoint(); setSheet({ image, width: image.width, height: image.height }); setRects([]); setDraftRect(null); setDraftIndex(null); setSelectedBox(0); setSourceCollapsed(false); setMessage('拖出矩形后可移动、拉角调整；按空格确认。也可生成 12 / 24 帧网格，再自动校准角色边界。');
    });
  }
  function point(e, c) { const b = c.getBoundingClientRect(); return { x: Math.round((e.clientX - b.left) * c.width / b.width), y: Math.round((e.clientY - b.top) * c.height / b.height) }; }
  function cancelBox() { checkpoint(); gesture.current = null; setDraftRect(null); setDraftIndex(null); setMessage('已取消待确认框，原来的裁剪框未改变。'); }
  function confirmBox() {
    if (!draftRect || busy) return;
    try {
      const confirmed = confirmRect(rects, draftRect, draftIndex, uniform, sheet.width, sheet.height); checkpoint(); setRects(confirmed); setSelectedBox(draftIndex === null ? rects.length : draftIndex);
      gesture.current = null; setDraftRect(null); setDraftIndex(null); setMessage('此框已确认。现在才可以绘制下一帧；最终裁帧仍需点击「裁剪并进入校准」。');
    } catch (e) { setMessage(e.message); }
  }
  function cropStart(e) {
    if (busy) return; e.currentTarget.focus(); const p = point(e, e.currentTarget);
    const before = snapshot(); let r = draftRect;
    if (!r) {
      const hit = rects.findIndex(r => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height);
      if (hit >= 0) { r = rects[hit]; setSelectedBox(hit); setDraftRect(r); setDraftIndex(hit); }
    }
    if (r) {
      const near = 12 * e.currentTarget.width / e.currentTarget.getBoundingClientRect().width;
      const corner = [[r.x, r.y], [r.x + r.width, r.y], [r.x, r.y + r.height], [r.x + r.width, r.y + r.height]].findIndex(([x, y]) => Math.abs(p.x - x) <= near && Math.abs(p.y - y) <= near);
      const inside = p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
      if (corner < 0 && !inside) { setMessage('当前框还未确认，请先按空格 / 点击确认，或按 Esc 取消；不会新增下一帧。'); return; }
      gesture.current = { mode: corner >= 0 ? 'resize' : 'moveBox', start: p, rect: r, corner };
    } else { if (rects.length >= 36) { setMessage('最多支持 36 个裁剪框'); return; } setDraftIndex(null); gesture.current = { mode: 'draw', start: p }; }
    setHistory(h => remember(h, before)); e.currentTarget.setPointerCapture(e.pointerId);
  }
  function cropMove(e) {
    const g = gesture.current; if (!g || !sheet || busy) return; const p = point(e, e.currentTarget);
    if (g.mode === 'moveBox') { setDraftRect(clampRect({ ...g.rect, x: g.rect.x + p.x - g.start.x, y: g.rect.y + p.y - g.start.y }, sheet.width, sheet.height, true)); return; }
    if (g.mode === 'resize') {
      const opposite = [[g.rect.x + g.rect.width, g.rect.y + g.rect.height], [g.rect.x, g.rect.y + g.rect.height], [g.rect.x + g.rect.width, g.rect.y], [g.rect.x, g.rect.y]][g.corner];
      setDraftRect(clampRect({ x: Math.min(p.x, opposite[0]), y: Math.min(p.y, opposite[1]), width: Math.abs(p.x - opposite[0]), height: Math.abs(p.y - opposite[1]) }, sheet.width, sheet.height, true)); return;
    }
    const base = uniform && rects.length ? rects[0] : { width: Math.abs(p.x - g.start.x), height: Math.abs(p.y - g.start.y) };
    setDraftRect(clampRect({ x: Math.min(p.x, g.start.x), y: Math.min(p.y, g.start.y), width: base.width, height: base.height }, sheet.width, sheet.height, true));
  }
  function cropEnd(e) {
    const g = gesture.current; if (!g || !sheet) return; const p = point(e, e.currentTarget);
    if (g.mode !== 'draw' || Math.abs(p.x - g.start.x) >= 3 && Math.abs(p.y - g.start.y) >= 3) cropMove(e);
    else { setDraftRect(null); setDraftIndex(null); }
    gesture.current = null; setMessage('矩形已停留在原位。拖动内部移动，拖动四角调整大小；按空格确认，Esc 取消。');
  }
  function changeRect(key, value) { const r = draftRect || rects[selectedBox]; if (!r) return; checkpoint(); if (!draftRect) setDraftIndex(selectedBox); setDraftRect(clampRect({ ...r, [key]: value }, sheet.width, sheet.height, true)); }
  function makeGrid(cols = columns, rowCount = rows) {
    if (draftRect) { setMessage('请先确认或取消当前框'); return; }
    try { const boxes = gridRects(sheet.width, sheet.height, cols, rowCount); checkpoint(); setRects(boxes); setColumns(cols); setRows(rowCount); setSelectedBox(0); setMessage(`已生成 ${cols * rowCount} 个网格框；点击「自动校准裁框」可包含完整角色，仍不会自动裁出图片。`); } catch (e) { setMessage(e.message); }
  }
  async function autoBoxes() {
    if (draftRect) { setMessage('请先确认或取消当前框'); return; }
    await run(async () => {
      // Yield to display the busy state before scanning the full sheet.
      await new Promise(resolve => requestAnimationFrame(resolve));
      const proposed = rects.length ? rects : gridRects(sheet.width, sheet.height, columns, rows);
      const data = sheet.image.getContext('2d').getImageData(0, 0, sheet.width, sheet.height).data;
      const background = autoBackground ? detectSheetBackground(data, sheet.width, sheet.height) : keyColor.match(/\w\w/g).map(v => parseInt(v, 16));
      const { bounds, shared } = detectSubjectBounds(data, sheet.width, sheet.height, proposed, background, tolerance);
      if (!bounds.some(Boolean)) throw new Error('没有识别到角色，请调整底色 / 容差，或手动拖框');
      const boxes = subjectRects(bounds, proposed, sheet.width, sheet.height, padding, uniform); checkpoint(); setRects(boxes); setSelectedBox(0);
      const missing = bounds.filter(b => !b).length;
      setMessage(`已按完整轮廓校准 ${bounds.length - missing} 框，预留 ${padding} px 边距。${missing ? ` ${missing} 框未识别到角色，保留原框。` : ''}${shared ? ' 有角色跨越多个框，请逐框检查归属。' : ''} 请检查后再裁剪。`);
    });
  }
  function crop() {
    if (draftRect) { setMessage('请先按空格确认当前框，再裁剪序列'); return; }
    try {
      const nextSize = { width: Math.max(...rects.map(r => r.width)), height: Math.max(...rects.map(r => r.height)) }; validCanvas(nextSize.width, nextSize.height, rects.length); checkpoint();
      setFrames(rects.map(r => { const c = makeCanvas(nextSize.width, nextSize.height); c.getContext('2d').drawImage(sheet.image, r.x, r.y, r.width, r.height, Math.floor((nextSize.width - r.width) / 2), Math.floor((nextSize.height - r.height) / 2), r.width, r.height); return { image: c, dx: 0, dy: 0 }; }));
      setSize(nextSize); setDraftSize(nextSize); setLines({ left: 0, top: 0, right: nextSize.width, bottom: nextSize.height, center: Math.round(nextSize.width / 2) }); setActive(0); setReference('previous'); setSourceCollapsed(true); setWorkspaceStep('align'); setSelection(null); setAlignPreview(null); setInterpolatePreview(null); setInterpolateFrom(0); setCheckReport(''); setMessage(`已裁出 ${rects.length} 帧，统一为 ${nextSize.width} × ${nextSize.height}，未放大角色。`);
    } catch (e) { setMessage(e.message); }
  }
  function move(dx, dy) { setFrames(fs => fs.map((f, i) => i === active ? { ...f, dx, dy } : f)); }
  function editStart(e) {
    if (!['align', 'repair'].includes(workspaceStep)) return;
    if (!frame || busy || playing) return;
    const p = point(e, e.currentTarget);
    if (tool === 'select') { checkpoint(); gesture.current = { mode: 'selection', start: p }; setSelection(regionRect(p, p, size.width, size.height)); e.currentTarget.setPointerCapture(e.pointerId); return; }
    if (tool === 'guides') {
      if (!guides) { setMessage('请先开启共享参考线'); return; }
      const hit = guideHit(p, lines, 10 * size.width / e.currentTarget.getBoundingClientRect().width);
      if (!hit) { setMessage('拖动黄框边缘、蓝色中心线或红色基线；黄框内部可以整体移动。'); return; }
      checkpoint(); gesture.current = { mode: 'guide', hit, start: p, lines }; e.currentTarget.setPointerCapture(e.pointerId); return;
    }
    e.currentTarget.setPointerCapture(e.pointerId); checkpoint();
    if (tool === 'anchor') { const shift = anchorShift(p, { x: lines.center, y: anchorMode === 'center' ? Math.round(size.height / 2) : lines.bottom }); move(frame.dx + shift.dx, frame.dy + shift.dy); setMessage('锚点已对齐到共享落点。请逐帧点击同一个身体部位。'); return; }
    if (tool === 'move') gesture.current = { start: p, dx: frame.dx, dy: frame.dy };
    else { const c = renderFrame(frame, size); gesture.current = { canvas: c, last: p }; paintStroke(p); }
  }
  function paintStroke(p) { const g = gesture.current, ctx = g.canvas.getContext('2d'); ctx.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over'; ctx.strokeStyle = paint; ctx.lineWidth = brush; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(g.last.x, g.last.y); ctx.lineTo(p.x + 0.01, p.y); ctx.stroke(); g.last = p; setFrames(fs => fs.map((f, i) => i === active ? { ...f, image: g.canvas, dx: 0, dy: 0 } : f)); }
  function editMove(e) { const g = gesture.current; if (!g) return; const p = point(e, e.currentTarget); if (g.mode === 'selection') setSelection(regionRect(g.start, p, size.width, size.height)); else if (g.mode === 'guide') setLines(dragGuide(g.lines, g.hit, p.x - g.start.x, p.y - g.start.y, size)); else if (g.canvas) paintStroke(p); else move(g.dx + p.x - g.start.x, g.dy + p.y - g.start.y); }
  function resizeCanvas(trim = false) {
    try {
      const next = trim ? { width: lines.right - lines.left, height: lines.bottom - lines.top } : draftSize; validCanvas(next.width, next.height, frames.length);
      if (trim && (lines.left < 0 || lines.top < 0 || lines.right > size.width || lines.bottom > size.height)) throw new Error('裁剪参考区域必须位于画布内');
      const dx = trim ? -lines.left : Math.floor((next.width - size.width) / 2), dy = trim ? -lines.top : Math.floor((next.height - size.height) / 2); checkpoint();
      setFrames(frames.map(f => ({ ...f, dx: f.dx + dx, dy: f.dy + dy }))); setSize(next); setDraftSize(next); setSelection(null); setLines({ left: 0, top: 0, right: next.width, bottom: next.height, center: lines.center + dx }); setMessage(trim ? '所有帧已使用同一参考区域裁剪，可撤销。' : '统一画布已调整，角色尺寸保持不变。');
    } catch (e) { setMessage(e.message); }
  }
  function autoAlign(mode = 'bottom') {
    try {
      const outlines = frames.map(f => {
        const b = alphaBounds(f.image.getContext('2d').getImageData(0, 0, f.image.width, f.image.height).data, f.image.width, f.image.height);
        if (!b) throw new Error('存在空白帧，请先修整');
        if (b.left === 0 && b.top === 0 && b.right === f.image.width && b.bottom === f.image.height) throw new Error('轮廓占满画布，请先抠图，或用手动锚点对齐'); return b;
      });
      const shifts = outlines.map(b => anchorShift({ x: (b.left + b.right) / 2, y: mode === 'center' ? (b.top + b.bottom) / 2 : b.bottom }, { x: lines.center, y: mode === 'center' ? Math.round(size.height / 2) : lines.bottom }));
      const extent = containAlignedBounds(size, outlines.map((b, i) => ({ left: b.left + shifts[i].dx, right: b.right + shifts[i].dx, top: b.top + shifts[i].dy, bottom: b.bottom + shifts[i].dy })), padding);
      validCanvas(extent.width, extent.height, frames.length); checkpoint();
      setFrames(frames.map((f, i) => ({ ...f, dx: shifts[i].dx + extent.dx, dy: shifts[i].dy + extent.dy })));
      const nextSize = { width: extent.width, height: extent.height }; setSize(nextSize); setDraftSize(nextSize);
      setSelection(null);
      setLines({ left: 0, top: 0, right: extent.width, bottom: lines.bottom + extent.dy, center: lines.center + extent.dx });
      setMessage(`所有帧已对齐，完整轮廓保留 ${padding} px 安全边距。${extent.width !== size.width || extent.height !== size.height ? ` 为防止突出裁切，统一画布扩展到 ${extent.width} × ${extent.height}，角色未缩放。` : ''} 建议用锚点复核姿势差异。`);
    } catch (e) { setMessage(e.message); }
  }
  async function outputFrames() { let time = 0; return Promise.all(frames.map(async f => { const start = time; time += frameDuration(f, fps) / 1000; return { blob: await canvasBlob(renderFrame(f, size)), width: size.width, height: size.height, time: start, duration: frameDuration(f, fps) }; })); }
  function framePixels(f) { const c = renderFrame(f, size); return c.getContext('2d').getImageData(0, 0, c.width, c.height).data; }
  function editTimeline(action) {
    if (!frames.length || busy) return;
    if (action === 'delete' && frames.length === 1) { setMessage('至少保留一帧'); return; }
    if (action === 'copy' && frames.length >= 72) { setMessage('当前工作台最多编辑 72 帧'); return; }
    if (action === 'previous' && active === 0 || action === 'next' && active === frames.length - 1) return;
    try {
      validCanvas(size.width, size.height, frames.length + (action === 'copy' ? 1 : 0)); checkpoint();
      if (action === 'copy') { const next = [...frames]; next.splice(active + 1, 0, { ...frame }); setFrames(next); setActive(active + 1); }
      if (action === 'delete') { setFrames(frames.filter((_, i) => i !== active)); setActive(Math.min(active, frames.length - 2)); }
      if (action === 'previous' || action === 'next') { const destination = active + (action === 'previous' ? -1 : 1); setFrames(reorderFrame(frames, active, destination)); setActive(destination); }
      setInterpolateFrom(0); setMessage('时间轴已更新，可撤销；每帧时长随帧一起移动。');
    } catch (e) { setMessage(e.message); }
  }
  function localReferenceIndex() { return referenceIndex(patchReference, active, frames.length); }
  function previewAlignment() {
    setAlignPreview(null);
    try {
      const index = localReferenceIndex(); if (index === null) throw new Error('请选择另一帧作为参考'); if (!selection) throw new Error('先用「框选局部」在画布上框住稳定部位');
      const result = matchTranslation(framePixels(frames[index]), framePixels(frame), size.width, size.height, selection, alignRadius);
      setPlaying(false); setAlignPreview({ ...result, active, reference: index });
      const text = `仅预览，尚未应用：第 ${active + 1} 帧参照第 ${index + 1} 帧，建议平移 X ${result.dx} / Y ${result.dy} px。${result.dx === 0 && result.dy === 0 ? '当前已在建议位置，无需移动。' : '检查半透明叠图后，点击「确认对齐」才会移动整帧。'}`;
      setAlignmentFeedback({ active, text }); setMessage(text);
    } catch (e) { setAlignmentFeedback({ active, error: true, text: `未生成对齐建议：${e.message}` }); setMessage(e.message); }
  }
  function applyAlignment() {
    if (!alignPreview || alignPreview.active !== active) return;
    if (alignPreview.dx === 0 && alignPreview.dy === 0) {
      const text = `已检查：第 ${active + 1} 帧无需移动（X 0 / Y 0 px），未修改帧。`;
      setAlignPreview(null); setAlignmentFeedback({ active, text }); setMessage(text); return;
    }
    try {
      const shifted = frames.map((f, i) => ({ ...f, dx: f.dx + (i === active ? alignPreview.dx : 0), dy: f.dy + (i === active ? alignPreview.dy : 0) }));
      const bounds = shifted.map(f => { const b = alphaBounds(f.image.getContext('2d').getImageData(0, 0, f.image.width, f.image.height).data, f.image.width, f.image.height); return b && { left: b.left + f.dx, top: b.top + f.dy, right: b.right + f.dx, bottom: b.bottom + f.dy }; }).filter(Boolean);
      const extent = bounds.length ? containAlignedBounds(size, bounds, 0) : { ...size, dx: 0, dy: 0 }; validCanvas(extent.width, extent.height, frames.length);
      checkpoint(); setFrames(shifted.map(f => ({ ...f, dx: f.dx + extent.dx, dy: f.dy + extent.dy }))); setSize({ width: extent.width, height: extent.height }); setDraftSize({ width: extent.width, height: extent.height });
      setLines({ left: lines.left + extent.dx, right: lines.right + extent.dx, top: lines.top + extent.dy, bottom: lines.bottom + extent.dy, center: lines.center + extent.dx });
      setSelection({ ...selection, x: selection.x + extent.dx, y: selection.y + extent.dy });
      const text = `已应用：第 ${active + 1} 帧参照第 ${alignPreview.reference + 1} 帧，整帧平移 X ${alignPreview.dx} / Y ${alignPreview.dy} px。完整轮廓保留，可撤销。`;
      setAlignmentFeedback({ active, text }); setMessage(text);
    } catch (e) { setAlignmentFeedback({ active, error: true, text: `对齐未应用：${e.message}` }); setMessage(e.message); }
  }
  function copyPatch() {
    try {
      const index = localReferenceIndex(); if (index === null) throw new Error('请选择另一帧作为参考'); if (!selection) throw new Error('先用「框选局部」框住要复制的区域');
      const x = selection.x + patchOffset.x, y = selection.y + patchOffset.y;
      if (x < 0 || y < 0 || x + selection.width > size.width || y + selection.height > size.height) throw new Error('粘贴区域超出画布，请调整偏移或扩展画布');
      const source = renderFrame(frames[index], size), target = renderFrame(frame, size), ctx = target.getContext('2d'); ctx.imageSmoothingEnabled = false;
      ctx.clearRect(x, y, selection.width, selection.height); ctx.drawImage(source, selection.x, selection.y, selection.width, selection.height, x, y, selection.width, selection.height);
      checkpoint(); setFrames(frames.map((f, i) => i === active ? { ...f, image: target, dx: 0, dy: 0 } : f)); setMessage(`已把第 ${index + 1} 帧的选区复制到当前帧，透明部分也会替换；可撤销。`);
    } catch (e) { setMessage(e.message); }
  }
  async function uploadPair(files) {
    if (files.length !== 2) { setMessage('请选择两张图片，文件选择顺序就是起始帧与结束帧'); return; }
    await run(async () => {
      if ([...files].some(f => f.size > 30 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(f.type))) throw new Error('请选择不超过 30 MB 的 PNG / JPG / WEBP');
      const decoded = await Promise.all([...files].map(async file => { const bitmap = await createImageBitmap(file); try { validCanvas(bitmap.width, bitmap.height, 2); const c = makeCanvas(bitmap.width, bitmap.height); c.getContext('2d').drawImage(bitmap, 0, 0); return c; } finally { bitmap.close(); } })), next = { width: Math.max(...decoded.map(c => c.width)), height: Math.max(...decoded.map(c => c.height)) }; validCanvas(next.width, next.height, 2); checkpoint();
      setFrames(decoded.map(image => ({ image, dx: Math.floor((next.width - image.width) / 2), dy: Math.floor((next.height - image.height) / 2), duration: null }))); setSize(next); setDraftSize(next); setActive(0); setSheet(null); setRects([]); setSelection(null); setInterpolateFrom(0); setWorkspaceStep('align');
      setLines({ left: 0, top: 0, right: next.width, bottom: next.height, center: Math.round(next.width / 2) }); setMessage('已载入两张关键帧，先检查位置，再预览补帧。原有动画可撤销恢复。');
    });
  }
  async function unifyColors(mode = 'reference') { await run(async signal => {
    if (!selection) throw new Error('先在画布上框选要统一颜色的区域');
    const sequential = mode === 'sequence';
    const index = sequential ? 0 : Math.min(colorReference, frames.length - 1);
    if (!frames[index]) throw new Error('请选择颜色参考帧');
    const referencePixels = framePixels(frames[index]), next = [...frames];
    let changedFrames = 0, changedPixels = 0, skippedPixels = 0;
    for (let i = 0; i < frames.length; i++) {
      if (sequential ? i === 0 : i === index || colorScope === 'current' && i !== active) continue;
      signal?.throwIfAborted();
      const result = unifyRegionColors(sequential ? framePixels(next[i - 1]) : referencePixels, framePixels(frames[i]), size.width, size.height, selection);
      skippedPixels += result.skipped;
      if (result.changed) {
        const patch = makeCanvas(size.width, size.height), patchContext = patch.getContext('2d');
        const pixels = patchContext.createImageData(size.width, size.height); pixels.data.set(result.data); patchContext.putImageData(pixels, 0, 0);
        const f = frames[i], image = makeCanvas(f.image.width, f.image.height), ctx = image.getContext('2d');
        ctx.drawImage(f.image, 0, 0); ctx.save();
        ctx.beginPath(); ctx.rect(selection.x - f.dx, selection.y - f.dy, selection.width, selection.height); ctx.clip();
        ctx.clearRect(0, 0, image.width, image.height); ctx.drawImage(patch, -f.dx, -f.dy); ctx.restore();
        next[i] = { ...f, image }; changedFrames++; changedPixels += result.changed;
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    signal?.throwIfAborted();
    if (changedPixels) { checkpoint(); setFrames(next); }
    const action = sequential ? '已按序列统一' : `已参照第 ${index + 1} 帧统一`;
    const preserved = sequential ? '第 1 帧' : '参考帧';
    const text = changedPixels ? `${action} ${changedFrames} 帧、${changedPixels} 个像素；${skippedPixels} 个不同色系或匹配不稳定的像素保留。${preserved}、透明度与选区外像素保留，可撤销。` : `未修改：没有需要统一的同色系像素。${skippedPixels} 个不同色系或匹配不稳定的像素保留；请检查参考帧、选区和处理范围。`;
    setColorFeedback(text); setMessage(text);
  }); }
  async function previewInterpolation() { await run(async signal => {
    const from = Math.min(interpolateFrom, frames.length - 2), to = from + 1; if (from < 0) throw new Error('需要至少两帧');
    if (frames.length + interpolateCount > 72) throw new Error('补帧后不能超过 72 帧'); validCanvas(size.width, size.height, frames.length + interpolateCount);
    let inserted;
    if (interpolateMode === 'rife') {
      if (!aiStatus?.interpolationAvailable) throw new Error('本地 RIFE 尚未安装，请使用平移模式或在首页查看安装状态');
      const { processLocalImages } = await import('./lib/local-ai.mjs'); const pair = await Promise.all([frames[from], frames[to]].map(async f => ({ blob: await canvasBlob(renderFrame(f, size)), ...size, time: 0 })));
      const result = await processLocalImages(pair, 'interpolate', { count: interpolateCount }, signal); inserted = await Promise.all(result.map(async f => ({ image: await decodeCanvas(f.blob), dx: 0, dy: 0, duration: null })));
      if (inserted.length !== interpolateCount || inserted.some(f => f.image.width !== size.width || f.image.height !== size.height)) throw new Error('补帧结果尺寸或数量不完整');
    } else {
      const a = framePixels(frames[from]), b = framePixels(frames[to]), ba = alphaBounds(a, size.width, size.height), bb = alphaBounds(b, size.width, size.height);
      if (!ba || !bb) throw new Error('关键帧不能是空白帧');
      const dx = (bb.left + bb.right - ba.left - ba.right) / 2, dy = bb.bottom - ba.bottom, base = renderFrame(frames[from], size);
      inserted = translationSteps(dx, dy, interpolateCount).map(step => ({ image: base, dx: step.dx, dy: step.dy, duration: null }));
    }
    const bounds = [...frames, ...inserted].map(f => { const b = alphaBounds(f.image.getContext('2d').getImageData(0, 0, f.image.width, f.image.height).data, f.image.width, f.image.height); return b && { left: b.left + f.dx, right: b.right + f.dx, top: b.top + f.dy, bottom: b.bottom + f.dy }; }).filter(Boolean);
    const extent = bounds.length ? containAlignedBounds(size, bounds, 0) : { ...size, dx: 0, dy: 0 }; validCanvas(extent.width, extent.height, frames.length + inserted.length);
    const urls = inserted.map(f => renderFrame({ ...f, dx: f.dx + extent.dx, dy: f.dy + extent.dy }, extent).toDataURL());
    setInterpolatePreview({ from, frames: inserted, extent, urls }); setMessage(`已预览 ${inserted.length} 张中间帧；${interpolateMode === 'translation' ? '这是起始图的平移动画，不推测肢体姿势；结束帧仍保留原图。' : '确认结果后再插入时间轴。'}`);
  }); }
  function insertInterpolation() {
    if (!interpolatePreview) return; const next = [...frames], index = interpolatePreview.from, extent = interpolatePreview.extent; next.splice(index + 1, 0, ...interpolatePreview.frames); checkpoint();
    setFrames(next.map(f => ({ ...f, dx: f.dx + extent.dx, dy: f.dy + extent.dy }))); setSize({ width: extent.width, height: extent.height }); setDraftSize({ width: extent.width, height: extent.height }); setSelection(null);
    setLines({ left: lines.left + extent.dx, right: lines.right + extent.dx, top: lines.top + extent.dy, bottom: lines.bottom + extent.dy, center: lines.center + extent.dx });
    setActive(index + 1); setMessage('中间帧已插入，原来的两帧保留；完整轮廓不会被裁切，可撤销。');
  }
  function inspectAnimation(loop = false) {
    if (!frames.length) return;
    const baked = frames.map(f => ({ data: framePixels(f), ...size })), issues = inspectFrames(baked, size);
    frames.forEach((f, i) => { const b = alphaBounds(f.image.getContext('2d').getImageData(0, 0, f.image.width, f.image.height).data, f.image.width, f.image.height); if (b && (b.left + f.dx < 0 || b.top + f.dy < 0 || b.right + f.dx > size.width || b.bottom + f.dy > size.height)) issues.push(`第 ${i + 1} 帧有像素越过画布，导出会裁切`); });
    if (loop && frames.length > 1) { const diff = comparePixels(baked.at(-1).data, baked[0].data); checkpoint(); setActive(frames.length - 1); setReference(0); setOnion(true); setCheckReport(`首尾可见像素差异：${(diff.changedRatio * 100).toFixed(1)}%。\n差异仅供检查，不代表必须相同；当前画布叠加第 1 帧。\n${issues.join('\n') || '规格检查通过。'}`); }
    else setCheckReport(issues.length ? issues.join('\n') : `${frames.length} 帧规格检查通过：尺寸一致、无空白、无重复、轮廓未触边。`);
  }
  async function exportAnimation(format) { await run(async () => {
    const { zip, strToU8 } = await import('fflate'), files = {}, output = await outputFrames();
    let manifest = { version: 1, fps, playbackMode, sourceSize: size, anchor: { x: lines.center, y: lines.bottom }, frames: output.map((f, i) => ({ file: `frame-${String(i + 1).padStart(3, '0')}.png`, duration: f.duration, time: f.time, sourceSize: size })) };
    if (format === 'atlas') {
      const baked = frames.map(f => renderFrame(f, size)), bounds = baked.map(c => alphaBounds(c.getContext('2d').getImageData(0, 0, c.width, c.height).data, c.width, c.height));
      const layout = atlasLayout(bounds, size, manifest.anchor, output.map(f => f.duration)); validCanvas(layout.width, layout.height); const c = makeCanvas(layout.width, layout.height), ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
      layout.frames.forEach((entry, i) => { const b = bounds[i]; if (b) ctx.drawImage(baked[i], b.left, b.top, entry.frame.w, entry.frame.h, entry.frame.x, entry.frame.y, entry.frame.w, entry.frame.h); });
      files['atlas.png'] = [new Uint8Array(await (await canvasBlob(c)).arrayBuffer()), { level: 0 }]; manifest = { ...manifest, frames: layout.frames, meta: { image: 'atlas.png', size: { w: layout.width, h: layout.height }, scale: '1' } };
    } else if (format === 'frames') { for (const [i, f] of output.entries()) files[manifest.frames[i].file] = [new Uint8Array(await f.blob.arrayBuffer()), { level: 0 }]; }
    else { downloadBlob(await exportArchive(output, fps, 'sheet'), 'sprite-sheet.zip'); setMessage('已导出等格精灵图；独立帧时长与锚点请使用游戏图集导出。'); return; }
    files['frames.json'] = strToU8(JSON.stringify(manifest, null, 2)); const archive = await new Promise((resolve, reject) => zip(files, (error, bytes) => error ? reject(error) : resolve(new Blob([bytes], { type: 'application/zip' }))));
    downloadBlob(archive, `sprite-${format}.zip`); setMessage(format === 'atlas' ? '已导出裁边图集 PNG + JSON，含原尺寸、裁剪偏移、锚点和帧时长；未包含辅助线。' : '已导出 PNG 图片集 + 独立时长数据。');
  }); }
  async function enhance() { await run(async signal => {
    if (enhanceMode === 'ai') {
      validCanvas(size.width * enhanceScale, size.height * enhanceScale, frames.length);
      if (!aiStatus?.enhancementAvailable) throw new Error('本地高清模型尚未安装，请在首页查看安装状态');
      const { processLocalImages } = await import('./lib/local-ai.mjs');
      const result = await processLocalImages(await outputFrames(), 'upscale', { scale: enhanceScale }, signal), decoded = await Promise.all(result.map(async (f, i) => ({ ...frames[i], image: await decodeCanvas(f.blob), dx: 0, dy: 0 })));
      if (decoded.length !== frames.length || decoded.some(f => f.image.width !== size.width * enhanceScale || f.image.height !== size.height * enhanceScale)) throw new Error('高清结果尺寸或数量不一致');
      const next = validCanvas(size.width * enhanceScale, size.height * enhanceScale, frames.length); checkpoint(); setFrames(decoded); setSize(next); setDraftSize(next); setLines(Object.fromEntries(Object.entries(lines).map(([k, v]) => [k, v * enhanceScale]))); setSelection(null); setShowEnhance(false); setMessage('已使用本地 AI 高清模型处理全帧，可撤销。'); return;
    }
    const nextSize = validCanvas(size.width * enhanceScale, size.height * enhanceScale, frames.length), nextFrames = [];
    for (const f of frames) {
      if (signal.aborted) throw new Error('处理已取消');
      const c = renderFrame(f, size), pixels = c.getContext('2d').getImageData(0, 0, size.width, size.height);
      const result = enhancePixels(pixels.data, size.width, size.height, enhanceScale, enhanceMode === 'sharpen');
      const output = makeCanvas(result.width, result.height);
      output.getContext('2d').putImageData(new ImageData(result.data, result.width, result.height), 0, 0);
      nextFrames.push({ ...f, image: output, dx: 0, dy: 0 });
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    checkpoint(); setFrames(nextFrames); setSize(nextSize); setDraftSize(nextSize);
    setLines(Object.fromEntries(Object.entries(lines).map(([key, value]) => [key, value * enhanceScale])));
    setSelection(null);
    setShowEnhance(false);
    setMessage(`已${enhanceMode === 'sharpen' ? '轻度锐化并' : ''}处理 ${frames.length} 帧，实际尺寸 ${nextSize.width} × ${nextSize.height} px；透明背景保留，可撤销。`);
  }); }
  async function cutout(mode) { await run(async signal => {
    const inputFrames = await outputFrames(); let result;
    try { result = mode === 'ai' ? await removeAiBackground(inputFrames, signal) : await applyChroma(inputFrames, keyColor, tolerance, () => {}, signal);
      const decoded = await Promise.all(result.map(async (f, i) => ({ ...frames[i], image: await decodeCanvas(f.blob), dx: 0, dy: 0 }))); checkpoint(); setFrames(decoded); setMessage(`已处理 ${frames.length} 帧背景，可继续手动擦除。`);
    } finally { if (result) disposeFrames(result); }
  }); }
  async function save() { await run(async () => {
    const savingDraft = draftValue('sheet', snapshot());
    const original = await outputFrames(); const editable = await Promise.all(frames.map(async f => ({ blob: await imagePng(f.image, canvasBlob), dx: f.dx, dy: f.dy, duration: f.duration ?? null })));
    const sourceSheet = sheet ? { blob: await imagePng(sheet.image, canvasBlob), width: sheet.width, height: sheet.height } : null;
    const cropSettings = { rects, selectedBox, uniform, draftRect, draftIndex, columns, rows, padding, autoBackground };
    const editorSettings = { draftSize, active, zoom, sourceCollapsed, anchorMode, tool, guides, brush, paint, keyColor, tolerance, enhanceMode, enhanceScale, interpolateFrom, interpolateCount, interpolateMode };
    await saveAsset({ name, original, fps, showCutout: false, kind: 'sheet', editorProject: { version: 1, frames: editable, size, lines, reference, onion, playbackMode, selection, patchReference, patchOffset, alignRadius, sourceSheet, cropSettings, editorSettings } }); draftGuard.markSaved(savingDraft); setMessage('已保存到素材库，重新打开可继续校准。');
  }); }
  async function sendTo(workbench) { await run(async () => {
    const original = await outputFrames(); await onSendTo?.(workbench, { name, fps, kind: 'sheet', original, cutout: [], showCutout: false, editorProject: { size, lines, reference, onion, playbackMode } });
  }); }
  const workspaceTitles = { crop: '裁出动画帧', align: '校准角色位置', repair: '修整帧内细节', export: '保存与导出' };
  function switchWorkspace(id) {
    setWorkspaceStep(id); setPlaying(false);
    if (id === 'crop') setSourceCollapsed(false);
    if (id === 'align' && ['brush', 'erase'].includes(tool) || id === 'repair' && ['anchor', 'guides'].includes(tool)) setTool('move');
  }
  function selectFrame(index) { change(setActive, index); setPlaying(false); }
  const currentPreview = filmstrip[active]?.preview;
  const visibleTools = workspaceStep === 'repair'
    ? [['move', '移动角色'], ['brush', '画笔修图'], ['erase', '橡皮擦'], ['select', '框选局部']]
    : [['move', '移动角色'], ['anchor', '点选锚点'], ['guides', '拖动参考线'], ['select', '框选局部']];
  return <div className="sheet-page sheet-workspace" hidden={!visible}>
    <header className="sheet-header">
      <div className="sheet-brand"><img src="/frame-studio-logo.png" alt="Frame Studio" /><div><strong>序列帧校准工作台</strong><small>FRAME STUDIO</small></div></div>
      <nav className="sheet-global-nav" aria-label="工作坊导航"><button disabled={busy} onClick={onHome}><House weight="fill" />首页</button><button className="chosen" aria-current="page" disabled={busy} onClick={() => switchWorkspace(frames.length ? 'align' : 'crop')}><FilmStrip weight="fill" />帧编辑</button><button disabled={busy} onClick={onLibrary}><Images weight="fill" />素材库</button><button disabled={busy} onClick={() => switchWorkspace('export')}><Export />导出</button></nav>
      <div className="sheet-workspace-history"><button aria-label={`撤销 (${history.past.length})`} title="撤销 · Ctrl+Z" disabled={!history.past.length || busy} onClick={undo}><ArrowCounterClockwise />{history.past.length}</button><button aria-label={`重做 (${history.future.length})`} title="重做 · Ctrl+Shift+Z" disabled={!history.future.length || busy} onClick={redo}><ArrowClockwise />{history.future.length}</button></div>
      <div className="sheet-maker">{currentPreview ? <img src={currentPreview} alt="" /> : <img src="/frame-studio-logo.png" alt="" />}<div><strong>像素工坊</strong><small>创作更有趣</small></div></div>
    </header>
    <main className="sheet-main">
      <aside className="sheet-project-panel" aria-label="项目设置">
        <div className="sheet-project-heading"><h2><FilmStrip weight="duotone" />项目信息</h2><button aria-label="打开素材库" title="打开素材库" disabled={busy} onClick={onLibrary}><Images /></button></div>
        <label>项目名称<input aria-label="素材名称" value={name} maxLength={80} disabled={busy} onChange={e => change(setName, e.target.value)} /></label>
        <fieldset disabled={busy}><legend>画布尺寸</legend><div className="sheet-fields"><NumberField label="画布宽" value={draftSize.width} min={1} onChange={v => change(setDraftSize, { ...draftSize, width: v })} /><NumberField label="画布高" value={draftSize.height} min={1} onChange={v => change(setDraftSize, { ...draftSize, height: v })} /></div><button className="sheet-resize-action" disabled={!frames.length} onClick={() => resizeCanvas()}>应用尺寸 / 扩展透明边距</button></fieldset>
        <NumberField label="播放 FPS" value={fps} disabled={busy} min={1} max={60} onChange={v => change(setFps, Math.max(1, Math.min(60, Math.round(v))))} />
        <div className="sheet-project-total"><span>总帧数</span><strong>{frames.length}</strong><FilmStrip /></div>
        <label>背景底色<div className="sheet-color-field"><input type="color" aria-label="背景颜色" value={keyColor} disabled={busy} onChange={e => change(setKeyColor, e.target.value)} /><span>{keyColor.toUpperCase()}</span></div></label>
        <button className="sheet-primary sheet-project-preview" disabled={!frames.length || busy} onClick={() => setPlaying(!playing)}>{playing ? <Pause weight="fill" /> : <Play weight="fill" />}{playing ? '暂停动画' : '预览动画'}</button>
        <button disabled={!frames.length || busy} onClick={() => { setPlaying(false); setShowScenePreview(true); }}><Eye />场景预览</button>
        <nav className="sheet-workflow" aria-label="工作台任务">{[['crop','裁帧',Crop],['align','对齐',Crosshair],['repair','修图',PaintBrush],['export','导出',Export]].map(([id,label,Icon]) => <button key={id} aria-pressed={workspaceStep === id} disabled={busy} className={workspaceStep === id ? 'chosen' : ''} onClick={() => switchWorkspace(id)}><Icon />{label}</button>)}</nav>
        <button className="sheet-project-save" disabled={!frames.length || busy || !name.trim()} onClick={save}><FloppyDisk />保存到素材库</button>
        <DraftNotice guard={draftGuard} saveLabel="保存到素材库" prerequisite={!frames.length ? '上传拼图，开始制作动画。' : null} className="sheet-help" />
      </aside>
      <div className="sheet-layout">
        <section className="sheet-center" aria-label="画布区">
          {sheet && <div className="sheet-source" hidden={workspaceStep !== 'crop'}><div className="sheet-section-head"><h2>原始拼图 · 拖框后按空格确认</h2><button onClick={() => change(setSourceCollapsed, !sourceCollapsed)}>{sourceCollapsed ? '展开拼图' : '收起拼图'}</button></div><canvas hidden={sourceCollapsed} ref={sourceCanvas} aria-label="拼图裁剪画布" tabIndex={0} onPointerDown={cropStart} onPointerMove={cropMove} onPointerUp={cropEnd} onPointerCancel={() => { gesture.current = null; }} /><div className="sheet-source-hint">{draftRect ? `第 ${(draftIndex ?? rects.length) + 1} 帧待确认 · 拖动内部移动 / 拖角缩放 · 空格确认 · Esc 取消` : `${rects.length} 个已确认框 · 可点击并拖动已有框，也可在空白处画新框`}</div></div>}
    
          <div className="sheet-editor-surface" hidden={workspaceStep === 'crop' && Boolean(sheet)}>
            <div className="sheet-section-head"><h2>{workspaceStep === 'crop' ? '动画预览' : workspaceTitles[workspaceStep]}</h2><span>{size.width} × {size.height} px · {frames.length} 帧</span></div>

            <div className="sheet-stage"><canvas ref={editCanvas} style={{ width: `min(100%, ${size.width * zoom}px, calc(100cqh * ${size.width / size.height}))`, transform: `translate(${previewView.x}px, ${previewView.y}px) scale(${previewView.scale})`, transformOrigin: 'center' }} aria-label="角色校准画布" tabIndex={0} onPointerDown={editStart} onPointerMove={editMove} onPointerUp={() => { gesture.current = null; }} onPointerCancel={() => { gesture.current = null; }} onKeyDown={e => { const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }; if (frame && !busy && ['align', 'repair'].includes(workspaceStep) && directions[e.key]) { e.preventDefault(); checkpoint(); const [x, y] = directions[e.key], step = e.shiftKey ? 10 : 1; if (tool === 'guides') setLines(dragGuide(lines, x ? 'center' : 'bottom', x * step, y * step, size)); else move(frame.dx + x * step, frame.dy + y * step); } }} />{!frames.length && <div className="sheet-empty"><strong>先裁出你的动画帧</strong><p>统一尺寸、固定锚点，再播放检查偏移。</p></div>}</div><p className="sheet-help">{workspaceStep === 'export' ? '这里只预览，不会修改角色。参考线和洋葱皮不会导出。' : workspaceStep === 'crop' ? '上传拼图后，在图片上框选每一帧；确认裁框后再裁剪。' : tool === 'select' ? '在画布上拖出青色选区。局部对齐在参考帧同坐标取样，局部修图从参考帧复制此区域。' : tool === 'guides' ? '直接拖黄框边缘调整范围，拖框内整体移动；拖蓝线调中心，拖红线调脚底基线。' : tool === 'anchor' ? '每帧点击同一个部位（如脚底中心），对齐到选定的共享落点。' : tool === 'move' ? '拖动角色；聚焦画布后用方向键移动 1 px，Shift + 方向键移动 10 px。' : '直接在当前帧涂画；操作可以撤销。'}</p>
            <div className="sheet-view-controls"><label>预览缩放<select aria-label="预览缩放" value={zoom} onChange={e => change(setZoom, Number(e.target.value))}>{[1,2,3,4,6].map(n => <option key={n} value={n}>{n}×</option>)}</select></label><button disabled={busy} onClick={() => { setPreviewView({ scale: 1, x: 0, y: 0 }); change(setZoom, 1); }}>1×</button><button aria-label="适配画布预览" title="适配画布预览" disabled={busy} onClick={() => { setPreviewView({ scale: 1, x: 0, y: 0 }); change(setZoom, 3); }}><ArrowsOut /></button><small>滚轮缩放 {Math.round(previewView.scale * 100)}% · 不改变输出尺寸</small></div>
          </div>
        </section>
        <aside ref={inspector} className="sheet-panel sheet-inspector" aria-label="当前任务设置">
          <section className="sheet-frame-info"><div className="sheet-info-heading"><h2><FilmStrip weight="duotone" />帧信息</h2><strong>#{frames.length ? active + 1 : '—'}</strong></div><div className="sheet-frame-meta"><dl><dt>文件名</dt><dd>{frame ? `frame-${String(active + 1).padStart(3, '0')}.png` : '等待导入'}</dd><dt>实际输出尺寸</dt><dd>{size.width} × {size.height} px</dd><dt>当前帧时长</dt><dd>{frame ? Math.round(frameDuration(frame, fps)) : 0} ms</dd></dl>{currentPreview && <img src={currentPreview} alt="当前帧缩略图" />}</div></section>
          <section className="sheet-quick-actions"><h2><GridFour weight="duotone" />快捷操作</h2><div><button disabled={!frame || busy || frames.length >= 72} onClick={() => editTimeline('copy')}><Copy />复制帧</button><button disabled={!frame || busy} onClick={() => setShowTimeline(true)}><Plus />插入 / 补帧</button><button disabled={!frame || busy || active === 0} onClick={() => editTimeline('previous')}><SkipBack />前移帧</button><button className="sheet-delete-action" disabled={frames.length < 2 || busy} onClick={() => editTimeline('delete')}><Trash />删除帧</button></div></section>
          <details className="sheet-display-options"><summary><Eye weight="duotone" />显示与参考</summary><div><label><input type="checkbox" checked={guides} disabled={busy} onChange={e => change(setGuides, e.target.checked)} />黄 / 蓝 / 红参考线</label><label><input type="checkbox" checked={onion} disabled={busy} onChange={e => change(setOnion, e.target.checked)} />洋葱皮参考</label><span>参考线与洋葱皮不会导出</span></div></details>
          <div className="sheet-inspector-head"><h2><Crosshair weight="duotone" />{workspaceTitles[workspaceStep]}</h2><p className="sheet-help">{workspaceStep === 'crop' ? '先确认裁框，再裁出动画帧。' : workspaceStep === 'align' ? '固定角色位置，播放检查偏移。' : workspaceStep === 'repair' ? '抠图、补色，统一局部细节。' : '检查规格，保存可继续编辑的项目。'}</p></div>
            <div hidden={workspaceStep === 'export' || workspaceStep === 'crop'}><div className="sheet-tools">{visibleTools.map(([id, label]) => <button key={id} disabled={!frames.length || busy} className={tool === id ? 'chosen' : ''} onClick={() => { change(setTool, id); setPlaying(false); }}>{label}</button>)}</div></div>
          <section hidden={workspaceStep !== 'crop'} className="sheet-task-panel"><input ref={input} type="file" accept="image/png,image/jpeg,image/webp" aria-label="上传序列拼图" onChange={e => { upload(e.target.files[0]); e.target.value = ''; }} /><button className="sheet-primary" disabled={busy} onClick={() => input.current.click()}>上传 AI 序列拼图</button><p className="sheet-help">支持 6 / 12 / 24 帧及自定义网格，最多 36 帧。手动拖框后可移动、拉角缩放；空格确认，Esc 取消。</p>
    {sheet && <><div className="sheet-grid-presets">{[[3,2,'6 帧 · 3 × 2'],[6,1,'6 帧 · 6 × 1'],[3,4,'12 帧 · 3 × 4'],[6,4,'24 帧 · 6 × 4'],[4,6,'24 帧 · 4 × 6']].map(([c,r,label]) => <button key={label} disabled={busy || Boolean(draftRect)} onClick={() => makeGrid(c,r)}>{label}</button>)}</div>
    <div className="sheet-fields"><NumberField label="网格列数" value={columns} min={1} max={36} onChange={v => change(setColumns, v)} /><NumberField label="网格行数" value={rows} min={1} max={36} onChange={v => change(setRows, v)} /></div><button disabled={busy || Boolean(draftRect)} onClick={() => makeGrid()}>生成自定义网格框</button>
    <label><input type="checkbox" checked={uniform} disabled={busy} onChange={e => change(setUniform, e.target.checked)} />统一矩形大小（确认 / 校准时应用）</label>
    <details className="sheet-detection"><summary>识别底色与安全边距</summary><label><input type="checkbox" checked={autoBackground} disabled={busy} onChange={e => change(setAutoBackground, e.target.checked)} />自动识别透明 / 纯色底</label>{!autoBackground && <label>裁框识别底色<input type="color" aria-label="裁框识别底色" value={keyColor} onChange={e => change(setKeyColor, e.target.value)} /></label>}
    <div className="sheet-fields"><NumberField label="安全边距 px" value={padding} max={128} onChange={v => change(setPadding, Math.max(0, Math.min(128, Math.round(v))))} /><NumberField label="裁框底色容差" value={tolerance} max={255} onChange={v => change(setTolerance, Math.max(0, Math.min(255, v)))} /></div></details><button disabled={busy || Boolean(draftRect)} onClick={autoBoxes}>按完整角色自动校准裁框</button><p className="sheet-help">包含相连的耳朵、鼻子、尾巴；源图外会补透明边距；复杂背景或角色互相接触时，请手动检查。</p>
    <select aria-label="当前裁剪框" disabled={busy || Boolean(draftRect)} value={selectedBox} onChange={e => change(setSelectedBox, Number(e.target.value))}>{!rects.length && <option value={0}>暂无已确认框</option>}{rects.map((r, i) => <option key={i} value={i}>裁剪框 {i + 1} · {r.width} × {r.height}</option>)}</select>
    {draftRect && <div className="sheet-pending"><strong>第 {(draftIndex ?? rects.length) + 1} 帧 · 待确认</strong><p>此框可以拖动，未确认前不会新增下一帧。</p><div className="sheet-actions"><button disabled={busy} onClick={confirmBox}>确认此框 · 空格</button><button disabled={busy} onClick={cancelBox}>取消 · Esc</button></div></div>}
    {(draftRect || rects[selectedBox]) && <><div className="sheet-fields">{['x', 'y', 'width', 'height'].map((k, i) => <NumberField key={k} label={['裁剪 X', '裁剪 Y', '裁剪宽', '裁剪高'][i]} min={i < 2 ? -4096 : 1} value={(draftRect || rects[selectedBox])[k]} onChange={v => changeRect(k, v)} />)}</div>{!draftRect && <div className="sheet-actions"><button disabled={busy} onClick={() => { if (selectedBox === 0) return; checkpoint(); const rs = [...rects]; [rs[selectedBox], rs[selectedBox - 1]] = [rs[selectedBox - 1], rs[selectedBox]]; setRects(rs); setSelectedBox(selectedBox - 1); }}>前移一帧</button><button disabled={busy} onClick={() => { checkpoint(); setRects(rects.filter((_, i) => i !== selectedBox)); setSelectedBox(0); }}>删除此框</button></div>}</>}
    <button className="sheet-primary" disabled={!rects.length || busy || Boolean(draftRect)} onClick={crop}>裁剪 {rects.length} 帧并进入校准</button></>}
    <button onClick={() => setShowPrompt(!showPrompt)}>序列帧 AI 生成提示词</button>{showPrompt && <section className="sheet-prompt"><p>复制到你使用的图片 AI，附上角色参考图。当前工作台负责编辑，不调用付费视频生成。</p><textarea aria-label="序列帧生成提示词" defaultValue={prompt.replace('动画六帧，3列2行', `动画${columns * rows}帧，${columns}列${rows}行`)} /><button onClick={() => run(async () => { await navigator.clipboard.writeText(document.querySelector('.sheet-prompt textarea').value); setMessage('已复制生成提示词'); })}>复制提示词</button></section>}
    </section>
          <section hidden={workspaceStep !== 'align'} className="sheet-task-panel"><fieldset disabled={busy || !frames.length}><h3>当前帧位置</h3><div className="sheet-fields"><NumberField label="位移 X" value={frame?.dx || 0} min={-4096} onChange={v => { checkpoint(); move(v, frame.dy); }} /><NumberField label="位移 Y" value={frame?.dy || 0} min={-4096} onChange={v => { checkpoint(); move(frame.dx, v); }} /></div><div className="sheet-actions"><button onClick={() => autoAlign()}>全帧脚底居中</button><button onClick={() => autoAlign('center')}>全帧身体居中</button></div><p className="sheet-help">自动对齐按透明轮廓计算，使用前先抠图。</p><label>手动锚点落点<select aria-label="手动锚点落点" value={anchorMode} onChange={e => change(setAnchorMode, e.target.value)}><option value="bottom">蓝线与红线交点（脚底）</option><option value="center">蓝线与画布中心（身体）</option></select></label>
    <h3>参考帧对比</h3><label><input type="checkbox" checked={onion} onChange={e => change(setOnion, e.target.checked)} />洋葱皮对比（播放时隐藏）</label><select aria-label="洋葱皮参考帧" value={reference} onChange={e => change(setReference, ['none', 'previous', 'next'].includes(e.target.value) ? e.target.value : Number(e.target.value))}><option value="none">无 · 不显示参考帧</option><option value="previous">上一帧 · 跟随当前帧</option><option value="next">下一帧 · 跟随当前帧</option>{frames.map((_, i) => <option key={i} value={i}>固定参考第 {i + 1} 帧</option>)}</select><p className="sheet-help sheet-reference-status" aria-live="polite">{reference === 'none' ? '参考帧已关闭' : onionIndex === null ? '当前没有可叠加的参考帧' : `当前参考：第 ${onionIndex + 1} 帧${reference === 'previous' || reference === 'next' ? ' · 首尾循环衔接' : ' · 固定帧'}`}</p>
    <details className="sheet-detection"><summary>参考线与保留区域</summary><div className="sheet-tool-group"><label><input type="checkbox" checked={guides} onChange={e => change(setGuides, e.target.checked)} />共享黄 / 蓝 / 红参考线</label><p className="sheet-help">点击「拖动参考线」后直接拖线。黄色：保留区域 · 蓝色：中心轴 · 红色：脚底基线（同时是黄框下边）。参考线不会导出。</p><div className="sheet-fields">{[['left', '黄线左边'], ['right', '黄线右边'], ['top', '黄线上边'], ['bottom', '红线 / 下边'], ['center', '蓝线中心']].map(([k, label]) => <NumberField key={k} label={label} value={lines[k]} onChange={v => change(setLines, { ...lines, [k]: Math.round(v) })} />)}</div><button onClick={() => resizeCanvas(true)}>统一裁掉黄框以外部分</button>
    </div></details></fieldset></section>
          <section hidden={workspaceStep !== 'repair'} className="sheet-task-panel"><button className="sheet-enhance-entry" aria-expanded={showEnhance} disabled={busy} onClick={() => setShowEnhance(!showEnhance)}>清晰处理 / 放大 <span>本地处理 · 无需付费</span></button>
    <fieldset disabled={busy || !frames.length}><div className="sheet-fields"><NumberField label="画笔大小" value={brush} min={1} max={128} onChange={v => change(setBrush, Math.max(1, Math.min(128, v)))} /><label>画笔颜色<input aria-label="画笔颜色" type="color" value={paint} onChange={e => change(setPaint, e.target.value)} /></label></div>
    <div className="sheet-tool-group"><h3>透明背景</h3><NumberField label="色差容差" value={tolerance} max={255} onChange={v => change(setTolerance, Math.max(0, Math.min(255, v)))} /><button onClick={() => cutout('chroma')}>全帧去除指定底色</button><button onClick={() => cutout('ai')}>全帧本地 AI 抠图</button><p className="sheet-help">本地抠图需要桌面后台服务；长边最多 1024 px。画笔和橡皮擦用于手动补色、修边。</p></div></fieldset></section>
          <section hidden={workspaceStep !== 'repair'}><details className="animation-extra"><summary>局部颜色统一</summary><fieldset disabled={busy || frames.length < 2}><button className={tool === 'select' ? 'chosen' : ''} onClick={() => change(setTool, 'select')}>框选统一颜色区域</button><p className="sheet-help">框选 → 选择参考帧 → 统一颜色。按对应位置统计颜色，同一种原色统一映射为同一种参考色，只统一同色系<TermTip term="同色系" />的深浅差异。先对齐稳定部位；姿势不同的区域请分开框选。</p><label>颜色参考帧<select aria-label="颜色参考帧" value={Math.min(colorReference, Math.max(0, frames.length - 1))} onChange={e => change(setColorReference, Number(e.target.value))}>{frames.map((_, i) => <option key={i} value={i}>第 {i + 1} 帧{i === active ? '（当前帧）' : ''}</option>)}</select></label><label>颜色统一范围<select aria-label="颜色统一范围" value={colorScope} onChange={e => change(setColorScope, e.target.value)}><option value="all">全部其他帧</option><option value="current">仅当前帧</option></select></label><button disabled={!selection} onClick={() => unifyColors()}>统一选区颜色</button><button disabled={!selection} onClick={() => unifyColors('sequence')}>按序列统一</button><p className="sheet-help">按序列：第 2 帧参照第 1 帧，第 3 帧参照处理后的第 2 帧，依次到最后一帧。使用当前选区，忽略上方参考帧和范围；整次可一步撤销。</p><p className="sheet-help">匹配不稳定或孤立的细节保留原色，避免碎斑；保留透明度，支持撤销。</p></fieldset>{colorFeedback && <p className="animation-report" role="status">{colorFeedback}</p>}</details></section>
          <div hidden={!['align','repair'].includes(workspaceStep)}><details className="animation-extra"><summary>{workspaceStep === 'align' ? '局部自动对齐' : '从参考帧修图'}</summary><fieldset disabled={busy || frames.length < 2}><button className={tool === 'select' ? 'chosen' : ''} onClick={() => change(setTool, 'select')}>在画布上框选局部</button><p className="sheet-help">框选胸口、脸等稳定部位 → 选择参考帧 → 预览 → 确认。选区用于匹配，确认后平移整帧。</p><label>局部工具参考帧<select aria-label="局部工具参考帧" value={patchReference} onChange={e => change(setPatchReference, ['previous', 'next'].includes(e.target.value) ? e.target.value : Number(e.target.value))}><option value="previous">上一帧</option><option value="next">下一帧</option>{frames.map((_, i) => <option key={i} value={i}>第 {i + 1} 帧</option>)}</select></label><div hidden={workspaceStep !== 'align'} className="sheet-tool-group"><NumberField label="对齐搜索范围 px" value={alignRadius} min={1} max={32} onChange={v => change(setAlignRadius, Math.max(1, Math.min(32, Math.round(v))))} /><button disabled={!selection} onClick={previewAlignment}>预览当前帧局部对齐</button>{alignmentFeedback?.active === active && <p className="animation-report" role={alignmentFeedback.error ? 'alert' : 'status'}>{alignmentFeedback.text}</p>}{alignPreview?.active === active && <div className="animation-preview">建议平移 X {alignPreview.dx} / Y {alignPreview.dy} px，匹配相似度<TermTip term="匹配相似度" /> {(alignPreview.similarity * 100).toFixed(1)}%。<p>这只是传统区域匹配；姿势变化、遮挡时请人工检查。</p><div className="sheet-actions"><button onClick={applyAlignment}>确认对齐</button><button onClick={() => { setAlignPreview(null); setAlignmentFeedback({ active, text: '已取消预览，当前帧未移动。' }); }}>取消预览</button></div></div>}</div><div hidden={workspaceStep !== 'repair'} className="sheet-tool-group"><div className="sheet-fields"><NumberField label="粘贴偏移 X" value={patchOffset.x} min={-4096} onChange={v => change(setPatchOffset, { ...patchOffset, x: Math.round(v) })} /><NumberField label="粘贴偏移 Y" value={patchOffset.y} min={-4096} onChange={v => change(setPatchOffset, { ...patchOffset, y: Math.round(v) })} /></div><button disabled={!selection} onClick={copyPatch}>复制参考帧选区到当前帧</button><p className="sheet-help">替换选区内像素，透明像素也会替换，可撤销。复制后可用画笔或橡皮修边。</p></div></fieldset></details>
    </div>
          <section hidden={workspaceStep !== 'export'} className="sheet-task-panel"><details className="animation-extra"><summary>无缝循环 / 素材规格检查</summary><div className="sheet-actions"><button disabled={busy || frames.length < 2} onClick={() => inspectAnimation(true)}>首尾循环检查</button><button disabled={busy || !frames.length} onClick={() => inspectAnimation()}>检查素材规格</button></div><p className="sheet-help">检查空白、重复、触边和越界。重复帧也可以是有意停顿；提示不会自动删帧。</p>{checkReport && <div className="animation-report" role="status">{checkReport}</div>}</details>
     <h3>导出格式</h3><div className="sheet-actions animation-export">{[['frames', 'PNG 图片集'], ['sheet', '等格精灵图'], ['atlas', '游戏图集 + JSON']].map(([format, label]) => <button key={format} disabled={!frames.length || busy} onClick={() => exportAnimation(format)}>{label} ↓</button>)}</div><p className="sheet-help">游戏图集含原尺寸、裁剪偏移、共享锚点与独立帧时长。原 PNG 图片集保持统一画布。</p>{onSendTo && <div className="animation-send"><button disabled={!frames.length || busy} onClick={() => sendTo('rig')}>送到角色关节台 →</button><button disabled={!frames.length || busy} onClick={() => sendTo('scene')}>送到场景验证台 →</button></div>}
    </section>
          <div className="sheet-inspector-footer"><button className="sheet-primary" disabled={!frames.length || busy} onClick={() => exportAnimation('frames')}><Export />导出序列帧</button></div>
        </aside>
      </div>
      <section className="sheet-timeline-dock" aria-label="动画帧列表"><div className="sheet-play"><h2><FilmStrip weight="duotone" />帧序列 <span>({frames.length})</span></h2><div className="sheet-transport"><button aria-label="上一帧" disabled={!frames.length || busy} onClick={() => selectFrame((active - 1 + frames.length) % frames.length)}><SkipBack weight="fill" /></button><button aria-label={playing ? '暂停播放' : '播放动画'} disabled={!frames.length || busy} onClick={() => setPlaying(!playing)}>{playing ? <Pause weight="fill" /> : <Play weight="fill" />}</button><button aria-label="下一帧" disabled={!frames.length || busy} onClick={() => selectFrame((active + 1) % frames.length)}><SkipForward weight="fill" /></button><input type="range" aria-label="当前帧" min={0} max={Math.max(0, frames.length - 1)} value={active} disabled={!frames.length || busy} onChange={e => selectFrame(Number(e.target.value))} /><span>{frames.length ? active + 1 : 0} / {frames.length}</span></div><button className="sheet-timeline-more" onClick={() => setShowTimeline(true)} disabled={busy}>时间轴 / 补帧</button></div>
        <div className="sheet-filmstrip" style={{ '--visible-frames': Math.min(6, Math.max(1, frames.length)) }}>{filmstrip.map(({ frame: timelineFrame, preview: url }, i) => <button key={i} aria-label={`选择第 ${i + 1} 帧`} aria-pressed={active === i} className={active === i ? 'chosen' : ''} disabled={busy} onClick={() => selectFrame(i)}><img src={url} alt={`帧 ${i + 1}`} /><span>{i + 1}</span><small>{Math.round(frameDuration(timelineFrame, fps))} ms</small></button>)}{!frames.length && <p className="sheet-help">裁出动画帧后，会按顺序显示在这里。</p>}</div>
      </section>
      <div className="sheet-status" role="status">{busy ? '正在处理，请稍候…' : message || '图片和编辑留在本机。未保存的修改请及时存入素材库。'}</div>
      {showEnhance && <dialog ref={enhanceDialog} className="sheet-enhance" aria-label="清晰处理" onCancel={() => setShowEnhance(false)}><div className="sheet-section-head"><h2>清晰处理 / 放大</h2><button disabled={busy} onClick={() => setShowEnhance(false)}>关闭</button></div><div className="sheet-fields"><label>处理方式<select aria-label="清晰处理方式" value={enhanceMode} disabled={busy} onChange={e => { checkpoint(); setEnhanceMode(e.target.value); if (e.target.value === 'ai' && enhanceScale === 1) setEnhanceScale(2); }}><option value="pixel">像素放大 · 保留像素格</option><option value="sharpen">轻度锐化 · 增强局部对比</option><option value="ai" disabled={!aiStatus?.enhancementAvailable}>本地 AI 高清{aiStatus?.enhancementAvailable ? " · 已就绪" : " · 尚未安装"}</option></select></label><label>实际输出倍数<select aria-label="实际输出倍数" value={enhanceScale} disabled={busy} onChange={e => change(setEnhanceScale, Number(e.target.value))}>{(enhanceMode === "ai" ? [2,4] : [1,2,4]).map(n => <option value={n} key={n}>{n}×{n === 1 ? ' · 原尺寸' : ''}</option>)}</select></label></div><p className="sheet-help">{size.width} × {size.height} → <strong>{size.width * enhanceScale} × {size.height * enhanceScale} px</strong> · 全部 {frames.length} 帧 · 可撤销</p><button className="sheet-primary" disabled={busy || !frames.length || (enhanceMode === 'pixel' && enhanceScale === 1)} onClick={enhance}>应用到全部帧</button><p className="sheet-help">像素放大保留像素格；锐化增强局部对比。本地 AI 高清需安装开源模型，可能改变像素轮廓；“预览缩放”只改变屏幕显示大小。</p></dialog>}
    
      {showTimeline && <dialog ref={timelineDialog} className="sheet-timeline-dialog" aria-label="时间轴与补帧" onCancel={() => setShowTimeline(false)}><div className="sheet-section-head"><h2>时间轴与补帧</h2><button disabled={busy} onClick={() => setShowTimeline(false)}>关闭</button></div><section className="animation-timeline"><h3>排序 / 复制 / 独立时长</h3><div className="sheet-actions"><button disabled={!frame || busy || active === 0} onClick={() => editTimeline('previous')}>← 前移</button><button disabled={!frame || busy || active === frames.length - 1} onClick={() => editTimeline('next')}>后移 →</button><button disabled={!frame || busy} onClick={() => editTimeline('copy')}>复制当前帧</button><button disabled={frames.length < 2 || busy} onClick={() => editTimeline('delete')}>删除当前帧</button></div><div className="sheet-fields"><label>播放方式<select aria-label="动画播放方式" disabled={busy} value={playbackMode} onChange={e => change(setPlaybackMode, e.target.value)}><option value="forward">正常播放</option><option value="reverse">倒放</option><option value="pingpong">往返播放</option></select></label><NumberField label="当前帧时长 ms（0 跟随 FPS）" disabled={!frame || busy} value={frame?.duration ?? 0} max={10000} onChange={v => { if (!frame || busy) return; checkpoint(); setFrames(frames.map((f, i) => i === active ? { ...f, duration: v > 0 ? Math.max(16, Math.min(10000, v)) : null } : f)); }} /></div><p className="sheet-help">当前实际时长 {frame ? Math.round(frameDuration(frame, fps)) : 0} ms。设置时长的帧不受 FPS 调整影响。</p></section><h3>载入两张关键帧</h3><input ref={pairInput} type="file" multiple accept="image/png,image/jpeg,image/webp" aria-label="上传两张关键帧" onChange={e => { uploadPair([...e.target.files]); e.target.value = ''; }} /><button disabled={busy} onClick={() => pairInput.current.click()}>上传两张关键帧 · 补帧</button><p className="sheet-help">同时选择两张图片，作为起始 / 结束帧。载入会替换当前时间轴，可以撤销恢复。</p>
     <details className="animation-extra"><summary>两帧补帧 · 先预览再插入</summary><fieldset disabled={busy || frames.length < 2}><label>起始 / 结束关键帧<select aria-label="补帧关键帧" value={interpolateFrom} onChange={e => change(setInterpolateFrom, Number(e.target.value))}>{frames.slice(0, -1).map((_, i) => <option key={i} value={i}>第 {i + 1} 帧 → 第 {i + 2} 帧</option>)}</select></label><label>补帧算法<select aria-label="补帧算法" value={interpolateMode} onChange={e => change(setInterpolateMode, e.target.value)}><option value="translation">传统平移 · 不推测肢体姿势</option><option value="rife" disabled={!aiStatus?.interpolationAvailable}>轻量本地 RIFE{aiStatus?.interpolationAvailable ? ' · 已就绪' : ' · 尚未安装'}</option></select></label><NumberField label="新增中间帧数" value={interpolateCount} min={1} max={24} onChange={v => change(setInterpolateCount, Math.max(1, Math.min(24, Math.round(v))))} /><button onClick={previewInterpolation}>生成补帧预览</button><p className="sheet-help">原始两帧不计入数量。平移模式只移动起始图，不补姿势变化；RIFE 对大幅转身、遮挡仍需检查。</p>{interpolatePreview && <div className="animation-preview"><div className="sheet-filmstrip">{interpolatePreview.frames.map((f, i) => <button key={i} onClick={() => setMessage('这些是预览帧，点击确认才会插入动画。')}><img src={interpolatePreview.urls[i]} alt={`中间帧预览 ${i + 1}`} /><span>{i + 1}</span></button>)}</div><div className="sheet-actions"><button onClick={insertInterpolation}>确认插入 {interpolatePreview.frames.length} 帧</button><button onClick={() => setInterpolatePreview(null)}>取消预览</button></div></div>}</fieldset></details>
    </dialog>}
      {showScenePreview && visible && <ScenePreview frames={frames} size={size} fps={fps} playbackMode={playbackMode} name={name} onClose={() => setShowScenePreview(false)} />}
    </main>
  </div>;
}
