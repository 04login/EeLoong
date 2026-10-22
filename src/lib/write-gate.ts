// Fail-closed write check for public forms. An unset secret rejects every
// write — local dev and production both stay locked until the matching Worker
// secret (or .dev.vars) is set. Not a login system: the token is compared
// server-side and, after unlock, stored in an HttpOnly cookie.

export function writeAuthorized(secret: string | undefined, presented: string | undefined): boolean {
  if (!secret) return false;
  const given = presented ?? "";
  if (given.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) {
    diff |= secret.charCodeAt(i) ^ given.charCodeAt(i);
  }
  return diff === 0;
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function authCookieHeader(name: string, token: string, secure: boolean, path: string): string {
  const parts = [
    `${name}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    `Path=${path}`,
    "Max-Age=2592000",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** Local path only. Rejects protocol-relative and backslash redirects. */
export function safeNext(raw: string, fallback: string, prefix: string): string {
  if (!raw.startsWith(prefix) || raw.startsWith("//") || raw.includes("\\") || raw.includes("://")) {
    return fallback;
  }
  return raw;
}
