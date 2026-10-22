import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const privatePublicPaths = new Set([
  'frame-studio-logo-prompt.txt',
  'scenes/asset-prompts.txt',
]);

// Filter paths before copying; never read private generation records.
export function copyPublicAssets(publicDir, outDir) {
  if (!existsSync(publicDir)) return;
  mkdirSync(outDir, { recursive: true });
  cpSync(publicDir, outDir, {
    recursive: true,
    filter: source => !privatePublicPaths.has(path.relative(publicDir, source).split(path.sep).join('/')),
  });
}

export function publicAssetsPlugin() {
  let config;
  return {
    name: 'frame-studio-public-assets',
    apply: 'build',
    configResolved(resolved) { config = resolved; },
    closeBundle() {
      if (config.publicDir) copyPublicAssets(config.publicDir, path.resolve(config.root, config.build.outDir));
    },
  };
}