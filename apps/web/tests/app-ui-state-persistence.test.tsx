import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/App";
import { jsonResponse, notFoundResponse, resetAppTestHarness } from "./test-utils/appTestHarness";

describe("App UI state persistence", () => {
  afterEach(() => {
    cleanup();
    resetAppTestHarness();
  });

  it("hydrates ui state from the API and persists ui changes back to the API", async () => {
    const uiStatePatchBodies: Array<Record<string, unknown>> = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/terminal-snapshots") && method === "GET") {
        return jsonResponse([]);
      }

      if (url.endsWith("/api/claude/usage") && method === "GET") {
        return jsonResponse({
          status: "unavailable",
          fetchedAt: "2026-02-24T10:00:00.000Z",
          source: "none",
        });
      }

      if (url.endsWith("/api/codex/usage") && method === "GET") {
        return jsonResponse({
          status: "unavailable",
          fetchedAt: "2026-02-24T10:00:00.000Z",
          source: "none",
        });
      }

      if (url.endsWith("/api/github/summary") && method === "GET") {
        return jsonResponse({
          status: "unavailable",
          source: "none",
          fetchedAt: "2026-02-24T10:00:00.000Z",
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
        return jsonResponse({
          locale: "en",
          activePrimaryNav: 8,
          isRuntimeStatusStripVisible: false,
          isMonitorVisible: false,
          isBottomTelemetryVisible: false,
          terminalCompletionSound: "retro-beep",
        });
      }

      if (url.endsWith("/api/ui-state") && method === "PATCH") {
        const body = init?.body;
        if (typeof body === "string") {
          uiStatePatchBodies.push(JSON.parse(body) as Record<string, unknown>);
        }

        return new Response(body ?? "{}", {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }

      return notFoundResponse();
    });

    render(<App />);

    expect(await screen.findByLabelText("Settings primary view")).toBeInTheDocument();
    expect(screen.queryByLabelText("Runtime status strip")).toBeNull();
    expect(screen.queryByLabelText("Telemetry ticker tape")).toBeNull();
    expect(screen.getByRole("button", { name: /Retro beep/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("switch", { name: "Show runtime status strip" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByRole("switch", { name: "Enable X Monitor" })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    fireEvent.click(screen.getByRole("switch", { name: "Show runtime status strip" }));
    fireEvent.click(screen.getByRole("switch", { name: "Enable X Monitor" }));
    fireEvent.click(screen.getByRole("button", { name: /Double beep/i }));

    await waitFor(() => {
      expect(uiStatePatchBodies.some((body) => body.isRuntimeStatusStripVisible === true)).toBe(
        true,
      );
      expect(uiStatePatchBodies.some((body) => body.isMonitorVisible === true)).toBe(true);
      expect(
        uiStatePatchBodies.some((body) => body.terminalCompletionSound === "double-beep"),
      ).toBe(true);
    });
  });
});
