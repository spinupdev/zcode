/**
 * Node wrapper around VS Code server / REH: cookie↔token bridge, static co-serve.
 * Full implementation: PR R3+.
 */

export interface ServerOptions {
  host: string;
  port: number;
  /** Workspace root on disk */
  workspace: string;
  /** Password auth for self-host MVP */
  password?: string;
  /** Directory of co-served workbench static assets (same-origin MVP) */
  staticDir?: string;
}

export async function startServer(_options: ServerOptions): Promise<never> {
  throw new Error(
    '@zcode/server: startServer not implemented yet (requires VS Code server build, PR R2–R3).',
  );
}
