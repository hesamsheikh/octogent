import type { AgentState, TerminalSnapshot, TerminalSnapshotReader } from "@octogent/core";

type HttpResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

type HttpRequestInit = {
  method: "GET";
  headers: Record<string, string>;
  signal?: AbortSignal | null;
};

type HttpFetcher = (input: string, init: HttpRequestInit) => Promise<HttpResponse>;

type HttpTerminalSnapshotReaderOptions = {
  endpoint: string;
  fetcher?: HttpFetcher;
  signal?: AbortSignal;
};

const isAgentState = (value: unknown): value is AgentState =>
  value === "live" ||
  value === "idle" ||
  value === "queued" ||
  value === "blocked" ||
  value === "stopped" ||
  value === "exited" ||
  value === "stale" ||
  value === "stalled";

const isLifecycleState = (value: unknown) =>
  value === "registered" ||
  value === "running" ||
  value === "stopped" ||
  value === "exited" ||
  value === "stale" ||
  value === "stalled";

const isTerminalSnapshot = (value: unknown): value is TerminalSnapshot => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const snapshot = value as Record<string, unknown>;

  return (
    typeof snapshot.terminalId === "string" &&
    typeof snapshot.label === "string" &&
    isAgentState(snapshot.state) &&
    typeof snapshot.tentacleId === "string" &&
    (snapshot.tentacleName === undefined || typeof snapshot.tentacleName === "string") &&
    (snapshot.workspaceMode === undefined ||
      snapshot.workspaceMode === "shared" ||
      snapshot.workspaceMode === "worktree") &&
    typeof snapshot.createdAt === "string" &&
    (snapshot.lifecycleState === undefined || isLifecycleState(snapshot.lifecycleState)) &&
    (snapshot.lifecycleReason === undefined || typeof snapshot.lifecycleReason === "string") &&
    (snapshot.lifecycleUpdatedAt === undefined ||
      typeof snapshot.lifecycleUpdatedAt === "string") &&
    (snapshot.processId === undefined || typeof snapshot.processId === "number") &&
    (snapshot.startedAt === undefined || typeof snapshot.startedAt === "string") &&
    (snapshot.endedAt === undefined || typeof snapshot.endedAt === "string") &&
    (snapshot.exitCode === undefined || typeof snapshot.exitCode === "number") &&
    (snapshot.exitSignal === undefined ||
      typeof snapshot.exitSignal === "number" ||
      typeof snapshot.exitSignal === "string")
  );
};

export class HttpTerminalSnapshotReader implements TerminalSnapshotReader {
  private readonly endpoint: string;
  private readonly fetcher: HttpFetcher;
  private readonly signal: AbortSignal | undefined;

  constructor({ endpoint, fetcher, signal }: HttpTerminalSnapshotReaderOptions) {
    this.endpoint = endpoint;
    this.fetcher =
      fetcher ??
      ((input, init) =>
        fetch(input, {
          ...init,
          signal: init.signal ?? null,
        }));
    this.signal = signal;
  }

  async listTerminalSnapshots(): Promise<TerminalSnapshot[]> {
    const requestInit: HttpRequestInit = {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    };
    if (this.signal) {
      requestInit.signal = this.signal;
    }

    const response = await this.fetcher(this.endpoint, requestInit);

    if (!response.ok) {
      throw new Error(`Unable to load terminal snapshots (${response.status})`);
    }

    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      return [];
    }

    return payload.filter(isTerminalSnapshot);
  }
}
