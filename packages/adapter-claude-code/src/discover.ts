import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

/** Claude Code stores project transcripts under a slug of the absolute path. */
export function projectSlug(dir: string): string {
  return resolve(dir).replace(/[/.]/g, '-');
}

/** Overridable via AGENTOR_CLAUDE_HOME (useful for tests and non-standard setups). */
export function defaultClaudeHome(): string {
  return process.env['AGENTOR_CLAUDE_HOME'] ?? join(homedir(), '.claude');
}

export function projectSessionsDir(cwd: string, claudeHome = defaultClaudeHome()): string {
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

export interface SessionListEntry {
  path: string;
  id: string;
  mtimeMs: number;
  sizeBytes: number;
  /** First human prompt of the session, when cheaply extractable. */
  snippet?: string;
}

/** All session transcripts for a project directory, newest first. */
export async function listSessions(cwd: string, claudeHome?: string): Promise<SessionListEntry[]> {
  const dir = projectSessionsDir(cwd, claudeHome);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const entries: SessionListEntry[] = [];
  for (const name of names) {
    if (!name.endsWith('.jsonl') || name.startsWith('agent-')) continue;
    const path = join(dir, name);
    try {
      const info = await stat(path);
      const entry: SessionListEntry = {
        path,
        id: basename(name, '.jsonl'),
        mtimeMs: info.mtimeMs,
        sizeBytes: info.size,
      };
      const snippet = await readFirstPrompt(path);
      if (snippet) entry.snippet = snippet;
      entries.push(entry);
    } catch {
      // File vanished — skip.
    }
  }
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return entries;
}

/** Scan the head of a transcript for the first human prompt, reading at most 32KB. */
async function readFirstPrompt(path: string): Promise<string | undefined> {
  let text: string;
  try {
    const handle = await open(path, 'r');
    try {
      const { buffer, bytesRead } = await handle.read(Buffer.alloc(32_768), 0, 32_768, 0);
      text = buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
  const lines = text.split('\n');
  lines.pop(); // last line may be cut mid-JSON
  for (const line of lines) {
    if (!line.trim()) continue;
    let ev: { type?: string; message?: { content?: unknown } };
    try {
      ev = JSON.parse(line) as typeof ev;
    } catch {
      continue;
    }
    if (ev.type !== 'user') continue;
    const content = ev.message?.content;
    const raw =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .filter((b): b is { type: string; text: string } => (b as { type?: string })?.type === 'text')
              .map((b) => b.text)
              .join(' ')
          : '';
    const t = raw.trim();
    if (!t || t.startsWith('<') || t.startsWith('Caveat:') || t.startsWith('[Request interrupted')) continue;
    const first = t.split('\n', 1)[0] ?? '';
    return first.length > 80 ? `${first.slice(0, 79)}…` : first;
  }
  return undefined;
}
