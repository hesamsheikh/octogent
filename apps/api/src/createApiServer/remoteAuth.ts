import { randomBytes, timingSafeEqual } from "node:crypto";

export const AUTH_COOKIE_NAME = "octogent_token";
export const MIN_ACCESS_TOKEN_LENGTH = 32;

export type RemoteAuthDecision =
  | { kind: "allow" }
  /** First visit authenticated via ?token=; hand the browser a session cookie. */
  | { kind: "allow-set-cookie"; cookie: string }
  | { kind: "deny" };

export const isLoopbackAddress = (address: string | undefined): boolean => {
  if (!address) {
    return false;
  }
  const bare = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
  return bare === "::1" || bare.startsWith("127.");
};

const tokensMatch = (candidate: string, expected: string): boolean => {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

const readCookie = (header: string | undefined, name: string): string | null => {
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) {
      continue;
    }
    if (part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
};

type RemoteAuthInput = {
  remoteAddress: string | undefined;
  /** Request path including the query string. */
  url: string;
  headers: {
    "x-octogent-token"?: string | string[] | undefined;
    cookie?: string | string[] | undefined;
  };
  accessToken: string | null;
};

/**
 * Gate for non-loopback callers when an access token is configured.
 *
 * Loopback is always exempt — the CLI, hooks, and the health probe live there.
 * A browser authenticates once with ?token= and is kept signed in by an
 * httpOnly cookie; tools can send X-Octogent-Token per request instead.
 */
export const evaluateRemoteAuth = (input: RemoteAuthInput): RemoteAuthDecision => {
  if (isLoopbackAddress(input.remoteAddress)) {
    return { kind: "allow" };
  }

  if (!input.accessToken) {
    return { kind: "deny" };
  }

  const headerToken =
    typeof input.headers["x-octogent-token"] === "string"
      ? input.headers["x-octogent-token"]
      : undefined;
  if (headerToken && tokensMatch(headerToken, input.accessToken)) {
    return { kind: "allow" };
  }

  const cookieHeader = typeof input.headers.cookie === "string" ? input.headers.cookie : undefined;
  const cookieToken = readCookie(cookieHeader, AUTH_COOKIE_NAME);
  if (cookieToken && tokensMatch(cookieToken, input.accessToken)) {
    return { kind: "allow" };
  }

  let queryToken: string | null = null;
  try {
    queryToken = new URL(input.url, "http://localhost").searchParams.get("token");
  } catch {
    queryToken = null;
  }
  if (queryToken && tokensMatch(queryToken, input.accessToken)) {
    return {
      kind: "allow-set-cookie",
      cookie: `${AUTH_COOKIE_NAME}=${input.accessToken}; HttpOnly; SameSite=Lax; Path=/`,
    };
  }

  return { kind: "deny" };
};

export const resolveAccessToken = (env: {
  [key: string]: string | undefined;
  OCTOGENT_ACCESS_TOKEN?: string;
}): string | null => {
  const value = env.OCTOGENT_ACCESS_TOKEN?.trim();
  return value && value.length > 0 ? value : null;
};

export const assertSecureRemoteBinding = (address: string, accessToken: string | null): void => {
  if (isLoopbackAddress(address)) {
    return;
  }

  if (!accessToken || accessToken.length < MIN_ACCESS_TOKEN_LENGTH) {
    throw new Error(
      `Non-loopback API binding (${address}) requires a high-entropy access token of at least ${MIN_ACCESS_TOKEN_LENGTH} characters. Set OCTOGENT_ACCESS_TOKEN or use the CLI start command with remote access enabled to generate one automatically.`,
    );
  }
};

export const generateAccessToken = (): string => randomBytes(24).toString("base64url");
