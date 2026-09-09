import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { asRecord } from "@octogent/core";

import {
  type InstalledCodexHookHandler,
  OCTOGENT_CODEX_HOOK_DEFINITIONS,
} from "./terminalRuntime/codexHookContract";

/**
 * Pre-seeds Codex trust for a workspace directory so an unattended agent does
 * not stall on the folder-trust or hooks-review dialog — the Codex counterpart
 * of claudeTrust's ensureDirectoryTrusted.
 *
 * Trust lives in $CODEX_HOME/config.toml (default ~/.codex/config.toml):
 * - `[projects."<path>"] trust_level = "trusted"` trusts the folder, and
 * - `[hooks.state."<hooks.json path>:<event>:<group>:<index>"] trusted_hash`
 *   entries approve each installed hook definition by content hash.
 *
 * The hash is a port of the open-source codex CLI (github.com/openai/codex,
 * codex-rs): `hook_hash` in hooks/src/engine/discovery.rs builds a normalized
 * identity `{ event_name, matcher?, hooks: [<normalized handler>] }`, converts
 * it to a TOML value (dropping every `None` field), and `version_for_toml` in
 * config/src/fingerprint.rs re-serializes that value as compact JSON with
 * recursively sorted keys and hashes it: `sha256:<hex of sha256(json)>`.
 * The hash depends only on the definition, never on which file holds it.
 */

export const resolveCodexConfigPath = (env: NodeJS.ProcessEnv = process.env): string => {
  const override = env.OCTOGENT_CODEX_CONFIG?.trim();
  if (override) {
    return override;
  }
  const codexHome = env.CODEX_HOME?.trim();
  return join(codexHome || join(homedir(), ".codex"), "config.toml");
};

/** Hook-state key labels from codex-rs hooks/src/lib.rs hook_event_key_label. */
const CODEX_HOOK_EVENT_LABELS: Record<string, string> = {
  PreToolUse: "pre_tool_use",
  PermissionRequest: "permission_request",
  PostToolUse: "post_tool_use",
  PreCompact: "pre_compact",
  PostCompact: "post_compact",
  SessionStart: "session_start",
  SessionEnd: "session_end",
  UserPromptSubmit: "user_prompt_submit",
  SubagentStart: "subagent_start",
  SubagentStop: "subagent_stop",
  Stop: "stop",
  Interrupt: "interrupt",
};

// matcher_pattern_for_event: these events never match on anything, so Codex
// clears their matcher before hashing.
const MATCHERLESS_EVENTS = new Set(["UserPromptSubmit", "Stop", "Interrupt"]);

// Only these events can emit additionalContext; elsewhere the limit is dropped
// from the normalized identity. The 2,500-token default is also dropped so an
// explicit default hashes like an implicit one.
const ADDITIONAL_CONTEXT_EVENTS = new Set([
  "PreToolUse",
  "PostToolUse",
  "SessionStart",
  "UserPromptSubmit",
  "SubagentStart",
]);
const DEFAULT_ADDITIONAL_CONTEXT_LIMIT = 2500;

const asOptionalUnsignedInteger = (value: unknown): number | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
};

/** normalize_command_hook: SessionEnd/Interrupt default to 1s capped at 3s. */
const normalizeTimeout = (eventName: string, timeout: number | undefined): number =>
  eventName === "SessionEnd" || eventName === "Interrupt"
    ? Math.min(Math.max(timeout ?? 1, 1), 3)
    : Math.max(timeout ?? 600, 1);

/**
 * Serializes exactly like codex's canonical fingerprint JSON: compact
 * separators with object keys recursively sorted byte-wise (Rust String sort).
 */
const canonicalJsonStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonStringify).join(",")}]`;
  }
  const record = asRecord(value);
  if (record) {
    const keys = Object.keys(record).sort((left, right) =>
      Buffer.compare(Buffer.from(left, "utf-8"), Buffer.from(right, "utf-8")),
    );
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJsonStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

/**
 * Computes the `trusted_hash` Codex expects for one hook handler, or null when
 * the handler is not a hashable command hook: Codex either skips such handlers
 * (empty command) or rejects the file outright (malformed fields), and only
 * `command` handlers are ported — an mcp_tool identity embeds arbitrary JSON
 * whose TOML float round-trip this port cannot reproduce byte-for-byte, and
 * Octogent never installs one. Unported handlers keep their review dialog.
 */
export const computeCodexHookHash = (
  eventName: string,
  matcher: string | undefined,
  handler: Record<string, unknown>,
): string | null => {
  const eventLabel = CODEX_HOOK_EVENT_LABELS[eventName];
  if (!eventLabel || handler.type !== "command") {
    return null;
  }

  const platformCommand =
    process.platform === "win32" && typeof handler.commandWindows === "string"
      ? handler.commandWindows
      : handler.command;
  if (typeof platformCommand !== "string" || platformCommand.trim().length === 0) {
    return null;
  }
  const timeout = asOptionalUnsignedInteger(handler.timeout);
  const additionalContextLimit = asOptionalUnsignedInteger(handler.additionalContextLimit);
  if (timeout === null || additionalContextLimit === null) {
    return null;
  }
  if (handler.async !== undefined && typeof handler.async !== "boolean") {
    return null;
  }
  if (handler.statusMessage !== undefined && typeof handler.statusMessage !== "string") {
    return null;
  }

  const keepAdditionalContextLimit =
    ADDITIONAL_CONTEXT_EVENTS.has(eventName) &&
    additionalContextLimit !== undefined &&
    additionalContextLimit !== DEFAULT_ADDITIONAL_CONTEXT_LIMIT;
  const normalizedMatcher = MATCHERLESS_EVENTS.has(eventName) ? undefined : matcher;

  // Field names and presence mirror the serde/TOML serialization of codex's
  // normalized HookHandlerConfig::Command: absent Options vanish, `async` and
  // the filled-in `timeout` always serialize.
  const identity = {
    event_name: eventLabel,
    ...(normalizedMatcher === undefined ? {} : { matcher: normalizedMatcher }),
    hooks: [
      {
        type: "command",
        command: platformCommand,
        timeout: normalizeTimeout(eventName, timeout),
        async: handler.async === true,
        ...(handler.statusMessage === undefined ? {} : { statusMessage: handler.statusMessage }),
        ...(keepAdditionalContextLimit ? { additionalContextLimit } : {}),
      },
    ],
  };

  const digest = createHash("sha256")
    .update(canonicalJsonStringify(identity), "utf-8")
    .digest("hex");
  return `sha256:${digest}`;
};

type HookStateEntry = { key: string; hash: string };

const OCTOGENT_HOOK_COMMAND_PATTERN =
  /^\[ -n "\$OCTOGENT_SESSION_ID" \] && \[ "\$OCTOGENT_API_BASE" = "([^"\r\n]+)" \] && curl -s -o \/dev\/null -X POST "\1\/api\/hooks\/([a-z-]+)\?octogent_session=\$OCTOGENT_SESSION_ID" -H 'Content-Type: application\/json' -d @- \|\| true$/;

const isOctogentHookCommand = (eventName: string, command: string): boolean => {
  const match = OCTOGENT_HOOK_COMMAND_PATTERN.exec(command);
  const definition = OCTOGENT_CODEX_HOOK_DEFINITIONS.find(
    (candidate) => candidate.eventName === eventName,
  );
  return match !== null && match[2] === definition?.hookPath;
};

const hasOnlyKeys = (record: Record<string, unknown>, expectedKeys: string[]): boolean => {
  const actualKeys = Object.keys(record).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return (
    actualKeys.length === expectedKeys.length &&
    sortedExpectedKeys.every((expectedKey, index) => expectedKey === actualKeys[index])
  );
};

const isInstalledOctogentEntry = (
  eventName: string,
  command: string,
  group: Record<string, unknown>,
): group is { hooks: [Record<string, unknown>] } => {
  const definition = OCTOGENT_CODEX_HOOK_DEFINITIONS.find(
    (candidate) => candidate.eventName === eventName,
  );
  const hooks = group.hooks;
  if (
    !definition ||
    !hasOnlyKeys(group, ["hooks"]) ||
    !Array.isArray(hooks) ||
    hooks.length !== 1
  ) {
    return false;
  }
  const handler = asRecord(hooks[0]);
  return (
    handler !== null &&
    hasOnlyKeys(handler, ["type", "command", "timeout"]) &&
    handler.type === "command" &&
    handler.command === command &&
    handler.timeout === definition.timeoutSeconds
  );
};

/**
 * Collects `[hooks.state]` entries only for the exact handlers that the hook
 * installer just wrote or confirmed. Raw group positions are retained because
 * Codex includes them in state keys; unrelated user hooks are never hashed.
 */
const collectHookStateEntries = (
  hooksJsonPath: string,
  installedHandlers: readonly InstalledCodexHookHandler[],
): HookStateEntry[] => {
  if (!existsSync(hooksJsonPath)) {
    return [];
  }
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = asRecord(JSON.parse(readFileSync(hooksJsonPath, "utf-8")));
  } catch {
    return [];
  }
  const events = asRecord(parsed?.hooks);
  if (!events) {
    return [];
  }

  const approvedCommands = new Map<string, Set<string>>();
  for (const { eventName, command } of installedHandlers) {
    if (!isOctogentHookCommand(eventName, command)) {
      continue;
    }
    const commands = approvedCommands.get(eventName) ?? new Set<string>();
    commands.add(command);
    approvedCommands.set(eventName, commands);
  }

  const entries: HookStateEntry[] = [];
  for (const [eventName, commands] of approvedCommands) {
    const eventLabel = CODEX_HOOK_EVENT_LABELS[eventName];
    if (!eventLabel) {
      continue;
    }
    const groups = events[eventName];
    if (!Array.isArray(groups)) {
      continue;
    }
    for (const [groupIndex, groupValue] of groups.entries()) {
      const group = asRecord(groupValue);
      if (!group) {
        continue;
      }
      const command = [...commands].find((candidate) =>
        isInstalledOctogentEntry(eventName, candidate, group),
      );
      if (!command || !isInstalledOctogentEntry(eventName, command, group)) {
        continue;
      }
      const hash = computeCodexHookHash(eventName, undefined, group.hooks[0]);
      if (hash) {
        entries.push({ key: `${hooksJsonPath}:${eventLabel}:${groupIndex}:0`, hash });
      }
    }
  }
  return entries;
};

const escapeTomlBasicString = (value: string): string =>
  // biome-ignore lint/suspicious/noControlCharactersInRegex: TOML basic strings require escaping exactly these control characters
  value.replace(/[\\"\u0000-\u001f\u007f]/g, (character) => {
    switch (character) {
      case "\\":
        return "\\\\";
      case '"':
        return '\\"';
      case "\b":
        return "\\b";
      case "\t":
        return "\\t";
      case "\n":
        return "\\n";
      case "\f":
        return "\\f";
      case "\r":
        return "\\r";
      default:
        return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
    }
  });

/**
 * Parses one `[table.header]` line into its key segments, or null when the
 * line is not a well-formed header. Handles bare, basic-quoted, and
 * literal-quoted keys — the only forms Codex itself writes.
 */
const parseTomlHeaderKeyPath = (line: string): string[] | null => {
  let cursor = line.startsWith("[[") ? 2 : 1;
  const isArrayHeader = cursor === 2;
  const segments: string[] = [];

  const skipWhitespace = () => {
    while (line[cursor] === " " || line[cursor] === "\t") {
      cursor += 1;
    }
  };

  for (;;) {
    skipWhitespace();
    const start = line[cursor];
    if (start === '"' || start === "'") {
      let segment = "";
      cursor += 1;
      while (cursor < line.length && line[cursor] !== start) {
        if (start === '"' && line[cursor] === "\\") {
          const escapeCharacter = line[cursor + 1];
          const simple: Record<string, string> = {
            b: "\b",
            t: "\t",
            n: "\n",
            f: "\f",
            r: "\r",
            '"': '"',
            "\\": "\\",
          };
          if (escapeCharacter !== undefined && escapeCharacter in simple) {
            segment += simple[escapeCharacter];
            cursor += 2;
            continue;
          }
          if (escapeCharacter === "u" || escapeCharacter === "U") {
            const width = escapeCharacter === "u" ? 4 : 8;
            const hex = line.slice(cursor + 2, cursor + 2 + width);
            if (!new RegExp(`^[0-9A-Fa-f]{${width}}$`).test(hex)) {
              return null;
            }
            segment += String.fromCodePoint(Number.parseInt(hex, 16));
            cursor += 2 + width;
            continue;
          }
          return null;
        }
        segment += line[cursor];
        cursor += 1;
      }
      if (line[cursor] !== start) {
        return null;
      }
      cursor += 1;
      segments.push(segment);
    } else {
      const match = /^[A-Za-z0-9_-]+/.exec(line.slice(cursor));
      if (!match) {
        return null;
      }
      segments.push(match[0]);
      cursor += match[0].length;
    }
    skipWhitespace();
    if (line[cursor] === ".") {
      cursor += 1;
      continue;
    }
    break;
  }

  const closer = isArrayHeader ? "]]" : "]";
  if (!line.startsWith(closer, cursor)) {
    return null;
  }
  const trailer = line.slice(cursor + closer.length).trim();
  if (trailer.length > 0 && !trailer.startsWith("#")) {
    return null;
  }
  return segments;
};

/**
 * Extracts every table-header key path in the config, or null when a line we
 * would have to reason about cannot be tokenized. Multi-line strings could
 * hide header-looking lines, so their mere presence makes the file off-limits;
 * so does any unparseable `[`-line (including multi-line array continuations —
 * refusing an exotic config is safe, appending into it blind is not).
 */
const parseTomlHeaderPaths = (contents: string): string[][] | null => {
  if (contents.includes('"""') || contents.includes("'''")) {
    return null;
  }
  const headerPaths: string[][] = [];
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("[")) {
      continue;
    }
    const headerPath = parseTomlHeaderKeyPath(line);
    if (!headerPath) {
      return null;
    }
    headerPaths.push(headerPath);
  }
  return headerPaths;
};

const samePath = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((segment, index) => segment === right[index]);

/**
 * Marks a workspace directory as trusted for Codex and pre-approves the hooks
 * installed by codexHooks (which must have written hooks.json already — see
 * the adapter ordering in agentProviders).
 *
 * The read-modify-write is conservative, in the spirit of claudeTrust: an
 * operator's [projects] section is never rewritten (their explicit
 * "untrusted" verdict deserves to stand), a config we cannot safely tokenize
 * is left alone, and the write goes through a sibling temp file so Codex
 * never sees a torn config. The one in-place edit allowed is the
 * trusted_hash of Octogent's own hooks file: its definitions change across
 * Octogent versions, and a stale hash strands every Codex agent at the
 * hooks-review dialog.
 *
 * Returns whether the config changed.
 */
export const ensureCodexDirectoryTrusted = (
  targetCwd: string,
  installedHandlers: readonly InstalledCodexHookHandler[],
  configPath: string = resolveCodexConfigPath(),
): boolean => {
  const projectPath = resolve(targetCwd);
  // The runtime hooks live in the user layer next to the config (the only
  // layer the Codex TUI loads from worktree sessions) — see codexHooks.
  const hooksJsonPath = resolve(dirname(configPath), "hooks.json");

  const contents = existsSync(configPath) ? readFileSync(configPath, "utf-8") : "";
  const headerPaths = parseTomlHeaderPaths(contents);
  if (!headerPaths) {
    // Never touch a config we could misread: it is the operator's live Codex
    // desktop state, and a bad append could take the whole file down with it.
    return false;
  }

  const hookSections = collectHookStateEntries(hooksJsonPath, installedHandlers).map((entry) => ({
    headerPath: ["hooks", "state", entry.key],
    body: `trusted_hash = "${entry.hash}"`,
  }));
  const sections: Array<{ headerPath: string[]; body: string }> = [
    { headerPath: ["projects", projectPath], body: 'trust_level = "trusted"' },
    ...hookSections,
  ];

  // Refresh stale hashes for sections that already exist.
  const lines = contents.split("\n");
  let hasRefreshedHash = false;
  for (const section of hookSections) {
    const headerIndex = lines.findIndex((line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("[")) {
        return false;
      }
      const parsedPath = parseTomlHeaderKeyPath(trimmed);
      return parsedPath !== null && samePath(parsedPath, section.headerPath);
    });
    if (headerIndex === -1) {
      continue;
    }
    for (let lineIndex = headerIndex + 1; lineIndex < lines.length; lineIndex++) {
      const bodyLine = (lines[lineIndex] ?? "").trim();
      if (bodyLine.startsWith("[")) {
        break;
      }
      if (bodyLine.startsWith("trusted_hash")) {
        if (bodyLine !== section.body) {
          lines[lineIndex] = section.body;
          hasRefreshedHash = true;
        }
        break;
      }
    }
  }

  const missing = sections.filter(
    (section) => !headerPaths.some((headerPath) => samePath(headerPath, section.headerPath)),
  );
  if (missing.length === 0 && !hasRefreshedHash) {
    return false;
  }

  const baseContents = hasRefreshedHash ? lines.join("\n") : contents;
  const blocks = missing.map((section) => {
    const quotedLeaf = `"${escapeTomlBasicString(section.headerPath[section.headerPath.length - 1] ?? "")}"`;
    const prefix = section.headerPath.slice(0, -1).join(".");
    return `[${prefix}.${quotedLeaf}]\n${section.body}\n`;
  });
  const separator =
    blocks.length === 0
      ? ""
      : baseContents.length === 0
        ? ""
        : baseContents.endsWith("\n")
          ? "\n"
          : "\n\n";
  const nextContents = `${baseContents}${separator}${blocks.join("\n")}`;

  // Write through a sibling temp file so a concurrent Codex process never
  // observes a half-written config.
  mkdirSync(dirname(configPath), { recursive: true });
  const temporaryPath = join(dirname(configPath), `.octogent-codex-trust-${process.pid}.tmp`);
  writeFileSync(temporaryPath, nextContents, "utf-8");
  renameSync(temporaryPath, configPath);
  return true;
};
