import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type {
  AssistantBlock,
  AssistantNode,
  AttachmentNode,
  CompactionNode,
  Session,
  SessionNode,
  SystemNode,
  TokenUsage,
  ToolCall,
  UnknownNode,
  UserPromptNode,
} from '@agentor/schema';
import type { RawContentBlock, RawEvent, RawUsage } from './raw-types.js';

const MAX_WARNINGS = 20;

/** Tools whose invocation mutates a file on disk. */
const FILE_EDIT_TOOLS: Record<string, 'edit' | 'write'> = {
  Edit: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Write: 'write',
};

export async function parseSessionFile(path: string): Promise<Session> {
  const text = await readFile(path, 'utf8');
  const fallbackId = basename(path).replace(/\.jsonl$/, '');
  return parseSessionLines(text.split('\n'), fallbackId);
}

export function parseSessionLines(lines: string[], fallbackId = 'unknown-session'): Session {
  const session: Session = {
    meta: { id: fallbackId, agent: 'claude-code', models: [] },
    nodes: [],
    warnings: [],
  };

  const warn = (msg: string): void => {
    if (session.warnings.length < MAX_WARNINGS && !session.warnings.includes(msg)) {
      session.warnings.push(msg);
    }
  };

  /** uuid -> raw parent uuid, for every event seen (even ones we don't emit). */
  const rawParent = new Map<string, string | null>();
  /** uuid -> emitted node, or alias of a consumed/merged event to the node that absorbed it. */
  const nodeFor = new Map<string, SessionNode>();
  /** Claude message.id -> assistant node, so multi-event messages merge into one node. */
  const assistantByMessageId = new Map<string, AssistantNode>();
  /** tool_use id -> call awaiting its result. */
  const pendingCalls = new Map<string, { call: ToolCall; startedAt?: string }>();

  const resolveParent = (parentUuid: string | null | undefined): string | null => {
    let cur = parentUuid ?? null;
    for (let hops = 0; cur && hops < 10_000; hops++) {
      const node = nodeFor.get(cur);
      if (node) return node.id;
      const next = rawParent.get(cur);
      if (next === undefined) return null;
      cur = next;
    }
    return null;
  };

  const emit = (node: SessionNode, ev: RawEvent): void => {
    session.nodes.push(node);
    if (ev.uuid) nodeFor.set(ev.uuid, node);
  };

  const models = new Set<string>();

  for (const [i, line] of lines.entries()) {
    if (!line.trim()) continue;
    let ev: RawEvent;
    try {
      ev = JSON.parse(line) as RawEvent;
    } catch {
      warn(`line ${i + 1}: unparseable JSON, skipped`);
      continue;
    }
    if (typeof ev !== 'object' || ev === null) {
      warn(`line ${i + 1}: unexpected non-object event, skipped`);
      continue;
    }

    if (ev.uuid) {
      rawParent.set(ev.uuid, ev.logicalParentUuid ?? ev.parentUuid ?? null);
    }

    // Session-level metadata carried on regular events.
    if (ev.sessionId && session.meta.id === fallbackId) session.meta.id = ev.sessionId;
    if (ev.cwd && !session.meta.cwd) session.meta.cwd = ev.cwd;
    if (ev.gitBranch && !session.meta.gitBranch) session.meta.gitBranch = ev.gitBranch;
    if (ev.version && !session.meta.agentVersion) session.meta.agentVersion = ev.version;
    if (ev.timestamp) {
      if (!session.meta.startedAt) session.meta.startedAt = ev.timestamp;
      session.meta.endedAt = ev.timestamp;
    }

    const sidechain = ev.isSidechain === true;
    const parentId = resolveParent(ev.logicalParentUuid ?? ev.parentUuid);

    switch (ev.type) {
      case 'assistant': {
        handleAssistant(ev, parentId, sidechain);
        break;
      }
      case 'user': {
        handleUser(ev, parentId, sidechain);
        break;
      }
      case 'system': {
        if (ev.subtype === 'compact_boundary') {
          const meta = ev.compactMetadata ?? {};
          const node: CompactionNode = {
            kind: 'compaction',
            id: ev.uuid ?? `compaction-${i}`,
            parentId,
          };
          if (ev.timestamp) node.timestamp = ev.timestamp;
          if (sidechain) node.sidechain = true;
          if (meta.trigger) node.trigger = meta.trigger;
          if (meta.preTokens != null) node.preTokens = meta.preTokens;
          if (meta.postTokens != null) node.postTokens = meta.postTokens;
          if (meta.preTokens != null && meta.postTokens != null) {
            node.droppedTokens = Math.max(0, meta.preTokens - meta.postTokens);
          }
          emit(node, ev);
        } else {
          const node: SystemNode = {
            kind: 'system',
            id: ev.uuid ?? `system-${i}`,
            parentId,
          };
          if (ev.timestamp) node.timestamp = ev.timestamp;
          if (sidechain) node.sidechain = true;
          if (ev.subtype) node.subtype = ev.subtype;
          if (ev.durationMs != null) node.durationMs = ev.durationMs;
          if (typeof ev.content === 'string' && ev.content) node.label = firstLine(ev.content, 80);
          else if (ev.subtype) node.label = ev.subtype.replace(/_/g, ' ');
          // Turn durations carry data for totals but are noise in the tree.
          if (ev.subtype === 'turn_duration') node.hidden = true;
          emit(node, ev);
        }
        break;
      }
      case 'attachment': {
        const node: AttachmentNode = {
          kind: 'attachment',
          id: ev.uuid ?? `attachment-${i}`,
          parentId,
          label: ev.attachment?.type ?? 'attachment',
        };
        if (ev.timestamp) node.timestamp = ev.timestamp;
        if (sidechain) node.sidechain = true;
        emit(node, ev);
        break;
      }
      case 'ai-title': {
        if (ev.aiTitle) session.meta.title = ev.aiTitle;
        break;
      }
      case 'summary': {
        // Older transcripts store a topic summary instead of ai-title events.
        if (ev.summary && !session.meta.title) session.meta.title = ev.summary;
        break;
      }
      // Pure session bookkeeping — not part of the workflow tree.
      case 'agent-name':
      case 'agent-setting':
      case 'custom-title':
      case 'last-prompt':
      case 'mode':
      case 'permission-mode':
      case 'file-history-snapshot':
      case 'pr-link':
      case 'queue-operation':
      case 'worktree-state':
        break;
      default: {
        const node: UnknownNode = {
          kind: 'unknown',
          id: ev.uuid ?? `unknown-${i}`,
          parentId,
        };
        if (ev.timestamp) node.timestamp = ev.timestamp;
        if (sidechain) node.sidechain = true;
        if (typeof ev.type === 'string') node.rawType = ev.type;
        emit(node, ev);
        warn(`unrecognized event type "${ev.type}" (rendered as opaque node)`);
      }
    }
  }

  session.meta.models = [...models];
  return session;

  // -------------------------------------------------------------------------

  function handleAssistant(ev: RawEvent, parentId: string | null, sidechain: boolean): void {
    const msg = ev.message;
    const blocks = toAssistantBlocks(msg?.content, ev.timestamp);
    if (msg?.model) models.add(msg.model);

    // Claude Code writes one JSONL event per content block of the same API
    // message; merge them so one message = one node (and one usage record).
    const existing = msg?.id ? assistantByMessageId.get(msg.id) : undefined;
    if (existing && parentId === existing.id) {
      existing.blocks.push(...blocks);
      if (msg?.usage) existing.usage = toUsage(msg.usage);
      if (ev.uuid) nodeFor.set(ev.uuid, existing);
      return;
    }

    const node: AssistantNode = {
      kind: 'assistant',
      id: ev.uuid ?? msg?.id ?? `assistant-${session.nodes.length}`,
      parentId,
      blocks,
    };
    if (ev.timestamp) node.timestamp = ev.timestamp;
    if (sidechain) node.sidechain = true;
    if (msg?.id) node.messageId = msg.id;
    if (msg?.model) node.model = msg.model;
    if (msg?.usage) node.usage = toUsage(msg.usage);
    emit(node, ev);
    if (msg?.id) assistantByMessageId.set(msg.id, node);
  }

  function handleUser(ev: RawEvent, parentId: string | null, sidechain: boolean): void {
    const content = ev.message?.content;
    const resultBlocks = Array.isArray(content)
      ? content.filter((b): b is RawContentBlock => b?.type === 'tool_result')
      : [];

    if (resultBlocks.length > 0) {
      // Tool results resolve pending calls; the event itself is not a node.
      // Later events that point at this uuid re-parent to the assistant node
      // via the rawParent chain walk in resolveParent().
      for (const block of resultBlocks) {
        const pending = block.tool_use_id ? pendingCalls.get(block.tool_use_id) : undefined;
        if (!pending) {
          warn('tool_result without a matching tool_use (ignored)');
          continue;
        }
        const { call, startedAt } = pending;
        call.status = block.is_error === true ? 'error' : 'success';
        const summary = summarizeResult(block, ev.toolUseResult);
        if (summary) call.resultSummary = summary;
        if (startedAt && ev.timestamp) {
          const ms = Date.parse(ev.timestamp) - Date.parse(startedAt);
          if (Number.isFinite(ms) && ms >= 0) call.durationMs = ms;
        }
        if (block.tool_use_id) pendingCalls.delete(block.tool_use_id);
      }
      return;
    }

    const text = extractText(content);
    const node: UserPromptNode = {
      kind: 'user-prompt',
      id: ev.uuid ?? `user-${session.nodes.length}`,
      parentId,
      text,
    };
    if (ev.timestamp) node.timestamp = ev.timestamp;
    if (sidechain) node.sidechain = true;
    if (ev.isMeta || isHarnessText(text)) node.meta = true;
    emit(node, ev);
  }

  function toAssistantBlocks(
    content: string | RawContentBlock[] | undefined,
    timestamp: string | undefined,
  ): AssistantBlock[] {
    if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
    if (!Array.isArray(content)) return [];
    const blocks: AssistantBlock[] = [];
    for (const raw of content) {
      switch (raw?.type) {
        case 'text':
          if (raw.text) blocks.push({ type: 'text', text: raw.text });
          break;
        case 'thinking': {
          const thought = raw.thinking ?? '';
          const block: AssistantBlock = { type: 'thinking', chars: thought.length };
          const preview = firstLine(thought, 80);
          if (preview) block.preview = preview;
          blocks.push(block);
          break;
        }
        case 'tool_use': {
          const call: ToolCall = {
            id: raw.id ?? `tool-${session.nodes.length}-${blocks.length}`,
            name: raw.name ?? 'unknown-tool',
            status: 'pending',
          };
          if (raw.input !== undefined) call.input = raw.input;
          const detail = toolDetail(call.name, raw.input);
          if (detail) call.detail = detail;
          const edit = fileChangeFor(call.name, raw.input);
          if (edit) call.fileChange = edit;
          blocks.push({ type: 'tool-call', call });
          pendingCalls.set(call.id, timestamp ? { call, startedAt: timestamp } : { call });
          break;
        }
        default:
          // redacted_thinking, server_tool_use, images… — invisible to the tree.
          break;
      }
    }
    return blocks;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toUsage(raw: RawUsage): TokenUsage {
  return {
    inputTokens: raw.input_tokens ?? 0,
    outputTokens: raw.output_tokens ?? 0,
    cacheReadTokens: raw.cache_read_input_tokens ?? 0,
    cacheCreationTokens: raw.cache_creation_input_tokens ?? 0,
  };
}

function extractText(content: string | RawContentBlock[] | undefined): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n');
}

/** Harness-generated user events: command wrappers, reminders, interruptions. */
function isHarnessText(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith('<') || t.startsWith('Caveat:') || t.startsWith('[Request interrupted');
}

function firstLine(text: string, max: number): string {
  const line = text.trim().split('\n', 1)[0] ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function summarizeResult(block: RawContentBlock, toolUseResult: unknown): string | undefined {
  const fromBlock =
    typeof block.content === 'string'
      ? block.content
      : Array.isArray(block.content)
        ? extractText(block.content)
        : '';
  const text = fromBlock.trim() || (typeof toolUseResult === 'string' ? toolUseResult.trim() : '');
  if (!text) return undefined;
  return firstLine(text, block.is_error === true ? 200 : 120);
}

function fileChangeFor(name: string, input: unknown): { path: string; action: 'edit' | 'write' } | undefined {
  const action = FILE_EDIT_TOOLS[name];
  if (!action) return undefined;
  const path = stringField(input, 'file_path') ?? stringField(input, 'notebook_path');
  return path ? { path, action } : undefined;
}

function toolDetail(name: string, input: unknown): string | undefined {
  const field = (key: string): string | undefined => stringField(input, key);
  switch (name) {
    case 'Bash':
      return field('description') ?? truncate(field('command'), 60);
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
      return field('file_path');
    case 'NotebookEdit':
      return field('notebook_path');
    case 'Grep':
      return field('pattern');
    case 'Glob':
      return field('pattern');
    case 'Agent':
    case 'Task':
      return field('description');
    case 'WebFetch':
      return field('url');
    case 'WebSearch':
      return field('query');
    case 'Skill':
      return field('skill');
    default: {
      // Fall back to the first short string field in the input.
      if (typeof input !== 'object' || input === null) return undefined;
      for (const value of Object.values(input)) {
        if (typeof value === 'string' && value.length > 0 && value.length <= 80) {
          return firstLine(value, 60);
        }
      }
      return undefined;
    }
  }
}

function stringField(input: unknown, key: string): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === 'string' && value ? value : undefined;
}

function truncate(text: string | undefined, max: number): string | undefined {
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
