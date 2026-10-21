export function zoomCanvasView(view, bounds, pointer, delta) {
  if (!delta || !bounds.width || !bounds.height) return view;
  const scale = Math.max(.25, Math.min(16, view.scale * Math.exp(-Math.max(-240, Math.min(240, delta)) * .002)));
  const ratio = scale / view.scale;
  const px = pointer.x - (bounds.left + bounds.width / 2 - view.x);
  const py = pointer.y - (bounds.top + bounds.height / 2 - view.y);
  return { scale, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio };
}
