import type { WorkspaceSetupSnapshot, WorkspaceSetupStepId } from "@octogent/core";
import { useT } from "../../app/providers/LocaleProvider";
import { resolveSetupStepCopy } from "../../app/workspaceSetupCopy";
import { OctopusGlyph } from "../EmptyOctopus";

type WorkspaceSetupCardProps = {
  compact?: boolean;
  workspaceSetup: WorkspaceSetupSnapshot | null;
  isLoading: boolean;
  error: string | null;
  onRunStep: (stepId: WorkspaceSetupStepId) => void;
  onLaunchClaudeCode: () => void;
  isLaunchingAgent?: boolean;
  isRunningStepId?: WorkspaceSetupStepId | null;
};

export const WorkspaceSetupCard = ({
  compact,
  workspaceSetup,
  isLoading,
  error,
  onRunStep,
  onLaunchClaudeCode,
  isLaunchingAgent,
  isRunningStepId,
}: WorkspaceSetupCardProps) => {
  const t = useT();
  return (
    <section
      className={`workspace-setup-card${compact ? " workspace-setup-card--compact" : ""}`}
      aria-label={t("web.a11y.workspaceSetup")}
    >
      <header className="workspace-setup-card-header">
        <div className="workspace-setup-card-glyph">
          <OctopusGlyph
            color="#d4a017"
            animation={compact ? "idle" : "walk"}
            expression="happy"
            accessory="none"
            scale={compact ? 4 : 7}
          />
        </div>
        <div className="workspace-setup-card-copy">
          <h2 className="workspace-setup-card-title">{t("web.deck.workspaceSetup.title")}</h2>
          <p className="workspace-setup-card-desc">{t("web.deck.workspaceSetup.desc")}</p>
        </div>
      </header>

      {error ? <p className="workspace-setup-card-error">{error}</p> : null}

      <div className="workspace-setup-step-list">
        {(workspaceSetup?.steps ?? []).map((step) => {
          const isCreateTentaclesStep = step.id === "create-tentacles";
          const copy = resolveSetupStepCopy(step, t);
          const buttonLabel = isCreateTentaclesStep
            ? t("web.deck.workspaceSetup.launch")
            : copy.actionLabel;
          const isButtonDisabled = isCreateTentaclesStep ? isLaunchingAgent : isLoading;
          const isButtonRunning = isCreateTentaclesStep
            ? isLaunchingAgent
            : isRunningStepId === step.id;

          return (
            <article key={step.id} className="workspace-setup-step" data-complete={step.complete}>
              <div className="workspace-setup-step-main">
                <div className="workspace-setup-step-title-row">
                  <span className="workspace-setup-step-title">{copy.title}</span>
                  <span className="workspace-setup-step-state">
                    {step.complete
                      ? t("web.deck.workspaceSetup.done")
                      : step.required
                        ? t("web.deck.workspaceSetup.required")
                        : t("web.deck.workspaceSetup.optional")}
                  </span>
                </div>
                <p className="workspace-setup-step-desc">{copy.description}</p>
              </div>
              {buttonLabel ? (
                <button
                  type="button"
                  className="workspace-setup-step-action"
                  disabled={Boolean(isButtonDisabled)}
                  onClick={() => {
                    if (isCreateTentaclesStep) {
                      onLaunchClaudeCode();
                      return;
                    }

                    onRunStep(step.id);
                  }}
                >
                  {isButtonRunning ? "..." : buttonLabel}
                </button>
              ) : null}
            </article>
          );
        })}
        {isLoading && workspaceSetup === null ? (
          <p className="workspace-setup-card-loading">{t("common.loading")}</p>
        ) : null}
      </div>
    </section>
  );
};
