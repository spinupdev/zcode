import type { AgentFs } from './memory-fs.js';
import type { WorkspaceStore } from './workspace-store.js';

export interface SearchHit {
  path: string;
  line: number;
  text: string;
}

export interface SearchOpts {
  workspaceId: string;
  query: string;
  /** case-insensitive if true */
  ignoreCase?: boolean;
  maxHits?: number;
  maxFileBytes?: number;
}

const TEXT_EXT =
  /\.(md|txt|json|js|ts|tsx|jsx|mjs|cjs|css|html|htm|yml|yaml|toml|rs|go|py|java|kt|swift|c|cc|cpp|h|hpp|sh|bash|zsh|xml|svg|csv|sql|graphql|vue|svelte|rb|php|cs|fs|scala|r|jl|lua|pl|pm|ini|cfg|conf|env|dockerfile|makefile|editorconfig|gitignore|npmrc|lock)$/i;

export async function searchWorkspace(
  fs: AgentFs,
  store: WorkspaceStore,
  opts: SearchOpts,
): Promise<SearchHit[]> {
  const rec = store.get(opts.workspaceId);
  if (!rec) {
    throw Object.assign(new Error(`workspace not found: ${opts.workspaceId}`), {
      code: 'NOT_FOUND',
    });
  }
  const q = opts.query;
  if (!q) return [];
  const maxHits = opts.maxHits ?? 100;
  const maxFileBytes = opts.maxFileBytes ?? 256 * 1024;
  const ignoreCase = opts.ignoreCase !== false;
  const needle = ignoreCase ? q.toLowerCase() : q;

  if (!fs.listFiles) return [];
  const all = await fs.listFiles(rec.rootKey);
  const prefix = rec.rootKey + '/';
  const hits: SearchHit[] = [];

  for (const full of all) {
    if (!full.startsWith(prefix) || full.includes('/.git/')) continue;
    const rel = full.slice(prefix.length);
    if (!TEXT_EXT.test(rel) && !rel.includes('.')) {
      // skip likely binary/no-ext large blobs unless small
    } else if (!TEXT_EXT.test(rel) && rel.match(/\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot|zip|gz|tgz|br|wasm|bin|pdf)$/i)) {
      continue;
    }

    let data: Uint8Array;
    try {
      data = await fs.readFile(full);
    } catch {
      continue;
    }
    if (data.byteLength > maxFileBytes) continue;
    // skip binary
    if (looksBinary(data)) continue;

    const text = new TextDecoder('utf-8', { fatal: false }).decode(data);
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const hay = ignoreCase ? line.toLowerCase() : line;
      if (hay.includes(needle)) {
        hits.push({ path: rel, line: i + 1, text: line.slice(0, 240) });
        if (hits.length >= maxHits) return hits;
      }
    }
  }
  return hits;
}

function looksBinary(data: Uint8Array): boolean {
  const n = Math.min(data.length, 800);
  let weird = 0;
  for (let i = 0; i < n; i++) {
    const c = data[i]!;
    if (c === 0) return true;
    if (c < 7 || (c > 14 && c < 32 && c !== 9 && c !== 10 && c !== 13)) weird++;
  }
  return weird / n > 0.3;
}
