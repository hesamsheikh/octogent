import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { asRecord } from "@octogent/core";

export const resolveClaudeConfigPath = (): string =>
  process.env.OCTOGENT_CLAUDE_CONFIG?.trim() || join(homedir(), ".claude.json");

/**
 * Marks a directory as trusted for Claude Code.
 *
 * Interactive Claude Code asks "is this a project you trust?" for any path it
 * has not seen, and defaults the selection to "No, exit". A worktree is a brand
 * new path every time, so an unattended terminal would answer that prompt with
 * the injected prompt's own Enter and quit. Only paths Octogent created from the
 * operator's own repository are seeded here.
 *
 * Returns whether the config changed.
 */
export const ensureDirectoryTrusted = (
  directory: string,
  configPath: string = resolveClaudeConfigPath(),
): boolean => {
  let config: Record<string, unknown> = {};

  if (existsSync(configPath)) {
    try {
      const parsed = asRecord(JSON.parse(readFileSync(configPath, "utf-8")));
      if (!parsed) {
        return false;
      }
      config = parsed;
    } catch {
      // Never overwrite a config we could not read: it holds the operator's
      // Claude Code state, and a rewrite would discard all of it.
      return false;
    }
  }

  const projects = asRecord(config.projects) ?? {};
  const project = asRecord(projects[directory]) ?? {};
  if (project.hasTrustDialogAccepted === true) {
    return false;
  }

  const nextConfig = {
    ...config,
    projects: { ...projects, [directory]: { ...project, hasTrustDialogAccepted: true } },
  };

  // Write through a sibling temp file so a concurrent Claude Code process never
  // observes a half-written config.
  const temporaryPath = join(dirname(configPath), `.octogent-trust-${process.pid}.tmp`);
  writeFileSync(temporaryPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf-8");
  renameSync(temporaryPath, configPath);
  return true;
};
