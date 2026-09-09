import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/App";
import { jsonResponse, notFoundResponse, resetAppTestHarness } from "./test-utils/appTestHarness";

const mockShellRequests = () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (url.endsWith("/api/terminal-snapshots") && method === "GET") {
      return jsonResponse([]);
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
      return jsonResponse({ locale: "en" });
    }

    return notFoundResponse();
  });
};

describe("App shell and navigation", () => {
  afterEach(() => {
    cleanup();
    resetAppTestHarness();
  });

  it("renders the current shell chrome with navigation hints", async () => {
    mockShellRequests();

    render(<App />);

    expect(await screen.findByLabelText("Runtime status strip")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeInTheDocument();
    expect(screen.getByLabelText("Main content canvas")).toBeInTheDocument();
    expect(screen.getByLabelText("Telemetry ticker tape")).toBeInTheDocument();
    expect(screen.queryByLabelText("Active Agents sidebar")).not.toBeInTheDocument();
    expect(screen.getByText("Press 1-9 to navigate")).toBeInTheDocument();
  });

  it("supports keyboard-first primary navigation with number keys 1-9", async () => {
    mockShellRequests();

    render(<App />);
    await screen.findByRole("navigation", { name: "Primary navigation" });

    fireEvent.keyDown(window, { key: "5" });

    expect(
      screen.getByRole("button", {
        name: "[5] Code Intel",
      }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("renders settings panel when navigating to settings tab", async () => {
    mockShellRequests();

    render(<App />);
    await screen.findByRole("navigation", { name: "Primary navigation" });

    fireEvent.click(
      screen.getByRole("button", {
        name: "[9] Settings",
      }),
    );

    expect(await screen.findByLabelText("Settings primary view")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Soft chime/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retro beep/i })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Show runtime status strip" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enable X Monitor" })).toBeInTheDocument();
  });
});
