/**
 * ZCode browser workspace app.
 * Clone via isomorphic-git + git-proxy, edit files in-memory, commit locally.
 */
import { createBrowserAgent, type ZCodeBrowserAgent } from '@zcode/browser-agent';
import type { CloneProgress } from '@zcode/protocol';
import { bootstrapFromUrl } from '@zcode/shell';
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
  msg: document.getElementById('commit-msg') as HTMLInputElement,
  progress: document.getElementById('progress') as HTMLProgressElement,
  progressLabel: document.getElementById('progress-label')!,
  proxyStatus: document.getElementById('proxy-status')!,
  treeMeta: document.getElementById('tree-meta')!,
  treeFilter: document.getElementById('tree-filter') as HTMLInputElement,
  btnClone: document.getElementById('btn-clone') as HTMLButtonElement,
};

function log(msg: string) {
  const line = `${new Date().toISOString().slice(11, 19)} ${msg}`;
  el.log.textContent = `${line}\n${el.log.textContent ?? ''}`.slice(0, 12_000);
}

function setStatus(s: string) {
  el.status.textContent = s;
}

/** Yield to the browser so status/progress can paint during long clones. */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
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
}

function readConfigFromForm(): AppConfig {
  return {
    ...config,
    gitProxyUrl: normalizeProxyUrl(el.proxy.value),
    cloneUrl: el.url.value.trim(),
  };
}

function persistConfig() {
  config = readConfigFromForm();
  saveConfig(config);
  log(`config saved (proxy=${config.gitProxyUrl})`);
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
      log(`proxy unhealthy ${proxy} status=${r.status} body=${r.body ?? ''}`);
    }
  } catch (err) {
    el.proxyStatus.textContent = 'proxy unreachable';
    el.proxyStatus.className = 'proxy-status bad';
    log(
      `proxy unreachable at ${proxy}: ${err instanceof Error ? err.message : String(err)}. Run: node apps/cli/dist/cli.js git-proxy --port 8787`,
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
      ? `showing ${slice.length} of ${filtered.length} files (filter to narrow)`
      : `${filtered.length} files`;
}

async function refreshTree() {
  if (!workspaceId) return;
  setStatus('listing files…');
  await yieldToUi();
  allFiles = await agent.listFiles(workspaceId);
  renderTree();
  setStatus(`${allFiles.length} files`);
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
    log('clone url and proxy required — set them in App config');
    return;
  }

  cloning = true;
  el.btnClone.disabled = true;
  workspaceId = crypto.randomUUID();
  allFiles = [];
  renderTree();
  log(`cloning ${url}`);
  log(`using corsProxy ${corsProxyUrl}`);
  setProgress({ phase: 'negotiating', message: 'starting…' });

  // Pre-flight proxy so failures are obvious
  try {
    await checkProxy();
  } catch {
    /* already logged */
  }

  let lastLog = 0;
  try {
    const ws = await agent.clone({
      workspaceId,
      url,
      corsProxyUrl,
      depth: 1,
      onProgress: (p) => {
        setProgress(p);
        const now = Date.now();
        if (p.phase === 'done' || now - lastLog > 400) {
          lastLog = now;
          const bit =
            p.totalObjects && p.receivedObjects != null
              ? `${p.receivedObjects}/${p.totalObjects}`
              : p.message ?? p.phase;
          log(`clone ${p.phase} ${bit}`);
        }
        // Note: UI may still freeze during checkout (main-thread CPU); progress
        // resumes when the browser can paint again.
      },
    });
    log(`cloned ${ws.name} (${ws.approxBytes ?? 0} bytes) → ${ws.uri}`);
    setProgress({ phase: 'done', message: 'building file list…' });
    await yieldToUi();
    await refreshTree();
    const st = await agent.status(workspaceId);
    setStatus(`${st.branch} · ready · ${allFiles.length} files`);
    log(`ready on branch ${st.branch}`);
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

function wire() {
  const boot = bootstrapFromUrl(window.location.href);
  el.mode.textContent = `mode=${boot.mode} · browser workspace`;

  applyConfigToForm();

  document.getElementById('btn-clone')!.addEventListener('click', () => void doClone());
  document.getElementById('btn-save')!.addEventListener('click', () => void saveFile());
  document.getElementById('btn-commit')!.addEventListener('click', () => void doCommit());
  document.getElementById('btn-refresh')!.addEventListener('click', () => void refreshTree());
  document.getElementById('btn-save-config')!.addEventListener('click', () => {
    persistConfig();
    void checkProxy();
  });
  document.getElementById('btn-test-proxy')!.addEventListener('click', () => void checkProxy());

  el.proxy.addEventListener('change', () => persistConfig());
  el.url.addEventListener('change', () => persistConfig());
  el.treeFilter.addEventListener('input', () => {
    treeFilter = el.treeFilter.value;
    renderTree();
  });

  el.editor.disabled = true;
  el.progress.hidden = true;

  log('ZCode browser workspace ready.');
  log(`proxy config: ${config.gitProxyUrl} (persisted in localStorage; override with ?proxy=)`);
  log('1) Start proxy: node apps/cli/dist/cli.js git-proxy --port 8787');
  log('2) Click “Test proxy”, then Clone. Large repos may freeze the tab briefly during checkout.');
  void checkProxy();
}

wire();
