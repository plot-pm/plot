// Two `/api/board` requests that land while a build is still running must
// share that ONE `buildBoard` rather than each spawning its own — this is the
// mechanism fix for issue #2083 (board poll timing out under load). See
// `boardState`'s own comment in `fleet-state.ts` for the measurement that
// motivated it.
import { describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import type { Board } from '../../src/contract/schema.js';

const calls = vi.hoisted(() => ({ count: 0 }));

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
      // A fresh object per call, so two concurrent callers can be checked for
      // reference equality: coalesced callers get the SAME object, two
      // separate builds never do.
      return { ...FIXTURE_BOARD, generatedAt: new Date(calls.count).toISOString() };
    },
  };
});

import { boardState, realEstateSource, type EstateSource } from '../../src/server/controllers/fleet-state.js';
import type { BuildBoardOptions } from '../../src/server/board.js';

const opts = { repoRoot: process.cwd() } as BuildBoardOptions;

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
});
