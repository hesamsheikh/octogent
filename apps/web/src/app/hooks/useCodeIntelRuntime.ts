import { useCallback, useEffect, useState } from "react";

import { buildCodeIntelEventsUrl } from "../../runtime/runtimeEndpoints";
import {
  type CodeIntelEvent,
  type CouplingData,
  type TreemapNode,
  buildCouplingData,
  buildTreemapTree,
} from "../codeIntelAggregation";

type CodeIntelRuntimeResult = {
  events: CodeIntelEvent[];
  treemapRoot: TreemapNode | null;
  couplingData: CouplingData | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
};

export const useCodeIntelRuntime = (enabled: boolean): CodeIntelRuntimeResult => {
  const [events, setEvents] = useState<CodeIntelEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(buildCodeIntelEventsUrl());
      if (!response.ok) {
        setError(`Failed to load events: ${response.status}`);
        return;
      }
      const data = (await response.json()) as { events: CodeIntelEvent[] };
      setEvents(data.events);
    } catch {
      setError("Failed to connect to API");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void fetchEvents();
  }, [enabled, fetchEvents]);

  // Derive workspace cwd from common prefix of file paths
  const workspaceCwd = events.length > 0 ? deriveWorkspaceCwd(events.map((e) => e.file)) : "";

  const treemapRoot = events.length > 0 ? buildTreemapTree(events, workspaceCwd) : null;
  const couplingData = events.length > 0 ? buildCouplingData(events, workspaceCwd) : null;

  return {
    events,
    treemapRoot,
    couplingData,
    isLoading,
    error,
    refresh: () => {
      void fetchEvents();
    },
  };
};

/** Find the longest common directory prefix across all file paths. */
const deriveWorkspaceCwd = (paths: string[]): string => {
  const [firstPath] = paths;
  if (!firstPath) return "";
  const parts = firstPath.split("/");
  let prefix = "";

  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(0, i + 1).join("/");
    if (paths.every((p) => p.startsWith(`${candidate}/`))) {
      prefix = candidate;
    } else {
      break;
    }
  }

  return prefix;
};
