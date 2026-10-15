import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { PortResult } from '@plot-pm/domain';
import type { Scripts } from '@plot-pm/domain/ports/scripts';
import type { Trees } from '@plot-pm/domain/ports/trees';
import { commitAndPush, type LadderContext } from '../../src/server/entry/ladder.js';

const answered = <T>(value: T): PortResult<T> => ({ ok: true, value });

/** A `Trees` stub that records every `resetBranch` base, so a test can
 * assert the retry re-cut from a fresh base rather than re-pushing the stale
 * commit. `fetchOk` and `resetOk` answer the fetch and the reset. */
const treesStub = (bases: string[], fetchOk = true, resetOk = true) => ({
  hasStagedChanges: async () => answered(true),
  commitAs: async () => answered(undefined),
  push: async () => answered(undefined),
  fetch: async () => (fetchOk ? answered(undefined) : { ok: false, why: 'failed' }),
  resetBranch: async (_tmpwt: string, _branch: string, start: string) => {
    bases.push(start);
    return resetOk ? answered(undefined) : { ok: false, why: 'failed' };
  },
} as unknown as Trees);

/** A `Scripts` stub whose `plot-push-main.sh` call rejects the first
 * `rejections` times, then lands — and tracks every call made through it, so
 * a test can assert no `prCreate`/`commitStatus`/`pr-merge` call ever ran. */
const scriptsStub = (rejections: number, calls: string[][]) => {
  let attempt = 0;
  return {
    awaited: async (name: string, args: string[]) => {
      calls.push([name, ...args]);
      attempt += 1;
      if (attempt <= rejections) return { stdout: '', stderr: 'remote: rejected\n', code: 1 };
      return { stdout: 'push: clean — plot/approve-a-plan → main\n', stderr: '', code: 0 };
    },
  } as unknown as Scripts;
};

const noWait = async (): Promise<void> => {};

describe('commitAndPush — retry on rejection', () => {
  it('re-applies the write on a branch cut from the re-fetched base when a push lands after rejections', async () => {
    const bases: string[] = [];
    const calls: string[][] = [];
    const reapplied: string[] = [];
    const ctx: LadderContext = {
      repoRoot: '/repo',
      scripts: scriptsStub(2, calls),
      trees: treesStub(bases),
    };

    const result = await commitAndPush(
      ctx,
      '/repo/.worktrees/tmp',
      'plot/approve-a-plan',
      'main',
      'jwloka',
      'plot: approve a-plan',
      'approval',
      'nothing to commit',
      async (wt) => {
        reapplied.push(wt);
      },
      () => {},
      5,
      noWait,
    );

    expect(result).toEqual({ pushed: 'clean' });
    // Two rejections means two retries, each re-cutting from the fetched
    // default branch — a loop that only re-pushed the same stale commit would
    // never call `resetBranch` and would still pass a naive "pushed 3
    // times" assertion.
    expect(bases).toEqual(['origin/main', 'origin/main']);
    expect(reapplied).toEqual(['/repo/.worktrees/tmp', '/repo/.worktrees/tmp']);
    expect(calls.filter((c) => c[0] === 'plot-push-main.sh')).toHaveLength(3);
  });

  it('reports rejected with the attempt count and makes no prCreate, commitStatus or pr-merge call once every attempt is exhausted', async () => {
    const bases: string[] = [];
    const calls: string[][] = [];
    const lines: string[] = [];
    const ctx: LadderContext = {
      repoRoot: '/repo',
      scripts: scriptsStub(5, calls),
      trees: treesStub(bases),
    };

    const result = await commitAndPush(
      ctx,
      '/repo/.worktrees/tmp',
      'plot/approve-a-plan',
      'main',
      'jwloka',
      'plot: approve a-plan',
      'approval',
      'nothing to commit',
      async () => {},
      (s) => lines.push(s),
      5,
      noWait,
    );

    expect(result).toEqual({ rejected: true });
    expect(lines.join('')).toContain('5 attempts');
    expect(calls.some((c) => c[0] === 'prCreate')).toBe(false);
    expect(calls.some((c) => c[0] === 'commitStatus')).toBe(false);
    expect(calls.some((c) => c[0] === 'pr-merge')).toBe(false);
    expect(calls.filter((c) => c[0] === 'plot-push-main.sh')).toHaveLength(5);
  });
});

describe('ladder.ts — no micro-PR vocabulary left', () => {
  it('names none of prCreate, commitStatus or pr-merge', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(here, '../../src/server/entry/ladder.ts'), 'utf8');
    expect(source).not.toMatch(/\bprCreate\b/);
    expect(source).not.toMatch(/\bcommitStatus\b/);
    expect(source).not.toMatch(/\bpr-merge\b/);
  });
});

describe('commitAndPush — a retry step that fails is named', () => {
  const attempt = async (trees: Trees, reapply: () => Promise<void> = async () => {}) => {
    const lines: string[] = [];
    const ctx: LadderContext = { repoRoot: '/repo', scripts: scriptsStub(5, []), trees, retryWait: noWait };
    const run = commitAndPush(ctx, '/wt', 'plot/deliver-p', 'main', 'jw', 'm', 'delivery', 'nothing', reapply, (s) => lines.push(s));
    return { run, lines };
  };

  it('stops with a step line where the fetch fails', async () => {
    const bases: string[] = [];
    const { run, lines } = await attempt(treesStub(bases, false));
    expect(await run).toEqual({ rejected: true });
    expect(lines.join('')).toContain('step: retry stopped — git fetch origin main failed in /repo\n');
    expect(bases).toEqual([]);
  });

  it('stops with a step line where the reset fails', async () => {
    const { run, lines } = await attempt(treesStub([], true, false));
    expect(await run).toEqual({ rejected: true });
    expect(lines.join('')).toContain("step: retry stopped — could not reset 'plot/deliver-p' to origin/main in /wt\n");
  });

  it('names the step and rethrows where reapply throws', async () => {
    const { run, lines } = await attempt(treesStub([]), async () => {
      throw new Error('boom');
    });
    await expect(run).rejects.toThrow('boom');
    expect(lines.join('')).toContain('step: retry stopped — re-applying the delivery to origin/main failed\n');
  });
});
