import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeleteAllTerminalsDialog } from "../src/components/canvas/DeleteAllTerminalsDialog";
import { renderWithLocale } from "./test-utils/renderWithLocale";

describe("DeleteAllTerminalsDialog", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("surfaces partial failures after refreshing the parent state", async () => {
    const onDeleted = vi.fn();

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/terminals/terminal-a") && method === "DELETE") {
        return new Response(JSON.stringify({ error: "Terminal is busy." }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.endsWith("/api/conversations/session-1") && method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      return new Response("not-found", { status: 404 });
    });

    renderWithLocale(
      <DeleteAllTerminalsDialog
        columns={[
          {
            terminalId: "terminal-a",
            label: "terminal-a",
            state: "live",
            tentacleId: "tentacle-a",
            tentacleName: "Tentacle A",
            createdAt: "2026-02-24T10:00:00.000Z",
          },
        ]}
        nodes={[
          {
            id: "i:session-1",
            type: "inactive-session",
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            pinned: false,
            radius: 12,
            tentacleId: "tentacle-a",
            label: "session-1",
            color: "#ff6b2b",
            sessionId: "session-1",
          },
        ]}
        onCancel={vi.fn()}
        onDeleted={onDeleted}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm delete all terminals" }));

    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledWith({ hadFailures: true });
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Failed to delete 1 item: Tentacle A: Terminal is busy.",
    );
  });
});
