import { useEffect, useState } from "react";

import type { PendingDeleteTerminal } from "../app/hooks/useTerminalMutations";
import { useT } from "../app/providers/LocaleProvider";
import { ConfirmationDialog } from "./ui/ConfirmationDialog";

type DeleteTentacleDialogProps = {
  pendingDeleteTerminal: PendingDeleteTerminal;
  isDeletingTerminalId: string | null;
  onCancel: () => void;
  onConfirmDelete: () => void;
};

export const DeleteTentacleDialog = ({
  pendingDeleteTerminal,
  isDeletingTerminalId,
  onCancel,
  onConfirmDelete,
}: DeleteTentacleDialogProps) => {
  const t = useT();
  const [cleanupConfirmationInput, setCleanupConfirmationInput] = useState("");
  const isCleanupIntent =
    pendingDeleteTerminal.intent === "cleanup-worktree" &&
    pendingDeleteTerminal.workspaceMode === "worktree";
  const isCloseIntent = pendingDeleteTerminal.intent === "close-terminal";
  const isCleanupConfirmationValid =
    !isCleanupIntent || cleanupConfirmationInput.trim() === pendingDeleteTerminal.terminalId;
  const isDeleting = isDeletingTerminalId !== null;
  const isThisDeleting = isDeletingTerminalId === pendingDeleteTerminal.terminalId;
  const dialogResetKey = `${pendingDeleteTerminal.terminalId}:${pendingDeleteTerminal.intent}`;

  useEffect(() => {
    void dialogResetKey;
    setCleanupConfirmationInput("");
  }, [dialogResetKey]);

  return (
    <ConfirmationDialog
      title={
        isCleanupIntent
          ? t("web.dialog.delete.cleanupTitle")
          : isCloseIntent
            ? t("web.dialog.delete.closeTitle")
            : t("web.dialog.delete.deleteTitle")
      }
      ariaLabel={`${isCloseIntent ? t("common.close") : t("common.delete")} confirmation for ${pendingDeleteTerminal.terminalId}`}
      message={
        isCleanupIntent ? (
          <>{t("web.dialog.delete.cleanupMessage", { name: pendingDeleteTerminal.tentacleName })}</>
        ) : isCloseIntent ? (
          <>{t("web.dialog.delete.closeMessage", { name: pendingDeleteTerminal.tentacleName })}</>
        ) : (
          <>{t("web.dialog.delete.deleteMessage", { name: pendingDeleteTerminal.tentacleName })}</>
        )
      }
      warning={
        isCleanupIntent
          ? t("web.dialog.delete.cleanupWarning")
          : isCloseIntent
            ? t("web.dialog.delete.closeWarning")
            : t("web.dialog.clearConversations.warning")
      }
      confirmLabel={
        isThisDeleting
          ? t("web.dialog.delete.closing")
          : isCleanupIntent
            ? "Cleanup"
            : isCloseIntent
              ? t("common.close")
              : t("common.delete")
      }
      isConfirmDisabled={isDeleting || !isCleanupConfirmationValid}
      isBusy={isDeleting}
      cancelAriaLabel={t("common.cancel")}
      onCancel={onCancel}
      onConfirm={onConfirmDelete}
    >
      <dl className="delete-confirm-details">
        <div>
          <dt>{t("common.name")}</dt>
          <dd>{pendingDeleteTerminal.tentacleName}</dd>
        </div>
        <div>
          <dt>{t("common.id")}</dt>
          <dd>{pendingDeleteTerminal.terminalId}</dd>
        </div>
        <div>
          <dt>{t("web.dialog.delete.mode")}</dt>
          <dd>{pendingDeleteTerminal.workspaceMode === "worktree" ? "worktree" : "shared"}</dd>
        </div>
      </dl>
      {isCleanupIntent && (
        <div className="delete-confirm-typed-check">
          <label htmlFor="cleanup-confirm-id-input">{t("web.dialog.delete.typeToConfirm")}</label>
          <input
            aria-label={t("web.dialog.delete.typeToConfirm")}
            id="cleanup-confirm-id-input"
            onChange={(event) => setCleanupConfirmationInput(event.target.value)}
            type="text"
            value={cleanupConfirmationInput}
          />
        </div>
      )}
    </ConfirmationDialog>
  );
};
