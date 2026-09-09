import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { logVerbose } from "../logging";
import { parseClaudeTranscript, readClaudeTranscriptModel } from "./claudeTranscript";
import { OCTOGENT_MANAGED_WORKTREE_PATHS } from "./completionDetection";
import { storeClaudeTranscriptTurns } from "./conversations";
import { ensureGitExcludeEntries } from "./gitExclude";
import { mergeHookEntries, parseSettingsObject } from "./hookSettingsMerge";
import { broadcastMessage } from "./protocol";
import { resolveTerminalReleaseAfterTurn } from "./releaseAfterTurn";
import type { PersistedTerminal, TerminalSession } from "./types";

const MAX_AUTO_NAME_LENGTH = 50;

const deriveTerminalNameFromPrompt = (prompt: string): string => {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_AUTO_NAME_LENGTH) {
    return normalized;
  }

  // Truncate at the last space before the limit to avoid cutting mid-word.
  const truncated = normalized.slice(0, MAX_AUTO_NAME_LENGTH);
  const lastSpace = truncated.lastIndexOf(" ");
  return lastSpace > 0 ? `${truncated.slice(0, lastSpace)}…` : `${truncated}…`;
};

export const createHookProcessor = (deps: {
  terminals: Map<string, PersistedTerminal>;
  sessions: Map<string, TerminalSession>;
  transcriptDirectoryPath: string;
  getApiBaseUrl: () => string;
  persistRegistry: () => void;
  deliverChannelMessages: (terminalId: string) => number;
  releaseSessionKeepAlive: (terminalId: string) => boolean;
  reviveSessionTranscript: (terminalId: string) => boolean;
  sendInitialPromptNow: (sessionId: string) => void;
  acknowledgeInitialPrompt: (sessionId: string) => void;
  evaluateSessionCompletion: (terminalId: string) => void;
  recordToolUse?: (terminalId: string, toolName: string) => void;
  /** Push a fresh snapshot to UI clients after a hook changed the record outside a lifecycle event. */
  onTerminalUpdated?: (terminalId: string) => void;
  onStateChange?: (
    terminalId: string,
    state: TerminalSession["agentState"],
    toolName?: string,
  ) => void;
}) => {
  const {
    terminals,
    sessions,
    transcriptDirectoryPath,
    getApiBaseUrl,
    persistRegistry,
    deliverChannelMessages,
    releaseSessionKeepAlive,
    reviveSessionTranscript,
    sendInitialPromptNow,
    acknowledgeInitialPrompt,
    evaluateSessionCompletion,
    recordToolUse,
    onTerminalUpdated,
    onStateChange,
  } = deps;

  // Hook payloads never say which model answered; the Claude transcript does.
  // Read it once per terminal so a terminal created without --model still
  // shows what is actually working.
  const noteObservedModel = (terminalId: string, hookPayload: Record<string, unknown>) => {
    const terminal = terminals.get(terminalId);
    if (!terminal || terminal.agentModelObserved || terminal.agentProvider === "codex") {
      return;
    }
    const transcriptPath =
      typeof hookPayload.transcript_path === "string" ? hookPayload.transcript_path : null;
    if (!transcriptPath) {
      return;
    }
    const model = readClaudeTranscriptModel(transcriptPath);
    if (model) {
      terminal.agentModelObserved = model;
      persistRegistry();
      // No lifecycle event accompanies this, so the flow card would otherwise
      // keep saying "default model" until the next unrelated update.
      onTerminalUpdated?.(terminalId);
    }
  };

  const installHooksInDirectory = (targetCwd: string) => {
    const targetClaudeDir = join(targetCwd, ".claude");
    const targetSettingsPath = join(targetClaudeDir, "settings.json");
    const apiBaseUrl = getApiBaseUrl();

    const hooksConfig = {
      hooks: {
        SessionStart: [
          {
            matcher: "*",
            hooks: [
              {
                type: "command",
                command: `curl -s -X POST "${apiBaseUrl}/api/hooks/session-start?octogent_session=$OCTOGENT_SESSION_ID" -H 'Content-Type: application/json' -d @- || true`,
                timeout: 5,
              },
            ],
          },
        ],
        UserPromptSubmit: [
          {
            matcher: "*",
            hooks: [
              {
                type: "command",
                command: `curl -s -X POST "${apiBaseUrl}/api/hooks/user-prompt-submit?octogent_session=$OCTOGENT_SESSION_ID" -H 'Content-Type: application/json' -d @- || true`,
                timeout: 5,
              },
            ],
          },
        ],
        PreToolUse: [
          {
            matcher: "*",
            hooks: [
              {
                type: "http",
                url: `${apiBaseUrl}/api/hooks/pre-tool-use`,
                headers: { "X-Octogent-Session": "$OCTOGENT_SESSION_ID" },
                allowedEnvVars: ["OCTOGENT_SESSION_ID"],
                timeout: 5,
              },
            ],
          },
        ],
        PostToolUse: [
          {
            matcher: "Edit|Write",
            hooks: [
              {
                type: "http",
                url: `${apiBaseUrl}/api/code-intel/events`,
                headers: { "X-Octogent-Session": "$OCTOGENT_SESSION_ID" },
                allowedEnvVars: ["OCTOGENT_SESSION_ID"],
                timeout: 5,
              },
            ],
          },
        ],
        Notification: [
          {
            matcher: "*",
            hooks: [
              {
                type: "http",
                url: `${apiBaseUrl}/api/hooks/notification`,
                headers: { "X-Octogent-Session": "$OCTOGENT_SESSION_ID" },
                allowedEnvVars: ["OCTOGENT_SESSION_ID"],
                timeout: 5,
              },
            ],
          },
        ],
        Stop: [
          {
            matcher: "*",
            hooks: [
              {
                type: "command",
                command: `curl -s -X POST "${apiBaseUrl}/api/hooks/stop?octogent_session=$OCTOGENT_SESSION_ID" -H 'Content-Type: application/json' -d @- || true`,
                timeout: 15,
              },
            ],
          },
        ],
      },
    };

    try {
      mkdirSync(targetClaudeDir, { recursive: true });
      const existingSettings = existsSync(targetSettingsPath)
        ? parseSettingsObject(readFileSync(targetSettingsPath, "utf8"))
        : null;
      const mergedSettings =
        existingSettings && typeof existingSettings === "object" ? { ...existingSettings } : {};

      let mergedHooks =
        mergedSettings.hooks &&
        typeof mergedSettings.hooks === "object" &&
        !Array.isArray(mergedSettings.hooks)
          ? { ...(mergedSettings.hooks as Record<string, unknown>) }
          : {};

      for (const [eventName, eventEntries] of Object.entries(hooksConfig.hooks)) {
        mergedHooks = mergeHookEntries(mergedHooks, eventName, eventEntries);
      }

      mergedSettings.hooks = mergedHooks;
      writeFileSync(targetSettingsPath, `${JSON.stringify(mergedSettings, null, 2)}\n`, "utf8");
      // Keep our file out of `git status` for the agent and the operator in
      // repositories that do not ignore `.claude/` themselves.
      ensureGitExcludeEntries(
        targetCwd,
        [...OCTOGENT_MANAGED_WORKTREE_PATHS].map((path) => `/${path}`),
      );
    } catch {
      // Best-effort
    }
  };

  const handleHook = (
    hookName: string,
    payload: unknown,
    octogentSessionId?: string,
  ): { ok: boolean } => {
    logVerbose(
      `[Hook] Received hook: ${hookName} octogentSession=${octogentSessionId ?? "(none)"}`,
    );

    if (!payload || typeof payload !== "object") {
      return { ok: true };
    }

    const hookPayloadRecord = payload as Record<string, unknown>;

    if (hookName === "session-start") {
      if (!octogentSessionId) {
        return { ok: true };
      }
      sendInitialPromptNow(octogentSessionId);
      // A new agent came up in this PTY. Reopen the transcript if the previous
      // agent closed it, then hand over anything that queued up in between.
      if (reviveSessionTranscript(octogentSessionId)) {
        deliverChannelMessages(octogentSessionId);
      }
      return { ok: true };
    }

    if (hookName === "notification") {
      if (!octogentSessionId) {
        return { ok: true };
      }
      const session = sessions.get(octogentSessionId);
      if (!session) {
        logVerbose(`[Hook] notification: no session for ${octogentSessionId}, skipping.`);
        return { ok: true };
      }

      const notificationType =
        typeof hookPayloadRecord.notification_type === "string"
          ? hookPayloadRecord.notification_type
          : null;

      logVerbose(`[Hook] notification: type=${notificationType} session=${octogentSessionId}`);

      if (notificationType === "permission_prompt") {
        session.agentState = "waiting_for_permission";
        session.stateTracker.forceState("waiting_for_permission");
        onStateChange?.(octogentSessionId, "waiting_for_permission", session.lastToolName);
        broadcastMessage(session, {
          type: "state",
          state: "waiting_for_permission",
          ...(session.lastToolName ? { toolName: session.lastToolName } : {}),
        });
      } else if (notificationType === "idle_prompt") {
        session.agentState = "idle";
        session.stateTracker.forceState("idle");
        onStateChange?.(octogentSessionId, "idle");
        broadcastMessage(session, { type: "state", state: "idle" });

        // Deliver any queued channel messages now that the agent is idle.
        deliverChannelMessages(octogentSessionId);
      }

      return { ok: true };
    }

    if (hookName === "permission-request") {
      // Codex reports pending approvals through a dedicated PermissionRequest
      // event instead of Claude's Notification/permission_prompt; only codex
      // terminals may take this path.
      if (!octogentSessionId || terminals.get(octogentSessionId)?.agentProvider !== "codex") {
        return { ok: true };
      }
      const session = sessions.get(octogentSessionId);
      if (!session) {
        logVerbose(`[Hook] permission-request: no session for ${octogentSessionId}, skipping.`);
        return { ok: true };
      }

      const toolName =
        typeof hookPayloadRecord.tool_name === "string" ? hookPayloadRecord.tool_name : null;
      if (toolName) {
        session.lastToolName = toolName;
      }

      logVerbose(`[Hook] permission-request: tool=${toolName} session=${octogentSessionId}`);

      session.agentState = "waiting_for_permission";
      session.stateTracker.forceState("waiting_for_permission");
      onStateChange?.(octogentSessionId, "waiting_for_permission", session.lastToolName);
      broadcastMessage(session, {
        type: "state",
        state: "waiting_for_permission",
        ...(session.lastToolName ? { toolName: session.lastToolName } : {}),
      });

      return { ok: true };
    }

    if (hookName === "pre-tool-use") {
      if (!octogentSessionId) {
        return { ok: true };
      }
      const session = sessions.get(octogentSessionId);
      if (!session) {
        return { ok: true };
      }

      const toolName =
        typeof hookPayloadRecord.tool_name === "string" ? hookPayloadRecord.tool_name : null;

      logVerbose(`[Hook] pre-tool-use: tool=${toolName} session=${octogentSessionId}`);

      if (toolName) {
        session.lastToolName = toolName;
        recordToolUse?.(octogentSessionId, toolName);
      }
      noteObservedModel(octogentSessionId, hookPayloadRecord);

      if (toolName === "AskUserQuestion") {
        session.agentState = "waiting_for_user";
        session.stateTracker.forceState("waiting_for_user");
        onStateChange?.(octogentSessionId, "waiting_for_user");
        broadcastMessage(session, { type: "state", state: "waiting_for_user" });
      }

      return { ok: true };
    }

    if (hookName === "user-prompt-submit") {
      if (!octogentSessionId) {
        return { ok: true };
      }

      const terminal = terminals.get(octogentSessionId);
      if (!terminal) {
        return { ok: true };
      }

      // Update last-active timestamp (determines active/inactive on the canvas).
      acknowledgeInitialPrompt(octogentSessionId);
      terminal.lastActiveAt = new Date().toISOString();
      noteObservedModel(terminal.terminalId, hookPayloadRecord);

      // The user submitted a prompt, so the agent is about to start processing.
      // Transition state out of waiting/idle to processing immediately.
      const activitySession = sessions.get(terminal.terminalId);
      if (activitySession) {
        activitySession.agentState = "processing";
        activitySession.lastToolName = undefined;
        activitySession.stateTracker.forceState("processing");
        onStateChange?.(terminal.terminalId, "processing");
        broadcastMessage(activitySession, { type: "state", state: "processing" });
        broadcastMessage(activitySession, { type: "activity" });
      }

      // Auto-name the terminal from the first prompt when it still has its default name.
      if (terminal.nameOrigin === "generated") {
        const prompt =
          typeof hookPayloadRecord.prompt === "string" ? hookPayloadRecord.prompt.trim() : "";
        const renameContext = terminal.autoRenamePromptContext?.trim() || prompt;
        if (renameContext.length > 0) {
          const derived = deriveTerminalNameFromPrompt(renameContext);
          terminal.tentacleName = derived;
          terminal.nameOrigin = "prompt";
          terminal.autoRenamePromptContext = undefined;
          logVerbose(`[Hook] Auto-named terminal ${terminal.terminalId} → "${derived}"`);

          const session = sessions.get(terminal.terminalId);
          if (session) {
            broadcastMessage(session, { type: "rename", tentacleName: derived });
          }
        }
      }

      persistRegistry();
      return { ok: true };
    }

    if (hookName !== "stop") {
      return { ok: true };
    }

    const hookPayload = payload as Record<string, unknown>;
    const transcriptPath =
      typeof hookPayload.transcript_path === "string" ? hookPayload.transcript_path : null;
    const hookCwd = typeof hookPayload.cwd === "string" ? hookPayload.cwd : null;

    logVerbose(`[Hook] Stop hook: transcriptPath=${transcriptPath}, hookCwd=${hookCwd}`);

    if (!transcriptPath || !hookCwd) {
      logVerbose("[Hook] Missing transcriptPath or hookCwd, skipping.");
      return { ok: true };
    }

    let matchedSessionId: string | null = null;

    if (octogentSessionId && sessions.has(octogentSessionId)) {
      matchedSessionId = octogentSessionId;
      logVerbose(`[Hook] Matched session by octogent_session param: ${matchedSessionId}`);
    } else if (octogentSessionId) {
      logVerbose(
        `[Hook] octogent_session=${octogentSessionId} not found in active sessions, skipping.`,
      );
      return { ok: true };
    } else {
      logVerbose("[Hook] No octogent_session param — ignoring hook from external Claude session.");
      return { ok: true };
    }

    // Codex writes its own rollout-format JSONL at transcript_path, which the
    // Claude parser cannot read; rely on last_assistant_message alone there.
    const isCodexSession = terminals.get(matchedSessionId)?.agentProvider === "codex";
    if (!isCodexSession) {
      noteObservedModel(matchedSessionId, hookPayload);
    }

    logVerbose(`[Hook] Matched session: ${matchedSessionId}, parsing transcript...`);
    const turns = isCodexSession ? null : parseClaudeTranscript(transcriptPath);
    logVerbose(`[Hook] Parsed ${turns?.length ?? 0} turns from transcript.`);

    const lastAssistantMessage =
      typeof hookPayload.last_assistant_message === "string"
        ? hookPayload.last_assistant_message.trim()
        : null;

    if (lastAssistantMessage && lastAssistantMessage.length > 0) {
      const effectiveTurns = turns ?? [];
      const lastTurn = effectiveTurns.length > 0 ? effectiveTurns[effectiveTurns.length - 1] : null;

      if (!lastTurn || lastTurn.role !== "assistant" || lastTurn.content !== lastAssistantMessage) {
        const now = new Date().toISOString();
        effectiveTurns.push({
          turnId: `turn-${effectiveTurns.length + 1}`,
          role: "assistant",
          content: lastAssistantMessage,
          startedAt: now,
          endedAt: now,
        });
        logVerbose("[Hook] Appended last_assistant_message as final turn.");
      }

      if (effectiveTurns.length > 0) {
        storeClaudeTranscriptTurns(transcriptDirectoryPath, matchedSessionId, effectiveTurns);
        logVerbose(`[Hook] Stored ${effectiveTurns.length} turns for session ${matchedSessionId}.`);
      }
    } else if (turns && turns.length > 0) {
      storeClaudeTranscriptTurns(transcriptDirectoryPath, matchedSessionId, turns);
      logVerbose(`[Hook] Stored ${turns.length} turns for session ${matchedSessionId}.`);
    }

    // The turn is over: decide whether this terminal's work is now finished.
    if (matchedSessionId) {
      evaluateSessionCompletion(matchedSessionId);
    }

    // Codex has no idle_prompt notification, so a codex session never returns
    // to idle on its own; force it here — before delivery, whose idle gate
    // would otherwise stay closed forever.
    if (isCodexSession && matchedSessionId) {
      const session = sessions.get(matchedSessionId);
      if (session) {
        session.agentState = "idle";
        session.stateTracker.forceState("idle");
        onStateChange?.(matchedSessionId, "idle");
        broadcastMessage(session, { type: "state", state: "idle" });
      }
    }

    // Deliver any queued channel messages now that the agent is idle.
    if (matchedSessionId) {
      const deliveredMessageCount = deliverChannelMessages(matchedSessionId);
      const terminal = terminals.get(matchedSessionId);
      const lifecycleState = terminal?.lifecycleState;
      // A dispatched worker's Stop ends a turn, not the dialogue. Only proven
      // merged work is finished; shared workers may receive follow-up messages.
      const keepDispatchedWorkerAlive =
        Boolean(terminal?.initialPrompt) &&
        !resolveTerminalReleaseAfterTurn(process.env.OCTOGENT_TERMINAL_RELEASE_AFTER_TURN) &&
        !(terminal?.workspaceMode === "worktree" && lifecycleState === "completed");
      if (
        deliveredMessageCount === 0 &&
        lifecycleState !== "awaiting-review" &&
        !keepDispatchedWorkerAlive
      ) {
        releaseSessionKeepAlive(matchedSessionId);
      }
    }

    return { ok: true };
  };

  return { handleHook, installHooksInDirectory };
};
