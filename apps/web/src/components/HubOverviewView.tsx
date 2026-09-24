import { usePollingData } from "../app/hooks/usePollingData";
import {
  HUB_PROJECTS_REFRESH_MS,
  type HubProject,
  normalizeHubProjects,
} from "../app/hub/hubProjects";
import { useT } from "../app/providers/LocaleProvider";
import { buildHubProjectsUrl } from "../runtime/runtimeEndpoints";
import { HubAddProjectForm } from "./hub/HubAddProjectForm";
import { HubProjectCard } from "./hub/HubProjectCard";

type HubOverviewViewProps = {
  /** The list the entry probe already fetched, shown until the first refresh lands. */
  initialProjects?: HubProject[];
};

const noProjects = (): HubProject[] => [];

export const HubOverviewView = ({ initialProjects }: HubOverviewViewProps) => {
  const t = useT();
  const { data, refresh } = usePollingData<HubProject[]>({
    fetchUrl: buildHubProjectsUrl(),
    intervalMs: HUB_PROJECTS_REFRESH_MS,
    normalize: normalizeHubProjects,
    fallback: noProjects,
  });
  const projects = data ?? initialProjects ?? null;

  return (
    <main className="hub-overview" aria-label={t("web.hub.a11y.overview")}>
      <header className="hub-overview-bar">
        <span className="hub-overview-brand">Octogent</span>
        <h1 className="hub-overview-title">{t("web.hub.title")}</h1>
      </header>

      <div className="hub-overview-body">
        <p className="hub-overview-subtitle">{t("web.hub.subtitle")}</p>

        {projects === null ? (
          <p className="hub-overview-status">{t("web.hub.loading")}</p>
        ) : projects.length === 0 ? (
          <p className="hub-overview-status">{t("web.hub.empty")}</p>
        ) : (
          <ul className="hub-project-grid" aria-label={t("web.hub.title")}>
            {projects.map((project) => (
              <li key={project.id}>
                <HubProjectCard project={project} />
              </li>
            ))}
          </ul>
        )}

        <HubAddProjectForm onRegistered={refresh} />
      </div>
    </main>
  );
};
