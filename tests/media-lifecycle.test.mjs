import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { applyChroma, disposeFrames, exportArchive, extractFrames } from '../src/lib/media.mjs';

// Test resource ownership with EventTarget/Canvas substitutes, not a real decoder.
function mediaEnvironment(t, options = {}) {
  const state = { created: [], revoked: [], bitmaps: [], encodes: 0, draws: 0, placements: [], encodedSizes: [], seeks: [], releases: 0, listeners: new Set() };
  const previousDocument = globalThis.document, previousBitmap = globalThis.createImageBitmap;
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousBitmap === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap = previousBitmap;
  });
  const video = new EventTarget();
  Object.assign(video, { duration: 5, videoWidth: 16, videoHeight: 12,
    pause() {}, removeAttribute() {}, load() { state.releases++; } });
  const add = video.addEventListener.bind(video), remove = video.removeEventListener.bind(video);
  video.addEventListener = (name, callback, ...args) => { state.listeners.add(callback); add(name, callback, ...args); };
  video.removeEventListener = (name, callback, ...args) => { state.listeners.delete(callback); remove(name, callback, ...args); };
  Object.defineProperty(video, 'src', { set() { options.onSource?.(); queueMicrotask(() => video.dispatchEvent(new Event(options.sourceError ? 'error' : 'loadeddata'))); } });
  Object.defineProperty(video, 'currentTime', { set(time) {
    state.seeks.push(time);
    options.onSeek?.(state.seeks.length);
    queueMicrotask(() => video.dispatchEvent(new Event(options.seekErrorAt === state.seeks.length ? 'error' : 'seeked')));
  } });
  globalThis.document = { createElement(kind) {
    if (kind === 'video') return video;
    assert.equal(kind, 'canvas');
    return { width: 16, height: 12, getContext() { return {
      drawImage(image, ...placement) { state.placements.push(placement); if (++state.draws === options.drawErrorAt) throw new Error('synthetic draw failure'); },
      getImageData() { return { data: new Uint8ClampedArray(16 * 12 * 4) }; }, putImageData() {},
    }; }, toBlob(callback) {
      const count = ++state.encodes;
      state.encodedSizes.push([this.width, this.height]);
      queueMicrotask(() => {
        options.onEncode?.(count);
        callback(options.encodeErrorAt === count ? null : new Blob([`encoded-${count}`], { type: 'image/png' }));
      });
    } };
  } };
  globalThis.createImageBitmap = async () => {
    const bitmap = { width: 16, height: 12, closes: 0, close() { this.closes++; } };
    state.bitmaps.push(bitmap); options.onDecode?.(state.bitmaps.length); return bitmap;
  };
  t.mock.method(URL, 'createObjectURL', () => { const url = `blob:synthetic-${state.created.length}`; state.created.push(url); return url; });
  t.mock.method(URL, 'revokeObjectURL', url => state.revoked.push(url));
  return state;
}

const inputFrames = () => Array.from({ length: 2 }, (_, i) => ({ blob: new Blob([String(i)]), width: 16, height: 12, time: i / 8 }));

test('successful extraction transfers frame URLs to its caller and releases the decoder/listeners', async t => {
  const state = mediaEnvironment(t);
  const result = await extractFrames('synthetic-no-network', 0, 5, 8, 512, () => {});
  assert.equal(result.length, 8); assert.deepEqual(result.map(frame => frame.time), state.seeks);
  assert.equal(state.releases, 1); assert.equal(state.listeners.size, 0); assert.equal(state.revoked.length, 0);
  disposeFrames(result); assert.deepEqual(state.revoked, state.created);
});

test('source decoding failure releases its video and event listeners without creating output URLs', async t => {
  const state = mediaEnvironment(t, { sourceError: true });
  await assert.rejects(extractFrames('synthetic-no-network', 0, 5, 8, 512, () => {}), /无法解码/);
  assert.equal(state.releases, 1); assert.equal(state.listeners.size, 0); assert.equal(state.created.length, 0);
});

test('cancelling a pending decode or seek removes listeners and releases partial outputs', async t => {
  for (const phase of ['decode', 'seek']) await t.test(phase, async t => {
    const controller = new AbortController();
    const state = mediaEnvironment(t, phase === 'decode'
      ? { onSource() { controller.abort(); } }
      : { onSeek(count) { if (count === 2) controller.abort(); } });
    await assert.rejects(extractFrames('synthetic-no-network', 0, 5, 8, 512, () => {}, controller.signal), { name: 'AbortError' });
    assert.equal(state.releases, 1); assert.equal(state.listeners.size, 0);
    assert.equal(state.created.length, phase === 'decode' ? 0 : 1);
    assert.deepEqual(state.revoked, state.created);
  });
});

test('seek or encoding failure revokes every partially produced frame and releases the decoder', async t => {
  for (const options of [{ seekErrorAt: 2 }, { encodeErrorAt: 2 }]) {
    await t.test(JSON.stringify(options), async t => {
      const state = mediaEnvironment(t, options);
      await assert.rejects(extractFrames('synthetic-no-network', 0, 5, 8, 512, () => {}));
      assert.equal(state.created.length, 1); assert.deepEqual(state.revoked, state.created);
      assert.equal(state.releases, 1); assert.equal(state.listeners.size, 0);
    });
  }
});

test('cancellation during the final PNG encoding rejects instead of returning cancelled frames', async t => {
  const controller = new AbortController();
  const state = mediaEnvironment(t, { onEncode(count) { if (count === 8) controller.abort(); } });
  await assert.rejects(extractFrames('synthetic-no-network', 0, 5, 8, 512, () => {}, controller.signal), { name: 'AbortError' });
  assert.equal(state.created.length, 7); assert.deepEqual(state.revoked, state.created);
  assert.equal(state.releases, 1); assert.equal(state.listeners.size, 0);
});

test('cancellation from the final extraction progress callback revokes every output URL', async t => {
  const controller = new AbortController(), state = mediaEnvironment(t);
  await assert.rejects(extractFrames('synthetic-no-network', 0, 5, 8, 512, count => { if (count === 8) controller.abort(); }, controller.signal), { name: 'AbortError' });
  assert.equal(state.created.length, 8); assert.deepEqual(state.revoked, state.created);
  assert.equal(state.releases, 1); assert.equal(state.listeners.size, 0);
});

test('chroma processing closes every bitmap on drawing failure and revokes partial results', async t => {
  const state = mediaEnvironment(t, { drawErrorAt: 2 });
  await assert.rejects(applyChroma(inputFrames(), '#00ff00', 20, () => {}), /synthetic draw failure/);
  assert.deepEqual(state.bitmaps.map(bitmap => bitmap.closes), [1, 1]);
  assert.equal(state.created.length, 1); assert.deepEqual(state.revoked, state.created);
});

test('chroma cancellation during the final encoding revokes prior results and rejects', async t => {
  const controller = new AbortController();
  const state = mediaEnvironment(t, { onEncode(count) { if (count === 2) controller.abort(); } });
  await assert.rejects(applyChroma(inputFrames(), '#00ff00', 20, () => {}, controller.signal), { name: 'AbortError' });
  assert.deepEqual(state.bitmaps.map(bitmap => bitmap.closes), [1, 1]);
  assert.equal(state.created.length, 1); assert.deepEqual(state.revoked, state.created);
});

test('chroma cancellation from final progress rejects after yielding and revokes results', async t => {
  const controller = new AbortController(), state = mediaEnvironment(t);
  await assert.rejects(applyChroma(inputFrames(), '#00ff00', 20, count => { if (count === 2) controller.abort(); }, controller.signal), { name: 'AbortError' });
  assert.equal(state.created.length, 2); assert.deepEqual(state.revoked, state.created);
  assert.deepEqual(state.bitmaps.map(bitmap => bitmap.closes), [1, 1]);
});

test('successful chroma processing closes bitmaps but leaves returned URLs owned by its caller', async t => {
  const state = mediaEnvironment(t), source = inputFrames();
  const result = await applyChroma(source, '#00ff00', 20, () => {});
  assert.deepEqual(state.bitmaps.map(bitmap => bitmap.closes), [1, 1]);
  assert.equal(state.created.length, 2); assert.equal(state.revoked.length, 0);
  assert.deepEqual(result.map(frame => frame.time), source.map(frame => frame.time));
  disposeFrames(result); assert.deepEqual(state.revoked, state.created);
});

test('sprite-sheet export closes the failing bitmap when drawing aborts', async t => {
  const state = mediaEnvironment(t, { drawErrorAt: 2 });
  await assert.rejects(exportArchive(inputFrames(), 8, 'sheet'), /synthetic draw failure/);
  assert.deepEqual(state.bitmaps.map(bitmap => bitmap.closes), [1, 1]);
});

test('36-frame archive retains every input byte and binds ordered filenames to source times', async () => {
  // Deliberately distinct payloads: packaging contract only, not PNG decoding.
  const frames = Array.from({ length: 36 }, (_, i) => ({ blob: new Blob([`frame-payload-${i}`]), width: 16, height: 12, time: 1.25 + i / 8 }));
  const archive = await exportArchive(frames, 8, 'frames');
  const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
  const manifest = JSON.parse(strFromU8(files['frames.json']));
  assert.equal(Object.keys(files).length, 37);
  assert.equal(manifest.frameCount, 36); assert.equal(manifest.duration, 4.5);
  assert.equal(manifest.width, 16); assert.equal(manifest.height, 12);
  for (const [i, frame] of frames.entries()) {
    const entry = manifest.frames[i];
    assert.equal(entry.file, `frame_${String(i + 1).padStart(4, '0')}.png`);
    assert.equal(entry.sourceTime, frame.time); assert.equal(entry.duration, .125);
    assert.equal(strFromU8(files[entry.file]), `frame-payload-${i}`);
  }
});

test('sheet manifest coordinates match actual drawing positions and encoded canvas size', async t => {
  const state = mediaEnvironment(t);
  const frames = Array.from({ length: 12 }, (_, i) => ({ ...inputFrames()[0], time: i / 8 }));
  const files = unzipSync(new Uint8Array(await (await exportArchive(frames, 8, 'sheet')).arrayBuffer()));
  const manifest = JSON.parse(strFromU8(files['frames.json']));
  assert.deepEqual(Object.keys(files).sort(), ['frames.json', 'sheet.png']);
  assert.equal(state.bitmaps.length, 12); assert.ok(state.bitmaps.every(bitmap => bitmap.closes === 1));
  assert.deepEqual(state.encodedSizes, [[64, 36]]);
  assert.deepEqual(manifest.sheet, { file: 'sheet.png', columns: 4, rows: 3 });
  assert.equal(manifest.frames.length, 12);
  assert.deepEqual(manifest.frames.map(frame => [frame.x, frame.y]), state.placements);
  assert.deepEqual(state.placements, Array.from({ length: 12 }, (_, i) => [(i % 4) * 16, Math.floor(i / 4) * 12]));
});
