export const WORKBENCHES = [
  { id: 'frames', kind: 'sheet', title: '动画工作台', subtitle: '裁帧、对齐与动画打磨', tools: ['时间轴', '局部修图', '补帧与图集'], description: '把一张拼图变成稳定的序列动画，逐帧修整、预览和导出。' },
  { id: 'rig', kind: 'rig', title: '角色装配工作台', subtitle: '拆分部件与关节动作', tools: ['拆件与关节', '装备换装', '配色与姿势'], description: '拆出头部和肢体，设置关节、组合装备，再制作关键姿势。' },
  { id: 'scene', kind: 'scene', title: '场景与碰撞工作台', subtitle: '把素材放进游戏情境', tools: ['场景试放', '碰撞与攻击框', '动作事件'], description: '在场景里检查实际比例，给每一帧标注交互范围和动作事件。' },
  { id: 'terrain', kind: 'terrain', title: '地形工作台', subtitle: '拼块与地图制作', tools: ['拆分拼块', '接缝检查', '地图预览'], description: '把地形素材切成拼块，检查重复接缝，画出自己的地图。' },
];
export const parseScreen = hash => {
  const id = hash.replace(/^#\//, '');
  return ['frames', 'rig', 'scene', 'terrain', 'studio'].includes(id) ? id : 'home';
};
export function destinationFor(record, requested) {
  if (['frames', 'rig', 'scene', 'terrain', 'studio'].includes(requested)) return requested;
  return WORKBENCHES.find(entry => entry.kind === record.kind)?.id || 'studio';
}
export function assetKindLabel(kind) { return WORKBENCHES.find(entry => entry.kind === kind)?.title || '动画素材'; }
// Called only after the ZIP record has passed project/image validation.
export function importedProjectInfo(record) {
  const project = record.editorProject, entry = WORKBENCHES.find(item => item.kind === record.kind);
  const facts = [`${record.original.length} 帧`];
  if (record.kind === 'rig') facts.push(`${project.parts.length} 个部件`, `${project.poses.length} 个关键姿势`);
  else if (record.kind === 'scene') {
    const annotations = project.settings.annotations.filter(Boolean);
    facts.push(`${annotations.reduce((n, item) => n + item.boxes.length, 0)} 个判定框`, `${annotations.reduce((n, item) => n + item.events.length, 0)} 个事件`);
  } else if (record.kind === 'terrain') {
    const s = project.settings; return { title: entry.title, facts: [`${s.columns} × ${s.rows} 格地图`, `${s.tileWidth} × ${s.tileHeight} px 图块`] };
  } else facts.push(`${project.size.width} × ${project.size.height} px 画布`);
  return { title: entry.title, facts };
}
export function recordForDestination(record, destination) {
  const nativeKind = WORKBENCHES.find(entry => entry.id === destination)?.kind;
  if (record.kind === nativeKind) return { ...record };
  const { editorProject, ...rendered } = record;
  return rendered;
}
