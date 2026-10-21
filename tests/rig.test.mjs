import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {saveAsset,getAsset,deleteAsset} from '../src/lib/library.mjs';
import {worldMatrices,point,reparent,canParent,interpolatePose,samplePose,clampRect,hueVariant,movePivot,removePart} from '../src/lib/rig.mjs';
const parts=[{id:'body',x:100,y:100,rotation:90,parent:null},{id:'arm',x:20,y:0,rotation:0,parent:'body'}];
test('child joints follow rotated parent and reparent preserves world placement',()=>{
  const before=worldMatrices(parts); assert.deepEqual(point(before.get('arm'),0,0),{x:100,y:120});
  const changed=reparent(parts,'arm',null),after=worldMatrices(changed);
  before.get('arm').forEach((n,i)=>assert.ok(Math.abs(n-after.get('arm')[i])<1e-8));
  assert.equal(canParent(parts,'body','arm'),false); assert.throws(()=>reparent(parts,'body','arm'));
});
test('pose interpolation takes short angular path and uses both end keyframes',()=>{
  const p=[{id:'head',x:0,y:0,rotation:350,parent:null}]; const a={head:{x:0,y:0,rotation:350}},b={head:{x:20,y:10,rotation:10}};
  assert.equal(interpolatePose(p,a,b,.5)[0].rotation,360);
  assert.equal(interpolatePose(p,{head:{x:0,y:0,rotation:720}},{head:{x:0,y:0,rotation:-720}},.5)[0].rotation,720);
  assert.equal(samplePose(p,[a,b],0,12)[0].x,0); assert.equal(samplePose(p,[a,b],11,12)[0].x,20);
});
test('crop rect handles reverse drag and clamps to actual image',()=>{
  assert.deepEqual(clampRect({x:80,y:60},{x:-12,y:120},100,100),{x:0,y:60,width:80,height:40});
});
test('palette variants preserve alpha and leave transparent pixels alone',()=>{
  const src=new Uint8ClampedArray([200,30,80,170,20,30,40,0]); const out=hueVariant(src,90);
  assert.equal(out[3],170); assert.deepEqual([...out.slice(4)],[20,30,40,0]); assert.notDeepEqual([...out.slice(0,3)],[200,30,80]);
});
test('missing and circular parent links are rejected rather than hanging',()=>{
  assert.throws(()=>worldMatrices([{...parts[0],parent:'missing'}]));
  assert.throws(()=>worldMatrices([{...parts[0],parent:'arm'},parts[1]]));
});
test('moving pivot preserves image position and child joint world position',()=>{
  const original=[{...parts[0],pivotX:12,pivotY:8},{...parts[1],pivotX:3,pivotY:4}];
  const changed=movePivot(original,'body',20,12),a=worldMatrices(original),b=worldMatrices(changed);
  const beforeImage=point(a.get('body'),-12,-8),afterImage=point(b.get('body'),-20,-12);
  assert.ok(Math.abs(beforeImage.x-afterImage.x)<1e-8);assert.ok(Math.abs(beforeImage.y-afterImage.y)<1e-8);
  assert.deepEqual(point(a.get('arm'),0,0),point(b.get('arm'),0,0));
  assert.deepEqual(point(worldMatrices(removePart(original,'body')).get('arm'),0,0),point(a.get('arm'),0,0));
});
test('rig library project roundtrip keeps editable parts, joint hierarchy, poses and palette',async()=>{
  const blob=new Blob(['part pixels'],{type:'image/png'}),pose={body:{x:32,y:24,rotation:12}};
  const editorProject={size:{width:64,height:64},parts:[{id:'body',blob,parent:null,pivotX:8,pivotY:2,x:32,y:24,rotation:12,visible:true}],poses:[pose],hue:30,count:12,source:blob};
  const saved=await saveAsset({name:'关节项目测试',kind:'rig',fps:8,original:[{blob,width:64,height:64,time:0}],editorProject});
  try{const result=await getAsset(saved.id);assert.equal(result.kind,'rig');assert.deepEqual(result.editorProject.poses,[pose]);assert.equal(result.editorProject.parts[0].pivotX,8);assert.equal(result.editorProject.hue,30);assert.equal(await result.editorProject.parts[0].blob.text(),'part pixels');assert.equal(await result.editorProject.source.text(),'part pixels');}finally{await deleteAsset(saved.id);}
});
