import type { SessionAdapter } from '@agentor/schema';
import { parseSessionFile } from './parse.js';

export { parseSessionFile, parseSessionLines } from './parse.js';
export { findLatestSession, projectSessionsDir, projectSlug } from './discover.js';

export const claudeCodeAdapter: SessionAdapter = {
  agent: 'claude-code',
  parseFile: parseSessionFile,
};
