const LOOPBACK_HOST = "127.0.0.1";
const WILDCARD_HOSTS = new Set(["0.0.0.0", "::", "[::]"]);

type ListenHostEnv = {
  [key: string]: string | undefined;
  HOST?: string;
  OCTOGENT_ALLOW_REMOTE_ACCESS?: string;
};

export const isRemoteAccessEnabled = (env: ListenHostEnv): boolean =>
  env.OCTOGENT_ALLOW_REMOTE_ACCESS === "1";

/**
 * Resolves the address the API server binds to.
 *
 * Opting into remote access implies binding beyond loopback unless the operator
 * pins HOST explicitly; without this the flag still required a separate HOST
 * override to be reachable from other machines.
 */
export const resolveListenHost = (env: ListenHostEnv): string => {
  const explicitHost = env.HOST?.trim();
  if (explicitHost) {
    return explicitHost;
  }

  return isRemoteAccessEnabled(env) ? "0.0.0.0" : LOOPBACK_HOST;
};

/**
 * Maps a bind address to one a client can dial. A wildcard bind is not a
 * destination, so URLs built for the local browser, the CLI client, and the
 * runtime metadata file must fall back to loopback.
 */
export const toConnectableHost = (host: string): string => {
  if (WILDCARD_HOSTS.has(host)) {
    return host === "0.0.0.0" ? LOOPBACK_HOST : "[::1]";
  }

  // URLs need IPv6 literals bracketed; leave already-bracketed values alone.
  if (host.includes(":") && !host.startsWith("[")) {
    return `[${host}]`;
  }

  return host;
};

export const isWildcardHost = (host: string): boolean => WILDCARD_HOSTS.has(host);

type NetworkInterfaceEntry = {
  address: string;
  family: string;
  internal: boolean;
};

/**
 * External IPv4 addresses of this machine, used to print reachable URLs after a
 * wildcard bind. Takes the interface map so it stays pure and testable.
 */
export const listLanAddresses = (
  interfaces: Record<string, NetworkInterfaceEntry[] | undefined>,
): string[] =>
  Object.values(interfaces)
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
