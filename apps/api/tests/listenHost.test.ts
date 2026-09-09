import { describe, expect, it } from "vitest";

import {
  isWildcardHost,
  listLanAddresses,
  resolveListenHost,
  toConnectableHost,
} from "../src/listenHost";

describe("resolveListenHost", () => {
  it("binds loopback by default", () => {
    expect(resolveListenHost({})).toBe("127.0.0.1");
  });

  it("binds every interface once remote access is enabled", () => {
    expect(resolveListenHost({ OCTOGENT_ALLOW_REMOTE_ACCESS: "1" })).toBe("0.0.0.0");
  });

  it("keeps loopback when remote access is not opted into with an exact 1", () => {
    expect(resolveListenHost({ OCTOGENT_ALLOW_REMOTE_ACCESS: "true" })).toBe("127.0.0.1");
    expect(resolveListenHost({ OCTOGENT_ALLOW_REMOTE_ACCESS: "0" })).toBe("127.0.0.1");
  });

  it("lets an explicit HOST win over the remote access default", () => {
    expect(resolveListenHost({ OCTOGENT_ALLOW_REMOTE_ACCESS: "1", HOST: "192.168.1.10" })).toBe(
      "192.168.1.10",
    );
    expect(resolveListenHost({ HOST: "0.0.0.0" })).toBe("0.0.0.0");
  });

  it("ignores a blank HOST so a stray export cannot bind an empty address", () => {
    expect(resolveListenHost({ HOST: "   " })).toBe("127.0.0.1");
    expect(resolveListenHost({ OCTOGENT_ALLOW_REMOTE_ACCESS: "1", HOST: "" })).toBe("0.0.0.0");
  });
});

describe("toConnectableHost", () => {
  it("rewrites wildcard binds to an address clients can actually dial", () => {
    expect(toConnectableHost("0.0.0.0")).toBe("127.0.0.1");
    expect(toConnectableHost("::")).toBe("[::1]");
  });

  it("brackets bare IPv6 literals for URL use", () => {
    expect(toConnectableHost("::1")).toBe("[::1]");
    expect(toConnectableHost("fe80::1")).toBe("[fe80::1]");
    expect(toConnectableHost("[::1]")).toBe("[::1]");
  });

  it("passes through routable hosts unchanged", () => {
    expect(toConnectableHost("127.0.0.1")).toBe("127.0.0.1");
    expect(toConnectableHost("192.168.1.10")).toBe("192.168.1.10");
    expect(toConnectableHost("localhost")).toBe("localhost");
  });
});

describe("listLanAddresses", () => {
  const interfaces = {
    lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    eth0: [
      { address: "192.168.8.204", family: "IPv4", internal: false },
      { address: "fe80::1", family: "IPv6", internal: false },
    ],
    docker0: [{ address: "172.17.0.1", family: "IPv4", internal: false }],
  };

  it("lists external IPv4 addresses so operators can see their LAN URL", () => {
    expect(listLanAddresses(interfaces)).toEqual(["192.168.8.204", "172.17.0.1"]);
  });

  it("skips loopback and IPv6 entries", () => {
    expect(
      listLanAddresses({ lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }] }),
    ).toEqual([]);
  });

  it("tolerates undefined interface entries", () => {
    expect(listLanAddresses({ eth0: undefined })).toEqual([]);
  });
});

describe("isWildcardHost", () => {
  it("recognises the binds that expose every interface", () => {
    expect(isWildcardHost("0.0.0.0")).toBe(true);
    expect(isWildcardHost("::")).toBe(true);
    expect(isWildcardHost("127.0.0.1")).toBe(false);
    expect(isWildcardHost("192.168.1.10")).toBe(false);
  });
});
