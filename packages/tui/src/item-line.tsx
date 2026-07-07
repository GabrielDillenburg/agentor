import { Text } from 'ink';
import type { JSX } from 'react';
import type { DisplayItem } from '@agentor/schema';
import { fmtDuration, fmtTokens, squeeze } from './format.js';

const TEXT_WIDTH = 100;

export function relPath(p: string, cwd?: string): string {
  return cwd && p.startsWith(`${cwd}/`) ? p.slice(cwd.length + 1) : p;
}

/** Plain (uncolored) one-line form of an item — used for selected rows and measurements. */
export function itemPlainLine(item: DisplayItem, cwd?: string): string {
  switch (item.kind) {
    case 'prompt':
      return `● Turn ${item.turn} ${squeeze(item.node.text, TEXT_WIDTH)}`;
    case 'meta':
      return `· ${item.label}`;
    case 'text':
      return `▪ ${squeeze(item.text, TEXT_WIDTH)}`;
    case 'thinking':
      return item.chars > 0 ? `○ thinking (${fmtTokens(item.chars)} chars)` : '○ thinking';
    case 'tool-call': {
      const call = item.call;
      const glyph = call.status === 'error' ? '✗' : call.status === 'success' ? '✓' : '◌';
      const parts = [glyph, call.name];
      if (call.fileChange) parts.push(relPath(call.fileChange.path, cwd));
      else if (call.detail) parts.push(squeeze(call.detail.startsWith('/') ? relPath(call.detail, cwd) : call.detail, 80));
      if (call.status === 'error' && call.resultSummary) parts.push(`— ${squeeze(call.resultSummary, 90)}`);
      if (call.durationMs != null && call.durationMs >= 3_000) parts.push(`(${fmtDuration(call.durationMs)})`);
      return parts.join(' ');
    }
    case 'compaction': {
      const n = item.node;
      const dropped = n.droppedTokens != null ? fmtTokens(n.droppedTokens) : '?';
      const range = n.preTokens != null && n.postTokens != null ? ` (${fmtTokens(n.preTokens)} → ${fmtTokens(n.postTokens)})` : '';
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

export function ItemLine({
  item,
  selected,
  cwd,
}: {
  item: DisplayItem;
  selected: boolean;
  cwd?: string;
}): JSX.Element {
  const indent = '  '.repeat(item.depth);
  if (selected) {
    return (
      <Text wrap="truncate-end" inverse>
        {indent}
        {itemPlainLine(item, cwd)}
      </Text>
    );
  }
  switch (item.kind) {
    case 'prompt':
      return (
        <Text wrap="truncate-end">
          {indent}
          <Text color="cyan" bold>{`● Turn ${item.turn}`}</Text>
          <Text color="cyan"> {squeeze(item.node.text, TEXT_WIDTH)}</Text>
        </Text>
      );
    case 'meta':
      return (
        <Text wrap="truncate-end" dimColor>
          {indent}· {item.label}
        </Text>
      );
    case 'text':
      return (
        <Text wrap="truncate-end">
          {indent}
          <Text dimColor>▪</Text> {squeeze(item.text, TEXT_WIDTH)}
        </Text>
      );
    case 'thinking':
      return (
        <Text wrap="truncate-end" dimColor>
          {indent}
          {item.chars > 0 ? `○ thinking (${fmtTokens(item.chars)} chars)` : '○ thinking'}
        </Text>
      );
    case 'tool-call': {
      const call = item.call;
      const glyphColor = call.status === 'error' ? 'red' : call.status === 'success' ? 'green' : 'yellow';
      const glyph = call.status === 'error' ? '✗' : call.status === 'success' ? '✓' : '◌';
      const detail = call.fileChange
        ? relPath(call.fileChange.path, cwd)
        : call.detail
          ? squeeze(call.detail.startsWith('/') ? relPath(call.detail, cwd) : call.detail, 80)
          : '';
      return (
        <Text wrap="truncate-end">
          {indent}
          <Text color={glyphColor}>{glyph}</Text> <Text bold>{call.name}</Text>
          {detail ? (
            call.fileChange ? (
              <Text color="magenta"> {detail}</Text>
            ) : (
              <Text> {detail}</Text>
            )
          ) : null}
          {call.status === 'error' && call.resultSummary ? (
            <Text color="red"> — {squeeze(call.resultSummary, 90)}</Text>
          ) : null}
          {call.durationMs != null && call.durationMs >= 3_000 ? (
            <Text dimColor> ({fmtDuration(call.durationMs)})</Text>
          ) : null}
        </Text>
      );
    }
    case 'compaction':
      return (
        <Text wrap="truncate-end" color="yellow">
          {indent}
          {itemPlainLine(item, cwd)}
        </Text>
      );
    case 'attachments':
    case 'unknown':
    case 'abandoned':
      return (
        <Text wrap="truncate-end" dimColor>
          {indent}
          {itemPlainLine(item, cwd)}
        </Text>
      );
    case 'subagent-header':
      return (
        <Text wrap="truncate-end" bold dimColor>
          {indent}subagent transcripts
        </Text>
      );
  }
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
        `${call.name} — ${call.status}${call.durationMs != null ? ` · ${fmtDuration(call.durationMs)}` : ''}`,
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
