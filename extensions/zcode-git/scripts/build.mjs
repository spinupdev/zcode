import * as esbuild from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'dist/web'), { recursive: true });

await esbuild.build({
  entryPoints: [join(root, 'src/extension.ts')],
  bundle: true,
  outfile: join(root, 'dist/web/extension.js'),
  format: 'cjs',
  platform: 'browser',
  target: ['es2022'],
  external: ['vscode'],
  logLevel: 'info',
});

console.log('zcode-git: built dist/web/extension.js');
