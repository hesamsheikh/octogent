import { useCallback, useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { apiClient } from "../../runtime/apiClient";
import {
  buildTentacleGitCommitUrl,
  buildTentacleGitPullRequestMergeUrl,
  buildTentacleGitPullRequestUrl,
  buildTentacleGitPushUrl,
  buildTentacleGitStatusUrl,
  buildTentacleGitSyncUrl,
} from "../../runtime/runtimeEndpoints";
import type {
  TentacleGitStatusSnapshot,
  TentaclePullRequestSnapshot,
  TerminalView,
} from "../types";

type UseTentacleGitLifecycleOptions = {
  columns: TerminalView;
};

type UseTentacleGitLifecycleResult = {
  gitStatusByTentacleId: Record<string, TentacleGitStatusSnapshot>;
  gitStatusLoadingByTentacleId: Record<string, boolean>;
  pullRequestByTentacleId: Record<string, TentaclePullRequestSnapshot>;
  pullRequestLoadingByTentacleId: Record<string, boolean>;
  openGitTentacleId: string | null;
  openGitTentacleStatus: TentacleGitStatusSnapshot | null;
  openGitTentaclePullRequest: TentaclePullRequestSnapshot | null;
  gitCommitMessageDraft: string;
  gitDialogError: string | null;
  isGitDialogLoading: boolean;
  isGitDialogMutating: boolean;
  setGitCommitMessageDraft: Dispatch<SetStateAction<string>>;
  openTentacleGitActions: (tentacleId: string) => void;
  closeTentacleGitActions: () => void;
  commitTentacleChanges: () => Promise<void>;
  commitAndPushTentacleBranch: () => Promise<void>;
  pushTentacleBranch: () => Promise<void>;
  syncTentacleBranch: () => Promise<void>;
  mergeTentaclePullRequest: () => Promise<void>;
};

const parseTentacleGitStatus = (payload: unknown): TentacleGitStatusSnapshot | null => {
  if (payload === null || payload === undefined || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  if (
    typeof record.tentacleId !== "string" ||
    (record.workspaceMode !== "shared" && record.workspaceMode !== "worktree") ||
    typeof record.branchName !== "string" ||
    (record.upstreamBranchName !== null && typeof record.upstreamBranchName !== "string") ||
    typeof record.isDirty !== "boolean" ||
    typeof record.aheadCount !== "number" ||
    typeof record.behindCount !== "number" ||
    typeof record.hasConflicts !== "boolean" ||
    !Array.isArray(record.changedFiles) ||
    !record.changedFiles.every((file) => typeof file === "string") ||
    (record.defaultBaseBranchName !== null && typeof record.defaultBaseBranchName !== "string")
  ) {
    return null;
  }

  return {
    tentacleId: record.tentacleId,
    workspaceMode: record.workspaceMode,
    branchName: record.branchName,
    upstreamBranchName: record.upstreamBranchName,
    isDirty: record.isDirty,
    aheadCount: record.aheadCount,
    behindCount: record.behindCount,
    insertedLineCount: typeof record.insertedLineCount === "number" ? record.insertedLineCount : 0,
    deletedLineCount: typeof record.deletedLineCount === "number" ? record.deletedLineCount : 0,
    hasConflicts: record.hasConflicts,
    changedFiles: [...record.changedFiles],
    defaultBaseBranchName: record.defaultBaseBranchName,
  };
};

const parseTentaclePullRequest = (payload: unknown): TentaclePullRequestSnapshot | null => {
  if (payload === null || payload === undefined || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  if (
    typeof record.tentacleId !== "string" ||
    (record.workspaceMode !== "shared" && record.workspaceMode !== "worktree") ||
    (record.status !== "none" &&
      record.status !== "open" &&
      record.status !== "merged" &&
      record.status !== "closed") ||
    (record.number !== null && typeof record.number !== "number") ||
    (record.url !== null && typeof record.url !== "string") ||
    (record.title !== null && typeof record.title !== "string") ||
    (record.baseRef !== null && typeof record.baseRef !== "string") ||
    (record.headRef !== null && typeof record.headRef !== "string") ||
    (record.isDraft !== null && typeof record.isDraft !== "boolean") ||
    (record.mergeable !== null &&
      record.mergeable !== "MERGEABLE" &&
      record.mergeable !== "CONFLICTING" &&
      record.mergeable !== "UNKNOWN") ||
    (record.mergeStateStatus !== null && typeof record.mergeStateStatus !== "string")
  ) {
    return null;
  }

  return {
    tentacleId: record.tentacleId,
    workspaceMode: record.workspaceMode,
    status: record.status,
    number: record.number,
    url: record.url,
    title: record.title,
    baseRef: record.baseRef,
    headRef: record.headRef,
    isDraft: record.isDraft,
    mergeable: record.mergeable,
    mergeStateStatus: record.mergeStateStatus,
  };
};

export const useTentacleGitLifecycle = ({
  columns,
}: UseTentacleGitLifecycleOptions): UseTentacleGitLifecycleResult => {
  const [gitStatusByTentacleId, setGitStatusByTentacleId] = useState<
    Record<string, TentacleGitStatusSnapshot>
  >({});
  const [gitStatusLoadingByTentacleId, setGitStatusLoadingByTentacleId] = useState<
    Record<string, boolean>
  >({});
  const [gitStatusAttemptedTentacleIds, setGitStatusAttemptedTentacleIds] = useState<
    Record<string, boolean>
  >({});
  const [pullRequestByTentacleId, setPullRequestByTentacleId] = useState<
    Record<string, TentaclePullRequestSnapshot>
  >({});
  const [pullRequestLoadingByTentacleId, setPullRequestLoadingByTentacleId] = useState<
    Record<string, boolean>
  >({});
  const [pullRequestAttemptedTentacleIds, setPullRequestAttemptedTentacleIds] = useState<
    Record<string, boolean>
  >({});
  const [openGitTentacleId, setOpenGitTentacleId] = useState<string | null>(null);
  const [gitCommitMessageDraft, setGitCommitMessageDraft] = useState("");
  const [gitDialogError, setGitDialogError] = useState<string | null>(null);
  const [isGitDialogMutating, setIsGitDialogMutating] = useState(false);

  const fetchTentacleGitStatus = useCallback(async (tentacleId: string) => {
    setGitStatusLoadingByTentacleId((current) => ({
      ...current,
      [tentacleId]: true,
    }));

    try {
      const raw = await apiClient.get<unknown>(buildTentacleGitStatusUrl(tentacleId));
      const payload = parseTentacleGitStatus(raw);
      if (!payload) {
        throw new Error("Unable to parse git status response.");
      }

      setGitStatusByTentacleId((current) => ({
        ...current,
        [tentacleId]: payload,
      }));
      return payload;
    } finally {
      setGitStatusLoadingByTentacleId((current) => ({
        ...current,
        [tentacleId]: false,
      }));
    }
  }, []);

  const fetchTentaclePullRequest = useCallback(async (tentacleId: string) => {
    setPullRequestLoadingByTentacleId((current) => ({
      ...current,
      [tentacleId]: true,
    }));

    try {
      const raw = await apiClient.get<unknown>(buildTentacleGitPullRequestUrl(tentacleId));
      const payload = parseTentaclePullRequest(raw);
      if (!payload) {
        throw new Error("Unable to parse pull request response.");
      }

      setPullRequestByTentacleId((current) => ({
        ...current,
        [tentacleId]: payload,
      }));
      return payload;
    } finally {
      setPullRequestLoadingByTentacleId((current) => ({
        ...current,
        [tentacleId]: false,
      }));
    }
  }, []);

  const worktreeTentacleIds = useMemo(
    () =>
      columns
        .filter((column) => column.workspaceMode === "worktree")
        .map((column) => column.tentacleId),
    [columns],
  );

  useEffect(() => {
    const activeTentacleIds = new Set(columns.map((column) => column.tentacleId));
    setGitStatusByTentacleId((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([tentacleId]) => activeTentacleIds.has(tentacleId)),
      ),
    );
    setGitStatusLoadingByTentacleId((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([tentacleId]) => activeTentacleIds.has(tentacleId)),
      ),
    );
    setGitStatusAttemptedTentacleIds((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([tentacleId]) => activeTentacleIds.has(tentacleId)),
      ),
    );
    setPullRequestByTentacleId((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([tentacleId]) => activeTentacleIds.has(tentacleId)),
      ),
    );
    setPullRequestLoadingByTentacleId((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([tentacleId]) => activeTentacleIds.has(tentacleId)),
      ),
    );
    setPullRequestAttemptedTentacleIds((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([tentacleId]) => activeTentacleIds.has(tentacleId)),
      ),
    );
    if (openGitTentacleId && !activeTentacleIds.has(openGitTentacleId)) {
      setOpenGitTentacleId(null);
      setGitDialogError(null);
      setGitCommitMessageDraft("");
    }
  }, [columns, openGitTentacleId]);

  useEffect(() => {
    for (const tentacleId of worktreeTentacleIds) {
      if (gitStatusAttemptedTentacleIds[tentacleId]) {
        continue;
      }

      setGitStatusAttemptedTentacleIds((current) => ({
        ...current,
        [tentacleId]: true,
      }));
      void fetchTentacleGitStatus(tentacleId).catch((error: unknown) => {
        console.warn(`[git] Failed to fetch status for tentacle ${tentacleId}:`, error);
      });
    }
  }, [fetchTentacleGitStatus, gitStatusAttemptedTentacleIds, worktreeTentacleIds]);

  useEffect(() => {
    for (const tentacleId of worktreeTentacleIds) {
      if (pullRequestAttemptedTentacleIds[tentacleId]) {
        continue;
      }

      setPullRequestAttemptedTentacleIds((current) => ({
        ...current,
        [tentacleId]: true,
      }));
      void fetchTentaclePullRequest(tentacleId).catch((error: unknown) => {
        console.warn(`[git] Failed to fetch pull request for tentacle ${tentacleId}:`, error);
      });
    }
  }, [fetchTentaclePullRequest, pullRequestAttemptedTentacleIds, worktreeTentacleIds]);

  const openTentacleGitActions = useCallback(
    (tentacleId: string) => {
      setOpenGitTentacleId(tentacleId);
      setGitDialogError(null);
      setGitCommitMessageDraft("");

      void Promise.all([
        fetchTentacleGitStatus(tentacleId),
        fetchTentaclePullRequest(tentacleId),
      ]).catch((error: unknown) => {
        setGitDialogError(
          error instanceof Error ? error.message : "Unable to fetch git lifecycle data.",
        );
      });
    },
    [fetchTentacleGitStatus, fetchTentaclePullRequest],
  );

  const closeTentacleGitActions = useCallback(() => {
    setOpenGitTentacleId(null);
    setGitDialogError(null);
    setGitCommitMessageDraft("");
  }, []);

  const runGitMutation = useCallback(
    async (
      action: "commit" | "push" | "sync",
      body?: unknown,
    ): Promise<TentacleGitStatusSnapshot | null> => {
      if (!openGitTentacleId) {
        return null;
      }

      const endpoint =
        action === "commit"
          ? buildTentacleGitCommitUrl(openGitTentacleId)
          : action === "push"
            ? buildTentacleGitPushUrl(openGitTentacleId)
            : buildTentacleGitSyncUrl(openGitTentacleId);

      setIsGitDialogMutating(true);
      setGitDialogError(null);
      try {
        const raw = await apiClient.post<unknown>(endpoint, body);
        const payload = parseTentacleGitStatus(raw);
        if (!payload) {
          throw new Error("Unable to parse git lifecycle response.");
        }

        setGitStatusByTentacleId((current) => ({
          ...current,
          [openGitTentacleId]: payload,
        }));
        return payload;
      } catch (error) {
        setGitDialogError(
          error instanceof Error ? error.message : `Unable to ${action} tentacle worktree.`,
        );
        return null;
      } finally {
        setIsGitDialogMutating(false);
      }
    },
    [openGitTentacleId],
  );

  const runPullRequestMutation = useCallback(async () => {
    if (!openGitTentacleId) {
      return;
    }

    const endpoint = buildTentacleGitPullRequestMergeUrl(openGitTentacleId);

    setIsGitDialogMutating(true);
    setGitDialogError(null);
    try {
      const raw = await apiClient.post<unknown>(endpoint);
      const payload = parseTentaclePullRequest(raw);
      if (!payload) {
        throw new Error("Unable to parse pull request response.");
      }

      setPullRequestByTentacleId((current) => ({
        ...current,
        [openGitTentacleId]: payload,
      }));
    } catch (error) {
      setGitDialogError(error instanceof Error ? error.message : "Unable to merge pull request.");
    } finally {
      setIsGitDialogMutating(false);
    }
  }, [openGitTentacleId]);

  const commitTentacleChanges = useCallback(async () => {
    const message = gitCommitMessageDraft.trim();
    if (message.length === 0) {
      setGitDialogError("Commit message cannot be empty.");
      return;
    }

    const committed = await runGitMutation("commit", { message });
    if (committed) {
      setGitCommitMessageDraft("");
    }
  }, [gitCommitMessageDraft, runGitMutation]);

  const commitAndPushTentacleBranch = useCallback(async () => {
    const message = gitCommitMessageDraft.trim();
    if (message.length === 0) {
      setGitDialogError("Commit message cannot be empty.");
      return;
    }

    const committed = await runGitMutation("commit", { message });
    if (!committed) {
      return;
    }
    setGitCommitMessageDraft("");
    await runGitMutation("push");
  }, [gitCommitMessageDraft, runGitMutation]);

  const pushTentacleBranch = useCallback(async () => {
    await runGitMutation("push");
  }, [runGitMutation]);

  const syncTentacleBranch = useCallback(async () => {
    await runGitMutation("sync");
  }, [runGitMutation]);

  const mergeTentaclePullRequest = useCallback(async () => {
    await runPullRequestMutation();
  }, [runPullRequestMutation]);

  const openGitTentacleStatus =
    openGitTentacleId !== null ? (gitStatusByTentacleId[openGitTentacleId] ?? null) : null;
  const openGitTentaclePullRequest =
    openGitTentacleId !== null ? (pullRequestByTentacleId[openGitTentacleId] ?? null) : null;
  const isGitDialogLoading =
    openGitTentacleId !== null
      ? (gitStatusLoadingByTentacleId[openGitTentacleId] ?? false) ||
        (pullRequestLoadingByTentacleId[openGitTentacleId] ?? false)
      : false;

  return {
    gitStatusByTentacleId,
    gitStatusLoadingByTentacleId,
    pullRequestByTentacleId,
    pullRequestLoadingByTentacleId,
    openGitTentacleId,
    openGitTentacleStatus,
    openGitTentaclePullRequest,
    gitCommitMessageDraft,
    gitDialogError,
    isGitDialogLoading,
    isGitDialogMutating,
    setGitCommitMessageDraft,
    openTentacleGitActions,
    closeTentacleGitActions,
    commitTentacleChanges,
    commitAndPushTentacleBranch,
    pushTentacleBranch,
    syncTentacleBranch,
    mergeTentaclePullRequest,
  };
};
