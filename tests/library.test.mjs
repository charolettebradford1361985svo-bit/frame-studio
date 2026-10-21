import 'fake-indexeddb/auto';
import { IDBObjectStore } from 'fake-indexeddb';
import test from 'node:test';
import assert from 'node:assert/strict';
import { saveAsset, listAssets, getAsset, deleteAsset, restoreFrames } from '../src/lib/library.mjs';
import { filterLibraryAssets, libraryAssetKind } from '../src/lib/library-filter.mjs';

test('library type and name filters combine without changing asset order or records', () => {
  const assets = [
    { id: 'a', name: '骑士 · Walk 🐺', kind: 'sheet' },
    { id: 'b', name: '骑士 · Walk 🐺', kind: 'rig' },
    { id: 'c', name: '骑士 · 碰撞', kind: 'scene' },
    { id: 'd', name: '草地', kind: 'terrain' },
    { id: 'e', name: '法师', kind: 'sheet' },
  ];
  const before = structuredClone(assets);
  assert.deepEqual(filterLibraryAssets(assets), assets);
  assert.deepEqual(filterLibraryAssets(assets, '  WALK 🐺  ', 'all').map(item => item.id), ['a', 'b']);
  assert.deepEqual(filterLibraryAssets(assets, '骑士', 'sheet').map(item => item.id), ['a']);
  for (const kind of ['sheet', 'rig', 'scene', 'terrain']) {
    assert.deepEqual(filterLibraryAssets(assets, '', kind), assets.filter(item => item.kind === kind));
  }
  assert.deepEqual(filterLibraryAssets(assets, '草地', 'sheet'), []);
  assert.deepEqual(filterLibraryAssets([], '', 'all'), []);
  assert.equal(filterLibraryAssets(assets, 'Walk', 'sheet')[0], assets[0]);
  assert.deepEqual(assets, before);
});

test('legacy missing kinds and unknown kinds belong only to the other library category', () => {
  const assets = [undefined, null, '', 'future-kind', 'SHEET', 42, 'other'].map((kind, id) => ({ id, name: `旧素材 ${id}`, kind }));
  assets.push({ id: 'known', name: '旧素材 动画', kind: 'sheet' });
  for (const asset of assets.slice(0, -1)) assert.equal(libraryAssetKind(asset.kind), 'other');
  assert.equal(libraryAssetKind('sheet'), 'sheet');
  assert.equal(filterLibraryAssets(assets, '', 'other').length, 7);
  assert.deepEqual(filterLibraryAssets(assets, '旧素材 3', 'other').map(item => item.id), [3]);
  assert.deepEqual(filterLibraryAssets(assets, '', 'sheet').map(item => item.id), ['known']);
  assert.equal(filterLibraryAssets(assets).length, 8);
});

test('24/36 frame assets persist blobs, transparency, settings and ordering across database reopen', async () => {
  for (const count of [24, 36]) {
    const original = Array.from({ length: count }, (_, i) => ({ time: i / 10, width: 128, height: 128, blob: new Blob([`original-${i}`], { type: 'image/png' }), url: 'blob:ephemeral' }));
    const cutout = original.map((frame, i) => ({ ...frame, blob: new Blob([`transparent-${i}`], { type: 'image/png' }) }));
    const saved = await saveAsset({ name: ` 骑士 ${count} `, original, cutout, fps: 8, prompt: 'walk', showCutout: true });
    const summaries = await listAssets();
    assert.ok(summaries.some(item => item.id === saved.id && item.transparent && item.frameCount === count));
    assert.equal(saved.name, `骑士 ${count}`);
    const record = await getAsset(saved.id);
    assert.equal(record.fps, 8); assert.equal(record.prompt, 'walk'); assert.equal(record.showCutout, true);
    assert.equal(record.original.length, count); assert.equal(record.cutout.length, count);
    assert.equal(record.original[0].url, undefined);
    for (let i = 0; i < count; i++) {
      assert.equal(await record.original[i].blob.text(), `original-${i}`);
      assert.equal(await record.cutout[i].blob.text(), `transparent-${i}`);
      assert.equal(record.cutout[i].time, i / 10);
    }
    const restored = restoreFrames(record.cutout);
    assert.ok(restored.every(frame => frame.url.startsWith('blob:')));
    restored.forEach(frame => URL.revokeObjectURL(frame.url));
    await deleteAsset(saved.id);
    assert.ok(!(await listAssets()).some(item => item.id === saved.id));
    await assert.rejects(getAsset(saved.id), /已被删除/);
  }
});
test('invalid or incomplete assets do not leave a library entry', async () => {
  const original = [{ blob: new Blob(['png']), width: 64, height: 64, time: 0 }];
  for (const input of [{ name: '', original, fps: 12 }, { name: 'empty', original: [], fps: 12 }, { name: 'broken', original, cutout: [original[0], original[0]], fps: 12 }, { name: 'fps', original, fps: 0 }]) {
    await assert.rejects(saveAsset(input));
  }
  assert.equal((await listAssets()).length, 0);
});
test('sheet project keeps editable source pixels, translations and common guides after reopen', async () => {
  const blob = new Blob(['pixels-outside-cropped-canvas'], { type: 'image/png' });
  const editorProject = { frames: [{ blob, dx: -18, dy: 12 }], size: { width: 96, height: 112 }, lines: { left: 0, top: 0, right: 96, bottom: 112, center: 48 } };
  const saved = await saveAsset({ name: 'editable', kind: 'sheet', fps: 8, original: [{ blob, width: 96, height: 112, time: 0 }], editorProject });
  const record = await getAsset(saved.id);
  assert.equal(record.kind, 'sheet'); assert.equal(record.editorProject.frames[0].dx, -18);
  assert.equal(await record.editorProject.frames[0].blob.text(), 'pixels-outside-cropped-canvas');
  assert.deepEqual(record.editorProject.lines, editorProject.lines); assert.equal(saved.bytes, blob.size * 2);
  await deleteAsset(saved.id);
});
test('storage quota failure rolls back frames and gives an actionable error', async t => {
  const add = IDBObjectStore.prototype.add;
  const mock = t.mock.method(IDBObjectStore.prototype, 'add', function (value) {
    if (this.name === 'summaries') throw new DOMException('Disk full', 'QuotaExceededError');
    return add.call(this, value);
  });
  await assert.rejects(saveAsset({ name: 'quota', fps: 12, original: [{ blob: new Blob(['png']), width: 64, height: 64, time: 0 }] }), /存储空间不足/);
  mock.mock.restore();
  assert.equal((await listAssets()).length, 0);
  const count = await new Promise((resolve, reject) => {
    const request = indexedDB.open('frame-studio-library', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('assets'); const query = tx.objectStore('assets').count();
      tx.oncomplete = () => { db.close(); resolve(query.result); };
    };
  });
  assert.equal(count, 0);
});
