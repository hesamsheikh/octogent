import type { ReactNode } from "react";

import { useT } from "../../app/providers/LocaleProvider";
import { ActionButton } from "./ActionButton";

type ConfirmationDialogProps = {
  title: string;
  ariaLabel: string;
  message: ReactNode;
  warning: string;
  confirmLabel: string;
  isConfirmDisabled: boolean;
  isBusy: boolean;
  cancelAriaLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
  children?: ReactNode;
};

export const ConfirmationDialog = ({
  title,
  ariaLabel,
  message,
  warning,
  confirmLabel,
  isConfirmDisabled,
  isBusy,
  cancelAriaLabel,
  onCancel,
  onConfirm,
  children,
}: ConfirmationDialogProps) => {
  const t = useT();

  return (
    <section
      aria-label={ariaLabel}
      className="delete-confirm-dialog"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || isBusy) return;
        event.preventDefault();
        onCancel();
      }}
      tabIndex={-1}
    >
      <header className="delete-confirm-header">
        <h2>{title}</h2>
        <div className="delete-confirm-header-actions">
          <span className="pill blocked">{t("web.dialog.delete.destructive")}</span>
          <ActionButton
            aria-label={t("common.close")}
            className="delete-confirm-close"
            disabled={isBusy}
            onClick={onCancel}
            size="dense"
            variant="accent"
          >
            {t("common.close")}
          </ActionButton>
        </div>
      </header>
      <div className="delete-confirm-body">
        <p className="delete-confirm-message">{message}</p>
        <p className="delete-confirm-warning">{warning}</p>
        {children}
      </div>
      <div className="delete-confirm-actions">
        <ActionButton
          aria-label={cancelAriaLabel ?? t("common.cancel")}
          className="delete-confirm-cancel"
          disabled={isBusy}
          onClick={onCancel}
          size="dense"
          variant="accent"
        >
          {t("common.cancel")}
        </ActionButton>
        <ActionButton
          aria-label={t("common.confirm")}
          className="delete-confirm-submit"
          disabled={isConfirmDisabled}
          onClick={onConfirm}
          size="dense"
          variant="danger"
        >
          {confirmLabel}
        </ActionButton>
      </div>
    </section>
  );
};
