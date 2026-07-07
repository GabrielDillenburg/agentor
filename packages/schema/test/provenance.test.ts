import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseSessionLines } from '../../adapter-claude-code/src/parse.js';
import { buildDisplayItems, computeProvenance, computeTurnContexts } from '../src/index.js';

const fixturePath = fileURLToPath(
  new URL('../../adapter-claude-code/test/fixtures/basic-session.jsonl', import.meta.url),
);
const session = parseSessionLines(readFileSync(fixturePath, 'utf8').split('\n'));
const items = buildDisplayItems(session);

const editIndex = items.findIndex((i) => i.kind === 'tool-call' && i.call.name === 'Edit');

describe('computeProvenance', () => {
  it('returns null for non-tool-call items', () => {
    expect(computeProvenance(items, 0)).toBeNull();
  });

  it('reconstructs why a file edit happened', () => {
    const prov = computeProvenance(items, editIndex);
    expect(prov).not.toBeNull();
    expect(prov!.turn).toBe(1);
    expect(prov!.promptText).toBe('Fix the divide function so it handles zero');
    expect(prov!.reasoning).toEqual(["I'll read the math module first."]);
    expect(prov!.filesRead).toEqual(['/home/dev/mathlib/src/math.ts']);
    expect(prov!.priorErrors).toHaveLength(1);
    expect(prov!.priorErrors[0]).toMatchObject({ name: 'Bash', summary: expect.stringContaining('2 tests failed') });
  });

  it('extracts the edit diff from tool input', () => {
    const prov = computeProvenance(items, editIndex);
    expect(prov!.change).toMatchObject({
      kind: 'edit',
      edits: [
        {
          oldText: 'return a / b',
          newText: expect.stringContaining('division by zero'),
        },
      ],
    });
  });

  it('tracks per-file history with the current change marked', () => {
    const prov = computeProvenance(items, editIndex);
    expect(prov!.fileHistory).toEqual([{ index: editIndex, action: 'edit', turn: 1, isCurrent: true }]);
  });

  it('extracts write content for Write calls', () => {
    const writeIndex = items.findIndex((i) => i.kind === 'tool-call' && i.call.name === 'Write');
    const prov = computeProvenance(items, writeIndex);
    expect(prov!.turn).toBe(2);
    expect(prov!.change).toMatchObject({ kind: 'write', content: 'test stub' });
    expect(prov!.priorErrors).toHaveLength(0);
  });
});

describe('computeTurnContexts', () => {
  const turns = computeTurnContexts(items);

  it('builds one context per turn', () => {
    expect(turns.map((t) => t.turn)).toEqual([1, 2, 3]);
  });

  it('aggregates turn 1: tokens, reads, changes, errors, compaction', () => {
    const t1 = turns[0]!;
    expect(t1.promptSnippet).toBe('Fix the divide function so it handles zero');
    expect(t1.outputTokens).toBe(260); // 120 + 80 + 60, one usage per message
    expect(t1.contextTokens).toBe(2443); // peak input+cache across the turn's requests
    expect(t1.filesRead).toEqual(['/home/dev/mathlib/src/math.ts']);
    expect(t1.filesChanged).toEqual(['/home/dev/mathlib/src/math.ts']);
    expect(t1.toolCounts).toEqual({ Read: 1, Bash: 1, Edit: 1 });
    expect(t1.errors).toBe(1);
    expect(t1.compactions).toEqual([{ droppedTokens: 42000, trigger: 'auto' }]);
  });

  it('does not count abandoned-branch output in turn totals', () => {
    const t2 = turns[1]!;
    expect(t2.outputTokens).toBe(90); // m4 only; abandoned m5 (40) is collapsed
    expect(t2.filesChanged).toEqual(['/home/dev/mathlib/src/math.test.ts']);
  });

  it('aggregates turn 3', () => {
    const t3 = turns[2]!;
    expect(t3.outputTokens).toBe(50);
    expect(t3.toolCounts).toEqual({ Bash: 1 });
    expect(t3.errors).toBe(0);
  });
});
