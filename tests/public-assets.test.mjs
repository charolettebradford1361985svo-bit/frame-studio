import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { copyPublicAssets, publicAssetsPlugin } from '../scripts/public-assets.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'frame-public-assets-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const publicDir = path.join(root, 'public'), outDir = path.join(root, 'dist/client');
  mkdirSync(path.join(publicDir, 'scenes'), { recursive: true });
  mkdirSync(path.join(publicDir, 'media'), { recursive: true });
  const files = {
    'frame-studio-logo-prompt.txt': 'synthetic private fixture',
    'scenes/asset-prompts.txt': 'synthetic private fixture',
    'frame-studio-logo.png': 'synthetic logo',
    'frame-studio.ico': 'synthetic icon',
    'scenes/forest.png': 'synthetic forest',
    'scenes/courtyard.png': 'synthetic courtyard',
    'media/flower.mp4': 'synthetic video',
    'media/readme.txt': 'ordinary public text remains public',
  };
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(publicDir, name), content);
  return { root, publicDir, outDir, files };
}

function assertCopied({ publicDir, outDir, files }) {
  const output = readdirSync(outDir, { recursive: true }).map(name => name.split(path.sep).join('/'));
  for (const [name, content] of Object.entries(files)) {
    assert.equal(readFileSync(path.join(publicDir, name), 'utf8'), content, `source preserved: ${name}`);
    if (name === 'frame-studio-logo-prompt.txt' || name === 'scenes/asset-prompts.txt') {
      assert.ok(!output.includes(name), `private path excluded: ${name}`);
    } else assert.equal(readFileSync(path.join(outDir, name), 'utf8'), content, `public asset preserved: ${name}`);
  }
}

test('public asset copy excludes only private generation records and preserves originals', t => {
  const sample = fixture(t);
  copyPublicAssets(sample.publicDir, sample.outDir);
  assertCopied(sample);
});

test('build hook copies required assets without overwriting the generated app', t => {
  const sample = fixture(t);
  mkdirSync(sample.outDir, { recursive: true });
  writeFileSync(path.join(sample.outDir, 'index.html'), 'generated app');
  const plugin = publicAssetsPlugin();
  assert.equal(plugin.apply, 'build');
  plugin.configResolved({ root: sample.root, publicDir: sample.publicDir, build: { outDir: 'dist/client' } });
  plugin.closeBundle();
  assertCopied(sample);
  assert.equal(readFileSync(path.join(sample.outDir, 'index.html'), 'utf8'), 'generated app');
});

test('missing or disabled public directory does not fail a build', t => {
  const sample = fixture(t);
  copyPublicAssets(path.join(sample.root, 'missing'), sample.outDir);
  const plugin = publicAssetsPlugin();
  plugin.configResolved({ root: sample.root, publicDir: false, build: { outDir: 'dist/client' } });
  plugin.closeBundle();
});