import { basename } from 'node:path';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useEffect, useState, type JSX } from 'react';
import { listSessions, type SessionListEntry } from '@agentor/adapter-claude-code';
import { fmtAge, fmtSize } from './format.js';

const LIVE_WINDOW_MS = 120_000;

export function Dashboard({
  cwd,
  onOpen,
  onWatch,
}: {
  cwd: string;
  onOpen: (path: string) => void;
  onWatch?: () => void;
}): JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const rows = stdout?.rows && stdout.rows >= 6 ? stdout.rows : 24;
  const [entries, setEntries] = useState<SessionListEntry[] | null>(null);
  const [selected, setSelected] = useState(0);

  const load = async (): Promise<void> => {
    const list = await listSessions(cwd);
    setEntries(list);
    setSelected((s) => Math.min(s, Math.max(0, list.length - 1)));
  };

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 5_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);

  const count = entries?.length ?? 0;

  useInput((input, key) => {
    if (input === 'q') return exit();
    if (input === 'r') return void load();
    if (input === 'w' && onWatch) return onWatch();
    if (input === 'j' || key.downArrow) setSelected((s) => Math.min(count - 1, s + 1));
    else if (input === 'k' || key.upArrow) setSelected((s) => Math.max(0, s - 1));
    else if (key.return || input === 'l') {
      const entry = entries?.[selected];
      if (entry) onOpen(entry.path);
    }
  });

  const viewport = Math.max(3, rows - 5);
  const start = Math.max(0, Math.min(selected - Math.floor(viewport / 2), count - viewport));
  const visible = entries?.slice(start, start + viewport) ?? [];
  const now = Date.now();
  const liveCount = entries?.filter((e) => now - e.mtimeMs < LIVE_WINDOW_MS).length ?? 0;

  return (
    <Box flexDirection="column" height={rows}>
      <Box justifyContent="space-between">
        <Text wrap="truncate-end">
          <Text color="cyan" bold>
            ◆ agentor
          </Text>{' '}
          <Text dimColor>·</Text> <Text bold>{basename(cwd)}</Text>{' '}
          <Text dimColor>
            {entries === null ? 'loading…' : `${count} session${count === 1 ? '' : 's'}`}
          </Text>
        </Text>
        {liveCount > 0 ? (
          <Text backgroundColor="green" color="black" bold>
            {` ● ${liveCount} ACTIVE `}
          </Text>
        ) : null}
      </Box>
      <Text dimColor wrap="truncate-end">
        {'    ID        AGE          SIZE   FIRST PROMPT'}
      </Text>
      <Text dimColor wrap="truncate-end">
        {'─'.repeat(200)}
      </Text>
      <Box flexDirection="column" flexGrow={1}>
        {visible.map((entry, i) => {
          const isSelected = start + i === selected;
          const isLive = now - entry.mtimeMs < LIVE_WINDOW_MS;
          return (
            <Text key={entry.path} wrap="truncate-end">
              {isSelected ? (
                <Text color="cyan" bold>
                  {'❯ '}
                </Text>
              ) : (
                <Text>{'  '}</Text>
              )}
              <Text color={isLive ? 'green' : undefined} dimColor={!isLive}>
                {isLive ? '● ' : '· '}
              </Text>
              <Text bold={isSelected} color={isSelected ? 'cyan' : undefined}>
                {entry.id.slice(0, 8)}
              </Text>
              <Text dimColor>{`  ${fmtAge(entry.mtimeMs).padEnd(11)} ${fmtSize(entry.sizeBytes).padStart(7)}  `}</Text>
              <Text bold={isSelected}>{entry.snippet ?? ''}</Text>
            </Text>
          );
        })}
        {entries !== null && count === 0 ? (
          <Text dimColor>
            no Claude Code sessions found for this directory — run agentor from a project you have used Claude
            Code in{onWatch ? ', or press w to wait for one' : ''}
          </Text>
        ) : null}
      </Box>
      <Text dimColor wrap="truncate-end">
        ↵ open · w watch live · j/k move · r refresh · q quit
      </Text>
    </Box>
  );
}
