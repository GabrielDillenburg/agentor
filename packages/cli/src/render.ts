import type { Session, ToolCall } from '@agentor/schema';
import { buildDisplayItems, buildTree, computeTotals } from '@agentor/schema';
import pc from 'picocolors';
import { fmtDuration, fmtTimeRange, fmtTokens, truncate } from './format.js';

export interface RenderOptions {
  color?: boolean;
  full?: boolean;
}

interface Line {
  depth: number;
  text: string;
}

const INDENT = '  ';
const TEXT_WIDTH = 100;

export function renderSession(session: Session, opts: RenderOptions = {}): string {
  const c = pc.createColors(opts.color ?? true);
  const full = opts.full ?? false;
  const tree = buildTree(session);
  const totals = computeTotals(session, tree);
  const items = buildDisplayItems(session, tree);
  const lines: Line[] = [];

  const push = (depth: number, text: string): void => {
    lines.push({ depth, text });
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

  // ---- tree (shared display-item semantics; see @agentor/schema display.ts) ----
  for (const item of items) {
    switch (item.kind) {
      case 'prompt': {
        const label = c.bold(c.cyan(`● Turn ${item.turn}`));
        if (!full) {
          push(item.depth, `${label} ${c.cyan(truncate(item.node.text, TEXT_WIDTH))}`);
        } else {
          push(item.depth, label);
          for (const l of item.node.text.trim().split('\n')) push(item.depth + 1, c.cyan(l));
        }
        break;
      }
      case 'meta':
        push(item.depth, c.dim(`· ${item.label}`));
        break;
      case 'text':
        pushText(item.depth, item.text, (s) => `${c.dim('▪')} ${s}`);
        break;
      case 'thinking':
        // Stored transcripts strip thinking text (signature only) — omit a "0 chars" count.
        push(item.depth, c.dim(item.chars > 0 ? `○ thinking (${fmtTokens(item.chars)} chars)` : '○ thinking'));
        break;
      case 'tool-call':
        renderToolCall(item.depth, item.call);
        break;
      case 'compaction': {
        const node = item.node;
        const dropped = node.droppedTokens != null ? fmtTokens(node.droppedTokens) : '?';
        const tokenRange =
          node.preTokens != null && node.postTokens != null
            ? ` (${fmtTokens(node.preTokens)} → ${fmtTokens(node.postTokens)})`
            : '';
        const trigger = node.trigger ? ` · ${node.trigger}` : '';
        push(item.depth, c.yellow(`▼ context compacted — dropped ${dropped} tokens${tokenRange}${trigger}`));
        break;
      }
      case 'attachments':
        push(
          item.depth,
          c.dim(item.count === 1 ? `· attachment: ${item.label ?? ''}` : `· ${item.count} attachments`),
        );
        break;
      case 'unknown':
        push(item.depth, c.dim(`? unrecognized event${item.node.rawType ? ` · ${item.node.rawType}` : ''}`));
        break;
      case 'abandoned': {
        const s = item.stats;
        const bits = [
          s.prompts === 1 ? '1 prompt' : `${s.prompts} prompts`,
          s.toolCalls === 1 ? '1 tool call' : `${s.toolCalls} tool calls`,
          s.nodes === 1 ? '1 event' : `${s.nodes} events`,
        ];
        push(item.depth, c.dim(`╳ abandoned path · ${bits.join(' · ')}`));
        break;
      }
      case 'subagent-header':
        push(0, '');
        push(0, c.dim(c.bold('subagent transcripts')));
        break;
    }
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

  return lines.map((l) => (l.text ? INDENT.repeat(l.depth) + l.text : '')).join('\n');
}
