import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";

import { useT } from "../app/providers/LocaleProvider";
import type { TentacleGitStatusSnapshot, TentaclePullRequestSnapshot } from "../app/types";
import { ActionButton } from "./ui/ActionButton";

type TentacleGitActionsDialogProps = {
  tentacleId: string;
  tentacleName: string;
  gitStatus: TentacleGitStatusSnapshot | null;
  gitPullRequest: TentaclePullRequestSnapshot | null;
  gitCommitMessage: string;
  isLoading: boolean;
  isMutating: boolean;
  errorMessage: string | null;
  onCommitMessageChange: (value: string) => void;
  onClose: () => void;
  onCommit: () => void;
  onCommitAndPush: () => void;
  onPush: () => void;
  onSync: () => void;
  onMergePullRequest: () => void;
  onCleanupWorktree: () => void;
};

export const TentacleGitActionsDialog = ({
  tentacleId,
  tentacleName,
  gitStatus,
  gitPullRequest,
  gitCommitMessage,
  isLoading,
  isMutating,
  errorMessage,
  onCommitMessageChange,
  onClose,
  onCommit,
  onCommitAndPush,
  onPush,
  onSync,
  onMergePullRequest,
  onCleanupWorktree,
}: TentacleGitActionsDialogProps) => {
  const t = useT();
  const [isCommitMenuOpen, setIsCommitMenuOpen] = useState(false);

  useEffect(() => {
    if (isLoading || isMutating) {
      setIsCommitMenuOpen(false);
    }
  }, [isLoading, isMutating]);

  const globalDisabledReason = isLoading
    ? t("web.git.loading")
    : isMutating
      ? t("web.git.actionRunning")
      : null;

  const commitDisabledReason =
    globalDisabledReason ??
    (gitCommitMessage.trim().length === 0 ? t("web.git.commitBlocked") : null);
  const commitAndPushDisabledReason = commitDisabledReason;

  const pushDisabledReason =
    globalDisabledReason ?? ((gitStatus?.aheadCount ?? 0) <= 0 ? t("web.git.pushBlocked") : null);

  const syncDisabledReason =
    globalDisabledReason ?? (gitStatus?.isDirty ? t("web.git.syncBlocked") : null);

  const hasOpenPullRequest = gitPullRequest?.status === "open";
  const canMergePullRequest =
    hasOpenPullRequest &&
    gitPullRequest?.isDraft !== true &&
    gitPullRequest?.mergeable !== "CONFLICTING";
  const mergePullRequestDisabledReason =
    globalDisabledReason ??
    (!hasOpenPullRequest
      ? t("web.git.mergeBlocked")
      : gitPullRequest?.isDraft === true
        ? t("web.git.mergeBlockedDraft")
        : gitPullRequest?.mergeable === "CONFLICTING"
          ? t("web.git.mergeBlockedConflicts")
          : canMergePullRequest
            ? null
            : t("web.git.mergeBlockedNotMergeable"));

  const cleanupDisabledReason = globalDisabledReason;

  return (
    <section
      aria-label={`Git actions for ${tentacleId}`}
      className="git-actions-dialog"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          if (isCommitMenuOpen) {
            event.preventDefault();
            setIsCommitMenuOpen(false);
            return;
          }
          if (!isMutating) {
            event.preventDefault();
            onClose();
          }
        }
      }}
      tabIndex={-1}
    >
      <header className="git-actions-header">
        <h2>{t("web.git.title")}</h2>
        <div className="git-actions-header-actions">
          <span className="pill git-actions-worktree-badge">{t("web.git.worktreeBadge")}</span>
          <ActionButton
            aria-label={t("web.a11y.closeSidebarActionPanel")}
            className="git-actions-close"
            disabled={isMutating}
            onClick={onClose}
            size="dense"
            variant="accent"
          >
            {t("common.close")}
          </ActionButton>
        </div>
      </header>
      <div className="git-actions-body">
        <p className="git-actions-message">
          {t("web.git.manageLifecycle", { name: tentacleName, id: tentacleId })}
        </p>
        {isLoading ? (
          <p className="git-actions-loading">{t("web.git.loadingStatus")}</p>
        ) : gitStatus ? (
          <dl className="git-actions-status">
            <div>
              <dt>{t("web.git.branch")}</dt>
              <dd>{gitStatus.branchName}</dd>
            </div>
            <div>
              <dt>{t("web.git.upstream")}</dt>
              <dd>{gitStatus.upstreamBranchName ?? t("web.git.status.notSet")}</dd>
            </div>
            <div>
              <dt>{t("web.git.state")}</dt>
              <dd>{gitStatus.isDirty ? t("web.git.status.dirty") : t("web.git.status.clean")}</dd>
            </div>
            <div>
              <dt>{t("web.git.sync")}</dt>
              <dd className="git-actions-sync-metric">
                <span className="git-actions-ahead-count">{gitStatus.aheadCount}</span>
                <span className="git-actions-metric-separator">/</span>
                <span className="git-actions-behind-count">{gitStatus.behindCount}</span>
              </dd>
            </div>
            <div>
              <dt>{t("web.git.lineDiff")}</dt>
              <dd className="git-actions-line-diff-metric">
                <span className="git-actions-insertions-count">+{gitStatus.insertedLineCount}</span>
                <span className="git-actions-metric-separator">/</span>
                <span className="git-actions-deletions-count">-{gitStatus.deletedLineCount}</span>
              </dd>
            </div>
          </dl>
        ) : (
          <p className="git-actions-loading">{t("web.git.noStatus")}</p>
        )}

        <section
          className="git-actions-commit-panel"
          aria-label={t("web.a11y.sourceControlComposer")}
        >
          <label className="git-actions-commit-label" htmlFor="git-actions-commit-input">
            {t("web.git.section.message")}
          </label>
          <textarea
            aria-label={`Commit message for ${tentacleId}`}
            className="git-actions-message-input"
            id="git-actions-commit-input"
            onChange={(event) => {
              onCommitMessageChange(event.target.value);
            }}
            placeholder="feat: something"
            rows={3}
            value={gitCommitMessage}
          />
          <div className="git-actions-commit-controls">
            <ActionButton
              aria-label={t("web.a11y.commitChanges")}
              className="git-actions-commit-main"
              disabled={Boolean(commitDisabledReason)}
              onClick={onCommit}
              size="dense"
              variant="accent"
            >
              {isMutating ? t("web.git.running") : t("web.git.commit")}
            </ActionButton>
            <button
              aria-expanded={isCommitMenuOpen}
              aria-haspopup="menu"
              aria-label={t("web.a11y.openCommitOptions")}
              className="git-actions-commit-toggle"
              disabled={Boolean(globalDisabledReason)}
              onClick={() => {
                setIsCommitMenuOpen((current) => !current);
              }}
              type="button"
            >
              <ChevronDown size={14} />
            </button>
          </div>
          {isCommitMenuOpen && (
            <div className="git-actions-commit-menu" role="menu">
              <button
                className="git-actions-commit-menu-item"
                disabled={Boolean(commitDisabledReason)}
                onClick={() => {
                  setIsCommitMenuOpen(false);
                  onCommit();
                }}
                role="menuitem"
                type="button"
              >
                {t("web.git.commit")}
              </button>
              <button
                className="git-actions-commit-menu-item"
                disabled={Boolean(commitAndPushDisabledReason)}
                onClick={() => {
                  setIsCommitMenuOpen(false);
                  onCommitAndPush();
                }}
                role="menuitem"
                type="button"
              >
                {t("web.git.commitPush")}
              </button>
              <button
                className="git-actions-commit-menu-item"
                disabled={Boolean(pushDisabledReason)}
                onClick={() => {
                  setIsCommitMenuOpen(false);
                  onPush();
                }}
                role="menuitem"
                type="button"
              >
                {t("web.git.push")}
              </button>
              <button
                className="git-actions-commit-menu-item"
                disabled={Boolean(syncDisabledReason)}
                onClick={() => {
                  setIsCommitMenuOpen(false);
                  onSync();
                }}
                role="menuitem"
                type="button"
              >
                {t("web.git.syncBase")}
              </button>
            </div>
          )}
          {commitDisabledReason && <p className="git-action-reason">{commitDisabledReason}</p>}
          {pushDisabledReason && <p className="git-action-hint">{pushDisabledReason}</p>}
          {syncDisabledReason ? (
            <p className="git-action-hint">{syncDisabledReason}</p>
          ) : (
            <p className="git-action-hint">{t("web.git.syncReady")}</p>
          )}
        </section>

        <section className="git-actions-pr-section" aria-label={t("web.a11y.pullRequestWorkflow")}>
          <div className="git-actions-pr-header">
            <h3>{t("web.git.section.pr")}</h3>
            <p className="git-actions-pr-status">
              {t("web.git.section.status")} {gitPullRequest?.status ?? "none"}
              {gitPullRequest?.number ? ` · #${gitPullRequest.number}` : ""}
            </p>
          </div>
          <p className="git-action-hint">{t("web.git.prCreateHint")}</p>
          <div className="git-actions-pr-buttons">
            <ActionButton
              aria-label={t("web.git.mergePr")}
              className="git-actions-merge-pr"
              disabled={Boolean(mergePullRequestDisabledReason)}
              onClick={onMergePullRequest}
              size="dense"
              variant="info"
            >
              {t("web.git.mergePr")}
            </ActionButton>
            <ActionButton
              aria-label={t("web.git.openOnGithub")}
              className="git-actions-open-pr"
              disabled={!gitPullRequest?.url}
              onClick={() => {
                if (!gitPullRequest?.url) {
                  return;
                }
                globalThis.open?.(gitPullRequest.url, "_blank", "noopener,noreferrer");
              }}
              size="dense"
              variant="accent"
            >
              {t("web.git.openOnGithub")}
            </ActionButton>
          </div>
          {mergePullRequestDisabledReason && (
            <p className="git-action-reason">{mergePullRequestDisabledReason}</p>
          )}
          {!gitPullRequest?.url && <p className="git-action-hint">{t("web.git.noPrUrl")}</p>}
        </section>

        <div className="git-action-row git-action-row--cleanup">
          <div className="git-action-content">
            <p className="git-action-title">{t("web.git.cleanupWorktree")}</p>
            <p className="git-action-hint">{t("web.git.cleanupDesc")}</p>
            {cleanupDisabledReason && <p className="git-action-reason">{cleanupDisabledReason}</p>}
          </div>
          <ActionButton
            aria-label={t("web.git.cleanupWorktree")}
            className="git-actions-cleanup"
            disabled={Boolean(cleanupDisabledReason)}
            onClick={onCleanupWorktree}
            size="dense"
            variant="danger"
          >
            {t("web.git.cleanupWorktree")}
          </ActionButton>
        </div>

        {errorMessage && <p className="git-actions-error">{errorMessage}</p>}
      </div>
    </section>
  );
};
