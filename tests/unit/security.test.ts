import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveStaticPath } from '../../server/src/networking/gameServer';
import { makeOriginCheck, resolveAllowedOrigins } from '../../server/src/security/origin';

describe('WebSocket origin policy', () => {
  it('defaults to "*" in development and "self" in production; refuses "*" in production', () => {
    expect(resolveAllowedOrigins(undefined, 'development')).toEqual(['*']);
    expect(resolveAllowedOrigins('', undefined)).toEqual(['*']);
    expect(resolveAllowedOrigins(undefined, 'production')).toEqual(['self']);
    expect(resolveAllowedOrigins('https://a.example, https://b.example', 'production')).toEqual(['https://a.example', 'https://b.example']);
    expect(() => resolveAllowedOrigins('*', 'production')).toThrow(/not allowed/);
  });

  it('"self" accepts only the page served by this host', () => {
    const ok = makeOriginCheck(['self']);
    expect(ok('https://game.example.com', 'game.example.com')).toBe(true);
    expect(ok('http://localhost:8787', 'localhost:8787')).toBe(true);
    expect(ok('https://evil.example', 'game.example.com')).toBe(false);
    expect(ok('https://game.example.com.evil.example', 'game.example.com')).toBe(false);
    expect(ok('not a url', 'game.example.com')).toBe(false);
    expect(ok(undefined, 'game.example.com')).toBe(true); // non-browser clients send no Origin
  });

  it('exact lists match exactly; "*" allows any', () => {
    const ok = makeOriginCheck(['https://play.example.com/']);
    expect(ok('https://play.example.com', 'api.example.com')).toBe(true);
    expect(ok('https://play.example.com.evil.io', 'api.example.com')).toBe(false);
    expect(makeOriginCheck(['*'])('https://anything.example', 'x')).toBe(true);
  });
});

describe('static file resolution (CLIENT_DIST)', () => {
  it('works with a RELATIVE root (regression: every request used to return 403)', () => {
    const f = resolveStaticPath('client/dist', '/index.html');
    expect(f).toBe(path.resolve('client/dist', 'index.html'));
    expect(resolveStaticPath('client/dist', '/assets/characters/processed/rick.png')).toBe(path.resolve('client/dist/assets/characters/processed/rick.png'));
  });

  it('never escapes the root, with absolute or relative roots', () => {
    for (const root of ['client/dist', path.resolve('client/dist')]) {
      const base = path.resolve(root);
      for (const attack of ['/../../package.json', '/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/package.json', '/..\..\package.json', '/../dist2/secret']) {
        const f = resolveStaticPath(root, attack);
        if (f !== null) expect(path.relative(base, f).startsWith('..'), attack).toBe(false);
      }
    }
    expect(resolveStaticPath('client/dist', '/%E0%A4%A')).toBeNull(); // malformed escape
  });
});
