import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ensureDirectoryTrusted } from "../src/claudeTrust";

const roots: string[] = [];
const makeConfigPath = () => {
  const root = mkdtempSync(join(tmpdir(), "octogent-trust-"));
  roots.push(root);
  return join(root, ".claude.json");
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("ensureDirectoryTrusted", () => {
  it("marks a fresh worktree trusted so the interactive trust prompt never blocks it", () => {
    const configPath = makeConfigPath();
    writeFileSync(configPath, JSON.stringify({ projects: {} }), "utf-8");

    expect(ensureDirectoryTrusted("/work/tree", configPath)).toBe(true);

    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.projects["/work/tree"].hasTrustDialogAccepted).toBe(true);
  });

  it("preserves the rest of the operator's config", () => {
    const configPath = makeConfigPath();
    writeFileSync(
      configPath,
      JSON.stringify({
        userID: "keep-me",
        projects: {
          "/other": { hasTrustDialogAccepted: false, allowedTools: ["Bash"] },
        },
      }),
      "utf-8",
    );

    ensureDirectoryTrusted("/work/tree", configPath);

    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.userID).toBe("keep-me");
    expect(config.projects["/other"]).toEqual({
      hasTrustDialogAccepted: false,
      allowedTools: ["Bash"],
    });
  });

  it("keeps a project's other settings when flipping its trust flag", () => {
    const configPath = makeConfigPath();
    writeFileSync(
      configPath,
      JSON.stringify({
        projects: { "/work/tree": { hasTrustDialogAccepted: false, allowedTools: ["Read"] } },
      }),
      "utf-8",
    );

    ensureDirectoryTrusted("/work/tree", configPath);

    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.projects["/work/tree"]).toEqual({
      hasTrustDialogAccepted: true,
      allowedTools: ["Read"],
    });
  });

  it("reports no change when the directory is already trusted", () => {
    const configPath = makeConfigPath();
    writeFileSync(
      configPath,
      JSON.stringify({ projects: { "/work/tree": { hasTrustDialogAccepted: true } } }),
      "utf-8",
    );

    expect(ensureDirectoryTrusted("/work/tree", configPath)).toBe(false);
  });

  it("creates the config when the operator has never run Claude Code", () => {
    const configPath = makeConfigPath();

    expect(ensureDirectoryTrusted("/work/tree", configPath)).toBe(true);
    expect(
      JSON.parse(readFileSync(configPath, "utf-8")).projects["/work/tree"].hasTrustDialogAccepted,
    ).toBe(true);
  });

  it("refuses to clobber a config it cannot parse", () => {
    const configPath = makeConfigPath();
    writeFileSync(configPath, "{ not json", "utf-8");

    expect(ensureDirectoryTrusted("/work/tree", configPath)).toBe(false);
    expect(readFileSync(configPath, "utf-8")).toBe("{ not json");
  });
});
