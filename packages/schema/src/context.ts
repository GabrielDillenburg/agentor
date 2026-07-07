/**
 * Context inspector data: per turn, what the agent had in its context window —
 * approximate window occupancy (input + cache tokens of the turn's requests),
 * files read, tools used, output produced, and any compactions.
 */

import type { DisplayItem } from './display.js';

export interface TurnCompaction {
  droppedTokens?: number;
  trigger?: string;
}

export interface TurnContextInfo {
  turn: number;
  /** Index of the turn's prompt item. */
  index: number;
  promptSnippet: string;
  /** Peak context-window occupancy observed during the turn (input + cache tokens). */
  contextTokens?: number;
  outputTokens: number;
  filesRead: string[];
  filesChanged: string[];
  toolCounts: Record<string, number>;
  errors: number;
  compactions: TurnCompaction[];
}

export function computeTurnContexts(items: DisplayItem[]): TurnContextInfo[] {
  const turns: TurnContextInfo[] = [];
  let current: TurnContextInfo | null = null;
  let usageSeen = new Set<string>();

  for (const [i, item] of items.entries()) {
    if (item.kind === 'subagent-header') break; // sidechains have their own context windows
    if (item.kind === 'prompt') {
      current = {
        turn: item.turn,
        index: i,
        promptSnippet: firstLine(item.node.text, 80),
        outputTokens: 0,
        filesRead: [],
        filesChanged: [],
        toolCounts: {},
        errors: 0,
        compactions: [],
      };
      usageSeen = new Set();
      turns.push(current);
      continue;
    }
    if (!current) continue;

    if (item.kind === 'text' || item.kind === 'thinking' || item.kind === 'tool-call') {
      const node = item.node;
      if (node.usage && !usageSeen.has(node.id)) {
        usageSeen.add(node.id);
        current.outputTokens += node.usage.outputTokens;
        const inContext = node.usage.inputTokens + node.usage.cacheReadTokens + node.usage.cacheCreationTokens;
        if (inContext > (current.contextTokens ?? 0)) current.contextTokens = inContext;
      }
    }

    if (item.kind === 'tool-call') {
      const call = item.call;
      current.toolCounts[call.name] = (current.toolCounts[call.name] ?? 0) + 1;
      if (call.status === 'error') current.errors++;
      if (call.name === 'Read' && call.detail && !current.filesRead.includes(call.detail)) {
        current.filesRead.push(call.detail);
      }
      if (call.fileChange && !current.filesChanged.includes(call.fileChange.path)) {
        current.filesChanged.push(call.fileChange.path);
      }
    } else if (item.kind === 'compaction') {
      const compaction: TurnCompaction = {};
      if (item.node.droppedTokens != null) compaction.droppedTokens = item.node.droppedTokens;
      if (item.node.trigger) compaction.trigger = item.node.trigger;
      current.compactions.push(compaction);
    }
  }
  return turns;
}

function firstLine(text: string, max: number): string {
  const line = text.trim().split('\n', 1)[0] ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
