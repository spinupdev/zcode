/**
 * ZCode browser workspace app.
 * Clone via worker + isomorphic-git + same-origin /git-proxy; durable IDB FS.
 */
import { createBrowserAgent, type ZCodeBrowserAgent } from '@zcode/browser-agent';
import type { CloneProgress } from '@zcode/protocol';
import { bootstrapFromUrl } from '@zcode/shell';
import { cloneInWorker } from './clone-client.js';
import {
  type AppConfig,
  loadConfig,
  saveConfig,
  normalizeProxyUrl,
  testGitProxy,
} from './config.js';

const agent = createBrowserAgent() as ZCodeBrowserAgent;
let config: AppConfig = loadConfig();
let workspaceId: string | null = null;
let currentFile: string | null = null;
let allFiles: string[] = [];
let treeFilter = '';
let cloning = false;

const el = {
  mode: document.getElementById('mode')!,
  log: document.getElementById('log')!,
  tree: document.getElementById('tree')!,
  editor: document.getElementById('editor') as HTMLTextAreaElement,
  status: document.getElementById('status')!,
  url: document.getElementById('clone-url') as HTMLInputElement,
  proxy: document.getElementById('proxy-url') as HTMLInputElement,
  token: document.getElementById('git-token') as HTMLInputElement,
  msg: document.getElementById('commit-msg') as HTMLInputElement,
  progress: document.getElementById('progress') as HTMLProgressElement,
  progressLabel: document.getElementById('progress-label')!,
  proxyStatus: document.getElementById('proxy-status')!,
  treeMeta: document.getElementById('tree-meta')!,
  treeFilter: document.getElementById('tree-filter') as HTMLInputElement,
  btnClone: document.getElementById('btn-clone') as HTMLButtonElement,
  search: document.getElementById('search-query') as HTMLInputElement,
  searchResults: document.getElementById('search-results')!,
  workspaceSelect: document.getElementById('workspace-select') as HTMLSelectElement,
};

function currentAuth() {
  const password = el.token.value.trim() || config.gitToken?.trim();
  if (!password) return undefined;
  return { username: config.gitUsername || 'git', password };
}

function log(msg: string) {
  const line = `${new Date().toISOString().slice(11, 19)} ${msg}`;
  el.log.textContent = `${line}\n${el.log.textContent ?? ''}`.slice(0, 12_000);
}

function setStatus(s: string) {
  el.status.textContent = s;
}

function setProgress(p: CloneProgress) {
  const loaded = p.receivedObjects ?? 0;
  const total = p.totalObjects ?? 0;
  let pct = 0;
  if (p.phase === 'done') pct = 100;
  else if (total > 0) pct = Math.min(99, Math.round((loaded / total) * 100));
  else if (p.phase === 'receiving') pct = Math.min(90, 10 + (loaded % 80));
  else if (p.phase === 'resolving') pct = 92;
  else pct = 5;

  el.progress.value = pct;
  el.progress.hidden = false;
  const detail =
    total > 0
      ? `${p.phase} ${loaded}/${total} (${pct}%)`
      : p.message
        ? `${p.phase}: ${p.message}`
        : `${p.phase}${loaded ? ` ${loaded}` : ''}`;
  el.progressLabel.textContent = detail;
  setStatus(detail);
}

function hideProgressSoon() {
  setTimeout(() => {
    if (!cloning) {
      el.progress.hidden = true;
      el.progressLabel.textContent = '';
    }
  }, 1500);
}

function applyConfigToForm() {
  el.proxy.value = config.gitProxyUrl;
  el.url.value = config.cloneUrl;
  if (config.gitToken) el.token.value = config.gitToken;
}

function readConfigFromForm(): AppConfig {
  return {
    ...config,
    gitProxyUrl: normalizeProxyUrl(el.proxy.value),
    cloneUrl: el.url.value.trim(),
    gitToken: el.token.value.trim() || undefined,
  };
}

function persistConfig() {
  config = readConfigFromForm();
  saveConfig(config);
  log(`config saved (proxy=${config.gitProxyUrl}${config.gitToken ? ', token set' : ''})`);
}

async function checkProxy() {
  const proxy = normalizeProxyUrl(el.proxy.value || config.gitProxyUrl);
  el.proxyStatus.textContent = 'checking…';
  el.proxyStatus.className = 'proxy-status';
  try {
    const r = await testGitProxy(proxy);
    if (r.ok) {
      el.proxyStatus.textContent = `proxy ok (${r.latencyMs}ms)`;
      el.proxyStatus.className = 'proxy-status ok';
      log(`proxy healthz ok ${proxy} ${r.latencyMs}ms`);
    } else {
      el.proxyStatus.textContent = `proxy HTTP ${r.status}`;
      el.proxyStatus.className = 'proxy-status bad';
      log(`proxy unhealthy ${proxy} status=${r.status}`);
    }
  } catch (err) {
    el.proxyStatus.textContent = 'proxy unreachable';
    el.proxyStatus.className = 'proxy-status bad';
    log(
      `proxy unreachable at ${proxy}: ${err instanceof Error ? err.message : String(err)}. Use zcode web (embeds /git-proxy) or deploy the CF Worker.`,
    );
  }
}

function renderTree() {
  el.tree.innerHTML = '';
  const q = treeFilter.trim().toLowerCase();
  const filtered = q ? allFiles.filter((f) => f.toLowerCase().includes(q)) : allFiles;
  const limit = config.treePageSize;
  const slice = filtered.slice(0, limit);

  for (const f of slice) {
    const li = document.createElement('button');
    li.type = 'button';
    li.className = 'file';
    li.textContent = f;
    li.title = f;
    li.onclick = () => void openFile(f);
    el.tree.appendChild(li);
  }

  el.treeMeta.textContent =
    filtered.length > limit
      ? `showing ${slice.length} of ${filtered.length} files`
      : `${filtered.length} files`;
}

async function refreshTree() {
  if (!workspaceId) return;
  setStatus('listing files…');
  allFiles = await agent.listFiles(workspaceId);
  renderTree();
  setStatus(`${allFiles.length} files`);
}

async function refreshWorkspaceList() {
  const list = await agent.listWorkspaces();
  el.workspaceSelect.innerHTML = '';
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = list.length ? 'Select workspace…' : 'No saved workspaces';
  el.workspaceSelect.appendChild(blank);
  for (const w of list) {
    const o = document.createElement('option');
    o.value = w.id;
    o.textContent = `${w.name} (${w.id.slice(0, 8)})`;
    if (w.id === workspaceId) o.selected = true;
    el.workspaceSelect.appendChild(o);
  }
  const est = await agent.storageEstimate();
  log(
    `storage ~${Math.round((est.usage / 1024 / 1024) * 10) / 10}MB / ${Math.round(est.quota / 1024 / 1024)}MB · ${list.length} workspace(s)`,
  );
}

async function openWorkspace(id: string) {
  workspaceId = id;
  currentFile = null;
  el.editor.value = '';
  el.editor.disabled = true;
  await refreshTree();
  const st = await agent.status(id);
  setStatus(`${st.branch}${st.dirty ? ' *' : ''} · ${allFiles.length} files`);
  log(`opened workspace ${id.slice(0, 8)}…`);
}

async function openFile(path: string) {
  if (!workspaceId) return;
  currentFile = path;
  el.editor.value = await agent.readFile(workspaceId, path);
  el.editor.disabled = false;
  setStatus(`editing ${path}`);
}

async function saveFile() {
  if (!workspaceId || !currentFile) return;
  await agent.writeFile(workspaceId, currentFile, el.editor.value);
  log(`saved ${currentFile}`);
  const st = await agent.status(workspaceId);
  setStatus(`${st.branch}${st.dirty ? ' *' : ''} · saved`);
}

async function doClone() {
  if (cloning) return;
  persistConfig();
  const url = config.cloneUrl;
  const corsProxyUrl = config.gitProxyUrl;
  if (!url || !corsProxyUrl) {
    log('clone url and proxy required');
    return;
  }

  cloning = true;
  el.btnClone.disabled = true;
  const id = crypto.randomUUID();
  workspaceId = id;
  allFiles = [];
  renderTree();
  log(`cloning ${url} (web worker)`);
  log(`corsProxy ${corsProxyUrl}`);
  setProgress({ phase: 'negotiating', message: 'starting worker…' });

  await checkProxy();

  let lastLog = 0;
  try {
    const auth = currentAuth();
    if (auth) log('using HTTPS token for private access (not logged)');
    const ws = await cloneInWorker(agent, {
      workspaceId: id,
      url,
      corsProxyUrl,
      depth: 1,
      auth,
      onProgress: (p) => {
        setProgress(p);
        const now = Date.now();
        if (p.phase === 'done' || now - lastLog > 300) {
          lastLog = now;
          const bit =
            p.totalObjects && p.receivedObjects != null
              ? `${p.receivedObjects}/${p.totalObjects}`
              : (p.message ?? p.phase);
          log(`clone ${p.phase} ${bit}`);
        }
      },
    });
    workspaceId = ws.id;
    log(`cloned ${ws.name} → ${ws.uri}`);
    await refreshTree();
    await refreshWorkspaceList();
    const st = await agent.status(ws.id);
    setStatus(`${st.branch} · ready · ${allFiles.length} files`);
    log(`ready on branch ${st.branch} (persisted in IndexedDB)`);
    log('Next: edit → Save → Commit → Push (token required for private remotes)');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`clone failed: ${message}`);
    setStatus('clone failed');
    workspaceId = null;
    el.progressLabel.textContent = 'failed';
  } finally {
    cloning = false;
    el.btnClone.disabled = false;
    hideProgressSoon();
  }
}

async function doCommit() {
  if (!workspaceId) return;
  if (currentFile) await saveFile();
  const message = el.msg.value.trim() || 'Update from ZCode';
  try {
    const { oid } = await agent.commit({
      workspaceId,
      message,
      author: { name: config.authorName, email: config.authorEmail },
    });
    log(`commit ${oid.slice(0, 7)} ${message}`);
    const st = await agent.status(workspaceId);
    setStatus(`${st.branch}${st.dirty ? ' *' : ''}`);
  } catch (err) {
    log(`commit failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function doPush() {
  if (!workspaceId) {
    log('open or clone a workspace first');
    return;
  }
  persistConfig();
  const corsProxyUrl = config.gitProxyUrl;
  const auth = currentAuth();
  setStatus('pushing…');
  log(`push origin via ${corsProxyUrl}${auth ? ' (with token)' : ' (no token)'}`);
  try {
    await agent.push({
      workspaceId,
      corsProxyUrl,
      auth,
    });
    log('push ok');
    const st = await agent.status(workspaceId);
    setStatus(`${st.branch} · pushed`);
  } catch (err) {
    log(`push failed: ${err instanceof Error ? err.message : String(err)}`);
    setStatus('push failed');
  }
}

async function doSearch() {
  if (!workspaceId) {
    log('open or clone a workspace first');
    return;
  }
  const query = el.search.value.trim();
  if (!query) return;
  setStatus(`search “${query}”…`);
  const hits = await agent.search({ workspaceId, query, maxHits: 80 });
  el.searchResults.innerHTML = '';
  if (!hits.length) {
    el.searchResults.textContent = 'No matches';
    setStatus('no matches');
    return;
  }
  for (const h of hits) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'search-hit';
    b.textContent = `${h.path}:${h.line}  ${h.text.trim()}`;
    b.title = h.text;
    b.onclick = () => void openFile(h.path);
    el.searchResults.appendChild(b);
  }
  setStatus(`${hits.length} hits`);
  log(`search “${query}” → ${hits.length} hits`);
}

function wire() {
  const boot = bootstrapFromUrl(window.location.href);
  el.mode.textContent = `mode=${boot.mode} · browser workspace`;

  applyConfigToForm();

  document.getElementById('btn-clone')!.addEventListener('click', () => void doClone());
  document.getElementById('btn-save')!.addEventListener('click', () => void saveFile());
  document.getElementById('btn-commit')!.addEventListener('click', () => void doCommit());
  document.getElementById('btn-push')?.addEventListener('click', () => void doPush());
  document.getElementById('btn-push-toolbar')?.addEventListener('click', () => void doPush());
  document.getElementById('btn-refresh')!.addEventListener('click', () => void refreshTree());
  document.getElementById('btn-save-config')!.addEventListener('click', () => {
    persistConfig();
    void checkProxy();
  });
  document.getElementById('btn-test-proxy')!.addEventListener('click', () => void checkProxy());
  document.getElementById('btn-search')!.addEventListener('click', () => void doSearch());
  el.search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void doSearch();
  });

  el.proxy.addEventListener('change', () => persistConfig());
  el.url.addEventListener('change', () => persistConfig());
  el.token.addEventListener('change', () => persistConfig());
  el.treeFilter.addEventListener('input', () => {
    treeFilter = el.treeFilter.value;
    renderTree();
  });
  el.workspaceSelect.addEventListener('change', () => {
    const id = el.workspaceSelect.value;
    if (id) void openWorkspace(id);
  });

  el.editor.disabled = true;
  el.progress.hidden = true;

  log('ZCode browser workspace ready.');
  log(`proxy: ${config.gitProxyUrl} (same-origin /git-proxy preferred)`);
  log('To clone: set Clone URL → Test proxy (green) → Clone.');
  log('Clones run in a Web Worker; workspaces persist in IndexedDB.');
  void checkProxy().then(() => {
    const params = new URLSearchParams(location.search);
    // ?clone=https://…&autoclone=1 starts clone after proxy check
    if (params.get('autoclone') === '1' && config.cloneUrl) {
      log('autoclone=1 — starting clone…');
      void doClone();
    }
  });
  void refreshWorkspaceList();
}

wire();
