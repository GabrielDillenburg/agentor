import { watch, type FSWatcher } from 'node:fs';
import { Box, Text, useApp, useInput } from 'ink';
import { useEffect, useState, type JSX } from 'react';
import { findLatestSession, projectSessionsDir } from '@agentor/adapter-claude-code';
import { Dashboard } from './dashboard.js';
import { SessionView } from './session-view.js';

type View = { t: 'dashboard' } | { t: 'session'; path: string } | { t: 'watch' };

export function App({
  file,
  cwd,
  initialMode,
  watchMode,
}: {
  file?: string;
  cwd: string;
  initialMode?: 'review';
  watchMode?: boolean;
}): JSX.Element {
  const [view, setView] = useState<View>(
    watchMode ? { t: 'watch' } : file ? { t: 'session', path: file } : { t: 'dashboard' },
  );
  // Only offer "back" when the dashboard is where the user started.
  const startedOnDashboard = !file && !watchMode;

  if (view.t === 'watch') {
    return <WatchView cwd={cwd} {...(startedOnDashboard ? { onBack: () => setView({ t: 'dashboard' }) } : {})} />;
  }
  if (view.t === 'session') {
    return (
      <SessionView
        path={view.path}
        {...(initialMode && view.path === file ? { initialMode } : {})}
        {...(startedOnDashboard ? { onBack: () => setView({ t: 'dashboard' }) } : {})}
      />
    );
  }
  return (
    <Dashboard
      cwd={cwd}
      onOpen={(path) => setView({ t: 'session', path })}
      onWatch={() => setView({ t: 'watch' })}
    />
  );
}

/**
 * Watch mode: auto-attach to the most recent session for the project and hop
 * to a newer one as soon as it appears — leave it running next to your agent.
 */
function WatchView({ cwd, onBack }: { cwd: string; onBack?: () => void }): JSX.Element {
  const { exit } = useApp();
  const [path, setPath] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let watcher: FSWatcher | null = null;

    const refresh = (): void => {
      void findLatestSession(cwd).then((latest) => {
        if (active && latest) setPath((p) => (p === latest ? p : latest));
      });
    };
    refresh();
    try {
      watcher = watch(projectSessionsDir(cwd), () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(refresh, 400);
      });
    } catch {
      // Directory may not exist until the first session starts.
    }
    // Poll as a fallback (covers the directory being created after start).
    const interval = setInterval(refresh, 2_000);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      clearInterval(interval);
      watcher?.close();
    };
  }, [cwd]);

  useInput(
    (input, key) => {
      if (input === 'q') return exit();
      if ((input === 'h' || key.escape) && onBack) return onBack();
    },
    { isActive: path === null },
  );

  if (!path) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text>
          <Text color="cyan" bold>
            ◆ agentor
          </Text>{' '}
          <Text backgroundColor="green" color="black" bold>
            {' ● WATCHING '}
          </Text>
        </Text>
        <Text> </Text>
        <Text dimColor>waiting for a session to start in this project…</Text>
        <Text dimColor>start your coding agent in another terminal — I'll attach automatically.</Text>
        <Text> </Text>
        <Text dimColor>{onBack ? 'h back · q quit' : 'q quit'}</Text>
      </Box>
    );
  }
  return <SessionView key={path} path={path} auto {...(onBack ? { onBack } : {})} />;
}
