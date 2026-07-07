/**
 * Decision provenance: for a given tool call (especially a file change),
 * reconstruct WHY it happened from the display-item stream — the triggering
 * prompt, the reasoning immediately before it, what the agent had read this
 * turn, the error→retry chain that led here, the change itself, and the
 * file's history across the session.
 */

import type { DisplayItem } from './display.js';
import type { ToolCall } from './model.js';

export interface PriorError {
  name: string;
  detail?: string;
  summary?: string;
  index: number;
}

export interface FileHistoryEntry {
  index: number;
  action: 'edit' | 'write';
  turn?: number;
  isCurrent: boolean;
}

export type FileDiff =
  | { kind: 'edit'; edits: { oldText: string; newText: string }[] }
  | { kind: 'write'; content: string };

export interface ProvenanceInfo {
  call: ToolCall;
  index: number;
  turn?: number;
  promptText?: string;
  promptIndex?: number;
  /** Nearest contiguous assistant text before the call, oldest first. */
  reasoning: string[];
  /** Files read earlier in the same turn, in order. */
  filesRead: string[];
  /** Grep/Glob patterns run earlier in the same turn. */
  searches: string[];
  /** Failed tool calls earlier in the same turn. */
  priorErrors: PriorError[];
  change?: FileDiff;
  /** All changes to the same file across the whole session. */
  fileHistory: FileHistoryEntry[];
}

const READ_TOOLS = new Set(['Read']);
const SEARCH_TOOLS = new Set(['Grep', 'Glob']);

export function computeProvenance(items: DisplayItem[], index: number): ProvenanceInfo | null {
  const item = items[index];
  if (!item || item.kind !== 'tool-call') return null;
  const call = item.call;

  const info: ProvenanceInfo = {
    call,
    index,
    reasoning: [],
    filesRead: [],
    searches: [],
    priorErrors: [],
    fileHistory: [],
  };

  // Walk back to the turn boundary, collecting context along the way.
  let turnStart = 0;
  for (let i = index - 1; i >= 0; i--) {
    const prev = items[i];
    if (!prev) continue;
    if (prev.kind === 'prompt') {
      info.turn = prev.turn;
      info.promptText = prev.node.text;
      info.promptIndex = i;
      turnStart = i;
      break;
    }
  }

  // Reasoning: the contiguous run of text items directly above the call
  // (skipping thinking markers), stopping at the first non-text activity.
  for (let i = index - 1; i > turnStart; i--) {
    const prev = items[i];
    if (!prev) continue;
    if (prev.kind === 'thinking') continue;
    if (prev.kind === 'text') {
      info.reasoning.unshift(prev.text);
      continue;
    }
    if (info.reasoning.length > 0) break;
    // Not text and nothing collected yet — keep looking past this activity
    // only if we haven't found any reasoning at all.
    if (prev.kind === 'tool-call' || prev.kind === 'compaction') continue;
  }

  // Same-turn reads, searches, and failures before the call.
  const seenReads = new Set<string>();
  for (let i = turnStart; i < index; i++) {
    const prev = items[i];
    if (prev?.kind !== 'tool-call') continue;
    const c = prev.call;
    if (READ_TOOLS.has(c.name) && c.detail && !seenReads.has(c.detail)) {
      seenReads.add(c.detail);
      info.filesRead.push(c.detail);
    } else if (SEARCH_TOOLS.has(c.name) && c.detail) {
      info.searches.push(c.detail);
    }
    if (c.status === 'error') {
      const err: PriorError = { name: c.name, index: i };
      if (c.detail) err.detail = c.detail;
      if (c.resultSummary) err.summary = c.resultSummary;
      info.priorErrors.push(err);
    }
  }

  const diff = extractDiff(call);
  if (diff) info.change = diff;

  // History of every change touching the same file.
  const path = call.fileChange?.path;
  if (path) {
    for (const [i, it] of items.entries()) {
      if (it.kind !== 'tool-call' || it.call.fileChange?.path !== path) continue;
      const entry: FileHistoryEntry = {
        index: i,
        action: it.call.fileChange!.action,
        isCurrent: i === index,
      };
      const turn = turnOfIndex(items, i);
      if (turn != null) entry.turn = turn;
      info.fileHistory.push(entry);
    }
  }

  return info;
}

function turnOfIndex(items: DisplayItem[], index: number): number | undefined {
  for (let i = index; i >= 0; i--) {
    const it = items[i];
    if (it?.kind === 'prompt') return it.turn;
  }
  return undefined;
}

/** Reconstruct the change from the tool input (Edit/MultiEdit/Write/NotebookEdit). */
export function extractDiff(call: ToolCall): FileDiff | undefined {
  const input = call.input;
  if (typeof input !== 'object' || input === null) return undefined;
  const rec = input as Record<string, unknown>;

  if (call.name === 'Edit' && typeof rec['old_string'] === 'string' && typeof rec['new_string'] === 'string') {
    return { kind: 'edit', edits: [{ oldText: rec['old_string'], newText: rec['new_string'] }] };
  }
  if (call.name === 'MultiEdit' && Array.isArray(rec['edits'])) {
    const edits = (rec['edits'] as Record<string, unknown>[])
      .filter((e) => typeof e?.['old_string'] === 'string' && typeof e?.['new_string'] === 'string')
      .map((e) => ({ oldText: e['old_string'] as string, newText: e['new_string'] as string }));
    if (edits.length > 0) return { kind: 'edit', edits };
  }
  if (call.name === 'Write' && typeof rec['content'] === 'string') {
    return { kind: 'write', content: rec['content'] };
  }
  if (call.name === 'NotebookEdit' && typeof rec['new_source'] === 'string') {
    return { kind: 'write', content: rec['new_source'] };
  }
  return undefined;
}
