import { DEFAULT_LOCALE, type Locale } from "@octogent/core";
import { useEffect, useState } from "react";

import { App } from "../App";
import type { HubProject } from "../app/hub/hubProjects";
import type { PageMode } from "../app/hub/pageMode";
import { LocaleProvider } from "../app/providers/LocaleProvider";
import { fetchHubProjects } from "../runtime/hubProjectsClient";
import { HubOverviewView } from "./HubOverviewView";

type RootPageState =
  | { kind: "probing" }
  | { kind: "hub"; projects: HubProject[] }
  | { kind: "app" };

const RootPage = () => {
  const [state, setState] = useState<RootPageState>({ kind: "probing" });
  // The hub keeps no UI state of its own, so the overview starts in the default
  // locale; inside a project the app restores that project's choice.
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    const controller = new AbortController();
    void fetchHubProjects(controller.signal).then((result) => {
      if (controller.signal.aborted) {
        return;
      }
      // Only a real project listing makes this a hub. A single-project server
      // answers 404, and any other failure keeps the page it always was.
      setState(
        result.kind === "hub" ? { kind: "hub", projects: result.projects } : { kind: "app" },
      );
    });
    return () => {
      controller.abort();
    };
  }, []);

  if (state.kind === "probing") {
    return <div className="page console-shell" />;
  }
  if (state.kind === "app") {
    return <App />;
  }
  return (
    <LocaleProvider locale={locale} setLocale={setLocale}>
      <HubOverviewView initialProjects={state.projects} />
    </LocaleProvider>
  );
};

export const PageRoot = ({ mode }: { mode: PageMode }) =>
  mode.kind === "project" ? <App projectKey={mode.projectKey} /> : <RootPage />;
