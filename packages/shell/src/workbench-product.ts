/**
 * Build window.product / create() options for VS Code Web workbench.
 * Dual-mode: browser (no remoteAuthority) vs remote (authority host:port).
 */

import type {
  IdeMode,
  ModeResolutionInput,
  ProductCapabilities,
  WorkbenchLoadConfig,
} from '@zcode/protocol';
import { capabilitiesForMode } from '@zcode/protocol';
import { bootstrapFromInput } from './bootstrap.js';

export interface ProductOverlay {
  nameShort?: string;
  nameLong?: string;
  applicationName?: string;
  dataFolderName?: string;
  extensionsGallery?: Record<string, string>;
  configurationDefaults?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface WorkbenchCreateOptions {
  /** Nested product branding (nameShort, extensionsGallery, …) */
  productConfiguration: ProductOverlay;
  /** Remote host:port when mode=remote */
  remoteAuthority?: string;
  /** Workspace folder URI components for URI.revive */
  folderUri?: { scheme: string; path: string; authority?: string };
  /** Additional web extension locations as URI components */
  additionalBuiltinExtensions?: Array<{ scheme: string; path: string; authority?: string }>;
  /** Home indicator / flags */
  homeIndicator?: { href: string; icon: string; title: string };
  windowIndicator?: { label: string; tooltip: string };
  /**
   * Product capability matrix (chrome only — not editor IPC).
   * Embedded for diagnostics / status; VS Code ignores unknown top-level keys safely.
   */
  zcodeCapabilities?: ProductCapabilities;
  /** Explicit mode for diagnostics extension */
  zcodeMode?: IdeMode;
  /** Connection ready (cookie) — never carries a token */
  connectionReady?: boolean;
  /** Owned / dogfood vscode commit for skew checks */
  vscodeCommit?: string;
}

export interface BuildWorkbenchProductInput {
  mode?: IdeMode;
  remoteAuthority?: string;
  /** e.g. zcode-opfs workspace id */
  workspaceId?: string;
  /** Absolute path on remote server */
  remoteWorkspacePath?: string;
  /** Base product.json overlay (ZCode branding) */
  productOverlay?: ProductOverlay;
  /** Serve built-in extensions under same origin, e.g. /extensions/zcode-browser-fs */
  builtinExtensionPaths?: string[];
  /** Origin for absolute extension URIs (default relative path scheme http) */
  origin?: string;
  /** Cookie session ready (remote) */
  connectionReady?: boolean;
  /** vscode commit pin / staged marker */
  vscodeCommit?: string;
}

const DEFAULT_BUILTIN_EXTENSIONS = [
  '/extensions/zcode-browser-fs',
  '/extensions/zcode-git',
  '/extensions/zcode-diagnostics',
];

/**
 * Configuration defaults by mode (capability chrome).
 * Browser: terminal is not a product surface (no REH PTY).
 * Remote: enable remote-friendly defaults.
 */
export function configurationDefaultsForMode(
  mode: IdeMode,
  caps: ProductCapabilities,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    'security.workspace.trust.enabled': false,
    'security.workspace.trust.startupPrompt': 'never',
    'workbench.startupEditor': 'readme',
    // Align with monaco-parts-splash skeleton (dark); avoid light flash on first paint
    'workbench.colorTheme': 'Default Dark Modern',
    'window.autoDetectColorScheme': false,
  };

  if (!caps.terminal || mode === 'browser') {
    // Soft-hide: do not open panel on startup; no multi-line paste noise.
    base['workbench.panel.opensMaximized'] = 'never';
    base['terminal.integrated.enablePersistentSessions'] = false;
    base['terminal.integrated.enableMultiLinePasteWarning'] = 'never';
  } else {
    base['terminal.integrated.enablePersistentSessions'] = true;
    base['remote.autoForwardPorts'] = true;
  }

  if (mode === 'browser') {
    base['files.exclude'] = { '**/.git': true, '**/.git/**': true };
  }

  return base;
}

/**
 * Map dual-mode bootstrap → VS Code Web `create()` / window.product payload.
 */
export function buildWorkbenchCreateOptions(
  input: BuildWorkbenchProductInput = {},
): WorkbenchCreateOptions {
  const modeInput: ModeResolutionInput = {
    mode: input.mode,
    remoteAuthority: input.remoteAuthority,
    connectionReady:
      input.connectionReady ?? (input.mode === 'remote' || !!input.remoteAuthority),
  };
  const boot = bootstrapFromInput(modeInput);
  const load: WorkbenchLoadConfig = boot.workbench;
  const caps = capabilitiesForMode(boot.mode);
  const defaults = configurationDefaultsForMode(boot.mode, caps);

  const productConfiguration: ProductOverlay = {
    nameShort: 'ZCode',
    nameLong: 'ZCode',
    applicationName: 'zcode',
    dataFolderName: '.zcode',
    extensionsGallery: {
      serviceUrl: 'https://open-vsx.org/vscode/gallery',
      itemUrl: 'https://open-vsx.org/vscode/item',
      resourceUrlTemplate:
        'https://openvsxorg.blob.core.windows.net/resources/{publisher}/{name}/{version}/{path}',
    },
    ...input.productOverlay,
    configurationDefaults: {
      ...defaults,
      ...(input.productOverlay?.configurationDefaults as object | undefined),
    },
    // Product-owned metadata (diagnostics / chrome)
    zcodeMode: boot.mode,
    zcodeCapabilities: caps,
  };

  const opts: WorkbenchCreateOptions = {
    productConfiguration,
    homeIndicator: {
      href: '/',
      icon: 'code',
      title: 'ZCode Home',
    },
    windowIndicator: {
      label:
        boot.mode === 'remote'
          ? `$(remote) ZCode remote`
          : `$(folder) ZCode browser`,
      tooltip:
        boot.mode === 'remote'
          ? `Remote ${load.remoteAuthority ?? ''} · terminal ${caps.terminal ? 'on' : 'off'}`
          : 'Browser mode — virtual FS (zcode-opfs), no PTY terminal',
    },
    zcodeCapabilities: caps,
    zcodeMode: boot.mode,
    connectionReady: load.resolvedConnection?.ready === true,
    vscodeCommit: input.vscodeCommit,
  };

  if (boot.mode === 'remote' && load.remoteAuthority) {
    opts.remoteAuthority = load.remoteAuthority;
    const path = input.remoteWorkspacePath ?? '/home/workspace';
    opts.folderUri = {
      scheme: 'vscode-remote',
      authority: load.remoteAuthority,
      path,
    };
  } else {
    const id = input.workspaceId ?? 'default';
    opts.folderUri = {
      scheme: 'zcode-opfs',
      path: `/workspace/${id}`,
    };
  }

  const extPaths =
    input.builtinExtensionPaths?.length
      ? input.builtinExtensionPaths
      : DEFAULT_BUILTIN_EXTENSIONS;

  const origin = input.origin ? new URL(input.origin) : undefined;
  opts.additionalBuiltinExtensions = extPaths.map((p) => {
    const path = p.startsWith('/') ? p : `/${p}`;
    if (origin) {
      return {
        scheme: origin.protocol.replace(':', '') || 'http',
        authority: origin.host,
        path,
      };
    }
    return { scheme: 'http', path };
  });

  return opts;
}

/** Serialize for <script>window.product = …</script> */
export function workbenchProductScript(opts: WorkbenchCreateOptions): string {
  return `window.product = ${JSON.stringify(opts)};`;
}

export { DEFAULT_BUILTIN_EXTENSIONS };
