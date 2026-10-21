import { useEffect, useMemo, useRef, useState } from 'react';
import { canvasBlob, downloadBlob } from './lib/media.mjs';
import { saveAsset } from './lib/library.mjs';
import { tileRectangles, resizeMap, paintMapCell, seamDifference, terrainManifest } from './lib/scene-terrain.mjs';
import { WorkbenchHeader, useWorkbench, imageCanvas, makeCanvas, imageRecord, projectZip } from './SceneStudio.jsx';
import './scene-terrain.css';
import { draftValue } from './lib/draft-guard.mjs';
import { useDraftGuard, DraftNotice } from './DraftNotice.jsx';
const initialTerrain = () => ({ name: '地形拼块', source: null, tileWidth: 32, tileHeight: 32, columns: 8, rows: 6, map: Array(48).fill(-1), selected: 0, erase: false });
function initialTileSize(source) {
  let size = 32;
  while (Math.floor(source.width / Math.min(size, source.width)) * Math.floor(source.height / Math.min(size, source.height)) > 512) size *= 2;
  return { tileWidth: Math.min(size, source.width), tileHeight: Math.min(size, source.height) };
}
function drawMap(canvas, p, tiles, grid = false) {
  const width = p.columns * p.tileWidth, height = p.rows * p.tileHeight;
  if (canvas.width !== width) canvas.width = width; if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, width, height); ctx.imageSmoothingEnabled = false;
  if (p.source) for (const [i, index] of p.map.entries()) { const tile = tiles[index]; if (tile) ctx.drawImage(p.source, tile.x, tile.y, tile.width, tile.height, i % p.columns * p.tileWidth, Math.floor(i / p.columns) * p.tileHeight, p.tileWidth, p.tileHeight); }
  if (grid) { ctx.strokeStyle = '#60765d66'; ctx.lineWidth = 1; ctx.beginPath(); for (let x = 0; x <= width; x += p.tileWidth) { ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, height); } for (let y = 0; y <= height; y += p.tileHeight) { ctx.moveTo(0, y + .5); ctx.lineTo(width, y + .5); } ctx.stroke(); }
}
function TileThumbnail({ source, tile, index, selected, onSelect }) {
  const canvas = useRef(null);
  useEffect(() => { const ctx = canvas.current.getContext('2d'); ctx.clearRect(0, 0, 48, 48); ctx.imageSmoothingEnabled = false; const scale = Math.min(48 / tile.width, 48 / tile.height); ctx.drawImage(source, tile.x, tile.y, tile.width, tile.height, (48 - tile.width * scale) / 2, (48 - tile.height * scale) / 2, tile.width * scale, tile.height * scale); }, [source, tile]);
  return <button aria-label={`选择图块 ${index + 1}`} aria-pressed={selected} className={selected ? 'is-selected' : ''} onClick={onSelect}><canvas ref={canvas} width="48" height="48" /><small>{index + 1}</small></button>;
}
function validateMap(columns, rows, tileWidth, tileHeight) {
  if (columns * tileWidth > 4096 || rows * tileHeight > 4096 || columns * rows * tileWidth * tileHeight > 32 * 1024 * 1024) throw new Error('地图最大 4096 px，面积最多 3200 万像素，请减少行列或图块尺寸');
}
export function TerrainStudio({ visible, onHome, onLibrary, record, onBusyChange, onSendTo }) {
  const [busy, setBusy] = useState(false);
  const history = useWorkbench(initialTerrain, visible && !busy), { project: p, edit } = history;
  const draftGuard = useDraftGuard(draftValue('terrain', p));
  const [widthDraft, setWidthDraft] = useState(32), [heightDraft, setHeightDraft] = useState(32), [columnsDraft, setColumnsDraft] = useState(8), [rowsDraft, setRowsDraft] = useState(6);
  const [message, setMessage] = useState('导入地形图或使用测试图块，然后在地图网格里涂画。'), [showGrid, setShowGrid] = useState(true), [seam, setSeam] = useState(null);
  const upload = useRef(null), mapCanvas = useRef(null), repeatCanvas = useRef(null), brush = useRef(false), tileList = useRef(null);
  const tiles = useMemo(() => { if (!p.source) return []; try { return tileRectangles(p.source.width, p.source.height, p.tileWidth, p.tileHeight); } catch { return []; } }, [p.source, p.tileWidth, p.tileHeight]);
  const selectedTile = tiles[p.selected];
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  async function run(action) { if (busy) return; setBusy(true); try { await action(); } catch (error) { setMessage(error.message); } finally { setBusy(false); } }
  const update = (key, value) => edit(old => ({ ...old, [key]: value }));
  useEffect(() => { setWidthDraft(p.tileWidth); setHeightDraft(p.tileHeight); setColumnsDraft(p.columns); setRowsDraft(p.rows); }, [p.tileWidth, p.tileHeight, p.columns, p.rows]);
  useEffect(() => {
    if (!record) return; let alive = true;
    run(async () => {
      const stored = record.kind === 'terrain' ? record.editorProject : null;
      const sourceBlob = stored?.source || record.original[0].blob, source = await imageCanvas(sourceBlob);
      const settings = stored?.settings || initialTileSize(source);
      const next = { ...initialTerrain(), ...settings, source, name: record.name };
      validateMap(next.columns, next.rows, next.tileWidth, next.tileHeight); tileRectangles(source.width, source.height, next.tileWidth, next.tileHeight);
      if (alive) { edit(next); if (stored) draftGuard.markSaved(draftValue('terrain', next)); setMessage(stored ? '已恢复地形图块和地图排列。' : '已导入首张素材，可调整图块尺寸再拆分。'); }
    }); return () => { alive = false; };
  }, [record]);
  useEffect(() => { if (mapCanvas.current && visible) drawMap(mapCanvas.current, p, tiles, showGrid); }, [p, tiles, showGrid, visible]);
  useEffect(() => {
    if (!selectedTile || !repeatCanvas.current || !visible) { setSeam(null); return; }
    const sample = makeCanvas(p.tileWidth, p.tileHeight), ctx = sample.getContext('2d'); ctx.drawImage(p.source, selectedTile.x, selectedTile.y, selectedTile.width, selectedTile.height, 0, 0, p.tileWidth, p.tileHeight);
    setSeam(seamDifference(ctx.getImageData(0, 0, p.tileWidth, p.tileHeight).data, p.tileWidth, p.tileHeight));
    const canvas = repeatCanvas.current; canvas.width = p.tileWidth * 3; canvas.height = p.tileHeight * 3; const repeat = canvas.getContext('2d'); repeat.imageSmoothingEnabled = false;
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) repeat.drawImage(sample, x * p.tileWidth, y * p.tileHeight);
  }, [p.source, p.tileWidth, p.tileHeight, p.selected, selectedTile, visible]);
  async function setSource(source, name) {
    const { tileWidth, tileHeight } = initialTileSize(source);
    tileRectangles(source.width, source.height, tileWidth, tileHeight);
    edit({ ...initialTerrain(), source, tileWidth, tileHeight, name }); setMessage('已导入原图。图块按整数像素拆分；不足一个图块的边缘不会纳入。');
  }
  async function demo() {
    const source = makeCanvas(96, 32), ctx = source.getContext('2d');
    ctx.fillStyle = '#80a85f'; ctx.fillRect(0, 0, 32, 32); ctx.fillStyle = '#719850'; for (let i = 0; i < 12; i++) ctx.fillRect((i * 7 + 3) % 28, (i * 13 + 4) % 28, 3, 2);
    ctx.fillStyle = '#88bcda'; ctx.fillRect(32, 0, 32, 32); ctx.fillStyle = '#d5e9ed'; ctx.fillRect(38, 12, 10, 2); ctx.fillRect(49, 21, 9, 2);
    ctx.fillStyle = '#d4b481'; ctx.fillRect(64, 0, 32, 32); ctx.fillStyle = '#baa178'; for (let i = 0; i < 6; i++) ctx.fillRect(64 + (i * 7 + 5) % 28, (i * 11 + 6) % 28, 2, 2);
    edit({ ...initialTerrain(), source, name: '地形 · 三图块测试示例', map: Array.from({ length: 48 }, (_, i) => i % 8 < 4 ? 0 : i % 8 < 6 ? 2 : 1) }); setMessage('程序绘制的草地、水面、沙地测试图块。点击图块后可以涂画地图。');
  }
  function split() {
    const tileWidth = Math.round(Number(widthDraft)), tileHeight = Math.round(Number(heightDraft));
    if (tileWidth > 512 || tileHeight > 512) throw new Error('图块宽高最多 512 px');
    const nextTiles = tileRectangles(p.source.width, p.source.height, tileWidth, tileHeight); validateMap(p.columns, p.rows, tileWidth, tileHeight);
    edit(old => ({ ...old, tileWidth, tileHeight, map: Array(old.columns * old.rows).fill(-1), selected: 0 }));
    setMessage(`拆分为 ${nextTiles.length} 块，地图已清空，可撤销恢复之前的排列。`);
  }
  function resize() {
    const columns = Math.round(Number(columnsDraft)), rows = Math.round(Number(rowsDraft)); validateMap(columns, rows, p.tileWidth, p.tileHeight);
    const map = resizeMap(p.map, p.columns, p.rows, columns, rows); edit(old => ({ ...old, columns, rows, map })); setMessage('地图已调整，重叠区域保留原来的图块。');
  }
  function paint(event) {
    if (!brush.current || !p.source || busy) return;
    const rect = mapCanvas.current.getBoundingClientRect(), x = Math.floor((event.clientX - rect.left) / rect.width * p.columns), y = Math.floor((event.clientY - rect.top) / rect.height * p.rows);
    edit(old => ({ ...old, map: paintMapCell(old.map, old.columns, old.rows, x, y, old.erase ? -1 : old.selected) }), false);
  }
  function startPaint(event) { if (!p.source || busy) return; history.checkpoint(); brush.current = true; event.currentTarget.setPointerCapture(event.pointerId); paint(event); }
  async function packedRecord() {
    const { source, ...settings } = p; const original = [await imageRecord(source)];
    return { name: p.name, fps: 1, kind: 'terrain', original, editorProject: { version: 1, settings, source: original[0].blob } };
  }
  async function save() { const savingDraft = draftValue('terrain', p); const saved = await saveAsset(await packedRecord()); draftGuard.markSaved(savingDraft); setMessage(`已保存「${saved.name}」，包含源图和可编辑地图。`); }
  async function exportMap() {
    validateMap(p.columns, p.rows, p.tileWidth, p.tileHeight); const canvas = makeCanvas(p.columns * p.tileWidth, p.rows * p.tileHeight); drawMap(canvas, p, tiles);
    downloadBlob(await projectZip({ 'map.png': await canvasBlob(canvas), 'tiles.png': await canvasBlob(p.source), 'map.json': terrainManifest(p, tiles) }), 'terrain-map.zip'); setMessage('已导出透明 PNG 地图、原始图块图与索引 JSON；预览网格不会写入图片。');
  }
  async function sendTiles() {
    const original = await Promise.all(tiles.map(async (tile, i) => { const canvas = makeCanvas(tile.width, tile.height); canvas.getContext('2d').drawImage(p.source, tile.x, tile.y, tile.width, tile.height, 0, 0, tile.width, tile.height); return imageRecord(canvas, i / 8); }));
    onSendTo('frames', { name: `${p.name} · 图块`, fps: 8, original, kind: 'sheet' });
  }
  return <section className="st-workbench" hidden={!visible} aria-label="地形工作台">
    <WorkbenchHeader title="地形拼块" subtitle="拆分图块、检查接缝，排列可导出的地图" history={history} onHome={onHome} onLibrary={onLibrary} busy={busy} />
    <div className="st-layout st-terrain-layout" inert={busy}><aside className="st-panel"><h2>拆分原图</h2><button disabled={busy} onClick={() => upload.current.click()}>上传地形图片</button><input className="st-file" type="file" ref={upload} accept="image/png,image/jpeg,image/webp" onChange={e => { const file = e.target.files[0]; e.target.value = ''; if (file) run(async () => setSource(await imageCanvas(file), file.name.replace(/\.[^.]+$/, ''))); }} /><button disabled={busy} onClick={() => run(demo)}>使用测试图块</button><p className="st-note">也可在素材库选择图集。此入口使用第一张图；动画裁帧仍在动画工作台。</p>
      <div className="st-field-pair"><label>图块宽<input type="number" min="1" max="512" value={widthDraft} onChange={e => setWidthDraft(e.target.value)} /></label><label>图块高<input type="number" min="1" max="512" value={heightDraft} onChange={e => setHeightDraft(e.target.value)} /></label></div><button className="st-primary" disabled={!p.source || busy} onClick={() => run(split)}>按设置拆分图块</button><p className="st-note">改变拆分尺寸会重置地图，可撤销。{p.source ? `原图 ${p.source.width} × ${p.source.height} px；当前 ${tiles.length} 块。` : ''}</p>
      <h2>图块画笔</h2><div className="st-toolbar"><button aria-pressed={!p.erase} onClick={() => update('erase', false)}>图块</button><button aria-pressed={p.erase} onClick={() => update('erase', true)}>橡皮擦</button></div><div className="st-tile-palette" ref={tileList}>{tiles.map((tile, i) => <TileThumbnail key={i} source={p.source} tile={tile} index={i} selected={i === p.selected && !p.erase} onSelect={() => edit(old => ({ ...old, selected: i, erase: false }))} />)}</div>
    </aside><main className="st-main"><div className="st-toolbar"><strong>地图 · {p.columns} × {p.rows}</strong><label><input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} />显示预览网格</label><span>输出 {p.columns * p.tileWidth} × {p.rows * p.tileHeight} px</span></div><div className="st-canvas-wrap st-map-wrap"><canvas ref={mapCanvas} width="256" height="192" aria-label="地图画布，拖动涂画图块" onPointerDown={startPaint} onPointerMove={paint} onPointerUp={() => { brush.current = false; }} onPointerCancel={() => { brush.current = false; }} /></div><p className="st-note">选中左侧图块，点击或拖动地图格子。一笔涂画对应一步撤销；透明格用橡皮擦清空。</p><div className="st-toolbar"><button disabled={!p.source || busy} onClick={() => update('map', Array(p.columns * p.rows).fill(p.selected))}>选中图块填满地图</button><button disabled={!p.source || busy} onClick={() => update('map', Array(p.columns * p.rows).fill(-1))}>清空地图</button></div>
      {!p.source && <p className="st-empty">上传一张拼块图，或用三块测试地形先试画。</p>}
    </main><aside className="st-panel"><h2>重复平铺与接缝</h2><div className="st-repeat-preview"><canvas ref={repeatCanvas} width="96" height="96" aria-label="选中图块的三乘三重复平铺预览" /></div>{seam ? <><p>图块 {p.selected + 1} · 左右差 {seam.horizontal} / 上下差 {seam.vertical}</p><p className="st-note">边缘色差范围 0–255，越低越接近。色差只比较相邻边缘，最终连贯程度请看平铺预览；不会自动生成或修补像素。</p></> : <p className="st-note">拆分图块后，选择任意一块检查。</p>}
      <h2>地图规格</h2><div className="st-field-pair"><label>地图列数<input type="number" min="1" max="40" value={columnsDraft} onChange={e => setColumnsDraft(e.target.value)} /></label><label>地图行数<input type="number" min="1" max="40" value={rowsDraft} onChange={e => setRowsDraft(e.target.value)} /></label></div><button disabled={busy} onClick={() => run(resize)}>调整地图规格</button><p className="st-note">最多 40 × 40 格，单边最大 4096 px。图块保持原像素尺寸。</p>
      <h2>保存与导出</h2><label>地形名称<input maxLength={80} value={p.name} onChange={e => update('name', e.target.value)} /></label><button className="st-primary" disabled={busy || !p.source || !p.name.trim()} onClick={() => run(save)}>保存地形到素材库</button><DraftNotice guard={draftGuard} saveLabel="保存地形到素材库" prerequisite={!p.source ? '先导入地形图片，再保存到素材库。' : null} className="st-note" /><button disabled={busy || !p.source} onClick={() => run(exportMap)}>导出地图 PNG + JSON</button><button disabled={busy || !tiles.length || !onSendTo} onClick={() => run(sendTiles)}>图块送到动画工作台</button>
    </aside></div><footer className="st-status" role="status">{busy ? '正在处理…' : message}</footer>
  </section>;
}
