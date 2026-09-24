import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProjectSwitcher } from "../src/components/ProjectSwitcher";
import { resetAppTestHarness } from "./test-utils/appTestHarness";
import { stubHubFetch } from "./test-utils/hubFixtures";
import { renderWithLocale } from "./test-utils/renderWithLocale";

describe("ProjectSwitcher", () => {
  afterEach(() => {
    resetAppTestHarness();
  });

  it("names the current project, found by slug or id", async () => {
    stubHubFetch();
    renderWithLocale(<ProjectSwitcher projectKey="abc-123" />);

    expect(await screen.findByRole("button", { name: /Key Cluster/ })).toBeInTheDocument();
  });

  it("shows the page key until the project list arrives", () => {
    stubHubFetch();
    renderWithLocale(<ProjectSwitcher projectKey="keycluster" />);

    expect(screen.getByRole("button", { name: /keycluster/ })).toBeInTheDocument();
  });

  it("lists every project as a link to its page plus the overview", async () => {
    stubHubFetch();
    renderWithLocale(<ProjectSwitcher projectKey="keycluster" />);

    fireEvent.click(await screen.findByRole("button", { name: /Key Cluster/ }));
    const menu = screen.getByRole("list", { name: "Projects" });

    expect(within(menu).getByRole("link", { name: "All projects" })).toHaveAttribute("href", "/");
    const current = within(menu).getByRole("link", { name: /Key Cluster/ });
    expect(current).toHaveAttribute("href", "/p/keycluster/");
    expect(current).toHaveAttribute("aria-current", "page");
    expect(within(menu).getByRole("link", { name: /Docs Site/ })).toHaveAttribute(
      "href",
      "/p/docs/",
    );
  });

  it("closes on Escape", async () => {
    stubHubFetch();
    renderWithLocale(<ProjectSwitcher projectKey="keycluster" />);

    const toggle = await screen.findByRole("button", { name: /Key Cluster/ });
    fireEvent.click(toggle);
    expect(screen.getByRole("list", { name: "Projects" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("list", { name: "Projects" })).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});
