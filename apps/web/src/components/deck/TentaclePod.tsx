import { useEffect, useRef, useState } from "react";

import type { DeckAvailableSkill, DeckTentacleSummary } from "@octogent/core";
import { useT } from "../../app/providers/LocaleProvider";
import { OctopusGlyph } from "../EmptyOctopus";
import type { OctopusVisuals } from "./octopusVisuals";

// ─── Status styling ──────────────────────────────────────────────────────────

export const STATUS_LABELS: Record<DeckTentacleSummary["status"], string> = {
  idle: "idle",
  active: "active",
  blocked: "blocked",
  "needs-review": "review",
};

// ─── TodoList ────────────────────────────────────────────────────────────────

export const TodoList = ({
  items,
  tentacleId,
  onToggle,
}: {
  items: { text: string; done: boolean }[];
  tentacleId: string;
  onToggle?: ((tentacleId: string, itemIndex: number, done: boolean) => void) | undefined;
}) => {
  let lastDoneIndex = -1;
  for (let idx = items.length - 1; idx >= 0; idx--) {
    if (items[idx]?.done) {
      lastDoneIndex = idx;
      break;
    }
  }
  const scrollRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ block: "start" });
  }, []);

  return (
    <ul className="deck-pod-todos">
      {items.map((item, i) => (
        <li
          key={item.text}
          ref={i === lastDoneIndex ? scrollRef : undefined}
          className={`deck-pod-todo-item${item.done ? " deck-pod-todo-item--done" : ""}`}
        >
          <input
            type="checkbox"
            checked={item.done}
            className="deck-pod-todo-checkbox"
            onChange={() => onToggle?.(tentacleId, i, !item.done)}
          />
          <span className="deck-pod-todo-text">{item.text}</span>
        </li>
      ))}
    </ul>
  );
};

// ─── TentaclePod ─────────────────────────────────────────────────────────────

export type TentaclePodProps = {
  tentacle: DeckTentacleSummary;
  visuals: OctopusVisuals;
  isFocused: boolean;
  activeFileName?: string | undefined;
  onVaultFileClick?: (fileName: string) => void;
  onVaultBrowse?: () => void;
  onClose?: () => void;
  onDelete?: () => void;
  isDeleting?: boolean | undefined;
  onTodoToggle?: (tentacleId: string, itemIndex: number, done: boolean) => void;
  availableSkills: DeckAvailableSkill[];
  isSavingSkills?: boolean | undefined;
  onSaveSuggestedSkills?:
    | ((tentacleId: string, suggestedSkills: string[]) => Promise<boolean>)
    | undefined;
};

export const TentaclePod = ({
  tentacle,
  visuals,
  isFocused,
  activeFileName,
  onVaultFileClick,
  onVaultBrowse,
  onClose,
  onDelete,
  isDeleting,
  onTodoToggle,
  availableSkills,
  isSavingSkills,
  onSaveSuggestedSkills,
}: TentaclePodProps) => {
  const t = useT();
  const progressPct =
    tentacle.todoTotal > 0 ? Math.round((tentacle.todoDone / tentacle.todoTotal) * 100) : 0;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isEditingSkills, setIsEditingSkills] = useState(false);
  const [draftSkills, setDraftSkills] = useState<string[]>(tentacle.suggestedSkills);

  useEffect(() => {
    setDraftSkills(tentacle.suggestedSkills);
  }, [tentacle.suggestedSkills]);

  const availableSkillNames = availableSkills.map((skill) => skill.name);
  const skillNames = [...new Set([...availableSkillNames, ...draftSkills])].sort((a, b) =>
    a.localeCompare(b),
  );

  const toggleSkill = (skillName: string) => {
    setDraftSkills((current) =>
      current.includes(skillName)
        ? current.filter((skill) => skill !== skillName)
        : [...current, skillName].sort((a, b) => a.localeCompare(b)),
    );
  };

  const handleSaveSkills = async () => {
    const saved = await onSaveSuggestedSkills?.(tentacle.tentacleId, draftSkills);
    if (saved) {
      setIsEditingSkills(false);
    }
  };

  return (
    <article
      className={`deck-pod${isFocused ? " deck-pod--focused" : ""}`}
      data-status={tentacle.status}
      style={{ borderColor: "var(--accent-primary)" }}
    >
      <header className="deck-pod-header">
        {isFocused && (
          <button type="button" className="deck-pod-btn deck-pod-btn--secondary" onClick={onClose}>
            ← {t("common.cancel")}
          </button>
        )}
        <button type="button" className="deck-pod-btn">
          {t("web.deck.tentaclePod.spawn")}
        </button>
        <button
          type="button"
          className="deck-pod-btn"
          onClick={() => {
            setDraftSkills(tentacle.suggestedSkills);
            setIsEditingSkills((current) => !current);
          }}
        >
          {t("web.deck.tentaclePod.skills")}
        </button>
        <button type="button" className="deck-pod-btn" onClick={() => onVaultBrowse?.()}>
          {t("web.deck.tentaclePod.vault")}
        </button>
        {confirmingDelete ? (
          <>
            <button
              type="button"
              className="deck-pod-btn deck-pod-btn--danger"
              disabled={isDeleting}
              onClick={() => onDelete?.()}
            >
              {isDeleting ? "..." : t("web.deck.tentaclePod.confirmDelete")}
            </button>
            <button
              type="button"
              className="deck-pod-btn deck-pod-btn--secondary"
              onClick={() => setConfirmingDelete(false)}
            >
              {t("web.deck.tentaclePod.cancel")}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="deck-pod-btn deck-pod-btn--delete"
            onClick={() => setConfirmingDelete(true)}
            aria-label={t("web.a11y.deleteTentacle")}
          >
            <svg className="deck-pod-btn-icon" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M5.5 1.5h5M2 4h12M6 7v5M10 7v5M3.5 4l.75 9.5a1 1 0 001 .9h5.5a1 1 0 001-.9L12.5 4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </header>

      <div className="deck-pod-body">
        <span className={`deck-pod-status deck-pod-status--${tentacle.status}`}>
          {t(
            tentacle.status === "needs-review"
              ? "agentState.review"
              : `agentState.${tentacle.status}`,
          )}
        </span>
        <div className="deck-pod-identity">
          <div className="deck-pod-octopus-col">
            <div className="deck-pod-octopus">
              <OctopusGlyph
                color={visuals.color}
                animation={visuals.animation}
                expression={visuals.expression}
                accessory={visuals.accessory}
                {...(visuals.hairColor ? { hairColor: visuals.hairColor } : {})}
                scale={5}
              />
            </div>
          </div>
          <div className="deck-pod-identity-text">
            <span className="deck-pod-name">{tentacle.displayName}</span>
            <span className="deck-pod-description">{tentacle.description}</span>
          </div>
        </div>

        <div className="deck-pod-details">
          {isEditingSkills && (
            <div className="deck-pod-skills-editor">
              {skillNames.length === 0 ? (
                <span className="deck-pod-skills-empty">{t("web.deck.tentaclePod.noSkills")}</span>
              ) : (
                <div className="deck-pod-skills-options">
                  {skillNames.map((skillName) => {
                    const skill = availableSkills.find((entry) => entry.name === skillName);
                    return (
                      <label key={skillName} className="deck-pod-skill-option">
                        <input
                          type="checkbox"
                          checked={draftSkills.includes(skillName)}
                          onChange={() => toggleSkill(skillName)}
                        />
                        <span className="deck-pod-skill-copy">
                          <span className="deck-pod-skill-name">{skillName}</span>
                          {skill?.description && (
                            <span className="deck-pod-skill-desc">{skill.description}</span>
                          )}
                          {!skill && (
                            <span className="deck-pod-skill-desc">
                              {t("web.deck.tentaclePod.skillsStored")}
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
              <div className="deck-pod-skills-actions">
                <button
                  type="button"
                  className="deck-pod-btn deck-pod-btn--secondary"
                  onClick={() => {
                    setDraftSkills(tentacle.suggestedSkills);
                    setIsEditingSkills(false);
                  }}
                >
                  {t("web.deck.tentaclePod.cancel")}
                </button>
                <button
                  type="button"
                  className="deck-pod-btn"
                  disabled={Boolean(isSavingSkills)}
                  onClick={() => void handleSaveSkills()}
                >
                  {isSavingSkills
                    ? t("web.deck.tentaclePod.saving")
                    : t("web.deck.tentaclePod.saveSkills")}
                </button>
              </div>
            </div>
          )}

          {tentacle.todoTotal > 0 && (
            <div className="deck-pod-progress">
              <div className="deck-pod-progress-bar">
                <div
                  className="deck-pod-progress-fill"
                  style={{ width: `${progressPct}%`, backgroundColor: visuals.color }}
                />
              </div>
              <span
                className="deck-pod-progress-label"
                style={{ backgroundColor: `${visuals.color}22`, color: visuals.color }}
              >
                {t("web.deck.tentaclePod.progress", {
                  done: tentacle.todoDone,
                  total: tentacle.todoTotal,
                })}
              </span>
            </div>
          )}

          {tentacle.todoItems.length > 0 && (
            <TodoList
              items={tentacle.todoItems}
              tentacleId={tentacle.tentacleId}
              onToggle={onTodoToggle}
            />
          )}

          {tentacle.suggestedSkills.length > 0 && (
            <div className="deck-pod-vault">
              <span className="deck-pod-vault-label">{t("web.deck.tentaclePod.skills")}</span>
              <div className="deck-pod-vault-files">
                {tentacle.suggestedSkills.map((skill) => (
                  <span key={skill} className="deck-pod-vault-file">
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          {tentacle.vaultFiles.length > 0 && (
            <div className="deck-pod-vault">
              <span className="deck-pod-vault-label">{t("web.deck.tentaclePod.vault")}</span>
              <div className="deck-pod-vault-files">
                {tentacle.vaultFiles.map((file) => (
                  <button
                    key={file}
                    type="button"
                    className="deck-pod-vault-file"
                    aria-current={activeFileName === file ? "true" : undefined}
                    onClick={(e) => {
                      e.stopPropagation();
                      onVaultFileClick?.(file);
                    }}
                  >
                    {file}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
};
