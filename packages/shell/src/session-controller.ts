import {
  type IdeMode,
  type ModeResolutionInput,
  type ProductCapabilities,
  type SessionController,
  type WorkbenchLoadConfig,
  capabilitiesForMode,
  createWorkbenchLoadConfig,
  resolveMode,
} from '@zcode/protocol';

/**
 * Minimal SessionController for bootstrap.
 * Remote upgrade is intentionally unimplemented until ADR (post-MVP).
 */
export function createSessionController(input: ModeResolutionInput): SessionController {
  const mode: IdeMode = resolveMode(input);

  return {
    mode,
    createWorkbenchLoadConfig(): WorkbenchLoadConfig {
      return createWorkbenchLoadConfig(input);
    },
    capabilities(): ProductCapabilities {
      return capabilitiesForMode(mode);
    },
    dispose(): void {
      /* no-op skeleton */
    },
  };
}
