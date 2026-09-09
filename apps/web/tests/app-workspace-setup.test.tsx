import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceSetupSnapshot } from "@octogent/core";

import { App } from "../src/App";
import { jsonResponse, notFoundResponse, resetAppTestHarness } from "./test-utils/appTestHarness";

const buildSetupSnapshot = (
  overrides: Partial<WorkspaceSetupSnapshot> = {},
): WorkspaceSetupSnapshot => ({
  isFirstRun: true,
  shouldShowSetupCard: true,
  hasAnyTentacles: false,
  tentacleCount: 0,
  steps: [
    {
      id: "initialize-workspace",
      title: "Initialize workspace",
      description: "Create Octogent project files and runtime directories.",
      complete: false,
      required: true,
      actionLabel: "Initialize workspace",
      statusText: "Create .octogent project files before continuing.",
      guidance: "Workspace initialization failed. Run the Octogent initializer in this repository.",
      command: "octogent init",
    },
    {
      id: "ensure-gitignore",
      title: "Ignore .octogent",
      description: "Add .octogent to .gitignore, or create .gitignore when it is missing.",
      complete: false,
      required: true,
      actionLabel: "Update .gitignore",
      statusText: "Add .octogent to .gitignore before creating tentacles.",
      guidance:
        "Git ignore entry is missing. Create or update .gitignore with the Octogent workspace path.",
      command: "printf '.octogent\\n' >> .gitignore",
    },
    {
      id: "check-claude",
      title: "Check Claude Code",
      description: "Verify the default Claude Code workflow is available on this machine.",
      complete: true,
      required: false,
      actionLabel: "Check Claude Code",
      statusText: "Claude Code is available.",
      guidance: null,
      command: null,
    },
    {
      id: "check-git",
      title: "Check Git",
      description: "Verify Git is available for worktree-backed tentacles.",
      complete: true,
      required: false,
      actionLabel: "Check Git",
      statusText: "Git is available.",
      guidance: null,
      command: null,
    },
    {
      id: "check-curl",
      title: "Check curl",
      description: "Verify curl is available for Claude hook callbacks.",
      complete: true,
      required: false,
      actionLabel: "Check curl",
      statusText: "curl is available.",
      guidance: null,
      command: null,
    },
    {
      id: "create-tentacles",
      title: "Create tentacles",
      description: "Create at least one tentacle before launching a coding agent.",
      complete: false,
      required: true,
      actionLabel: null,
      statusText: "Create your first tentacle to continue.",
      guidance: "Use the planner or manual creation to add at least one tentacle.",
      command: null,
    },
  ],
  ...overrides,
});

const mockAppRequests = (
  resolveSetup: () => WorkspaceSetupSnapshot,
  options: {
    onEnsureGitignoreStep?: () => WorkspaceSetupSnapshot;
  } = {},
) => {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (url.endsWith("/api/terminal-snapshots") && method === "GET") {
      return jsonResponse([]);
    }

    if (url.endsWith("/api/deck/tentacles") && method === "GET") {
      return jsonResponse([]);
    }

    if (url.endsWith("/api/setup") && method === "GET") {
      return jsonResponse(resolveSetup());
    }

    if (url.endsWith("/api/setup/steps/ensure-gitignore") && method === "POST") {
      return jsonResponse(
        options.onEnsureGitignoreStep ? options.onEnsureGitignoreStep() : resolveSetup(),
      );
    }

    if (url.endsWith("/api/codex/usage") && method === "GET") {
      return jsonResponse({
        status: "unavailable",
        source: "none",
        fetchedAt: "2026-02-27T12:00:00.000Z",
      });
    }

    if (url.endsWith("/api/claude/usage") && method === "GET") {
      return jsonResponse({
        status: "unavailable",
        source: "none",
        fetchedAt: "2026-02-27T12:00:00.000Z",
      });
    }

    if (url.endsWith("/api/github/summary") && method === "GET") {
      return jsonResponse({
        status: "unavailable",
        source: "none",
        fetchedAt: "2026-02-27T12:00:00.000Z",
        commitsPerDay: [],
      });
    }

    if (url.includes("/api/analytics/usage-heatmap") && method === "GET") {
      return jsonResponse({
        days: [],
        projects: [],
        models: [],
      });
    }

    if (url.endsWith("/api/ui-state") && method === "GET") {
      return jsonResponse({ locale: "en", navSchemaVersion: 2, activePrimaryNav: 2 });
    }

    if (url.endsWith("/api/ui-state") && method === "PATCH") {
      return jsonResponse({ locale: "en", navSchemaVersion: 2, activePrimaryNav: 2 });
    }

    return notFoundResponse();
  });
};

describe("App workspace setup", () => {
  afterEach(() => {
    cleanup();
    resetAppTestHarness();
  });

  it("shows the setup card inside the normal Agents view on a fresh workspace", async () => {
    const currentSetup = buildSetupSnapshot();
    mockAppRequests(() => currentSetup);

    render(<App />);

    expect(await screen.findByLabelText("Workspace setup")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeInTheDocument();
    expect(screen.getByLabelText("Main content canvas")).toBeInTheDocument();
    expect(screen.getByLabelText("Canvas graph view")).toBeInTheDocument();
    expect(screen.getByLabelText("Runtime status strip")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "[2] Agents",
      }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("only marks a setup step complete after the refreshed server snapshot says it is done", async () => {
    let currentSetup = buildSetupSnapshot();
    mockAppRequests(() => currentSetup, {
      onEnsureGitignoreStep: () => {
        currentSetup = buildSetupSnapshot({
          steps: buildSetupSnapshot().steps.map((step) =>
            step.id === "ensure-gitignore"
              ? {
                  ...step,
                  complete: true,
                  statusText: ".gitignore covers .octogent.",
                  guidance: null,
                  command: null,
                }
              : step,
          ),
        });
        return currentSetup;
      },
    });

    render(<App />);

    const setupCard = await screen.findByLabelText("Workspace setup");
    fireEvent.click(within(setupCard).getByRole("button", { name: "Update .gitignore" }));

    await waitFor(() => {
      const gitignoreStep = screen.getByText("Ignore .octogent").closest(".workspace-setup-step");
      expect(gitignoreStep).not.toBeNull();
      expect(within(gitignoreStep as HTMLElement).getByText("Done")).toBeInTheDocument();
    });
  });
});
