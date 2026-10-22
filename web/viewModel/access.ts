/**
 * web/viewModel/access.ts - Pure access state resolution and token storage.
 */
export type AccessVerdict = "open" | "needs-token" | "local-only" | "error";

export interface AccessPayload {
  writeRequiresToken: boolean;
  canWrite: boolean;
}

export function decideAccessState(payload: AccessPayload | null | undefined): AccessVerdict {
  if (!payload || typeof payload !== "object") {
    return "error";
  }
  if (typeof payload.writeRequiresToken !== "boolean" || typeof payload.canWrite !== "boolean") {
    return "error";
  }
  if (payload.canWrite) {
    return "open";
  }
  if (payload.writeRequiresToken) {
    return "needs-token";
  }
  return "local-only";
}

export const TOKEN_STORAGE_KEY = "ttf_write_token";

export interface TokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function resolveSessionStorage(): TokenStorage | undefined {
  if (typeof window !== "undefined" && window.sessionStorage) {
    return window.sessionStorage;
  }
  return undefined;
}

function resolveLocalStorage(): TokenStorage | undefined {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  return undefined;
}

export function readStoredToken(
  sessionStore = resolveSessionStorage(),
  localStore = resolveLocalStorage(),
): { token: string | null; remembered: boolean } {
  try {
    const sessionVal = sessionStore?.getItem(TOKEN_STORAGE_KEY);
    if (sessionVal && sessionVal.trim() !== "") {
      return { token: sessionVal.trim(), remembered: false };
    }
  } catch {
    // ignore
  }

  try {
    const localVal = localStore?.getItem(TOKEN_STORAGE_KEY);
    if (localVal && localVal.trim() !== "") {
      return { token: localVal.trim(), remembered: true };
    }
  } catch {
    // ignore
  }

  return { token: null, remembered: false };
}

export function saveToken(
  token: string,
  remember: boolean,
  sessionStore = resolveSessionStorage(),
  localStore = resolveLocalStorage(),
): void {
  try {
    sessionStore?.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // ignore
  }

  try {
    if (remember) {
      localStore?.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStore?.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

export function clearToken(
  sessionStore = resolveSessionStorage(),
  localStore = resolveLocalStorage(),
): void {
  try {
    sessionStore?.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
  try {
    localStore?.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}
