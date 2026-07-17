import type { IdeMode, ModeResolutionInput } from '@zcode/protocol';

export interface BootstrapUrlInput {
  search?: string;
  hash?: string;
  /** Explicit override for tests */
  href?: string;
}

/**
 * Parse bootstrap inputs from a URL.
 *
 * Allowed query keys (no secrets):
 * - mode=browser|remote
 * - authority=host:port   (remoteAuthority)
 * - workspace=<uri>
 * - ready=1               (connection ready after cookie login — product flag only)
 *
 * Forbidden (throws): tkn, token, connectionToken, cc, connectCode
 */
export function parseBootstrapFromSearchParams(
  source: string | URL | BootstrapUrlInput,
): ModeResolutionInput {
  let search = '';
  let hash = '';

  if (typeof source === 'string') {
    const u = new URL(source, 'http://zcode.local');
    search = u.search;
    hash = u.hash;
  } else if (source instanceof URL) {
    search = source.search;
    hash = source.hash;
  } else {
    search = source.search ?? '';
    hash = source.hash ?? '';
    if (source.href) {
      const u = new URL(source.href, 'http://zcode.local');
      search = u.search;
      hash = u.hash;
    }
  }

  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  assertNoSecretParams(params);

  // Optional non-secret fragment flags: #ready=1 (still no tokens)
  if (hash) {
    const frag = hash.startsWith('#') ? hash.slice(1) : hash;
    if (frag && !frag.includes('=')) {
      // ignore bare fragments
    } else if (frag) {
      const fp = new URLSearchParams(frag);
      assertNoSecretParams(fp);
      for (const [k, v] of fp) {
        if (!params.has(k)) {
          params.set(k, v);
        }
      }
    }
  }

  const modeRaw = params.get('mode');
  let mode: IdeMode | undefined;
  if (modeRaw === 'browser' || modeRaw === 'remote') {
    mode = modeRaw;
  } else if (modeRaw != null && modeRaw !== '') {
    throw new Error(`invalid mode: ${modeRaw}`);
  }

  const authority = params.get('authority') ?? params.get('remoteAuthority') ?? undefined;
  if (authority) {
    assertAuthorityShape(authority);
  }

  const workspaceUri = params.get('workspace') ?? params.get('workspaceUri') ?? undefined;
  const readyRaw = params.get('ready');
  const connectionReady =
    readyRaw === '1' || readyRaw === 'true' ? true : readyRaw === '0' || readyRaw === 'false' ? false : undefined;

  const input: ModeResolutionInput = {};
  if (mode) input.mode = mode;
  if (authority) input.remoteAuthority = authority;
  if (workspaceUri) input.workspaceUri = workspaceUri;
  if (connectionReady !== undefined) input.connectionReady = connectionReady;
  return input;
}

const SECRET_KEYS = new Set([
  'tkn',
  'token',
  'connectionToken',
  'connection_token',
  'cc',
  'connectCode',
  'connect_code',
  'password',
]);

export function assertNoSecretParams(params: URLSearchParams): void {
  for (const key of params.keys()) {
    if (SECRET_KEYS.has(key)) {
      throw new Error(
        `URL must not contain secret query/fragment param "${key}" (use HttpOnly cookie / sessionStorage handoff)`,
      );
    }
  }
}

/**
 * MVP remoteAuthority is host or host:port only — no custom scheme prefixes.
 */
export function assertAuthorityShape(authority: string): void {
  if (authority.includes('://') || authority.includes('+') || authority.includes('/')) {
    throw new Error(
      `invalid remoteAuthority "${authority}": use host or host:port only (no scheme, no zcode+ prefix)`,
    );
  }
  // crude host:port check
  if (!/^[A-Za-z0-9._-]+(?::\d{1,5})?$/.test(authority)) {
    throw new Error(`invalid remoteAuthority "${authority}": expected host or host:port`);
  }
}
