const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export const withCors = (headers: Record<string, string>, corsOrigin: string | null) => {
  const nextHeaders: Record<string, string> = {
    ...headers,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (corsOrigin) {
    nextHeaders["Access-Control-Allow-Origin"] = corsOrigin;
    nextHeaders.Vary = "Origin";
  }

  return nextHeaders;
};

const isLoopbackHostname = (hostname: string) => LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());

const parseHostname = (value: string, withScheme: boolean): string | null => {
  try {
    const url = new URL(withScheme ? value : `http://${value}`);
    return url.hostname;
  } catch {
    return null;
  }
};

export const isAllowedOriginHeader = (
  origin: string | undefined,
  host: string | undefined,
  isRemoteBinding: boolean,
) => {
  if (origin === undefined) {
    return true;
  }

  const originHostname = parseHostname(origin, true);
  if (originHostname === null) {
    return false;
  }

  if (!isRemoteBinding) {
    return isLoopbackHostname(originHostname);
  }

  if (!host) {
    return false;
  }

  const hostHostname = parseHostname(host, false);
  return (
    hostHostname !== null &&
    (originHostname.toLowerCase() === hostHostname.toLowerCase() ||
      (isLoopbackHostname(originHostname) && isLoopbackHostname(hostHostname)))
  );
};

export const isAllowedHostHeader = (host: string | undefined, isRemoteBinding: boolean) => {
  if (!host) {
    return false;
  }

  if (isRemoteBinding) {
    return true;
  }

  const hostname = parseHostname(host, false);
  return hostname !== null && isLoopbackHostname(hostname);
};

export const readHeaderValue = (header: string | string[] | undefined): string | undefined => {
  if (typeof header !== "string") {
    return undefined;
  }

  const trimmed = header.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const getRequestCorsOrigin = (
  origin: string | undefined,
  host: string | undefined,
  isRemoteBinding: boolean,
) => {
  if (!origin) {
    return null;
  }

  if (!isAllowedOriginHeader(origin, host, isRemoteBinding)) {
    return null;
  }

  return origin;
};
