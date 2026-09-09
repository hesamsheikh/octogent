import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { formatTimestamp } from "../app/formatTimestamp";
import { useConversationsRuntime } from "../app/hooks/useConversationsRuntime";
import { useT } from "../app/providers/LocaleProvider";
import { ClearAllConversationsDialog } from "./ClearAllConversationsDialog";
import { SidebarConversationsList } from "./SidebarConversationsList";
import { ActionButton } from "./ui/ActionButton";
import { MarkdownContent } from "./ui/MarkdownContent";

type ConversationsPrimaryViewProps = {
  enabled: boolean;
  onSidebarContent?: (content: ReactNode) => void;
  onActionPanel?: (content: ReactNode) => void;
};

export const ConversationsPrimaryView = ({
  enabled,
  onSidebarContent,
  onActionPanel,
}: ConversationsPrimaryViewProps) => {
  const t = useT();
  const {
    sessions,
    selectedSessionId,
    selectedSession,
    isLoadingSessions: isLoadingConversationSessions,
    isLoadingSelectedSession,
    isExporting,
    isClearing: isClearingConversations,
    isSearching: isSearchingConversations,
    searchQuery,
    searchHits: conversationsSearchHits,
    highlightedTurnId,
    errorMessage,
    selectSession,
    refreshSessions,
    clearAllSessions,
    deleteSession,
    exportSession,
    searchConversations,
    clearSearch: clearConversationsSearch,
    navigateToSearchHit: navigateToConversationSearchHit,
  } = useConversationsRuntime({ enabled });

  const [isPendingClearAll, setIsPendingClearAll] = useState(false);

  const onDeleteSession = useCallback(() => {
    if (selectedSessionId) {
      void deleteSession(selectedSessionId);
    }
  }, [selectedSessionId, deleteSession]);

  const onExport = useCallback(
    (format: "json" | "md") => {
      if (!selectedSessionId) {
        return;
      }

      void exportSession(selectedSessionId, format).then((result) => {
        if (!result) {
          return;
        }

        const blob = new Blob([result.content], { type: result.contentType });
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = result.filename;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(objectUrl);
      });
    },
    [selectedSessionId, exportSession],
  );

  // Push sidebar content
  const sidebarContent = (
    <SidebarConversationsList
      sessions={sessions}
      selectedSessionId={selectedSessionId}
      isLoadingSessions={isLoadingConversationSessions}
      isSearching={isSearchingConversations}
      searchQuery={searchQuery}
      searchHits={conversationsSearchHits}
      onSelectSession={selectSession}
      onRefresh={() => {
        void refreshSessions();
      }}
      onClearAll={() => {
        setIsPendingClearAll(true);
      }}
      onSearch={(query) => {
        void searchConversations(query);
      }}
      onClearSearch={clearConversationsSearch}
      onNavigateToHit={navigateToConversationSearchHit}
    />
  );

  useEffect(() => {
    onSidebarContent?.(sidebarContent);
    return () => onSidebarContent?.(null);
  });

  // Push action panel for clear-all dialog
  const actionPanelContent = isPendingClearAll ? (
    <ClearAllConversationsDialog
      sessionCount={sessions.length}
      isClearing={isClearingConversations}
      onCancel={() => {
        setIsPendingClearAll(false);
      }}
      onConfirm={() => {
        void clearAllSessions().then(() => {
          setIsPendingClearAll(false);
        });
      }}
    />
  ) : null;

  useEffect(() => {
    onActionPanel?.(actionPanelContent);
    return () => onActionPanel?.(null);
  });

  const isDeletingSession = false;
  const highlightedRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (highlightedTurnId && highlightedRef.current) {
      highlightedRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightedTurnId]);

  return (
    <section className="conversations-view" aria-label={t("web.a11y.conversationsView")}>
      {errorMessage ? <p className="conversations-error">{errorMessage}</p> : null}

      <section
        className="conversations-transcript"
        aria-label={t("web.a11y.conversationTranscriptPane")}
      >
        {isLoadingSelectedSession ? (
          <p className="conversations-empty">{t("web.conversations.loading")}</p>
        ) : selectedSession ? (
          <>
            <header className="conversations-transcript-header">
              <div className="conversations-transcript-header-top">
                <h3>{selectedSession.sessionId}</h3>
                <div className="conversations-transcript-header-actions">
                  <ActionButton
                    aria-label={t("web.conversations.exportJson")}
                    className="conversations-export"
                    disabled={isExporting}
                    onClick={() => {
                      onExport("json");
                    }}
                    size="dense"
                    variant="info"
                  >
                    {isExporting
                      ? t("web.conversations.exporting")
                      : t("web.conversations.exportJson")}
                  </ActionButton>
                  <ActionButton
                    aria-label={t("web.conversations.exportMarkdown")}
                    className="conversations-export"
                    disabled={isExporting}
                    onClick={() => {
                      onExport("md");
                    }}
                    size="dense"
                    variant="info"
                  >
                    {isExporting
                      ? t("web.conversations.exporting")
                      : t("web.conversations.exportMarkdown")}
                  </ActionButton>
                  <button
                    aria-label={t("web.a11y.deleteThisConversation")}
                    className="conversations-delete-btn"
                    disabled={isDeletingSession}
                    onClick={onDeleteSession}
                    type="button"
                  >
                    <svg
                      aria-hidden="true"
                      focusable="false"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 4h10" />
                      <path d="M6 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" />
                      <path d="M4.5 4l.5 9a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1l.5-9" />
                      <path d="M6.5 7v4" />
                      <path d="M9.5 7v4" />
                    </svg>
                  </button>
                </div>
              </div>
              <dl>
                <div>
                  <dt>{t("web.conversations.started")}</dt>
                  <dd>{formatTimestamp(selectedSession.startedAt)}</dd>
                </div>
                <div>
                  <dt>{t("web.conversations.ended")}</dt>
                  <dd>{formatTimestamp(selectedSession.endedAt)}</dd>
                </div>
                <div>
                  <dt>{t("web.conversations.events")}</dt>
                  <dd>{selectedSession.eventCount}</dd>
                </div>
              </dl>
            </header>
            <ol className="conversations-turn-list">
              {selectedSession.turns.map((turn) => (
                <li
                  className="conversations-turn"
                  data-role={turn.role}
                  data-highlighted={turn.turnId === highlightedTurnId ? "true" : undefined}
                  key={turn.turnId}
                  ref={turn.turnId === highlightedTurnId ? highlightedRef : undefined}
                >
                  <time className="conversations-turn-time" dateTime={turn.startedAt}>
                    {formatTimestamp(turn.startedAt)}
                  </time>
                  <MarkdownContent
                    content={turn.content}
                    className="conversations-turn-content"
                    {...(turn.turnId === highlightedTurnId && searchQuery.length > 0
                      ? { highlightTerm: searchQuery }
                      : {})}
                  />
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="conversations-empty">{t("web.conversations.empty")}</p>
        )}
      </section>
    </section>
  );
};
