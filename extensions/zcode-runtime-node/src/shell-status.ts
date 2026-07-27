/**
 * Status bar + progress feedback for WebContainer shell boot.
 */
import * as vscode from 'vscode';

export type ShellPhase =
  | 'idle'
  | 'downloading'
  | 'booting'
  | 'mounting'
  | 'ready'
  | 'error';

export type ShellPhaseListener = (phase: ShellPhase, detail?: string) => void;

export class ShellStatusBar {
  private readonly item: vscode.StatusBarItem;
  private phase: ShellPhase = 'idle';
  private detail = '';

  constructor(command = 'zcode.runtime.node.openShell') {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 49);
    this.item.command = command;
    this.item.tooltip = 'ZCode browser shell (WebContainer)';
    this.render();
    this.item.show();
  }

  get disposable(): vscode.Disposable {
    return this.item;
  }

  get current(): ShellPhase {
    return this.phase;
  }

  setPhase(phase: ShellPhase, detail?: string): void {
    this.phase = phase;
    if (detail !== undefined) this.detail = detail;
    this.render();
  }

  private render(): void {
    const d = this.detail ? ` — ${this.detail}` : '';
    switch (this.phase) {
      case 'idle':
        this.item.text = '$(cloud-download) Shell: not loaded';
        this.item.backgroundColor = undefined;
        break;
      case 'downloading':
        this.item.text = '$(sync~spin) Shell: downloading…';
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        break;
      case 'booting':
        this.item.text = '$(sync~spin) Shell: starting…';
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        break;
      case 'mounting':
        this.item.text = '$(sync~spin) Shell: mounting workspace…';
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        break;
      case 'ready':
        this.item.text = '$(terminal-bash) Shell: ready';
        this.item.backgroundColor = undefined;
        break;
      case 'error':
        this.item.text = '$(warning) Shell: offline';
        this.item.tooltip = this.detail
          ? `WebContainer unavailable: ${this.detail}`
          : 'WebContainer unavailable — click to retry';
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        break;
      default:
        this.item.text = '$(terminal) Shell';
    }
    if (this.phase !== 'error') {
      this.item.tooltip =
        this.phase === 'ready'
          ? 'WebContainer ready — click to open shell'
          : `Browser shell${d}`;
    }
  }
}

/** Progress wrapper: Window progress always; Notification on first cold boot. */
export async function withShellBootProgress<T>(
  title: string,
  useNotification: boolean,
  run: (report: (message: string) => void) => Promise<T>,
): Promise<T> {
  const location = useNotification
    ? vscode.ProgressLocation.Notification
    : vscode.ProgressLocation.Window;
  return vscode.window.withProgress(
    { location, title, cancellable: false },
    async (progress) => {
      const report = (message: string) => {
        progress.report({ message });
      };
      return run(report);
    },
  );
}
