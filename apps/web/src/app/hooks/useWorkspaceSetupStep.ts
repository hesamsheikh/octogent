import type { WorkspaceSetupSnapshot, WorkspaceSetupStepId } from "@octogent/core";
import { useCallback, useState } from "react";

export const useWorkspaceSetupStep = ({
  runWorkspaceSetupStep,
}: {
  runWorkspaceSetupStep: (stepId: WorkspaceSetupStepId) => Promise<WorkspaceSetupSnapshot | null>;
}) => {
  const [runningWorkspaceSetupStepId, setRunningWorkspaceSetupStepId] =
    useState<WorkspaceSetupStepId | null>(null);

  const handleRunWorkspaceSetupStep = useCallback(
    async (stepId: WorkspaceSetupStepId) => {
      setRunningWorkspaceSetupStepId(stepId);
      try {
        await runWorkspaceSetupStep(stepId);
      } finally {
        setRunningWorkspaceSetupStepId(null);
      }
    },
    [runWorkspaceSetupStep],
  );

  return { runningWorkspaceSetupStepId, handleRunWorkspaceSetupStep };
};
