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
import { languageExtensionPaths } from './language-extensions.js';

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

/** ZCode product extensions under /extensions/* */
const ZCODE_PRODUCT_EXTENSIONS = [
  '/extensions/zcode-browser-fs',
  '/extensions/zcode-git',
  '/extensions/zcode-diagnostics',
  // Server-agnostic runtimes + same-origin remote attach (ADR 0001)
  '/extensions/zcode-runtime-core',
  '/extensions/zcode-runtime-python',
  '/extensions/zcode-runtime-node',
  '/extensions/zcode-runtime-remote',
  '/extensions/zcode-remote',
  // Marketplace defaults (scripts/fetch-theme-extensions.sh) — optional
  '/extensions/vscode-icons',
  '/extensions/github-vscode-theme',
];

/**
 * All additionalBuiltinExtensions: ZCode product + VS Code language/theme packs
 * from /vscode/extensions (TextMate grammars for JS/TS/Python/Go/…).
 */
export const DEFAULT_BUILTIN_EXTENSIONS: string[] = [
  ...ZCODE_PRODUCT_EXTENSIONS,
  ...languageExtensionPaths(),
];

/**
 * Color / icon theme defaults.
 * Prefer built-in "Default Dark Modern" so syntax colors work without marketplace
 * theme fetch; GitHub Theme / vscode-icons still apply when those extensions load.
 */
export const ZCODE_THEME_DEFAULTS = {
  iconTheme: 'vs-seti',
  colorThemeDark: 'Default Dark Modern',
  colorThemeLight: 'Default Light Modern',
  colorThemeHcDark: 'Default High Contrast',
  colorThemeHcLight: 'Default High Contrast Light',
  /** Optional upgrades when github-vscode-theme / vscode-icons are present */
  preferredGithubDark: 'GitHub Dark Default',
  preferredGithubLight: 'GitHub Light Default',
  preferredIcons: 'vscode-icons',
} as const;

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
    // Empty browser workspace — Welcome / Open Repository, not a fake README seed
    'workbench.startupEditor': 'welcomePage',
    // Built-in theme-defaults + seti (always available under /vscode/extensions)
    'workbench.iconTheme': ZCODE_THEME_DEFAULTS.iconTheme,
    'workbench.colorTheme': ZCODE_THEME_DEFAULTS.colorThemeDark,
    'workbench.preferredDarkColorTheme': ZCODE_THEME_DEFAULTS.colorThemeDark,
    'workbench.preferredLightColorTheme': ZCODE_THEME_DEFAULTS.colorThemeLight,
    'workbench.preferredHighContrastColorTheme': ZCODE_THEME_DEFAULTS.colorThemeHcDark,
    'workbench.preferredHighContrastLightColorTheme': ZCODE_THEME_DEFAULTS.colorThemeHcLight,
    'window.autoDetectColorScheme': true,
    // Quiet marketplace theme/icon extensions if installed later
    'vsicons.dontShowNewVersionMessage': true,
    'vsicons.dontShowConfigManuallyChangedMessage': true,
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
    base['files.exclude'] = {
      '**/.git': true,
      '**/.git/**': true,
      '**/.zcode-workspace.json': true,
    };
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
