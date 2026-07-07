import { render } from 'ink';
import { App } from './app.js';

export interface RunTuiOptions {
  /** Open this transcript directly; otherwise start on the session dashboard. */
  file?: string;
  cwd?: string;
  /** Start in a specific view (requires `file`). */
  view?: 'review';
}

const ESC = String.fromCharCode(27);
const ALT_SCREEN_ENTER = `${ESC}[?1049h${ESC}[H`;
const ALT_SCREEN_LEAVE = `${ESC}[?1049l`;

export async function runTui(options: RunTuiOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const useAltScreen = process.stdout.isTTY;
  if (useAltScreen) process.stdout.write(ALT_SCREEN_ENTER);
  try {
    const app = render(
      <App
        {...(options.file ? { file: options.file } : {})}
        {...(options.view ? { initialMode: options.view } : {})}
        cwd={cwd}
      />,
      {
      exitOnCtrlC: true,
    });
    await app.waitUntilExit();
  } finally {
    if (useAltScreen) process.stdout.write(ALT_SCREEN_LEAVE);
  }
}
