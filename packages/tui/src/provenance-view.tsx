import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useMemo, useState, type JSX } from 'react';
import type { DisplayItem } from '@agentor/schema';
import { computeProvenance } from '@agentor/schema';
import { relPath } from './item-line.js';

interface PLine {
  text: string;
  color?: 'cyan' | 'red' | 'green' | 'yellow' | 'magenta';
  dim?: boolean;
  bold?: boolean;
}

const MAX_DIFF_LINES = 400;

export function ProvenanceView({
  items,
  index,
  cwd,
  onBack,
}: {
  items: DisplayItem[];
  index: number;
  cwd?: string;
  onBack: () => void;
}): JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const rows = stdout?.rows && stdout.rows >= 6 ? stdout.rows : 24;
  const [scroll, setScroll] = useState(0);

  const lines = useMemo(() => buildLines(items, index, cwd), [items, index, cwd]);
  const viewport = Math.max(3, rows - 2); // header + keybar
  const maxScroll = Math.max(0, lines.length - viewport);

  useInput((input, key) => {
    if (input === 'q') return exit();
    if (input === 'h' || key.escape) return onBack();
    if (input === 'j' || key.downArrow) setScroll((s) => Math.min(maxScroll, s + 1));
    else if (input === 'k' || key.upArrow) setScroll((s) => Math.max(0, s - 1));
    else if (key.pageDown || input === 'J') setScroll((s) => Math.min(maxScroll, s + 10));
    else if (key.pageUp || input === 'K') setScroll((s) => Math.max(0, s - 10));
    else if (input === 'g') setScroll(0);
    else if (input === 'G') setScroll(maxScroll);
  });

  const item = items[index];
  const title =
    item?.kind === 'tool-call'
      ? `${item.call.name} ${item.call.fileChange ? relPath(item.call.fileChange.path, cwd) : (item.call.detail ?? '')}`
      : 'provenance';

  return (
    <Box flexDirection="column" height={rows}>
      <Text wrap="truncate-end">
        <Text bold color="magenta">
          why
        </Text>{' '}
        <Text dimColor>·</Text> <Text bold>{title}</Text>
        {lines.length > viewport ? <Text dimColor>{`  (${scroll + 1}-${Math.min(lines.length, scroll + viewport)}/${lines.length})`}</Text> : null}
      </Text>
      <Box flexDirection="column" flexGrow={1}>
        {lines.slice(scroll, scroll + viewport).map((l, i) => (
          <Text
            key={scroll + i}
            wrap="truncate-end"
            {...(l.color ? { color: l.color } : {})}
            {...(l.dim ? { dimColor: true } : {})}
            {...(l.bold ? { bold: true } : {})}
          >
            {l.text || ' '}
          </Text>
        ))}
      </Box>
      <Text dimColor wrap="truncate-end">
        j/k scroll · J/K jump · g/G top/end · h/esc back · q quit
      </Text>
    </Box>
  );
}

function buildLines(items: DisplayItem[], index: number, cwd?: string): PLine[] {
  const prov = computeProvenance(items, index);
  if (!prov) return [{ text: 'no provenance available for this item', dim: true }];
  const out: PLine[] = [];
  const section = (title: string): void => {
    out.push({ text: '' });
    out.push({ text: title, bold: true, dim: true });
  };

  section(prov.turn != null ? `WHY · Turn ${prov.turn}` : 'WHY');
  if (prov.promptText) {
    for (const l of prov.promptText.trim().split('\n')) out.push({ text: `  ${l}`, color: 'cyan' });
  } else {
    out.push({ text: '  (no triggering prompt found — session fragment)', dim: true });
  }

  if (prov.reasoning.length > 0) {
    section('REASONING');
    for (const r of prov.reasoning) {
      for (const l of r.trim().split('\n')) out.push({ text: `  ${l}` });
    }
  }

  if (prov.filesRead.length > 0 || prov.searches.length > 0) {
    section('CONTEXT GATHERED THIS TURN');
    for (const f of prov.filesRead) out.push({ text: `  ⇢ ${relPath(f, cwd)}` });
    for (const s of prov.searches) out.push({ text: `  ⌕ ${s}`, dim: true });
  }

  if (prov.priorErrors.length > 0) {
    section('ERRORS BEFORE THIS CHANGE');
    for (const e of prov.priorErrors) {
      out.push({ text: `  ✗ ${e.name}${e.detail ? ` ${e.detail}` : ''}`, color: 'red' });
      if (e.summary) out.push({ text: `      ${e.summary}`, color: 'red', dim: true });
    }
  }

  if (prov.change) {
    section('CHANGE');
    let count = 0;
    const pushDiff = (text: string, sign: '-' | '+'): void => {
      if (count++ > MAX_DIFF_LINES) return;
      out.push({ text: `  ${sign} ${text}`, color: sign === '-' ? 'red' : 'green' });
    };
    if (prov.change.kind === 'edit') {
      for (const [i, edit] of prov.change.edits.entries()) {
        if (i > 0) out.push({ text: '  ⋯', dim: true });
        for (const l of edit.oldText.split('\n')) pushDiff(l, '-');
        for (const l of edit.newText.split('\n')) pushDiff(l, '+');
      }
    } else {
      for (const l of prov.change.content.split('\n')) pushDiff(l, '+');
    }
    if (count > MAX_DIFF_LINES) out.push({ text: `  … ${count - MAX_DIFF_LINES} more lines`, dim: true });
  } else if (prov.call.status === 'error' && prov.call.resultSummary) {
    section('RESULT');
    out.push({ text: `  ✗ ${prov.call.resultSummary}`, color: 'red' });
  }

  if (prov.fileHistory.length > 1) {
    section('HISTORY FOR THIS FILE');
    for (const h of prov.fileHistory) {
      out.push({
        text: `  ${h.isCurrent ? '→' : ' '} ${h.action}${h.turn != null ? ` · Turn ${h.turn}` : ''}`,
        ...(h.isCurrent ? { bold: true } : { dim: true }),
      });
    }
  }

  return out;
}
