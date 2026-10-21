import test from 'node:test';
import assert from 'node:assert/strict';
import { rectangleBetween, moveBox, sceneManifest, tileRectangles, resizeMap, paintMapCell, seamDifference, terrainManifest } from '../src/lib/scene-terrain.mjs';
import { indexedDB } from 'fake-indexeddb';
import { saveAsset, getAsset, deleteAsset } from '../src/lib/library.mjs';
test('sprite boxes normalize reversed drags and clamp to original pixel bounds', () => {
  assert.deepEqual(rectangleBetween({ x: 100, y: 80 }, { x: -5, y: 10 }, 64, 64), { x: 0, y: 10, width: 64, height: 54 });
  assert.deepEqual(moveBox({ x: 5, y: 5, width: 20, height: 10, type: 'attack' }, 90, -90, 64, 64), { x: 44, y: 0, width: 20, height: 10, type: 'attack' });
});
test('scene export keeps per-frame events, local boxes and anchors independent of preview scale', () => {
  const box = { x: 3, y: 4, width: 5, height: 6, type: 'attack' };
  const manifest = sceneManifest({ fps: 8, x: 230, y: 330, scale: 3, anchor: { x: 32, y: 64 }, annotations: [{ boxes: [box], events: [{ type: 'hit', value: '10' }] }] }, [{ width: 64, height: 64 }, { width: 64, height: 64 }]);
  assert.deepEqual(manifest.frames[0].boxes[0], box); assert.equal(manifest.frames[0].events[0].value, '10');
  assert.equal(manifest.frames[1].time, .125); assert.deepEqual(manifest.frames[1].boxes, []); assert.deepEqual(manifest.anchor, { x: 32, y: 64 });
});
test('tile splitting excludes incomplete edge pixels and rejects oversized palettes', () => {
  assert.deepEqual(tileRectangles(65, 33, 32, 32), [{ x: 0, y: 0, width: 32, height: 32 }, { x: 32, y: 0, width: 32, height: 32 }]);
  assert.throws(() => tileRectangles(1024, 1024, 8, 8), /512/); assert.throws(() => tileRectangles(30, 20, 32, 32), /超过/);
});
test('map resizing preserves row coordinates and brush avoids out-of-bounds writes', () => {
  const map = [0, 1, 2, 3, 4, 5];
  assert.deepEqual(resizeMap(map, 3, 2, 2, 3), [0, 1, 3, 4, -1, -1]);
  assert.equal(paintMapCell(map, 3, 2, -1, 1, 9), map);
  assert.deepEqual(paintMapCell(map, 3, 2, 2, 1, 9), [0, 1, 2, 3, 4, 9]);
  const project = { tileWidth: 32, tileHeight: 32, columns: 3, rows: 2, map };
  assert.deepEqual(terrainManifest(project, []).cells, map);
});
test('seam comparison ignores invisible RGB but detects alpha and opposite-edge mismatches', () => {
  assert.deepEqual(seamDifference(new Uint8ClampedArray([255, 0, 0, 0, 0, 255, 0, 0]), 2, 1), { horizontal: 0, vertical: 0 });
  assert.deepEqual(seamDifference(new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]), 2, 1), { horizontal: 191.3, vertical: 0 });
});
test('shared asset storage restores scene annotations and terrain indices together with original image blobs', async () => {
  globalThis.indexedDB = indexedDB;
  const original = [{ blob: new Blob(['png'], { type: 'image/png' }), width: 64, height: 64, time: 0 }];
  const sceneProject = { version: 1, spriteFrames: original, background: new Blob(['background']), settings: { anchor: { x: 32, y: 64 }, annotations: [{ boxes: [{ x: 3, y: 5, width: 20, height: 10, type: 'attack' }], events: [{ type: 'sound', value: 'swing_01' }] }] } };
  const terrainProject = { version: 1, source: original[0].blob, settings: { tileWidth: 32, tileHeight: 32, columns: 2, rows: 2, map: [0, 1, -1, 0] } };
  for (const [kind, editorProject] of [['scene', sceneProject], ['terrain', terrainProject]]) {
    const saved = await saveAsset({ name: `${kind} roundtrip test`, fps: 8, kind, original, editorProject });
    const restored = await getAsset(saved.id);
    assert.equal(restored.kind, kind); assert.deepEqual(restored.editorProject, editorProject); assert.equal(await restored.original[0].blob.text(), 'png');
    await deleteAsset(saved.id);
  }
});
