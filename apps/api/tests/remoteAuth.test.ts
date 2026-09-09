import { describe, expect, it } from "vitest";

import {
  evaluateRemoteAuth,
  generateAccessToken,
  isLoopbackAddress,
  resolveAccessToken,
} from "../src/createApiServer/remoteAuth";

const TOKEN = "sesame-open-sesame";

const evaluate = (overrides: Partial<Parameters<typeof evaluateRemoteAuth>[0]> = {}) =>
  evaluateRemoteAuth({
    remoteAddress: "192.168.8.50",
    url: "/",
    headers: {},
    accessToken: TOKEN,
    ...overrides,
  });

describe("isLoopbackAddress", () => {
  it("recognises IPv4, IPv6 and mapped loopbacks", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("127.8.9.10")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("192.168.8.50")).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });
});

describe("evaluateRemoteAuth", () => {
  it("fails closed for remote callers when no token is configured", () => {
    expect(evaluate({ accessToken: null }).kind).toBe("deny");
  });

  it("keeps loopback callers working when no token is configured", () => {
    expect(evaluate({ accessToken: null, remoteAddress: "127.0.0.1" }).kind).toBe("allow");
  });

  it("always trusts loopback so the CLI and local tools keep working", () => {
    expect(evaluate({ remoteAddress: "127.0.0.1" }).kind).toBe("allow");
    expect(evaluate({ remoteAddress: "::ffff:127.0.0.1" }).kind).toBe("allow");
  });

  it("denies a bare remote request", () => {
    expect(evaluate().kind).toBe("deny");
  });

  it("accepts the token via header", () => {
    expect(evaluate({ headers: { "x-octogent-token": TOKEN } }).kind).toBe("allow");
  });

  it("accepts the token via cookie", () => {
    expect(evaluate({ headers: { cookie: `theme=dark; octogent_token=${TOKEN}` } }).kind).toBe(
      "allow",
    );
  });

  it("accepts a first visit with ?token= and hands back a session cookie", () => {
    const decision = evaluate({ url: `/?token=${TOKEN}` });
    expect(decision.kind).toBe("allow-set-cookie");
    if (decision.kind === "allow-set-cookie") {
      expect(decision.cookie).toContain(`octogent_token=${TOKEN}`);
      expect(decision.cookie).toContain("HttpOnly");
      expect(decision.cookie).toContain("SameSite=Lax");
    }
  });

  it("rejects wrong tokens on every channel", () => {
    expect(evaluate({ headers: { "x-octogent-token": "nope" } }).kind).toBe("deny");
    expect(evaluate({ headers: { cookie: "octogent_token=nope" } }).kind).toBe("deny");
    expect(evaluate({ url: "/?token=nope" }).kind).toBe("deny");
  });

  it("compares without throwing on length mismatches", () => {
    expect(evaluate({ headers: { "x-octogent-token": "x" } }).kind).toBe("deny");
  });
});

describe("token plumbing", () => {
  it("reads the env token and treats blank as unset", () => {
    expect(resolveAccessToken({ OCTOGENT_ACCESS_TOKEN: " secret " })).toBe("secret");
    expect(resolveAccessToken({ OCTOGENT_ACCESS_TOKEN: "   " })).toBeNull();
    expect(resolveAccessToken({})).toBeNull();
  });

  it("generates url-safe tokens of reasonable size", () => {
    const token = generateAccessToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(generateAccessToken()).not.toBe(token);
  });
});
