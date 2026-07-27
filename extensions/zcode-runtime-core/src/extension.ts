/**
 * ZCode runtime core — registry + Run File / Select backend (WB0).
 * Other extensions register backends on globalThis.zcodeRuntime.
 */
import * as vscode from 'vscode';
import { installGlobalRegistry, RuntimeRegistry } from './registry.js';

let registry: RuntimeRegistry | undefined;
let statusItem: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext): void {
  registry = new RuntimeRegistry();
  installGlobalRegistry(registry);

  const cfgBackend = vscode.workspace.getConfiguration('zcode.execution').get<string>('backend', 'auto');
  registry.setActive(cfgBackend === 'auto' ? 'auto' : cfgBackend);

  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusItem.command = 'zcode.runtime.selectBackend';
  statusItem.tooltip = 'ZCode execution backend';
  updateStatus();
  statusItem.show();

  context.subscriptions.push(
    statusItem,
    registry.onDidChange(() => updateStatus()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('zcode.execution.backend') && registry) {
        const v = vscode.workspace.getConfiguration('zcode.execution').get<string>('backend', 'auto');
        registry.setActive(v === 'auto' ? 'auto' : v);
      }
    }),
    vscode.commands.registerCommand('zcode.runtime.runFile', () => runActive(false)),
    vscode.commands.registerCommand('zcode.runtime.runSelection', () => runActive(true)),
    vscode.commands.registerCommand('zcode.runtime.selectBackend', () => selectBackend()),
    vscode.commands.registerCommand('zcode.runtime.showStatus', () => showStatus()),
    vscode.commands.registerCommand('zcode.runtime.openShell', () => openShell()),
    {
      dispose: () => {
        registry?.disposeAll();
        registry = undefined;
        if (globalThis.zcodeRuntime) {
          delete (globalThis as { zcodeRuntime?: unknown }).zcodeRuntime;
        }
      },
    },
  );
}

export function deactivate(): void {
  registry?.disposeAll();
  registry = undefined;
}

function updateStatus(): void {
  if (!statusItem || !registry) return;
  const ed = vscode.window.activeTextEditor;
  const lang = ed?.document.languageId ?? '';
  const id = registry.getActiveId(lang);
  const info = registry.get(id)?.info;
  const label = info?.label ?? (id === 'none' ? 'No runtime' : id);
  statusItem.text = `$(play) ${label}`;
}

async function selectBackend(): Promise<void> {
  if (!registry) return;
  const items = [
    { label: 'Auto (by language)', id: 'auto' as const },
    ...registry.list().map((b) => ({ label: b.label, description: b.id, id: b.id })),
  ];
  if (items.length === 1) {
    void vscode.window.showInformationMessage(
      'No execution backends registered yet. Install zcode-runtime-python / zcode-runtime-node.',
    );
    return;
  }
  const pick = await vscode.window.showQuickPick(items, {
    title: 'ZCode execution backend',
    placeHolder: 'Select Run target',
  });
  if (!pick) return;
  registry.setActive(pick.id);
  await vscode.workspace
    .getConfiguration('zcode.execution')
    .update('backend', pick.id, vscode.ConfigurationTarget.Global);
  updateStatus();
}

async function showStatus(): Promise<void> {
  if (!registry) return;
  const backends = registry.list();
  const ed = vscode.window.activeTextEditor;
  const active = registry.getActiveId(ed?.document.languageId ?? '');
  const lines = [
    `Active: ${active}`,
    `Backends (${backends.length}):`,
    ...backends.map((b) => `  - ${b.id}: ${b.label} [${b.languages.join(', ')}]`),
  ];
  const doc = await vscode.workspace.openTextDocument({
    content: lines.join('\n'),
    language: 'markdown',
  });
  await vscode.window.showTextDocument(doc, { preview: true });
}

/**
 * Open an interactive browser shell for the active backend / language.
 * Prefer backend.openTerminal; fall back to known extension commands.
 */
async function openShell(): Promise<void> {
  if (!registry) {
    void vscode.window.showErrorMessage('ZCode runtime not initialized');
    return;
  }
  const ed = vscode.window.activeTextEditor;
  const lang = ed?.document.languageId ?? '';
  const backendId = registry.getActiveId(lang);
  const backend = registry.get(backendId);

  if (backend?.openTerminal) {
    backend.openTerminal();
    return;
  }

  // Language-aware fallbacks (extensions register commands)
  if (lang === 'python' || backendId === 'browser-python') {
    await vscode.commands.executeCommand('zcode.runtime.python.repl');
    return;
  }
  if (
    lang === 'javascript' ||
    lang === 'typescript' ||
    lang === 'javascriptreact' ||
    lang === 'typescriptreact' ||
    backendId === 'browser-node'
  ) {
    await vscode.commands.executeCommand('zcode.runtime.node.openShell');
    return;
  }

  // Quick pick when language is ambiguous
  const pick = await vscode.window.showQuickPick(
    [
      { label: 'WebContainer Shell', id: 'node' as const, description: 'jsh via WebContainers' },
      { label: 'Python (Pyodide) REPL', id: 'python' as const, description: 'Browser CPython' },
    ],
    { title: 'ZCode browser shell', placeHolder: 'Choose interactive terminal' },
  );
  if (!pick) return;
  if (pick.id === 'python') {
    await vscode.commands.executeCommand('zcode.runtime.python.repl');
  } else {
    await vscode.commands.executeCommand('zcode.runtime.node.openShell');
  }
}

async function runActive(selectionOnly: boolean): Promise<void> {
  if (!registry) {
    void vscode.window.showErrorMessage('ZCode runtime not initialized');
    return;
  }
  const ed = vscode.window.activeTextEditor;
  if (!ed) {
    void vscode.window.showErrorMessage('No active editor');
    return;
  }
  const doc = ed.document;
  const languageId = doc.languageId;
  const backendId = registry.getActiveId(languageId);
  const backend = registry.get(backendId);
  if (!backend) {
    void vscode.window.showErrorMessage(
      `No execution backend for ${languageId}. Open a Python/JS file or select a backend.`,
    );
    return;
  }

  let code: string;
  if (selectionOnly) {
    const sel = ed.selection;
    code = doc.getText(sel.isEmpty ? undefined : sel);
    if (!code.trim()) {
      void vscode.window.showErrorMessage('Nothing selected');
      return;
    }
  } else {
    if (doc.isDirty) {
      await doc.save();
    }
    code = doc.getText();
  }

  const channel = vscode.window.createOutputChannel('ZCode Run', { log: true });
  channel.show(true);
  channel.appendLine(`$ ${backend.info.label} · ${doc.fileName}`);
  channel.appendLine('---');

  try {
    if (backend.startSession) {
      channel.appendLine('Starting runtime…');
      await backend.startSession();
    }
    const result = await backend.run({
      uri: doc.uri.toString(),
      path: doc.uri.path,
      code,
      languageId,
      onStdout: (c) => channel.append(c),
      onStderr: (c) => channel.append(c),
    });
    channel.appendLine('---');
    channel.appendLine(`exit ${result.exitCode}`);
    if (result.exitCode !== 0) {
      void vscode.window.showWarningMessage(`Run finished with exit ${result.exitCode}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    channel.appendLine(`error: ${msg}`);
    void vscode.window.showErrorMessage(`ZCode Run failed: ${msg}`);
  }
}
