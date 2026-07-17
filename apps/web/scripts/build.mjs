import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await esbuild.build({
  entryPoints: [join(root, 'src/app.ts')],
  bundle: true,
  outfile: join(dist, 'app.js'),
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  sourcemap: true,
  logLevel: 'info',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  // isomorphic-git may pull optional node paths — stub for browser
  alias: {
    'node:crypto': join(root, 'src/shims/empty.js'),
    crypto: join(root, 'src/shims/empty.js'),
  },
});

cpSync(join(root, 'index.html'), join(dist, 'index.html'));
cpSync(join(root, 'app.css'), join(dist, 'app.css'));

console.log('apps/web: bundled browser workspace → dist/');
