import { useState, type JSX } from 'react';
import { Dashboard } from './dashboard.js';
import { SessionView } from './session-view.js';

type View = { t: 'dashboard' } | { t: 'session'; path: string };

export function App({
  file,
  cwd,
  initialMode,
}: {
  file?: string;
  cwd: string;
  initialMode?: 'review';
}): JSX.Element {
  const [view, setView] = useState<View>(file ? { t: 'session', path: file } : { t: 'dashboard' });
  // Only offer "back" when the dashboard is where the user started.
  const startedOnDashboard = !file;

  if (view.t === 'session') {
    return (
      <SessionView
        path={view.path}
        {...(initialMode && view.path === file ? { initialMode } : {})}
        {...(startedOnDashboard ? { onBack: () => setView({ t: 'dashboard' }) } : {})}
      />
    );
  }
  return <Dashboard cwd={cwd} onOpen={(path) => setView({ t: 'session', path })} />;
}
