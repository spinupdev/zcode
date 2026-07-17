/**
 * ZCode diagnostics — copy environment report (M2).
 * Never includes connection tokens or passwords (redacted client-side).
 */
import * as vscode from 'vscode';

interface DiagnosticsReport {
  product: string;
  mode: string;
  vscodeCommit?: string;
  productVersion?: string;
  remoteAuthority?: string | null;
  connectionReady?: boolean;
  capabilities?: Record<string, unknown>;
  extensionHostKinds: string[];
  workspaceFolders: Array<{ scheme: string; path: string; authority?: string }>;
  storageEstimate?: { usage?: number; quota?: number };
  userAgent: string;
  href: string;
  builtInExtensions: string[];
  generatedAt: string;
}

function redactUrl(href: string): string {
  try {
    const u = new URL(href);
    for (const key of ['tkn', 'token', 'connectionToken', 'cc', 'connectCode', 'password']) {
      if (u.searchParams.has(key)) u.searchParams.set(key, '[REDACTED]');
    }
    return u.toString();
  } catch {
    return href.replace(/([?&])(tkn|token|connectionToken|cc|connectCode|password)=[^&]*/gi, '$1$2=[REDACTED]');
  }
}

async function collectReport(): Promise<DiagnosticsReport> {
  const product = (globalThis as { product?: Record<string, unknown> }).product ?? {};
  const caps =
    (product.zcodeCapabilities as Record<string, unknown> | undefined) ??
    ((product.productConfiguration as { zcodeCapabilities?: Record<string, unknown> } | undefined)
      ?.zcodeCapabilities);
  const mode =
    (product.zcodeMode as string | undefined) ??
    ((product.productConfiguration as { zcodeMode?: string } | undefined)?.zcodeMode) ??
    (product.remoteAuthority ? 'remote' : 'browser');

  let storageEstimate: { usage?: number; quota?: number } | undefined;
  try {
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      storageEstimate = { usage: e.usage, quota: e.quota };
    }
  } catch {
    /* ignore */
  }

  const folders = vscode.workspace.workspaceFolders ?? [];
  const builtins = Array.isArray(product.additionalBuiltinExtensions)
    ? (product.additionalBuiltinExtensions as Array<{ path?: string }>).map(
        (e) => e.path ?? String(e),
      )
    : [];

  return {
    product: 'ZCode',
    mode,
    vscodeCommit: product.vscodeCommit as string | undefined,
    productVersion: (product.productConfiguration as { version?: string } | undefined)?.version,
    remoteAuthority: (product.remoteAuthority as string | undefined) ?? null,
    connectionReady: product.connectionReady as boolean | undefined,
    capabilities: caps,
    extensionHostKinds: product.remoteAuthority ? ['web', 'remote'] : ['web'],
    workspaceFolders: folders.map((f) => ({
      scheme: f.uri.scheme,
      path: f.uri.path,
      authority: f.uri.authority || undefined,
    })),
    storageEstimate,
    userAgent: navigator.userAgent,
    href: redactUrl(location.href),
    builtInExtensions: builtins,
    generatedAt: new Date().toISOString(),
  };
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('zcode.diagnostics.copyReport', async () => {
      const report = await collectReport();
      const text = JSON.stringify(report, null, 2);
      await vscode.env.clipboard.writeText(text);
      void vscode.window.showInformationMessage(
        'ZCode diagnostics report copied to clipboard (secrets redacted).',
      );
    }),
  );
}

export function deactivate(): void {
  /* noop */
}
