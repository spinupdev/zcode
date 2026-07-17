/**
 * SPA at `/debug/` is a **debug / dogfood** git workspace UI — not the product IDE.
 * Product surface is `/` (VS Code Web workbench).
 *
 * Enabled only in non-production:
 * - `NODE_ENV` / `ZCODE_ENV` ∈ development|dev|test  → on
 * - unset (local `zcode web`) → on
 * - production|prod → off
 *
 * Overrides:
 * - `ZCODE_SPA_DEBUG=1` force on (even in production — use only for intentional dogfood)
 * - `ZCODE_SPA_DEBUG=0` force off
 */

export type SpaDebugEnv = {
  NODE_ENV?: string;
  ZCODE_ENV?: string;
  ZCODE_SPA_DEBUG?: string;
};

function norm(v: string | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

export function isSpaDebugEnabled(env: SpaDebugEnv = process.env): boolean {
  const force = norm(env.ZCODE_SPA_DEBUG);
  if (force === '1' || force === 'true' || force === 'yes' || force === 'on') {
    return true;
  }
  if (force === '0' || force === 'false' || force === 'no' || force === 'off') {
    return false;
  }

  const nodeEnv = norm(env.NODE_ENV);
  const zcodeEnv = norm(env.ZCODE_ENV);
  const values = [nodeEnv, zcodeEnv].filter(Boolean);

  if (values.some((v) => v === 'production' || v === 'prod')) {
    return false;
  }

  if (
    values.some(
      (v) => v === 'development' || v === 'dev' || v === 'test',
    )
  ) {
    return true;
  }

  // Unset env → local dogfood (zcode web). Production deploys must set NODE_ENV=production.
  return values.length === 0;
}

/** Human-readable reason for logs / headers. */
export function spaDebugStatus(env: SpaDebugEnv = process.env): {
  enabled: boolean;
  reason: string;
} {
  const enabled = isSpaDebugEnabled(env);
  if (norm(env.ZCODE_SPA_DEBUG)) {
    return {
      enabled,
      reason: `ZCODE_SPA_DEBUG=${env.ZCODE_SPA_DEBUG}`,
    };
  }
  const nodeEnv = env.NODE_ENV ?? '(unset)';
  const zcodeEnv = env.ZCODE_ENV ?? '(unset)';
  return {
    enabled,
    reason: `NODE_ENV=${nodeEnv} ZCODE_ENV=${zcodeEnv}`,
  };
}
