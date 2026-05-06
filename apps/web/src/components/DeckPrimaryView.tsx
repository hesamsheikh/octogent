import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  DeckAvailableSkill,
  DeckTentacleSummary,
  WorkspaceSetupSnapshot,
  WorkspaceSetupStepId,
} from "@octogent/core";
import { useClickOutside } from "../app/hooks/useClickOutside";
import type { TerminalAgentProvider } from "../app/types";
import { apiClient } from "../runtime/apiClient";
import {
  buildDeckSkillsUrl,
  buildDeckTentacleSkillsUrl,
  buildDeckTentacleUrl,
  buildDeckTentaclesUrl,
  buildDeckTodoToggleUrl,
  buildDeckVaultFileUrl,
  buildTerminalsUrl,
} from "../runtime/runtimeEndpoints";
import { OctopusGlyph } from "./EmptyOctopus";
import { Terminal } from "./Terminal";
import { ActionCards } from "./deck/ActionCards";
import { AddTentacleForm } from "./deck/AddTentacleForm";
import type { OctopusAppearancePayload } from "./deck/AddTentacleForm";
import { DeckBottomActions } from "./deck/DeckBottomActions";
import { TentaclePod } from "./deck/TentaclePod";
import { WorkspaceSetupCard } from "./deck/WorkspaceSetupCard";
import { type OctopusVisuals, deriveOctopusVisuals } from "./deck/octopusVisuals";
import { MarkdownContent } from "./ui/MarkdownContent";

export type { OctopusAppearancePayload } from "./deck/AddTentacleForm";

const normalizeDeckAvailableSkill = (value: unknown): DeckAvailableSkill | null => {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string") return null;

  return {
    name: record.name,
    description: typeof record.description === "string" ? record.description : "",
    source: record.source === "project" ? "project" : "user",
  };
};

// ─── Main view ───────────────────────────────────────────────────────────────

type FocusState =
  | { type: "vault-browser"; tentacleId: string }
  | { type: "vault"; tentacleId: string; fileName: string }
  | { type: "terminal"; agentId: string; terminalLabel: string };

type EmptyViewMode = "idle" | "adding";

type DeckPrimaryViewProps = {
  onSidebarContent?: ((content: ReactNode) => void) | undefined;
  workspaceSetup: WorkspaceSetupSnapshot | null;
  isWorkspaceSetupLoading: boolean;
  workspaceSetupError: string | null;
  onRefreshWorkspaceSetup: () => Promise<WorkspaceSetupSnapshot | null>;
  onRunWorkspaceSetupStep: (stepId: WorkspaceSetupStepId) => Promise<WorkspaceSetupSnapshot | null>;
  suppressWorkspaceSetupCard?: boolean;
};

export const DeckPrimaryView = ({
  onSidebarContent,
  workspaceSetup,
  isWorkspaceSetupLoading,
  workspaceSetupError,
  onRefreshWorkspaceSetup,
  onRunWorkspaceSetupStep,
  suppressWorkspaceSetupCard = false,
}: DeckPrimaryViewProps) => {
  const [tentacles, setTentacles] = useState<DeckTentacleSummary[]>([]);
  const [focus, setFocus] = useState<FocusState | null>(null);
  const [vaultContent, setVaultContent] = useState<string | null>(null);
  const [loadingVault, setLoadingVault] = useState(false);
  const [emptyViewMode, setEmptyViewMode] = useState<EmptyViewMode>("idle");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [availableSkills, setAvailableSkills] = useState<DeckAvailableSkill[]>([]);
  const [savingTentacleSkillsId, setSavingTentacleSkillsId] = useState<string | null>(null);

  const [selectedAgent, setSelectedAgent] = useState<TerminalAgentProvider>("claude-code");
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const agentMenuRef = useRef<HTMLDivElement>(null);
  const [isLaunchingAgent, setIsLaunchingAgent] = useState(false);
  const [runningSetupStepId, setRunningSetupStepId] = useState<
    | "initialize-workspace"
    | "ensure-gitignore"
    | "check-claude"
    | "check-git"
    | "check-curl"
    | "create-tentacles"
    | null
  >(null);

  // Fetch tentacle list
  const fetchTentacles = useCallback(async () => {
    try {
      const data = await apiClient.get<DeckTentacleSummary[]>(buildDeckTentaclesUrl());
      setTentacles(data);
      await onRefreshWorkspaceSetup();
    } catch {
      // silently ignore
    }
  }, [onRefreshWorkspaceSetup]);

  useEffect(() => {
    void fetchTentacles();
  }, [fetchTentacles]);

  useEffect(() => {
    let cancelled = false;

    const fetchSkills = async () => {
      try {
        const payload = await apiClient.get<unknown>(buildDeckSkillsUrl());
        if (!Array.isArray(payload) || cancelled) return;
        const skills = payload
          .map((entry) => normalizeDeckAvailableSkill(entry))
          .filter((entry): entry is DeckAvailableSkill => entry !== null);
        if (!cancelled) {
          setAvailableSkills(skills);
        }
      } catch {
        // silently ignore
      }
    };

    void fetchSkills();
    return () => {
      cancelled = true;
    };
  }, []);

  // Precompute visuals for all tentacles
  const visualsMap = useMemo(() => {
    const map = new Map<string, OctopusVisuals>();
    for (const t of tentacles) {
      map.set(t.tentacleId, deriveOctopusVisuals(t));
    }
    return map;
  }, [tentacles]);

  // Fetch vault file content when focus changes
  useEffect(() => {
    if (!focus || focus.type !== "vault") {
      setVaultContent(null);
      return;
    }

    let cancelled = false;
    setLoadingVault(true);
    const fetchVault = async () => {
      try {
        const text = await apiClient.getText(buildDeckVaultFileUrl(focus.tentacleId, focus.fileName));
        if (!cancelled) {
          setVaultContent(text);
          setLoadingVault(false);
        }
      } catch {
        if (!cancelled) {
          setVaultContent(null);
          setLoadingVault(false);
        }
      }
    };
    void fetchVault();
    return () => {
      cancelled = true;
    };
  }, [focus]);

  // Agent menu click-outside/escape
  const handleDismissAgentMenu = useCallback(() => setAgentMenuOpen(false), []);
  useClickOutside(agentMenuRef, agentMenuOpen, handleDismissAgentMenu);

  const handleVaultFileClick = useCallback((tentacleId: string, fileName: string) => {
    setFocus({ type: "vault", tentacleId, fileName });
  }, []);

  const handleClose = useCallback(() => {
    setFocus(null);
  }, []);

  const handleLaunchAgent = useCallback(async () => {
    setIsLaunchingAgent(true);
    try {
      const data = await apiClient.post<{ terminalId?: string; tentacleId?: string }>(
        buildTerminalsUrl(),
        {
          name: "tentacle-planner",
          workspaceMode: "shared",
          agentProvider: selectedAgent,
          promptTemplate: "tentacle-planner",
        },
      );
      const agentId = (data.terminalId ?? data.tentacleId) as string;
      setFocus({ type: "terminal", agentId, terminalLabel: "Tentacle Planner" });
      await fetchTentacles();
    } catch {
      // silently ignore
    } finally {
      setIsLaunchingAgent(false);
    }
  }, [selectedAgent, fetchTentacles]);

  const handleRunSetupStep = useCallback(
    async (
      stepId:
        | "initialize-workspace"
        | "ensure-gitignore"
        | "check-claude"
        | "check-git"
        | "check-curl"
        | "create-tentacles",
    ) => {
      setRunningSetupStepId(stepId);
      try {
        await onRunWorkspaceSetupStep(stepId);
        if (stepId === "initialize-workspace" || stepId === "ensure-gitignore") {
          await fetchTentacles();
        }
      } finally {
        setRunningSetupStepId(null);
      }
    },
    [fetchTentacles, onRunWorkspaceSetupStep],
  );

  const handleCreateTentacle = useCallback(
    async (
      name: string,
      description: string,
      color: string,
      octopus: OctopusAppearancePayload,
      suggestedSkills: string[],
    ) => {
      setIsCreating(true);
      setCreateError(null);
      try {
        await apiClient.post(buildDeckTentaclesUrl(), {
          name,
          description,
          color,
          octopus,
          suggestedSkills,
        });
        setEmptyViewMode("idle");
        await fetchTentacles();
        await onRefreshWorkspaceSetup();
      } catch (err) {
        setCreateError(err instanceof Error ? err.message : "Failed to create tentacle");
      } finally {
        setIsCreating(false);
      }
    },
    [fetchTentacles, onRefreshWorkspaceSetup],
  );

  const handleTentacleSkillsSave = useCallback(
    async (tentacleId: string, suggestedSkills: string[]) => {
      setSavingTentacleSkillsId(tentacleId);
      try {
        await apiClient.patch(buildDeckTentacleSkillsUrl(tentacleId), { suggestedSkills });
        await fetchTentacles();
        return true;
      } catch {
        return false;
      } finally {
        setSavingTentacleSkillsId((current) => (current === tentacleId ? null : current));
      }
    },
    [fetchTentacles],
  );

  const [deletingTentacleId, setDeletingTentacleId] = useState<string | null>(null);

  const handleDeleteTentacle = useCallback(
    async (tentacleId: string) => {
      setDeletingTentacleId(tentacleId);
      try {
        await apiClient.delete(buildDeckTentacleUrl(tentacleId));
        await fetchTentacles();
      } catch {
        // silently ignore
      } finally {
        setDeletingTentacleId(null);
      }
    },
    [fetchTentacles],
  );

  const handleTodoToggle = useCallback(
    async (tentacleId: string, itemIndex: number, done: boolean) => {
      try {
        await apiClient.patch(buildDeckTodoToggleUrl(tentacleId), { itemIndex, done });
        await fetchTentacles();
      } catch {
        // silently ignore
      }
    },
    [fetchTentacles],
  );

  const focusedTentacle =
    focus?.type === "vault" || focus?.type === "vault-browser"
      ? tentacles.find((t) => t.tentacleId === focus.tentacleId)
      : null;
  const mode = focus ? "detail" : "grid";
  const shouldShowWorkspaceSetup =
    !suppressWorkspaceSetupCard && tentacles.length === 0 && workspaceSetup?.shouldShowSetupCard;

  // Push sidebar content to the shared sidebar
  const sidebarContent = useMemo(
    () =>
      tentacles.length > 0 || focus?.type === "terminal" || shouldShowWorkspaceSetup ? (
        <div className="deck-sidebar-content">
          <div className="deck-sidebar-content-top">
            {shouldShowWorkspaceSetup ? (
              <WorkspaceSetupCard
                compact
                workspaceSetup={workspaceSetup}
                isLoading={isWorkspaceSetupLoading}
                error={workspaceSetupError}
                onRunStep={handleRunSetupStep}
                onLaunchClaudeCode={handleLaunchAgent}
                isLaunchingAgent={isLaunchingAgent}
                isRunningStepId={runningSetupStepId}
              />
            ) : (
              <ActionCards
                compact
                selectedAgent={selectedAgent}
                setSelectedAgent={setSelectedAgent}
                agentMenuOpen={agentMenuOpen}
                setAgentMenuOpen={setAgentMenuOpen}
                agentMenuRef={agentMenuRef}
                onAddManually={() => {
                  setEmptyViewMode("adding");
                  setCreateError(null);
                }}
                onLaunchAgent={handleLaunchAgent}
                isLaunchingAgent={isLaunchingAgent}
              />
            )}
          </div>
          {tentacles.length > 0 && (
            <div className="deck-sidebar-content-bottom">
              <DeckBottomActions
                onClearAll={async () => {
                  for (const t of tentacles) {
                    await apiClient.delete(buildDeckTentacleUrl(t.tentacleId)).catch(() => {});
                  }
                  await fetchTentacles();
                }}
              />
            </div>
          )}
        </div>
      ) : null,
    [
      agentMenuOpen,
      fetchTentacles,
      focus?.type,
      handleLaunchAgent,
      handleRunSetupStep,
      isLaunchingAgent,
      isWorkspaceSetupLoading,
      runningSetupStepId,
      selectedAgent,
      shouldShowWorkspaceSetup,
      tentacles,
      workspaceSetup,
      workspaceSetupError,
    ],
  );

  useEffect(() => {
    onSidebarContent?.(sidebarContent);
    return () => onSidebarContent?.(null);
  }, [onSidebarContent, sidebarContent]);

  // ─── Empty state (no tentacles) ─────────────────────────────────────────────

  if (tentacles.length === 0 && focus?.type !== "terminal") {
    return (
      <section
        className="deck-view"
        data-mode="grid"
        data-empty-mode={emptyViewMode}
        aria-label="Deck"
      >
        <div className="deck-empty-state">
          <div className="deck-empty-left">
            <div className="deck-empty-octopus">
              <OctopusGlyph
                color="#d4a017"
                animation="walk"
                expression="happy"
                accessory="none"
                scale={20}
              />
            </div>
            {shouldShowWorkspaceSetup ? (
              <WorkspaceSetupCard
                workspaceSetup={workspaceSetup}
                isLoading={isWorkspaceSetupLoading}
                error={workspaceSetupError}
                onRunStep={handleRunSetupStep}
                onLaunchClaudeCode={handleLaunchAgent}
                isLaunchingAgent={isLaunchingAgent}
                isRunningStepId={runningSetupStepId}
              />
            ) : (
              <ActionCards
                selectedAgent={selectedAgent}
                setSelectedAgent={setSelectedAgent}
                agentMenuOpen={agentMenuOpen}
                setAgentMenuOpen={setAgentMenuOpen}
                agentMenuRef={agentMenuRef}
                onAddManually={() => {
                  setEmptyViewMode("adding");
                  setCreateError(null);
                }}
                onLaunchAgent={handleLaunchAgent}
                isLaunchingAgent={isLaunchingAgent}
              />
            )}
          </div>
          {emptyViewMode === "adding" && (
            <div className="deck-empty-right">
              <AddTentacleForm
                onSubmit={handleCreateTentacle}
                onCancel={() => setEmptyViewMode("idle")}
                isSubmitting={isCreating}
                error={createError}
                availableSkills={availableSkills}
              />
            </div>
          )}
        </div>
      </section>
    );
  }

  // ─── Populated state ────────────────────────────────────────────────────────

  return (
    <section
      className="deck-view"
      data-mode={mode}
      data-has-pods={tentacles.length > 0}
      aria-label="Deck"
    >
      <div className="deck-pods-container">
        {tentacles.map((t) => {
          const isThis =
            (focus?.type === "vault" || focus?.type === "vault-browser") &&
            focus.tentacleId === t.tentacleId;
          return (
            <div
              key={t.tentacleId}
              className="deck-pod-slot"
              data-pod-role={isThis ? "focused" : focus ? "other" : "idle"}
            >
              <TentaclePod
                tentacle={t}
                visuals={visualsMap.get(t.tentacleId) as OctopusVisuals}
                isFocused={isThis}
                activeFileName={focus?.type === "vault" && isThis ? focus.fileName : undefined}
                onVaultFileClick={(fileName) =>
                  setFocus({ type: "vault", tentacleId: t.tentacleId, fileName })
                }
                onVaultBrowse={() => setFocus({ type: "vault-browser", tentacleId: t.tentacleId })}
                onClose={handleClose}
                onDelete={() => handleDeleteTentacle(t.tentacleId)}
                isDeleting={deletingTentacleId === t.tentacleId}
                onTodoToggle={handleTodoToggle}
                availableSkills={availableSkills}
                isSavingSkills={savingTentacleSkillsId === t.tentacleId}
                onSaveSuggestedSkills={handleTentacleSkillsSave}
              />
            </div>
          );
        })}
      </div>

      <div className="deck-detail-main">
        {focus?.type === "vault-browser" && focusedTentacle && (
          <>
            <header className="deck-detail-main-header">
              <button type="button" className="deck-add-form-back" onClick={handleClose}>
                ← Back
              </button>
              <span className="deck-detail-main-path">
                <strong>{focusedTentacle.displayName}</strong> / vault
              </span>
            </header>
            <div className="deck-detail-main-content deck-vault-browser">
              <pre className="deck-vault-tree">
                <span className="deck-vault-tree-dir">
                  .octogent/tentacles/{focusedTentacle.tentacleId}/
                </span>
                {(() => {
                  const files = [...focusedTentacle.vaultFiles, "CONTEXT.md"];
                  return files.map((file, i) => {
                    const isLast = i === files.length - 1;
                    const prefix = isLast ? "└── " : "├── ";
                    return (
                      <span key={file} className="deck-vault-tree-row">
                        <span className="deck-vault-tree-branch">{prefix}</span>
                        <button
                          type="button"
                          className="deck-vault-tree-file"
                          onClick={() =>
                            setFocus({
                              type: "vault",
                              tentacleId: focus.tentacleId,
                              fileName: file,
                            })
                          }
                        >
                          {file}
                        </button>
                      </span>
                    );
                  });
                })()}
              </pre>
            </div>
          </>
        )}
        {focus?.type === "vault" && focusedTentacle && (
          <>
            <header className="deck-detail-main-header">
              <button
                type="button"
                className="deck-add-form-back"
                onClick={() => setFocus({ type: "vault-browser", tentacleId: focus.tentacleId })}
              >
                ← Back
              </button>
              <span className="deck-detail-main-path">
                {focusedTentacle.displayName} / <strong>{focus.fileName}</strong>
              </span>
            </header>
            <div className="deck-detail-main-content" key={`${focus.tentacleId}/${focus.fileName}`}>
              {loadingVault ? (
                <span className="deck-detail-loading">Loading…</span>
              ) : vaultContent !== null ? (
                <MarkdownContent content={vaultContent} className="deck-detail-markdown" />
              ) : (
                <span className="deck-detail-loading">File not found.</span>
              )}
            </div>
          </>
        )}
        {focus?.type === "terminal" && (
          <div className="deck-detail-terminal" key={focus.agentId}>
            <header className="deck-detail-main-header">
              <button type="button" className="deck-add-form-back" onClick={handleClose}>
                ← Back
              </button>
              <span className="deck-detail-main-path">
                <strong>{focus.terminalLabel}</strong>
              </span>
            </header>
            <Terminal terminalId={focus.agentId} terminalLabel={focus.terminalLabel} />
          </div>
        )}
      </div>
    </section>
  );
};
