import { useMemo } from "react";

import { useT } from "../app/providers/LocaleProvider";

import type { PromptLibraryEntry } from "../app/types";

type SidebarPromptsListProps = {
  prompts: PromptLibraryEntry[];
  selectedPromptName: string | null;
  isLoadingPrompts: boolean;
  onSelectPrompt: (name: string) => void;
  onRefresh: () => void;
  onNewPrompt: () => void;
  activeTerminalId: string | null;
  onRestoreTerminal: () => void;
  onCloseTerminal: () => void;
};

export const SidebarPromptsList = ({
  prompts,
  selectedPromptName,
  isLoadingPrompts,
  onSelectPrompt,
  onRefresh,
  onNewPrompt,
  activeTerminalId,
  onRestoreTerminal,
  onCloseTerminal,
}: SidebarPromptsListProps) => {
  const t = useT();
  const userPrompts = useMemo(() => prompts.filter((p) => p.source === "user"), [prompts]);
  const builtinPrompts = useMemo(() => prompts.filter((p) => p.source === "builtin"), [prompts]);

  return (
    <div className="sidebar-prompts">
      <div className="sidebar-prompts-toolbar">
        <button type="button" className="sidebar-prompts-new-btn" onClick={onNewPrompt}>
          {t("web.prompts.new")}
        </button>
        <button
          type="button"
          className="sidebar-prompts-refresh-btn"
          onClick={onRefresh}
          disabled={isLoadingPrompts}
          aria-label={t("web.a11y.refreshPrompts")}
        >
          ↻
        </button>
      </div>

      {isLoadingPrompts && prompts.length === 0 ? (
        <p className="sidebar-prompts-empty">{t("web.prompts.loadingPrompts")}</p>
      ) : prompts.length === 0 ? (
        <p className="sidebar-prompts-empty">{t("web.prompts.noPrompts")}</p>
      ) : (
        <div className="sidebar-prompts-list">
          {userPrompts.length > 0 && (
            <div className="sidebar-prompts-group">
              <h4 className="sidebar-prompts-group-label">{t("web.prompts.myPrompts")}</h4>
              {userPrompts.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  className="sidebar-prompts-item"
                  data-active={selectedPromptName === p.name ? "true" : undefined}
                  onClick={() => {
                    onSelectPrompt(p.name);
                  }}
                >
                  {p.name}.md
                </button>
              ))}
            </div>
          )}

          {builtinPrompts.length > 0 && (
            <div className="sidebar-prompts-group">
              <h4 className="sidebar-prompts-group-label">{t("web.prompts.builtin")}</h4>
              {builtinPrompts.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  className="sidebar-prompts-item"
                  data-active={selectedPromptName === p.name ? "true" : undefined}
                  onClick={() => {
                    onSelectPrompt(p.name);
                  }}
                >
                  {p.name}.md
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTerminalId && (
        <div className="sidebar-prompts-minimized-terminal">
          <button
            type="button"
            className="sidebar-prompts-minimized-terminal-restore"
            onClick={onRestoreTerminal}
          >
            <span className="sidebar-prompts-minimized-terminal-icon">{">_"}</span>
            <span className="sidebar-prompts-minimized-terminal-label">
              {t("web.prompts.engineer")}
            </span>
          </button>
          <button
            type="button"
            className="sidebar-prompts-minimized-terminal-close"
            onClick={onCloseTerminal}
            aria-label={t("web.a11y.closeTerminal")}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
};
