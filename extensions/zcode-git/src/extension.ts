/**
 * Browser SCM + clone command for ZCode.
 * Clone/edit in the full workbench will call browser-agent; this extension
 * registers commands and a minimal SCM source for the virtual workspace.
 */
import type * as vscode from 'vscode';

declare const vscode: typeof import('vscode');

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('zcode.git.clone', async () => {
      const url = await vscode.window.showInputBox({
        prompt: 'Repository HTTPS URL',
        placeHolder: 'https://github.com/org/repo.git',
      });
      if (!url) return;

      const proxy =
        vscode.workspace.getConfiguration('zcode').get<string>('gitProxyUrl') ??
        'http://127.0.0.1:8787';

      // Prefer external browser workspace app until REH/web host wires agent
      const open = await vscode.window.showInformationMessage(
        `Clone ${url} via corsProxy ${proxy}. Open the ZCode browser workspace app (apps/web) for full clone UX, or continue to open a virtual folder.`,
        'Open virtual folder',
      );
      if (open) {
        await vscode.commands.executeCommand('zcode.fs.openWorkspace');
      }
    }),
  );

  const scm = vscode.scm.createSourceControl('zcode-git', 'ZCode Git');
  scm.inputBox.placeholder = 'Message (commit via browser workspace app for now)';
  const group = scm.createResourceGroup('changes', 'Changes');
  group.resourceStates = [];
  context.subscriptions.push(scm);
}

export function deactivate(): void {
  /* no-op */
}
