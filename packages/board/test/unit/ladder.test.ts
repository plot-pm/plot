import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { PortResult } from '@plot-pm/domain';
import type { Scripts } from '@plot-pm/domain/ports/scripts';
import type { Trees } from '@plot-pm/domain/ports/trees';
import { commitAndPush, type LadderContext, type PushLock } from '../../src/server/entry/ladder.js';

const answered = <T>(value: T): PortResult<T> => ({ ok: true, value });

/** A lock that is always free at once — the right fake for every test that
 * is not itself testing lock contention or the exit-6 branch. */
const freeLock: PushLock = {
  take: async () => 'held',
  release: async () => {},
};

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
      lock: freeLock,
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
      lock: freeLock,
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

describe('commitAndPush — a Writer App refusal stops the ladder', () => {
  it('does not retry on exit 3 and spends only one push attempt', async () => {
    const bases: string[] = [];
    const calls: string[][] = [];
    const lines: string[] = [];
    const ctx: LadderContext = {
      repoRoot: '/repo',
      scripts: {
        awaited: async (name: string, args: string[]) => {
          calls.push([name, ...args]);
          return { stdout: '', stderr: 'push: refused — plot/approve-a-plan was refused:\n', code: 3 };
        },
      } as unknown as Scripts,
      trees: treesStub(bases),
      lock: freeLock,
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
    expect(lines.join('')).toContain('refused (exit 3) — not retrying');
    expect(calls.filter((c) => c[0] === 'plot-push-main.sh')).toHaveLength(1);
    expect(bases).toEqual([]);
  });

  it('does not retry on exit 4', async () => {
    const calls: string[][] = [];
    const ctx: LadderContext = {
      repoRoot: '/repo',
      scripts: {
        awaited: async (name: string, args: string[]) => {
          calls.push([name, ...args]);
          return { stdout: '', stderr: '', code: 4 };
        },
      } as unknown as Scripts,
      trees: treesStub([]),
      lock: freeLock,
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
      () => {},
      5,
      noWait,
    );

    expect(result).toEqual({ rejected: true });
    expect(calls.filter((c) => c[0] === 'plot-push-main.sh')).toHaveLength(1);
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
    const ctx: LadderContext = { repoRoot: '/repo', scripts: scriptsStub(5, []), trees, retryWait: noWait, lock: freeLock };
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

/**
 * A FIFO fake {@link PushLock}: concurrent `take()` callers queue in arrival
 * order and each is granted the lock only once every earlier caller has
 * `release()`d. No real timers — a waiting `take()` resolves via a promise
 * released by its predecessor's `release()`, never a `setTimeout`.
 *
 * `held` exposes which holder currently has the lock (or `null`), so a test
 * can assert a `trees` call happened only while its own holder held it.
 */
const fifoLock = () => {
  let held: string | null = null;
  let tail: Promise<void> = Promise.resolve();
  const releasers = new Map<string, () => void>();
  const lock: PushLock = {
    take: async (holder) => {
      const myTurn = tail;
      tail = new Promise((resolve) => {
        releasers.set(holder, resolve);
      });
      await myTurn;
      held = holder;
      return 'held';
    },
    release: async (holder) => {
      held = null;
      releasers.get(holder)?.();
      releasers.delete(holder);
    },
  };
  return { lock, heldBy: () => held };
};

describe('commitAndPush — the lock spans the booking, not just the push', () => {
  it('lands all 6 of 6 concurrent writers over one shared fake remote', async () => {
    const { lock } = fifoLock();
    const remote = { tip: 'origin-0' };
    const retryWait = async (): Promise<void> => {};

    const run = async (id: number) => {
      let base = 'origin-0';
      const trees = {
        hasStagedChanges: async () => answered(true),
        commitAs: async () => answered(undefined),
        push: async () => answered(undefined),
        fetch: async () => answered(undefined),
        resetBranch: async () => {
          base = remote.tip;
          return answered(undefined);
        },
      } as unknown as Trees;

      const scripts = {
        awaited: async (_name: string, _args: string[]) => {
          if (base !== remote.tip) return { stdout: '', stderr: 'remote: rejected\n', code: 1 };
          remote.tip = `writer-${id}`;
          return { stdout: `push: clean — plot/release-${id} → main\n`, stderr: '', code: 0 };
        },
      } as unknown as Scripts;

      const ctx: LadderContext = { repoRoot: '/repo', scripts, trees, retryWait, lock };
      return commitAndPush(ctx, `/wt-${id}`, `plot/release-${id}`, 'main', 'jwloka', `plot: release ${id}`, 'release', 'nothing', async () => {}, () => {}, 10);
    };

    const results = await Promise.all(Array.from({ length: 6 }, (_v, i) => run(i)));
    expect(results.filter((r) => 'pushed' in r)).toHaveLength(6);
  });

  it('runs fetch and resetBranch only while the lock is held', async () => {
    const { lock, heldBy } = fifoLock();
    const remote = { tip: 'origin-0' };
    const retryWait = async (): Promise<void> => {};
    const violations: string[] = [];

    const run = async (id: number) => {
      let base = 'origin-0';
      const holderName = `writer-${id}`;
      const trees = {
        hasStagedChanges: async () => answered(true),
        commitAs: async () => answered(undefined),
        push: async () => answered(undefined),
        fetch: async () => {
          if (heldBy() === null) violations.push(`fetch ${id} ran unlocked`);
          return answered(undefined);
        },
        resetBranch: async () => {
          if (heldBy() === null) violations.push(`resetBranch ${id} ran unlocked`);
          base = remote.tip;
          return answered(undefined);
        },
      } as unknown as Trees;

      const scripts = {
        awaited: async () => {
          if (base !== remote.tip) return { stdout: '', stderr: 'remote: rejected\n', code: 1 };
          remote.tip = holderName;
          return { stdout: 'push: clean — plot/release → main\n', stderr: '', code: 0 };
        },
      } as unknown as Scripts;

      const ctx: LadderContext = { repoRoot: '/repo', scripts, trees, retryWait, lock };
      return commitAndPush(ctx, `/wt-${id}`, `plot/release-${id}`, 'main', 'jwloka', `plot: release ${id}`, 'release', 'nothing', async () => {}, () => {}, 10);
    };

    const results = await Promise.all(Array.from({ length: 6 }, (_v, i) => run(i)));
    expect(results.filter((r) => 'pushed' in r)).toHaveLength(6);
    expect(violations).toEqual([]);
  });
});

describe('commitAndPush — exit 6 (locked) consumes no attempt', () => {
  it('loops back to retake the lock without spending an attempt or calling resetBranch', async () => {
    const lines: string[] = [];
    const resetCalls: string[] = [];
    let takeCalls = 0;
    const lock: PushLock = {
      take: async (_holder, _action, write) => {
        takeCalls += 1;
        if (takeCalls === 1) {
          write('step: waiting for the default-branch lock held by pid 999 (push other-branch)\n');
          return 'locked';
        }
        return 'held';
      },
      release: async () => {},
    };

    const trees = {
      hasStagedChanges: async () => answered(true),
      commitAs: async () => answered(undefined),
      push: async () => answered(undefined),
      fetch: async () => answered(undefined),
      resetBranch: async (_tmpwt: string, _branch: string, start: string) => {
        resetCalls.push(start);
        return answered(undefined);
      },
    } as unknown as Trees;

    const scripts = scriptsStub(0, []);
    const ctx: LadderContext = { repoRoot: '/repo', scripts, trees, retryWait: noWait, lock };

    const result = await commitAndPush(ctx, '/wt', 'plot/release-x', 'main', 'jwloka', 'plot: release x', 'release', 'nothing', async () => {}, (s) => lines.push(s), 5);

    expect(result).toEqual({ pushed: 'clean' });
    expect(resetCalls).toEqual([]);
    expect(lines.join('')).toContain('step: waiting for the default-branch lock held by pid 999 (push other-branch)\n');
    expect(lines.join('')).not.toContain('attempt 1 of 5');
  });
});
