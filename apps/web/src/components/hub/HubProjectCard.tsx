import { formatTimestamp } from "../../app/formatTimestamp";
import { type HubProject, buildProjectPageHref } from "../../app/hub/hubProjects";
import { useLocale, useT } from "../../app/providers/LocaleProvider";

type HubProjectCardProps = {
  project: HubProject;
};

// A plain link on purpose: each project page boots its own app against its
// own API mount, which a full page load gives for free.
export const HubProjectCard = ({ project }: HubProjectCardProps) => {
  const t = useT();
  const locale = useLocale();
  const { summary } = project;

  return (
    <a
      className="hub-project-card"
      data-loaded={project.loaded ? "true" : "false"}
      href={buildProjectPageHref(project.slug)}
    >
      <span className="hub-project-card-header">
        <span className="hub-project-card-name">{project.name}</span>
        <span className="hub-project-card-slug">{project.slug}</span>
      </span>
      <span className="hub-project-card-path">{project.path}</span>
      {summary ? (
        <span className="hub-project-card-stats">
          <span
            className="hub-project-card-stat"
            data-active={summary.runningTerminals > 0 ? "true" : "false"}
          >
            {t("web.hub.running", { count: summary.runningTerminals })}
          </span>
          <span
            className="hub-project-card-stat hub-project-card-stat--review"
            data-active={summary.awaitingReviewTerminals > 0 ? "true" : "false"}
          >
            {t("web.hub.awaitingReview", { count: summary.awaitingReviewTerminals })}
          </span>
          <span className="hub-project-card-activity">
            {summary.lastActivityAt
              ? t("web.hub.lastActivity", {
                  time: formatTimestamp(summary.lastActivityAt, locale),
                })
              : t("web.hub.noActivity")}
          </span>
        </span>
      ) : (
        <span className="hub-project-card-idle">{t("web.hub.notLoaded")}</span>
      )}
    </a>
  );
};
