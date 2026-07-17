/**
 * Build window.product / create() options for VS Code Web workbench.
 * Dual-mode: browser (no remoteAuthority) vs remote (authority host:port).
 */

import type { IdeMode, ModeResolutionInput, WorkbenchLoadConfig } from '@zcode/protocol';
import { bootstrapFromInput } from './bootstrap.js';

export interface ProductOverlay {
  nameShort?: string;
  nameLong?: string;
  applicationName?: string;
  dataFolderName?: string;
  extensionsGallery?: Record<string, string>;
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
    connectionReady: input.mode === 'remote' || !!input.remoteAuthority,
  };
  const boot = bootstrapFromInput(modeInput);
  const load: WorkbenchLoadConfig = boot.workbench;

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
  };

  const opts: WorkbenchCreateOptions = {
    productConfiguration,
    homeIndicator: {
      href: '/',
      icon: 'code',
      title: 'ZCode Home',
    },
    windowIndicator: {
      label: `$(remote) ZCode ${boot.mode}`,
      tooltip: boot.mode === 'remote' ? 'Remote server mode' : 'Browser mode',
    },
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

  if (input.builtinExtensionPaths?.length) {
    opts.additionalBuiltinExtensions = input.builtinExtensionPaths.map((p) => {
      const path = p.startsWith('/') ? p : `/${p}`;
      return { scheme: 'http', path };
    });
  }

  return opts;
}

/** Serialize for <script>window.product = …</script> */
export function workbenchProductScript(opts: WorkbenchCreateOptions): string {
  return `window.product = ${JSON.stringify(opts)};`;
}
