import { useCallback, useMemo, useState } from "react";

import type { GraphNode } from "../../app/canvas/types";
import { useT } from "../../app/providers/LocaleProvider";
import type { TerminalView } from "../../app/types";
import { ActionButton } from "../ui/ActionButton";

type DeleteAllTerminalsDialogProps = {
  columns: TerminalView;
  nodes: GraphNode[];
  onCancel: () => void;
  onDeleted: (result: { hadFailures: boolean }) => void;
};

const readDeleteFailureMessage = async (response: Response, fallback: string) => {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.trim().length > 0) {
      return payload.error;
    }
  } catch {
    // Ignore malformed error payloads and fall back to the status line.
  }

  return fallback;
};

export const DeleteAllTerminalsDialog = ({
  columns,
  nodes,
  onCancel,
  onDeleted,
}: DeleteAllTerminalsDialogProps) => {
  const t = useT();
  const [inactiveOnly, setInactiveOnly] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failureMessages, setFailureMessages] = useState<string[]>([]);

  const inactiveTerminals = useMemo(() => columns.filter((t) => !t.hasUserPrompt), [columns]);

  const inactiveSessionIds = useMemo(
    () =>
      nodes.flatMap((node) =>
        node.type === "inactive-session" && node.sessionId ? [node.sessionId] : [],
      ),
    [nodes],
  );

  const activeTargets = inactiveOnly ? inactiveTerminals : columns;
  const totalTargetCount = activeTargets.length + inactiveSessionIds.length;

  const handleConfirm = useCallback(async () => {
    if (totalTargetCount === 0) return;
    setFailureMessages([]);
    setIsDeleting(true);
    setProgress({ done: 0, total: totalTargetCount });

    let done = 0;
    const failures: string[] = [];

    for (const terminal of activeTargets) {
      try {
        const response = await fetch(`/api/terminals/${encodeURIComponent(terminal.terminalId)}`, {
          method: "DELETE",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          failures.push(
            `${terminal.tentacleName || terminal.label || terminal.terminalId}: ${await readDeleteFailureMessage(
              response,
              `Delete failed (${response.status})`,
            )}`,
          );
        }
      } catch (error) {
        failures.push(
          `${terminal.tentacleName || terminal.label || terminal.terminalId}: ${
            error instanceof Error ? error.message : "Delete failed."
          }`,
        );
      }
      done += 1;
      setProgress({ done, total: totalTargetCount });
    }

    for (const sessionId of inactiveSessionIds) {
      try {
        const response = await fetch(`/api/conversations/${encodeURIComponent(sessionId)}`, {
          method: "DELETE",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          failures.push(
            `Conversation ${sessionId}: ${await readDeleteFailureMessage(
              response,
              `Delete failed (${response.status})`,
            )}`,
          );
        }
      } catch (error) {
        failures.push(
          `Conversation ${sessionId}: ${error instanceof Error ? error.message : "Delete failed."}`,
        );
      }
      done += 1;
      setProgress({ done, total: totalTargetCount });
    }

    setIsDeleting(false);
    setProgress(null);
    setFailureMessages(failures);
    onDeleted({ hadFailures: failures.length > 0 });
  }, [activeTargets, inactiveSessionIds, totalTargetCount, onDeleted]);

  return (
    <section
      aria-label={t("web.a11y.deleteAllTerminals")}
      className="delete-confirm-dialog"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || isDeleting) return;
        event.preventDefault();
        onCancel();
      }}
      tabIndex={-1}
    >
      <header className="delete-confirm-header">
        <h2>{t("web.dialog.deleteAll.title")}</h2>
        <div className="delete-confirm-header-actions">
          <span className="pill blocked">{t("web.dialog.delete.destructive")}</span>
          <ActionButton
            aria-label={t("web.a11y.closeConfirmation")}
            className="delete-confirm-close"
            disabled={isDeleting}
            onClick={onCancel}
            size="dense"
            variant="accent"
          >
            {t("common.close")}
          </ActionButton>
        </div>
      </header>
      <div className="delete-confirm-body">
        <p className="delete-confirm-message">
          {t("web.dialog.deleteAll.deleteCount", { count: totalTargetCount })}{" "}
          <strong>
            {totalTargetCount}{" "}
            {totalTargetCount === 1
              ? t("web.dialog.deleteAll.session")
              : t("web.dialog.deleteAll.sessions")}
          </strong>
          {inactiveOnly
            ? t("web.dialog.deleteAll.inactiveMode")
            : t("web.dialog.deleteAll.allMode")}
          .
        </p>
        <p className="delete-confirm-message">{t("web.dialog.deleteAll.worktreeMessage")}</p>
        {failureMessages.length > 0 && (
          <p className="delete-confirm-message" role="alert">
            {t("web.dialog.deleteAll.failedItems", {
              count: failureMessages.length,
              items:
                failureMessages.length === 1
                  ? t("web.dialog.deleteAll.item")
                  : t("web.dialog.deleteAll.items"),
              messages: failureMessages.slice(0, 3).join("; "),
            })}
          </p>
        )}
        <div className="delete-all-mode-row">
          <span className="delete-all-mode-label">
            {inactiveOnly
              ? t("web.dialog.deleteAll.inactiveOnly")
              : t("web.dialog.deleteAll.allTerminals")}
          </span>
          <button
            type="button"
            className="delete-all-toggle-switch"
            role="switch"
            aria-checked={!inactiveOnly}
            aria-label={t("web.a11y.toggleInactiveAllTerminals")}
            disabled={isDeleting}
            onClick={() => setInactiveOnly((prev) => !prev)}
          >
            <span className="delete-all-toggle-thumb" />
          </button>
        </div>
        <dl className="delete-confirm-details delete-all-details">
          <div>
            <dt>{t("web.dialog.deleteAll.inactive")}</dt>
            <dd>{inactiveTerminals.length}</dd>
          </div>
          <div>
            <dt>{t("web.dialog.deleteAll.pastSessions")}</dt>
            <dd>{inactiveSessionIds.length}</dd>
          </div>
          <div>
            <dt>{t("web.dialog.deleteAll.total")}</dt>
            <dd>{columns.length}</dd>
          </div>
        </dl>
        {progress && (
          <div className="delete-all-progress">
            {t("web.dialog.deleteAll.progress", { current: progress.done, total: progress.total })}
          </div>
        )}
      </div>
      <div className="delete-confirm-actions">
        <ActionButton
          aria-label={t("web.a11y.cancelDeleteAll")}
          className="delete-confirm-cancel"
          disabled={isDeleting}
          onClick={onCancel}
          size="dense"
          variant="accent"
        >
          {t("common.cancel")}
        </ActionButton>
        <ActionButton
          aria-label={t("web.a11y.confirmDeleteAllTerminals")}
          className="delete-confirm-submit"
          disabled={isDeleting || totalTargetCount === 0}
          onClick={() => void handleConfirm()}
          size="dense"
          variant="danger"
        >
          {isDeleting
            ? t("web.dialog.deleteAll.progress", {
                current: progress?.done ?? 0,
                total: progress?.total ?? 0,
              })
            : t("web.dialog.deleteAll.deleteCount", { count: totalTargetCount })}
        </ActionButton>
      </div>
    </section>
  );
};
