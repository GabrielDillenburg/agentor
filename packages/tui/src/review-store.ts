import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Reviewed-state persistence: which tool-call ids of a session the user has
 * marked as reviewed. Stored per session under ~/.agentor/review/.
 */

function stateFile(sessionId: string, baseDir?: string): string {
  const dir = baseDir ?? join(homedir(), '.agentor', 'review');
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(dir, `${safe}.json`);
}

export async function loadReviewState(sessionId: string, baseDir?: string): Promise<Set<string>> {
  try {
    const raw = await readFile(stateFile(sessionId, baseDir), 'utf8');
    const data = JSON.parse(raw) as { reviewed?: unknown };
    if (Array.isArray(data.reviewed)) {
      return new Set(data.reviewed.filter((x): x is string => typeof x === 'string'));
    }
  } catch {
    // Missing or corrupt state — start fresh.
  }
  return new Set();
}

export async function saveReviewState(
  sessionId: string,
  reviewed: Set<string>,
  baseDir?: string,
): Promise<void> {
  const file = stateFile(sessionId, baseDir);
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, JSON.stringify({ reviewed: [...reviewed] }, null, 2));
}
