/**
 * Browser git entry from VS Code Web: open the SPA clone UI (same-origin).
 */
import type * as vscode from 'vscode';

declare const vscode: typeof import('vscode');

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('zcode.git.clone', async () => {
      const origin = globalThis.location?.origin ?? '';
      const configured = vscode.workspace.getConfiguration('zcode').get<string>('gitProxyUrl');
      const proxy = (configured && configured.trim()) || `${origin}/git-proxy`;

      const url = await vscode.window.showInputBox({
        title: 'Clone Git repository (browser)',
        prompt: 'HTTPS git URL (GitHub/GitLab public repos)',
        placeHolder: 'https://github.com/org/repo.git',
        ignoreFocusOut: true,
        validateInput: (v) => {
          if (!v.trim()) return 'URL required';
          if (!/^https:\/\//i.test(v.trim())) return 'Use an https:// URL';
          return undefined;
        },
      });
      if (!url) return;

      // SPA handles isomorphic-git + /git-proxy; autoclone starts after proxy health check
      const spa = new URL('/', origin || 'http://127.0.0.1:5000');
      spa.searchParams.set('clone', url.trim());
      spa.searchParams.set('proxy', proxy);
      spa.searchParams.set('autoclone', '1');

      const pick = await vscode.window.showInformationMessage(
        `Clone runs in the ZCode browser workspace (not the desktop git binary).\nProxy: ${proxy}`,
        'Open clone UI',
        'Cancel',
      );
      if (pick === 'Open clone UI') {
        await vscode.env.openExternal(vscode.Uri.parse(spa.toString()));
      }
    }),
  );

  const scm = vscode.scm.createSourceControl('zcode-git', 'ZCode Git');
  scm.inputBox.placeholder = 'Use “ZCode: Clone Repository” or the SPA at /';
  const group = scm.createResourceGroup('changes', 'Changes');
  group.resourceStates = [];
  context.subscriptions.push(scm);
}

export function deactivate(): void {
  /* no-op */
}
