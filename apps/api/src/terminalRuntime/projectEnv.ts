// Pure parsing for the per-project worker environment (`<workspace>/.octogent/env`)
// and the per-terminal inherited names. Reading the file and composing the
// final PTY environment live in ptyEnvironment.ts.

export type EnvFileIssue = { line: number; reason: string };

export type ParsedEnvFile = {
  /** Only the assignments the file makes, in file order. */
  env: Record<string, string>;
  issues: EnvFileIssue[];
};

const ENV_FILE_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const EXPORT_PREFIX_PATTERN = /^export\s+/;
const EXPANSION_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;
// A PTY environment block is NUL-separated and the file format is line-based,
// so either character would silently corrupt or split the variable.
const FORBIDDEN_VALUE_CHARACTERS = /[\0\r\n]/;

// Inherited names come from another shell over HTTP, so they stay to the
// conventional upper-case form; lower-case proxy variables are already part of
// the baseline.
const INHERITABLE_ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
export const MAX_INHERITED_ENV_NAMES = 64;

export const isInheritableEnvName = (value: unknown): value is string =>
  typeof value === "string" && INHERITABLE_ENV_NAME_PATTERN.test(value);

export const isValidEnvValue = (value: string) => !FORBIDDEN_VALUE_CHARACTERS.test(value);

type ParsedValue = { value: string; expand: boolean } | { error: string };

const parseValue = (raw: string): ParsedValue => {
  const value = raw.trim();
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    const closeIndex = value.indexOf(quote, 1);
    if (closeIndex === -1) {
      return { error: "unterminated quote" };
    }
    const rest = value.slice(closeIndex + 1).trim();
    if (rest.length > 0 && !rest.startsWith("#")) {
      return { error: "unexpected text after the closing quote" };
    }
    // Single quotes keep `$` literal, as in a shell.
    return { value: value.slice(1, closeIndex), expand: quote === '"' };
  }

  // Like a shell, `#` only starts a comment after whitespace (`color#1` stays).
  const commentIndex = value.search(/\s#/);
  return {
    value: commentIndex === -1 ? value : value.slice(0, commentIndex).trimEnd(),
    expand: true,
  };
};

const expand = (value: string, scope: Record<string, string>) =>
  value.replace(
    EXPANSION_PATTERN,
    (_match, braced: string | undefined, bare: string | undefined) =>
      scope[braced ?? bare ?? ""] ?? "",
  );

/**
 * Parses a dotenv-style file. `$VAR`/`${VAR}` expand against `base` plus the
 * lines above, so `PATH=$PWD/.venv/bin:$PATH` prepends to the baseline PATH.
 * Malformed lines are reported and skipped, never fatal: a typo in one line
 * must not keep every worker of the project from starting.
 */
export const parseEnvFile = (text: string, base: Record<string, string>): ParsedEnvFile => {
  const env: Record<string, string> = {};
  const issues: EnvFileIssue[] = [];
  const scope: Record<string, string> = { ...base };

  text.split("\n").forEach((rawLine, index) => {
    const line = rawLine.replace(/\r$/, "").trim();
    if (line.length === 0 || line.startsWith("#")) {
      return;
    }

    const lineNumber = index + 1;
    const assignment = line.replace(EXPORT_PREFIX_PATTERN, "");
    const equalsIndex = assignment.indexOf("=");
    if (equalsIndex === -1) {
      issues.push({ line: lineNumber, reason: "expected KEY=VALUE" });
      return;
    }

    const key = assignment.slice(0, equalsIndex).trim();
    if (!ENV_FILE_KEY_PATTERN.test(key)) {
      issues.push({ line: lineNumber, reason: `invalid variable name "${key}"` });
      return;
    }

    const parsed = parseValue(assignment.slice(equalsIndex + 1));
    if ("error" in parsed) {
      issues.push({ line: lineNumber, reason: parsed.error });
      return;
    }

    const value = parsed.expand ? expand(parsed.value, scope) : parsed.value;
    if (!isValidEnvValue(value)) {
      issues.push({ line: lineNumber, reason: `value of ${key} contains NUL or a newline` });
      return;
    }

    env[key] = value;
    scope[key] = value;
  });

  return { env, issues };
};

/** Starter `.octogent/env`; the virtualenv lines are live only when one was found. */
export const renderProjectEnvTemplate = (venvDirectory: string | null) => {
  const venv = venvDirectory ?? ".venv";
  const prefix = venvDirectory ? "" : "# ";
  return [
    "# Octogent worker environment for this project (this clone only; .octogent/ is git-ignored).",
    "#",
    "# Agent terminals start from a clean baseline (HOME, PATH, locale, proxies,",
    "# agent credentials) instead of the environment of the shell that started",
    "# Octogent. Lines here are added on top, for every terminal of this project,",
    "# and are re-read whenever a terminal session starts.",
    "#",
    "# Syntax: KEY=VALUE, optional `export `, quotes stripped, $VAR and ${VAR}",
    "# expanded ($PWD is the project root); single quotes keep $ literal.",
    "",
    venvDirectory
      ? `# Python virtualenv found at ${venvDirectory}/:`
      : "# Python virtualenv (uncomment to use one):",
    `${prefix}PATH=$PWD/${venv}/bin:$PATH`,
    `${prefix}VIRTUAL_ENV=$PWD/${venv}`,
    "",
  ].join("\n");
};
