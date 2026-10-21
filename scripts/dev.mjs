import { spawn } from 'node:child_process';
const children = [
  spawn(process.execPath, ['--env-file-if-exists=.env', 'server/index.mjs'], { stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...process.argv.slice(2)], { stdio: 'inherit' }),
];
let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  children.forEach(child => child.kill());
  process.exit(code);
}
children.forEach(child => { child.on('error', () => close(1)); child.on('exit', code => close(code ?? 0)); });
process.on('SIGINT', () => close());
process.on('SIGTERM', () => close());
