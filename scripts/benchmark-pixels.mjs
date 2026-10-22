import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { chromaKey } from '../src/lib/core.mjs';
import { enhancePixels } from '../src/lib/image-enhancement.mjs';

// Synthetic CPU baseline only: excludes decoding, PNG encoding, storage and UI.
const frames = 24, warmups = 2, runs = 7;
const hash = data => createHash('sha256').update(data).digest('hex');
function fixture(size) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const inside = x >= size / 4 && x < size * 3 / 4 && y >= size / 4 && y < size * 3 / 4;
    const edge = inside && (x < size / 4 + 3 || y < size / 4 + 3);
    data.set(!inside ? [0, 255, 0, 255] : edge ? [40, 158, 20, 255] : [80, 60, 40, 128 + (x + y) % 128], (y * size + x) * 4);
  }
  return data;
}

const results = [];
for (const [name, size, transform] of [
  ['chroma-256', 256, data => chromaKey(data, [0, 255, 0], 20, 24, 256, 256)],
  ['chroma-512', 512, data => chromaKey(data, [0, 255, 0], 20, 24, 512, 512)],
  ['integer-upscale-256-2x', 256, data => enhancePixels(data, 256, 256, 2, false).data],
]) {
  const source = fixture(size), inputHash = hash(source), expectedHash = hash(transform(source));
  const samples = [];
  let endpointMemory;
  for (let run = -warmups; run < runs; run++) {
    const before = process.memoryUsage(), start = performance.now();
    let output;
    for (let frame = 0; frame < frames; frame++) output = transform(source);
    const elapsed = performance.now() - start, after = process.memoryUsage();
    assert.equal(hash(source), inputHash, 'source pixels changed');
    assert.equal(hash(output), expectedHash, 'output changed across repeated batches');
    if (run >= 0) samples.push(elapsed);
    endpointMemory = { rss: after.rss - before.rss, heapUsed: after.heapUsed - before.heapUsed, arrayBuffers: after.arrayBuffers - before.arrayBuffers };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  results.push({ name, inputSize: [size, size], inputSha256: inputHash, outputSha256: expectedHash,
    batchMs: samples.map(ms => +ms.toFixed(3)), medianBatchMs: +sorted[3].toFixed(3),
    minBatchMs: +sorted[0].toFixed(3), maxBatchMs: +sorted.at(-1).toFixed(3),
    lastBatchEndpointMemoryDeltaBytes: endpointMemory });
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
  framesPerBatch: frames, warmups, measuredRuns: runs,
  memoryNote: 'Last batch endpoint deltas only, affected by GC; not peak memory or a leak test. Outputs are processed serially, not retained as an editor project.', results }, null, 2));
