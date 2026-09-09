import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ensureGitExcludeEntries } from "../src/terminalRuntime/gitExclude";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const git = (cwd: string, args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

const makeRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "octogent-git-exclude-"));
  tempDirs.push(dir);
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  git(dir, ["commit", "-q", "--allow-empty", "-m", "init"]);
  return dir;
};

describe("ensureGitExcludeEntries", () => {
  it("appends the pattern once and hides the file from git status", () => {
    const repo = makeRepo();
    mkdirSync(join(repo, ".claude"));
    execFileSync("touch", [join(repo, ".claude", "settings.json")]);
    expect(git(repo, ["status", "--porcelain", "--untracked-files=all"])).toContain(
      ".claude/settings.json",
    );

    expect(ensureGitExcludeEntries(repo, ["/.claude/settings.json"])).toBe(true);
    expect(ensureGitExcludeEntries(repo, ["/.claude/settings.json"])).toBe(true);

    const exclude = readFileSync(join(repo, ".git", "info", "exclude"), "utf8");
    expect(exclude.split("\n").filter((line) => line === "/.claude/settings.json")).toHaveLength(1);
    expect(git(repo, ["status", "--porcelain", "--untracked-files=all"]).trim()).toBe("");
  });

  it("covers a linked worktree through the shared info/exclude", () => {
    const repo = makeRepo();
    const worktree = join(repo, "wt");
    git(repo, ["worktree", "add", "-q", "-b", "octogent/t-1", worktree]);
    mkdirSync(join(worktree, ".claude"));
    execFileSync("touch", [join(worktree, ".claude", "settings.json")]);

    expect(ensureGitExcludeEntries(worktree, ["/.claude/settings.json"])).toBe(true);

    expect(git(worktree, ["status", "--porcelain", "--untracked-files=all"]).trim()).toBe("");
  });

  it("leaves a directory that is not a repository alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "octogent-not-a-repo-"));
    tempDirs.push(dir);

    expect(ensureGitExcludeEntries(dir, ["/.claude/settings.json"])).toBe(false);
  });
});
