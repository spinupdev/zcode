import * as esbuild from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'dist/web'), { recursive: true });

// Bundle IdbFs from @zcode/browser-agent into the web extension (vscode stays external)
await esbuild.build({
  entryPoints: [join(root, 'src/extension.ts')],
  bundle: true,
  outfile: join(root, 'dist/web/extension.js'),
  format: 'cjs',
  platform: 'browser',
  target: ['es2022'],
  external: ['vscode'],
  logLevel: 'info',
  // Tree-shake node-only paths if any
  mainFields: ['browser', 'module', 'main'],
  conditions: ['browser', 'import', 'default'],
});

console.log('zcode-browser-fs: built dist/web/extension.js (IDB shared with SPA)');
