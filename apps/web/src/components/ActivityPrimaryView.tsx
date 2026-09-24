import type { ComponentProps } from "react";

import { useT } from "../app/providers/LocaleProvider";
import { GitHubPrimaryView } from "./GitHubPrimaryView";
import { UsageBarChart } from "./UsageHeatmap";

type ActivityPrimaryViewProps = {
  usageChartProps: ComponentProps<typeof UsageBarChart>;
  githubPrimaryViewProps: ComponentProps<typeof GitHubPrimaryView>;
};

export const ActivityPrimaryView = ({
  usageChartProps,
  githubPrimaryViewProps,
}: ActivityPrimaryViewProps) => {
  const t = useT();
  return (
    <section className="activity-view" aria-label={t("web.a11y.activityView")}>
      <UsageBarChart {...usageChartProps} />
      <GitHubPrimaryView {...githubPrimaryViewProps} />
    </section>
  );
};
