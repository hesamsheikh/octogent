import { describe, expect, it } from "vitest";

import { resolveBootstrapCommand } from "../src/terminalRuntime/bootstrapCommand";

describe("resolveBootstrapCommand", () => {
  it("runs Claude in a permission mode that does not stall an unattended agent", () => {
    expect(resolveBootstrapCommand("claude-code", {})).toBe("claude --permission-mode auto");
  });

  it("lets an operator pick a stricter or looser mode", () => {
    expect(
      resolveBootstrapCommand("claude-code", { OCTOGENT_CLAUDE_PERMISSION_MODE: "manual" }),
    ).toBe("claude --permission-mode manual");
  });

  it("ignores a blank override", () => {
    expect(resolveBootstrapCommand("claude-code", { OCTOGENT_CLAUDE_PERMISSION_MODE: "  " })).toBe(
      "claude --permission-mode auto",
    );
  });

  it("rejects a mode Claude Code does not accept rather than launching a broken command", () => {
    expect(
      resolveBootstrapCommand("claude-code", { OCTOGENT_CLAUDE_PERMISSION_MODE: "; rm -rf /" }),
    ).toBe("claude --permission-mode auto");
  });

  it("runs Codex sandboxed and unattended by default", () => {
    expect(resolveBootstrapCommand("codex", {})).toBe(
      "codex --sandbox workspace-write --ask-for-approval never",
    );
  });

  it("lets an operator pick a different Codex sandbox mode", () => {
    expect(resolveBootstrapCommand("codex", { OCTOGENT_CODEX_SANDBOX_MODE: "read-only" })).toBe(
      "codex --sandbox read-only --ask-for-approval never",
    );
  });

  it("lets an operator re-enable Codex approval prompts", () => {
    expect(resolveBootstrapCommand("codex", { OCTOGENT_CODEX_APPROVAL_POLICY: "on-request" })).toBe(
      "codex --sandbox workspace-write --ask-for-approval on-request",
    );
  });

  it("rejects a sandbox mode Codex does not accept rather than launching a broken command", () => {
    expect(resolveBootstrapCommand("codex", { OCTOGENT_CODEX_SANDBOX_MODE: "; rm -rf /" })).toBe(
      "codex --sandbox workspace-write --ask-for-approval never",
    );
  });

  it("falls back to the default provider for an unknown one", () => {
    expect(resolveBootstrapCommand("who-knows", {})).toBe("claude --permission-mode auto");
  });

  it("drops the sandbox for Codex worktree terminals so commits can reach .git", () => {
    // workspace-write mounts .git read-only with no opt-out, which would
    // strand every worktree agent at its final commit.
    expect(resolveBootstrapCommand("codex", {}, { workspaceMode: "worktree" })).toBe(
      "codex --sandbox danger-full-access --ask-for-approval never",
    );
  });

  it("keeps the sandbox for Codex shared-mode terminals", () => {
    expect(resolveBootstrapCommand("codex", {}, { workspaceMode: "shared" })).toBe(
      "codex --sandbox workspace-write --ask-for-approval never",
    );
  });

  it("lets an explicit sandbox override win over the workspace-mode default", () => {
    expect(
      resolveBootstrapCommand(
        "codex",
        { OCTOGENT_CODEX_SANDBOX_MODE: "read-only" },
        { workspaceMode: "worktree" },
      ),
    ).toBe("codex --sandbox read-only --ask-for-approval never");
  });

  it("ignores workspace mode for Claude, which has no sandbox", () => {
    expect(resolveBootstrapCommand("claude-code", {}, { workspaceMode: "worktree" })).toBe(
      "claude --permission-mode auto",
    );
  });

  it("passes a requested model to Claude", () => {
    expect(resolveBootstrapCommand("claude-code", {}, { agentModel: "opus" })).toBe(
      "claude --permission-mode auto --model opus",
    );
  });

  it("passes a requested model and reasoning effort to Codex", () => {
    expect(
      resolveBootstrapCommand(
        "codex",
        {},
        { workspaceMode: "worktree", agentModel: "gpt-5.6-luna", codexReasoningEffort: "low" },
      ),
    ).toBe(
      "codex --sandbox danger-full-access --ask-for-approval never -m gpt-5.6-luna -c model_reasoning_effort=low",
    );
  });

  it("passes a Codex model without touching reasoning effort when none is set", () => {
    expect(resolveBootstrapCommand("codex", {}, { agentModel: "gpt-5.6-terra" })).toBe(
      "codex --sandbox workspace-write --ask-for-approval never -m gpt-5.6-terra",
    );
  });
});
