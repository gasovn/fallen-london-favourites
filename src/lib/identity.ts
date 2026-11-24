const TOKEN_KEY = 'access_token';
const CHARACTER_ID_PATTERN = /^[0-9]+$/;

export interface IdentityResolution {
  charId: string | null;
  // Set only when a token was found in exactly one store and could not be read.
  degraded: boolean;
}

function base64UrlDecode(segment: string): string | null {
  let normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = normalized.length % 4;

  if (remainder === 1) {
    return null;
  }

  if (remainder === 2) {
    normalized += '==';
  } else if (remainder === 3) {
    normalized += '=';
  }

  try {
    return atob(normalized);
  } catch {
    return null;
  }
}

/**
 * The CharacterId claim of a JWT, or null when the token is malformed or the
 * claim is missing or not all digits. The signature is not checked.
 */
export function decodeCharacterId(token: string): string | null {
  const parts = token.split('.');

  if (parts.length !== 3) {
    return null;
  }

  const payloadJson = base64UrlDecode(parts[1]);

  if (payloadJson === null) {
    return null;
  }

  let payload: unknown;

  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return null;
  }

  if (payload === null || typeof payload !== 'object') {
    return null;
  }

  const claim = (payload as Record<string, unknown>).CharacterId;

  if (typeof claim !== 'string' && typeof claim !== 'number') {
    return null;
  }

  const id = String(claim).trim();

  return CHARACTER_ID_PATTERN.test(id) ? id : null;
}

/**
 * The token sits in localStorage with "Remember me" and in sessionStorage
 * without it. If both are present they have to agree.
 */
export function resolveIdentity(
  localToken: string | null,
  sessionToken: string | null,
): IdentityResolution {
  const tokens = [localToken, sessionToken].filter(
    (token): token is string => typeof token === 'string' && token.length > 0,
  );

  if (tokens.length === 0) {
    return { charId: null, degraded: false };
  }

  if (tokens.length === 2) {
    const fromLocal = decodeCharacterId(tokens[0]);
    const fromSession = decodeCharacterId(tokens[1]);

    if (fromLocal !== null && fromLocal === fromSession) {
      return { charId: fromLocal, degraded: false };
    }

    return { charId: null, degraded: false };
  }

  const charId = decodeCharacterId(tokens[0]);

  if (charId !== null) {
    return { charId, degraded: false };
  }

  return { charId: null, degraded: true };
}

export function shouldSignalDegradation(multi: boolean, resolution: IdentityResolution): boolean {
  return multi && resolution.degraded;
}

export function shouldClearDegradation(resolution: IdentityResolution): boolean {
  return resolution.charId !== null;
}

function readToken(store: Storage | undefined): string | null {
  if (!store) {
    return null;
  }

  try {
    return store.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Content-script only: reads the page's own storage. */
export function resolveCurrentIdentity(): IdentityResolution {
  const local = typeof localStorage !== 'undefined' ? localStorage : undefined;
  const session = typeof sessionStorage !== 'undefined' ? sessionStorage : undefined;

  return resolveIdentity(readToken(local), readToken(session));
}
