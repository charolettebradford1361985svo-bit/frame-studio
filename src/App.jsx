import { useEffect, useRef, useState } from 'react';
import { TermTip } from './TermTip.jsx';
import { FRAME_COUNTS } from './lib/core.mjs';
import { Library } from './Library.jsx';
import { Home } from './Home.jsx';
import { SheetStudio } from './SheetStudio.jsx';
import { RigStudio } from './RigStudio.jsx';
import { SceneStudio } from './SceneStudio.jsx';
import { TerrainStudio } from './TerrainStudio.jsx';
import { SharedTools } from './SharedTools.jsx';
import { parseScreen, destinationFor, recordForDestination, WORKBENCHES } from './lib/workbenches.mjs';
import { getAsset, restoreFrames } from './lib/library.mjs';
import { SquaresFour } from '@phosphor-icons/react/dist/csr/SquaresFour';
import { ArrowUpRight } from '@phosphor-icons/react/dist/csr/ArrowUpRight';
import { ArrowLeft } from '@phosphor-icons/react/dist/csr/ArrowLeft';
import { ArrowRight } from '@phosphor-icons/react/dist/csr/ArrowRight';
import { UploadSimple } from '@phosphor-icons/react/dist/csr/UploadSimple';
import { ImageSquare } from '@phosphor-icons/react/dist/csr/ImageSquare';
import { FilmStrip } from '@phosphor-icons/react/dist/csr/FilmStrip';
import { Play } from '@phosphor-icons/react/dist/csr/Play';
import { Pause } from '@phosphor-icons/react/dist/csr/Pause';
import { DownloadSimple } from '@phosphor-icons/react/dist/csr/DownloadSimple';
import { Scissors } from '@phosphor-icons/react/dist/csr/Scissors';
import { Sparkle } from '@phosphor-icons/react/dist/csr/Sparkle';
import { Check } from '@phosphor-icons/react/dist/csr/Check';
import { GearSix } from '@phosphor-icons/react/dist/csr/GearSix';
import { X } from '@phosphor-icons/react/dist/csr/X';
import { CircleNotch } from '@phosphor-icons/react/dist/csr/CircleNotch';
import { ArrowCounterClockwise } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise';
import { Info } from '@phosphor-icons/react/dist/csr/Info';
import { Plus } from '@phosphor-icons/react/dist/csr/Plus';
import { Stack } from '@phosphor-icons/react/dist/csr/Stack';
import { openVideo, disposeVideo, extractFrames, disposeFrames, applyChroma, removeAiBackground, api, readDataUrl, exportArchive, downloadBlob } from './lib/media.mjs';
const statusLabels = { PENDING: '任务已提交，等待生成', THROTTLED: '服务繁忙，排队中', RUNNING: '正在生成动作视频', SUCCEEDED: '视频生成完成' };
const IconButton = ({ icon: Icon, children, ...props }) => <button {...props}><Icon size={17} />{children}</button>;
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const done = () => { signal.removeEventListener('abort', abort); resolve(); };
  const timer = setTimeout(done, ms);
  const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new DOMException('已取消', 'AbortError')); };
  signal.addEventListener('abort', abort, { once: true });
});
export function App() {
  const [screen, setScreen] = useState(() => parseScreen(window.location.hash));
  const [sheetRecord, setSheetRecord] = useState(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [rigRecord, setRigRecord] = useState(null), [sceneRecord, setSceneRecord] = useState(null), [terrainRecord, setTerrainRecord] = useState(null);
  const [rigBusy, setRigBusy] = useState(false), [sceneBusy, setSceneBusy] = useState(false), [terrainBusy, setTerrainBusy] = useState(false);
  const [libraryTarget, setLibraryTarget] = useState(null), [toolsOpen, setToolsOpen] = useState(false);
  useEffect(() => { document.title = `Frame Studio · ${WORKBENCHES.find(entry => entry.id === screen)?.title || (screen === 'home' ? '游戏素材创作首页' : '视频抽帧')}`; }, [screen]);
  useEffect(() => {
    const changed = () => { setScreen(parseScreen(window.location.hash)); setPlaying(false); };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  function navigate(next) { setPlaying(false); setScreen(next); window.location.hash = next === 'home' ? '/' : `/${next}`; }
  const [libraryOpen, setLibraryOpen] = useState(false), [assetName, setAssetName] = useState('');
  const [image, setImage] = useState(null), [source, setSource] = useState(null);
  const [original, setOriginal] = useState([]), [cutout, setCutout] = useState([]);
  const [count, setCount] = useState(12), [active, setActive] = useState(0), [playing, setPlaying] = useState(false), [fps, setFps] = useState(12);
  const [start, setStart] = useState(0), [end, setEnd] = useState(5), [maxEdge, setMaxEdge] = useState(512);
  const [prompt, setPrompt] = useState('主体轻轻挥手，动作自然。固定镜头，保持外形与画面位置一致。');
  const [duration, setDuration] = useState(5), [ratio, setRatio] = useState('960:960');
  const [background, setBackground] = useState('checker'), [showCutout, setShowCutout] = useState(true), [mode, setMode] = useState('ai');
  const [keyColor, setKeyColor] = useState('#00ff00'), [tolerance, setTolerance] = useState(70), [format, setFormat] = useState('frames');
  const [busy, setBusy] = useState(null), [notice, setNotice] = useState(null), [settings, setSettings] = useState(false), [view, setView] = useState('animation');
  const [services, setServices] = useState({ videoConfigured: false, backgroundAvailable: false });
  const imageInput = useRef(null), videoInput = useRef(null), originals = useRef([]), cutouts = useRef([]), sourceRef = useRef(null), imageRef = useRef(null), controllerRef = useRef(null), taskRef = useRef(null), mounted = useRef(true);
  const frames = showCutout && cutout.length ? cutout : original;
  const frame = frames[active] || frames[0];
  const stale = source && original.length && (count !== original.length || start !== source.extractedStart || end !== source.extractedEnd || maxEdge !== source.extractedEdge);
  const report = (text, error = false) => setNotice({ text, error });
  const refreshServices = () => api('/status').then(setServices).catch(() => setServices({ videoConfigured: false, backgroundAvailable: false }));
  useEffect(() => { mounted.current = true; refreshServices(); return () => {
    mounted.current = false; controllerRef.current?.abort(); disposeFrames(originals.current); disposeFrames(cutouts.current);
    if (sourceRef.current?.owned) URL.revokeObjectURL(sourceRef.current.url);
    if (imageRef.current) URL.revokeObjectURL(imageRef.current.url);
  }; }, []);
  useEffect(() => {
    if (!playing || !frames.length) return;
    const timer = setInterval(() => setActive(i => (i + 1) % frames.length), 1000 / fps); return () => clearInterval(timer);
  }, [playing, fps, frames.length]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), 6500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    if (!settings) return;
    const dialog = document.querySelector('.settings-modal');
    const previousFocus = document.activeElement;
    const buttons = () => [...dialog.querySelectorAll('button:not(:disabled)')];
    buttons()[0]?.focus();
    const onKey = event => {
      if (event.key === 'Escape') setSettings(false);
      if (event.key === 'Tab') {
        const controls = buttons(), first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    dialog.addEventListener('keydown', onKey);
    return () => { dialog.removeEventListener('keydown', onKey); previousFocus?.focus(); };
  }, [settings]);
  function replaceFrames(next) {
    disposeFrames(originals.current); disposeFrames(cutouts.current); originals.current = next; cutouts.current = [];
    setOriginal(next); setCutout([]); setActive(0); setPlaying(false); setShowCutout(true);
  }
  function replaceCutout(next) { disposeFrames(cutouts.current); cutouts.current = next; setCutout(next); setShowCutout(true); setActive(0); }
  async function run(label, action) {
    if (controllerRef.current) return;
    const controller = new AbortController(); controllerRef.current = controller; setPlaying(false); setBusy({ label, progress: 0 });
    try { await action(controller.signal); }
    catch (error) { if (mounted.current) report(error.name === 'AbortError' ? '已取消，保留现有素材' : error.message, error.name !== 'AbortError'); }
    finally { controllerRef.current = null; if (mounted.current) setBusy(null); }
  }
  async function cancel() {
    controllerRef.current?.abort(); const id = taskRef.current; taskRef.current = null;
    if (id) try { await api(`/tasks/${id}`, undefined, undefined, 'DELETE'); } catch (error) { report(`本地已停止等待；服务端取消失败：${error.message}`, true); }
  }
  async function loadSource(url, name, owned = false, demo = false, signal) {
    let probe;
    try {
      probe = await openVideo(url, signal); signal?.throwIfAborted();
      const info = { url, name, owned, demo, duration: probe.duration, width: probe.videoWidth, height: probe.videoHeight };
      setAssetName('');
      if (sourceRef.current?.owned) URL.revokeObjectURL(sourceRef.current.url);
      sourceRef.current = info; setSource(info); replaceFrames([]); setStart(0); setEnd(Math.floor(probe.duration * 1000) / 1000); setView('source'); return info;
    } catch (error) { if (owned) URL.revokeObjectURL(url); throw error; }
    finally { disposeVideo(probe); }
  }
  async function takeFrames(info = sourceRef.current, from = start, to = end, signal) {
    const next = await extractFrames(info.url, from, to, count, maxEdge, (current, total) => setBusy({ label: `正在抽取第 ${current} / ${total} 帧`, progress: current / total }), signal);
    if (!mounted.current || signal?.aborted) { disposeFrames(next); signal?.throwIfAborted(); return; }
    replaceFrames(next); setView('animation');
    const updated = { ...info, extractedStart: from, extractedEnd: to, extractedEdge: maxEdge }; sourceRef.current = updated; setSource(updated);
    report(`已抽取 ${next.length} 帧 · ${next[0].width} × ${next[0].height}，可以预览或导出`);
  }
  async function demo() { await run('正在载入示例视频', async signal => {
    const info = await loadSource('/media/flower.mp4', '花朵 · 示例视频', false, true, signal);
    const to = Math.min(info.duration, 5); await takeFrames(info, 0, to, signal); setEnd(to);
  }); }
  async function uploadVideo(file) {
    if (!file) return;
    if (file.size > 200 * 1024 * 1024) return report('请选择 200 MB 以内的视频', true);
    await run('正在读取视频', signal => loadSource(URL.createObjectURL(file), file.name, true, false, signal));
  }
  function uploadImage(file) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) return report('请选择 5 MB 以内的 PNG、JPG 或 WebP 图片', true);
    if (imageRef.current) URL.revokeObjectURL(imageRef.current.url);
    const next = { file, url: URL.createObjectURL(file), name: file.name }; imageRef.current = next; setImage(next);
  }
  async function generate() {
    if (!services.videoConfigured) { setSettings(true); return; }
    if (!image) return report('请先上传一张图片', true);
    await run('正在提交生成任务', async signal => {
      const result = await api('/generate', { image: await readDataUrl(image.file), prompt, duration, ratio }, signal); taskRef.current = result.id;
      const deadline = Date.now() + 15 * 60 * 1000;
      while (Date.now() < deadline) {
        signal.throwIfAborted(); const state = await api(`/tasks/${result.id}`, undefined, signal);
        if (['FAILED', 'CANCELLED'].includes(state.status)) { taskRef.current = null; throw new Error(state.error || '视频生成失败，请修改动作描述后重试'); }
        setBusy({ label: statusLabels[state.status] || '正在等待视频', progress: state.progress || 0 });
        if (state.status === 'SUCCEEDED' && state.video) {
          taskRef.current = null; const response = await fetch(state.video, { signal }); if (!response.ok) throw new Error('生成视频下载失败，请重试');
          const blob = await response.blob(); const info = await loadSource(URL.createObjectURL(blob), image.name.replace(/\.[^.]+$/, '') + ' · AI 动作', true, false, signal);
          await takeFrames(info, 0, info.duration, signal); return;
        }
        await sleep(5000, signal);
      }
      throw new Error(`等待超过 15 分钟，任务 ${result.id} 仍可能运行；请查看 Runway 后台`);
    });
  }
  async function removeBackground() {
    if (mode === 'ai' && !services.backgroundAvailable) { setSettings(true); return; }
    await run(mode === 'ai' ? 'AI 正在识别主体并抠图' : '正在移除背景颜色', async signal => {
      const next = mode === 'ai' ? await removeAiBackground(originals.current, signal) : await applyChroma(originals.current, keyColor, tolerance, (current, total) => setBusy({ label: `正在抠图 ${current} / ${total}`, progress: current / total }), signal);
      if (signal.aborted || !mounted.current) { disposeFrames(next); signal.throwIfAborted(); return; }
      replaceCutout(next); report(`已处理 ${next.length} 帧，透明背景已保留`);
    });
  }
  async function save() { await run('正在打包动画素材', async signal => {
    const blob = await exportArchive(frames, fps, format); signal.throwIfAborted(); downloadBlob(blob, `frame-studio-${frames.length}frames-${format}.zip`); report('导出完成，下载已开始');
  }); }
  function openLibrary(target = null) { setPlaying(false); setLibraryTarget(target); setLibraryOpen(true); }
  function sendTo(target, record) { openLibraryAsset(record, target); }
  function openLibraryAsset(record, requested = libraryTarget) {
    const target = destinationFor(record, requested);
    if (target !== 'studio') {
      const setter = { frames: setSheetRecord, rig: setRigRecord, scene: setSceneRecord, terrain: setTerrainRecord }[target];
      // Cross-workbench transfer uses rendered images; matching kinds resume editable projects.
      setter(recordForDestination(record, target)); setLibraryOpen(false); navigate(target); return;
    }
    const restored = restoreFrames(record.original);
    const transparent = restoreFrames(record.cutout);
    if (sourceRef.current?.owned) URL.revokeObjectURL(sourceRef.current.url);
    sourceRef.current = null; setSource(null);
    replaceFrames(restored);
    if (transparent.length) replaceCutout(transparent);
    setShowCutout(record.showCutout); setFps(record.fps); setCount(record.original.length);
    setPrompt(record.prompt || ''); setAssetName(record.name); setView('animation');
    setLibraryOpen(false); report(`已打开「${record.name}」，可以继续抠图、预览或导出`);
    navigate('studio');
  }
  const locked = Boolean(busy) || sheetBusy || rigBusy || sceneBusy || terrainBusy;
  return <div className="studio">
    {screen === 'home' ? <Home locked={locked} refreshKey={libraryOpen} onFrames={() => navigate('frames')} onWorkbench={navigate} onTools={() => setToolsOpen(true)} onStudio={() => navigate('studio')} onLibrary={() => openLibrary()} onAsset={id => run('正在打开素材', async () => openLibraryAsset(await getAsset(id), null))} onDemo={() => { navigate('studio'); demo(); }} /> : null}
    <SheetStudio visible={screen === 'frames'} record={sheetRecord} onBusyChange={setSheetBusy} onHome={() => navigate('home')} onLibrary={() => openLibrary('frames')} onSendTo={sendTo} />
    <RigStudio visible={screen === 'rig'} record={rigRecord} onBusyChange={setRigBusy} onHome={() => navigate('home')} onLibrary={() => openLibrary('rig')} onSendTo={sendTo} />
    <SceneStudio visible={screen === 'scene'} record={sceneRecord} onBusyChange={setSceneBusy} onHome={() => navigate('home')} onLibrary={() => openLibrary('scene')} onSendTo={sendTo} />
    <TerrainStudio visible={screen === 'terrain'} record={terrainRecord} onBusyChange={setTerrainBusy} onHome={() => navigate('home')} onLibrary={() => openLibrary('terrain')} onSendTo={sendTo} />
    <div hidden={screen !== 'studio'}>
    <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden-input" aria-label="图片文件" onChange={e => { uploadImage(e.target.files[0]); e.target.value = ''; }} />
    <input ref={videoInput} type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden-input" aria-label="视频文件" onChange={e => { uploadVideo(e.target.files[0]); e.target.value = ''; }} />
    <header className="topbar"><button className="home-return" onClick={() => navigate('home')}>首页</button><div className="brand"><img src="/frame-studio-logo.png" alt="Frame Studio Logo" width="30" height="30" style={{ borderRadius: 7 }} /><strong>Frame<span>Studio</span></strong><span className="beta">LOCAL</span></div><div className="project-title"><span className="dot" />{assetName || source?.name || '未命名动画'}<span className="muted">/ 工作台</span></div><div className="top-actions"><IconButton icon={Stack} className="secondary small library-button" disabled={locked} onClick={() => { openLibrary('studio'); }}>素材库</IconButton><IconButton icon={GearSix} className="icon-button" aria-label="服务设置" onClick={() => { refreshServices(); setSettings(true); }} /><IconButton icon={DownloadSimple} className="primary small" disabled={!frames.length || locked} onClick={save}>导出素材</IconButton></div></header>
    <div className="workspace">
      <aside className="source-panel">
        <div className="panel-heading"><span className="eyebrow">01 / SOURCE</span><h2>让一张图，动起来。</h2><p>从灵感到可用的动画素材。</p></div>
        <div className="section-label"><span>起始图片</span><span className="micro">PNG · JPG · WEBP</span></div>
        <button className={`upload-zone ${image ? 'has-image' : ''}`} disabled={locked} onClick={() => imageInput.current.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!locked) uploadImage(e.dataTransfer.files[0]); }}>{image ? <><img src={image.url} alt="上传的起始图片" /><span className="upload-change"><UploadSimple size={15} />更换图片</span></> : <><div className="upload-icon"><ImageSquare size={28} weight="light" /><Plus size={12} className="upload-plus" /></div><strong>拖入图片，开始创作</strong><span>或点击上传 · 最大 5 MB</span></>}</button>
        {image && <p className="filename">{image.name}</p>}
        <label className="section-label" htmlFor="motion">动作描述<span className="micro">{prompt.length}/1000</span></label><textarea id="motion" value={prompt} maxLength={1000} disabled={locked} onChange={e => setPrompt(e.target.value)} /><div className="prompt-tips"><Sparkle size={13} />固定镜头、简单动作，更适合序列帧。</div>
        <div className="setting-row"><span>视频时长</span><div className="segmented">{[5, 10].map(n => <button key={n} className={duration === n ? 'selected' : ''} disabled={locked} onClick={() => setDuration(n)}>{n} 秒</button>)}</div></div>
        <div className="setting-row"><label htmlFor="ratio">画面比例</label><select id="ratio" value={ratio} disabled={locked} onChange={e => setRatio(e.target.value)}><option value="960:960">1:1 方形</option><option value="1280:720">16:9 横屏</option><option value="720:1280">9:16 竖屏</option></select></div>
        <IconButton icon={Sparkle} className="primary generate" disabled={locked || !prompt.trim()} onClick={generate}>生成动作视频<ArrowUpRight size={16} /></IconButton><button className="service-note" onClick={() => { refreshServices(); setSettings(true); }}><span className={`dot ${services.videoConfigured ? 'green' : 'amber'}`} />{services.videoConfigured ? 'Runway Gen-4 Turbo · 已连接' : '连接 Runway，即可生成视频'}<Info size={13} /></button>
        <div className="divider-caption"><span>也可以从视频开始</span></div><IconButton icon={FilmStrip} className="secondary full-width" disabled={locked} onClick={() => videoInput.current.click()}>导入已有视频</IconButton><button className="text-button demo-button" disabled={locked} onClick={demo}>试用示例视频<ArrowRight size={13} /></button><div className="source-footer"><span className="dot green" />抽帧在浏览器中完成<p>本地视频无需上传到云端。</p></div>
      </aside>
      <main className="main-panel">
        <div className="preview-heading"><div><span className="eyebrow">02 / PREVIEW</span><h1>动作预览</h1></div><div className="preview-tabs"><button className={view === 'animation' ? 'active' : ''} onClick={() => setView('animation')}>序列动画{frames.length ? <span>{frames.length}</span> : null}</button><button className={view === 'source' ? 'active' : ''} disabled={!source} onClick={() => { setView('source'); setPlaying(false); }}>原始视频</button></div></div>
        <section className={`preview-stage ${background}`} aria-label="动画预览画布"><span className="stage-label">{source?.demo ? 'DEMO FOOTAGE' : view === 'source' ? 'SOURCE VIDEO' : cutout.length && showCutout ? 'RGBA / TRANSPARENT' : 'ANIMATION CANVAS'}</span>{view === 'source' && source ? <video key={source.url} className="source-video" src={source.url} controls playsInline /> : frame ? <img className="frame-preview" src={frame.url} alt={`第 ${active + 1} 帧预览`} /> : <div className="empty-preview"><FilmStrip size={48} weight="thin" /><h3>下一帧，从这里开始。</h3><p>上传图片生成动作，或导入一段视频。<br />你的序列动画会出现在这里。</p><button className="secondary" disabled={locked} onClick={demo}>用示例视频试一试<ArrowUpRight size={15} /></button></div>}<div className="stage-bottom"><span>{frame ? `${frame.width} × ${frame.height} px` : '统一画布 · 保留原始比例'}</span><div className="background-picker" aria-label="画布背景">{[['checker', '透明棋盘格'], ['dark', '深色背景'], ['light', '浅色背景']].map(([key, label]) => <button key={key} className={`swatch ${key} ${background === key ? 'chosen' : ''}`} aria-label={label} aria-pressed={background === key} onClick={() => setBackground(key)} />)}</div></div></section>
        <div className="playback-bar"><div className="transport"><button className="icon-button" aria-label="上一帧" disabled={!frames.length || locked} onClick={() => { setPlaying(false); setActive(i => (i - 1 + frames.length) % frames.length); setView('animation'); }}><ArrowLeft size={16} /></button><button className="play-button" aria-label={playing ? '暂停动画' : '播放动画'} disabled={!frames.length || locked} onClick={() => { setView('animation'); setPlaying(p => !p); }}>{playing ? <Pause size={19} weight="fill" /> : <Play size={19} weight="fill" />}</button><button className="icon-button" aria-label="下一帧" disabled={!frames.length || locked} onClick={() => { setPlaying(false); setActive(i => (i + 1) % frames.length); setView('animation'); }}><ArrowRight size={16} /></button><span className="frame-counter">{String(frames.length ? active + 1 : 0).padStart(2, '0')}<span> / {String(frames.length).padStart(2, '0')}</span></span></div><div className="speed-control"><label htmlFor="fps">播放速度</label><select id="fps" value={fps} disabled={locked} onChange={e => setFps(Number(e.target.value))}>{[4, 6, 8, 12, 16, 24].map(n => <option key={n} value={n}>{n} FPS</option>)}</select><span className="micro">{frames.length ? (frames.length / fps).toFixed(2) : '0.00'} s / 循环</span></div></div>
        <section className="timeline"><div className="timeline-heading"><div><FilmStrip size={17} /><strong>序列帧</strong><span className="micro">{frames.length ? `${frames.length} FRAMES` : '等待抽帧'}</span></div><span className="micro">点击查看每一帧</span></div><div className="filmstrip">{frames.length ? frames.map((f, i) => <button className={`film-frame ${active === i ? 'current' : ''}`} key={f.url} aria-label={`查看第 ${i + 1} 帧`} aria-pressed={active === i} onClick={() => { setActive(i); setPlaying(false); setView('animation'); }}><img src={f.url} alt="" /><span>{String(i + 1).padStart(2, '0')}<small>{f.time.toFixed(2)}s</small></span></button>) : <div className="empty-filmstrip"><Stack size={22} weight="light" /><span>抽取后，按时间排列的图片会显示在这里。</span></div>}</div></section><footer className="main-footer"><span>每一帧，都是可用的素材。</span><span>PNG SEQUENCE / SPRITE SHEET</span></footer>
      </main>
      <aside className="output-panel"><div className="panel-heading"><span className="eyebrow">03 / FINISH</span><h2>打磨你的动画</h2><p>抽帧、抠图，然后带走。</p></div><div className="section-title"><Scissors size={17} /><h3>抽取序列帧</h3></div><label className="section-label">输出帧数</label><div className="segmented frame-options">{FRAME_COUNTS.map(n => <button key={n} className={count === n ? 'selected' : ''} disabled={locked} onClick={() => setCount(n)}>{n}<span>帧</span></button>)}</div><div className="range-label"><span>截取时间段</span><span className="micro">{source?.duration.toFixed(2) || '0.00'} s</span></div><div className="time-inputs"><label>起点<input aria-label="截取起点" type="number" min="0" max={source?.duration || 0} step="0.1" value={start} disabled={!source || locked} onChange={e => setStart(Number(e.target.value))} /></label><span>—</span><label>终点<input aria-label="截取终点" type="number" min="0" max={source?.duration || 0} step="0.1" value={end} disabled={!source || locked} onChange={e => setEnd(Number(e.target.value))} /></label></div><div className="setting-row"><label htmlFor="edge">最长边尺寸</label><select id="edge" value={maxEdge} disabled={locked} onChange={e => setMaxEdge(Number(e.target.value))}>{[256, 512, 1024].map(n => <option key={n} value={n}>{n} px</option>)}</select></div><IconButton icon={Scissors} className="secondary full-width extract-button" disabled={!source || locked} onClick={() => run('正在准备抽帧', signal => takeFrames(sourceRef.current, start, end, signal))}>{original.length ? '重新抽帧' : '抽取序列帧'}</IconButton>{stale ? <p className="inline-hint amber-text">参数已更新，重新抽帧后生效。</p> : <p className="inline-hint"><Check size={12} />等间隔采样 · 全部帧统一画布</p>}
        <div className="panel-divider" /><div className="section-title"><Sparkle size={17} /><h3>背景处理</h3>{cutout.length ? <span className="mini-status">已处理</span> : null}</div><div className="segmented bg-modes"><button className={mode === 'ai' ? 'selected' : ''} disabled={locked} onClick={() => setMode('ai')}>AI 抠图</button><button className={mode === 'chroma' ? 'selected' : ''} disabled={locked} onClick={() => setMode('chroma')}>纯色抠图</button></div>{mode === 'ai' ? <p className="help-text">本地识别主体，输出透明 PNG。<br />适合简单主体；细节效果需预览检查。</p> : <div className="chroma-settings"><div className="setting-row"><label htmlFor="keyColor">背景颜色</label><input id="keyColor" type="color" value={keyColor} disabled={locked} onChange={e => setKeyColor(e.target.value)} /></div><label className="section-label" htmlFor="tolerance">颜色容差<TermTip term="颜色容差" /><span>{tolerance}</span></label><input id="tolerance" type="range" min="0" max="240" value={tolerance} disabled={locked} onChange={e => setTolerance(Number(e.target.value))} /></div>}<IconButton icon={Sparkle} className="secondary full-width" disabled={!original.length || locked} onClick={removeBackground}>{cutout.length ? '重新抠图' : '移除背景'}</IconButton>{cutout.length ? <label className="toggle-row"><span>显示透明结果</span><input type="checkbox" role="switch" checked={showCutout} disabled={locked} onChange={e => setShowCutout(e.target.checked)} /></label> : null}
        <div className="export-section"><div className="section-title"><DownloadSimple size={17} /><h3>导出素材</h3></div><label className="section-label" htmlFor="format">导出格式</label><select className="full-width format-select" id="format" disabled={locked} value={format} onChange={e => setFormat(e.target.value)}><option value="frames">PNG 图片集 + ZIP</option><option value="sheet">精灵图 + JSON + ZIP</option></select><div className="export-summary"><span>{frames.length || '—'} 帧</span><span>{frame ? `${frame.width} × ${frame.height}` : '统一尺寸'}</span><span>{cutout.length && showCutout ? 'RGBA' : 'PNG'}</span></div><IconButton icon={DownloadSimple} className="primary full-width export-button" disabled={!frames.length || locked} onClick={save}>一键导出<ArrowUpRight size={16} /></IconButton><p className="inline-hint">顺序命名 · 含播放速度与时间数据</p></div>
      </aside>
    </div>
    </div>
    {libraryOpen ? <Library target={libraryTarget} light={screen !== 'studio'} snapshot={screen !== 'studio' ? { name: '', original: [], cutout: [], fps: 8, sheetMode: true } : { name: assetName || source?.name || '未命名动画', original, cutout, fps, prompt, showCutout }} onOpen={openLibraryAsset} onClose={() => setLibraryOpen(false)} /> : null}
    {toolsOpen ? <SharedTools onClose={() => setToolsOpen(false)} onSendTo={(target, record) => { setToolsOpen(false); sendTo(target, record); }} /> : null}
    {busy ? <div className="busy-banner" role="status"><CircleNotch size={19} className="spin" /><span>{busy.label}</span>{busy.progress > 0 ? <progress max="1" value={busy.progress} /> : null}<button onClick={cancel}>取消</button></div> : null}
    {notice ? <div className={`toast ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.error ? <Info size={18} /> : <Check size={18} />}<span>{notice.text}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setNotice(null)}><X size={15} /></button></div> : null}
    {settings ? <div className="modal-backdrop" onClick={() => setSettings(false)}><section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={e => e.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">CONNECTIONS</span><h2 id="settings-title">连接你的创作工具</h2></div><button className="icon-button" aria-label="关闭设置" onClick={() => setSettings(false)}><X size={20} /></button></div><div className="connection-row"><Sparkle size={23} /><div><strong>Runway · 图生视频</strong><p>上传图片与动作描述，生成 5 或 10 秒视频。</p></div><span className={services.videoConfigured ? 'connected' : 'disconnected'}>{services.videoConfigured ? '已连接' : '待配置'}</span></div><p className="setup-copy">在项目根目录把 <code>.env.example</code> 复制为 <code>.env</code>，设置 <code>RUNWAYML_API_SECRET</code>，然后重启开发服务。密钥仅保存在后端。生成会消耗你的 Runway API 额度。</p><div className="connection-row"><Scissors size={23} /><div><strong>rembg · 本地 AI 抠图</strong><p>无需云端账号，选中的帧在本机处理。</p></div><span className={services.backgroundAvailable ? 'connected' : 'disconnected'}>{services.backgroundAvailable ? '可使用' : '未就绪'}</span></div><p className="setup-copy">{services.backgroundAvailable ? services.modelCached ? '轻量模型已就绪。复杂轮廓与毛发可能需要额外修整。' : '首次使用会下载轻量模型，可能需要稍等。' : '按 README 安装 Python 抠图依赖。纯色抠图与抽帧可直接使用。'}</p><div className="connection-row"><SquaresFour size={23} /><div><strong>Canva</strong><p>第一版使用本地导出，Canva 连接暂未接入。</p></div><span className="disconnected">后续可选</span></div><div className="modal-footer"><button className="secondary" onClick={refreshServices}><ArrowCounterClockwise size={15} />刷新连接状态</button><button className="primary" onClick={() => setSettings(false)}>返回工作台</button></div></section></div> : null}
  </div>;
}

