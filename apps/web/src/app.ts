/**
 * ZCode browser workspace app (integrated MVP shell).
 * Clone via isomorphic-git + git-proxy, edit files in-memory, commit locally.
 */
import { createBrowserAgent, type ZCodeBrowserAgent } from '@zcode/browser-agent';
import { bootstrapFromUrl } from '@zcode/shell';

const agent = createBrowserAgent() as ZCodeBrowserAgent;
let workspaceId: string | null = null;
let currentFile: string | null = null;

const el = {
  mode: document.getElementById('mode')!,
  log: document.getElementById('log')!,
  tree: document.getElementById('tree')!,
  editor: document.getElementById('editor') as HTMLTextAreaElement,
  status: document.getElementById('status')!,
  url: document.getElementById('clone-url') as HTMLInputElement,
  proxy: document.getElementById('proxy-url') as HTMLInputElement,
  msg: document.getElementById('commit-msg') as HTMLInputElement,
};

function log(msg: string) {
  el.log.textContent = `${new Date().toISOString().slice(11, 19)} ${msg}\n` + el.log.textContent;
}

function setStatus(s: string) {
  el.status.textContent = s;
}

async function refreshTree() {
  el.tree.innerHTML = '';
  if (!workspaceId) return;
  const files = await agent.listFiles(workspaceId);
  for (const f of files) {
    const li = document.createElement('button');
    li.type = 'button';
    li.className = 'file';
    li.textContent = f;
    li.onclick = () => void openFile(f);
    el.tree.appendChild(li);
  }
  setStatus(`${files.length} files`);
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
  const url = el.url.value.trim();
  const corsProxyUrl = el.proxy.value.trim();
  if (!url || !corsProxyUrl) {
    log('clone url and proxy required');
    return;
  }
  workspaceId = crypto.randomUUID();
  log(`cloning ${url} …`);
  setStatus('cloning…');
  try {
    const ws = await agent.clone({
      workspaceId,
      url,
      corsProxyUrl,
      depth: 1,
      onProgress: (p) => setStatus(`${p.phase} ${p.receivedObjects ?? ''}/${p.totalObjects ?? ''}`),
    });
    log(`cloned ${ws.name} → ${ws.uri}`);
    await refreshTree();
    const st = await agent.status(workspaceId);
    setStatus(`${st.branch} · ready`);
  } catch (err) {
    log(`clone failed: ${err instanceof Error ? err.message : String(err)}`);
    setStatus('clone failed');
    workspaceId = null;
  }
}

async function doCommit() {
  if (!workspaceId) return;
  if (currentFile) await saveFile();
  const message = el.msg.value.trim() || 'Update from ZCode';
  try {
    const { oid } = await agent.commit({ workspaceId, message });
    log(`commit ${oid.slice(0, 7)} ${message}`);
    const st = await agent.status(workspaceId);
    setStatus(`${st.branch}${st.dirty ? ' *' : ''}`);
  } catch (err) {
    log(`commit failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function wire() {
  const boot = bootstrapFromUrl(window.location.href);
  el.mode.textContent = `mode=${boot.mode} terminal=${boot.capabilities.terminal} search=${boot.capabilities.search}`;

  document.getElementById('btn-clone')!.addEventListener('click', () => void doClone());
  document.getElementById('btn-save')!.addEventListener('click', () => void saveFile());
  document.getElementById('btn-commit')!.addEventListener('click', () => void doCommit());
  document.getElementById('btn-refresh')!.addEventListener('click', () => void refreshTree());

  // defaults
  if (!el.proxy.value) el.proxy.value = 'http://127.0.0.1:8787';
  if (!el.url.value) el.url.value = 'https://github.com/isomorphic-git/isomorphic-git.git';

  log('ZCode browser workspace ready. Start git-proxy, then Clone.');
  el.editor.disabled = true;
}

wire();
