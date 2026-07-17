import type { IdeMode, WorkbenchLoadConfig } from './session.js';
import { browserCapabilities, remoteCapabilities } from './session.js';

export interface ModeResolutionInput {
  /** Explicit mode override (query/config). */
  mode?: IdeMode;
  /**
   * Remote host authority when connecting remotely.
   * host or host:port only — no custom scheme prefix in MVP.
   */
  remoteAuthority?: string;
  workspaceUri?: string;
  /** True after same-origin login / attach cookie is ready. */
  connectionReady?: boolean;
}

/**
 * Resolve IDE mode from URL/bootstrap inputs.
 * Presence of remoteAuthority (and ready connection for remote) drives mode.
 */
export function resolveMode(input: ModeResolutionInput): IdeMode {
  if (input.mode === 'browser') {
    return 'browser';
  }
  if (input.mode === 'remote' || (input.remoteAuthority && input.remoteAuthority.length > 0)) {
    return 'remote';
  }
  return 'browser';
}

/**
 * Build a WorkbenchLoadConfig for the shell bootstrap matrix.
 * Does not embed connection tokens.
 */
export function createWorkbenchLoadConfig(input: ModeResolutionInput): WorkbenchLoadConfig {
  const mode = resolveMode(input);

  if (mode === 'browser') {
    return {
      remoteAuthority: undefined,
      workspaceUri: input.workspaceUri,
      productConfiguration: {
        zcodeMode: 'browser',
      },
    };
  }

  if (!input.remoteAuthority) {
    throw new Error('remote mode requires remoteAuthority (host or host:port)');
  }

  const config: WorkbenchLoadConfig = {
    remoteAuthority: input.remoteAuthority,
    workspaceUri:
      input.workspaceUri ?? `vscode-remote://${input.remoteAuthority}/home/workspace`,
    productConfiguration: {
      zcodeMode: 'remote',
    },
  };

  if (input.connectionReady) {
    config.resolvedConnection = {
      ready: true,
      authority: input.remoteAuthority,
    };
  }

  return config;
}

export function capabilitiesForMode(mode: IdeMode) {
  return mode === 'remote' ? remoteCapabilities() : browserCapabilities();
}
