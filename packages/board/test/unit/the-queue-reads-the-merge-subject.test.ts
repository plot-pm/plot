import { describe, expect, it } from 'vitest';
import type { PlanRecord } from '@plot-pm/domain';
import { refsFixture, type RefsFixture } from '@plot-pm/domain/adapters';
import type { PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import type { LandedAnswer } from '@plot-pm/domain/rules/landed';
import { whyNotReady } from '@plot-pm/domain/rules/queue';

import { readQueue, type QueueWorld } from '../../src/shared/queue-reading.js';
import { subjectProvenOf } from '../../src/server/entry/registryd-main.js';

/**
 * THE QUEUE READS THE MERGE SUBJECT (#1139).
 *
 * On Bitbucket a merged branch loses its ref, and under HTTP 429 neither the
 * merged listing nor a per-branch question answers. The `Merged in <branch>
 * (pull request #N)` commit on the default branch still proves the landing, so
 * the supervisor reads it per plan through the refs port.
 */

const PLAN_A = 'docs/plans/2026-01-01-earlier.md';
const PLAN_B = 'docs/plans/2026-06-01-later.md';

const plan = (file: string, slices: string[][], phase = 'approved'): PlanRecord =>
  ({
    file,
    phase,
    // EVERY SLICE IS NAMED, because these stand for plans that reached
    // `Approved`. An absent heading is what `unnamedBranches` counts, so an
    // unnamed fixture would hold every slice here on `slice-unnamed` and assert
    // the merge-subject proof against the wrong word.
    slices: slices.map((branches, index) => ({
      name: `Slice ${index + 1}`,
      branches: branches.map((branch) => ({ branch, deferred: false, waitsOn: [] })),
    })),
  }) as unknown as PlanRecord;

const bitbucket = (branch: string, n = 5): string => `Merged in ${branch} (pull request #${n})`;

/** An estate where `feature/one` merged after the plan was added. */
const ESTATE: RefsFixture = {
  additions: { [PLAN_A]: 'add-a' },
  merges: [{ sha: 'm1', subject: bitbucket('feature/one') }],
  ancestry: { 'm1 add-a': 'no' },
};

/**
 * A world whose listing and per-branch question both refuse, and which counts
 * every host question it is asked.
 */
const throttled = (
  plans: PlanRecord[],
  fixture: RefsFixture,
  over: Partial<QueueWorld> = {},
  queued: (branch: string) => LandedAnswer = () => 'unknown',
) => {
  const asked = {
    branches: [] as string[],
    views: [] as number[],
    proven: 0,
    holding: [] as string[],
  };
  const refs = refsFixture(fixture);
  // A ROW FOR THE PROVEN BRANCH, so asking the index about it would cost a
  // view by number — which the test then asserts never happens.
  const rows: PrIndexRow[] = [
    { number: 5, head: 'feature/one', state: 'OPEN', draft: false, checks: 'none', review: '', url: '' },
  ];
  const world: QueueWorld = {
    plans: async () => plans,
    claimedBranches: async () => new Set<string>(),
    mergedBranches: async () => ({
      merged: new Set<string>(),
      whole: false,
      kind: 'throttled' as const,
      failed: true,
    }),
    prIndexRows: async () => rows,
    viewLanded: async (n) => {
      asked.views.push(n);
      return 'unknown';
    },
    briefPresent: async () => true,
    sliceHasMerged: async (branch) => {
      asked.holding.push(branch);
      return false;
    },
    queuedHasLanded: async (branch) => {
      asked.branches.push(branch);
      return queued(branch);
    },
    subjectProven: async (list, claimed) => {
      asked.proven += 1;
      return subjectProvenOf(refs, 'bitbucket', list, claimed);
    },
    workerAlive: async () => true,
    blocked: async () => false,
    refused: async () => false,
    remoteHead: async () => 'absent',
    commitSubjects: async () => ({ ok: true, value: [] }),
    now: () => 0,
    defaultBranch: async () => 'main',
    ...over,
  };
  return { world, asked };
};

const holdOf = (readings: Awaited<ReturnType<typeof readQueue>>, branch: string) => {
  const slice = readings.slices.find((s) => s.branch === branch);
  return slice === undefined ? 'absent' : whyNotReady(slice);
};

describe('a merge subject settles a refless predecessor under a full 429', () => {
  it('spends no host call and no index lookup on the proven branch', async () => {
    const { world, asked } = throttled([plan(PLAN_A, [['feature/one'], ['feature/two']])], ESTATE);
    const readings = await readQueue([], world);

    expect(readings.slices.map((s) => s.branch)).toEqual(['feature/two']);
    expect(asked.views).toEqual([]);
    expect(asked.branches).not.toContain('feature/one');
  });

  it('holds the next slice on its own unanswered host question', async () => {
    // NO HOST-FREE ANSWER EXISTS FOR AN UNSTARTED BRANCH (#1094), so the next
    // slice still needs one answer about itself.
    const { world, asked } = throttled([plan(PLAN_A, [['feature/one'], ['feature/two']])], ESTATE);
    const readings = await readQueue([], world);

    expect(holdOf(readings, 'feature/two')).toBe('merge-unknown');
    expect(asked.branches).toEqual(['feature/two']);
  });

  it('hands the next slice out once its own question answers not-landed', async () => {
    const { world } = throttled(
      [plan(PLAN_A, [['feature/one'], ['feature/two']])],
      ESTATE,
      {},
      () => 'not-landed',
    );
    const readings = await readQueue([], world);

    expect(holdOf(readings, 'feature/two')).toBeNull();
  });
});

describe('where the proof is not applied', () => {
  it('applies no proof under the unreadable-ref sentinel', async () => {
    // `'*'` names no branch, so a subject naming an in-flight branch would
    // settle it. The proof is not even asked for.
    const { world, asked } = throttled(
      [plan(PLAN_A, [['feature/one'], ['feature/two']])],
      ESTATE,
      { claimedBranches: async () => new Set(['*']) },
      () => 'not-landed',
    );
    const readings = await readQueue([], world);

    expect(asked.proven).toBe(0);
    // `prior-unknown` AND NOT `not-claimable`: with no proof applied, slice 1
    // is looked up by its index number and that lookup answers `unknown`, so
    // slice 2 waits on the host rather than on the plan (#1094). It is held
    // either way.
    expect(holdOf(readings, 'feature/two')).toBe('prior-unknown');
  });

  it('applies no proof for a subject older than the plan', async () => {
    const { world } = throttled(
      [plan(PLAN_A, [['feature/one'], ['feature/two']])],
      { ...ESTATE, ancestry: { 'm1 add-a': 'yes' } },
      {},
      () => 'not-landed',
    );
    const readings = await readQueue([], world);

    // Unproven, so slice 1's own lookup by number decides — and it answers
    // `unknown`, which slice 2 now names.
    expect(holdOf(readings, 'feature/two')).toBe('prior-unknown');
  });

  it('applies no proof when the plan additions cannot be read', async () => {
    const { world } = throttled(
      [plan(PLAN_A, [['feature/one'], ['feature/two']])],
      { ...ESTATE, failing: ['planAdditions'] },
      {},
      () => 'not-landed',
    );
    const readings = await readQueue([], world);

    expect(holdOf(readings, 'feature/two')).toBe('prior-unknown');
  });
});

describe('the proof is keyed by plan', () => {
  it("settles a delivered plan's merged name and not the later plan that reuses it", async () => {
    const earlier = plan(PLAN_A, [['feature/x']], 'delivered');
    const later = plan(PLAN_B, [['feature/x'], ['feature/y']]);
    const fixture: RefsFixture = {
      additions: { [PLAN_A]: 'add-a', [PLAN_B]: 'add-b' },
      merges: [{ sha: 'm1', subject: bitbucket('feature/x') }],
      ancestry: { 'm1 add-a': 'no', 'm1 add-b': 'yes' },
    };

    const proven = await subjectProvenOf(refsFixture(fixture), 'bitbucket', [earlier, later], new Set());
    expect(proven).toEqual(new Map([[PLAN_A, new Set(['feature/x'])]]));

    const { world } = throttled([earlier, later], fixture, {}, () => 'not-landed');
    const readings = await readQueue([], world);
    // The later plan's reused name is unstarted work, offered; its next slice
    // stays behind it.
    expect(holdOf(readings, 'feature/x')).toBeNull();
    expect(holdOf(readings, 'feature/y')).toBe('not-claimable');
  });
});

describe('a branch carrying a ref keeps its own question', () => {
  it('is not reported proven, and the agent holding it is asked about it', async () => {
    const one = plan(PLAN_A, [['feature/one'], ['feature/two']]);
    const proven = await subjectProvenOf(refsFixture(ESTATE), 'bitbucket', [one], new Set(['feature/one']));
    expect(proven).toEqual(new Map());

    const { world, asked } = throttled([one], ESTATE, {
      claimedBranches: async () => new Set(['feature/one']),
    });
    await readQueue(
      [{ session: 's1', worktree: '/desk', branch: 'feature/one' } as never],
      world,
    );
    expect(asked.holding).toEqual(['feature/one']);
  });
});

describe('subjectProvenOf', () => {
  const one = plan(PLAN_A, [['feature/one'], ['feature/two']]);

  it('proves a branch whose merge is not contained in the plan', async () => {
    expect(await subjectProvenOf(refsFixture(ESTATE), 'bitbucket', [one], new Set())).toEqual(
      new Map([[PLAN_A, new Set(['feature/one'])]]),
    );
  });

  it('proves nothing on an unknown ancestry answer', async () => {
    const fixture = { ...ESTATE, ancestry: {} };
    expect(await subjectProvenOf(refsFixture(fixture), 'bitbucket', [one], new Set())).toEqual(new Map());
  });

  it('proves nothing when the ancestry test fails', async () => {
    const fixture: RefsFixture = { ...ESTATE, failing: ['contains'] };
    expect(await subjectProvenOf(refsFixture(fixture), 'bitbucket', [one], new Set())).toEqual(new Map());
  });

  it('proves a name merged twice when its newer merge postdates the plan', async () => {
    const fixture: RefsFixture = {
      additions: { [PLAN_A]: 'add-a' },
      merges: [
        { sha: 'm2', subject: bitbucket('feature/one', 9) },
        { sha: 'm1', subject: bitbucket('feature/one', 2) },
      ],
      ancestry: { 'm2 add-a': 'no', 'm1 add-a': 'yes' },
    };
    expect(await subjectProvenOf(refsFixture(fixture), 'bitbucket', [one], new Set())).toEqual(
      new Map([[PLAN_A, new Set(['feature/one'])]]),
    );
  });

  it('answers null when the merges walk fails', async () => {
    const fixture: RefsFixture = { ...ESTATE, failing: ['mergeSubjects'] };
    expect(await subjectProvenOf(refsFixture(fixture), 'bitbucket', [one], new Set())).toBeNull();
  });

  it('answers null when the plan additions fail', async () => {
    const fixture: RefsFixture = { ...ESTATE, failing: ['planAdditions'] };
    expect(await subjectProvenOf(refsFixture(fixture), 'bitbucket', [one], new Set())).toBeNull();
  });

  it('gives no subjects to a plan the additions do not name', async () => {
    const fixture: RefsFixture = { ...ESTATE, additions: {} };
    expect(await subjectProvenOf(refsFixture(fixture), 'bitbucket', [one], new Set())).toEqual(new Map());
  });

  it('proves nothing for a backend with no forms', async () => {
    expect(await subjectProvenOf(refsFixture(ESTATE), 'gitlab', [one], new Set())).toEqual(new Map());
  });

  it('skips a deferred branch', async () => {
    const deferred = {
      file: PLAN_A,
      phase: 'approved',
      slices: [{ name: 'A named slice', branches: [{ branch: 'feature/one', deferred: true }] }],
    } as unknown as PlanRecord;
    expect(await subjectProvenOf(refsFixture(ESTATE), 'bitbucket', [deferred], new Set())).toEqual(new Map());
  });

  it("reads the GitHub form against the origin's owner", async () => {
    const fixture = (owner: string): RefsFixture => ({
      additions: { [PLAN_A]: 'add-a' },
      merges: [{ sha: 'm1', subject: `Merge pull request #5 from ${owner}/feature/one` }],
      ancestry: { 'm1 add-a': 'no' },
      remotes: { origin: 'git@github.com:Acme/repo.git' },
    });
    expect(await subjectProvenOf(refsFixture(fixture('acme')), 'github', [one], new Set())).toEqual(
      new Map([[PLAN_A, new Set(['feature/one'])]]),
    );
    expect(await subjectProvenOf(refsFixture(fixture('fork')), 'github', [one], new Set())).toEqual(new Map());
  });
});
