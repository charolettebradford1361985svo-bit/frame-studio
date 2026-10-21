export function identity() { return [1, 0, 0, 1, 0, 0]; }
export function multiply(a, b) {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
}
export function point(matrix, x, y) { return { x: matrix[0]*x+matrix[2]*y+matrix[4], y: matrix[1]*x+matrix[3]*y+matrix[5] }; }
export function inverse(matrix) {
  const d = matrix[0]*matrix[3]-matrix[1]*matrix[2];
  if (Math.abs(d)<1e-10) throw new Error('无效关节变换');
  return [matrix[3]/d,-matrix[1]/d,-matrix[2]/d,matrix[0]/d,(matrix[2]*matrix[5]-matrix[3]*matrix[4])/d,(matrix[1]*matrix[4]-matrix[0]*matrix[5])/d];
}
export function localMatrix(part) {
  const angle = part.rotation*Math.PI/180, c=Math.cos(angle), s=Math.sin(angle);
  return [c,s,-s,c,part.x,part.y];
}
export function worldMatrices(parts) {
  const map=new Map(parts.map(p=>[p.id,p])), result=new Map(), visiting=new Set();
  function visit(id) {
    if (result.has(id)) return result.get(id);
    if (visiting.has(id)) throw new Error('关节层级不能形成循环');
    const part=map.get(id); if (!part) throw new Error('父关节不存在');
    visiting.add(id); const matrix=multiply(part.parent ? visit(part.parent) : identity(),localMatrix(part));
    visiting.delete(id); result.set(id,matrix); return matrix;
  }
  parts.forEach(p=>visit(p.id)); return result;
}
export function canParent(parts, id, parent) {
  if (!parent) return true;
  const map=new Map(parts.map(p=>[p.id,p])); const seen=new Set();
  while (parent) { if (parent===id || seen.has(parent) || !map.has(parent)) return false; seen.add(parent); parent=map.get(parent).parent; }
  return true;
}
export function reparent(parts, id, parent) {
  if (!canParent(parts,id,parent)) throw new Error('不能选择自身或下级关节');
  const matrices=worldMatrices(parts), world=matrices.get(id);
  const local=multiply(parent ? inverse(matrices.get(parent)) : identity(),world);
  return parts.map(p=>p.id===id ? {...p,parent:parent||null,x:local[4],y:local[5],rotation:Math.atan2(local[1],local[0])*180/Math.PI} : p);
}
export function movePivot(parts,id,pivotX,pivotY) {
  const part=parts.find(p=>p.id===id);if(!part)return parts;
  const dx=pivotX-part.pivotX,dy=pivotY-part.pivotY,angle=part.rotation*Math.PI/180;
  return parts.map(p=>p.id===id?{...p,pivotX,pivotY,x:p.x+dx*Math.cos(angle)-dy*Math.sin(angle),y:p.y+dx*Math.sin(angle)+dy*Math.cos(angle)}:p.parent===id?{...p,x:p.x-dx,y:p.y-dy}:p);
}
export function removePart(parts,id) {
  const matrices=worldMatrices(parts);
  return parts.filter(p=>p.id!==id).map(p=>p.parent===id?{...p,parent:null,x:matrices.get(p.id)[4],y:matrices.get(p.id)[5],rotation:Math.atan2(matrices.get(p.id)[1],matrices.get(p.id)[0])*180/Math.PI}:p);
}
export function capturePose(parts) { return Object.fromEntries(parts.map(({id,x,y,rotation})=>[id,{x,y,rotation}])); }
export function interpolatePose(parts, start, end, t) {
  t=Math.min(1,Math.max(0,t));
  return parts.map(p=>{const a=start[p.id]||p,b=end[p.id]||a,angle=(((b.rotation-a.rotation+180)%360+360)%360)-180;return {...p,x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,rotation:a.rotation+angle*t};});
}
export function samplePose(parts, poses, index, count) {
  if (!poses.length) return parts;
  if (poses.length===1) return interpolatePose(parts,poses[0],poses[0],0);
  const pos=Math.min(1,Math.max(0,index/Math.max(1,count-1)))*(poses.length-1), segment=Math.min(poses.length-2,Math.floor(pos));
  return interpolatePose(parts,poses[segment],poses[segment+1],pos-segment);
}
export function clampRect(start,end,width,height) {
  const x=Math.round(Math.max(0,Math.min(width,Math.min(start.x,end.x)))), y=Math.round(Math.max(0,Math.min(height,Math.min(start.y,end.y))));
  return {x,y,width:Math.round(Math.max(0,Math.min(width,Math.max(start.x,end.x))-x)),height:Math.round(Math.max(0,Math.min(height,Math.max(start.y,end.y))-y))};
}
// Rotate hue in YIQ space: luminance and alpha are retained; RGB is clipped to gamut.
export function hueVariant(pixels,degrees) {
  const out=new Uint8ClampedArray(pixels), radians=degrees*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
  for(let n=0;n<out.length;n+=4) {
    if (!out[n+3]) continue;
    const r=pixels[n],g=pixels[n+1],b=pixels[n+2],y=.299*r+.587*g+.114*b,i=.596*r-.274*g-.322*b,q=.211*r-.523*g+.312*b,ii=i*c-q*s,qq=i*s+q*c;
    out[n]=y+.956*ii+.621*qq; out[n+1]=y-.272*ii-.647*qq; out[n+2]=y-1.106*ii+1.703*qq;
  }
  return out;
}
