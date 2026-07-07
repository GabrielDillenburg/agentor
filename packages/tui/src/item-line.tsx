import { Text } from 'ink';
import type { JSX } from 'react';
import type { DisplayItem, ToolCall } from '@agentor/schema';
import { fmtDuration, fmtTokens, squeeze } from './format.js';

const TEXT_WIDTH = 100;

export function relPath(p: string, cwd?: string): string {
  return cwd && p.startsWith(`${cwd}/`) ? p.slice(cwd.length + 1) : p;
}

/** Human-friendly tool name: mcp__server__tool → server:tool. */
export function toolLabel(name: string): string {
  if (name.startsWith('mcp__')) {
    const parts = name.split('__');
    return `${parts[1] ?? ''}:${parts.slice(2).join('_')}`;
  }
  return name;
}

export function toolIcon(name: string): string {
  switch (name) {
    case 'Bash':
      return '⚡';
    case 'Read':
      return '⊙';
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return '✎';
    case 'Write':
      return '✚';
    case 'Grep':
    case 'Glob':
      return '⌕';
    case 'Agent':
    case 'Task':
      return '◇';
    case 'WebFetch':
    case 'WebSearch':
      return '⇅';
    default:
      return name.startsWith('mcp__') ? '⚙' : '·';
  }
}

function toolDetailText(call: ToolCall, cwd?: string): string {
  if (call.fileChange) return relPath(call.fileChange.path, cwd);
  if (!call.detail) return '';
  return squeeze(call.detail.startsWith('/') ? relPath(call.detail, cwd) : call.detail, 80);
}

/** Plain (uncolored) one-line form of an item — used for measurements and detail panes. */
export function itemPlainLine(item: DisplayItem, cwd?: string): string {
  switch (item.kind) {
    case 'prompt':
      return `● Turn ${item.turn} · ${squeeze(item.node.text, TEXT_WIDTH)}`;
    case 'meta':
      return `· ${item.label}`;
    case 'text':
      return `▪ ${squeeze(item.text, TEXT_WIDTH)}`;
    case 'thinking':
      return item.chars > 0 ? `○ thinking (${fmtTokens(item.chars)} chars)` : '○ thinking';
    case 'tool-call': {
      const call = item.call;
      const parts = [toolIcon(call.name), toolLabel(call.name)];
      const detail = toolDetailText(call, cwd);
      if (detail) parts.push(detail);
      if (call.status === 'error') parts.push(`✗ ${squeeze(call.resultSummary ?? 'failed', 90)}`);
      if (call.durationMs != null && call.durationMs >= 3_000) parts.push(`(${fmtDuration(call.durationMs)})`);
      return parts.join(' ');
    }
    case 'compaction': {
      const n = item.node;
      const dropped = n.droppedTokens != null ? fmtTokens(n.droppedTokens) : '?';
      const range =
        n.preTokens != null && n.postTokens != null
          ? ` (${fmtTokens(n.preTokens)} → ${fmtTokens(n.postTokens)})`
          : '';
      return `▼ context compacted — dropped ${dropped} tokens${range}${n.trigger ? ` · ${n.trigger}` : ''}`;
    }
    case 'attachments':
      return item.count === 1 ? `· attachment: ${item.label ?? ''}` : `· ${item.count} attachments`;
    case 'unknown':
      return `? unrecognized event${item.node.rawType ? ` · ${item.node.rawType}` : ''}`;
    case 'abandoned': {
      const s = item.stats;
      return `╳ abandoned path · ${s.prompts} prompts · ${s.toolCalls} tool calls · ${s.nodes} events`;
    }
    case 'subagent-header':
      return 'subagent transcripts';
  }
}

function Guides({ depth }: { depth: number }): JSX.Element | null {
  if (depth <= 0) return null;
  return <Text dimColor>{'│ '.repeat(depth)}</Text>;
}

export function ItemLine({
  item,
  selected,
  cwd,
}: {
  item: DisplayItem;
  selected: boolean;
  cwd?: string;
}): JSX.Element {
  const marker = selected ? (
    <Text color="cyan" bold>
      {'❯ '}
    </Text>
  ) : (
    <Text>{'  '}</Text>
  );

  const body = ((): JSX.Element => {
    switch (item.kind) {
      case 'prompt':
        return (
          <Text>
            <Text color="cyan" bold>
              ● Turn {item.turn}
            </Text>
            <Text dimColor> · </Text>
            <Text color="cyan">{squeeze(item.node.text, TEXT_WIDTH)}</Text>
          </Text>
        );
      case 'meta':
        return <Text dimColor>· {item.label}</Text>;
      case 'text':
        return (
          <Text>
            <Text dimColor>▪ </Text>
            {squeeze(item.text, TEXT_WIDTH)}
          </Text>
        );
      case 'thinking':
        return (
          <Text dimColor>
            {item.chars > 0 ? `○ thinking (${fmtTokens(item.chars)} chars)` : '○ thinking'}
          </Text>
        );
      case 'tool-call': {
        const call = item.call;
        const iconColor = call.status === 'error' ? 'red' : call.status === 'success' ? 'green' : 'yellow';
        const detail = toolDetailText(call, cwd);
        return (
          <Text>
            <Text color={iconColor}>{toolIcon(call.name)} </Text>
            <Text bold>{toolLabel(call.name)}</Text>
            {detail ? (
              call.fileChange ? (
                <Text color="magenta"> {detail}</Text>
              ) : (
                <Text> {detail}</Text>
              )
            ) : null}
            {call.status === 'error' ? (
              <Text color="red"> ✗ {squeeze(call.resultSummary ?? 'failed', 90)}</Text>
            ) : null}
            {call.status === 'pending' ? <Text color="yellow"> …</Text> : null}
            {call.durationMs != null && call.durationMs >= 3_000 ? (
              <Text dimColor> ({fmtDuration(call.durationMs)})</Text>
            ) : null}
          </Text>
        );
      }
      case 'compaction':
        return <Text color="yellow">{itemPlainLine(item, cwd)}</Text>;
      case 'attachments':
      case 'unknown':
      case 'abandoned':
        return <Text dimColor>{itemPlainLine(item, cwd)}</Text>;
      case 'subagent-header':
        return (
          <Text bold dimColor>
            subagent transcripts
          </Text>
        );
    }
  })();

  return (
    <Text wrap="truncate-end">
      {marker}
      <Guides depth={item.depth} />
      {selected ? <Text bold>{body}</Text> : body}
    </Text>
  );
}

/** Multi-line detail for the bottom pane. */
export function itemDetailLines(item: DisplayItem, cwd?: string): string[] {
  switch (item.kind) {
    case 'prompt':
      return item.node.text.trim().split('\n');
    case 'text':
      return item.text.trim().split('\n');
    case 'thinking':
      return [item.preview ?? '(thinking content is stripped from stored transcripts)'];
    case 'tool-call': {
      const call = item.call;
      const lines = [
        `${toolLabel(call.name)} — ${call.status}${call.durationMs != null ? ` · ${fmtDuration(call.durationMs)}` : ''}`,
      ];
      if (call.detail) lines.push(call.detail.startsWith('/') ? relPath(call.detail, cwd) : call.detail);
      if (call.fileChange) lines.push(`${call.fileChange.action}: ${relPath(call.fileChange.path, cwd)}`);
      if (call.resultSummary) lines.push(call.resultSummary);
      return lines;
    }
    case 'compaction':
      return [itemPlainLine(item, cwd)];
    case 'meta':
      return [item.label];
    case 'attachments':
      return [itemPlainLine(item, cwd)];
    case 'abandoned':
      return ['This branch was forked away from the surviving conversation flow.', itemPlainLine(item, cwd)];
    case 'unknown':
      return [`Event type not recognized by this Agentor version${item.node.rawType ? `: ${item.node.rawType}` : ''}.`];
    case 'subagent-header':
      return ['Transcript events recorded by subagents (sidechains).'];
  }
}
