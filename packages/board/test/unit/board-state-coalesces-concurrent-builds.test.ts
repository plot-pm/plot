// Two `/api/board` requests that land while a build is still running must
// share that ONE `buildBoard` rather than each spawning its own — this is the
// mechanism fix for issue #2083 (board poll timing out under load). See
// `boardState`'s own comment in `fleet-state.ts` for the measurement that
// motivated it.
//
// Issue #2097 extended this: the shared slot was keyed by nothing, so two
// different estates (different `repoRoot`, different injected ports) joined
// the same in-flight build anyway; a joiner arriving after refs moved still
// got the stale answer; and the all-reject-on-failure claim was asserted on
// faith rather than proven. The four tests below cover the opts-keying, the
// post-change restart, and the failure fan-out, alongside the two original
// coalescing cases.
import { describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import type { Board } from '../../src/contract/schema.js';
import type { PortResult, RefState, Refs } from '@plot-pm/domain';

const calls = vi.hoisted(() => ({ count: 0, failing: false }));

const FIXTURE_BOARD: Board = {
  generatedAt: '2026-10-19T00:00:00.000Z',
  columns: [],
  dispatch: { available: false, reason: '' },
  server: { restartCommand: '', port: 0, branch: '', hostUser: '', gitEmail: '', people: {}, repo: '', ci: '' },
} as unknown as Board;

vi.mock('../../src/server/board.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/server/board.js')>();
  return {
    ...real,
    buildBoard: async (): Promise<Board> => {
      calls.count += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (calls.failing) throw new Error('build failed');
      return { ...FIXTURE_BOARD, generatedAt: new Date(calls.count).toISOString() };
    },
  };
});

import { boardState, realEstateSource, type EstateSource } from '../../src/server/controllers/fleet-state.js';
import type { BuildBoardOptions } from '../../src/server/board.js';

const opts = { repoRoot: process.cwd(), scriptsDir: 'skills/plot/scripts' } as BuildBoardOptions;

/**
 * A `Refs` stub answering only `refState`, which is all `boardState` calls —
 * from a queue of readings consumed one per call, so a test can hand the
 * first caller one SHA and every caller after it a moved one.
 */
const refsStub = (readings: (readonly RefState[])[]): Refs => {
  const queue = [...readings];
  return {
    refState: async (): Promise<PortResult<readonly RefState[]>> => {
      const value = queue.length > 1 ? queue.shift()! : queue[0];
      return { ok: true, value };
    },
  } as unknown as Refs;
};

const REF_A: readonly RefState[] = [{ ref: 'refs/heads/main', sha: 'a'.repeat(40) }];
const REF_B: readonly RefState[] = [{ ref: 'refs/heads/main', sha: 'b'.repeat(40) }];

describe('boardState concurrency', () => {
  it('shares one buildBoard across concurrent real-estate callers', async () => {
    calls.count = 0;
    const [a, b] = await Promise.all([boardState({ opts }), boardState({ opts })]);
    assert.equal(calls.count, 1);
    assert.equal(a.generatedAt, b.generatedAt);
  });

  it('runs a fresh build once the in-flight one has settled', async () => {
    calls.count = 0;
    await boardState({ opts });
    await boardState({ opts });
    assert.equal(calls.count, 2);
  });

  it('never shares a build across a mock estate source', async () => {
    calls.count = 0;
    const mock: EstateSource = { columns: (_opts, built) => built.columns, fleet: realEstateSource.fleet };
    await Promise.all([boardState({ opts, estate: mock }), boardState({ opts, estate: mock })]);
    assert.equal(calls.count, 2);
  });

  it('never shares a build across callers with different opts', async () => {
    calls.count = 0;
    const optsA = { repoRoot: '/repo-a', refs: refsStub([REF_A]) } as BuildBoardOptions;
    const optsB = { repoRoot: '/repo-b', refs: refsStub([REF_A]) } as BuildBoardOptions;
    await Promise.all([boardState({ opts: optsA }), boardState({ opts: optsB })]);
    assert.equal(calls.count, 2);
  });

  it('starts a fresh build for a joiner that arrives after refs moved', async () => {
    calls.count = 0;
    // First read: REF_A. Every read after: REF_B — simulating a ref that moved
    // once the first build was already under way.
    const refs = refsStub([REF_A, REF_B]);
    const changing = { repoRoot: process.cwd(), refs } as BuildBoardOptions;
    const first = boardState({ opts: changing });
    await Promise.resolve();
    const second = boardState({ opts: changing });
    await Promise.all([first, second]);
    assert.equal(calls.count, 2, 'a joiner after a ref move must trigger its own build, not await the stale one');
  });

  it('rejects every joined caller when the shared build fails', async () => {
    calls.count = 0;
    calls.failing = true;
    const failingOpts = { repoRoot: '/repo-failing', refs: refsStub([REF_A]) } as BuildBoardOptions;
    try {
      const results = await Promise.allSettled([
        boardState({ opts: failingOpts }),
        boardState({ opts: failingOpts }),
      ]);
      assert.equal(results[0].status, 'rejected');
      assert.equal(results[1].status, 'rejected');
      assert.equal(calls.count, 1, 'both callers must have shared the one failing build');
    } finally {
      calls.failing = false;
    }
  });
});
