import test from 'node:test';
import assert from 'node:assert/strict';
import { enhancePixels } from '../src/lib/image-enhancement.mjs';
import { remember, travel, guideHit, dragGuide, HISTORY_LIMIT, acceptEditorShortcut } from '../src/lib/editor-history.mjs';
import { zoomCanvasView } from '../src/lib/canvas-zoom.mjs';

test('wheel preview zoom keeps the pixel under the pointer fixed and clamps magnification', () => {
  const view = {scale:2,x:30,y:-20}, bounds = {left:100,top:50,width:400,height:200}, pointer = {x:180,y:90};
  const next = zoomCanvasView(view,bounds,pointer,-100);
  assert.ok(next.scale>view.scale);
  for(const [axis,start,length] of [['x','left','width'],['y','top','height']]) {
    const center = bounds[start] + bounds[length]/2 - view[axis];
    assert.ok(Math.abs((pointer[axis]-center-view[axis])/view.scale - (pointer[axis]-center-next[axis])/next.scale)<1e-10);
  }
  const smaller = zoomCanvasView(view,bounds,pointer,100);
  assert.ok(smaller.scale<view.scale);
  assert.equal(zoomCanvasView({scale:16,x:0,y:0},bounds,pointer,-100).scale,16);
  assert.equal(zoomCanvasView({scale:.25,x:0,y:0},bounds,pointer,100).scale,.25);
  assert.deepEqual(view,{scale:2,x:30,y:-20});
  assert.equal(zoomCanvasView(view,bounds,pointer,0),view);
});

test('modal teaching and controls cannot confirm crops, move parts or undo the background workbench', () => {
  const target = (...ancestors) => ({ closest: selector => ancestors.some(name => selector.split(',').map(s => s.trim()).includes(name)) ? {} : null });
  for (const key of [' ', 'Escape', 'ArrowRight', 'z', 'y']) {
    assert.equal(acceptEditorShortcut({ key, ctrlKey: key === 'z' || key === 'y', target: target('dialog[open]') }), false);
  }
  for (const ancestor of ['input', 'textarea', 'select', 'summary', '[role="textbox"]']) {
    assert.equal(acceptEditorShortcut({ key: ' ', target: target(ancestor) }), false);
    assert.equal(acceptEditorShortcut({ key: 'z', ctrlKey: true, target: target(ancestor) }), false);
  }
  assert.equal(acceptEditorShortcut({ target: { ...target(), isContentEditable: true } }), false);
  assert.equal(acceptEditorShortcut({ defaultPrevented: true, target: target() }), false);
  assert.equal(acceptEditorShortcut({ target: null }), false);
  assert.equal(acceptEditorShortcut({ key: 'ArrowRight', target: target('button') }), false);
  assert.equal(acceptEditorShortcut({ key: ' ', target: target('a') }), false);
  assert.equal(acceptEditorShortcut({ key: ' ', target: target() }), true);
  assert.equal(acceptEditorShortcut({ key: 'z', ctrlKey: true, target: target('button') }), true);
  assert.equal(acceptEditorShortcut({ key: 'z', metaKey: true, target: target() }), true);
});

test('undo and redo restore the entire editor state and a new edit clears the redo branch', () => {
  const source = { image: {} }, pixels = { image: {} };
  const initial = { sheet: source, rects: [], draftRect: null, frames: [], reference: 'none', lines: { center: 20 }, fps: 8 };
  const cropped = { ...initial, rects: [{ x: 2, y: 3, width: 40, height: 40 }], frames: [pixels], reference: 'previous' };
  const adjusted = { ...cropped, lines: { center: 30 }, fps: 12 };
  let history = remember({ past: [], future: [] }, initial);
  history = remember(history, cropped);
  const undo = travel(history, adjusted, 'undo'); assert.deepEqual(undo.snapshot, cropped);
  const undoAgain = travel(undo.history, undo.snapshot, 'undo'); assert.deepEqual(undoAgain.snapshot, initial);
  const redo = travel(undoAgain.history, initial, 'redo'); assert.deepEqual(redo.snapshot, cropped);
  const redoAgain = travel(redo.history, cropped, 'redo'); assert.deepEqual(redoAgain.snapshot, adjusted);
  assert.equal(redoAgain.snapshot.frames[0], pixels); assert.equal(redoAgain.snapshot.sheet, source);
  assert.equal(travel(remember(undo.history, cropped), adjusted, 'redo'), null);
  for (let i = 0; i < 100; i++) history = remember(history, { i });
  assert.equal(history.past.length, HISTORY_LIMIT); assert.equal(history.past.at(-1).i, 99);
  assert.equal(travel({ past: [], future: [] }, initial, 'undo'), null);
});
test('guide dragging targets visible lines, keeps valid bounds and does not modify source lines', () => {
  const lines = { left: 10, right: 90, top: 15, bottom: 85, center: 50 }, size = { width: 100, height: 100 };
  for (const [point, key] of [[{ x: 50, y: 30 }, 'center'], [{ x: 20, y: 85 }, 'bottom'], [{ x: 10, y: 30 }, 'left'], [{ x: 90, y: 30 }, 'right'], [{ x: 30, y: 15 }, 'top'], [{ x: 30, y: 40 }, 'box']]) assert.equal(guideHit(point, lines, 3), key);
  assert.equal(guideHit({ x: 0, y: 0 }, lines, 3), null);
  assert.deepEqual(dragGuide(lines, 'center', 80, 0, size), { ...lines, center: 100 });
  assert.deepEqual(dragGuide(lines, 'left', 100, 0, size), { ...lines, left: 89 });
  assert.deepEqual(dragGuide(lines, 'bottom', 0, -100, size), { ...lines, bottom: 16 });
  assert.deepEqual(dragGuide(lines, 'box', 50, -50, size), { ...lines, left: 20, right: 100, top: 0, bottom: 70 });
  assert.equal(lines.center, 50);
});

test('integer enhancement preserves every RGBA pixel and frame-relative positions', () => {
  const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0, 15, 20, 25, 128, 30, 40, 50, 255]);
  for (const scale of [1, 2, 4]) {
    const result = enhancePixels(data, 2, 2, scale);
    assert.equal(result.width, 2 * scale); assert.equal(result.height, 2 * scale);
    for (let y = 0; y < result.height; y++) for (let x = 0; x < result.width; x++) {
      const expected = (Math.floor(y / scale) * 2 + Math.floor(x / scale)) * 4;
      assert.deepEqual([...result.data.slice((y * result.width + x) * 4, (y * result.width + x) * 4 + 4)], [...data.slice(expected, expected + 4)]);
    }
  }
});
test('sharpening preserves transparency, avoids transparent-edge darkening and respects limits', () => {
  const source = new Uint8ClampedArray([0, 0, 0, 0, 100, 100, 100, 255, 150, 150, 150, 255]);
  const result = enhancePixels(source, 3, 1, 1, true).data;
  assert.equal(result[3], 0); assert.equal(result[7], 255); assert.equal(result[11], 255);
  assert.ok(result[4] < 100); assert.ok(result[8] > 150); assert.equal(source[4], 100);
  assert.deepEqual([...enhancePixels(new Uint8ClampedArray([0,0,0,0,100,100,100,255]),2,1,1,true).data], [0,0,0,0,100,100,100,255]);
  assert.throws(() => enhancePixels(source, 3, 1, 3)); assert.throws(() => enhancePixels(source, 3, 2, 2));
  assert.throws(() => enhancePixels(source, 2048, 2048, 4));
});
import { gridRects, clampRect, alphaBounds, anchorShift, validCanvas, detectSheetBackground, detectSubjectBounds, subjectRects, containAlignedBounds, confirmRect, referenceIndex } from '../src/lib/sprite-editor.mjs';
test('previous and next onion references follow the active frame and wrap animation endpoints', () => {
  for (const count of [6, 12, 24, 36]) {
    assert.equal(referenceIndex('previous', 0, count), count - 1);
    assert.equal(referenceIndex('next', count - 1, count), 0);
    assert.equal(referenceIndex('previous', 3, count), 2); assert.equal(referenceIndex('next', 3, count), 4);
    assert.equal(referenceIndex(2, 3, count), 2); assert.equal(referenceIndex(3, 3, count), null);
  }
  assert.equal(referenceIndex('previous', 0, 1), null); assert.equal(referenceIndex('next', 0, 0), null);
  assert.equal(referenceIndex(99, 0, 12), null);
  assert.equal(referenceIndex('none', 0, 12), null);
});
test('six grid crops cover non-divisible source exactly without lost edge pixels', () => {
  const rs = gridRects(1001, 667); assert.equal(rs.length, 6);
  assert.equal(rs.reduce((n, r) => n + r.width * r.height, 0), 1001 * 667);
  assert.equal(rs[5].x + rs[5].width, 1001); assert.equal(rs[5].y + rs[5].height, 667);
});
test('custom crop rectangles stay inside image and preserve requested shared size', () => {
  assert.deepEqual(clampRect({ x: 999, y: -5, width: 128, height: 64 }, 400, 300), { x: 272, y: 0, width: 128, height: 64 });
  assert.deepEqual(clampRect({ x: 0, y: 0, width: 0, height: 500 }, 400, 300), { x: 0, y: 0, width: 1, height: 300 });
});
test('alpha outline and shared anchor align character positions without scaling', () => {
  const pixels = new Uint8ClampedArray(8 * 8 * 4);
  for (let y = 2; y < 6; y++) for (let x = 1; x < 4; x++) pixels[(y * 8 + x) * 4 + 3] = 255;
  assert.deepEqual(alphaBounds(pixels, 8, 8), { left: 1, top: 2, right: 4, bottom: 6 });
  for (const point of [{ x: 2.5, y: 6 }, { x: 6, y: 3 }]) { const s = anchorShift(point, { x: 4, y: 7 }); assert.equal(point.x + s.dx, 4); assert.equal(point.y + s.dy, 7); }
  assert.equal(alphaBounds(new Uint8ClampedArray(256), 8, 8), null);
});
test('invalid trim bounds and excessive working memory fail before canvas creation', () => {
  assert.throws(() => validCanvas(-5, 100)); assert.throws(() => validCanvas(4096, 4096, 6)); assert.throws(() => validCanvas(1.5, 100));
  assert.deepEqual(validCanvas(512, 512, 36), { width: 512, height: 512 });
});
test('12 and 24 frame grids preserve reading order and reject invalid layouts', () => {
  for (const [columns, rows] of [[3, 4], [6, 4], [4, 6]]) {
    const rs = gridRects(601, 803, columns, rows);
    assert.equal(rs.length, columns * rows); assert.equal(rs[columns].x, 0);
    assert.equal(rs.at(-1).x + rs.at(-1).width, 601); assert.equal(rs.at(-1).y + rs.at(-1).height, 803);
  }
  for (const [columns, rows] of [[0, 4], [3.5, 4], [7, 6]]) assert.throws(() => gridRects(100, 100, columns, rows));
});
function greenImage(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) { data[i + 1] = 255; data[i + 3] = 255; }
  return data;
}
function paintRect(data, width, x, y, w, h) {
  for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) { const i = (row * width + col) * 4; data[i] = 120; data[i + 1] = 40; data[i + 2] = 60; data[i + 3] = 255; }
}
test('connected ears and nose beyond a grid or manual box are retained with common margin', () => {
  const width = 120, height = 80, data = greenImage(width, height);
  paintRect(data, width, 42, 25, 14, 30); paintRect(data, width, 54, 35, 13, 8); // nose crosses x=60 grid boundary
  paintRect(data, width, 45, 15, 5, 12); // ear above proposed manual rectangle
  paintRect(data, width, 85, 25, 12, 30);
  const originals = gridRects(width, height, 2, 1), background = detectSheetBackground(data, width, height);
  assert.deepEqual(background, [0, 255, 0]);
  const result = detectSubjectBounds(data, width, height, originals, background);
  assert.deepEqual(result.bounds[0], { left: 42, top: 15, right: 67, bottom: 55 });
  assert.deepEqual(result.bounds[1], { left: 85, top: 25, right: 97, bottom: 55 });
  const rs = subjectRects(result.bounds, originals, width, height, 4, true);
  assert.equal(rs[0].width, rs[1].width); assert.equal(rs[0].height, rs[1].height);
  result.bounds.forEach((b, i) => { assert.ok(rs[i].x <= b.left - 4 && rs[i].x + rs[i].width >= b.right + 4); assert.ok(rs[i].y <= b.top - 4 && rs[i].y + rs[i].height >= b.bottom + 4); });
  const manual = detectSubjectBounds(data, width, height, [{ x: 43, y: 26, width: 13, height: 29 }], background);
  assert.deepEqual(manual.bounds[0], result.bounds[0]);
});
test('transparent sheet detection preserves foreground pixels independently of RGB', () => {
  const data = new Uint8ClampedArray(40 * 40 * 4); paintRect(data, 40, 5, 4, 14, 20);
  assert.equal(detectSheetBackground(data, 40, 40), null);
  assert.deepEqual(detectSubjectBounds(data, 40, 40, gridRects(40, 40, 1, 1), null).bounds[0], { left: 5, top: 4, right: 19, bottom: 24 });
});
test('diagonally connected pixel-art tips crossing a cell edge remain with their character', () => {
  const data = greenImage(20, 12); paintRect(data, 20, 8, 5, 2, 2); paintRect(data, 20, 10, 7, 1, 1); paintRect(data, 20, 15, 4, 2, 4);
  const { bounds } = detectSubjectBounds(data, 20, 12, gridRects(20, 12, 2, 1), [0, 255, 0]);
  assert.deepEqual(bounds[0], { left: 8, top: 5, right: 11, bottom: 8 }); assert.equal(bounds[1].left, 15);
});
test('subjects at the original image edge get transparent padding instead of losing a safety margin', () => {
  const bounds = [{ left: 12, top: 5, right: 44, bottom: 35 }, { left: 70, top: 0, right: 100, bottom: 36 }];
  const rs = subjectRects(bounds, gridRects(100, 40, 2, 1), 100, 40, 8, true);
  assert.equal(rs[0].width, rs[1].width); assert.equal(rs[0].height, rs[1].height);
  bounds.forEach((b, i) => { assert.ok(rs[i].x <= b.left - 8 && rs[i].x + rs[i].width >= b.right + 8); assert.ok(rs[i].y <= b.top - 8 && rs[i].y + rs[i].height >= b.bottom + 8); });
  assert.ok(rs[1].y < 0 && rs[1].x + rs[1].width > 100);
  assert.deepEqual(confirmRect(rs, rs[1], 1, true, 100, 40)[1], rs[1]);
});
test('auto alignment grows one common canvas to contain every protruding frame without scaling', () => {
  const bounds = [{ left: -12, top: -5, right: 40, bottom: 105 }, { left: 30, top: 10, right: 115, bottom: 98 }];
  const result = containAlignedBounds({ width: 100, height: 100 }, bounds, 8);
  assert.deepEqual(result, { dx: 20, dy: 13, width: 143, height: 126 });
  for (const b of bounds) { assert.ok(b.left + result.dx >= 8 && b.top + result.dy >= 8); assert.ok(b.right + result.dx <= result.width - 8 && b.bottom + result.dy <= result.height - 8); }
});
test('only explicit confirmation commits a pending rectangle or edits an existing one', () => {
  const original = [{ x: 10, y: 10, width: 20, height: 30 }], draft = { x: 45, y: 12, width: 22, height: 32 };
  const next = confirmRect(original, draft, null, true, 100, 100);
  assert.equal(original.length, 1); assert.equal(original[0].width, 20);
  assert.equal(next.length, 2); assert.equal(next[0].width, 22);
  const edit = confirmRect(next, { ...draft, x: 60 }, 1, false, 100, 100);
  assert.equal(edit.length, 2); assert.equal(edit[1].x, 60); assert.equal(next[1].x, 45);
  assert.throws(() => confirmRect(Array(36).fill(original[0]), draft, null, false, 100, 100));
});
