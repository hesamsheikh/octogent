import type { ComponentProps, ReactNode } from "react";
import { NAV_INDEX } from "../app/constants";
import { FlowPrimaryView } from "./FlowPrimaryView";

import type { PrimaryNavIndex } from "../app/constants";
import type { UseMonitorRuntimeResult } from "../app/hooks/useMonitorRuntime";
import { useT } from "../app/providers/LocaleProvider";
import { ActivityPrimaryView } from "./ActivityPrimaryView";
import { CanvasPrimaryView } from "./CanvasPrimaryView";
import { CodeIntelPrimaryView } from "./CodeIntelPrimaryView";
import { ConversationsPrimaryView } from "./ConversationsPrimaryView";
import { DeckPrimaryView } from "./DeckPrimaryView";
import { MonitorPrimaryView } from "./MonitorPrimaryView";
import { PromptsPrimaryView } from "./PromptsPrimaryView";
import { SettingsPrimaryView } from "./SettingsPrimaryView";

type PrimaryViewRouterProps = {
  flowPrimaryViewProps: React.ComponentProps<typeof FlowPrimaryView>;
  activePrimaryNav: PrimaryNavIndex;
  deckPrimaryViewProps: ComponentProps<typeof DeckPrimaryView>;
  isMonitorVisible: boolean;
  activityPrimaryViewProps: ComponentProps<typeof ActivityPrimaryView>;
  settingsPrimaryViewProps: ComponentProps<typeof SettingsPrimaryView>;
  canvasPrimaryViewProps: ComponentProps<typeof CanvasPrimaryView>;
  monitorRuntime: Pick<
    UseMonitorRuntimeResult,
    | "monitorConfig"
    | "monitorFeed"
    | "monitorError"
    | "isRefreshingMonitorFeed"
    | "isSavingMonitorConfig"
    | "refreshMonitorFeed"
    | "patchMonitorConfig"
  >;
  conversationsEnabled: boolean;
  onConversationsSidebarContent: (content: ReactNode) => void;
  onConversationsActionPanel: (content: ReactNode) => void;
  promptsEnabled: boolean;
  onPromptsSidebarContent: (content: ReactNode) => void;
};

export const PrimaryViewRouter = ({
  flowPrimaryViewProps,
  activePrimaryNav,
  deckPrimaryViewProps,
  isMonitorVisible,
  activityPrimaryViewProps,
  settingsPrimaryViewProps,
  canvasPrimaryViewProps,
  monitorRuntime,
  conversationsEnabled,
  onConversationsSidebarContent,
  onConversationsActionPanel,
  promptsEnabled,
  onPromptsSidebarContent,
}: PrimaryViewRouterProps) => {
  const t = useT();
  if (activePrimaryNav === NAV_INDEX.deck) {
    return <DeckPrimaryView {...deckPrimaryViewProps} />;
  }

  if (activePrimaryNav === NAV_INDEX.activity) {
    return <ActivityPrimaryView {...activityPrimaryViewProps} />;
  }

  if (activePrimaryNav === NAV_INDEX.codeIntel) {
    return <CodeIntelPrimaryView enabled={activePrimaryNav === NAV_INDEX.codeIntel} />;
  }

  if (activePrimaryNav === NAV_INDEX.monitor) {
    if (isMonitorVisible) {
      return <MonitorPrimaryView monitorRuntime={monitorRuntime} />;
    }
    return (
      <section className="monitor-view" aria-label={t("web.a11y.monitorViewDisabled")}>
        <section className="monitor-panel monitor-panel--configure">
          <h3>{t("web.monitor.disabledTitle")}</h3>
          <p>{t("web.monitor.disabledDesc")}</p>
        </section>
      </section>
    );
  }

  if (activePrimaryNav === NAV_INDEX.conversations) {
    return (
      <ConversationsPrimaryView
        enabled={conversationsEnabled}
        onSidebarContent={onConversationsSidebarContent}
        onActionPanel={onConversationsActionPanel}
      />
    );
  }

  if (activePrimaryNav === NAV_INDEX.prompts) {
    return (
      <PromptsPrimaryView enabled={promptsEnabled} onSidebarContent={onPromptsSidebarContent} />
    );
  }

  if (activePrimaryNav === NAV_INDEX.settings) {
    return <SettingsPrimaryView {...settingsPrimaryViewProps} />;
  }

  if (activePrimaryNav === NAV_INDEX.flow) {
    return <FlowPrimaryView {...flowPrimaryViewProps} />;
  }

  return <CanvasPrimaryView {...canvasPrimaryViewProps} />;
};
