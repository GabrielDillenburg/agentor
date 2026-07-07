import { basename } from 'node:path';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useEffect, useState, type JSX } from 'react';
import { listSessions, type SessionListEntry } from '@agentor/adapter-claude-code';
import { fmtAge, fmtSize } from './format.js';

export function Dashboard({ cwd, onOpen }: { cwd: string; onOpen: (path: string) => void }): JSX.Element {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);

  const count = entries?.length ?? 0;

  useInput((input, key) => {
    if (input === 'q') return exit();
    if (input === 'r') return void load();
    if (input === 'j' || key.downArrow) setSelected((s) => Math.min(count - 1, s + 1));
    else if (input === 'k' || key.upArrow) setSelected((s) => Math.max(0, s - 1));
    else if (key.return || input === 'l') {
      const entry = entries?.[selected];
      if (entry) onOpen(entry.path);
    }
  });

  const viewport = Math.max(3, rows - 4);
  const start = Math.max(0, Math.min(selected - Math.floor(viewport / 2), count - viewport));
  const visible = entries?.slice(start, start + viewport) ?? [];

  return (
    <Box flexDirection="column" height={rows}>
      <Text>
        <Text bold>agentor</Text> <Text dimColor>· sessions ·</Text> <Text bold>{basename(cwd)}</Text>
      </Text>
      <Text dimColor>{entries === null ? 'loading…' : `${count} session${count === 1 ? '' : 's'}`}</Text>
      <Box flexDirection="column" flexGrow={1}>
        {visible.map((entry, i) => {
          const isSelected = start + i === selected;
          const line = `${entry.id.slice(0, 8)}  ${fmtAge(entry.mtimeMs).padEnd(11)} ${fmtSize(entry.sizeBytes).padStart(7)}  ${entry.snippet ?? ''}`;
          return (
            <Text key={entry.path} wrap="truncate-end" inverse={isSelected} color={isSelected ? undefined : 'cyan'}>
              {isSelected ? '> ' : '  '}
              {line}
            </Text>
          );
        })}
        {entries !== null && count === 0 ? (
          <Text dimColor>
            no Claude Code sessions found for this directory — run agentor from a project you have used Claude
            Code in
          </Text>
        ) : null}
      </Box>
      <Text dimColor wrap="truncate-end">
        j/k move · enter open · r refresh · q quit
      </Text>
    </Box>
  );
}
