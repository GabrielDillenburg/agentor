/**
 * Loose structural types for raw Claude Code session JSONL events.
 *
 * These formats are not a stable API, so every field is optional and parsing
 * must fail soft: an event we don't recognize becomes an `unknown` node, never
 * a crash.
 */

export interface RawContentBlock {
  type?: string;
  // text
  text?: string;
  // thinking
  thinking?: string;
  // tool_use
  id?: string;
  name?: string;
  input?: unknown;
  // tool_result
  tool_use_id?: string;
  is_error?: boolean | null;
  content?: string | RawContentBlock[];
}

export interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface RawMessage {
  id?: string;
  role?: string;
  model?: string;
  content?: string | RawContentBlock[];
  usage?: RawUsage;
}

export interface RawEvent {
  type?: string;
  uuid?: string;
  parentUuid?: string | null;
  logicalParentUuid?: string | null;
  sessionId?: string;
  timestamp?: string;
  isSidechain?: boolean | null;
  isMeta?: boolean;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  message?: RawMessage;
  // system events
  subtype?: string;
  durationMs?: number;
  content?: unknown;
  compactMetadata?: {
    trigger?: string;
    preTokens?: number;
    postTokens?: number;
    cumulativeDroppedTokens?: number;
  };
  // session metadata events
  aiTitle?: string;
  summary?: string;
  // tool results
  toolUseResult?: unknown;
  // attachments
  attachment?: { type?: string } & Record<string, unknown>;
}
