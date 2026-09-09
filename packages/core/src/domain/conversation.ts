export type ConversationTurn = {
  turnId: string;
  role: "user" | "assistant";
  content: string;
  startedAt: string;
  endedAt: string;
};

export type ConversationTranscriptEvent = {
  eventId: string;
  sessionId: string;
  tentacleId: string;
  timestamp: string;
  type:
    | "session_start"
    | "input_submit"
    | "output_chunk"
    | "state_change"
    | "tool_use"
    | "session_end";
};

export type ConversationSessionSummary = {
  sessionId: string;
  tentacleId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  lastEventAt: string | null;
  eventCount: number;
  turnCount: number;
  userTurnCount: number;
  assistantTurnCount: number;
  firstUserTurnPreview: string | null;
  lastUserTurnPreview: string | null;
  lastAssistantTurnPreview: string | null;
};

export type ConversationSessionDetail = ConversationSessionSummary & {
  turns: ConversationTurn[];
  events: ConversationTranscriptEvent[];
};

export type ConversationSearchHit = {
  sessionId: string;
  turnId: string;
  role: "user" | "assistant";
  snippet: string;
  turnStartedAt: string;
};

export type ConversationSearchResult = {
  query: string;
  hits: ConversationSearchHit[];
};
