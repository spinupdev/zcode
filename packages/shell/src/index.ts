/**
 * Workbench bootstrap / options factory.
 *
 * Production loads owned OSS web assets (M0+).
 * Track B1 may use @vscode/test-web as a **dev harness only** — never ship it.
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
