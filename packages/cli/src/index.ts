#!/usr/bin/env node
import { Command } from 'commander';
import pc from 'picocolors';
import { computeTotals } from '@agentor/schema';
import { findLatestSession, parseSessionFile } from '@agentor/adapter-claude-code';
import { renderSession } from './render.js';

const program = new Command();

program
  .name('agentor')
  .description('See what your AI agent actually did, and why.')
  .version('0.1.0');

program
  .command('parse')
  .description('Render a Claude Code session transcript as a workflow tree')
  .argument('[file]', 'path to a session .jsonl (default: latest session for the current directory)')
  .option('--json', 'print the normalized session (plus totals) as JSON')
  .option('--full', 'do not truncate prompts and assistant text')
  .option('--no-color', 'disable colored output')
  .action(async (file: string | undefined, opts: { json?: boolean; full?: boolean; color: boolean }) => {
    let target = file;
    if (!target) {
      target = (await findLatestSession(process.cwd())) ?? undefined;
      if (!target) {
        fail(
          `no Claude Code sessions found for ${process.cwd()}\n` +
            'pass a path to a session .jsonl, or run inside a project you have used Claude Code in',
        );
        return;
      }
    }
    try {
      const session = await parseSessionFile(target);
      if (opts.json) {
        const totals = computeTotals(session);
        console.log(
          JSON.stringify(
            { meta: session.meta, totals, warnings: session.warnings, nodes: session.nodes },
            null,
            2,
          ),
        );
      } else {
        console.log(renderSession(session, { color: opts.color, full: opts.full ?? false }));
      }
    } catch (err) {
      fail(`could not parse ${target}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});

function fail(message: string): void {
  console.error(pc.red(`agentor: ${message}`));
  process.exitCode = 1;
}
