// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  decodeCharacterId,
  resolveIdentity,
  resolveCurrentIdentity,
  shouldSignalDegradation,
  shouldClearDegradation,
} from '../identity';

function base64Url(value: string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function makeToken(payload: Record<string, unknown>, header: Record<string, unknown> = {}): string {
  const head = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT', ...header }));
  const body = base64Url(JSON.stringify(payload));

  return `${head}.${body}.signature`;
}

// Claim shapes as the site issues them
const TOKEN_A = makeToken({ CharacterId: '900001', UserId: 11, exp: 9999999999 });
const TOKEN_B = makeToken({ CharacterId: '1000002', UserId: 22, exp: 9999999999 });

describe('decodeCharacterId', () => {
  it('decodes the CharacterId claim from a valid token', () => {
    expect(decodeCharacterId(TOKEN_A)).toBe('900001');
    expect(decodeCharacterId(TOKEN_B)).toBe('1000002');
  });

  it('accepts a numeric CharacterId claim and canonicalises it to a string', () => {
    expect(decodeCharacterId(makeToken({ CharacterId: 900001 }))).toBe('900001');
  });

  it('trims surrounding whitespace', () => {
    expect(decodeCharacterId(makeToken({ CharacterId: ' 900001 ' }))).toBe('900001');
  });

  it('returns null when the token is not three segments', () => {
    expect(decodeCharacterId('not-a-jwt')).toBeNull();
    expect(decodeCharacterId('only.two')).toBeNull();
    expect(decodeCharacterId('a.b.c.d')).toBeNull();
  });

  it('returns null when the payload is not valid base64url JSON', () => {
    expect(decodeCharacterId('aaa.!!!notbase64!!!.sig')).toBeNull();
    expect(decodeCharacterId(`aaa.${base64Url('not json')}.sig`)).toBeNull();
  });

  it('returns null when the CharacterId claim is missing', () => {
    expect(decodeCharacterId(makeToken({ UserId: 11, exp: 1 }))).toBeNull();
  });

  it('returns null when the CharacterId claim is not all digits', () => {
    expect(decodeCharacterId(makeToken({ CharacterId: 'abc' }))).toBeNull();
    expect(decodeCharacterId(makeToken({ CharacterId: '900001x' }))).toBeNull();
    expect(decodeCharacterId(makeToken({ CharacterId: '' }))).toBeNull();
  });

  it('returns null when the payload is a JSON value but not an object', () => {
    expect(decodeCharacterId(`aaa.${base64Url('42')}.sig`)).toBeNull();
    expect(decodeCharacterId(`aaa.${base64Url('null')}.sig`)).toBeNull();
  });
});

describe('resolveIdentity', () => {
  it('returns no charId and no degradation when logged out (no token)', () => {
    expect(resolveIdentity(null, null)).toEqual({ charId: null, degraded: false });
    expect(resolveIdentity('', '')).toEqual({ charId: null, degraded: false });
  });

  it('resolves from localStorage alone (Remember me ON)', () => {
    expect(resolveIdentity(TOKEN_A, null)).toEqual({ charId: '900001', degraded: false });
  });

  it('resolves from sessionStorage alone (Remember me OFF)', () => {
    expect(resolveIdentity(null, TOKEN_B)).toEqual({ charId: '1000002', degraded: false });
  });

  it('flags degradation when the single present token is unresolvable', () => {
    expect(resolveIdentity('garbage-token', null)).toEqual({ charId: null, degraded: true });
    expect(resolveIdentity(null, makeToken({ UserId: 1 }))).toEqual({
      charId: null,
      degraded: true,
    });
  });

  it('resolves when both stores agree, with no degradation', () => {
    expect(resolveIdentity(TOKEN_A, TOKEN_A)).toEqual({ charId: '900001', degraded: false });
  });

  it('returns null without degradation when both stores are present but differ', () => {
    expect(resolveIdentity(TOKEN_A, TOKEN_B)).toEqual({ charId: null, degraded: false });
  });

  it('does not flag degradation when both stores are present but one is unresolvable', () => {
    expect(resolveIdentity(TOKEN_A, 'garbage')).toEqual({ charId: null, degraded: false });
  });
});

describe('resolveCurrentIdentity', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('reads the token from localStorage', () => {
    localStorage.setItem('access_token', TOKEN_A);

    expect(resolveCurrentIdentity()).toEqual({ charId: '900001', degraded: false });
  });

  it('reads the token from sessionStorage', () => {
    sessionStorage.setItem('access_token', TOKEN_B);

    expect(resolveCurrentIdentity()).toEqual({ charId: '1000002', degraded: false });
  });

  it('returns no charId when neither store has a token', () => {
    expect(resolveCurrentIdentity()).toEqual({ charId: null, degraded: false });
  });
});

describe('shouldSignalDegradation', () => {
  it('signals only when opted in and a present token is unresolvable', () => {
    expect(shouldSignalDegradation(true, { charId: null, degraded: true })).toBe(true);
  });

  it('does not signal when multi-profile is off, even if degraded', () => {
    expect(shouldSignalDegradation(false, { charId: null, degraded: true })).toBe(false);
  });

  it('does not signal on a normal logged-out tab (no token, not degraded)', () => {
    expect(shouldSignalDegradation(true, { charId: null, degraded: false })).toBe(false);
  });

  it('does not signal once the character resolves', () => {
    expect(shouldSignalDegradation(true, { charId: '900001', degraded: false })).toBe(false);
  });
});

describe('shouldClearDegradation', () => {
  it('clears once a character is read again', () => {
    expect(shouldClearDegradation({ charId: '900001', degraded: false })).toBe(true);
  });

  it('keeps the signal while no character is read', () => {
    expect(shouldClearDegradation({ charId: null, degraded: true })).toBe(false);
    expect(shouldClearDegradation({ charId: null, degraded: false })).toBe(false);
  });
});
