import { existsSync, readFileSync } from "node:fs";

import type { ConversationTurn } from "./conversations";

type ContentBlock = {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  id?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | ContentBlock[];
  is_error?: boolean;
};

type ClaudeTranscriptMessage = {
  type: string;
  role?: string;
  content?: string | ContentBlock[];
  message?: {
    role?: string;
    content?: string | ContentBlock[];
  };
  timestamp?: string;
  uuid?: string;
  summary?: string;
  subtype?: string;
};

const extractTextContent = (msg: ClaudeTranscriptMessage): string | null => {
  const content = msg.message?.content ?? msg.content;

  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const textParts: string[] = [];
  for (const block of content) {
    if (block.type === "text" && block.text) {
      textParts.push(block.text);
    }
  }

  return textParts.length > 0 ? textParts.join("\n") : null;
};

const getMessageRole = (msg: ClaudeTranscriptMessage): string | null =>
  msg.message?.role ?? msg.role ?? null;

const isUserTextMessage = (msg: ClaudeTranscriptMessage): boolean => {
  if (msg.type !== "user") {
    return false;
  }

  const role = getMessageRole(msg);
  if (role !== "user") {
    return false;
  }

  const content = msg.message?.content ?? msg.content;

  // String content is direct user input
  if (typeof content === "string") {
    return true;
  }

  // Array content with only tool_result blocks is a tool response, not user text
  if (Array.isArray(content)) {
    return content.some((block) => block.type === "text");
  }

  return false;
};

const isAssistantTextMessage = (msg: ClaudeTranscriptMessage): boolean => {
  if (msg.type !== "assistant") {
    return false;
  }

  const content = msg.message?.content ?? msg.content;
  if (!Array.isArray(content)) {
    return typeof content === "string" && content.length > 0;
  }

  return content.some((block) => block.type === "text" && block.text);
};

const isToolUseMessage = (msg: ClaudeTranscriptMessage): boolean => {
  if (msg.type !== "assistant") {
    return false;
  }

  const content = msg.message?.content ?? msg.content;
  if (!Array.isArray(content)) {
    return false;
  }

  return content.some((block) => block.type === "tool_use");
};

const extractToolUseSummary = (msg: ClaudeTranscriptMessage): string | null => {
  const content = msg.message?.content ?? msg.content;
  if (!Array.isArray(content)) {
    return null;
  }

  const summaries: string[] = [];
  for (const block of content) {
    if (block.type !== "tool_use" || !block.name) {
      continue;
    }

    const input = block.input as Record<string, unknown> | undefined;
    let detail = "";
    if (input) {
      if (block.name === "Bash" && typeof input.command === "string") {
        detail = `: \`${input.command.length > 80 ? `${input.command.slice(0, 77)}...` : input.command}\``;
      } else if (
        (block.name === "Read" || block.name === "Write" || block.name === "Edit") &&
        typeof input.file_path === "string"
      ) {
        detail = `: ${input.file_path}`;
      } else if (block.name === "Glob" && typeof input.pattern === "string") {
        detail = `: ${input.pattern}`;
      } else if (block.name === "Grep" && typeof input.pattern === "string") {
        detail = `: ${input.pattern}`;
      } else if (block.name === "Agent" && typeof input.description === "string") {
        detail = `: ${input.description}`;
      } else if (block.name === "WebFetch" && typeof input.url === "string") {
        detail = `: ${input.url}`;
      }
    }

    summaries.push(`[${block.name}${detail}]`);
  }

  return summaries.length > 0 ? summaries.join(" ") : null;
};

const stripCommandXml = (text: string): string | null => {
  // Skip messages that are just command XML (e.g. /clear)
  if (text.includes("<command-name>") && text.includes("</command-name>")) {
    return null;
  }

  // Skip local-command-caveat wrapper messages
  if (text.includes("<local-command-caveat>")) {
    return null;
  }

  return text.trim();
};

export const parseClaudeTranscript = (transcriptPath: string): ConversationTurn[] | null => {
  if (!existsSync(transcriptPath)) {
    return null;
  }

  let rawJsonl: string;
  try {
    rawJsonl = readFileSync(transcriptPath, "utf8");
  } catch {
    return null;
  }

  const messages: ClaudeTranscriptMessage[] = [];
  for (const line of rawJsonl.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        const msg = parsed as ClaudeTranscriptMessage;
        if (msg.type === "user" || msg.type === "assistant") {
          messages.push(msg);
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  if (messages.length === 0) {
    return null;
  }

  const turns: ConversationTurn[] = [];
  let turnCounter = 0;

  // Accumulate consecutive assistant messages into a single turn
  let pendingAssistantParts: string[] = [];
  let pendingAssistantStartedAt: string | null = null;
  let pendingAssistantEndedAt: string | null = null;

  const flushAssistantTurn = () => {
    if (pendingAssistantParts.length === 0) {
      return;
    }

    const content = pendingAssistantParts.join("\n").trim();
    if (content.length > 0) {
      turnCounter += 1;
      turns.push({
        turnId: `turn-${turnCounter}`,
        role: "assistant",
        content,
        startedAt: pendingAssistantStartedAt ?? new Date().toISOString(),
        endedAt: pendingAssistantEndedAt ?? new Date().toISOString(),
      });
    }

    pendingAssistantParts = [];
    pendingAssistantStartedAt = null;
    pendingAssistantEndedAt = null;
  };

  for (const msg of messages) {
    const timestamp = msg.timestamp ?? new Date().toISOString();

    if (isUserTextMessage(msg)) {
      flushAssistantTurn();

      const rawText = extractTextContent(msg);
      if (!rawText) {
        continue;
      }

      const text = stripCommandXml(rawText);
      if (!text || text.length === 0) {
        continue;
      }

      turnCounter += 1;
      turns.push({
        turnId: `turn-${turnCounter}`,
        role: "user",
        content: text,
        startedAt: timestamp,
        endedAt: timestamp,
      });
      continue;
    }

    if (isAssistantTextMessage(msg)) {
      const text = extractTextContent(msg);
      if (text && text.trim().length > 0) {
        if (!pendingAssistantStartedAt) {
          pendingAssistantStartedAt = timestamp;
        }
        pendingAssistantEndedAt = timestamp;
        pendingAssistantParts.push(text.trim());
      }
      continue;
    }

    if (isToolUseMessage(msg)) {
      const summary = extractToolUseSummary(msg);
      if (summary) {
        if (!pendingAssistantStartedAt) {
          pendingAssistantStartedAt = timestamp;
        }
        pendingAssistantEndedAt = timestamp;
        pendingAssistantParts.push(summary);
      }
    }
  }

  flushAssistantTurn();

  return turns.length > 0 ? turns : null;
};

/**
 * The model named by the latest assistant entry of a Claude Code transcript.
 * Hook payloads never carry the model, so this is the only way to learn what
 * actually answered when the terminal was created without `--model`.
 */
export const readClaudeTranscriptModel = (transcriptPath: string): string | null => {
  if (!existsSync(transcriptPath)) {
    return null;
  }
  let raw: string;
  try {
    raw = readFileSync(transcriptPath, "utf8");
  } catch {
    return null;
  }
  let model: string | null = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.includes('"assistant"') || !line.includes('"model"')) continue;
    try {
      const parsed = JSON.parse(line) as { type?: unknown; message?: { model?: unknown } };
      if (parsed.type === "assistant" && typeof parsed.message?.model === "string") {
        model = parsed.message.model;
      }
    } catch {
      // Skip malformed lines; the transcript is append-only and may be mid-write.
    }
  }
  return model;
};
