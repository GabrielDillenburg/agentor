import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildTree, computeTotals } from '@agentor/schema';
import type { AssistantNode } from '@agentor/schema';
import { parseSessionLines } from '../src/parse.js';

const fixturePath = fileURLToPath(new URL('./fixtures/basic-session.jsonl', import.meta.url));
const lines = readFileSync(fixturePath, 'utf8').split('\n');

const parse = () => parseSessionLines(lines, 'fixture-fallback');

describe('parseSessionLines', () => {
  it('extracts session metadata', () => {
    const session = parse();
    expect(session.meta.id).toBe('fixture-session');
    expect(session.meta.agent).toBe('claude-code');
    expect(session.meta.title).toBe('divide-by-zero fix');
    expect(session.meta.cwd).toBe('/home/dev/mathlib');
    expect(session.meta.gitBranch).toBe('main');
    expect(session.meta.agentVersion).toBe('2.1.186');
    expect(session.meta.models).toEqual(['claude-test-1']);
    expect(session.meta.startedAt).toBe('2026-07-01T10:00:00.000Z');
    expect(session.meta.endedAt).toBe('2026-07-01T10:01:36.000Z');
  });

  it('produces the expected node sequence', () => {
    const session = parse();
    expect(session.nodes.map((n) => n.kind)).toEqual([
      'user-prompt', // u1
      'assistant', // m1 (a1+a2+a3 merged)
      'assistant', // m2
      'assistant', // m3 (a5+a6 merged)
      'user-prompt', // interruption (meta)
      'system', // turn_duration (hidden)
      'compaction', // cb1
      'user-prompt', // u2
      'attachment', // att1
      'assistant', // m4
      'assistant', // m5 (abandoned branch)
      'unknown', // future-widget
      'user-prompt', // u3
      'assistant', // m6 (d1+d2 merged)
    ]);
  });

  it('merges multi-event messages into one node, including across tool results', () => {
    const session = parse();
    const assistants = session.nodes.filter((n): n is AssistantNode => n.kind === 'assistant');
    const m1 = assistants.find((n) => n.messageId === 'm1');
    expect(m1?.blocks.map((b) => b.type)).toEqual(['thinking', 'text', 'tool-call']);
    // m3's Edit tool_use and its follow-up text arrived as separate events with
    // a consumed tool_result event in between — still one node.
    const m3 = assistants.find((n) => n.messageId === 'm3');
    expect(m3?.blocks.map((b) => b.type)).toEqual(['tool-call', 'text']);
    const m6 = assistants.find((n) => n.messageId === 'm6');
    expect(m6?.blocks.map((b) => b.type)).toEqual(['tool-call', 'text']);
  });

  it('pairs tool results with calls, capturing errors and durations', () => {
    const session = parse();
    const calls = session.nodes
      .filter((n): n is AssistantNode => n.kind === 'assistant')
      .flatMap((n) => n.blocks)
      .flatMap((b) => (b.type === 'tool-call' ? [b.call] : []));
    expect(calls).toHaveLength(6);

    const bashTest = calls.find((c) => c.id === 't2');
    expect(bashTest?.status).toBe('error');
    expect(bashTest?.resultSummary).toContain('2 tests failed');
    expect(bashTest?.durationMs).toBe(6000);

    const edit = calls.find((c) => c.id === 't3');
    expect(edit?.status).toBe('success');
    expect(edit?.fileChange).toEqual({ path: '/home/dev/mathlib/src/math.ts', action: 'edit' });

    const write = calls.find((c) => c.id === 't4');
    expect(write?.fileChange).toEqual({ path: '/home/dev/mathlib/src/math.test.ts', action: 'write' });
  });

  it('marks harness-generated prompts as meta', () => {
    const session = parse();
    const prompts = session.nodes.filter((n) => n.kind === 'user-prompt');
    expect(prompts.map((p) => p.meta ?? false)).toEqual([false, true, false, false]);
  });

  it('captures compaction with dropped-token accounting', () => {
    const session = parse();
    const compaction = session.nodes.find((n) => n.kind === 'compaction');
    expect(compaction).toMatchObject({
      trigger: 'auto',
      preTokens: 50000,
      postTokens: 8000,
      droppedTokens: 42000,
    });
    // The compaction chains to the pre-compaction history via logicalParentUuid.
    expect(compaction?.parentId).toBe('s1');
  });

  it('fails soft on unknown event types', () => {
    const session = parse();
    const unknown = session.nodes.find((n) => n.kind === 'unknown');
    expect(unknown).toMatchObject({ rawType: 'future-widget' });
    expect(session.warnings.some((w) => w.includes('future-widget'))).toBe(true);
  });
});

describe('topology and totals', () => {
  it('computes the active path and detects the abandoned branch', () => {
    const session = parse();
    const tree = buildTree(session);
    const abandoned = session.nodes.find(
      (n): n is AssistantNode => n.kind === 'assistant' && n.messageId === 'm5',
    );
    expect(abandoned).toBeDefined();
    expect(tree.activePathIds.has(abandoned!.id)).toBe(false);
    const final = session.nodes.find(
      (n): n is AssistantNode => n.kind === 'assistant' && n.messageId === 'm6',
    );
    expect(tree.activeLeafId).toBe(final!.id);
    expect(tree.activePathIds.has('u1')).toBe(true);
  });

  it('computes totals with usage counted once per message', () => {
    const session = parse();
    const totals = computeTotals(session);
    expect(totals.turns).toBe(3);
    expect(totals.toolCalls).toBe(6);
    expect(totals.toolCallsByName).toEqual({ Bash: 3, Read: 1, Edit: 1, Write: 1 });
    expect(totals.errors).toBe(1);
    expect(totals.filesChanged.sort()).toEqual([
      '/home/dev/mathlib/src/math.test.ts',
      '/home/dev/mathlib/src/math.ts',
    ]);
    expect(totals.compactions).toBe(1);
    expect(totals.droppedTokens).toBe(42000);
    expect(totals.abandonedBranches).toBe(1);
    expect(totals.activeDurationMs).toBe(45000);
    expect(totals.wallClockMs).toBe(96000);
    expect(totals.usage).toEqual({
      inputTokens: 18,
      outputTokens: 440,
      cacheReadTokens: 14700,
      cacheCreationTokens: 240,
    });
  });
});
