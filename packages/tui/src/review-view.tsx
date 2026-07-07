import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useEffect, useMemo, useState, type JSX } from 'react';
import type { DisplayItem, ToolCall } from '@agentor/schema';
import { relPath } from './item-line.js';
import { loadReviewState, saveReviewState } from './review-store.js';

interface ChangeEntry {
  index: number;
  call: ToolCall;
  turn?: number;
}

export function collectChanges(items: DisplayItem[]): ChangeEntry[] {
  const entries: ChangeEntry[] = [];
  let turn: number | undefined;
  for (const [index, item] of items.entries()) {
    if (item.kind === 'prompt') turn = item.turn;
    if (item.kind === 'tool-call' && item.call.fileChange) {
      const entry: ChangeEntry = { index, call: item.call };
      if (turn != null) entry.turn = turn;
      entries.push(entry);
    }
  }
  return entries;
}

export function ReviewView({
  items,
  sessionId,
  cwd,
  onBack,
  onOpenProvenance,
}: {
  items: DisplayItem[];
  sessionId: string;
  cwd?: string;
  onBack: () => void;
  onOpenProvenance: (index: number) => void;
}): JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const rows = stdout?.rows && stdout.rows >= 6 ? stdout.rows : 24;
  const entries = useMemo(() => collectChanges(items), [items]);
  const [selected, setSelected] = useState(0);
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());

  useEffect(() => {
    void loadReviewState(sessionId).then(setReviewed);
  }, [sessionId]);

  const last = Math.max(0, entries.length - 1);

  useInput((input, key) => {
    if (input === 'q') return exit();
    if (input === 'h' || key.escape) return onBack();
    if (input === 'j' || key.downArrow) setSelected((s) => Math.min(last, s + 1));
    else if (input === 'k' || key.upArrow) setSelected((s) => Math.max(0, s - 1));
    else if (input === ' ' || input === 'm') {
      const entry = entries[selected];
      if (!entry) return;
      setReviewed((prev) => {
        const next = new Set(prev);
        if (next.has(entry.call.id)) next.delete(entry.call.id);
        else next.add(entry.call.id);
        void saveReviewState(sessionId, next);
        return next;
      });
    } else if (key.return || input === 'l') {
      const entry = entries[selected];
      if (entry) onOpenProvenance(entry.index);
    }
  });

  const done = entries.filter((e) => reviewed.has(e.call.id)).length;
  const viewport = Math.max(3, rows - 3);
  const start = Math.max(0, Math.min(selected - Math.floor(viewport / 2), entries.length - viewport));

  return (
    <Box flexDirection="column" height={rows}>
      <Text wrap="truncate-end">
        <Text bold color="magenta">
          review
        </Text>{' '}
        <Text dimColor>·</Text>{' '}
        <Text bold color={done === entries.length && entries.length > 0 ? 'green' : undefined}>
          {done}/{entries.length} reviewed
        </Text>
      </Text>
      <Box flexDirection="column" flexGrow={1}>
        {entries.slice(start, start + viewport).map((entry, i) => {
          const isSelected = start + i === selected;
          const isReviewed = reviewed.has(entry.call.id);
          const glyph = entry.call.status === 'error' ? '✗' : '✓';
          const line = `${isReviewed ? '[x]' : '[ ]'} ${glyph} ${entry.call.fileChange!.action.padEnd(5)} ${relPath(entry.call.fileChange!.path, cwd)}${entry.turn != null ? `  · Turn ${entry.turn}` : ''}`;
          return (
            <Text
              key={entry.call.id}
              wrap="truncate-end"
              inverse={isSelected}
              {...(!isSelected && isReviewed ? { dimColor: true } : {})}
              {...(!isSelected && !isReviewed && entry.call.status === 'error' ? { color: 'red' as const } : {})}
            >
              {isSelected ? '> ' : '  '}
              {line}
            </Text>
          );
        })}
        {entries.length === 0 ? <Text dimColor>no file changes in this session</Text> : null}
      </Box>
      <Text dimColor wrap="truncate-end">
        space mark reviewed · enter why · j/k move · h/esc back · q quit
      </Text>
    </Box>
  );
}
