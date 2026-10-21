import { useId, useState } from 'react';
import './term-tip.css';

export const TERM_TIPS = {
  '同色系': '黑、灰、白分开判断，彩色比较色相和饱和程度。同一种原色至少有 3 个像素，且八成对应同一种参考色才统一；遇到异类或透明区域就保留，避免碎斑。',
  '对齐搜索范围 px': '在参考位置附近寻找相似图案，单位为像素。越大可寻找更远的偏移，但更容易匹配到相似的其他部位。',
  '匹配相似度': '比较选区内的颜色和透明度。越高表示图案越接近；姿势或遮挡变化时仍需检查预览，不代表一定对齐正确。',
  '色差容差': '比较像素与底色的颜色差距。越大，去除范围越广，也更容易误删主体；残底可小幅调大。',
  '颜色容差': '比较像素与底色的颜色差距。越大，去除范围越广，也更容易误删主体；残底可小幅调大。',
  '裁框底色容差': '用颜色差异区分底色与角色，决定自动裁框范围。越大，越多像素被当作底色；不会直接删除像素。',
  '安全边距 px': '自动裁框时，在角色四周多留几像素，避免耳朵、尾巴或动作被裁掉。',
  '播放 FPS': '每秒播放的帧数。越大播放越快；不会增加动画帧，也不会改变图片清晰度。',
  '透明蒙版': '用灰度查看透明度：白色不透明、黑色全透明、灰色半透明，便于检查漏抠与误删。',
};

export function TermTip({ term }) {
  const [open, setOpen] = useState(false), id = useId();
  if (!TERM_TIPS[term]) return null;
  return <span className="term-tip"><button type="button" className="term-tip-button" aria-label={`${term}小贴士`} aria-expanded={open} aria-controls={id} onClick={e => { e.preventDefault(); setOpen(!open); }}>?</button>{open && <span id={id} className="term-tip-text" role="note">{TERM_TIPS[term]}</span>}</span>;
}
