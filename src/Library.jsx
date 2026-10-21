import { useEffect, useRef, useState } from 'react';
import './library.css';
import { X } from '@phosphor-icons/react/dist/csr/X';
import { Stack } from '@phosphor-icons/react/dist/csr/Stack';
import { listAssets, saveAsset, getAsset, deleteAsset } from './lib/library.mjs';
import { exportArchive, downloadBlob } from './lib/media.mjs';
import { exportProjectArchive } from './lib/project-export.mjs';
import { projectBackupFilename } from './lib/download-name.mjs';
import { WORKBENCHES, assetKindLabel } from './lib/workbenches.mjs';
import { filterLibraryAssets, libraryAssetKind } from './lib/library-filter.mjs';

function AssetCard({ asset, working, onOpen, onOpenOriginal, onExport, onDelete, target }) {
  const [url, setUrl] = useState('');
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    const next = URL.createObjectURL(asset.thumbnail); setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [asset.thumbnail]);
  return <article className="asset-card" aria-label={asset.name}>
    <div className="asset-thumbnail checker"><img src={url || undefined} alt={`${asset.name}缩略图`} /></div>
    <h3 title={asset.name}>{asset.name}</h3>
    <p>{libraryAssetKind(asset.kind) === 'other' ? '其他素材' : assetKindLabel(asset.kind)} · {asset.frameCount} 帧 · {asset.width} × {asset.height}{asset.transparent ? ' · 含透明版' : ''}</p>
    <p className="muted">{new Date(asset.createdAt).toLocaleDateString('zh-CN')} · {(asset.bytes / 1024 / 1024).toFixed(1)} MB</p>
    {confirm ? <div className="asset-delete-confirm"><p>删除后无法从素材库恢复。已导出的文件会保留。</p><button disabled={working} onClick={onDelete}>确认删除</button><button disabled={working} onClick={() => setConfirm(false)}>取消删除</button></div>
      : <div className="asset-actions"><button className="primary" disabled={working} onClick={onOpen}>{target ? '导入当前工作台' : '继续编辑'}</button>{target && <button className="secondary" disabled={working} onClick={onOpenOriginal}>打开原项目</button>}<button className="secondary" disabled={working} onClick={onExport}>导出 ZIP</button><button className="text-button" disabled={working} onClick={() => setConfirm(true)}>删除</button></div>}
  </article>;
}
export function Library({ snapshot, onOpen, onClose, light = false, target }) {
  const dialog = useRef(null);
  const archiveInput = useRef(null);
  const [assets, setAssets] = useState([]), [loading, setLoading] = useState(true);
  const [name, setName] = useState(snapshot.name), [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');
  const [working, setWorking] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [imported, setImported] = useState(null), [importing, setImporting] = useState(false);
  useEffect(() => {
    dialog.current.showModal(); let alive = true;
    listAssets().then(items => { if (alive) setAssets(items); }).catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  async function perform(action) {
    if (working) return; setWorking(true); setError(''); setMessage(''); setImported(null);
    try { await action(); } catch (e) { setError(e.message); } finally { setWorking(false); }
  }
  async function saveCurrent(event) {
    event.preventDefault();
    await perform(async () => {
      const saved = await saveAsset({ ...snapshot, name });
      setAssets(items => [saved, ...items]); setSearch(''); setKind('all'); setMessage(`已保存「${saved.name}」`);
    });
  }
  async function importBackup(file) {
    if (!file) return;
    setImporting(true);
    try { await perform(async () => {
      const { importProjectToLibrary } = await import('./lib/project-import.mjs');
      const saved = await importProjectToLibrary(file);
      setAssets(items => [saved, ...items]); setSearch(''); setKind('all');
      setImported(saved);
    }); } finally { setImporting(false); }
  }
  const filtered = filterLibraryAssets(assets, search, kind);
  return <dialog ref={dialog} className={`library-modal${light ? ' light-library' : ''}`} aria-labelledby="library-title" onCancel={event => { event.preventDefault(); if (!working) onClose(); }}>
    <div className="modal-heading"><div><span className="eyebrow">LOCAL ASSET LIBRARY</span><h2 id="library-title">素材库 <span className="muted">{assets.length}</span></h2></div><button className="icon-button" disabled={working} aria-label="关闭素材库" onClick={onClose}><X size={20} /></button></div>
    <p className="library-note">素材保存在本机，刷新后可继续编辑。{target ? `当前导入目标：${WORKBENCHES.find(entry => entry.id === target)?.title || '视频抽帧'}。` : '点击作品回到对应的工作台。'}</p>
    <button className="primary" disabled={working || loading} onClick={() => archiveInput.current.click()}>导入项目 ZIP</button>
    <input ref={archiveInput} type="file" hidden aria-label="选择项目 ZIP" accept=".zip,application/zip" onChange={event => { const file = event.target.files[0]; event.target.value = ''; importBackup(file); }} />
    <p className="inline-hint">备份 ZIP · 最多 100 MB · 导入为新副本</p>
    <details className="library-help">
      <summary>恢复备份 · 3 步教学</summary>
      <ol>
        <li><strong>导入备份</strong>：点「导入项目 ZIP」，选择素材库导出的备份。</li>
        <li><strong>查看摘要</strong>：确认名称、工作台和帧数等信息。</li>
        <li><strong>打开继续编辑</strong>：点「打开恢复项目」，回到原工作台。</li>
      </ol>
      <p>导入只新增副本，保留当前编辑和原作品。旧备份未保存的源图无法补回；游戏 PNG / JSON 包不支持项目恢复。</p>
      <p>清除网站数据或更换浏览器会影响访问，请导出 ZIP 留存。</p>
    </details>
    {imported ? <section className="library-import-result" role="status" aria-label="ZIP 导入结果">
      <div><span className="import-success-label">校验通过 · 已新增副本</span><h3>{imported.name}</h3><p>{imported.projectInfo.title}</p>
        <div className="library-import-facts">{imported.projectInfo.facts.map(fact => <span key={fact}>{fact}</span>)}</div>
        <p>当前编辑和原库作品均保留。打开后恢复到该项目的原工作台。</p></div>
      <div className="library-import-actions"><button className="primary" disabled={working} onClick={() => perform(async () => onOpen(await getAsset(imported.id), null))}>打开恢复项目 →</button>
        <button className="secondary" disabled={working} onClick={() => setImported(null)}>暂时留在素材库</button></div>
    </section> : null}
    {!snapshot.sheetMode && <form className="library-save" onSubmit={saveCurrent}><label htmlFor="asset-name">当前动画名称<input id="asset-name" value={name} maxLength={80} disabled={working || !snapshot.original.length} onChange={event => setName(event.target.value)} placeholder="例如：骑士 · 行走" /></label><button className="primary" disabled={working || !snapshot.original.length || !name.trim()} type="submit">保存当前动画</button></form>}
    {snapshot.sheetMode ? <p className="inline-hint">在工作台保存完整编辑项目；跨工作台导入只使用输出图片。</p> : !snapshot.original.length ? <p className="inline-hint">先抽取序列帧，再保存到素材库。</p> : <p className="inline-hint">保存 {snapshot.original.length} 帧{snapshot.cutout.length ? '，包含原始版和透明版' : ''}；每次保存会新增一份素材。</p>}
    <label className="library-search" htmlFor="asset-search">查找素材<input id="asset-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="输入素材名称" /></label>
    <label className="library-search" htmlFor="asset-kind">素材类型<select id="asset-kind" value={kind} onChange={event => setKind(event.target.value)}><option value="all">全部类型</option>{WORKBENCHES.map(entry => <option key={entry.kind} value={entry.kind}>{entry.title}</option>)}<option value="other">其他素材（旧素材 / 未知类型）</option></select></label>
    {!loading && <p className="inline-hint" role="status">显示 {filtered.length} / {assets.length} 项</p>}
    {error ? <p className="library-error" role="alert">{error}</p> : null}{message ? <p className="library-message" role="status">{message}</p> : null}
    {working ? <p role="status" className="inline-hint">{importing ? '正在校验项目与图片，完成后新增副本；当前编辑保持不变…' : '正在处理素材，请稍等…'}</p> : null}
    {loading ? <p className="library-empty">正在读取素材库…</p> : filtered.length ? <div className="library-grid">{filtered.map(asset => <AssetCard key={asset.id} asset={asset} working={working} target={target}
      onOpen={() => perform(async () => { const record = await getAsset(asset.id); onOpen(record); })}
      onOpenOriginal={() => perform(async () => onOpen(await getAsset(asset.id), null))}
      onExport={() => perform(async () => { const record = await getAsset(asset.id); const frames = record.showCutout && record.cutout.length ? record.cutout : record.original; const blob = record.editorProject ? await exportProjectArchive(record) : await exportArchive(frames, record.fps, 'frames'); const filename = record.editorProject ? projectBackupFilename(record.name, record.id) : `frame-studio-${asset.id}.zip`; downloadBlob(blob, filename); setMessage(`已开始下载：${filename}`); })}
      onDelete={() => perform(async () => { await deleteAsset(asset.id); setAssets(items => items.filter(item => item.id !== asset.id)); setMessage(`已删除「${asset.name}」`); })} />)}</div> : <div className="library-empty"><Stack size={32} /><p>{assets.length ? '没有找到匹配的素材' : '还没有保存素材'}</p></div>}
    <p className="library-note">打开素材会替换工作台中的当前动画；未保存的动画请先保存。</p>
  </dialog>;
}
