import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RuntimeStatusStrip } from "../src/components/RuntimeStatusStrip";
import { renderWithLocale } from "./test-utils/renderWithLocale";

describe("RuntimeStatusStrip", () => {
  it("shows loading placeholders before claude usage loads", () => {
    renderWithLocale(<RuntimeStatusStrip sparklinePoints="" usageData={null} claudeUsage={null} />);

    const usage = screen.getByLabelText("Claude usage limits");
    expect(within(usage).getAllByText("···")).toHaveLength(2);
  });

  it("uses a 5h label for oauth-backed usage", () => {
    renderWithLocale(
      <RuntimeStatusStrip
        sparklinePoints=""
        usageData={null}
        claudeUsage={{
          status: "ok",
          source: "oauth-api",
          fetchedAt: "2026-04-09T10:00:00.000Z",
          primaryUsedPercent: 14,
          secondaryUsedPercent: 52,
        }}
      />,
    );

    const usage = screen.getByLabelText("Claude usage limits");
    expect(within(usage).getByText("5h")).toBeInTheDocument();
    expect(within(usage).getByText("14%")).toBeInTheDocument();
    expect(within(usage).getByText("52%")).toBeInTheDocument();
  });

  it("shows a scoped weekly row when the snapshot carries a scoped limit", () => {
    renderWithLocale(
      <RuntimeStatusStrip
        sparklinePoints=""
        usageData={null}
        claudeUsage={{
          status: "ok",
          source: "oauth-api",
          fetchedAt: "2026-04-09T10:00:00.000Z",
          primaryUsedPercent: 14,
          secondaryUsedPercent: 52,
          scopedUsedPercent: 45,
          scopedResetAt: "2026-04-13T09:00:00.000Z",
          scopedLabel: "Fable",
        }}
      />,
    );

    const usage = screen.getByLabelText("Claude usage limits");
    expect(within(usage).getByText("Week (Fable)")).toBeInTheDocument();
    expect(within(usage).getByText("45%")).toBeInTheDocument();
  });

  it("hides the scoped weekly row when the snapshot has no scoped limit", () => {
    renderWithLocale(
      <RuntimeStatusStrip
        sparklinePoints=""
        usageData={null}
        claudeUsage={{
          status: "ok",
          source: "oauth-api",
          fetchedAt: "2026-04-09T10:00:00.000Z",
          primaryUsedPercent: 14,
          secondaryUsedPercent: 52,
        }}
      />,
    );

    const usage = screen.getByLabelText("Claude usage limits");
    expect(within(usage).queryByText(/Week \(Fable\)/)).toBeNull();
    expect(within(usage).getAllByText(/%$/)).toHaveLength(2);
  });

  it("shows unavailable values instead of a permanent loading state", () => {
    renderWithLocale(
      <RuntimeStatusStrip
        sparklinePoints=""
        usageData={null}
        claudeUsage={{
          status: "unavailable",
          source: "none",
          fetchedAt: "2026-04-09T10:00:00.000Z",
          message: "Claude credentials not found. Run `claude login`.",
        }}
      />,
    );

    const usage = screen.getByLabelText("Claude usage limits");
    expect(within(usage).getAllByText("NA")).toHaveLength(2);
    expect(within(usage).queryByText("···")).toBeNull();
  });

  it("marks the refresh button as rotating while Claude usage is refreshing", () => {
    renderWithLocale(
      <RuntimeStatusStrip
        sparklinePoints=""
        usageData={null}
        claudeUsage={null}
        isRefreshingClaudeUsage
        onRefreshClaudeUsage={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Refresh Claude usage" })).toHaveAttribute(
      "data-refreshing",
      "true",
    );
  });
});
