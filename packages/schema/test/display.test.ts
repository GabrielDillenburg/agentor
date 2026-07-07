import { describe, expect, it } from 'vitest';
import type { Session, SessionNode } from '../src/index.js';
import { buildDisplayItems, metaPromptLabel } from '../src/index.js';

function makeSession(nodes: SessionNode[]): Session {
  return { meta: { id: 's', agent: 'claude-code', models: [] }, nodes, warnings: [] };
}

describe('buildDisplayItems', () => {
  it('flattens chains, numbers turns, and merges attachment runs', () => {
    const session = makeSession([
      { kind: 'user-prompt', id: 'u1', parentId: null, text: 'do the thing' },
      {
        kind: 'assistant',
        id: 'a1',
        parentId: 'u1',
        blocks: [
          { type: 'text', text: 'ok' },
          { type: 'tool-call', call: { id: 't1', name: 'Bash', status: 'success' } },
        ],
      },
      { kind: 'attachment', id: 'x1', parentId: 'a1', label: 'file_mention' },
      { kind: 'attachment', id: 'x2', parentId: 'x1', label: 'file_mention' },
      { kind: 'user-prompt', id: 'u2', parentId: 'x2', text: '<system-reminder>hi</system-reminder>', meta: true },
      { kind: 'user-prompt', id: 'u3', parentId: 'u2', text: 'and another' },
    ]);
    const items = buildDisplayItems(session);
    expect(items.map((i) => i.kind)).toEqual([
      'prompt',
      'text',
      'tool-call',
      'attachments',
      'meta',
      'prompt',
    ]);
    const attachments = items[3];
    expect(attachments).toMatchObject({ kind: 'attachments', count: 2 });
    expect(items[0]).toMatchObject({ turn: 1, depth: 0 });
    expect(items[1]).toMatchObject({ depth: 1 });
    expect(items[5]).toMatchObject({ turn: 2, depth: 0 });
  });

  it('collapses substantive forked branches as abandoned', () => {
    const session = makeSession([
      { kind: 'user-prompt', id: 'u1', parentId: null, text: 'start' },
      { kind: 'assistant', id: 'a1', parentId: 'u1', blocks: [{ type: 'text', text: 'first try' }] },
      { kind: 'user-prompt', id: 'u2', parentId: 'u1', text: 'rewound and retried' },
    ]);
    const items = buildDisplayItems(session);
    expect(items.map((i) => i.kind)).toEqual(['prompt', 'abandoned', 'prompt']);
    // Abandoned branches render one level deeper than the activity depth.
    expect(items[1]).toMatchObject({ depth: 2, stats: { textBlocks: 1 } });
  });

  it('cleans tagged system labels via the meta heuristic', () => {
    const session = makeSession([
      {
        kind: 'system',
        id: 's1',
        parentId: null,
        subtype: 'local_command',
        label: '<command-name>/model</command-name>',
      },
    ]);
    const items = buildDisplayItems(session);
    expect(items[0]).toMatchObject({ kind: 'meta', label: 'command: /model' });
  });

  it('skips hidden system nodes and emits a subagent section', () => {
    const session = makeSession([
      { kind: 'user-prompt', id: 'u1', parentId: null, text: 'main' },
      { kind: 'system', id: 's1', parentId: 'u1', subtype: 'turn_duration', durationMs: 5, hidden: true },
      { kind: 'user-prompt', id: 'sc1', parentId: null, text: 'subagent task', sidechain: true },
    ]);
    const items = buildDisplayItems(session);
    expect(items.map((i) => i.kind)).toEqual(['prompt', 'subagent-header', 'prompt']);
  });
});

describe('metaPromptLabel', () => {
  it('labels common harness messages', () => {
    expect(metaPromptLabel('<command-name>/model</command-name><args/>')).toBe('command: /model');
    expect(metaPromptLabel('[Request interrupted by user]')).toBe('interrupted by user');
    expect(metaPromptLabel('Caveat: local commands…')).toBe('harness caveat');
    expect(metaPromptLabel('<task-notification>done</task-notification>')).toBe('task notification');
  });
});
