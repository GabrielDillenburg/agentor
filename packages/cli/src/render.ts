import type {
  AssistantNode,
  Session,
  SessionNode,
  SessionTree,
  ToolCall,
  UserPromptNode,
} from '@agentor/schema';
import { buildTree, computeTotals, continuationChild, isSubstantive, subtreeStats } from '@agentor/schema';
import pc from 'picocolors';
import { fmtDuration, fmtTimeRange, fmtTokens, truncate } from './format.js';

export interface RenderOptions {
  color?: boolean;
  full?: boolean;
}

interface Line {
  depth: number;
  text: string;
  /** Set for attachment lines so consecutive runs can be merged. */
  mergeKey?: string;
}

const INDENT = '  ';
const TEXT_WIDTH = 100;

export function renderSession(session: Session, opts: RenderOptions = {}): string {
  const c = pc.createColors(opts.color ?? true);
  const full = opts.full ?? false;
  const tree = buildTree(session);
  const totals = computeTotals(session, tree);
  const lines: Line[] = [];
  let turn = 0;

  const push = (depth: number, text: string, mergeKey?: string): void => {
    lines.push(mergeKey ? { depth, text, mergeKey } : { depth, text });
  };

  const relPath = (p: string): string => {
    const cwd = session.meta.cwd;
    return cwd && p.startsWith(`${cwd}/`) ? p.slice(cwd.length + 1) : p;
  };

  const pushText = (depth: number, raw: string, decorate: (s: string) => string): void => {
    if (!full) {
      push(depth, decorate(truncate(raw, TEXT_WIDTH)));
      return;
    }
    for (const l of raw.trim().split('\n')) push(depth, decorate(l));
  };

  const renderToolCall = (depth: number, call: ToolCall): void => {
    const glyph =
      call.status === 'error' ? c.red('✗') : call.status === 'success' ? c.green('✓') : c.yellow('◌');
    const parts: string[] = [glyph, c.bold(call.name)];
    if (call.fileChange) parts.push(c.magenta(relPath(call.fileChange.path)));
    else if (call.detail) {
      const d = call.detail.startsWith('/') ? relPath(call.detail) : call.detail;
      parts.push(truncate(d, 80));
    }
    if (call.status === 'error' && call.resultSummary) {
      parts.push(c.red(`— ${truncate(call.resultSummary, 90)}`));
    }
    if (call.durationMs != null && call.durationMs >= 3_000) {
      parts.push(c.dim(`(${fmtDuration(call.durationMs)})`));
    }
    push(depth, parts.join(' '));
  };

  const renderAssistant = (depth: number, node: AssistantNode): void => {
    for (const block of node.blocks) {
      switch (block.type) {
        case 'text':
          pushText(depth, block.text, (s) => `${c.dim('▪')} ${s}`);
          break;
        case 'thinking':
          // Stored transcripts strip thinking text (signature only) — omit a "0 chars" count.
          push(depth, c.dim(block.chars > 0 ? `○ thinking (${fmtTokens(block.chars)} chars)` : '○ thinking'));
          break;
        case 'tool-call':
          renderToolCall(depth, block.call);
          break;
      }
    }
  };

  const renderPrompt = (promptDepth: number, activityDepth: number, node: UserPromptNode): void => {
    if (node.meta) {
      push(activityDepth, c.dim(`· ${metaLabel(node.text)}`));
      return;
    }
    turn += 1;
    const label = c.bold(c.cyan(`● Turn ${turn}`));
    if (!full) {
      push(promptDepth, `${label} ${c.cyan(truncate(node.text, TEXT_WIDTH))}`);
    } else {
      push(promptDepth, label);
      for (const l of node.text.trim().split('\n')) push(promptDepth + 1, c.cyan(l));
    }
  };

  const emitNode = (node: SessionNode, promptDepth: number, activityDepth: number): void => {
    switch (node.kind) {
      case 'user-prompt':
        renderPrompt(promptDepth, activityDepth, node);
        break;
      case 'assistant':
        renderAssistant(activityDepth, node);
        break;
      case 'compaction': {
        const dropped = node.droppedTokens != null ? fmtTokens(node.droppedTokens) : '?';
        const range =
          node.preTokens != null && node.postTokens != null
            ? ` (${fmtTokens(node.preTokens)} → ${fmtTokens(node.postTokens)})`
            : '';
        const trigger = node.trigger ? ` · ${node.trigger}` : '';
        push(activityDepth, c.yellow(`▼ context compacted — dropped ${dropped} tokens${range}${trigger}`));
        break;
      }
      case 'system':
        if (!node.hidden) push(activityDepth, c.dim(`· ${node.label ?? 'system'}`));
        break;
      case 'attachment':
        push(activityDepth, c.dim(`· attachment: ${node.label ?? ''}`), `attachment:${activityDepth}`);
        break;
      case 'unknown':
        push(activityDepth, c.dim(`? unrecognized event${node.rawType ? ` · ${node.rawType}` : ''}`));
        break;
    }
  };

  const emitAbandoned = (node: SessionNode, depth: number): void => {
    const stats = subtreeStats(tree, node);
    const bits = [
      stats.prompts === 1 ? '1 prompt' : `${stats.prompts} prompts`,
      stats.toolCalls === 1 ? '1 tool call' : `${stats.toolCalls} tool calls`,
      stats.nodes === 1 ? '1 event' : `${stats.nodes} events`,
    ];
    push(depth, c.dim(`╳ abandoned path · ${bits.join(' · ')}`));
  };

  const walkChain = (start: SessionNode, promptDepth: number, activityDepth: number): void => {
    let node: SessionNode | undefined = start;
    while (node) {
      emitNode(node, promptDepth, activityDepth);
      const kids: SessionNode[] = tree.children.get(node.id) ?? [];
      const cont: SessionNode | undefined = continuationChild(tree, kids);
      for (const kid of kids) {
        if (kid === cont) continue;
        if (isSubstantive(tree, kid)) emitAbandoned(kid, activityDepth + 1);
        else walkChain(kid, activityDepth + 1, activityDepth + 1);
      }
      node = cont;
    }
  };

  // ---- header ----
  const shortId = session.meta.id.slice(0, 8);
  push(0, `${c.bold('agentor')} ${c.dim('·')} ${session.meta.agent} session ${c.dim(shortId)}`);
  if (session.meta.title) push(0, c.bold(`“${session.meta.title}”`));
  const headerBits: string[] = [];
  if (session.meta.agentVersion) headerBits.push(`v${session.meta.agentVersion}`);
  if (session.meta.cwd) {
    const base = session.meta.cwd.split('/').filter(Boolean).pop() ?? session.meta.cwd;
    headerBits.push(session.meta.gitBranch ? `${base} (${session.meta.gitBranch})` : base);
  }
  const range = fmtTimeRange(session.meta.startedAt, session.meta.endedAt);
  if (range) headerBits.push(range);
  if (totals.wallClockMs != null) headerBits.push(fmtDuration(totals.wallClockMs));
  if (headerBits.length) push(0, c.dim(headerBits.join(' · ')));
  push(0, '');

  // ---- tree ----
  const mainRoots = tree.roots.filter((r) => !r.sidechain);
  const sideRoots = tree.roots.filter((r) => r.sidechain);
  for (const root of mainRoots) walkChain(root, 0, 1);
  if (sideRoots.length > 0) {
    push(0, '');
    push(0, c.dim(c.bold('subagent transcripts')));
    for (const root of sideRoots) walkChain(root, 1, 2);
  }

  // ---- summary ----
  push(0, '');
  push(0, c.dim('─'.repeat(60)));
  const topTools = Object.entries(totals.toolCallsByName)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => `${name} ${count}`)
    .join(', ');
  push(
    0,
    `${c.bold(String(totals.turns))} turns · ${c.bold(String(totals.toolCalls))} tool calls${topTools ? c.dim(` (${topTools})`) : ''}`,
  );
  const line3: string[] = [];
  line3.push(`files changed ${c.bold(String(totals.filesChanged.length))}`);
  line3.push(totals.errors > 0 ? c.red(`errors ${totals.errors}`) : 'errors 0');
  if (totals.compactions > 0) {
    line3.push(c.yellow(`compactions ${totals.compactions} (dropped ${fmtTokens(totals.droppedTokens)} tokens)`));
  }
  if (totals.abandonedBranches > 0) line3.push(`abandoned paths ${totals.abandonedBranches}`);
  push(0, line3.join(' · '));
  const u = totals.usage;
  const totalIn = u.inputTokens + u.cacheReadTokens + u.cacheCreationTokens;
  const cachedPct = totalIn > 0 ? Math.round((u.cacheReadTokens / totalIn) * 100) : 0;
  const tokenBits = [`tokens in ${fmtTokens(totalIn)}${totalIn > 0 ? c.dim(` (${cachedPct}% cached)`) : ''}`, `out ${fmtTokens(u.outputTokens)}`];
  if (totals.activeDurationMs > 0) tokenBits.push(`active ${fmtDuration(totals.activeDurationMs)}`);
  push(0, tokenBits.join(' · '));
  if (session.warnings.length > 0) {
    push(0, c.dim(`parse warnings ${session.warnings.length} (run with --json for details)`));
  }

  return materialize(lines, c);
}

/** Collapse consecutive attachment lines at the same depth into one dim line. */
function materialize(lines: Line[], c: ReturnType<typeof pc.createColors>): string {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line) break;
    if (line.mergeKey) {
      let j = i;
      while (j + 1 < lines.length && lines[j + 1]?.mergeKey === line.mergeKey) j++;
      const count = j - i + 1;
      out.push(
        INDENT.repeat(line.depth) +
          (count === 1 ? line.text : c.dim(`· ${count} attachments`)),
      );
      i = j + 1;
      continue;
    }
    out.push(line.text ? INDENT.repeat(line.depth) + line.text : '');
    i++;
  }
  return out.join('\n');
}

/** Compact label for harness-generated "user" events (commands, notifications…). */
function metaLabel(text: string): string {
  const command = /<command-name>([^<]+)<\/command-name>/.exec(text)?.[1];
  if (command) return `command: ${command.trim()}`;
  if (text.includes('<local-command-stdout>')) return 'command output';
  if (text.includes('<system-reminder>')) return 'system reminder';
  if (text.includes('<task-notification>')) return 'task notification';
  if (text.trimStart().startsWith('Caveat:')) return 'harness caveat';
  if (text.trimStart().startsWith('[Request interrupted')) return 'interrupted by user';
  return `system message: ${truncate(text.replace(/<[^>]*>/g, ' '), 60)}`;
}
