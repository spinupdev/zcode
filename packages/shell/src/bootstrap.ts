/**
 * Workbench bootstrap matrix (B1).
 *
 * Dual-mode is configuration of the VS Code workbench:
 * - browser: no remoteAuthority, web EH, product FS providers
 * - remote: remoteAuthority = host:port, cookie-auth WS, remote EH
 *
 * This module does NOT load the workbench itself. It produces the load config
 * and capability chrome inputs. Dev harness uses a placeholder UI; production
 * loads owned OSS web assets (M0+). @vscode/test-web is never a production path.
 */

import type {
  IdeMode,
  ModeResolutionInput,
  ProductCapabilities,
  WorkbenchLoadConfig,
} from '@zcode/protocol';
import { createSessionController } from './session-controller.js';
import { parseBootstrapFromSearchParams, type BootstrapUrlInput } from './url.js';

export interface BootstrapResult {
  mode: IdeMode;
  input: ModeResolutionInput;
  workbench: WorkbenchLoadConfig;
  capabilities: ProductCapabilities;
  /** UI chrome hints for shell chrome (status bar, panels) */
  chrome: {
    showTerminal: boolean;
    showRemoteIndicator: boolean;
    searchLabel: string;
  };
  /**
   * Dev-only: whether this process is allowed to use @vscode/test-web.
   * Always false when NODE_ENV=production or ZCODE_ALLOW_TEST_WEB is unset.
   */
  allowTestWebHarness: boolean;
}

/** Safe env for Node + browser bundles (SPA must not touch bare `process`). */
function currentEnv(): NodeJS.ProcessEnv {
  return (
    typeof process !== 'undefined' && process.env ? process.env : {}
  ) as NodeJS.ProcessEnv;
}

export function isTestWebHarnessAllowed(env: NodeJS.ProcessEnv = currentEnv()): boolean {
  if (env.NODE_ENV === 'production') {
    return false;
  }
  return env.ZCODE_ALLOW_TEST_WEB === '1' || env.ZCODE_ALLOW_TEST_WEB === 'true';
}

export function bootstrapFromInput(input: ModeResolutionInput): BootstrapResult {
  const session = createSessionController(input);
  const workbench = session.createWorkbenchLoadConfig();
  const capabilities = session.capabilities();
  const mode = session.mode;

  return {
    mode,
    input,
    workbench,
    capabilities,
    chrome: {
      showTerminal: capabilities.terminal,
      showRemoteIndicator: mode === 'remote',
      searchLabel:
        capabilities.search === 'ripgrep'
          ? 'Search (ripgrep)'
          : capabilities.search === 'web-best-effort'
            ? 'Search (best-effort)'
            : 'Search (disabled)',
    },
    allowTestWebHarness: isTestWebHarnessAllowed(),
  };
}

/** Parse location search + optional hash fragment for connect handoff (no secrets in query). */
export function bootstrapFromUrl(url: string | URL | BootstrapUrlInput): BootstrapResult {
  const input =
    typeof url === 'string' || url instanceof URL
      ? parseBootstrapFromSearchParams(url)
      : parseBootstrapFromSearchParams(url);
  return bootstrapFromInput(input);
}

export function assertRemoteReady(result: BootstrapResult): void {
  if (result.mode !== 'remote') {
    return;
  }
  if (!result.workbench.remoteAuthority) {
    throw new Error('remote mode requires remoteAuthority (host or host:port)');
  }
  if (!result.workbench.resolvedConnection?.ready) {
    throw new Error(
      'remote mode requires connection ready (HttpOnly session cookie / login) before workbench connect',
    );
  }
}

/** Human-readable dump for diagnostics / harness UI */
export function formatBootstrapSummary(result: BootstrapResult): string {
  return [
    `mode=${result.mode}`,
    `remoteAuthority=${result.workbench.remoteAuthority ?? '(none)'}`,
    `workspaceUri=${result.workbench.workspaceUri ?? '(none)'}`,
    `connectionReady=${result.workbench.resolvedConnection?.ready === true}`,
    `terminal=${result.capabilities.terminal}`,
    `search=${result.capabilities.search}`,
    `testWebAllowed=${result.allowTestWebHarness}`,
  ].join('\n');
}
