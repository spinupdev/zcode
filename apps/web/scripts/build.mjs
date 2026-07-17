import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const shim = join(root, 'src/shims/empty.js');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const common = {
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  sourcemap: true,
  logLevel: 'info',
  define: {
    // Keep browser bundles free of bare `process` references from workspace packages.
    'process.env.NODE_ENV': '"production"',
    'process.env': '{"NODE_ENV":"production"}',
    global: 'globalThis',
  },
  alias: {
    'node:crypto': shim,
    crypto: shim,
  },
};

await esbuild.build({
  ...common,
  entryPoints: [join(root, 'src/app.ts')],
  outfile: join(dist, 'app.js'),
});

await esbuild.build({
  ...common,
  entryPoints: [join(root, 'src/git-worker.ts')],
  outfile: join(dist, 'git-worker.js'),
});

cpSync(join(root, 'index.html'), join(dist, 'index.html'));
cpSync(join(root, 'app.css'), join(dist, 'app.css'));

console.log('apps/web: bundled app.js + git-worker.js → dist/');
