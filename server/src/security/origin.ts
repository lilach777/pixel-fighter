/**
 * WebSocket origin allow-list.
 *
 * ALLOWED_ORIGINS is a comma-separated list of exact origins
 * (e.g. "https://pixel-fighters.example.com"), plus two special values:
 *   - "self": the page origin's host must equal the request's Host header (single-service
 *     deployments where the server also serves the game page).
 *   - "*": any origin. Development only; refused when NODE_ENV=production.
 * Requests without an Origin header (non-browser clients, tests) are allowed: browsers always
 * send Origin on WebSocket upgrades, so this does not weaken browser protection.
 */
export function makeOriginCheck(allowed: string[]): (origin: string | undefined, host?: string) => boolean {
  const set = new Set(allowed.map((o) => o.trim().replace(/\/$/, '')).filter(Boolean));
  const any = set.has('*');
  const self = set.has('self');
  return (origin, host) => {
    if (!origin) return true;
    if (any) return true;
    const o = origin.replace(/\/$/, '');
    if (set.has(o)) return true;
    if (self && host) {
      try {
        return new URL(o).host.toLowerCase() === host.toLowerCase();
      } catch {
        return false;
      }
    }
    return false;
  };
}

/**
 * Resolves the effective allow-list from ALLOWED_ORIGINS and NODE_ENV.
 * Production defaults to "self"; development defaults to "*" so local and LAN testing work.
 */
export function resolveAllowedOrigins(value: string | undefined, nodeEnv: string | undefined): string[] {
  const production = nodeEnv === 'production';
  const list = (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!list.length) return production ? ['self'] : ['*'];
  if (production && list.includes('*')) {
    throw new Error('ALLOWED_ORIGINS="*" is not allowed when NODE_ENV=production. Use "self" or your exact site origin(s).');
  }
  return list;
}
