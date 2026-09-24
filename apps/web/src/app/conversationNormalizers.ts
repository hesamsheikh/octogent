import { asNumber, asRecord, asString } from "@octogent/core";

import type {
  ConversationSessionDetail,
  ConversationSessionSummary,
  ConversationTranscriptEvent,
  ConversationTurn,
} from "./types";

const normalizeConversationTurn = (value: unknown): ConversationTurn | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const turnId = asString(record.turnId);
  const role = record.role;
  const content = asString(record.content);
  const startedAt = asString(record.startedAt);
  const endedAt = asString(record.endedAt);
  if (
    !turnId ||
    (role !== "user" && role !== "assistant") ||
    content === null ||
    !startedAt ||
    !endedAt
  ) {
    return null;
  }

  return {
    turnId,
    role,
    content,
    startedAt,
    endedAt,
  };
};

const normalizeConversationTranscriptEvent = (
  value: unknown,
): ConversationTranscriptEvent | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const eventId = asString(record.eventId);
  const sessionId = asString(record.sessionId);
  const tentacleId = asString(record.tentacleId);
  const timestamp = asString(record.timestamp);
  const type = record.type;
  if (
    !eventId ||
    !sessionId ||
    !tentacleId ||
    !timestamp ||
    (type !== "session_start" &&
      type !== "input_submit" &&
      type !== "output_chunk" &&
      type !== "state_change" &&
      type !== "tool_use" &&
      type !== "session_end")
  ) {
    return null;
  }

  return {
    eventId,
    sessionId,
    tentacleId,
    timestamp,
    type,
  };
};

export const normalizeConversationSessionSummary = (
  value: unknown,
): ConversationSessionSummary | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const sessionId = asString(record.sessionId);
  if (!sessionId) {
    return null;
  }

  const tentacleId = asString(record.tentacleId);
  return {
    sessionId,
    tentacleId,
    startedAt: asString(record.startedAt),
    endedAt: asString(record.endedAt),
    lastEventAt: asString(record.lastEventAt),
    eventCount: Math.max(0, Math.floor(asNumber(record.eventCount) ?? 0)),
    turnCount: Math.max(0, Math.floor(asNumber(record.turnCount) ?? 0)),
    userTurnCount: Math.max(0, Math.floor(asNumber(record.userTurnCount) ?? 0)),
    assistantTurnCount: Math.max(0, Math.floor(asNumber(record.assistantTurnCount) ?? 0)),
    firstUserTurnPreview: asString(record.firstUserTurnPreview),
    lastUserTurnPreview: asString(record.lastUserTurnPreview),
    lastAssistantTurnPreview: asString(record.lastAssistantTurnPreview),
  };
};

export const normalizeConversationSessionDetail = (
  value: unknown,
): ConversationSessionDetail | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const summary = normalizeConversationSessionSummary(record);
  if (!summary) {
    return null;
  }

  const turns = Array.isArray(record.turns)
    ? record.turns
        .map((turn) => normalizeConversationTurn(turn))
        .filter((turn): turn is ConversationTurn => turn !== null)
    : [];
  const events = Array.isArray(record.events)
    ? record.events
        .map((event) => normalizeConversationTranscriptEvent(event))
        .filter((event): event is ConversationTranscriptEvent => event !== null)
    : [];

  return {
    ...summary,
    turns,
    events,
  };
};
