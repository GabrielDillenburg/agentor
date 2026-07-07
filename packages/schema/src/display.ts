/**
 * Derives a flat, renderer-agnostic list of display items from a session.
 *
 * Both the static tree renderer (`agentor parse`) and the interactive TUI
 * consume this list, so navigation semantics — chain flattening, fork
 * handling, abandoned-branch collapsing, attachment-run merging, turn
 * numbering — are defined exactly once, here. No ANSI/formatting concerns.
 */

import type {
  AssistantNode,
  CompactionNode,
  Session,
  SessionNode,
  SessionTree,
  SubtreeStats,
  SystemNode,
  ToolCall,
  UnknownNode,
  UserPromptNode,
} from './model.js';
import { buildTree, continuationChild, isSubstantive, subtreeStats } from './model.js';

export type DisplayItem =
  | { kind: 'prompt'; depth: number; turn: number; node: UserPromptNode }
  | { kind: 'meta'; depth: number; label: string; node: UserPromptNode | SystemNode }
  | { kind: 'text'; depth: number; text: string; node: AssistantNode }
  | { kind: 'thinking'; depth: number; chars: number; preview?: string; node: AssistantNode }
  | { kind: 'tool-call'; depth: number; call: ToolCall; node: AssistantNode }
  | { kind: 'compaction'; depth: number; node: CompactionNode }
  | { kind: 'attachments'; depth: number; count: number; label?: string }
  | { kind: 'unknown'; depth: number; node: UnknownNode }
  | { kind: 'abandoned'; depth: number; stats: SubtreeStats; head: SessionNode }
  | { kind: 'subagent-header'; depth: number };

export function buildDisplayItems(session: Session, tree: SessionTree = buildTree(session)): DisplayItem[] {
  const items: DisplayItem[] = [];
  let turn = 0;

  const emitNode = (node: SessionNode, promptDepth: number, activityDepth: number): void => {
    switch (node.kind) {
      case 'user-prompt':
        if (node.meta) {
          items.push({ kind: 'meta', depth: activityDepth, label: metaPromptLabel(node.text), node });
        } else {
          turn += 1;
          items.push({ kind: 'prompt', depth: promptDepth, turn, node });
        }
        break;
      case 'assistant':
        for (const block of node.blocks) {
          if (block.type === 'text') {
            items.push({ kind: 'text', depth: activityDepth, text: block.text, node });
          } else if (block.type === 'thinking') {
            const item: DisplayItem = { kind: 'thinking', depth: activityDepth, chars: block.chars, node };
            if (block.preview) item.preview = block.preview;
            items.push(item);
          } else {
            items.push({ kind: 'tool-call', depth: activityDepth, call: block.call, node });
          }
        }
        break;
      case 'compaction':
        items.push({ kind: 'compaction', depth: activityDepth, node });
        break;
      case 'system':
        if (!node.hidden) {
          items.push({ kind: 'meta', depth: activityDepth, label: systemLabel(node), node });
        }
        break;
      case 'attachment': {
        const prev = items[items.length - 1];
        if (prev?.kind === 'attachments' && prev.depth === activityDepth) {
          prev.count += 1;
        } else {
          const item: DisplayItem = { kind: 'attachments', depth: activityDepth, count: 1 };
          if (node.label) item.label = node.label;
          items.push(item);
        }
        break;
      }
      case 'unknown':
        items.push({ kind: 'unknown', depth: activityDepth, node });
        break;
    }
  };

  const walkChain = (start: SessionNode, promptDepth: number, activityDepth: number): void => {
    let node: SessionNode | undefined = start;
    while (node) {
      emitNode(node, promptDepth, activityDepth);
      const kids: SessionNode[] = tree.children.get(node.id) ?? [];
      const cont: SessionNode | undefined = continuationChild(tree, kids);
      for (const kid of kids) {
        if (kid === cont) continue;
        if (isSubstantive(tree, kid)) {
          items.push({ kind: 'abandoned', depth: activityDepth + 1, stats: subtreeStats(tree, kid), head: kid });
        } else {
          walkChain(kid, activityDepth + 1, activityDepth + 1);
        }
      }
      node = cont;
    }
  };

  const mainRoots = tree.roots.filter((r) => !r.sidechain);
  const sideRoots = tree.roots.filter((r) => r.sidechain);
  for (const root of mainRoots) walkChain(root, 0, 1);
  if (sideRoots.length > 0) {
    items.push({ kind: 'subagent-header', depth: 0 });
    for (const root of sideRoots) walkChain(root, 1, 2);
  }
  return items;
}

/** Compact label for harness-generated "user" events (commands, notifications…). */
export function metaPromptLabel(text: string): string {
  const command = /<command-name>([^<]+)<\/command-name>/.exec(text)?.[1];
  if (command) return `command: ${command.trim()}`;
  if (text.includes('<local-command-stdout>')) return 'command output';
  if (text.includes('<system-reminder>')) return 'system reminder';
  if (text.includes('<task-notification>')) return 'task notification';
  if (text.trimStart().startsWith('Caveat:')) return 'harness caveat';
  if (text.trimStart().startsWith('[Request interrupted')) return 'interrupted by user';
  return `system message: ${squeeze(text.replace(/<[^>]*>/g, ' '), 60)}`;
}

function systemLabel(node: SystemNode): string {
  const label = node.label ?? 'system';
  // local_command events carry raw <command-name> markup — reuse the prompt heuristic.
  return label.trimStart().startsWith('<') ? metaPromptLabel(label) : label;
}

function squeeze(text: string, max: number): string {
  const line = text.trim().replace(/\s+/g, ' ');
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
