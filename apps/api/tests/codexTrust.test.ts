import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  computeCodexHookHash,
  ensureCodexDirectoryTrusted,
  resolveCodexConfigPath,
} from "../src/codexTrust";
import { installCodexHooks } from "../src/terminalRuntime/codexHooks";

const roots: string[] = [];
const makeRoot = () => {
  const root = mkdtempSync(join(tmpdir(), "octogent-codex-trust-"));
  roots.push(root);
  return root;
};

const makeWorkspace = (root: string): string => {
  const workspace = join(root, "workspace");
  mkdirSync(workspace, { recursive: true });
  return workspace;
};

// The runtime hooks live in the user layer next to the Codex config.
const writeHooksBeside = (configPath: string, hooksJson: unknown): string => {
  const hooksJsonPath = join(dirname(configPath), "hooks.json");
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(
    hooksJsonPath,
    typeof hooksJson === "string" ? hooksJson : `${JSON.stringify(hooksJson, null, 2)}\n`,
    "utf-8",
  );
  return hooksJsonPath;
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

const sha256 = (input: string): string =>
  `sha256:${createHash("sha256").update(input, "utf-8").digest("hex")}`;

const commandHook = (command: string, timeout?: number) => ({
  hooks: [{ type: "command", command, ...(timeout === undefined ? {} : { timeout }) }],
});

describe("computeCodexHookHash", () => {
  // Locks the exact canonical serialization ported from codex-rs: the
  // normalized identity is serialized as compact JSON with recursively
  // byte-sorted keys and hashed with sha256 (config/src/fingerprint.rs
  // version_for_toml + hooks/src/engine/discovery.rs hook_hash).
  it("hashes the canonical JSON of the normalized hook identity", () => {
    const hash = computeCodexHookHash("SessionStart", undefined, {
      type: "command",
      command: "echo hi",
      timeout: 5,
    });

    expect(hash).toBe(
      sha256(
        '{"event_name":"session_start","hooks":[{"async":false,"command":"echo hi","timeout":5,"type":"command"}]}',
      ),
    );
  });

  it("keeps the matcher and statusMessage in the identity when the event supports them", () => {
    const hash = computeCodexHookHash("PreToolUse", "Bash", {
      type: "command",
      command: "echo hi",
      timeout: 5,
      statusMessage: "checking",
    });

    expect(hash).toBe(
      sha256(
        '{"event_name":"pre_tool_use","hooks":[{"async":false,"command":"echo hi","statusMessage":"checking","timeout":5,"type":"command"}],"matcher":"Bash"}',
      ),
    );
  });

  it("fills the default 600s timeout so implicit and explicit defaults converge", () => {
    const implicit = computeCodexHookHash("PreToolUse", undefined, {
      type: "command",
      command: "echo hi",
    });
    const explicit = computeCodexHookHash("PreToolUse", undefined, {
      type: "command",
      command: "echo hi",
      timeout: 600,
    });

    expect(implicit).toBe(explicit);
  });

  it("clamps SessionEnd timeouts to the 3s cap before hashing", () => {
    const clamped = computeCodexHookHash("SessionEnd", undefined, {
      type: "command",
      command: "echo hi",
      timeout: 30,
    });
    const capped = computeCodexHookHash("SessionEnd", undefined, {
      type: "command",
      command: "echo hi",
      timeout: 3,
    });

    expect(clamped).toBe(capped);
  });

  it("drops matchers for events that cannot match, keeps them for events that can", () => {
    const handler = { type: "command", command: "echo hi", timeout: 5 };

    expect(computeCodexHookHash("Stop", "ignored", handler)).toBe(
      computeCodexHookHash("Stop", undefined, handler),
    );
    expect(computeCodexHookHash("PreToolUse", "Bash", handler)).not.toBe(
      computeCodexHookHash("PreToolUse", undefined, handler),
    );
  });

  it("treats the default additionalContextLimit as absent", () => {
    const handler = { type: "command", command: "echo hi", timeout: 5 };

    expect(
      computeCodexHookHash("PreToolUse", undefined, { ...handler, additionalContextLimit: 2500 }),
    ).toBe(computeCodexHookHash("PreToolUse", undefined, handler));
    expect(
      computeCodexHookHash("PreToolUse", undefined, { ...handler, additionalContextLimit: 999 }),
    ).not.toBe(computeCodexHookHash("PreToolUse", undefined, handler));
    // Events that cannot emit additionalContext drop the field entirely.
    expect(
      computeCodexHookHash("PermissionRequest", undefined, {
        ...handler,
        additionalContextLimit: 999,
      }),
    ).toBe(computeCodexHookHash("PermissionRequest", undefined, handler));
  });

  it("refuses handlers Codex would reject or that use an unported handler type", () => {
    expect(computeCodexHookHash("Stop", undefined, { type: "command", command: "   " })).toBeNull();
    expect(
      computeCodexHookHash("Stop", undefined, {
        type: "command",
        command: "echo hi",
        timeout: 1.5,
      }),
    ).toBeNull();
    expect(
      computeCodexHookHash("Stop", undefined, { type: "mcp_tool", server: "s", tool: "t" }),
    ).toBeNull();
    expect(
      computeCodexHookHash("NotAnEvent", undefined, { type: "command", command: "x" }),
    ).toBeNull();
  });
});

describe("resolveCodexConfigPath", () => {
  it("prefers OCTOGENT_CODEX_CONFIG, then CODEX_HOME, then ~/.codex", () => {
    expect(
      resolveCodexConfigPath({ OCTOGENT_CODEX_CONFIG: "/x/config.toml", CODEX_HOME: "/y" }),
    ).toBe("/x/config.toml");
    expect(resolveCodexConfigPath({ CODEX_HOME: "/y" })).toBe(join("/y", "config.toml"));
    expect(resolveCodexConfigPath({})).toContain(join(".codex", "config.toml"));
  });
});

describe("ensureCodexDirectoryTrusted", () => {
  it("seeds the project trust and one hooks.state entry per installed hook", () => {
    const root = makeRoot();
    const configPath = join(root, "codex", "config.toml");
    const workspace = makeWorkspace(root);
    mkdirSync(dirname(configPath), { recursive: true });
    const installedHandlers = installCodexHooks("http://127.0.0.1:8787", {
      OCTOGENT_CODEX_CONFIG: configPath,
    });

    expect(ensureCodexDirectoryTrusted(workspace, installedHandlers, configPath)).toBe(true);

    const config = readFileSync(configPath, "utf-8");
    const hooksJsonPath = join(dirname(configPath), "hooks.json");
    expect(config).toContain(`[projects."${workspace}"]\ntrust_level = "trusted"`);
    for (const label of [
      "session_start",
      "user_prompt_submit",
      "pre_tool_use",
      "permission_request",
      "stop",
    ]) {
      expect(config).toContain(
        `[hooks.state."${hooksJsonPath}:${label}:0:0"]\ntrusted_hash = "sha256:`,
      );
    }
  });

  it("hashes a definition identically regardless of which hooks.json holds it", () => {
    const root = makeRoot();
    const configA = join(root, "a", "config.toml");
    const configB = join(root, "b", "config.toml");
    const workspaceA = makeWorkspace(join(root, "a"));
    const workspaceB = makeWorkspace(join(root, "b"));
    const installedA = installCodexHooks("http://127.0.0.1:8787", {
      OCTOGENT_CODEX_CONFIG: configA,
    });
    const installedB = installCodexHooks("http://127.0.0.1:8787", {
      OCTOGENT_CODEX_CONFIG: configB,
    });

    ensureCodexDirectoryTrusted(workspaceA, installedA, configA);
    ensureCodexDirectoryTrusted(workspaceB, installedB, configB);

    const hashOf = (contents: string) => contents.match(/trusted_hash = "(sha256:[0-9a-f]+)"/)?.[1];
    expect(hashOf(readFileSync(configA, "utf-8"))).toBeDefined();
    expect(hashOf(readFileSync(configA, "utf-8"))).toBe(hashOf(readFileSync(configB, "utf-8")));
  });

  it("indexes only Octogent handlers by their raw positions", () => {
    const root = makeRoot();
    const configPath = join(root, "config.toml");
    const workspace = makeWorkspace(root);
    const hooksJsonPath = writeHooksBeside(configPath, {
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "one" }] },
          {
            hooks: [
              { type: "command", command: "two" },
              { type: "command", command: "three" },
            ],
          },
        ],
      },
    });
    const installedHandlers = installCodexHooks("http://127.0.0.1:8787", {
      OCTOGENT_CODEX_CONFIG: configPath,
    });

    ensureCodexDirectoryTrusted(workspace, installedHandlers, configPath);

    const config = readFileSync(configPath, "utf-8");
    expect(config).not.toContain(`"${hooksJsonPath}:pre_tool_use:0:0"`);
    expect(config).not.toContain(`"${hooksJsonPath}:pre_tool_use:1:0"`);
    expect(config).not.toContain(`"${hooksJsonPath}:pre_tool_use:1:1"`);
    expect(config).toContain(`"${hooksJsonPath}:pre_tool_use:2:0"`);
  });

  it("preserves third-party hooks without approving them", () => {
    const root = makeRoot();
    const configPath = join(root, "config.toml");
    const workspace = makeWorkspace(root);
    const thirdPartyStop = commandHook("curl https://example.test/third-party", 15);
    writeHooksBeside(configPath, {
      hooks: {
        Stop: [thirdPartyStop],
        SessionEnd: [commandHook("echo third-party", 3)],
      },
    });
    const installedHandlers = installCodexHooks("http://127.0.0.1:8787", {
      OCTOGENT_CODEX_CONFIG: configPath,
    });

    ensureCodexDirectoryTrusted(workspace, installedHandlers, configPath);

    const hooksJsonPath = join(dirname(configPath), "hooks.json");
    const hooksFile = JSON.parse(readFileSync(hooksJsonPath, "utf-8")) as {
      hooks: Record<string, unknown[]>;
    };
    expect(hooksFile.hooks.Stop?.[0]).toEqual(thirdPartyStop);
    expect(hooksFile.hooks.SessionEnd).toEqual([commandHook("echo third-party", 3)]);

    const config = readFileSync(configPath, "utf-8");
    expect(config).not.toContain(`"${hooksJsonPath}:stop:0:0"`);
    expect(config).not.toContain(`"${hooksJsonPath}:session_end:0:0"`);
    expect(config).toContain(`"${hooksJsonPath}:stop:1:0"`);
  });

  it("appends to an existing config without touching its content", () => {
    const root = makeRoot();
    const configPath = join(root, "config.toml");
    const existing =
      'model = "gpt-5-codex"\n\n[projects."/somewhere/else"]\ntrust_level = "trusted"\n';
    writeFileSync(configPath, existing, "utf-8");
    const workspace = makeWorkspace(root);

    expect(ensureCodexDirectoryTrusted(workspace, [], configPath)).toBe(true);

    const config = readFileSync(configPath, "utf-8");
    expect(config.startsWith(existing)).toBe(true);
    expect(config).toContain(`[projects."${workspace}"]`);
  });

  it("is idempotent and reports no change on the second run", () => {
    const root = makeRoot();
    const configPath = join(root, "config.toml");
    const workspace = makeWorkspace(root);
    const installedHandlers = installCodexHooks("http://127.0.0.1:8787", {
      OCTOGENT_CODEX_CONFIG: configPath,
    });

    expect(ensureCodexDirectoryTrusted(workspace, installedHandlers, configPath)).toBe(true);
    const afterFirst = readFileSync(configPath, "utf-8");
    expect(ensureCodexDirectoryTrusted(workspace, installedHandlers, configPath)).toBe(false);
    expect(readFileSync(configPath, "utf-8")).toBe(afterFirst);
  });

  it("only appends the entries that are missing", () => {
    const root = makeRoot();
    const configPath = join(root, "config.toml");
    const workspace = makeWorkspace(root);
    const installedHandlers = installCodexHooks("http://127.0.0.1:8787", {
      OCTOGENT_CODEX_CONFIG: configPath,
    });
    writeFileSync(configPath, `[projects."${workspace}"]\ntrust_level = "untrusted"\n`, "utf-8");

    expect(ensureCodexDirectoryTrusted(workspace, installedHandlers, configPath)).toBe(true);

    const config = readFileSync(configPath, "utf-8");
    // The operator's own decision for the folder stays untouched — no duplicate
    // [projects] table that would make the whole config unparseable for Codex.
    expect(config.match(/\[projects\./g)).toHaveLength(1);
    expect(config).toContain('trust_level = "untrusted"');
    expect(config).toContain(":stop:0:0");
  });

  it("refreshes a stale trusted_hash for an installed Octogent handler", () => {
    // Hook definitions change across Octogent versions; keeping the old hash
    // would strand every Codex agent at the hooks-review dialog.
    const root = makeRoot();
    const configPath = join(root, "config.toml");
    const workspace = makeWorkspace(root);
    const installedHandlers = installCodexHooks("http://127.0.0.1:8787", {
      OCTOGENT_CODEX_CONFIG: configPath,
    });
    expect(ensureCodexDirectoryTrusted(workspace, installedHandlers, configPath)).toBe(true);
    const initial = readFileSync(configPath, "utf-8");
    writeFileSync(configPath, initial.replace(/sha256:[0-9a-f]+/, "sha256:stale"), "utf-8");

    expect(ensureCodexDirectoryTrusted(workspace, installedHandlers, configPath)).toBe(true);

    const config = readFileSync(configPath, "utf-8");
    expect(config).not.toContain("sha256:stale");
    expect(
      config.match(/:session_start:0:0/g),
      "the section is updated, not duplicated",
    ).toHaveLength(1);
    // Idempotent again once refreshed.
    expect(ensureCodexDirectoryTrusted(workspace, installedHandlers, configPath)).toBe(false);
  });

  it("does not trust a non-Octogent command even when the caller supplies it", () => {
    const root = makeRoot();
    const configPath = join(root, "config.toml");
    const workspace = makeWorkspace(root);
    writeHooksBeside(configPath, { hooks: { Stop: [commandHook("echo forged", 15)] } });

    ensureCodexDirectoryTrusted(
      workspace,
      [{ eventName: "Stop", command: "echo forged" }],
      configPath,
    );

    expect(readFileSync(configPath, "utf-8")).not.toContain("hooks.state");
  });

  it("refuses to modify a config it cannot safely tokenize", () => {
    const root = makeRoot();
    const workspace = makeWorkspace(root);
    const cases = ['[projects."broken\n', 'note = """\n[projects]\n"""\n'];

    for (const [index, contents] of cases.entries()) {
      const configPath = join(root, `config-${index}.toml`);
      writeFileSync(configPath, contents, "utf-8");
      expect(ensureCodexDirectoryTrusted(workspace, [], configPath)).toBe(false);
      expect(readFileSync(configPath, "utf-8")).toBe(contents);
    }
  });

  it("still trusts the folder when hooks.json is missing or malformed", () => {
    const root = makeRoot();
    const missing = makeWorkspace(join(root, "missing"));
    const malformed = makeWorkspace(join(root, "malformed"));
    const malformedConfig = join(root, "malformed", "config.toml");
    writeHooksBeside(malformedConfig, "{ not json");

    expect(ensureCodexDirectoryTrusted(missing, [], join(root, "missing", "config.toml"))).toBe(
      true,
    );
    expect(ensureCodexDirectoryTrusted(malformed, [], malformedConfig)).toBe(true);
    expect(readFileSync(malformedConfig, "utf-8")).not.toContain("hooks.state");
  });

  it("escapes TOML special characters in seeded keys", () => {
    const root = makeRoot();
    const configPath = join(root, "config.toml");
    const workspace = makeWorkspace(join(root, 'odd "dir"'));

    expect(ensureCodexDirectoryTrusted(workspace, [], configPath)).toBe(true);
    expect(readFileSync(configPath, "utf-8")).toContain(
      `[projects."${workspace.replace(/"/g, '\\"')}"]`,
    );
  });
});
