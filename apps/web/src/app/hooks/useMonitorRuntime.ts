import { useCallback, useEffect, useRef, useState } from "react";

import { apiClient } from "../../runtime/apiClient";
import {
  buildMonitorConfigUrl,
  buildMonitorFeedUrl,
  buildMonitorRefreshUrl,
} from "../../runtime/runtimeEndpoints";
import { MONITOR_SCAN_INTERVAL_MS } from "../constants";
import {
  normalizeMonitorConfigSnapshot,
  normalizeMonitorFeedSnapshot,
} from "../monitorNormalizers";
import type { MonitorConfigSnapshot, MonitorFeedSnapshot } from "../types";

export type MonitorConfigPatchRequest = {
  providerId?: "x";
  queryTerms?: string[];
  refreshPolicy?: {
    maxCacheAgeMs?: number;
    maxPosts?: number;
    searchWindowDays?: 1 | 3 | 7;
  };
  credentials?: {
    bearerToken?: string;
    apiKey?: string;
    apiSecret?: string;
    accessToken?: string;
    accessTokenSecret?: string;
  };
  validateCredentials?: boolean;
};

export type UseMonitorRuntimeResult = {
  monitorConfig: MonitorConfigSnapshot | null;
  monitorFeed: MonitorFeedSnapshot | null;
  isRefreshingMonitorFeed: boolean;
  isSavingMonitorConfig: boolean;
  monitorError: string | null;
  refreshMonitorFeed: (manual?: boolean) => Promise<void>;
  patchMonitorConfig: (patch: MonitorConfigPatchRequest) => Promise<boolean>;
};

type UseMonitorRuntimeOptions = {
  enabled?: boolean;
};

const buildMonitorErrorMessage = (fallback: string, error: unknown): string => {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return fallback;
};

export const useMonitorRuntime = ({
  enabled = true,
}: UseMonitorRuntimeOptions = {}): UseMonitorRuntimeResult => {
  const [monitorConfig, setMonitorConfig] = useState<MonitorConfigSnapshot | null>(null);
  const [monitorFeed, setMonitorFeed] = useState<MonitorFeedSnapshot | null>(null);
  const [isRefreshingMonitorFeed, setIsRefreshingMonitorFeed] = useState(false);
  const [isSavingMonitorConfig, setIsSavingMonitorConfig] = useState(false);
  const [monitorError, setMonitorError] = useState<string | null>(null);
  const inFlightFeedRef = useRef(false);

  const loadMonitorConfig = useCallback(async () => {
    if (!enabled) {
      return;
    }

    const raw = await apiClient.get<unknown>(buildMonitorConfigUrl());
    const parsed = normalizeMonitorConfigSnapshot(raw);
    if (!parsed) {
      throw new Error("Monitor config payload is invalid.");
    }

    setMonitorConfig(parsed);
  }, [enabled]);

  const refreshMonitorFeed = useCallback(
    async (manual = false) => {
      if (!enabled) {
        return;
      }

      if (inFlightFeedRef.current) {
        return;
      }

      inFlightFeedRef.current = true;
      setIsRefreshingMonitorFeed(true);

      try {
        const raw = manual
          ? await apiClient.post<unknown>(buildMonitorRefreshUrl())
          : await apiClient.get<unknown>(buildMonitorFeedUrl());

        const parsed = normalizeMonitorFeedSnapshot(raw);
        if (!parsed) {
          throw new Error("Monitor feed payload is invalid.");
        }

        setMonitorFeed(parsed);
        setMonitorError(null);
      } catch (error) {
        setMonitorError(buildMonitorErrorMessage("Unable to read monitor feed.", error));
      } finally {
        inFlightFeedRef.current = false;
        setIsRefreshingMonitorFeed(false);
      }
    },
    [enabled],
  );

  const patchMonitorConfig = useCallback(
    async (patch: MonitorConfigPatchRequest) => {
      if (!enabled) {
        return false;
      }

      setIsSavingMonitorConfig(true);
      try {
        const raw = await apiClient.patch<unknown>(buildMonitorConfigUrl(), patch);
        const parsed = normalizeMonitorConfigSnapshot(raw);
        if (!parsed) {
          throw new Error("Monitor config response is invalid.");
        }

        setMonitorConfig(parsed);
        setMonitorError(null);
        return true;
      } catch (error) {
        setMonitorError(buildMonitorErrorMessage("Unable to save monitor config.", error));
        return false;
      } finally {
        setIsSavingMonitorConfig(false);
      }
    },
    [enabled],
  );

  useEffect(() => {
    if (!enabled) {
      inFlightFeedRef.current = false;
      setMonitorConfig(null);
      setMonitorFeed(null);
      setIsRefreshingMonitorFeed(false);
      setIsSavingMonitorConfig(false);
      setMonitorError(null);
      return;
    }

    let isDisposed = false;

    const hydrateMonitor = async () => {
      try {
        await loadMonitorConfig();
        if (!isDisposed) {
          await refreshMonitorFeed(false);
        }
      } catch (error) {
        if (!isDisposed) {
          setMonitorError(buildMonitorErrorMessage("Unable to initialize monitor runtime.", error));
        }
      }
    };

    void hydrateMonitor();

    const timerId = window.setInterval(() => {
      void refreshMonitorFeed(false);
    }, MONITOR_SCAN_INTERVAL_MS);

    return () => {
      isDisposed = true;
      window.clearInterval(timerId);
    };
  }, [enabled, loadMonitorConfig, refreshMonitorFeed]);

  return {
    monitorConfig,
    monitorFeed,
    isRefreshingMonitorFeed,
    isSavingMonitorConfig,
    monitorError,
    refreshMonitorFeed,
    patchMonitorConfig,
  };
};
