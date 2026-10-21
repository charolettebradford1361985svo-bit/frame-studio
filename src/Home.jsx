import { useEffect, useState } from 'react';
import { FilmStrip } from '@phosphor-icons/react/dist/csr/FilmStrip';
import { TreeStructure } from '@phosphor-icons/react/dist/csr/TreeStructure';
import { BoundingBox } from '@phosphor-icons/react/dist/csr/BoundingBox';
import { GridFour } from '@phosphor-icons/react/dist/csr/GridFour';
import { Stack } from '@phosphor-icons/react/dist/csr/Stack';
import { ArrowUpRight } from '@phosphor-icons/react/dist/csr/ArrowUpRight';
import { Play } from '@phosphor-icons/react/dist/csr/Play';
import { listAssets } from './lib/library.mjs';
import { WORKBENCHES, assetKindLabel } from './lib/workbenches.mjs';
import './home.css';

function WorkbenchIcon({ id }) {
  const Icon = { frames: FilmStrip, rig: TreeStructure, scene: BoundingBox, terrain: GridFour }[id];
  return <Icon size={30} weight="duotone" />;
}

function RecentAsset({ asset, onOpen, locked }) {
  const [url, setUrl] = useState();
  useEffect(() => {
    const next = URL.createObjectURL(asset.thumbnail); setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [asset.thumbnail]);
  return <button className="home-asset" disabled={locked} onClick={() => onOpen(asset.id)} aria-label={`打开素材 ${asset.name}`}>
    <div className="home-asset-image"><img src={url} alt="" /></div>
    <div className="home-asset-info"><strong>{asset.name}</strong><span>{assetKindLabel(asset.kind)} · {asset.frameCount} 帧 · {asset.width} × {asset.height}</span></div><ArrowUpRight size={18} />
  </button>;
}
export function Home({ onFrames, onWorkbench, onStudio, onLibrary, onTools, onAsset, onDemo, refreshKey, locked }) {
  const [assets, setAssets] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  useEffect(() => {
    let alive = true; setLoading(true); setError('');
    listAssets().then(items => { if (alive) setAssets(items); }).catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [refreshKey]);
  return <div className="home-page">
    <header className="home-header"><a href="#/" className="home-brand" aria-label="Frame Studio 首页"><img src="/frame-studio-logo.png" alt="" /><strong>Frame<span>Studio</span></strong></a><nav aria-label="主导航"><a href="#/" aria-current="page">首页</a><button disabled={locked} onClick={onFrames}>动画工作台</button><button disabled={locked} onClick={onLibrary}>素材库</button><button disabled={locked} onClick={onTools}>通用工具</button></nav><span className="home-local">本机创作</span></header>
    <main className="home-main"><section className="home-intro"><span className="home-kicker">你的游戏素材创作空间</span><h1>从素材，<span>到游戏里的每一帧。</span></h1><p>选择适合的工作台，逐步完成动画、角色与场景。<br className="home-break" />作品统一收进素材库，随时接着做。</p><div className="home-extra-actions"><button className="home-demo" disabled={locked} onClick={onStudio}><Play size={15} />视频抽帧<ArrowUpRight size={15} /></button><button className="home-demo" disabled={locked} onClick={onDemo}>试用示例视频</button></div></section>
    <section className="home-entries home-workbenches" aria-label="创作入口">{WORKBENCHES.map((entry, index) => <article key={entry.id} className={`home-entry home-workbench-${entry.id}`}><div className="home-entry-top"><WorkbenchIcon id={entry.id} /><span>0{index + 1} / CREATE</span></div><h2>{entry.title}</h2><p>{entry.description}</p><div className="home-capabilities">{entry.tools.map(tool => <span key={tool}>{tool}</span>)}</div><button disabled={locked} className="home-primary" onClick={() => onWorkbench(entry.id)}>进入{entry.title}<ArrowUpRight size={19} /></button></article>)}</section>
    <section className="home-shared" aria-label="共用工具"><div><Stack size={26} /><div><h2>共用素材库</h2><p>{loading || error ? '读取中' : `${assets.length} 份素材`} · 保存项目，跨工作台继续编辑</p></div></div><button disabled={locked} className="home-secondary" onClick={onLibrary}>打开素材库</button><button disabled={locked} className="home-secondary" onClick={onTools}>高清 / 抠图 / 规格检查</button></section>
    <section className="home-recent"><div className="home-section-heading"><div><h2>最近保存</h2><p>你做过的每一帧，都值得留下。</p></div><button disabled={locked} onClick={onLibrary}>查看全部<ArrowUpRight size={16} /></button></div>
    {error ? <p className="home-empty" role="alert">素材库暂时无法读取：{error}</p> : loading ? <p className="home-empty">正在读取你的素材…</p> : assets.length ? <div className="home-recent-grid">{assets.slice(0, 4).map(asset => <RecentAsset key={asset.id} asset={asset} onOpen={onAsset} locked={locked} />)}</div> : <div className="home-empty"><Stack size={24} /><div><strong>你的素材库，等第一份作品入驻。</strong><p>在工作台完成裁帧和校准后，点击「保存到素材库」。</p></div></div>}
    </section><footer className="home-footer"><span>Frame Studio · 从灵感到游戏素材</span><span>素材保存在当前浏览器本机 · 建议导出备份</span></footer></main>
  </div>;
}

