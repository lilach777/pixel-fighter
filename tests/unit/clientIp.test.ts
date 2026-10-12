import { describe, expect, it } from 'vitest';
import { normalizeIp, parseClientIpPolicy, resolveClientIp } from '../../server/src/security/clientIp';

const req = (remoteAddress: string, headers: Record<string, string | string[]> = {}) => ({ remoteAddress, headers });

describe('client IP policy parsing', () => {
  it('defaults to the TCP peer and rejects ambiguous or invalid settings', () => {
    expect(parseClientIpPolicy(undefined, undefined).mode).toBe('off');
    expect(parseClientIpPolicy('false', undefined).mode).toBe('off');
    expect(parseClientIpPolicy('cloudflare', undefined).mode).toBe('cloudflare');
    expect(parseClientIpPolicy('xff', '10.0.0.0/8, 127.0.0.1').mode).toBe('xff');
    // The old boolean meant "trust the left-most X-Forwarded-For entry" and is refused.
    expect(() => parseClientIpPolicy('true', undefined)).toThrow(/Unsupported TRUST_PROXY/);
    expect(() => parseClientIpPolicy('xff', '')).toThrow(/requires TRUSTED_PROXIES/);
    expect(() => parseClientIpPolicy('xff', 'not-an-ip')).toThrow(/not an IP/);
    expect(() => parseClientIpPolicy('xff', '10.0.0.0/33')).toThrow(/invalid prefix/);
  });

  it('normalises IPv4-mapped IPv6 and rejects non-IPs', () => {
    expect(normalizeIp('::ffff:203.0.113.5')).toBe('203.0.113.5');
    expect(normalizeIp('[2001:db8::1]')).toBe('2001:db8::1');
    expect(normalizeIp('evil, 1.2.3.4')).toBeNull();
    expect(normalizeIp('')).toBeNull();
  });
});

describe('off (local development / direct exposure)', () => {
  const policy = parseClientIpPolicy(undefined, undefined);
  it('ignores every forwarding header', () => {
    const ip = resolveClientIp(
      req('::ffff:198.51.100.7', { 'x-forwarded-for': '1.1.1.1', 'cf-connecting-ip': '2.2.2.2', 'true-client-ip': '3.3.3.3' }),
      policy,
    );
    expect(ip).toBe('198.51.100.7');
  });
});

describe('cloudflare (documented Render setup)', () => {
  const policy = parseClientIpPolicy('cloudflare', undefined);
  // Header shape observed on Render: client-supplied entries are kept, and the real
  // client, a Cloudflare address and an internal address are appended.
  const render = (spoof: string) => ({
    'x-forwarded-for': `${spoof}, 81.107.0.110, 172.71.10.20, 10.214.3.4`,
    'cf-connecting-ip': '81.107.0.110',
  });

  it('uses CF-Connecting-IP and ignores any X-Forwarded-For spoof', () => {
    for (const spoof of ['192.0.2.44', '127.0.0.1', '10.0.0.1', '1.1.1.1, 8.8.8.8', 'garbage']) {
      expect(resolveClientIp(req('10.214.9.9', render(spoof)), policy)).toBe('81.107.0.110');
    }
  });

  it('never trusts a missing, duplicated or malformed CF-Connecting-IP', () => {
    expect(resolveClientIp(req('10.214.9.9', { 'x-forwarded-for': '192.0.2.44' }), policy)).toBe('10.214.9.9');
    expect(resolveClientIp(req('10.214.9.9', { 'cf-connecting-ip': ['1.1.1.1', '2.2.2.2'] }), policy)).toBe('10.214.9.9');
    expect(resolveClientIp(req('10.214.9.9', { 'cf-connecting-ip': '1.1.1.1, 2.2.2.2' }), policy)).toBe('10.214.9.9');
  });
});

describe('xff (generic reverse proxy with explicit trusted proxies)', () => {
  const policy = parseClientIpPolicy('xff', '10.0.0.0/8');
  const viaProxy = (xff: string | string[]) => resolveClientIp(req('10.0.0.2', { 'x-forwarded-for': xff }), policy);

  it('takes the right-most untrusted address; prepended spoofs are never reached', () => {
    expect(viaProxy('203.0.113.9')).toBe('203.0.113.9');
    expect(viaProxy('192.0.2.1, 203.0.113.9')).toBe('203.0.113.9');
    expect(viaProxy('1.1.1.1, 2.2.2.2, 3.3.3.3, 203.0.113.9, 10.1.2.3')).toBe('203.0.113.9');
    // Spoofing an address from the trusted range does not help either.
    expect(viaProxy('10.9.9.9, 203.0.113.9, 10.1.2.3')).toBe('203.0.113.9');
  });

  it('ignores X-Forwarded-For unless the TCP peer is a trusted proxy', () => {
    expect(resolveClientIp(req('203.0.113.50', { 'x-forwarded-for': '1.2.3.4' }), policy)).toBe('203.0.113.50');
  });

  it('handles multiple header lines and fails closed on malformed proxy entries', () => {
    expect(viaProxy(['9.9.9.9', '203.0.113.9'])).toBe('203.0.113.9');
    expect(viaProxy('203.0.113.9, not-an-ip')).toBe('10.0.0.2');
  });
});
