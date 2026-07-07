import { watch, type FSWatcher } from 'node:fs';
import { basename, dirname } from 'node:path';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type { DisplayItem, Session, SessionTotals } from '@agentor/schema';
import { buildDisplayItems, buildTree, computeTotals } from '@agentor/schema';
import { parseSessionFile } from '@agentor/adapter-claude-code';
import { fmtDuration, fmtTokens } from './format.js';
import { ContextView } from './context-view.js';
import { ItemLine, itemDetailLines } from './item-line.js';
import { ProvenanceView } from './provenance-view.js';
import { ReviewView } from './review-view.js';

interface Loaded {
  session: Session;
  items: DisplayItem[];
  totals: SessionTotals;
}

type Mode =
  | { kind: 'tree' }
  | { kind: 'provenance'; index: number; from: 'tree' | 'review' }
  | { kind: 'review' }
  | { kind: 'context' };

const HEADER_ROWS = 2;
const KEYBAR_ROWS = 1;
const DETAIL_ROWS = 5; // divider + 4 content lines

const saneRows = (n: number | undefined): number => (n && n >= 6 ? n : 24);
const saneCols = (n: number | undefined): number => (n && n >= 20 ? n : 80);

export function SessionView({
  path,
  onBack,
  initialMode,
}: {
  path: string;
  onBack?: () => void;
  initialMode?: 'review';
}): JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [size, setSize] = useState({ rows: saneRows(stdout?.rows), cols: saneCols(stdout?.columns) });
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [follow, setFollow] = useState(!initialMode);
  const [showDetail, setShowDetail] = useState(true);
  const [replay, setReplay] = useState(false);
  const [mode, setMode] = useState<Mode>(initialMode === 'review' ? { kind: 'review' } : { kind: 'tree' });
  const followRef = useRef(follow);
  followRef.current = follow;

  const load = useCallback(async (): Promise<void> => {
    try {
      const session = await parseSessionFile(path);
      const tree = buildTree(session);
      const items = buildDisplayItems(session, tree);
      const totals = computeTotals(session, tree);
      setLoaded({ session, items, totals });
      setError(null);
      if (followRef.current) setSelected(Math.max(0, items.length - 1));
      else setSelected((s) => Math.min(s, Math.max(0, items.length - 1)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [path]);

  // Watch the containing directory: robust to the file being replaced/rotated.
  useEffect(() => {
    void load();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let watcher: FSWatcher | null = null;
    try {
      watcher = watch(dirname(path), (_event, filename) => {
        if (filename && filename !== basename(path)) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void load(), 350);
      });
    } catch {
      // Directory unwatchable — manual refresh (r) still works.
    }
    return () => {
      if (timer) clearTimeout(timer);
      watcher?.close();
    };
  }, [path, load]);

  useEffect(() => {
    if (!stdout) return;
    const onResize = (): void => setSize({ rows: saneRows(stdout.rows), cols: saneCols(stdout.columns) });
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  const items = loaded?.items ?? [];
  const visibleItems = replay ? items.slice(0, selected + 1) : items;
  const last = Math.max(0, items.length - 1);
  const selectedItem = items[selected];

  useInput(
    (input, key) => {
      if (input === 'q') return exit();
      if ((input === 'h' || key.escape) && replay) return setReplay(false);
      if ((input === 'h' || key.escape) && onBack) return onBack();
      if (input === 'j' || key.downArrow) {
        setFollow(false);
        setSelected((s) => Math.min(last, s + 1));
      } else if (input === 'k' || key.upArrow) {
        setFollow(false);
        setSelected((s) => Math.max(0, s - 1));
      } else if (key.pageDown || input === 'J') {
        setFollow(false);
        setSelected((s) => Math.min(last, s + 10));
      } else if (key.pageUp || input === 'K') {
        setFollow(false);
        setSelected((s) => Math.max(0, s - 10));
      } else if (input === 'g') {
        setFollow(false);
        setSelected(0);
      } else if (input === 'G') {
        setSelected(last);
      } else if (input === 'f') {
        setReplay(false);
        setFollow((f) => {
          if (!f) setSelected(last);
          return !f;
        });
      } else if (input === 'd') {
        setShowDetail((d) => !d);
      } else if (input === 'r') {
        void load();
      } else if (input === 't') {
        setFollow(false);
        setReplay((rp) => !rp);
      } else if (key.return || input === 'p') {
        if (selectedItem?.kind === 'tool-call') {
          setMode({ kind: 'provenance', index: selected, from: 'tree' });
        }
      } else if (input === 'v') {
        setMode({ kind: 'review' });
      } else if (input === 'c') {
        setMode({ kind: 'context' });
      }
    },
    { isActive: mode.kind === 'tree' },
  );

  const meta = loaded?.session.meta;

  if (mode.kind === 'provenance') {
    return (
      <ProvenanceView
        items={items}
        index={mode.index}
        {...(meta?.cwd ? { cwd: meta.cwd } : {})}
        onBack={() => setMode(mode.from === 'review' ? { kind: 'review' } : { kind: 'tree' })}
      />
    );
  }
  if (mode.kind === 'review') {
    return (
      <ReviewView
        items={items}
        sessionId={meta?.id ?? basename(path, '.jsonl')}
        {...(meta?.cwd ? { cwd: meta.cwd } : {})}
        onBack={() => setMode({ kind: 'tree' })}
        onOpenProvenance={(index) => setMode({ kind: 'provenance', index, from: 'review' })}
      />
    );
  }
  if (mode.kind === 'context') {
    return (
      <ContextView
        items={items}
        {...(meta?.cwd ? { cwd: meta.cwd } : {})}
        onBack={() => setMode({ kind: 'tree' })}
        onJumpTo={(index) => {
          setFollow(false);
          setSelected(index);
          setMode({ kind: 'tree' });
        }}
      />
    );
  }

  const totals = loaded?.totals;
  const title = meta?.title ?? meta?.id.slice(0, 8) ?? basename(path);
  const detailRows = showDetail ? DETAIL_ROWS : 0;
  const viewport = Math.max(3, size.rows - HEADER_ROWS - KEYBAR_ROWS - detailRows);
  const start = Math.max(0, Math.min(selected - Math.floor(viewport / 2), visibleItems.length - viewport));
  const visible = visibleItems.slice(start, start + viewport);
  const replayTs = replay && selectedItem && 'node' in selectedItem ? selectedItem.node.timestamp : undefined;

  return (
    <Box flexDirection="column" height={size.rows}>
      <Box justifyContent="space-between">
        <Text wrap="truncate-end">
          <Text bold>agentor</Text> <Text dimColor>·</Text> <Text bold>{title}</Text>
        </Text>
        <Text>
          {replay ? (
            <Text color="yellow">
              ⏪ replay {selected + 1}/{items.length}
              {replayTs ? ` · ${replayTs.slice(11, 19)}` : ''}
            </Text>
          ) : (
            <Text color={follow ? 'green' : 'yellow'}>{follow ? '● following' : '○ paused'}</Text>
          )}
        </Text>
      </Box>
      <Text wrap="truncate-end" dimColor>
        {totals
          ? `${totals.turns} turns · ${totals.toolCalls} tools · ${totals.errors} errors · ` +
            `${totals.filesChanged.length} files · out ${fmtTokens(totals.usage.outputTokens)}` +
            (totals.compactions > 0 ? ` · ▼${totals.compactions} (−${fmtTokens(totals.droppedTokens)})` : '') +
            (totals.activeDurationMs > 0 ? ` · active ${fmtDuration(totals.activeDurationMs)}` : '')
          : error
            ? `error: ${error}`
            : 'loading…'}
      </Text>

      <Box flexDirection="column" flexGrow={1}>
        {visible.map((item, i) => (
          <ItemLine key={start + i} item={item} selected={start + i === selected} cwd={meta?.cwd} />
        ))}
        {items.length === 0 && !error ? <Text dimColor>(empty session)</Text> : null}
      </Box>

      {showDetail && selectedItem ? (
        <Box flexDirection="column" height={DETAIL_ROWS} overflow="hidden">
          <Text dimColor>{'─'.repeat(Math.max(10, size.cols))}</Text>
          {itemDetailLines(selectedItem, meta?.cwd)
            .slice(0, DETAIL_ROWS - 1)
            .map((line, i) => (
              <Text key={i} wrap="truncate-end">
                {line}
              </Text>
            ))}
        </Box>
      ) : null}

      <Text dimColor wrap="truncate-end">
        {`↵ why · v review · c context · t replay · j/k move · g/G top/end · f follow · d detail · r refresh${onBack ? ' · h back' : ''} · q quit`}
      </Text>
    </Box>
  );
}
