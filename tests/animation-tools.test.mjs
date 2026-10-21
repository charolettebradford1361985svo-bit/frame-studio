import test from 'node:test';
import assert from 'node:assert/strict';
import { unifyRegionColors } from '../src/lib/color-unify.mjs';

test('unification keeps a uniform area intact when reference texture or pose is inconsistent', () => {
  const target = new Uint8ClampedArray(Array.from({length:10},()=>[80,80,80,255]).flat());
  for (const shades of [[120,120,120,120,120,60,60,60,60,60], [120,120,120,120,120,120,120,20,20,20]]) {
    const reference = new Uint8ClampedArray(shades.flatMap(v=>[v,v,v,255]));
    const out = unifyRegionColors(reference,target,10,1,{x:0,y:0,width:10,height:1});
    assert.equal(out.changed,0); assert.deepEqual(out.data,target);
  }
});
test('unification uses one dominant reference color without importing isolated speckles', () => {
  const target = new Uint8ClampedArray(Array.from({length:10},()=>[80,80,80,255]).flat());
  const reference = new Uint8ClampedArray([120,120,120,120,120,120,120,120,120,60].flatMap(v=>[v,v,v,255]));
  const out = unifyRegionColors(reference,target,10,1,{x:0,y:0,width:10,height:1});
  assert.equal(out.changed,10);
  assert.deepEqual([...out.data],Array.from({length:10},()=>[120,120,120,255]).flat());
  const isolated = unifyRegionColors(reference,target,10,1,{x:0,y:0,width:1,height:1});
  assert.equal(isolated.changed,0);
});

test('region color unification copies same-family shades while preserving other colors, alpha and source', () => {
  const reference = new Uint8ClampedArray(Array(3).fill([120,120,120,255, 180,180,180,255, 200,50,50,255, 100,100,100,255, 0,0,0,0, 60,60,60,255]).flat());
  const target = new Uint8ClampedArray(Array(3).fill([60,60,60,128, 80,80,80,255, 100,25,25,255, 100,20,20,255, 90,90,90,255, 40,40,40,0]).flat());
  const original = target.slice();
  const out = unifyRegionColors(reference,target,3,6,{x:0,y:0,width:3,height:6});
  assert.equal(out.changed,9); assert.equal(out.skipped,6);
  for (let row = 0; row < 3; row++) {
    assert.deepEqual([...out.data.slice(row*24,row*24+12)],[120,120,120,128,180,180,180,255,200,50,50,255]);
    assert.deepEqual(out.data.slice(row*24+12,row*24+24),target.slice(row*24+12,row*24+24));
  }
  assert.deepEqual(target,original);
});
test('unification keeps texture, limits edits to the selection and rejects dark colored pixels against gray', () => {
  const reference = new Uint8ClampedArray(Array(3).fill([80,80,80,255,160,160,160,255,120,120,120,255,200,200,200,255]).flat());
  const target = new Uint8ClampedArray(Array(3).fill([60,60,60,255,80,80,80,255,20,0,0,255,60,60,60,255]).flat());
  const out = unifyRegionColors(reference,target,4,3,{x:0,y:0,width:3,height:3});
  assert.equal(out.changed,6); assert.equal(out.skipped,3);
  for (let row = 0; row < 3; row++) {
    assert.deepEqual(out.data.slice(row*16,row*16+8),reference.slice(row*16,row*16+8));
    assert.deepEqual(out.data.slice(row*16+8,row*16+16),target.slice(row*16+8,row*16+16));
  }
  assert.equal(unifyRegionColors(reference,reference,4,3,{x:0,y:0,width:4,height:3}).changed,0);
});
test('unification protects black outlines and white highlights from gray in both directions', () => {
  const reference = new Uint8ClampedArray([120,120,120,255, 20,20,20,255, 140,140,140,255, 245,245,245,255, 100,70,70,255]);
  const target = new Uint8ClampedArray([20,20,20,255, 120,120,120,255, 245,245,245,255, 140,140,140,255, 30,21,21,128]);
  const out = unifyRegionColors(reference,target,5,1,{x:0,y:0,width:5,height:1});
  assert.equal(out.changed,0); assert.equal(out.skipped,5);
  assert.deepEqual(out.data,target);
});
import { timelineEntries, playbackSequence, frameDuration, reorderFrame, matchTranslation, translatePixels, translationSteps, inspectFrames, comparePixels, atlasLayout, regionRect } from '../src/lib/animation-tools.mjs';
import { remember, travel } from '../src/lib/editor-history.mjs';
import { initialPlacement, fitPlacement, previewSpriteRect, containImageRect } from '../src/lib/scene-preview.mjs';

test('scene preview places large and small shared canvases without changing originals', () => {
  const size = { width: 1192, height: 1320 }, frozen = Object.freeze({ ...size });
  const p = initialPlacement(frozen), r = previewSpriteRect(p, frozen);
  assert.equal(r.height, 280); assert.equal(r.top + r.height, 624);
  assert.equal(r.left + r.width / 2, 640); assert.deepEqual(frozen, size);
  assert.equal(initialPlacement({ width: 64, height: 80 }).scale, 1);
});

test('scene preview clamps scaling and drag to show the whole shared frame', () => {
  const size = { width: 1000, height: 500 };
  for (const input of [{ x: -900, y: -100, scale: 1 }, { x: 3000, y: 5000, scale: 50 }, { x: 0, y: 0, scale: 0 }]) {
    const p = fitPlacement(Object.freeze(input), size), r = previewSpriteRect(p, size);
    assert.ok(r.left >= 0 && r.top >= 0); assert.ok(r.left + r.width <= 1280 && r.top + r.height <= 800);
    assert.ok(p.scale > 0); assert.equal(p.scale, r.scale);
  }
});

test('scene background contains portrait and landscape without stretching', () => {
  for (const [w, h] of [[1586, 992], [400, 800], [2400, 500]]) {
    const r = containImageRect(w, h);
    assert.ok(Math.abs(r.width / r.height - w / h) < 1e-10);
    assert.ok(r.width <= 1280 && r.height <= 800);
    assert.equal(r.x * 2 + r.width, 1280); assert.equal(r.y * 2 + r.height, 800);
  }
});
function sample(w = 24, h = 20) { const data = new Uint8ClampedArray(w * h * 4); for (let y = 5; y < 13; y++) for (let x = 6; x < 11; x++) data.set([x * 17, y * 11, 89, 255], (y * w + x) * 4); return data; }
test('timeline keeps frame identity, variable duration and endpoint-safe pingpong', () => {
  assert.deepEqual(playbackSequence(4, 'pingpong'), [0, 1, 2, 3, 2, 1]); assert.deepEqual(playbackSequence(2, 'pingpong'), [0, 1]);
  assert.deepEqual(playbackSequence(3, 'reverse'), [2, 1, 0]); assert.deepEqual(playbackSequence(0), []);
  const frames = [{ duration: 350 }, { duration: null }, { duration: 90 }], moved = reorderFrame(frames, 0, 2);
  assert.equal(moved[2], frames[0]); assert.equal(frames[0].duration, 350); assert.equal(frameDuration(moved[2], 8), 350); assert.equal(frameDuration(frames[1], 8), 125);
});
test('filmstrip binds previews and durations to current frame identity through copy, delete, undo and redo', () => {
  const original = Array.from({ length: 6 }, (_, i) => ({ image: `image-${i}`, duration: null }));
  const copied = [...original]; copied.splice(1, 0, { ...original[0], duration: 250 });
  const render = frames => timelineEntries(frames, frame => frame.image);
  const priorStrip = render(copied), current = { frames: copied, active: 1, playbackMode: 'pingpong' };
  const history = remember({ past: [], future: [] }, current);
  const deleted = { ...current, frames: copied.filter((_, i) => i !== 1) }, currentStrip = render(deleted.frames);
  assert.equal(priorStrip.length, 7); assert.equal(currentStrip.length, 6);
  for (const [i, entry] of currentStrip.entries()) { assert.equal(entry.frame, deleted.frames[i]); assert.equal(entry.preview, deleted.frames[i].image); assert.equal(frameDuration(entry.frame, 8), 125); }
  const undo = travel(history, deleted, 'undo'), restoredStrip = render(undo.snapshot.frames);
  assert.equal(restoredStrip.length, 7); assert.equal(restoredStrip[1].frame, copied[1]); assert.equal(frameDuration(restoredStrip[1].frame), 250);
  const redo = travel(undo.history, undo.snapshot, 'redo'), redoneStrip = render(redo.snapshot.frames);
  assert.equal(redoneStrip.length, 6); assert.equal(redoneStrip.at(-1).frame, original.at(-1));
  assert.deepEqual(render([]), []);
});
test('local match detects true translation and rejects empty template', () => {
  const original = sample(), shifted = translatePixels(original, 24, 20, 3, -2);
  const match = matchTranslation(original, shifted, 24, 20, { x: 4, y: 3, width: 11, height: 12 }, 5);
  assert.equal(match.dx, -3); assert.equal(match.dy, 2); assert.equal(match.similarity, 1);
  assert.throws(() => matchTranslation(original, shifted, 24, 20, { x: 0, y: 0, width: 2, height: 2 }), /为空/);
});
test('rigid interpolation translates pixels, preserves alpha and never blends endpoints', () => {
  const data = sample(), steps = translationSteps(6, -3, 2); assert.deepEqual(steps, [{ dx: 2, dy: -1 }, { dx: 4, dy: -2 }]);
  const mid = translatePixels(data, 24, 20, steps[0].dx, steps[0].dy);
  assert.deepEqual([...mid.slice((4 * 24 + 8) * 4, (4 * 24 + 8) * 4 + 4)], [102, 55, 89, 255]);
  assert.equal(mid.filter((v, i) => i % 4 === 3 && v === 255).length, 40); assert.throws(() => translationSteps(0, 0, 0));
});
test('checks distinguish blank, duplicate, edge and loop differences', () => {
  const original = sample(), blank = new Uint8ClampedArray(original.length), moved = translatePixels(original, 24, 20, 1, 0);
  const issues = inspectFrames([original, original, blank].map(data => ({ data, width: 24, height: 20 })), { width: 24, height: 20 });
  assert.equal(issues.length, 2); assert.match(issues[0], /重复/); assert.match(issues[1], /空白/);
  assert.equal(comparePixels(original, original).changedRatio, 0); assert.ok(comparePixels(original, moved).changedRatio > 0);
});
test('trimmed atlas retains original size, offsets, duration and anchor without overlapping', () => {
  const bounds = [{ left: 3, top: 7, right: 9, bottom: 16 }, null, { left: 8, top: 2, right: 22, bottom: 6 }];
  const layout = atlasLayout(bounds, { width: 24, height: 20 }, { x: 12, y: 18 }, [125, 350, 90]);
  assert.deepEqual(layout.frames[0].spriteSourceSize, { x: 3, y: 7, w: 6, h: 9 }); assert.deepEqual(layout.frames[0].pivot, { x: .5, y: .9 }); assert.equal(layout.frames[1].empty, true);
  for (const frame of layout.frames) assert.ok(frame.frame.x + frame.frame.w <= layout.width && frame.frame.y + frame.frame.h <= layout.height);
  for (let i = 0; i < layout.frames.length; i++) for (let j = i + 1; j < layout.frames.length; j++) { const a = layout.frames[i].frame, b = layout.frames[j].frame; assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y); }
  assert.deepEqual(regionRect({ x: -5, y: 12 }, { x: 100, y: 4 }, 24, 20), { x: 0, y: 4, width: 24, height: 8 });
});
