import type { WorkspaceSetupSnapshot, WorkspaceSetupStepId } from "@octogent/core";
import { useCallback, useEffect, useState } from "react";

import { apiClient } from "../../runtime/apiClient";
import { buildWorkspaceSetupStepUrl, buildWorkspaceSetupUrl } from "../../runtime/runtimeEndpoints";

type UseWorkspaceSetupResult = {
  workspaceSetup: WorkspaceSetupSnapshot | null;
  isWorkspaceSetupLoading: boolean;
  workspaceSetupError: string | null;
  refreshWorkspaceSetup: () => Promise<WorkspaceSetupSnapshot | null>;
  runWorkspaceSetupStep: (stepId: WorkspaceSetupStepId) => Promise<WorkspaceSetupSnapshot | null>;
};

export const useWorkspaceSetup = (): UseWorkspaceSetupResult => {
  const [workspaceSetup, setWorkspaceSetup] = useState<WorkspaceSetupSnapshot | null>(null);
  const [isWorkspaceSetupLoading, setIsWorkspaceSetupLoading] = useState(true);
  const [workspaceSetupError, setWorkspaceSetupError] = useState<string | null>(null);

  const refreshWorkspaceSetup = useCallback(async () => {
    try {
      setWorkspaceSetupError(null);
      const payload = await apiClient.get<WorkspaceSetupSnapshot>(buildWorkspaceSetupUrl());
      setWorkspaceSetup(payload);
      return payload;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load workspace setup.";
      setWorkspaceSetupError(message);
      return null;
    } finally {
      setIsWorkspaceSetupLoading(false);
    }
  }, []);

  const runWorkspaceSetupStep = useCallback(async (stepId: WorkspaceSetupStepId) => {
    try {
      setWorkspaceSetupError(null);
      const payload = await apiClient.post<WorkspaceSetupSnapshot>(
        buildWorkspaceSetupStepUrl(stepId),
      );
      setWorkspaceSetup(payload);
      return payload;
    } catch (error) {
      const message = error instanceof Error ? error.message : `Unable to run ${stepId}.`;
      setWorkspaceSetupError(message);
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshWorkspaceSetup();
  }, [refreshWorkspaceSetup]);

  return {
    workspaceSetup,
    isWorkspaceSetupLoading,
    workspaceSetupError,
    refreshWorkspaceSetup,
    runWorkspaceSetupStep,
  };
};
