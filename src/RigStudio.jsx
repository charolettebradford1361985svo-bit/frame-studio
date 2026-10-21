import { useEffect, useRef, useState } from 'react';
import { TermTip } from './TermTip.jsx';
import { canvasBlob, downloadBlob, applyChroma } from './lib/media.mjs';
import { saveAsset } from './lib/library.mjs';
import { rememberPngSource, imagePng } from './lib/image-source.mjs';
import { remember, travel, acceptEditorShortcut } from './lib/editor-history.mjs';
import { worldMatrices, point, inverse, reparent, canParent, capturePose, samplePose, clampRect, hueVariant, movePivot, removePart as removeRigPart } from './lib/rig.mjs';
import './rig-studio.css';
import { draftValue } from './lib/draft-guard.mjs';
import { useDraftGuard, DraftNotice } from './DraftNotice.jsx';

const empty = () => ({name:'我的角色',source:null,parts:[],poses:[],selected:null,tool:'move',draft:null,size:{width:256,height:256},fps:8,count:12,hue:0,color:'#00ff00',tolerance:60});
function canvas(width,height) { const c=document.createElement('canvas'); c.width=width;c.height=height;return c; }
async function imageFrom(blob) { const bitmap=await createImageBitmap(blob);if(bitmap.width>4096||bitmap.height>4096||bitmap.width*bitmap.height>16e6){bitmap.close();throw new Error('图片请小于 4096 px，且不超过 1600 万像素');} const c=canvas(bitmap.width,bitmap.height); c.getContext('2d').drawImage(bitmap,0,0);bitmap.close();return rememberPngSource(c,blob); }
function renderRig(parts,size,hue=0) {
  const c=canvas(size.width,size.height),ctx=c.getContext('2d'),matrices=worldMatrices(parts);ctx.imageSmoothingEnabled=false;
  for(const part of parts) {if(!part.visible)continue;ctx.save();ctx.setTransform(...matrices.get(part.id));ctx.drawImage(part.image,-part.pivotX,-part.pivotY);ctx.restore();}
  if(hue) {const pixels=ctx.getImageData(0,0,c.width,c.height);pixels.data.set(hueVariant(pixels.data,hue));ctx.putImageData(pixels,0,0);}
  return c;
}
function demo() {
  const p=empty();p.name='测试角色 · 方块骑士';
  function part(name,width,height,color,x,y,parent=null,pivotX=width/2,pivotY=0) {
    const image=canvas(width,height),ctx=image.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,width,height);
    if(name==='头部'){ctx.fillStyle='#26372e';ctx.fillRect(9,15,5,5);ctx.fillRect(25,15,5,5);}
    return {id:crypto.randomUUID(),name,image,x,y,parent,pivotX,pivotY,rotation:0,visible:true};
  }
  const body=part('身体',42,64,'#567c68',128,88),head=part('头部',40,38,'#ebc5a1',0,-35,body.id),left=part('左臂',17,60,'#87ab92',-28,8,body.id),right=part('右臂',17,60,'#87ab92',28,8,body.id),leg1=part('左腿',18,61,'#324a3e',-12,61,body.id),leg2=part('右腿',18,61,'#324a3e',12,61,body.id);
  p.parts=[leg1,leg2,left,right,body,head];p.selected=body.id;
  const pose=capturePose(p.parts),swing=structuredClone(pose);swing[left.id].rotation=-35;swing[right.id].rotation=35;swing[leg1.id].rotation=18;swing[leg2.id].rotation=-18;
  p.poses=[pose,swing,pose];return p;
}
export default function RigStudio({visible=true,onHome,onLibrary,record,onBusyChange,onSendTo}) {
  const [project,setProject]=useState(empty),[history,setHistory]=useState({past:[],future:[]}),[message,setMessage]=useState('导入图片后框选部件，或先试用测试角色。'),[busy,setBusy]=useState(false),[playing,setPlaying]=useState(false),[frame,setFrame]=useState(0);
  const canvasRef=useRef(null),sourceInput=useRef(null),replaceInput=useRef(null),drag=useRef(null),loaded=useRef(null),latest=useRef(project);latest.current=project;
  const selected=project.parts.find(p=>p.id===project.selected);
  const draftGuard=useDraftGuard(draftValue('rig',project));
  const commit=next=>{setHistory(h=>remember(h,latest.current));setProject(next);};
  const update=patch=>commit({...project,...patch});
  const partUpdate=patch=>{
    if(selected&&('pivotX' in patch||'pivotY' in patch)){
      const x=patch.pivotX??selected.pivotX,y=patch.pivotY??selected.pivotY;
      update({parts:movePivot(project.parts,selected.id,x,y),poses:project.poses.map(pose=>capturePose(movePivot(project.parts.map(p=>({...p,...(pose[p.id]||{})})),selected.id,x,y)))});
    }else update({parts:project.parts.map(p=>p.id===project.selected?{...p,...patch}:p)});
  };
  function undo(direction) {setPlaying(false);const result=travel(history,project,direction);if(result){setProject(result.snapshot);setHistory(result.history);setMessage(direction==='undo'?'已撤销上一步。':'已重做。');}}
  async function run(action) {setBusy(true);setPlaying(false);try{await action();}catch(e){setMessage(e.message);}finally{setBusy(false);}}
  useEffect(()=>{onBusyChange?.(busy);},[busy,onBusyChange]);
  useEffect(()=>{if(!visible)setPlaying(false);},[visible]);
  useEffect(()=>{if(!playing||!visible)return;const timer=setInterval(()=>setFrame(n=>(n+1)%project.count),1000/project.fps);return()=>clearInterval(timer);},[playing,visible,project.fps,project.count]);
  useEffect(()=>{
    if(!record||record===loaded.current)return;loaded.current=record;
    run(async()=>{const stored=record.kind==='rig'?record.editorProject:null;
      if(stored?.parts?.length) {const parts=await Promise.all(stored.parts.map(async p=>({...p,image:await imageFrom(p.blob)})));const source=stored.source?await imageFrom(stored.source):null;const next={...empty(),...stored,name:record.name,parts,source,tool:'move',draft:null};commit(next);draftGuard.markSaved(draftValue('rig',next));}
      else {const image=await imageFrom((record.showCutout&&record.cutout?.length?record.cutout:record.original)[0].blob);const id=crypto.randomUUID();commit({...empty(),name:record.name,source:image,size:{width:image.width,height:image.height},parts:[{id,name:'完整角色',image,x:image.width/2,y:image.height/2,pivotX:image.width/2,pivotY:image.height/2,rotation:0,parent:null,visible:true}],selected:id});}
      setMessage('素材已载入。角色项目保留部件、关节和姿势。');});
  },[record]);
  useEffect(()=>{
    const c=canvasRef.current;if(!c||!visible)return;
    const split=project.tool==='split'&&project.source,size=split?{width:project.source.width,height:project.source.height}:project.size;
    c.width=size.width;c.height=size.height;const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;
    if(split){ctx.drawImage(project.source,0,0);if(project.draft){const r=project.draft;ctx.fillStyle='#d6aa2220';ctx.fillRect(r.x,r.y,r.width,r.height);ctx.strokeStyle='#d6aa22';ctx.lineWidth=Math.max(1,c.width/500);ctx.strokeRect(r.x,r.y,r.width,r.height);}return;}
    const parts=playing?samplePose(project.parts,project.poses,frame,project.count):project.parts;ctx.drawImage(renderRig(parts,project.size,project.hue),0,0);
    if(!playing&&parts.length){const matrices=worldMatrices(parts);for(const p of parts){if(!p.visible)continue;const m=matrices.get(p.id),joint=point(m,0,0);if(p.parent){const parent=point(matrices.get(p.parent),0,0);ctx.strokeStyle='#deac45';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(joint.x,joint.y);ctx.lineTo(parent.x,parent.y);ctx.stroke();}ctx.beginPath();ctx.arc(joint.x,joint.y,p.id===project.selected?5:3,0,Math.PI*2);ctx.fillStyle=p.id===project.selected?'#dd5f45':'#e4b947';ctx.fill();if(p.id===project.selected){ctx.save();ctx.setTransform(...m);ctx.strokeStyle='#557dab';ctx.lineWidth=1;ctx.strokeRect(-p.pivotX,-p.pivotY,p.image.width,p.image.height);ctx.restore();}}}
  },[project,playing,frame,visible]);
  useEffect(()=>{if(!visible)return;function key(e){if(busy||!acceptEditorShortcut(e))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo(e.shiftKey?'redo':'undo');}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();undo('redo');}else if(e.code==='Space'&&project.tool==='split'){e.preventDefault();confirmCrop();}else if(e.key==='Escape'&&project.draft){e.preventDefault();update({draft:null});}else if(selected&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const n=e.shiftKey?10:1;partUpdate({x:selected.x+(e.key==='ArrowLeft'?-n:e.key==='ArrowRight'?n:0),y:selected.y+(e.key==='ArrowUp'?-n:e.key==='ArrowDown'?n:0)});}}window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[visible,busy,project,history]);
  async function importSource(file) {if(!file)return;await run(async()=>{if(!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>30e6)throw new Error('请使用 30 MB 以内的 PNG、JPEG 或 WebP');const source=await imageFrom(file);commit({...empty(),name:file.name.replace(/\.[^.]+$/,''),source,size:{width:source.width,height:source.height},tool:'split'});setMessage('拖出矩形后按空格确认拆件。已有部件保留；遮挡部分需手动补画。');});}
  function confirmCrop(){const r=project.draft;if(!r?.width||!r?.height)return;const image=canvas(r.width,r.height);image.getContext('2d').drawImage(project.source,r.x,r.y,r.width,r.height,0,0,r.width,r.height);const id=crypto.randomUUID();update({parts:[...project.parts,{id,name:`部件 ${project.parts.length+1}`,image,x:r.x+r.width/2,y:r.y+r.height/2,pivotX:r.width/2,pivotY:r.height/2,rotation:0,parent:null,visible:true}],selected:id,draft:null});setMessage('已拆出部件；可以继续框选，完成后切换装配。');}
  function position(e){const box=e.currentTarget.getBoundingClientRect();return{x:(e.clientX-box.left)*e.currentTarget.width/box.width,y:(e.clientY-box.top)*e.currentTarget.height/box.height};}
  function pointerDown(e){if(busy||playing)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);const at=position(e);setHistory(h=>remember(h,project));
    if(project.tool==='split'&&project.source){drag.current={start:at,project,mode:'split'};setProject({...project,draft:clampRect(at,at,project.source.width,project.source.height)});return;}
    const matrices=worldMatrices(project.parts);let id=project.selected;
    if(project.tool==='move'){const hit=[...project.parts].reverse().find(p=>{if(!p.visible)return false;const local=point(inverse(matrices.get(p.id)),at.x,at.y);return local.x>=-p.pivotX&&local.y>=-p.pivotY&&local.x<p.image.width-p.pivotX&&local.y<p.image.height-p.pivotY;});if(hit)id=hit.id;}
    if(!id)return;const part=project.parts.find(p=>p.id===id);drag.current={start:at,project:{...project,selected:id},mode:project.tool,part,matrices};setProject({...project,selected:id});
  }
  function pointerMove(e){const d=drag.current;if(!d)return;const at=position(e),base=d.project;
    if(d.mode==='split'){setProject({...base,draft:clampRect(d.start,at,base.source.width,base.source.height)});return;}
    if(d.mode==='pivot'){const local=point(inverse(d.matrices.get(d.part.id)),at.x,at.y),px=Math.round(local.x+d.part.pivotX),py=Math.round(local.y+d.part.pivotY);
      setProject({...base,parts:movePivot(base.parts,d.part.id,px,py),poses:base.poses.map(pose=>capturePose(movePivot(base.parts.map(p=>({...p,...(pose[p.id]||{})})),d.part.id,px,py)))});return;}
    const parent=d.part.parent?d.matrices.get(d.part.parent):[1,0,0,1,0,0],a=point(inverse(parent),d.start.x,d.start.y),b=point(inverse(parent),at.x,at.y);
    setProject({...base,parts:base.parts.map(p=>p.id===d.part.id?{...p,x:Math.round(d.part.x+b.x-a.x),y:Math.round(d.part.y+b.y-a.y)}:p)});
  }
  async function renderedFrames(){const frames=[];for(let i=0;i<project.count;i++){const image=renderRig(samplePose(project.parts,project.poses,i,project.count),project.size,project.hue);frames.push({blob:await canvasBlob(image),...project.size,time:i/project.fps});}return frames;}
  async function storedProject(){const parts=await Promise.all(project.parts.map(async({image,...p})=>({...p,blob:await imagePng(image,canvasBlob)})));return {...project,parts,source:project.source?await imagePng(project.source,canvasBlob):null,draft:null,tool:'move'};}
  async function outputRecord(){if(!project.parts.length)throw new Error('请先添加部件');return{name:project.name,kind:'rig',original:await renderedFrames(),cutout:[],fps:project.fps,showCutout:false,editorProject:await storedProject()};}
  async function save(){if(project.draft){setMessage('先按空格确认部件，再保存角色项目。');return;}const savingDraft=draftValue('rig',project);await run(async()=>{await saveAsset(await outputRecord());draftGuard.markSaved(savingDraft);setMessage('角色、关节、配色和姿势已保存到素材库。');});}
  async function exportFiles(){await run(async()=>{const result=await outputRecord(),{zipSync,strToU8}=await import('fflate'),files={};for(const [i,f]of result.original.entries())files[`frames/frame_${String(i+1).padStart(3,'0')}.png`]=new Uint8Array(await f.blob.arrayBuffer());const rig=result.editorProject;for(const [i,p]of rig.parts.entries())files[`parts/part_${i+1}.png`]=new Uint8Array(await p.blob.arrayBuffer());files['rig.json']=strToU8(JSON.stringify({version:1,size:rig.size,fps:rig.fps,frameCount:rig.count,hue:rig.hue,poses:rig.poses,parts:rig.parts.map(({blob,...p},i)=>({...p,file:`parts/part_${i+1}.png`}))},null,2));downloadBlob(new Blob([zipSync(files,{level:0})],{type:'application/zip'}),'character-rig.zip');setMessage('已导出透明序列帧、独立部件和关节 JSON。参考骨架线不会导出。');});}
  async function replace(file){if(!file||!selected)return;await run(async()=>{const image=await imageFrom(file);partUpdate({image});setMessage('已替换选中部件，关节位置保持不变；尺寸变化可手动调整关节。');});}
  async function equipment(file){if(!file)return;await run(async()=>{const image=await imageFrom(file),id=crypto.randomUUID(),parent=project.selected;update({parts:[...project.parts,{id,name:'装备图层',image,parent:parent||null,x:parent?0:project.size.width/2,y:parent?0:project.size.height/2,pivotX:image.width/2,pivotY:image.height/2,rotation:0,visible:true}],selected:id});setMessage('装备已挂在所选关节下，拖动即可调整佩戴位置。');});}
  async function removeColor(){if(!selected)return;await run(async()=>{const input={blob:await canvasBlob(selected.image),width:selected.image.width,height:selected.image.height,time:0},out=await applyChroma([input],project.color,project.tolerance,()=>{});try{partUpdate({image:await imageFrom(out[0].blob)});}finally{out.forEach(f=>URL.revokeObjectURL(f.url));}setMessage('已去除选中部件的指定底色，支持撤销。');});}
  function removePart(){update({parts:removeRigPart(project.parts,selected.id),poses:project.poses.map(pose=>capturePose(removeRigPart(project.parts.map(p=>({...p,...(pose[p.id]||{})})),selected.id))),selected:null});}
  function changeParent(parent){try{update({parts:reparent(project.parts,selected.id,parent),poses:project.poses.map(pose=>capturePose(reparent(project.parts.map(p=>({...p,...(pose[p.id]||{})})),selected.id,parent)))});}catch(e){setMessage(e.message);}}
  const numeric=(label,value,change,min,max,step=1)=><label className="rig-field"><span>{label}<TermTip term={label}/></span><input type="number" aria-label={label} value={Math.round(value*100)/100} min={min} max={max} step={step} disabled={busy} onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n)&&n>=min&&n<=max)change(n);}}/></label>;
  return <section className="rig-studio" hidden={!visible}>
    <header className="rig-header"><button onClick={onHome} disabled={busy}>← 主界面</button><div><strong>角色装配工作台</strong><span>拆件 · 关节 · 换装 · 配色</span></div><button onClick={onLibrary} disabled={busy}>素材库</button><button disabled={busy||!history.past.length} onClick={()=>undo('undo')}>撤销</button><button disabled={busy||!history.future.length} onClick={()=>undo('redo')}>重做</button></header>
    <div className="rig-layout"><aside className="rig-panel">
      <h2>图片与部件</h2><input ref={sourceInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e=>{importSource(e.target.files[0]);e.target.value='';}}/><button className="rig-primary" disabled={busy} onClick={()=>sourceInput.current.click()}>导入角色图片</button><button disabled={busy} onClick={()=>{commit(demo());setMessage('已载入明确标注的测试角色；可体验拖动、关节和关键帧。');}}>试用测试角色</button>
      <div className="rig-tools"><button disabled={busy||!project.source} aria-pressed={project.tool==='split'} onClick={()=>update({tool:'split'})}>框选拆件</button><button disabled={busy} aria-pressed={project.tool==='move'} onClick={()=>update({tool:'move'})}>移动装配</button><button disabled={busy||!selected} aria-pressed={project.tool==='pivot'} onClick={()=>update({tool:'pivot'})}>拖动关节</button></div>
      {project.tool==='split'?<><button disabled={busy||!project.draft?.width} onClick={confirmCrop}>确认拆件 · 空格</button><p>每次自定义矩形，松开后等待确认。透明底图会保留透明像素；遮挡部位需手动补画。</p></>:<p>选择部件后拖动；方向键移动 1 px，Shift 移动 10 px。关节工具可在画布上直接拖动支点。</p>}
      <div className="rig-parts" aria-label="角色部件列表">{project.parts.map((p,i)=><button key={p.id} aria-pressed={p.id===project.selected} disabled={busy} onClick={()=>update({selected:p.id})}><span>{String(i+1).padStart(2,'0')} · {p.name}</span><small>{p.visible?'显示':'隐藏'}{p.parent?' · 子关节':''}</small></button>)}</div>
      <input ref={replaceInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e=>{replace(e.target.files[0]);e.target.value='';}}/>
      <button disabled={busy||!selected} onClick={()=>replaceInput.current.click()}>替换所选部件 / 装备</button><label className="rig-file">添加装备图层<input type="file" disabled={busy} accept="image/png,image/jpeg,image/webp" onChange={e=>{equipment(e.target.files[0]);e.target.value='';}}/></label>
      <p>各部件是独立图层。关节只控制位置和旋转，不自动生成被遮挡的内容。</p>
    </aside><main className="rig-center"><div className="rig-canvas-header"><strong>{project.tool==='split'?'原图拆分':'装配预览'}</strong><span>实际画布 {project.size.width} × {project.size.height} px</span></div><div className="rig-stage"><canvas ref={canvasRef} aria-label="角色装配画布" tabIndex={0} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}/></div>
      <div className="rig-playbar"><button disabled={!project.parts.length||busy} onClick={()=>{setFrame(0);setPlaying(!playing);}}>{playing?'暂停预览':'播放姿势动画'}</button><span>{playing?`第 ${frame+1} / ${project.count} 帧`:`${project.parts.length} 个部件 · ${project.poses.length} 个关键姿势`}</span><button disabled={!project.parts.length||busy} onClick={()=>update({poses:[...project.poses,capturePose(project.parts)]})}>记录当前姿势</button></div>
      <div className="rig-poses" aria-label="姿势关键帧">{project.poses.map((pose,i)=><div key={i}><button disabled={busy} onClick={()=>{setPlaying(false);update({parts:project.parts.map(p=>({...p,...(pose[p.id]||{})}))});}}>姿势 {i+1}</button><button aria-label={`更新姿势 ${i+1}`} disabled={busy} onClick={()=>update({poses:project.poses.map((v,j)=>i===j?capturePose(project.parts):v)})}>更新</button><button aria-label={`删除姿势 ${i+1}`} disabled={busy} onClick={()=>update({poses:project.poses.filter((_,j)=>i!==j)})}>×</button></div>)}</div><p className="rig-hint">关节线用于编辑，不会导出。姿势之间使用真实关节平移与旋转插值，适合简易摆动；复杂变形需单独修图。</p>
    </main><aside className="rig-panel">
      <h2>关节与图层</h2>{selected?<><label className="rig-field">部件名称<input aria-label="部件名称" disabled={busy} value={selected.name} onChange={e=>partUpdate({name:e.target.value})}/></label><label className="rig-field">父关节<select aria-label="父关节" disabled={busy} value={selected.parent||''} onChange={e=>changeParent(e.target.value)}><option value="">独立部件</option>{project.parts.filter(p=>p.id!==selected.id&&canParent(project.parts,selected.id,p.id)).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><div className="rig-grid">{numeric('位置 X',selected.x,n=>partUpdate({x:n}),-8192,8192)}{numeric('位置 Y',selected.y,n=>partUpdate({y:n}),-8192,8192)}{numeric('旋转角度',selected.rotation,n=>partUpdate({rotation:n}),-720,720)}{numeric('关节 X',selected.pivotX,n=>partUpdate({pivotX:n}),-8192,8192)}{numeric('关节 Y',selected.pivotY,n=>partUpdate({pivotY:n}),-8192,8192)}</div><label className="rig-check"><input type="checkbox" disabled={busy} checked={selected.visible} onChange={e=>partUpdate({visible:e.target.checked})}/> 显示部件</label><div className="rig-tools"><button disabled={busy} onClick={()=>{const i=project.parts.indexOf(selected);if(i>0){const p=[...project.parts];[p[i],p[i-1]]=[p[i-1],p[i]];update({parts:p});}}}>图层下移</button><button disabled={busy} onClick={()=>{const i=project.parts.indexOf(selected);if(i<project.parts.length-1){const p=[...project.parts];[p[i],p[i+1]]=[p[i+1],p[i]];update({parts:p});}}}>图层上移</button><button disabled={busy} onClick={removePart}>删除部件</button></div><details><summary>去除部件底色</summary><label className="rig-field">背景色<input aria-label="部件背景色" type="color" disabled={busy} value={project.color} onChange={e=>update({color:e.target.value})}/></label>{numeric('色差容差',project.tolerance,n=>update({tolerance:n}),0,442)}<button disabled={busy} onClick={removeColor}>去除所选底色</button></details></>:<p>先选择一个部件，再调整关节和层级。</p>}
      <h2>动画与配色</h2><div className="rig-grid">{numeric('画布宽',project.size.width,n=>update({size:{...project.size,width:Math.round(n)}}),16,2048)}{numeric('画布高',project.size.height,n=>update({size:{...project.size,height:Math.round(n)}}),16,2048)}{numeric('导出帧数',project.count,n=>update({count:Math.floor(n)}),2,36)}{numeric('播放 FPS',project.fps,n=>update({fps:n}),1,60)}{numeric('配色色相',project.hue,n=>update({hue:n}),-180,180)}</div><p>配色变体保留 Alpha，尽量保留明暗；超出色域会裁切。画布调整不缩放部件。</p>
      <h2>保存与流转</h2><label className="rig-field">作品名称<input aria-label="角色作品名称" disabled={busy} maxLength={80} value={project.name} onChange={e=>update({name:e.target.value})}/></label><button className="rig-primary" disabled={busy||!project.parts.length||Boolean(project.draft)} onClick={save}>保存角色项目</button><DraftNotice guard={draftGuard} saveLabel="保存角色项目" prerequisite={project.draft || !project.parts.length ? '先按空格确认部件，再保存角色项目。' : null} className="rig-help" /><button disabled={busy||!project.parts.length} onClick={exportFiles}>导出部件 + 动画 + JSON</button><button disabled={busy||!project.parts.length||!onSendTo} onClick={()=>run(async()=>{onSendTo('frames',await outputRecord());})}>送到动画工作台修图</button><button disabled={busy||!project.parts.length||!onSendTo} onClick={()=>run(async()=>{onSendTo('scene',await outputRecord());})}>送到场景与碰撞</button>
    </aside></div><footer className="rig-status" role="status">{busy?'正在处理，请稍候…':message}</footer>
  </section>;
}
export { RigStudio };
