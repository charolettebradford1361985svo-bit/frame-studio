export const BOX_COLORS = { collision: '#45a064', hurt: '#3688d2', attack: '#e46b54' };
export function rectangleBetween(a, b, width, height) {
  const clamp = (v, max) => Math.max(0, Math.min(max, Math.round(v)));
  const left = clamp(Math.min(a.x, b.x), width), top = clamp(Math.min(a.y, b.y), height);
  const right = clamp(Math.max(a.x, b.x), width), bottom = clamp(Math.max(a.y, b.y), height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}
export function moveBox(box, dx, dy, width, height) {
  return { ...box, x: Math.round(Math.max(0, Math.min(width - box.width, box.x + dx))), y: Math.round(Math.max(0, Math.min(height - box.height, box.y + dy))) };
}
export function sceneManifest(project, frames) {
  return { version: 1, kind: 'scene', coordinateSystem: 'sprite-local-pixels', stage: { width: 640, height: 400 },
    fps: project.fps, background: project.background ? 'background.png' : null, position: { x: project.x, y: project.y }, scale: project.scale, anchor: project.anchor,
    frames: frames.map((frame, index) => ({ file: `frames/frame-${String(index + 1).padStart(3, '0')}.png`, width: frame.width, height: frame.height,
      time: frame.time ?? index / project.fps, boxes: project.annotations[index]?.boxes || [], events: project.annotations[index]?.events || [] })) };
}
export function tileRectangles(width, height, tileWidth, tileHeight) {
  if (![width, height, tileWidth, tileHeight].every(v => Number.isInteger(v) && v > 0)) throw new Error('图块尺寸必须是正整数');
  const columns = Math.floor(width / tileWidth), rows = Math.floor(height / tileHeight);
  if (!columns || !rows) throw new Error('图块尺寸超过原图');
  if (columns * rows > 512) throw new Error('一次最多拆分 512 块，请增大图块尺寸');
  return Array.from({ length: columns * rows }, (_, i) => ({ x: i % columns * tileWidth, y: Math.floor(i / columns) * tileHeight, width: tileWidth, height: tileHeight }));
}
export function resizeMap(map, oldColumns, oldRows, columns, rows) {
  if (![columns, rows].every(v => Number.isInteger(v) && v > 0 && v <= 40)) throw new Error('地图行列需要在 1–40 之间');
  const result = Array(columns * rows).fill(-1);
  for (let y = 0; y < Math.min(oldRows, rows); y++) for (let x = 0; x < Math.min(oldColumns, columns); x++) result[y * columns + x] = map[y * oldColumns + x] ?? -1;
  return result;
}
export function paintMapCell(map, columns, rows, x, y, tile) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= columns || y >= rows) return map;
  const index = y * columns + x;
  if (map[index] === tile) return map;
  const next = map.slice(); next[index] = tile; return next;
}
export function seamDifference(rgba, width, height) {
  if (rgba.length !== width * height * 4 || width < 1 || height < 1) throw new Error('图块像素不完整');
  const distance = (a, b) => {
    const aa = rgba[a + 3] / 255, ba = rgba[b + 3] / 255;
    return (Math.abs(rgba[a] * aa - rgba[b] * ba) + Math.abs(rgba[a + 1] * aa - rgba[b + 1] * ba) + Math.abs(rgba[a + 2] * aa - rgba[b + 2] * ba) + Math.abs(rgba[a + 3] - rgba[b + 3])) / 4;
  };
  let horizontal = 0, vertical = 0;
  for (let y = 0; y < height; y++) horizontal += distance(y * width * 4, (y * width + width - 1) * 4);
  for (let x = 0; x < width; x++) vertical += distance(x * 4, ((height - 1) * width + x) * 4);
  return { horizontal: Math.round(horizontal / height * 10) / 10, vertical: Math.round(vertical / width * 10) / 10 };
}
export function terrainManifest(project, tiles) {
  return { version: 1, kind: 'terrain', image: 'tiles.png', mapImage: 'map.png', tileWidth: project.tileWidth, tileHeight: project.tileHeight,
    columns: project.columns, rows: project.rows, emptyTile: -1, tiles, cells: project.map };
}
