import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HubOverviewView } from "../src/components/HubOverviewView";
import { jsonResponse, resetAppTestHarness } from "./test-utils/appTestHarness";
import { hubListing, stubHubFetch } from "./test-utils/hubFixtures";
import { renderWithLocale } from "./test-utils/renderWithLocale";

describe("HubOverviewView", () => {
  afterEach(() => {
    vi.useRealTimers();
    resetAppTestHarness();
  });

  it("renders one card per project with its counts and a link to its page", async () => {
    stubHubFetch();
    renderWithLocale(<HubOverviewView />);

    const keycluster = await screen.findByRole("link", { name: /Key Cluster/ });
    expect(keycluster).toHaveAttribute("href", "/p/keycluster/");
    expect(within(keycluster).getByText("2 running")).toBeInTheDocument();
    expect(within(keycluster).getByText("1 awaiting review")).toBeInTheDocument();
    expect(within(keycluster).getByText("/work/keycluster")).toBeInTheDocument();
    expect(within(keycluster).getByText("keycluster")).toBeInTheDocument();
    expect(within(keycluster).getByText(/^last activity /)).toBeInTheDocument();

    const docs = screen.getByRole("link", { name: /Docs Site/ });
    expect(docs).toHaveAttribute("href", "/p/docs/");
    expect(within(docs).getByText("not loaded")).toBeInTheDocument();
    expect(within(docs).queryByText(/running/)).not.toBeInTheDocument();
  });

  it("shows projects handed over by the entry probe before its own fetch lands", async () => {
    stubHubFetch();
    renderWithLocale(
      <HubOverviewView
        initialProjects={[
          {
            id: "abc-123",
            name: "Key Cluster",
            slug: "keycluster",
            path: "/work/keycluster",
            loaded: false,
            summary: null,
          },
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: /Key Cluster/ })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /Docs Site/ })).toBeInTheDocument();
  });

  it("says so when the hub has no projects yet", async () => {
    stubHubFetch({ listing: { projects: [] } });
    renderWithLocale(<HubOverviewView />);

    expect(await screen.findByText("No projects registered yet.")).toBeInTheDocument();
  });

  it("registers an absolute path through the add form and refreshes the list", async () => {
    let projects: unknown[] = [...hubListing.projects];
    const hub = stubHubFetch({
      listing: () => ({ projects }),
      onRegister: (body) => {
        if (typeof body.path !== "string") {
          return jsonResponse({ error: "path must be an absolute path." }, 400);
        }
        const entry = { id: "ghi-789", name: "New App", slug: "new-app", path: body.path };
        projects = [...projects, { ...entry, loaded: false }];
        return jsonResponse({ ...entry, loaded: false }, 201);
      },
    });
    renderWithLocale(<HubOverviewView />);

    const input = await screen.findByRole("textbox", { name: "Absolute path" });
    fireEvent.change(input, { target: { value: "  /work/new-app  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("Registered New App.")).toBeInTheDocument();
    expect(hub.calls).toContainEqual({
      url: "/api/projects",
      method: "POST",
      body: { path: "/work/new-app" },
    });
    expect(await screen.findByRole("link", { name: /New App/ })).toHaveAttribute(
      "href",
      "/p/new-app/",
    );
    expect(input).toHaveValue("");
  });

  it("shows the server's reason when a path is rejected", async () => {
    stubHubFetch({
      onRegister: (body) =>
        jsonResponse(
          {
            error:
              typeof body.path === "string"
                ? `Not a directory: ${body.path}`
                : "path must be an absolute path.",
          },
          400,
        ),
    });
    renderWithLocale(<HubOverviewView />);

    const input = await screen.findByRole("textbox", { name: "Absolute path" });
    fireEvent.change(input, { target: { value: "/nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Not a directory: /nope");
    expect(input).toHaveValue("/nope");
  });

  it("hides the add form on 403 and points to the CLI instead", async () => {
    stubHubFetch({ onRegister: () => jsonResponse({ error: "Origin not allowed." }, 403) });
    renderWithLocale(<HubOverviewView />);

    expect(await screen.findByText("octogent init")).toBeInTheDocument();
    expect(screen.getByText("octogent projects")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Absolute path" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add" })).not.toBeInTheDocument();
  });

  it("hides the add form on 401", async () => {
    stubHubFetch({ onRegister: () => jsonResponse({ error: "Access token required." }, 401) });
    renderWithLocale(<HubOverviewView />);

    expect(await screen.findByText("octogent init")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Absolute path" })).not.toBeInTheDocument();
  });

  it("refreshes the project list every 15 seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const hub = stubHubFetch();
    renderWithLocale(<HubOverviewView />);

    await screen.findByRole("link", { name: /Key Cluster/ });
    expect(hub.listingRequests()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await waitFor(() => {
      expect(hub.listingRequests()).toBe(2);
    });
  });
});
