import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Claude Code stores project transcripts under a slug of the absolute path. */
export function projectSlug(dir: string): string {
  return resolve(dir).replace(/[/.]/g, '-');
}

export function projectSessionsDir(cwd: string, claudeHome = join(homedir(), '.claude')): string {
  return join(claudeHome, 'projects', projectSlug(cwd));
}

/**
 * Most recently modified session transcript for a project directory, or null.
 * Subagent transcripts (agent-*.jsonl) are excluded.
 */
export async function findLatestSession(
  cwd: string,
  claudeHome?: string,
): Promise<string | null> {
  const dir = projectSessionsDir(cwd, claudeHome);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  let best: { path: string; mtime: number } | null = null;
  for (const entry of entries) {
    if (!entry.endsWith('.jsonl') || entry.startsWith('agent-')) continue;
    const path = join(dir, entry);
    try {
      const info = await stat(path);
      if (!best || info.mtimeMs > best.mtime) best = { path, mtime: info.mtimeMs };
    } catch {
      // File vanished between readdir and stat — ignore.
    }
  }
  return best?.path ?? null;
}
