import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PageRoot } from "../src/components/PageRoot";
import { resetAppTestHarness } from "./test-utils/appTestHarness";
import { stubHubFetch } from "./test-utils/hubFixtures";

// The real App needs a whole runtime behind it; these tests only care which page is chosen.
vi.mock("../src/App", () => ({
  App: ({ projectKey }: { projectKey?: string }) => (
    <div data-testid="project-app">{projectKey ?? "single-project"}</div>
  ),
}));

describe("PageRoot", () => {
  afterEach(() => {
    resetAppTestHarness();
  });

  it("renders the app as before when /api/projects is 404 (a single-project server)", async () => {
    stubHubFetch({ listing: null });
    render(<PageRoot mode={{ kind: "root" }} />);

    expect(await screen.findByTestId("project-app")).toHaveTextContent("single-project");
    expect(screen.queryByRole("link", { name: /Key Cluster/ })).not.toBeInTheDocument();
  });

  it("renders the project overview when the server is a hub", async () => {
    stubHubFetch();
    render(<PageRoot mode={{ kind: "root" }} />);

    expect(await screen.findByRole("link", { name: /Key Cluster/ })).toHaveAttribute(
      "href",
      "/p/keycluster/",
    );
    expect(screen.queryByTestId("project-app")).not.toBeInTheDocument();
  });

  it("falls back to the app when the hub probe fails outright", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    render(<PageRoot mode={{ kind: "root" }} />);

    expect(await screen.findByTestId("project-app")).toHaveTextContent("single-project");
  });

  it("renders the app for a project page without probing for a hub", () => {
    const hub = stubHubFetch();
    render(<PageRoot mode={{ kind: "project", projectKey: "keycluster" }} />);

    expect(screen.getByTestId("project-app")).toHaveTextContent("keycluster");
    expect(hub.listingRequests()).toBe(0);
  });
});
