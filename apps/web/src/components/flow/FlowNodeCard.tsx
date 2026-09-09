import { agentProviderLabel, agentProviderSummary } from "../../app/agentProviderLabel";
import type { FlowNode } from "../../app/flow/layout";
import { useT } from "../../app/providers/LocaleProvider";

type Translate = ReturnType<typeof useT>;

const roleLine = (node: FlowNode, t: Translate): string => {
  switch (node.role) {
    case "octoboss":
      return t("web.flow.octobossIntro");
    case "tentacle":
      return node.description?.trim() || t("web.flow.tentacleIntroFallback");
    case "coordinator":
      return t("web.flow.role.coordinator", { count: node.childCount ?? 0 });
    default:
      return node.workspaceMode === "worktree"
        ? t("web.flow.role.worker.worktree")
        : t("web.flow.role.worker.shared");
  }
};

/** Which agent CLI(s) sit behind the node: one for an agent, the distinct set for a tentacle. */
const agentLine = (node: FlowNode, t: Translate): string | null => {
  if (node.kind === "agent" && node.agentProvider) {
    // Requested model first, then what the agent's own transcript reported,
    // else say plainly that the provider's default is at work.
    return agentProviderSummary(
      node.agentProvider,
      node.agentModel ?? node.agentModelObserved ?? t("web.flow.defaultModel"),
    );
  }
  if (node.kind === "tentacle" && node.agentProviders && node.agentProviders.length > 0) {
    return node.agentProviders.map(agentProviderLabel).join(" · ");
  }
  return null;
};

type StepTexts = { prev: string; now: string; next: string };

const tentacleSteps = (node: FlowNode, t: Translate): StepTexts => {
  const items = node.todoItems ?? [];
  if (items.length === 0) {
    return { prev: t("web.flow.none"), now: t("web.flow.noTodos"), next: t("web.flow.none") };
  }
  const doneItems = items.filter((item) => item.done);
  const openItems = items.filter((item) => !item.done);
  return {
    prev: doneItems.length > 0 ? (doneItems[doneItems.length - 1]?.text ?? "") : t("web.flow.none"),
    now: openItems[0]?.text ?? t("web.flow.allTodosDone"),
    next: openItems[1]?.text ?? t("web.flow.none"),
  };
};

const agentSteps = (node: FlowNode, t: Translate): StepTexts => {
  // Prev: the most recent commit is the last concrete thing the agent finished.
  const lastCommit = node.completionSummary?.commits[0]?.message;
  const prev = lastCommit ?? t("web.flow.none");

  let now: string;
  if (node.agentState === "awaiting-review") {
    now = t("web.flow.now.review");
  } else if (node.agentState === "completed") {
    now = t("web.flow.now.done");
  } else if (node.agentState === "stopped" || node.agentState === "exited") {
    now = t("web.flow.now.offline");
  } else if (node.runtimeState === "processing") {
    now = node.runtimeToolName
      ? t("web.flow.now.tool", { tool: node.runtimeToolName })
      : t("web.flow.now.processing");
  } else if (node.runtimeState === "waiting_for_permission") {
    now = t("web.flow.now.permission");
  } else if (node.runtimeState === "waiting_for_user") {
    now = t("web.flow.now.waitingUser");
  } else {
    now = t("web.flow.now.idle");
  }

  let next: string;
  if (node.agentState === "awaiting-review") {
    next = t("web.flow.next.review");
  } else if (node.agentState === "completed") {
    next = t("web.flow.next.done");
  } else if (node.runtimeState === "processing") {
    next = t("web.flow.next.continue");
  } else {
    next = t("web.flow.next.await");
  }

  return { prev, now, next };
};

export const FlowNodeCard = ({
  node,
  onOpenTerminal,
}: {
  node: FlowNode;
  onOpenTerminal?: ((terminalId: string) => void) | undefined;
}) => {
  const t = useT();
  const summary = node.completionSummary;
  const steps =
    node.kind === "tentacle"
      ? tentacleSteps(node, t)
      : node.kind === "agent"
        ? agentSteps(node, t)
        : null;

  return (
    <div className="flow-card">
      <div className="flow-card-title-row">
        <span className="flow-card-title">{node.label}</span>
        {node.agentState && (
          <span className={`flow-card-state flow-card-state--${node.agentState}`}>
            {t(`agentState.${node.agentState}`)}
          </span>
        )}
      </div>

      <p className="flow-card-role">{roleLine(node, t)}</p>

      {agentLine(node, t) && (
        <p className="flow-card-agent">
          <span className="flow-card-agent-label">{t("common.agent")}</span>
          {agentLine(node, t)}
        </p>
      )}

      {node.kind === "tentacle" && node.todoTotal !== undefined && (
        <div className="flow-card-progress">
          <div className="flow-card-progress-track">
            <div
              className="flow-card-progress-fill"
              style={{
                width: `${node.todoTotal > 0 ? Math.round(((node.todoDone ?? 0) / node.todoTotal) * 100) : 0}%`,
              }}
            />
          </div>
          <span className="flow-card-progress-text">
            {t("web.flow.todoProgress", { done: node.todoDone ?? 0, total: node.todoTotal })}
          </span>
        </div>
      )}

      {steps && (
        <dl className="flow-card-steps">
          <div className="flow-card-step flow-card-step--prev">
            <dt>{t("web.flow.step.prev")}</dt>
            <dd>{steps.prev}</dd>
          </div>
          <div className="flow-card-step flow-card-step--now">
            <dt>{t("web.flow.step.now")}</dt>
            <dd>{steps.now}</dd>
          </div>
          <div className="flow-card-step flow-card-step--next">
            <dt>{t("web.flow.step.next")}</dt>
            <dd>{steps.next}</dd>
          </div>
        </dl>
      )}

      {summary && summary.commits.length > 0 && (
        <p className="flow-card-facts">
          {t("web.flow.commitsSummary", {
            count: summary.commits.length,
            ins: summary.insertions,
            del: summary.deletions,
          })}
          {summary.branch && (
            <>
              <br />
              {summary.branch}
              {summary.merged ? " ✓" : ""}
            </>
          )}
        </p>
      )}

      {node.kind === "agent" && node.refId && onOpenTerminal && (
        <button
          type="button"
          className="flow-card-open"
          onClick={(event) => {
            event.stopPropagation();
            onOpenTerminal(node.refId as string);
          }}
        >
          {t("web.flow.openTerminal")}
        </button>
      )}
    </div>
  );
};
