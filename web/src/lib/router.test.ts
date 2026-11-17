import { describe, expect, it } from 'vitest';
import { matchPath, pathFromHash } from './router.tsx';

describe('hash router', () => {
  it('reads the path from the hash', () => {
    expect(pathFromHash('')).toBe('/');
    expect(pathFromHash('#')).toBe('/');
    expect(pathFromHash('#/')).toBe('/');
    expect(pathFromHash('#/rules/')).toBe('/rules');
    expect(pathFromHash('#/t/7?x=1')).toBe('/t/7');
    expect(pathFromHash('#rules')).toBe('/rules');
  });

  it('matches patterns and extracts parameters', () => {
    expect(matchPath('/', '/')).toEqual({});
    expect(matchPath('/rules', '/rules')).toEqual({});
    expect(matchPath('/rules/:id', '/rules/12')).toEqual({ id: '12' });
    expect(matchPath('/suppliers/:address', '/suppliers/0xabc')).toEqual({ address: '0xabc' });
    expect(matchPath('/t/:id', '/t/a%20b')).toEqual({ id: 'a b' });
  });

  it('does not match a different shape', () => {
    expect(matchPath('/rules', '/rules/1')).toBeNull();
    expect(matchPath('/rules/:id', '/rules')).toBeNull();
    expect(matchPath('/t/:id', '/x/1')).toBeNull();
    expect(matchPath('/t/:id', '/t/%E0%A4%A')).toBeNull(); // a malformed escape is no match, not a crash
  });

  it('lets the catch-all take anything', () => {
    expect(matchPath('*', '/anything/at/all')).toEqual({});
  });
});
