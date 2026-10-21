import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, validateGeneration } from '../server/index.mjs';
const payload = { image: 'data:image/png;base64,aGVsbG8=', prompt: 'Wave slowly', duration: 5, ratio: '960:960' };
test('generation validates duration, prompt, image and ratio', () => {
  assert.equal(validateGeneration(payload).model, 'gen4_turbo');
  for (const change of [{ duration: 20 }, { prompt: '' }, { image: 'file:///secret' }, { ratio: '1:1' }]) assert.throws(() => validateGeneration({ ...payload, ...change }));
});
test('missing API key is an honest failure, never a simulated generation', async t => {
  const server = createApi({ client: null }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/generate`, { method: 'POST', body: JSON.stringify(payload) });
  assert.equal(response.status, 503); assert.match((await response.json()).error, /密钥/);
});
test('provider creation → polling → same-origin video download', async t => {
  const client = { imageToVideo: { create: async params => { assert.equal(params.promptText, 'Wave slowly'); return { id: 'test-task' }; } },
    tasks: { retrieve: async () => ({ status: 'SUCCEEDED', output: ['data:video/mp4;base64,aGVsbG8='] }) } };
  const server = createApi({ client }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const created = await fetch(`${base}/api/generate`, { method: 'POST', body: JSON.stringify(payload) }); assert.equal(created.status, 202);
  const state = await (await fetch(`${base}/api/tasks/test-task`)).json(); assert.equal(state.video, '/api/video/test-task');
  const video = await fetch(base + state.video); assert.equal(await video.text(), 'hello');
  const blocked = await fetch(`${base}/api/generate`, { method: 'POST', headers: { Origin: 'https://example.com' }, body: JSON.stringify(payload) }); assert.equal(blocked.status, 403);
});
