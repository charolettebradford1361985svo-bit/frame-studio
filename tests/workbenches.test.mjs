import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { WORKBENCHES, parseScreen, destinationFor, recordForDestination } from '../src/lib/workbenches.mjs';
import { saveAsset, getAsset, deleteAsset } from '../src/lib/library.mjs';
import { exportProjectArchive } from '../src/lib/project-export.mjs';
import { validateLocalImages, deepSeekAssistant } from '../server/local-services.mjs';
import { cleanKeyEdges } from '../src/lib/edge-cleanup.mjs';
import { sameDraft, draftValue, protectDraft } from '../src/lib/draft-guard.mjs';
import { projectBackupFilename } from '../src/lib/download-name.mjs';

test('backup download names preserve Chinese and emoji, label their purpose and distinguish same-name assets', () => {
  assert.equal(projectBackupFilename('骑士 · 行走 🐺', '12345678-1234-5678-9012-123456789abc'), '骑士 · 行走 🐺-项目备份-12345678.zip');
  assert.notEqual(projectBackupFilename('同名角色', '11111111-a'), projectBackupFilename('同名角色', '22222222-b'));
  assert.equal(projectBackupFilename('e\u0301', 'ABCD'), 'é-项目备份-abcd.zip');
});
test('backup names handle Windows devices, path/control characters, empty names and Unicode length boundaries', () => {
  for (const name of ['CON', 'con.png', 'PRN', 'AUX', 'NUL.txt', 'COM1', 'LPT9.png', 'COM¹', 'LPT²', 'CONIN$', 'CONOUT$']) {
    assert.ok(projectBackupFilename(name, 'id').startsWith('素材-'), name);
  }
  for (const name of ['../骑士/行走\\动作:剪辑*?"<>|\u0000\u001f', 'C:\\素材\\角色.png', '\u202e假扩展名', ' .角色.  ']) {
    const filename = projectBackupFilename(name, '../unsafe:id');
    assert.doesNotMatch(filename, /[<>:"/\\|?*\u0000-\u001f\u007f\u202e]/);
    assert.doesNotMatch(filename, /^[.\s-]/); assert.ok(filename.endsWith('.zip'));
  }
  for (const empty of ['', ' . .. / \\ : * ', null, undefined, '\ud800']) assert.equal(projectBackupFilename(empty, ''), '未命名素材-项目备份.zip');
  const family = '👩🏽‍🚀';
  for (const name of ['中'.repeat(1000), 'x'.repeat(71) + '🐺', family.repeat(30), 'x'.repeat(71) + '.剩余', 'x'.repeat(72) + '尾']) {
    const filename = projectBackupFilename(name, '12345678-long');
    assert.ok(filename.length <= 90); assert.doesNotMatch(filename, /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
  }
  assert.equal(projectBackupFilename(family.repeat(30), '').split('-项目备份')[0], family.repeat(10));
  assert.equal(projectBackupFilename('x'.repeat(71) + '.剩余', '').split('-项目备份')[0], 'x'.repeat(71));
});
test('choosing a readable filename leaves every byte and manifest in the project archive intact', async () => {
  const blob = new Blob(['unchanged pixels'], { type: 'image/png' });
  const record = { id: 'abcd1234-project', name: '透明角色 🐺', kind: 'sheet', fps: 8, original: [{ blob, width: 1, height: 1, duration: 125 }], editorProject: { frames: [{ blob, dx: -2, dy: 3 }], size: { width: 1, height: 1 } } };
  const archive = await exportProjectArchive(record), before = new Uint8Array(await archive.arrayBuffer());
  assert.equal(projectBackupFilename(record.name, record.id), '透明角色 🐺-项目备份-abcd1234.zip');
  assert.deepEqual(new Uint8Array(await archive.arrayBuffer()), before);
  const files = unzipSync(before), json = JSON.parse(strFromU8(files['project.json']));
  assert.equal(json.record.name, record.name); assert.equal(json.record.editorProject.frames[0].dx, -2);
  assert.deepEqual(files[json.record.original[0].blob.file], new Uint8Array(await blob.arrayBuffer()));
});

test('draft comparison tracks content, shares image memory, and clears on undo to the saved content', () => {
  const image = new Blob(['pixels'], { type: 'image/png' }), saved = { name: 'walk', frames: [{ image, dx: 0 }], size: { width: 16, height: 16 } };
  assert.equal(sameDraft(saved, { ...saved, size: { ...saved.size } }), true);
  const edited = { ...saved, frames: [{ image, dx: 3 }] };
  assert.equal(sameDraft(edited, saved), false);
  assert.equal(edited.frames[0].image, saved.frames[0].image);
  assert.equal(sameDraft(saved, saved), true); // Undo restores the saved snapshot.
  assert.equal(sameDraft({ ...saved, frames: [{ image: new Blob(['pixels']), dx: 0 }] }, saved), false);
  assert.equal(sameDraft({ ...saved, name: 'new edit during save' }, edited), false); // Saving an older snapshot cannot clear a newer edit.
});
test('view-only playback, frame selection and tools do not falsely mark saved projects dirty', () => {
  for (const kind of ['sheet','rig','scene','terrain']) {
    const base = { name: kind, frames: [], parts: [], source: null, size: { width: 16, height: 16 }, selected: 0, erase: false, active: 0, playing: false, tool: 'move' };
    const view = { ...base, selected: 1, erase: true, active: 1, playing: true, tool: 'guides', zoom: 4 };
    if (kind === 'rig') { delete base.active; delete base.playing; delete base.erase; delete view.active; delete view.playing; delete view.erase; delete view.zoom; }
    if (kind === 'scene') { delete base.selected; delete base.erase; delete base.tool; delete view.selected; delete view.erase; delete view.tool; delete view.zoom; }
    if (kind === 'terrain') { delete base.active; delete base.playing; delete base.tool; delete view.active; delete view.playing; delete view.tool; delete view.zoom; }
    assert.equal(sameDraft(draftValue(kind, base), draftValue(kind, view)), true, kind);
    assert.equal(sameDraft(draftValue(kind, base), draftValue(kind, { ...base, name: 'edited' })), false, kind);
  }
});
test('beforeunload warning exists only for an unsaved draft and is removed on cleanup', () => {
  const listeners = new Map(), target = { addEventListener: (type, callback) => listeners.set(type, callback), removeEventListener: (type, callback) => { if (listeners.get(type) === callback) listeners.delete(type); } };
  protectDraft(target, false)(); assert.equal(listeners.size, 0);
  const cleanup = protectDraft(target, true), event = { prevented: false, preventDefault() { this.prevented = true; } };
  listeners.get('beforeunload')(event); assert.equal(event.prevented, true); assert.equal(event.returnValue, true);
  cleanup(); assert.equal(listeners.size, 0);
});

test('home has four independent workflows; native reopen and explicit cross import select different destinations', () => {
  assert.equal(WORKBENCHES.length, 4);
  for (const entry of WORKBENCHES) {
    assert.equal(parseScreen(`#/${entry.id}`), entry.id);
    assert.equal(destinationFor({ kind: entry.kind }, null), entry.id);
    assert.equal(destinationFor({ kind: entry.kind }, 'frames'), 'frames');
  }
  assert.equal(parseScreen('#/unknown'), 'home');
  assert.equal(destinationFor({}, null), 'studio');
  const project = { kind: 'rig', original: ['rendered-frame'], editorProject: { parts: ['editable-part'] } };
  assert.deepEqual(recordForDestination(project, 'rig').editorProject, project.editorProject);
  assert.equal(recordForDestination(project, 'frames').editorProject, undefined);
  assert.deepEqual(recordForDestination(project, 'frames').original, project.original);
});
test('library retains variable timing, nested parts and editable project archive contains actual blobs', async () => {
  const blob = new Blob(['source pixels'], { type: 'image/png' });
  const saved = await saveAsset({ name: 'joint test', kind: 'rig', fps: 8,
    original: [{ blob, width: 64, height: 64, time: 0, duration: 250 }],
    editorProject: { parts: [{ blob, parent: 'body', pivotX: 4, pivotY: 8 }], poses: [{ duration: 100 }] } });
  assert.equal(saved.kind, 'rig'); assert.equal(saved.bytes, blob.size * 2);
  const record = await getAsset(saved.id); assert.equal(record.original[0].duration, 250);
  const files = unzipSync(new Uint8Array(await (await exportProjectArchive(record)).arrayBuffer()));
  const json = JSON.parse(strFromU8(files['project.json']));
  assert.equal(json.record.editorProject.parts[0].parent, 'body');
  const file = json.record.editorProject.parts[0].blob.file;
  assert.equal(strFromU8(files[file]), 'source pixels');
  assert.equal(json.record.original[0].duration, 250);
  await deleteAsset(saved.id);
});
test('local service refuses unsupported models, excessive jobs and arbitrary input paths', () => {
  const png = 'data:image/png;base64,aGVsbG8=';
  assert.equal(validateLocalImages({ operation: 'upscale', images: [png], options: { scale: 2 } }).operation, 'upscale');
  for (const body of [{ operation: 'generate', images: [png] }, { operation: 'upscale', images: ['file:///secret'] }, { operation: 'upscale', images: [png], options: { scale: 8 } }, { operation: 'interpolate', images: [png], options: { count: 3 } }, { operation: 'interpolate', images: [png,png], options: { count: 99 } }]) assert.throws(() => validateLocalImages(body));
});
test('DeepSeek without configured key never makes a paid call or pretends to answer', async () => {
  await assert.rejects(deepSeekAssistant({ request: 'plan a walk' }, undefined, { key: '' }), error => error.status === 503 && /密钥/.test(error.message));
});
test('key spill cleanup suppresses only edge contamination and preserves alpha, interiors and source', () => {
  const pixels = new Uint8ClampedArray(5 * 5 * 4);
  for (let y = 1; y < 4; y++) for (let x = 1; x < 4; x++) pixels.set([80, 200, 60, 255], (y * 5 + x) * 4);
  const cleaned = cleanKeyEdges(pixels, 5, 5, [0, 255, 0]);
  assert.equal(cleaned[(1 * 5 + 1) * 4 + 1], 128);
  assert.equal(cleaned[(2 * 5 + 2) * 4 + 1], 200);
  assert.equal(pixels[(1 * 5 + 1) * 4 + 1], 200);
  for (let i = 3; i < pixels.length; i += 4) assert.equal(cleaned[i], pixels[i]);
  assert.throws(() => cleanKeyEdges(pixels, 5, 5, [255,255,255]), /适合/);
});
