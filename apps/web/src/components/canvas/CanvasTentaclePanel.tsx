import { Terminal, X } from "lucide-react";
import { type Ref, useCallback, useMemo, useState } from "react";

import type { DeckTentacleSummary, TentacleWorkspaceMode } from "@octogent/core";
import type { GraphNode } from "../../app/canvas/types";
import { useT } from "../../app/providers/LocaleProvider";
import type { ConversationSessionSummary } from "../../app/types";
import {
  buildDeckTodoAddUrl,
  buildDeckTodoDeleteUrl,
  buildDeckTodoEditUrl,
  buildDeckTodoSolveUrl,
  buildDeckTodoToggleUrl,
} from "../../runtime/runtimeEndpoints";
import {
  type OctopusAccessory,
  type OctopusAnimation,
  type OctopusExpression,
  OctopusGlyph,
} from "../EmptyOctopus";

const OCTOPUS_COLORS = [
  "#ff6b2b",
  "#ff2d6b",
  "#00ffaa",
  "#bf5fff",
  "#00c8ff",
  "#ffee00",
  "#39ff14",
  "#ff4df0",
  "#00fff7",
  "#ff9500",
];
const ANIMATIONS: OctopusAnimation[] = ["sway", "walk", "jog", "bounce", "float", "swim-up"];
const EXPRESSIONS: OctopusExpression[] = ["normal", "happy", "angry", "surprised"];
const ACCESSORIES: OctopusAccessory[] = ["none", "none", "long", "mohawk", "side-sweep", "curly"];

function hashStr(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function deriveVisuals(tentacle: DeckTentacleSummary) {
  const rng = seededRng(hashStr(tentacle.tentacleId));
  const stored = tentacle.octopus;
  return {
    color:
      tentacle.color ??
      (OCTOPUS_COLORS[hashStr(tentacle.tentacleId) % OCTOPUS_COLORS.length] as string),
    animation:
      (stored?.animation as OctopusAnimation | null) ??
      (ANIMATIONS[Math.floor(rng() * ANIMATIONS.length)] as OctopusAnimation),
    expression:
      (stored?.expression as OctopusExpression | null) ??
      (EXPRESSIONS[Math.floor(rng() * EXPRESSIONS.length)] as OctopusExpression),
    accessory:
      (stored?.accessory as OctopusAccessory | null) ??
      (ACCESSORIES[Math.floor(rng() * ACCESSORIES.length)] as OctopusAccessory),
    hairColor: stored?.hairColor ?? undefined,
  };
}

type CanvasTentaclePanelProps = {
  node: GraphNode;
  isFocused?: boolean;
  onClose: () => void;
  onFocus?: () => void;
  panelRef?: Ref<HTMLDivElement> | undefined;
  tentacle: DeckTentacleSummary | null;
  sessions: ConversationSessionSummary[];
  onCreateAgent?: ((tentacleId: string) => void) | undefined;
  onSolveTodoItem?: ((tentacleId: string, itemIndex: number) => void) | undefined;
  onSpawnSwarm?: ((tentacleId: string, workspaceMode: TentacleWorkspaceMode) => void) | undefined;
  onNavigateToConversation?: ((sessionId: string) => void) | undefined;
  onRefreshTentacleData?: (() => Promise<void>) | undefined;
};

const STATUS_LABELS: Record<string, string> = {
  idle: "idle",
  active: "active",
  blocked: "blocked",
  "needs-review": "review",
};

const formatTime = (isoString: string | null): string => {
  if (!isoString) return "—";
  const d = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
};

export const CanvasTentaclePanel = ({
  node,
  isFocused,
  onClose,
  onFocus,
  panelRef,
  tentacle,
  sessions,
  onCreateAgent,
  onSolveTodoItem,
  onSpawnSwarm,
  onNavigateToConversation,
  onRefreshTentacleData,
}: CanvasTentaclePanelProps) => {
  const t = useT();
  const visuals = useMemo(() => (tentacle ? deriveVisuals(tentacle) : null), [tentacle]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [addingTodo, setAddingTodo] = useState(false);
  const [addText, setAddText] = useState("");
  const [solvingTodoIndex, setSolvingTodoIndex] = useState<number | null>(null);
  const refreshTentacleData = useCallback(async () => {
    await onRefreshTentacleData?.();
  }, [onRefreshTentacleData]);

  const formatRelativeTime = useCallback(
    (isoString: string | null): string => {
      if (!isoString) return t("format.null");
      const d = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return t("web.deck.tentaclePanel.justNow");
      if (diffMin < 60) return t("web.deck.tentaclePanel.minAgo", { n: diffMin });
      const diffHr = Math.floor(diffMin / 60);
      if (diffHr < 24) return t("web.deck.tentaclePanel.hourAgo", { n: diffHr });
      const diffDay = Math.floor(diffHr / 24);
      return t("web.deck.tentaclePanel.dayAgo", { n: diffDay });
    },
    [t],
  );

  const handleTodoToggle = useCallback(
    async (itemIndex: number, done: boolean) => {
      try {
        const response = await fetch(buildDeckTodoToggleUrl(node.tentacleId), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemIndex, done }),
        });
        if (!response.ok) return;
        await refreshTentacleData();
      } catch {
        // silent
      }
    },
    [node.tentacleId, refreshTentacleData],
  );

  const handleTodoEdit = useCallback(
    async (itemIndex: number, text: string) => {
      if (text.trim().length === 0) return;
      try {
        const response = await fetch(buildDeckTodoEditUrl(node.tentacleId), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemIndex, text: text.trim() }),
        });
        if (!response.ok) return;
        setEditingIndex(null);
        await refreshTentacleData();
      } catch {
        // silent
      }
    },
    [node.tentacleId, refreshTentacleData],
  );

  const handleTodoAdd = useCallback(
    async (text: string) => {
      if (text.trim().length === 0) return;
      try {
        const response = await fetch(buildDeckTodoAddUrl(node.tentacleId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: text.trim() }),
        });
        if (!response.ok) return;
        setAddingTodo(false);
        setAddText("");
        await refreshTentacleData();
      } catch {
        // silent
      }
    },
    [node.tentacleId, refreshTentacleData],
  );

  const handleTodoDelete = useCallback(
    async (itemIndex: number) => {
      try {
        const response = await fetch(buildDeckTodoDeleteUrl(node.tentacleId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemIndex }),
        });
        if (!response.ok) return;
        await refreshTentacleData();
      } catch {
        // silent
      }
    },
    [node.tentacleId, refreshTentacleData],
  );

  const handleTodoSolve = useCallback(
    async (itemIndex: number) => {
      try {
        setSolvingTodoIndex(itemIndex);
        const response = await fetch(buildDeckTodoSolveUrl(node.tentacleId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemIndex }),
        });
        if (!response.ok) return;
        onSolveTodoItem?.(node.tentacleId, itemIndex);
      } catch {
        // silent
      } finally {
        setSolvingTodoIndex((current) => (current === itemIndex ? null : current));
      }
    },
    [node.tentacleId, onSolveTodoItem],
  );

  const progressPct =
    tentacle && tentacle.todoTotal > 0
      ? Math.round((tentacle.todoDone / tentacle.todoTotal) * 100)
      : 0;

  return (
    <div
      ref={panelRef}
      className={`detail-panel${isFocused ? " detail-panel--focused" : ""}`}
      tabIndex={-1}
      onPointerDown={() => onFocus?.()}
    >
      {/* Header */}
      <div
        className="detail-panel-header"
        style={{
          background: `linear-gradient(180deg, color-mix(in srgb, ${node.color ?? "var(--accent-primary)"} 90%, #ffd89d 10%) 0%, color-mix(in srgb, ${node.color ?? "var(--accent-primary)"} 78%, #d9851c 22%) 100%)`,
        }}
      >
        <span className="detail-title">{tentacle?.displayName ?? node.label}</span>
        {tentacle && (
          <span className="detail-type-badge">
            {t(
              tentacle.status === "needs-review"
                ? "agentState.review"
                : `agentState.${tentacle.status}`,
            )}
          </span>
        )}
        <button
          className="detail-close"
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
        >
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="detail-content">
        {/* Identity: glyph + info side by side */}
        <div className="detail-identity">
          {visuals && (
            <div className="detail-glyph">
              <OctopusGlyph
                color={visuals.color}
                animation={visuals.animation}
                expression={visuals.expression}
                accessory={visuals.accessory}
                {...(visuals.hairColor ? { hairColor: visuals.hairColor } : {})}
                scale={6}
              />
            </div>
          )}
          <div className="detail-identity-info">
            <div className="detail-name">{tentacle?.displayName ?? node.label}</div>
            <div className="detail-row">
              <span className="detail-label">{t("common.id")}</span>
              <span className="detail-value detail-value--mono">{node.tentacleId}</span>
            </div>
            {tentacle?.description && (
              <div className="detail-row">
                <span className="detail-label">{t("common.description")}</span>
                <span className="detail-value">{tentacle.description}</span>
              </div>
            )}
          </div>
        </div>

        {/* Actions section */}
        <div className="detail-section">
          <div className="detail-section-title">{t("common.actions")}</div>
          <div className="detail-actions">
            <button
              type="button"
              className="detail-action-btn"
              onClick={() => onCreateAgent?.(node.tentacleId)}
            >
              {t("web.deck.tentaclePanel.createAgent")}
            </button>
            <button
              type="button"
              className="detail-action-btn"
              onClick={() => onSpawnSwarm?.(node.tentacleId, "worktree")}
            >
              {t("web.deck.tentaclePanel.spawnSwarmWorktrees")}
            </button>
            <button
              type="button"
              className="detail-action-btn"
              onClick={() => onSpawnSwarm?.(node.tentacleId, "shared")}
            >
              {t("web.deck.tentaclePanel.spawnSwarmNormal")}
            </button>
          </div>
        </div>

        {/* Progress section */}
        {tentacle && (
          <div className="detail-section">
            <div className="detail-section-title">{t("common.progress")}</div>
            {tentacle.todoTotal > 0 && (
              <div className="detail-progress">
                <div className="detail-progress-bar">
                  <div
                    className="detail-progress-fill"
                    style={{ width: `${progressPct}%`, backgroundColor: node.color }}
                  />
                </div>
                <span className="detail-progress-label">
                  {tentacle.todoDone}/{tentacle.todoTotal}
                </span>
              </div>
            )}
            {tentacle.todoItems.length > 0 && (
              <ul className="detail-todos">
                {tentacle.todoItems.map((item, i) => (
                  <li
                    key={`${i}-${item.text}`}
                    className={`detail-todo${item.done ? " detail-todo--done" : ""}`}
                  >
                    <div className="detail-todo-controls">
                      <button
                        type="button"
                        className="detail-todo-delete"
                        title={t("web.deck.tentaclePanel.deleteItem")}
                        onClick={() => void handleTodoDelete(i)}
                      >
                        <X size={12} />
                      </button>
                      <button
                        type="button"
                        className="detail-todo-solve"
                        aria-label={t("web.deck.tentaclePanel.spawnForTodo", { text: item.text })}
                        title={t("web.deck.tentaclePanel.spawnForItem")}
                        disabled={item.done || solvingTodoIndex === i}
                        onClick={() => void handleTodoSolve(i)}
                      >
                        {solvingTodoIndex === i ? "…" : <Terminal size={15} strokeWidth={2.4} />}
                      </button>
                      <input
                        type="checkbox"
                        checked={item.done}
                        onChange={() => handleTodoToggle(i, !item.done)}
                      />
                    </div>
                    {editingIndex === i ? (
                      <input
                        className="detail-todo-edit-input"
                        type="text"
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleTodoEdit(i, editText);
                          if (e.key === "Escape") setEditingIndex(null);
                        }}
                        onBlur={() => void handleTodoEdit(i, editText)}
                      />
                    ) : (
                      <span
                        className="detail-todo-text"
                        onDoubleClick={() => {
                          setEditingIndex(i);
                          setEditText(item.text);
                        }}
                      >
                        {item.text}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {addingTodo ? (
              <div className="detail-todo-add-row">
                <input
                  className="detail-todo-edit-input"
                  type="text"
                  placeholder={t("web.deck.tentaclePanel.newTodoPlaceholder")}
                  value={addText}
                  onChange={(e) => setAddText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleTodoAdd(addText);
                    if (e.key === "Escape") {
                      setAddingTodo(false);
                      setAddText("");
                    }
                  }}
                  onBlur={() => {
                    if (addText.trim().length > 0) {
                      void handleTodoAdd(addText);
                    } else {
                      setAddingTodo(false);
                      setAddText("");
                    }
                  }}
                />
              </div>
            ) : (
              <button
                type="button"
                className="detail-todo-add-btn"
                onClick={() => setAddingTodo(true)}
              >
                {t("web.deck.tentaclePanel.addItem")}
              </button>
            )}
          </div>
        )}

        {/* Vault files */}
        {tentacle && tentacle.vaultFiles.length > 0 && (
          <div className="detail-section">
            <div className="detail-section-title">{t("web.deck.tentaclePanel.vaultFiles")}</div>
            <div className="detail-labels-list">
              {tentacle.vaultFiles.map((file) => (
                <span key={file} className="detail-label-tag">
                  {file}
                </span>
              ))}
            </div>
          </div>
        )}

        {tentacle && tentacle.suggestedSkills.length > 0 && (
          <div className="detail-section">
            <div className="detail-section-title">
              {t("web.deck.tentaclePanel.suggestedSkills")}
            </div>
            <div className="detail-labels-list">
              {tentacle.suggestedSkills.map((skill) => (
                <span key={skill} className="detail-label-tag">
                  {skill}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Sessions section */}
        <div className="detail-section">
          <div className="detail-section-title">
            {t("web.deck.tentaclePanel.sessions", { n: sessions.length })}
          </div>
          {sessions.length === 0 ? (
            <div className="detail-empty">{t("web.deck.tentaclePanel.noSessions")}</div>
          ) : (
            <div className="detail-sessions">
              {sessions.map((s) => (
                <button
                  key={s.sessionId}
                  type="button"
                  className="detail-session-item"
                  onClick={() => onNavigateToConversation?.(s.sessionId)}
                >
                  <span className="detail-session-preview">
                    {s.firstUserTurnPreview
                      ? s.firstUserTurnPreview.slice(0, 60)
                      : s.sessionId.slice(0, 16)}
                  </span>
                  <span className="detail-session-meta">
                    {t("web.deck.tentaclePanel.turns", { n: s.turnCount })} ·{" "}
                    {formatRelativeTime(s.lastEventAt)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
