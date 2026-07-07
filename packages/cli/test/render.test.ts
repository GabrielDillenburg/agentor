import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseSessionLines } from '../../adapter-claude-code/src/parse.js';
import { renderSession } from '../src/render.js';

const fixturePath = fileURLToPath(
  new URL('../../adapter-claude-code/test/fixtures/basic-session.jsonl', import.meta.url),
);
const session = parseSessionLines(readFileSync(fixturePath, 'utf8').split('\n'));
const output = renderSession(session, { color: false });

describe('renderSession', () => {
  it('renders the session header', () => {
    expect(output).toContain('claude-code session fixture-');
    expect(output).toContain('“divide-by-zero fix”');
    expect(output).toContain('v2.1.186');
    expect(output).toContain('mathlib (main)');
  });

  it('renders turns for real prompts and dim labels for harness events', () => {
    expect(output).toContain('● Turn 1 Fix the divide function so it handles zero');
    expect(output).toContain('● Turn 2 Now add tests for the zero case');
    expect(output).toContain('● Turn 3 Wait, don\'t refactor — just run the new tests');
    expect(output).toContain('· interrupted by user');
    expect(output).not.toContain('Turn 4');
  });

  it('renders tool calls with status, paths relative to cwd, and error summaries', () => {
    expect(output).toContain('✓ Read src/math.ts');
    expect(output).toContain('✗ Bash Run unit tests — Error: 2 tests failed');
    expect(output).toContain('(6s)');
    expect(output).toContain('✓ Edit src/math.ts');
    expect(output).toContain('✓ Write src/math.test.ts');
  });

  it('surfaces compaction, abandoned branches, and unknown events', () => {
    expect(output).toContain('▼ context compacted — dropped 42k tokens (50k → 8.0k) · auto');
    expect(output).toContain('╳ abandoned path · 0 prompts · 1 tool call · 1 event');
    expect(output).toContain('? unrecognized event · future-widget');
    expect(output).toContain('· attachment: file_mention');
  });

  it('renders the summary block', () => {
    expect(output).toContain('3 turns · 6 tool calls');
    expect(output).toContain('files changed 2');
    expect(output).toContain('errors 1');
    expect(output).toContain('compactions 1 (dropped 42k tokens)');
    expect(output).toContain('abandoned paths 1');
    expect(output).toContain('out 440');
    expect(output).toContain('active 45s');
  });

  it('matches the full-output snapshot', () => {
    expect(`\n${output}\n`).toMatchSnapshot();
  });
});
