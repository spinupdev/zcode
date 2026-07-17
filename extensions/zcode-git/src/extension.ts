/**
 * Browser SCM + open SPA for clone (full git lives in apps/web until workbench agent bridge).
 */
import type * as vscode from 'vscode';

declare const vscode: typeof import('vscode');

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('zcode.git.clone', async () => {
      const proxy =
        vscode.workspace.getConfiguration('zcode').get<string>('gitProxyUrl') ||
        `${globalThis.location?.origin ?? ''}/git-proxy`;

      const open = await vscode.window.showInformationMessage(
        `Browser git clone runs in the ZCode SPA (isomorphic-git + ${proxy}).`,
        'Open SPA',
        'Cancel',
      );
      if (open === 'Open SPA') {
        // Same origin SPA
        await vscode.env.openExternal(
          vscode.Uri.parse(`${globalThis.location?.origin ?? ''}/`),
        );
      }
    }),
  );

  const scm = vscode.scm.createSourceControl('zcode-git', 'ZCode Git');
  scm.inputBox.placeholder = 'Commit via SPA for full git, or edit files here';
  const group = scm.createResourceGroup('changes', 'Changes');
  group.resourceStates = [];
  context.subscriptions.push(scm);
}

export function deactivate(): void {
  /* no-op */
}
