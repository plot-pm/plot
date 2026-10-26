// `composeContinuation` — what it writes for a marker-driven reply versus a
// fresh start that never had a question to answer.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import type { spawn as SpawnFn } from 'node:child_process';
import { describe, expect, it, afterEach } from 'vitest';
import { composeContinuation, continueOnDesk } from '../../src/shared/continuation.js';
import { ENDING_FILENAME } from '@plot-pm/domain/entities/ending';
import { MAIN_CHECKOUT_WRITER_ENV } from '@plot-pm/domain/rules/main-checkout-write';

const base = {
  branch: 'infra/x',
  briefPath: '.plot/briefs/infra-x.md',
  briefText: '# Brief',
  answer: 'use the shell adapter',
  landed: [] as string[],
};

describe('composeContinuation — a marker-driven reply', () => {
  it('names the previous question and tells the worker to clear the marker', () => {
    const prompt = composeContinuation({ ...base, question: 'which adapter?' });
    expect(prompt).toContain('stopped to ask a question');
    expect(prompt).toContain('## The question that stopped the previous run');
    expect(prompt).toContain('which adapter?');
    expect(prompt).toContain('blocked marker that stopped the previous run is still in this tree');
  });
});

describe('composeContinuation — a fresh start with no marker', () => {
  it('describes neither a question nor a marker to clear', () => {
    const prompt = composeContinuation({ ...base, question: '' });
    expect(prompt).not.toContain('stopped to ask a question');
    expect(prompt).not.toContain('blocked marker that stopped the previous run is still in this tree');
    expect(prompt).not.toContain('## The question that stopped the previous run');
  });

  it('still carries the answer and the brief', () => {
    const prompt = composeContinuation({ ...base, question: '' });
    expect(prompt).toContain('## The answer');
    expect(prompt).toContain('use the shell adapter');
    expect(prompt).toContain('# Brief');
  });
});

describe('continueOnDesk clears the main-checkout-writer marker for the spawn', () => {
  const desks: string[] = [];
  afterEach(() => {
    for (const desk of desks.splice(0)) rmSync(desk, { recursive: true, force: true });
  });

  it('spawns with no PLOT_MAIN_CHECKOUT_WRITER=1 even though the parent process carries it', async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'plot-continue-env-'));
    desks.push(worktree);
    const repoRoot = mkdtempSync(join(tmpdir(), 'plot-continue-repo-'));
    desks.push(repoRoot);
    writeFileSync(
      join(worktree, ENDING_FILENAME),
      JSON.stringify({ reason: 'holding-work', actor: 'agent', branch: 'feature/x', detail: '', refusedAssignment: '' }),
      'utf8',
    );

    const previousWriter = process.env[MAIN_CHECKOUT_WRITER_ENV];
    process.env[MAIN_CHECKOUT_WRITER_ENV] = '1';

    const spawnCalls: { env: Readonly<Record<string, string | undefined>> }[] = [];
    const fakeSpawn = ((_cmd: string, _args: readonly string[], opts: { env: Readonly<Record<string, string | undefined>> }) => {
      spawnCalls.push({ env: opts.env });
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', 0));
      return child;
    }) as typeof SpawnFn;

    try {
      await continueOnDesk({
        opts: { repoRoot, scriptsDir: '/s' },
        branch: 'feature/x',
        worktree,
        main: '',
        previousPid: '',
        answer: 'the answer',
        fresh: true,
        readCfg: (_opts, key, fallback) => (key === 'Worker command' ? 'true' : fallback),
        spawn: fakeSpawn,
      });
    } finally {
      if (previousWriter === undefined) delete process.env[MAIN_CHECKOUT_WRITER_ENV];
      else process.env[MAIN_CHECKOUT_WRITER_ENV] = previousWriter;
    }

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]?.env[MAIN_CHECKOUT_WRITER_ENV]).not.toBe('1');
  });
});
