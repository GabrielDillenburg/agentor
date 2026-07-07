import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useMemo, useState, type JSX } from 'react';
import type { DisplayItem } from '@agentor/schema';
import { computeTurnContexts } from '@agentor/schema';
import { fmtTokens } from './format.js';
import { relPath } from './item-line.js';

/** Assumed context-window size for the fill gauge. */
const WINDOW_TOKENS = 200_000;
const GAUGE_WIDTH = 10;

function gauge(tokens: number | undefined): string {
  const ratio = Math.max(0, Math.min(1, (tokens ?? 0) / WINDOW_TOKENS));
  const filled = Math.round(ratio * GAUGE_WIDTH);
  return '█'.repeat(filled) + '░'.repeat(GAUGE_WIDTH - filled);
}

export function ContextView({
  items,
  cwd,
  onBack,
  onJumpTo,
}: {
  items: DisplayItem[];
  cwd?: string;
  onBack: () => void;
  onJumpTo: (index: number) => void;
}): JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const rows = stdout?.rows && stdout.rows >= 6 ? stdout.rows : 24;
  const turns = useMemo(() => computeTurnContexts(items), [items]);
  const [selected, setSelected] = useState(Math.max(0, turns.length - 1));
  const last = Math.max(0, turns.length - 1);

  useInput((input, key) => {
    if (input === 'q') return exit();
    if (input === 'h' || key.escape) return onBack();
    if (input === 'j' || key.downArrow) setSelected((s) => Math.min(last, s + 1));
    else if (input === 'k' || key.upArrow) setSelected((s) => Math.max(0, s - 1));
    else if (key.return || input === 'l') {
      const t = turns[selected];
      if (t) onJumpTo(t.index);
    }
  });

  const DETAIL_ROWS = 7;
  const viewport = Math.max(3, rows - 2 - DETAIL_ROWS);
  const start = Math.max(0, Math.min(selected - Math.floor(viewport / 2), turns.length - viewport));
  const current = turns[selected];
  const peak = turns.reduce((m, t) => Math.max(m, t.contextTokens ?? 0), 0);

  return (
    <Box flexDirection="column" height={rows}>
      <Text wrap="truncate-end">
        <Text bold color="magenta">
          context
        </Text>{' '}
        <Text dimColor>· window ~{fmtTokens(WINDOW_TOKENS)} tokens · peak {fmtTokens(peak)} ({Math.round((peak / WINDOW_TOKENS) * 100)}%)</Text>
      </Text>
      <Box flexDirection="column" flexGrow={1}>
        {turns.slice(start, start + viewport).map((t, i) => {
          const isSelected = start + i === selected;
          const pct = t.contextTokens != null ? `${Math.round((t.contextTokens / WINDOW_TOKENS) * 100)}%`.padStart(3) : '  ?';
          const bits = [
            `Turn ${String(t.turn).padEnd(3)}`,
            gauge(t.contextTokens),
            pct,
            `ctx ${fmtTokens(t.contextTokens ?? 0).padStart(6)}`,
            `out ${fmtTokens(t.outputTokens).padStart(6)}`,
          ];
          if (t.errors > 0) bits.push(`✗${t.errors}`);
          if (t.compactions.length > 0) bits.push(`▼${t.compactions.length}`);
          return (
            <Text key={t.index} wrap="truncate-end" inverse={isSelected}>
              {isSelected ? '> ' : '  '}
              {bits.join('  ')}
            </Text>
          );
        })}
        {turns.length === 0 ? <Text dimColor>no turns in this session</Text> : null}
      </Box>
      {current ? (
        <Box flexDirection="column" height={DETAIL_ROWS} overflow="hidden">
          <Text dimColor>{'─'.repeat(40)}</Text>
          <Text wrap="truncate-end" color="cyan">
            {current.promptSnippet}
          </Text>
          <Text wrap="truncate-end" dimColor>
            tools: {Object.entries(current.toolCounts).map(([n, c]) => `${n} ${c}`).join(', ') || 'none'}
          </Text>
          <Text wrap="truncate-end">
            reads: {current.filesRead.length > 0 ? current.filesRead.map((f) => relPath(f, cwd)).join(', ') : '—'}
          </Text>
          <Text wrap="truncate-end" color={current.filesChanged.length > 0 ? 'magenta' : undefined}>
            changes: {current.filesChanged.length > 0 ? current.filesChanged.map((f) => relPath(f, cwd)).join(', ') : '—'}
          </Text>
          <Text wrap="truncate-end" color="yellow">
            {current.compactions.length > 0
              ? `compactions: ${current.compactions.map((c) => `dropped ${c.droppedTokens != null ? fmtTokens(c.droppedTokens) : '?'}${c.trigger ? ` (${c.trigger})` : ''}`).join(', ')}`
              : ' '}
          </Text>
        </Box>
      ) : null}
      <Text dimColor wrap="truncate-end">
        j/k move · enter jump to turn · h/esc back · q quit
      </Text>
    </Box>
  );
}
