import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Adds patterns to the repository's `info/exclude` (the per-clone ignore list,
 * never committed) so files Octogent drops into a checkout do not show up as
 * untracked for the agent or for the operator. Idempotent; a directory that
 * is not inside a git repository is left alone.
 *
 * `info/exclude` lives in the common git dir, so an entry made from a worktree
 * covers the main checkout and every other worktree of the same repository.
 */
export const ensureGitExcludeEntries = (cwd: string, patterns: readonly string[]): boolean => {
  let excludePath: string;
  try {
    const reported = execFileSync("git", ["rev-parse", "--git-path", "info/exclude"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!reported) {
      return false;
    }
    excludePath = resolve(cwd, reported);
  } catch {
    return false;
  }

  const existing = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : "";
  const present = new Set(existing.split("\n").map((line) => line.trim()));
  const missing = patterns.filter((pattern) => !present.has(pattern));
  if (missing.length === 0) {
    return true;
  }

  mkdirSync(dirname(excludePath), { recursive: true });
  const separator = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  writeFileSync(excludePath, `${existing}${separator}${missing.join("\n")}\n`, "utf8");
  return true;
};
