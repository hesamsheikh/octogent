import { useCallback, useEffect, useRef, useState } from "react";

import { type HubProject, buildProjectPageHref, findProjectByKey } from "../app/hub/hubProjects";
import { decodeProjectKey } from "../app/hub/pageMode";
import { useT } from "../app/providers/LocaleProvider";
import { fetchHubProjects } from "../runtime/hubProjectsClient";

type ProjectSwitcherProps = {
  /** The `/p/<key>/` segment of this page, as the address bar encodes it. */
  projectKey: string;
};

export const ProjectSwitcher = ({ projectKey }: ProjectSwitcherProps) => {
  const t = useT();
  const [projects, setProjects] = useState<HubProject[] | null>(null);
  const [hasLoadFailed, setHasLoadFailed] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const loadProjects = useCallback(async (signal?: AbortSignal) => {
    const result = await fetchHubProjects(signal);
    if (signal?.aborted) {
      return;
    }
    if (result.kind === "hub") {
      setProjects(result.projects);
      setHasLoadFailed(false);
    } else {
      setHasLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadProjects(controller.signal);
    return () => {
      controller.abort();
    };
  }, [loadProjects]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isOpen]);

  const currentProject = projects ? findProjectByKey(projects, projectKey) : null;
  const currentName = currentProject?.name ?? decodeProjectKey(projectKey);

  return (
    <div className="project-switcher" ref={containerRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="true"
        className="project-switcher-toggle"
        onClick={() => {
          if (!isOpen) {
            // Projects come and go on the hub; the list is re-read each time it opens.
            void loadProjects();
          }
          setIsOpen((current) => !current);
        }}
        title={t("web.hub.switcher.label")}
        type="button"
      >
        <span className="project-switcher-name">{currentName}</span>
        <span aria-hidden="true" className="project-switcher-caret">
          ▾
        </span>
      </button>
      {isOpen && (
        <ul className="project-switcher-menu" aria-label={t("web.hub.title")}>
          <li>
            <a className="project-switcher-item project-switcher-item--all" href="/">
              {t("web.hub.switcher.allProjects")}
            </a>
          </li>
          {(projects ?? []).map((project) => (
            <li key={project.id}>
              <a
                aria-current={project.id === currentProject?.id ? "page" : undefined}
                className="project-switcher-item"
                href={buildProjectPageHref(project.slug)}
              >
                <span className="project-switcher-item-name">{project.name}</span>
                <span className="project-switcher-item-slug">{project.slug}</span>
              </a>
            </li>
          ))}
          {hasLoadFailed && projects === null && (
            <li className="project-switcher-empty">{t("web.hub.switcher.unavailable")}</li>
          )}
        </ul>
      )}
    </div>
  );
};
