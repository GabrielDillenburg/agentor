/**
 * @agentor/schema — the normalized session-event model.
 *
 * Every supported coding agent (Claude Code, Codex CLI, Gemini CLI, opencode…)
 * gets an adapter that parses its native transcript format into this model.
 * Everything downstream (renderers, the TUI, totals, provenance) only ever
 * sees these types.
 */

export type AgentKind =
  | 'claude-code'
  | 'codex-cli'
  | 'gemini-cli'
  | 'opencode'
  | (string & {});

// ---------------------------------------------------------------------------
// Usage / cost
// ---------------------------------------------------------------------------

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
}

export function addUsage(target: TokenUsage, source: TokenUsage): TokenUsage {
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.cacheReadTokens += source.cacheReadTokens;
  target.cacheCreationTokens += source.cacheCreationTokens;
  return target;
}

// ---------------------------------------------------------------------------
// Session + nodes
// ---------------------------------------------------------------------------

export interface SessionMeta {
  id: string;
  agent: AgentKind;
  title?: string;
  cwd?: string;
  gitBranch?: string;
  agentVersion?: string;
  models: string[];
  startedAt?: string;
  endedAt?: string;
}

export type ToolStatus = 'success' | 'error' | 'pending';

export interface FileChange {
  path: string;
  action: 'edit' | 'write';
}

export interface ToolCall {
  id: string;
  name: string;
  /** Concise human-readable argument summary, e.g. a file path or command description. */
  detail?: string;
  input?: unknown;
  status: ToolStatus;
  resultSummary?: string;
  durationMs?: number;
  fileChange?: FileChange;
}

export type AssistantBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; chars: number; preview?: string }
  | { type: 'tool-call'; call: ToolCall };

interface NodeBase {
  id: string;
  parentId: string | null;
  timestamp?: string;
  /** True for events belonging to a subagent (sidechain) transcript. */
  sidechain?: boolean;
}

export interface UserPromptNode extends NodeBase {
  kind: 'user-prompt';
  text: string;
  /** Harness-generated content (command wrappers, notifications), not a human prompt. */
  meta?: boolean;
}

export interface AssistantNode extends NodeBase {
  kind: 'assistant';
  messageId?: string;
  model?: string;
  blocks: AssistantBlock[];
  /** Usage for the whole underlying message; adapters must report it exactly once per message. */
  usage?: TokenUsage;
}

export interface CompactionNode extends NodeBase {
  kind: 'compaction';
  trigger?: string;
  preTokens?: number;
  postTokens?: number;
  droppedTokens?: number;
}

export interface SystemNode extends NodeBase {
  kind: 'system';
  subtype?: string;
  label?: string;
  durationMs?: number;
  /** Hidden nodes carry data (e.g. turn durations) but are not rendered. */
  hidden?: boolean;
}

export interface AttachmentNode extends NodeBase {
  kind: 'attachment';
  label?: string;
}

export interface UnknownNode extends NodeBase {
  kind: 'unknown';
  rawType?: string;
}

export type SessionNode =
  | UserPromptNode
  | AssistantNode
  | CompactionNode
  | SystemNode
  | AttachmentNode
  | UnknownNode;

export interface Session {
  meta: SessionMeta;
  /** All nodes in transcript (file) order. Tree structure lives in id/parentId. */
  nodes: SessionNode[];
  /** Non-fatal parse problems. Adapters must fail soft, never throw on odd events. */
  warnings: string[];
}

export interface SessionAdapter {
  agent: AgentKind;
  parseFile(path: string): Promise<Session>;
}

// ---------------------------------------------------------------------------
// Topology: tree, active path, abandoned branches
// ---------------------------------------------------------------------------

export interface SessionTree {
  roots: SessionNode[];
  children: Map<string, SessionNode[]>;
  byId: Map<string, SessionNode>;
  /** Ids on the chain from the active leaf up to its root (the "surviving" path). */
  activePathIds: Set<string>;
  activeLeafId?: string;
}

export function buildTree(session: Session): SessionTree {
  const byId = new Map<string, SessionNode>();
  for (const n of session.nodes) byId.set(n.id, n);

  const children = new Map<string, SessionNode[]>();
  const roots: SessionNode[] = [];
  for (const n of session.nodes) {
    if (n.parentId && byId.has(n.parentId)) {
      const list = children.get(n.parentId);
      if (list) list.push(n);
      else children.set(n.parentId, [n]);
    } else {
      roots.push(n);
    }
  }

  // The active leaf is the last main-chain (non-sidechain) node in file order.
  let leaf: SessionNode | undefined;
  for (let i = session.nodes.length - 1; i >= 0; i--) {
    const n = session.nodes[i];
    if (n && !n.sidechain) {
      leaf = n;
      break;
    }
  }

  const activePathIds = new Set<string>();
  let cur: SessionNode | undefined = leaf;
  while (cur) {
    if (activePathIds.has(cur.id)) break; // cycle guard
    activePathIds.add(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }

  const tree: SessionTree = { roots, children, byId, activePathIds };
  if (leaf) tree.activeLeafId = leaf.id;
  return tree;
}

/** A subtree is "substantive" if it contains real conversation (prompt or assistant work). */
export function isSubstantive(tree: SessionTree, node: SessionNode): boolean {
  if (node.kind === 'assistant' || (node.kind === 'user-prompt' && !node.meta)) return true;
  for (const child of tree.children.get(node.id) ?? []) {
    if (isSubstantive(tree, child)) return true;
  }
  return false;
}

export interface SubtreeStats {
  prompts: number;
  textBlocks: number;
  toolCalls: number;
  nodes: number;
}

export function subtreeStats(tree: SessionTree, node: SessionNode): SubtreeStats {
  const stats: SubtreeStats = { prompts: 0, textBlocks: 0, toolCalls: 0, nodes: 0 };
  const visit = (n: SessionNode): void => {
    stats.nodes++;
    if (n.kind === 'user-prompt' && !n.meta) stats.prompts++;
    if (n.kind === 'assistant') {
      for (const b of n.blocks) {
        if (b.type === 'text') stats.textBlocks++;
        if (b.type === 'tool-call') stats.toolCalls++;
      }
    }
    for (const child of tree.children.get(n.id) ?? []) visit(child);
  };
  visit(node);
  return stats;
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

export interface SessionTotals {
  turns: number;
  toolCalls: number;
  toolCallsByName: Record<string, number>;
  filesChanged: string[];
  errors: number;
  compactions: number;
  droppedTokens: number;
  usage: TokenUsage;
  /** Sum of per-turn active durations reported by the agent, when available. */
  activeDurationMs: number;
  /** First-to-last event wall clock. */
  wallClockMs?: number;
  abandonedBranches: number;
  sidechainNodes: number;
}

/**
 * The continuation child at a fork: the one on the active path if any,
 * otherwise the latest in file order. Renderers walk chains the same way,
 * so totals and display always agree.
 */
export function continuationChild(tree: SessionTree, kids: SessionNode[]): SessionNode | undefined {
  return kids.find((k) => tree.activePathIds.has(k.id)) ?? kids[kids.length - 1];
}

/** Ids of every node inside substantive branches forked away from the surviving flow. */
export function abandonedSubtreeIds(tree: SessionTree): { ids: Set<string>; branches: number } {
  const ids = new Set<string>();
  let branches = 0;
  const collect = (n: SessionNode): void => {
    ids.add(n.id);
    for (const child of tree.children.get(n.id) ?? []) collect(child);
  };
  for (const kids of tree.children.values()) {
    if (kids.length < 2) continue;
    const cont = continuationChild(tree, kids);
    for (const kid of kids) {
      if (kid === cont || kid.sidechain) continue;
      if (isSubstantive(tree, kid)) {
        branches++;
        collect(kid);
      }
    }
  }
  return { ids, branches };
}

export function computeTotals(session: Session, tree: SessionTree = buildTree(session)): SessionTotals {
  const totals: SessionTotals = {
    turns: 0,
    toolCalls: 0,
    toolCallsByName: {},
    filesChanged: [],
    errors: 0,
    compactions: 0,
    droppedTokens: 0,
    usage: emptyUsage(),
    activeDurationMs: 0,
    abandonedBranches: 0,
    sidechainNodes: 0,
  };

  // Resumed sessions can leave the transcript as a forest of fragments, so
  // "on the active path" undercounts; count everything except forked-off work.
  const abandoned = abandonedSubtreeIds(tree);
  totals.abandonedBranches = abandoned.branches;

  const files = new Set<string>();
  for (const n of session.nodes) {
    if (n.sidechain) totals.sidechainNodes++;
    switch (n.kind) {
      case 'user-prompt':
        if (!n.meta && !n.sidechain && !abandoned.ids.has(n.id)) totals.turns++;
        break;
      case 'assistant':
        if (n.usage) addUsage(totals.usage, n.usage);
        for (const b of n.blocks) {
          if (b.type !== 'tool-call') continue;
          totals.toolCalls++;
          totals.toolCallsByName[b.call.name] = (totals.toolCallsByName[b.call.name] ?? 0) + 1;
          if (b.call.status === 'error') totals.errors++;
          if (b.call.fileChange) files.add(b.call.fileChange.path);
        }
        break;
      case 'compaction':
        totals.compactions++;
        if (n.preTokens != null && n.postTokens != null) {
          totals.droppedTokens += Math.max(0, n.preTokens - n.postTokens);
        }
        break;
      case 'system':
        if (n.durationMs) totals.activeDurationMs += n.durationMs;
        break;
    }
  }
  totals.filesChanged = [...files];

  if (session.meta.startedAt && session.meta.endedAt) {
    const ms = Date.parse(session.meta.endedAt) - Date.parse(session.meta.startedAt);
    if (Number.isFinite(ms) && ms >= 0) totals.wallClockMs = ms;
  }

  return totals;
}
