import { existsSync } from "node:fs";
import { join } from "node:path";

import { TENTACLE_WORKTREE_BRANCH_PREFIX, TENTACLE_WORKTREE_RELATIVE_PATH } from "./constants";
import { toErrorMessage } from "./systemClients";
import type { GitClient, PersistedTerminal } from "./types";
import { RuntimeInputError } from "./types";

type CreateWorktreeManagerOptions = {
  workspaceCwd: string;
  gitClient: GitClient;
  terminals: Map<string, PersistedTerminal>;
};

type RemoveTentacleWorktreeOptions = {
  bestEffort?: boolean;
};

/** Resolve the effective worktree identifier for a terminal. */
const getEffectiveWorktreeId = (terminal: PersistedTerminal): string =>
  terminal.worktreeId ?? terminal.tentacleId;

/** Find any terminal whose effective worktree identifier matches. */
const findTerminalForWorktree = (
  terminals: Map<string, PersistedTerminal>,
  worktreeIdentifier: string,
): PersistedTerminal | undefined => {
  for (const terminal of terminals.values()) {
    if (getEffectiveWorktreeId(terminal) === worktreeIdentifier) {
      return terminal;
    }
  }
  return undefined;
};

export const createWorktreeManager = ({
  workspaceCwd,
  gitClient,
  terminals,
}: CreateWorktreeManagerOptions) => {
  const getTentacleWorktreePath = (tentacleId: string) =>
    join(workspaceCwd, TENTACLE_WORKTREE_RELATIVE_PATH, tentacleId);
  const getTentacleBranchName = (tentacleId: string) =>
    `${TENTACLE_WORKTREE_BRANCH_PREFIX}${tentacleId}`;

  const getTentacleWorkspaceCwd = (worktreeIdentifier: string) => {
    const terminal = findTerminalForWorktree(terminals, worktreeIdentifier);
    if (!terminal) {
      throw new Error(`No terminal found for worktree: ${worktreeIdentifier}`);
    }

    if (terminal.workspaceMode === "worktree") {
      return getTentacleWorktreePath(worktreeIdentifier);
    }

    return workspaceCwd;
  };

  const assertWorktreeCreationSupported = () => {
    gitClient.assertAvailable();
    if (!gitClient.isRepository(workspaceCwd)) {
      throw new RuntimeInputError(
        "Worktree terminals require a git repository at the workspace root.",
      );
    }
  };

  const createTentacleWorktree = (tentacleId: string, baseRef = "HEAD") => {
    assertWorktreeCreationSupported();
    const worktreePath = getTentacleWorktreePath(tentacleId);
    if (existsSync(worktreePath)) {
      throw new RuntimeInputError(`Worktree path already exists: ${worktreePath}`);
    }

    try {
      gitClient.addWorktree({
        cwd: workspaceCwd,
        path: worktreePath,
        branchName: `${TENTACLE_WORKTREE_BRANCH_PREFIX}${tentacleId}`,
        baseRef,
      });
    } catch (error) {
      throw new Error(`Unable to create worktree for ${tentacleId}: ${toErrorMessage(error)}`);
    }
  };

  const hasTentacleWorktree = (tentacleId: string): boolean =>
    existsSync(getTentacleWorktreePath(tentacleId));

  const removeTentacleWorktree = (
    tentacleId: string,
    options: RemoveTentacleWorktreeOptions = {},
  ) => {
    const { bestEffort = false } = options;
    const worktreePath = getTentacleWorktreePath(tentacleId);
    const branchName = getTentacleBranchName(tentacleId);

    if (existsSync(worktreePath)) {
      try {
        gitClient.removeWorktree({
          cwd: workspaceCwd,
          path: worktreePath,
        });
      } catch (error) {
        if (bestEffort) {
          return;
        }
        throw new RuntimeInputError(
          `Unable to remove worktree for ${tentacleId}: ${toErrorMessage(error)}`,
        );
      }
    }

    try {
      gitClient.removeBranch({
        cwd: workspaceCwd,
        branchName,
      });
    } catch (error) {
      if (bestEffort) {
        return;
      }
      throw new RuntimeInputError(
        `Unable to remove branch for ${tentacleId}: ${toErrorMessage(error)}`,
      );
    }
  };

  return {
    getTentacleWorkspaceCwd,
    // Exposed so callers can resolve a worktree path before the terminal is
    // registered; getTentacleWorkspaceCwd needs the registry and throws until then.
    getTentacleWorktreePath,
    createTentacleWorktree,
    hasTentacleWorktree,
    removeTentacleWorktree,
  };
};
