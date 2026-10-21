import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleTimes, frameName, outputSize, chromaKey, makeManifest } from '../src/lib/core.mjs';
import { removeAiBackground, disposeFrames } from '../src/lib/media.mjs';
test('8/12/16/24/36 frames: exact count, ordered, never seek beyond the selected range', () => {
  for (const count of [8, 12, 16, 24, 36]) {
    const times = sampleTimes(1.2, 4.8, count);
    assert.equal(times.length, count);
    assert.ok(times[0] > 1.2 && times.at(-1) < 4.8);
    assert.ok(times.every((t, i) => !i || t > times[i - 1]));
    assert.ok(times.slice(1).every((t, i) => Math.abs(t - times[i] - 3.6 / count) < 1e-10));
  }
});
test('24/36 frame cutouts use bounded batches and preserve every frame in order', async t => {
  const originalReader = globalThis.FileReader;
  globalThis.FileReader = class {
    readAsDataURL(blob) {
      blob.arrayBuffer().then(bytes => {
        this.result = `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
        this.onload();
      }).catch(error => this.onerror(error));
    }
  };
  t.after(() => { if (originalReader) globalThis.FileReader = originalReader; else delete globalThis.FileReader; });
  const nativeFetch = globalThis.fetch;
  const batches = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url !== '/api/remove-background') return nativeFetch(url, options);
    const images = JSON.parse(options.body).images;
    batches.push(images.length);
    return Response.json({ images });
  });
  for (const count of [24, 36]) {
    batches.length = 0;
    const frames = sampleTimes(0, 5, count).map((time, i) => ({ time, width: 512, height: 288, blob: new Blob([`frame-${i}`]) }));
    const output = await removeAiBackground(frames, new AbortController().signal);
    assert.deepEqual(batches, count === 24 ? [16, 8] : [16, 16, 4]);
    assert.equal(output.length, count);
    for (const [i, frame] of output.entries()) {
      assert.equal(frame.time, frames[i].time);
      assert.equal(await frame.blob.text(), `frame-${i}`);
    }
    disposeFrames(output);
  }
});
test('invalid range and unsupported frame count fail before decoding', () => {
  for (const args of [[1, 1, 8], [-1, 5, 8], [0, NaN, 12], [0, 5, 9]]) assert.throws(() => sampleTimes(...args));
});
test('portrait and landscape outputs preserve aspect ratio without upscaling', () => {
  assert.deepEqual(outputSize(1920, 1080, 512), { width: 512, height: 288 });
  assert.deepEqual(outputSize(1080, 1920, 512), { width: 288, height: 512 });
  assert.deepEqual(outputSize(100, 80, 512), { width: 100, height: 80 });
});
test('chroma removes matching background and preserves the subject and original data', () => {
  const pixels = new Uint8ClampedArray([0, 255, 0, 255, 255, 0, 0, 255, 0, 255, 0, 128]);
  const out = chromaKey(pixels, [0, 255, 0], 20);
  assert.equal(out[3], 0); assert.equal(out[7], 255); assert.equal(out[11], 0); assert.equal(pixels[3], 255);
});
test('chroma keeps a straight mixed edge continuous with clean RGB and uniform coverage', () => {
  const key = [0, 255, 0, 255], subject = [80, 60, 40, 255];
  const pixels = new Uint8ClampedArray(Array.from({ length: 24 }, () =>
    [...key, 40, 158, 20, 255, ...subject, ...subject]).flat());
  const original = pixels.slice();
  const out = chromaKey(pixels, key.slice(0, 3), 20, 24, 4, 24);
  const edges = Array.from({ length: 24 }, (_, y) => [...out.slice((y * 4 + 1) * 4, (y * 4 + 2) * 4)]);
  assert.ok(edges.every(p => p.slice(0,3).every((v, i) => v === subject[i])));
  assert.ok(edges.every(p => p[3] === edges[0][3]));
  assert.ok(Math.abs(edges[0][3] - 128) <= 1);
  for (let y = 0; y < 24; y++) assert.deepEqual(out.slice((y * 4 + 2) * 4, (y * 4 + 4) * 4), original.slice((y * 4 + 2) * 4, (y * 4 + 4) * 4));
  assert.deepEqual(pixels, original);
  assert.deepEqual(chromaKey(pixels, key.slice(0, 3), 20, 24, 4, 24), out);
});
test('chroma cleanup preserves unrelated edge colors, internal greens and existing alpha', () => {
  const pixels = new Uint8ClampedArray([
    0,255,0,255, 200,20,120,255, 80,60,40,128,
    80,60,40,255, 80,60,40,255, 80,60,40,255,
    80,60,40,255, 80,60,40,255, 80,60,40,255,
  ]);
  const out = chromaKey(pixels, [0,255,0], 20, 24, 3, 3);
  assert.deepEqual(out.slice(4), pixels.slice(4));
  const interior = new Uint8ClampedArray(Array.from({length:81},(_,i) =>
    i < 9 || i >= 72 || i % 9 === 0 || i % 9 === 8 ? [0,255,0,255] : i === 40 ? [40,158,20,255] : [80,60,40,255]).flat());
  assert.deepEqual(chromaKey(interior,[0,255,0],20,24,9,9).slice(160,164),interior.slice(160,164));
});
test('chroma removes a three-pixel mixed fringe around pale smoke without losing coverage', () => {
  const key = [0,255,0], subject = [240,240,240];
  const amounts = [.25,.5,.75];
  const row = [...key,255,...amounts.flatMap(a => [...subject.map((v,i) => Math.round(v*a+key[i]*(1-a))),255]),...subject,255,...subject,255];
  const pixels = new Uint8ClampedArray(Array.from({length:12},() => row).flat());
  const out = chromaKey(pixels,key,20,24,6,12);
  for(let y=0;y<12;y++) for(let x=1;x<=3;x++) {
    const i = (y*6+x)*4;
    assert.deepEqual([...out.slice(i,i+3)],subject);
    assert.ok(Math.abs(out[i+3]-255*amounts[x-1])<=1);
  }
  assert.deepEqual(out.slice(16,24),pixels.slice(16,24));
});
test('chroma suppresses residual key dominance at diagonal edges even without a clean sample', () => {
  const pixels = new Uint8ClampedArray([0,255,0,255, 70,220,70,255, 70,220,70,255, 70,220,70,255]);
  const out = chromaKey(pixels,[0,255,0],20,24,2,2);
  for(let i=4;i<16;i+=4) assert.ok(out[i+1]<=Math.max(out[i],out[i+2]));
});
test('pale smoke with subtle green spill is not used as a clean reference', () => {
  const pixels = new Uint8ClampedArray([0,255,0,255, 120,248,120,255, 235,247,235,255, 240,240,240,255]);
  const out = chromaKey(pixels,[0,255,0],20,24,4,1);
  for(let i=4;i<12;i+=4) assert.equal(out[i+1],out[i]);
  assert.ok(Math.abs(out[7]-128)<=1);
  assert.deepEqual(out.slice(12),pixels.slice(12));
});
test('smoke without a clean reference retains its feathered alpha while excess green is removed', () => {
  const pixels = new Uint8ClampedArray([0,255,0,255, 25,255,25,255, 235,247,235,128]);
  const out = chromaKey(pixels,[0,255,0],20,24,3,1);
  assert.ok(out[7]>0 && out[7]<255);
  assert.equal(out[11],128);
  assert.equal(out[5],out[4]);
  assert.equal(out[9],out[8]);
});
test('chroma edge search does not wrap between rows and removes isolated feather residue', () => {
  const pixels = new Uint8ClampedArray(Array.from({length:10},(_,i) => i === 4 ? [80,60,40,255] : i === 5 ? [0,225,0,255] : [0,255,0,255]).flat());
  const out = chromaKey(pixels, [0,255,0], 20, 24, 5, 2);
  assert.equal(out[23], 0);
  assert.deepEqual(out.slice(16,20), pixels.slice(16,20));
});
test('smooth edge decontamination also handles red and blue keys and disabled feathering', () => {
  const subject = [80,60,40,255];
  for (const key of [[255,0,0], [0,0,255]]) {
    const mixed = subject.slice(0,3).map((v,i) => Math.round((v + key[i]) / 2));
    const pixels = new Uint8ClampedArray([...key,255,...mixed,255,...subject]);
    const out = chromaKey(pixels, key, 20, 0, 3, 1);
    assert.equal(out[3],0);
    assert.deepEqual(out.slice(4,7), new Uint8ClampedArray(subject.slice(0,3)));
    assert.ok(Math.abs(out[7] - 128) <= 1);
    assert.deepEqual(out.slice(8),pixels.slice(8));
  }
});
test('smooth edges retain changing coverage and multiply existing alpha only once', () => {
  const key = [0,255,0], subject = [80,60,40];
  const amounts = [.2,.4,.6,.8];
  const pixels = new Uint8ClampedArray(amounts.flatMap(amount => [
    ...key,255, ...subject.map((v,i) => Math.round(v * amount + key[i] * (1 - amount))),128, ...subject,255,
  ]));
  const out = chromaKey(pixels, key, 20, 24, 3, 4);
  for (let y = 0; y < amounts.length; y++) {
    const i = (y * 3 + 1) * 4;
    assert.deepEqual([...out.slice(i,i + 3)], subject);
    assert.ok(Math.abs(out[i + 3] - 128 * amounts[y]) <= 1);
    if (y) assert.ok(out[i + 3] > out[i - 12 + 3]);
  }
});
test('export manifest preserves timestamps, uniform canvas and playback duration', () => {
  for (const count of [16, 24, 36]) {
  const frames = sampleTimes(0, 5, count).map(time => ({ time, width: 512, height: 288 }));
  const manifest = makeManifest(frames, 12);
  assert.equal(manifest.duration, count / 12); assert.equal(manifest.frames.at(-1).file, `frame_${String(count).padStart(4, '0')}.png`);
  assert.equal(manifest.frameCount, count); assert.equal(manifest.frames.length, count);
  assert.equal(manifest.frames[0].sourceTime, frames[0].time); assert.equal(manifest.width, 512);
  assert.equal(frameName(0), 'frame_0001.png');
  }
});
