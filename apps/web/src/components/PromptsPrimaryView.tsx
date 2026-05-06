import { type ReactNode, useCallback, useEffect, useState } from "react";

import { apiClient } from "../runtime/apiClient";
import { buildTerminalsUrl } from "../runtime/runtimeEndpoints";
import { usePromptLibrary } from "../app/hooks/usePromptLibrary";
import { SidebarPromptsList } from "./SidebarPromptsList";
import { Terminal } from "./Terminal";
import { ActionButton } from "./ui/ActionButton";
import { MarkdownContent } from "./ui/MarkdownContent";

type PromptsPrimaryViewProps = {
  enabled: boolean;
  onSidebarContent?: (content: ReactNode) => void;
};

type NewPromptMode = {
  terminalId: string;
} | null;

export const PromptsPrimaryView = ({ enabled, onSidebarContent }: PromptsPrimaryViewProps) => {
  const {
    prompts,
    selectedPromptName,
    selectedPromptDetail: selectedPrompt,
    isLoadingPrompts,
    isLoadingDetail,
    isEditing,
    editDraft,
    errorMessage,
    refreshPrompts,
    selectPrompt: selectPromptLibraryItem,
    deletePrompt: deletePromptLibraryItem,
    startEditing: onStartEditing,
    cancelEditing: onCancelEditing,
    setEditDraft: onSetEditDraft,
    submitEdit: onSubmitEdit,
  } = usePromptLibrary({ enabled });

  const [promptEngineerTerminalId, setPromptEngineerTerminalId] = useState<string | null>(null);
  const [newPromptRequestCount, setNewPromptRequestCount] = useState(0);
  const [restoreTerminalCount, setRestoreTerminalCount] = useState(0);
  const [closeTerminalCount, setCloseTerminalCount] = useState(0);

  const onDelete = useCallback(() => {
    if (selectedPromptName) {
      return deletePromptLibraryItem(selectedPromptName);
    }
    return Promise.resolve(false);
  }, [selectedPromptName, deletePromptLibraryItem]);

  const onRefresh = refreshPrompts;
  const onTerminalIdChange = setPromptEngineerTerminalId;

  // Push sidebar content
  const sidebarContent = (
    <SidebarPromptsList
      prompts={prompts}
      selectedPromptName={selectedPromptName}
      isLoadingPrompts={isLoadingPrompts}
      onSelectPrompt={selectPromptLibraryItem}
      onRefresh={() => {
        void refreshPrompts();
      }}
      onNewPrompt={() => {
        setNewPromptRequestCount((c) => c + 1);
      }}
      activeTerminalId={promptEngineerTerminalId}
      onRestoreTerminal={() => {
        setRestoreTerminalCount((c) => c + 1);
      }}
      onCloseTerminal={() => {
        setCloseTerminalCount((c) => c + 1);
      }}
    />
  );

  useEffect(() => {
    onSidebarContent?.(sidebarContent);
    return () => onSidebarContent?.(null);
  });
  const [newPromptMode, setNewPromptMode] = useState<NewPromptMode>(null);
  const [isCreatingTerminal, setIsCreatingTerminal] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);

  const handleNewPrompt = useCallback(async () => {
    setIsCreatingTerminal(true);
    try {
      const data = await apiClient.post<{ terminalId?: string; tentacleId?: string }>(
        buildTerminalsUrl(),
        {
          workspaceMode: "shared",
          agentProvider: "claude-code",
          promptTemplate: "meta-prompt-generator",
        },
      );
      const agentId = (data.terminalId ?? data.tentacleId) as string;
      setNewPromptMode({ terminalId: agentId });
      setShowTerminal(true);
      onTerminalIdChange(agentId);
    } catch {
      // Silently fail — the user can retry
    } finally {
      setIsCreatingTerminal(false);
    }
  }, [onTerminalIdChange]);

  useEffect(() => {
    if (newPromptRequestCount > 0) {
      void handleNewPrompt();
    }
  }, [newPromptRequestCount, handleNewPrompt]);

  // When a prompt is selected from the sidebar, switch away from terminal view
  useEffect(() => {
    if (selectedPrompt) {
      setShowTerminal(false);
    }
  }, [selectedPrompt]);

  // When the sidebar's minimized bar is clicked, restore terminal view
  useEffect(() => {
    if (restoreTerminalCount > 0) {
      setShowTerminal(true);
    }
  }, [restoreTerminalCount]);

  // When the sidebar's close button is clicked, destroy the terminal
  useEffect(() => {
    if (closeTerminalCount > 0) {
      setNewPromptMode(null);
      setShowTerminal(false);
      onTerminalIdChange(null);
      void onRefresh();
    }
  }, [closeTerminalCount, onRefresh, onTerminalIdChange]);

  const handleBackToLibrary = useCallback(() => {
    setNewPromptMode(null);
    setShowTerminal(false);
    onTerminalIdChange(null);
    void onRefresh();
  }, [onRefresh, onTerminalIdChange]);

  const showPromptDetail = !showTerminal || !newPromptMode;

  return (
    <section className="prompts-view" aria-label="Prompts primary view">
      {/* Terminal — kept mounted when active, hidden via CSS when viewing a prompt */}
      {newPromptMode && (
        <div
          className="prompts-terminal"
          key={newPromptMode.terminalId}
          style={showTerminal ? undefined : { display: "none" }}
        >
          <header className="prompts-terminal-header">
            <button type="button" className="prompts-terminal-back" onClick={handleBackToLibrary}>
              ← Back
            </button>
            <span className="prompts-terminal-label">
              <strong>Prompt Engineer</strong>
            </span>
          </header>
          <Terminal
            terminalId={newPromptMode.terminalId}
            terminalLabel="Prompt Engineer"
            hidePromptPicker
          />
        </div>
      )}

      {/* Prompt detail / empty state — shown when terminal is hidden or doesn't exist */}
      {showPromptDetail && (
        <>
          {errorMessage ? <p className="prompts-error">{errorMessage}</p> : null}

          {isLoadingDetail ? (
            <p className="prompts-empty">Loading prompt...</p>
          ) : selectedPrompt ? (
            <div className="prompts-detail">
              <header className="prompts-detail-header">
                <div className="prompts-detail-header-left">
                  <h3 className="prompts-detail-name">{selectedPrompt.name}</h3>
                  <span className="prompts-detail-source-badge" data-source={selectedPrompt.source}>
                    {selectedPrompt.source === "user" ? "User" : "Built-in"}
                  </span>
                </div>
                {selectedPrompt.source === "user" && (
                  <div className="prompts-detail-header-actions">
                    {isEditing ? (
                      <>
                        <ActionButton
                          onClick={() => {
                            void onSubmitEdit();
                          }}
                        >
                          Save
                        </ActionButton>
                        <ActionButton onClick={onCancelEditing}>Cancel</ActionButton>
                      </>
                    ) : (
                      <>
                        <ActionButton onClick={onStartEditing}>Edit</ActionButton>
                        <ActionButton
                          onClick={() => {
                            void onDelete();
                          }}
                        >
                          Delete
                        </ActionButton>
                      </>
                    )}
                  </div>
                )}
              </header>

              {isEditing ? (
                <textarea
                  className="prompts-edit-area"
                  value={editDraft}
                  onChange={(e) => {
                    onSetEditDraft(e.target.value);
                  }}
                  spellCheck={false}
                />
              ) : (
                <div className="prompts-content">
                  <MarkdownContent content={selectedPrompt.content} />
                </div>
              )}
            </div>
          ) : (
            <div className="prompts-empty-state">
              <p className="prompts-empty">
                Select a prompt from the sidebar, or create a new one.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
};
