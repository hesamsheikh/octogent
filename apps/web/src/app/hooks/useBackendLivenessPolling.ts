import { useEffect, useState } from "react";

import { apiClient } from "../../runtime/apiClient";
import { buildTerminalSnapshotsUrl } from "../../runtime/runtimeEndpoints";
import { BACKEND_LIVENESS_SCAN_INTERVAL_MS } from "../constants";

type BackendLivenessStatus = "live" | "offline";

export const useBackendLivenessPolling = (): BackendLivenessStatus => {
  const [status, setStatus] = useState<BackendLivenessStatus>("offline");

  useEffect(() => {
    let isDisposed = false;
    let isInFlight = false;

    const refreshLiveness = async () => {
      if (isDisposed || isInFlight) {
        return;
      }

      isInFlight = true;
      try {
        await apiClient.get(buildTerminalSnapshotsUrl());
        if (!isDisposed) {
          setStatus("live");
        }
      } catch {
        if (!isDisposed) {
          setStatus("offline");
        }
      } finally {
        isInFlight = false;
      }
    };

    void refreshLiveness();
    const timerId = window.setInterval(() => {
      void refreshLiveness();
    }, BACKEND_LIVENESS_SCAN_INTERVAL_MS);

    return () => {
      isDisposed = true;
      window.clearInterval(timerId);
    };
  }, []);

  return status;
};
