// Compare immutable editor metadata; image/Blob references are never copied.
export function sameDraft(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => sameDraft(value, b[i]));
  if (Object.getPrototypeOf(a) !== Object.prototype || Object.getPrototypeOf(b) !== Object.prototype) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameDraft(a[key], b[key]));
}
export function draftValue(kind, state) {
  if (kind === 'sheet') {
    const { sheet, rects, uniform, draftRect, draftIndex, columns, rows, padding, autoBackground, frames, size, draftSize, fps, onion, reference, guides, lines, keyColor, tolerance, name, playbackMode } = state;
    return { sheet, rects, uniform, draftRect, draftIndex, columns, rows, padding, autoBackground, frames, size, draftSize, fps, onion, reference, guides, lines, keyColor, tolerance, name, playbackMode };
  }
  const ignored = kind === 'rig' ? ['selected','tool','color','tolerance'] : kind === 'scene' ? ['playing','active'] : ['selected','erase'];
  return Object.fromEntries(Object.entries(state).filter(([key]) => !ignored.includes(key)));
}
export function protectDraft(target, dirty) {
  if (!dirty) return () => {};
  const warn = event => { event.preventDefault(); event.returnValue = true; };
  target.addEventListener('beforeunload', warn);
  return () => target.removeEventListener('beforeunload', warn);
}
