import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });
writeFileSync(
  join(dist, 'README.txt'),
  [
    'ZCode web workbench assets placeholder.',
    'Production static assets come from microsoft/vscode OSS web build (PR M0).',
    '@vscode/test-web is dev/test only and must never appear in release artifacts.',
    '',
  ].join('\n'),
);
console.log('apps/web: wrote dist/README.txt (placeholder until M0)');
