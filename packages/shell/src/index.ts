/**
 * Workbench bootstrap / options factory.
 *
 * Production loads owned OSS web assets (M0+).
 * Track B1 may use @vscode/test-web as a **dev harness only** — never ship it.
 * Enable only with ZCODE_ALLOW_TEST_WEB=1 in non-production environments.
 */

export {
  resolveMode,
  createWorkbenchLoadConfig,
  capabilitiesForMode,
} from '@zcode/protocol';

export type {
  IdeMode,
  ModeResolutionInput,
  WorkbenchLoadConfig,
  ProductCapabilities,
  SessionController,
} from '@zcode/protocol';

export { createSessionController } from './session-controller.js';

export {
  bootstrapFromInput,
  bootstrapFromUrl,
  assertRemoteReady,
  formatBootstrapSummary,
  isTestWebHarnessAllowed,
} from './bootstrap.js';
export type { BootstrapResult } from './bootstrap.js';

export {
  parseBootstrapFromSearchParams,
  assertNoSecretParams,
  assertAuthorityShape,
} from './url.js';
export type { BootstrapUrlInput } from './url.js';

export {
  buildWorkbenchCreateOptions,
  workbenchProductScript,
  configurationDefaultsForMode,
  DEFAULT_BUILTIN_EXTENSIONS,
  ZCODE_THEME_DEFAULTS,
  WEBVIEW_ENDPOINT_PATH,
  webviewEndpointForOrigin,
} from './workbench-product.js';
export type {
  ProductOverlay,
  WorkbenchCreateOptions,
  BuildWorkbenchProductInput,
} from './workbench-product.js';

export {
  LANGUAGE_AND_THEME_EXTENSION_IDS,
  languageExtensionPaths,
} from './language-extensions.js';

export {
  EXTRA_LANGUAGE_EXTENSION_DESTS,
  extraLanguageExtensionPaths,
} from './extra-language-extensions.js';
