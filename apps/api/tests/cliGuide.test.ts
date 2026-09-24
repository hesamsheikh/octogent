import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { renderGuide, resolveAgentSkillTargets, setupAgentSkills } from "../src/cliGuide";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("renderGuide", () => {
  it("prints the routine with the commands a coordinator needs, in both locales", () => {
    for (const locale of ["en", "zh-CN"] as const) {
      const guide = renderGuide(locale);
      for (const command of [
        "octogent tentacle create",
        "octogent terminal create",
        "--tentacle-id",
        "octogent terminal wait",
        "octogent terminal result",
        "octogent terminal screen",
        "octogent terminal input",
        "octogent channel send",
        "octogent terminal delete",
        "--with-worktree",
      ]) {
        expect(guide, `${locale} guide mentions ${command}`).toContain(command);
      }
    }
    expect(renderGuide("zh-CN")).toContain("协调者");
  });
});

describe("agent skill targets", () => {
  it("points at each CLI's user-level skills directory and honors their home overrides", () => {
    const targets = resolveAgentSkillTargets({}, "/home/x");
    expect(targets).toEqual([
      { name: "claude-code", directory: "/home/x/.claude/skills/octogent" },
      { name: "codex", directory: "/home/x/.codex/skills/octogent" },
    ]);
    const overridden = resolveAgentSkillTargets(
      { CLAUDE_CONFIG_DIR: "/cfg/claude", CODEX_HOME: "/cfg/codex" },
      "/home/x",
    );
    expect(overridden.map((t) => t.directory)).toEqual([
      "/cfg/claude/skills/octogent",
      "/cfg/codex/skills/octogent",
    ]);
  });
});

describe("setupAgentSkills", () => {
  const makeSource = () => {
    const src = mkdtempSync(join(tmpdir(), "octogent-skill-src-"));
    tempDirs.push(src);
    writeFileSync(join(src, "SKILL.md"), "---\nname: octogent\ndescription: test\n---\n\n# body\n");
    return src;
  };
  const makeTargets = () => {
    const home = mkdtempSync(join(tmpdir(), "octogent-skill-home-"));
    tempDirs.push(home);
    // Something else already lives in the codex home; it must be left alone.
    mkdirSync(join(home, ".codex", "skills", "other"), { recursive: true });
    writeFileSync(join(home, ".codex", "config.toml"), 'model = "keep-me"\n');
    return { home, targets: resolveAgentSkillTargets({}, home) };
  };

  it("installs the skill into both CLIs, is idempotent, and removes cleanly", () => {
    const src = makeSource();
    const { home, targets } = makeTargets();

    const [claudeTarget, codexTarget] = targets;
    if (!claudeTarget || !codexTarget) throw new Error("expected two targets");
    const first = setupAgentSkills(src, targets);
    expect(first.map((r) => r.action)).toEqual(["installed", "installed"]);
    for (const target of targets) {
      const body = readFileSync(join(target.directory, "SKILL.md"), "utf8");
      expect(body).toContain("name: octogent");
      expect(body).toContain("octogent setup-agents --remove");
    }

    const second = setupAgentSkills(src, targets);
    expect(second.map((r) => r.action)).toEqual(["updated", "updated"]);
    // The marker is appended once, not on every run.
    const codexSkill = readFileSync(join(codexTarget.directory, "SKILL.md"), "utf8");
    expect(codexSkill.split("octogent setup-agents --remove")).toHaveLength(2);

    const removed = setupAgentSkills(src, targets, { remove: true });
    expect(removed.map((r) => r.action)).toEqual(["removed", "removed"]);
    expect(existsSync(claudeTarget.directory)).toBe(false);
    expect(setupAgentSkills(src, targets, { remove: true }).map((r) => r.action)).toEqual([
      "absent",
      "absent",
    ]);

    // Nothing else in the operator's config was touched.
    expect(readFileSync(join(home, ".codex", "config.toml"), "utf8")).toBe('model = "keep-me"\n');
    expect(existsSync(join(home, ".codex", "skills", "other"))).toBe(true);
  });
});
