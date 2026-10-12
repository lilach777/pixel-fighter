import net from 'node:net';

/**
 * How the server determines a client's IP address (used for the per-IP connection limit).
 *
 *   off         Use the TCP peer address only. Forwarding headers are ignored. Default; correct
 *               for local development and for servers exposed directly to the internet.
 *   cloudflare  Use the single-value `CF-Connecting-IP` header written by Cloudflare's edge.
 *               Cloudflare rejects requests that try to supply this header themselves, so a
 *               client cannot forge it. Use ONLY when every request reaches the server through
 *               Cloudflare (true for Render web services; for self-hosting, firewall the origin
 *               to Cloudflare's IP ranges).
 *   xff         Use `X-Forwarded-For`, trusting only the proxies listed in TRUSTED_PROXIES.
 *               The header is ignored unless the TCP peer is itself a trusted proxy; it is then
 *               read right-to-left, skipping trusted proxy addresses. The first untrusted
 *               address is the client. Entries a client prepends (spoofs) sit to the left of
 *               that address and are never reached.
 *
 * Note: the left-most X-Forwarded-For entry is never trusted. Proxies such as Render's append
 * to a client-supplied header, so the left-most value can be chosen by the client.
 */
export type ClientIpPolicy = { mode: 'off' } | { mode: 'cloudflare' } | { mode: 'xff'; trusted: net.BlockList; trustedList: string[] };

export function parseClientIpPolicy(mode: string | undefined, trustedProxies: string | undefined): ClientIpPolicy {
  const m = (mode ?? '').trim().toLowerCase();
  if (m === '' || m === 'off' || m === 'false') return { mode: 'off' };
  if (m === 'cloudflare') return { mode: 'cloudflare' };
  if (m === 'xff') {
    const list = (trustedProxies ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!list.length) throw new Error('TRUST_PROXY=xff requires TRUSTED_PROXIES (comma-separated proxy IPs or CIDRs, e.g. 10.0.0.0/8).');
    const trusted = new net.BlockList();
    for (const entry of list) addToBlockList(trusted, entry);
    return { mode: 'xff', trusted, trustedList: list };
  }
  throw new Error(`Unsupported TRUST_PROXY value "${mode}". Use "off", "cloudflare" or "xff" (see docs/DEPLOYMENT.md).`);
}

function addToBlockList(list: net.BlockList, entry: string): void {
  const [addr, bits] = entry.split('/');
  const type = net.isIP(addr);
  if (!type) throw new Error(`TRUSTED_PROXIES: "${entry}" is not an IP address or CIDR.`);
  const family = type === 6 ? 'ipv6' : 'ipv4';
  if (bits === undefined) {
    list.addAddress(addr, family);
    return;
  }
  const prefix = Number(bits);
  const max = type === 6 ? 128 : 32;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) throw new Error(`TRUSTED_PROXIES: invalid prefix in "${entry}".`);
  list.addSubnet(addr, prefix, family);
}

/** Normalises IPv4-mapped IPv6 (::ffff:1.2.3.4) to plain IPv4; returns null for non-IPs. */
export function normalizeIp(value: string | undefined | null): string | null {
  if (!value) return null;
  let v = value.trim();
  if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1);
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(v);
  if (mapped) v = mapped[1];
  return net.isIP(v) ? v : null;
}

function isTrusted(list: net.BlockList, ip: string): boolean {
  return list.check(ip, net.isIP(ip) === 6 ? 'ipv6' : 'ipv4');
}

export interface ClientIpInput {
  /** TCP peer address (req.socket.remoteAddress). */
  remoteAddress: string | undefined;
  headers: Record<string, string | string[] | undefined>;
}

/** Resolves the client IP for rate limiting according to the policy. Never throws. */
export function resolveClientIp(input: ClientIpInput, policy: ClientIpPolicy): string {
  const peer = normalizeIp(input.remoteAddress) ?? input.remoteAddress ?? 'unknown';
  if (policy.mode === 'off') return peer;

  if (policy.mode === 'cloudflare') {
    const h = input.headers['cf-connecting-ip'];
    // Exactly one value, and it must be an IP; anything else falls back to the peer address.
    if (typeof h !== 'string') return peer;
    return normalizeIp(h) ?? peer;
  }

  // xff: headers count only when the request was delivered by a trusted proxy.
  if (!isTrusted(policy.trusted, peer)) return peer;
  const raw = input.headers['x-forwarded-for'];
  const joined = Array.isArray(raw) ? raw.join(',') : (raw ?? '');
  const hops = joined
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // Right-to-left: skip trusted proxies; the first untrusted address is the client.
  for (let i = hops.length - 1; i >= 0; i--) {
    const ip = normalizeIp(hops[i]);
    if (!ip) return peer; // malformed entry where a proxy address was expected: fail closed
    if (!isTrusted(policy.trusted, ip)) return ip;
  }
  // Every hop is a trusted proxy (e.g. internal health checks): use the outermost one.
  return normalizeIp(hops[0]) ?? peer;
}
