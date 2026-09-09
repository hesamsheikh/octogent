import { type AgentRuntimeState, isAgentRuntimeState } from "@octogent/core";
import { useT } from "../app/providers/LocaleProvider";
import { StatusBadge, type StatusBadgeTone } from "./ui/StatusBadge";

export type { AgentRuntimeState } from "@octogent/core";
export { isAgentRuntimeState } from "@octogent/core";

type AgentStateBadgeProps = {
  state: AgentRuntimeState;
};

const stateTone = (state: AgentRuntimeState): StatusBadgeTone => {
  switch (state) {
    case "waiting_for_permission":
    case "waiting_for_user":
      return "warning";
    default:
      return state;
  }
};

export const AgentStateBadge = ({ state }: AgentStateBadgeProps) => {
  const t = useT();

  const stateLabel = (s: AgentRuntimeState): string => {
    switch (s) {
      case "waiting_for_permission":
        return t("agentState.permission");
      case "waiting_for_user":
        return t("agentState.waiting");
      default:
        return s.toUpperCase();
    }
  };

  return (
    <StatusBadge
      className="terminal-state-badge"
      label={stateLabel(state)}
      compactLabel={
        state === "waiting_for_permission"
          ? t("agentState.permissionShort")
          : state === "waiting_for_user"
            ? t("agentState.waitingShort")
            : state === "processing"
              ? t("agentState.processingShort")
              : state.toUpperCase()
      }
      tone={stateTone(state)}
    />
  );
};
