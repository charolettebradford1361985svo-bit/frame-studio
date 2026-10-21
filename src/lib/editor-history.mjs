export const HISTORY_LIMIT = 30;
// Modal and form keys belong to their controls, not the workbench behind them.
export function acceptEditorShortcut(event) {
  const target = event.target;
  if (event.defaultPrevented || !target?.closest || target.isContentEditable) return false;
  if (target.closest('dialog[open], input, textarea, select, summary, [role="textbox"]')) return false;
  if (!event.ctrlKey && !event.metaKey && target.closest('button, a')) return false;
  return true;
}
export function remember(history, current) {
  return { past: [...history.past.slice(-(HISTORY_LIMIT - 1)), current], future: [] };
}
export function travel(history, current, direction) {
  const from = direction === 'undo' ? history.past : history.future;
  if (!from.length) return null;
  return {
    snapshot: from.at(-1),
    history: direction === 'undo'
      ? { past: from.slice(0, -1), future: [...history.future, current] }
      : { past: [...history.past, current], future: from.slice(0, -1) },
  };
}

export function guideHit(point, lines, tolerance) {
  const candidates = [
    ['center', Math.abs(point.x - lines.center)],
    ['bottom', Math.abs(point.y - lines.bottom)],
    ['left', point.y >= lines.top - tolerance && point.y <= lines.bottom + tolerance ? Math.abs(point.x - lines.left) : Infinity],
    ['right', point.y >= lines.top - tolerance && point.y <= lines.bottom + tolerance ? Math.abs(point.x - lines.right) : Infinity],
    ['top', point.x >= lines.left - tolerance && point.x <= lines.right + tolerance ? Math.abs(point.y - lines.top) : Infinity],
  ].sort((a, b) => a[1] - b[1]);
  if (candidates[0][1] <= tolerance) return candidates[0][0];
  return point.x > lines.left && point.x < lines.right && point.y > lines.top && point.y < lines.bottom ? 'box' : null;
}
export function dragGuide(lines, hit, dx, dy, size) {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Math.round(value)));
  if (hit === 'box') {
    const x = clamp(dx, -lines.left, size.width - lines.right), y = clamp(dy, -lines.top, size.height - lines.bottom);
    return { ...lines, left: lines.left + x, right: lines.right + x, top: lines.top + y, bottom: lines.bottom + y };
  }
  const next = { ...lines };
  if (hit === 'center') next.center = clamp(lines.center + dx, 0, size.width);
  if (hit === 'left') next.left = clamp(lines.left + dx, 0, lines.right - 1);
  if (hit === 'right') next.right = clamp(lines.right + dx, lines.left + 1, size.width);
  if (hit === 'top') next.top = clamp(lines.top + dy, 0, lines.bottom - 1);
  if (hit === 'bottom') next.bottom = clamp(lines.bottom + dy, lines.top + 1, size.height);
  return next;
}
