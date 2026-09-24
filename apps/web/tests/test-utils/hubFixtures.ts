import { vi } from "vitest";

import { jsonResponse, notFoundResponse } from "./appTestHarness";

export const hubListing = {
  projects: [
    {
      id: "abc-123",
      name: "Key Cluster",
      slug: "keycluster",
      path: "/work/keycluster",
      loaded: true,
      summary: {
        id: "abc-123",
        name: "Key Cluster",
        path: "/work/keycluster",
        ptySessions: 3,
        runningTerminals: 2,
        awaitingReviewTerminals: 1,
        lastActivityAt: "2026-09-22T08:00:00.000Z",
      },
    },
    { id: "def-456", name: "Docs Site", slug: "docs", path: "/work/docs", loaded: false },
  ],
};

type RecordedFetch = { url: string; method: string; body: unknown };

type HubFetchOptions = {
  /** `null` answers GET /api/projects like a single-project server does; a function is read per request. */
  listing?: unknown | null | (() => unknown);
  /** Answers every POST /api/projects; receives the parsed body. */
  onRegister?: (body: Record<string, unknown>) => Response;
};

/**
 * Stubs fetch with a hub that answers /api/projects. By default a POST
 * without a path gets the 400 the hub gives an allowed caller, which is what
 * the add form probes for.
 */
export const stubHubFetch = ({ listing = hubListing, onRegister }: HubFetchOptions = {}) => {
  const calls: RecordedFetch[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ url, method, body });

    if (url === "/api/projects" && method === "GET") {
      if (listing === null) {
        return notFoundResponse();
      }
      return jsonResponse(typeof listing === "function" ? listing() : listing);
    }
    if (url === "/api/projects" && method === "POST") {
      return onRegister
        ? onRegister(body)
        : jsonResponse({ error: "path must be an absolute path." }, 400);
    }
    return notFoundResponse();
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    calls,
    listingRequests: () =>
      calls.filter((call) => call.url === "/api/projects" && call.method === "GET").length,
  };
};
