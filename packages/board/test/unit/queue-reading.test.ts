import { describe, it, expect } from 'vitest';
import {
  queueOfPlan,
  readQueue,
  type MergedListing,
  type QueueWorld,
} from '../../src/shared/queue-reading.js';
import type { PlanRecord } from '@plot-pm/domain';
import type { PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import type { LandedAnswer } from '@plot-pm/domain/rules/landed';
import { whyNotReady } from '@plot-pm/domain/rules/queue';
import { VIEWS_PER_PASS } from '@plot-pm/domain/rules/known-pr';
import type { AgentEntry } from '../../src/shared/registry.js';

/** One registry manifest, in the shape `plot-dispatch.sh` writes it. */
const manifest = (over: Partial<AgentEntry> = {}): AgentEntry =>
  ({
    session: 'a1b2c3',
    resumeId: 'a1b2c3',
    identity: 'manifest',
    branch: 'feature/one',
    worktree: '/estate/.worktrees/feature-one',
    command: 'plot-worker-loop.sh',
    startedAt: '2026-09-04T10:00:00Z',
    pid: '4242',
    previousPid: '',
    relaunches: 0,
    attempts: 0,
    state: 'none',
    ...over,
  }) as AgentEntry;

/**
 * A MERGED BRANCH HAS NO REF, AND THE QUEUE COUNTED THAT AS UNSTARTED.
 *
 * Measured 2026-09-06: eight briefed, eligible slices were dispatched and every
 * one was held `not-claimable` against five free agents. `outstanding` counted
 * a slice's branches as those with no remote ref — true of a branch nobody has
 * begun, false of one that merged, because merging deletes the ref and
 * `plot-release-refs.sh` deletes the rest deliberately.
 *
 * So slice 1 never reached `complete`, and `priorComplete &&= verdict ===
 * 'complete'` blocked every slice behind it. The board rendered the same slices
 * as eligible because it asks the host.
 */
const plan = (slices: string[][], phase = 'approved'): PlanRecord =>
  ({
    file: 'docs/plans/2026-09-04-a-plan.md',
    phase,
    // EVERY SLICE IS NAMED, because a named slice is what a plan that passed
    // `/plot-approve` holds. The fixture omitted `name` entirely until the
    // queue read it, and an absent heading is what `unnamedBranches` counts —
    // so these cases would all have moved into `slice-unnamed` and asserted
    // their holds against the wrong word. A case about an unnamed slice says
    // `name: ''` at its own call site.
    slices: slices.map((branches, index) => ({
      name: `Slice ${index + 1}`,
      branches: branches.map((branch) => ({ branch, deferred: false, waitsOn: [] })),
    })),
  }) as unknown as PlanRecord;

/** A listing that answered in full — no refusal to name. */
const wholeListing = (heads: string[]): MergedListing => ({
  merged: new Set(heads),
  whole: true,
  kind: null,
  failed: false,
});

/** A listing whose request failed: no rows, and the refusal's kind. */
const failedListing = (kind: MergedListing['kind'] = 'failed'): MergedListing => ({
  merged: new Set<string>(),
  whole: false,
  kind,
  failed: true,
});

describe('a slice whose branches merged does not block the slices behind it', () => {
  it('reads the second slice as claimable when the first one merged', () => {
    // THE REPORTED ESTATE, at its smallest: slice 1 merged (no ref, because
    // merging deleted it), slice 2 unstarted and briefed.
    const queued = queueOfPlan(
      plan([['feature/one'], ['feature/two']]),
      new Set<string>(),
      new Set(['feature/one']),
    );

    const two = queued.find((q) => q.branch === 'feature/two');
    expect(two?.claimable).toBe(true);
  });

  it('still blocks the second slice when the first is merely unstarted', () => {
    // THE PROPERTY THE FIX MUST NOT BREAK. An unstarted slice 1 and a merged
    // slice 1 both have no ref; only the host separates them, and ordering
    // still holds for the first.
    const queued = queueOfPlan(
      plan([['feature/one'], ['feature/two']]),
      new Set<string>(),
      new Set<string>(),
    );

    expect(queued.find((q) => q.branch === 'feature/two')?.claimable).toBe(false);
    expect(queued.find((q) => q.branch === 'feature/one')?.claimable).toBe(true);
  });

  it('needs every branch of a slice merged, not just one', () => {
    const queued = queueOfPlan(
      plan([['feature/a', 'feature/b'], ['feature/two']]),
      new Set<string>(),
      new Set(['feature/a']),
    );
    expect(queued.find((q) => q.branch === 'feature/two')?.claimable).toBe(false);
  });

  it('leaves a merged branch out of the queue entirely', () => {
    // It is finished work: it must not be offered to anybody, and `landed`
    // already exists to say so for a branch that IS offered.
    const queued = queueOfPlan(
      plan([['feature/one'], ['feature/two']]),
      new Set<string>(),
      new Set(['feature/one']),
    );
    expect(queued.map((q) => q.branch)).not.toContain('feature/one');
  });
});

describe('the host is asked once per branch, and only where the answer decides', () => {
  const world = (over: Partial<QueueWorld> = {}): QueueWorld => ({
    plans: async () => [plan([['feature/one'], ['feature/two']])],
    claimedBranches: async () => new Set<string>(),
    mergedBranches: async () => wholeListing(['feature/one']),
    prIndexRows: async () => [],
    viewLanded: async () => 'unknown',
    briefPresent: async () => true,
    sliceHasMerged: async () => false,
    subjectProven: async () => null,
    queuedHasLanded: async () => 'not-landed',
    workerAlive: async () => true,
    blocked: async () => false,
    refused: async () => false,
    remoteHead: async () => 'absent',
    commitSubjects: async () => ({ ok: true, value: [] }),
    now: () => 0,
    defaultBranch: async () => 'main',
    ...over,
  });

  it('asks the host for merged branches exactly once per pass', async () => {
    // THE RATE LIMIT IS WHY THIS TEST EXISTS. The first fix asked `prMerged`
    // per branch: correct, and it took the tick from 25 s to 357 s across 426
    // branches. One bundled call is the contract, and a regression to per
    // branch would not fail a correctness test — only this one.
    let calls = 0;
    await readQueue([], world({
      mergedBranches: async () => {
        calls += 1;
        return wholeListing(['feature/one']);
      },
    }));

    expect(calls).toBe(1);
  });

  it('promotes the slice behind a merged one', async () => {
    const readings = await readQueue([], world());
    expect(readings.slices.find((s) => s.branch === 'feature/two')?.claimable).toBe(true);
  });

  it('holds every slice when the host cannot be asked at all', async () => {
    // SILENCE MUST NOT PROMOTE WORK. An unreachable host yields an empty set,
    // so slice 1 stays outstanding and slice 2 stays blocked — the opposite of
    // the reaper's direction, where silence KEEPS a checkout.
    const readings = await readQueue([], world({
      mergedBranches: async () => failedListing(),
    }));

    expect(readings.slices.find((s) => s.branch === 'feature/two')?.claimable).toBe(false);
  });
});

/**
 * A KNOWN PR NUMBER IS ASKED BY NUMBER WHEN THE LISTING FAILS (#1140).
 *
 * Measured 2026-10-01 on Bitbucket: `bb pr list` answered HTTP 429 from about
 * 12:30 to past 14:10, while `bb pr view <n>` answered in the same window. The
 * queue read the failed listing as *nothing merged*, so every slice behind a
 * merged one held `not-claimable` (#1094).
 */
describe('a known PR number is asked by number when the listing fails', () => {
  const indexRow = (number: number, head: string, state: string): PrIndexRow => ({
    number,
    head,
    state,
    draft: false,
    checks: 'none',
    review: '',
    url: '',
  });

  /** A world whose listing failed, and which counts every host call. */
  const failing = (
    plans: PlanRecord[],
    rows: PrIndexRow[],
    view: (n: number) => LandedAnswer,
    queued: (branch: string) => LandedAnswer = () => 'not-landed',
  ) => {
    const asked = { listing: 0, views: [] as number[], branches: [] as string[] };
    const world: QueueWorld = {
      plans: async () => plans,
      claimedBranches: async () => new Set<string>(),
      mergedBranches: async () => {
        asked.listing += 1;
        return failedListing();
      },
      prIndexRows: async () => rows,
      viewLanded: async (n) => {
        asked.views.push(n);
        return view(n);
      },
      briefPresent: async () => true,
      sliceHasMerged: async () => false,
      subjectProven: async () => null,
      queuedHasLanded: async (branch) => {
        asked.branches.push(branch);
        return queued(branch);
      },
      workerAlive: async () => true,
      blocked: async () => false,
      refused: async () => false,
      remoteHead: async () => 'absent',
      commitSubjects: async () => ({ ok: true, value: [] }),
      now: () => 0,
      defaultBranch: async () => 'main',
    };
    return { world, asked };
  };

  const hold = (readings: Awaited<ReturnType<typeof readQueue>>, branch: string) =>
    whyNotReady(readings.slices.find((s) => s.branch === branch)!);

  it('offers the next slice when the view by number says the first merged', async () => {
    const { world, asked } = failing(
      [plan([['feature/one'], ['feature/two']])],
      [indexRow(12, 'feature/one', 'OPEN')],
      () => 'landed',
    );
    const readings = await readQueue([], world);

    expect(hold(readings, 'feature/two')).toBeNull();
    expect(readings.slices.map((s) => s.branch)).not.toContain('feature/one');
    expect(asked.views).toEqual([12]);
  });

  it('keeps the next slice held when the view does not answer', async () => {
    const { world } = failing(
      [plan([['feature/one'], ['feature/two']])],
      [indexRow(12, 'feature/one', 'OPEN')],
      () => 'unknown',
    );
    const readings = await readQueue([], world);

    // SLICE 2 NAMES THE HOST, NOT THE PLAN. It is held exactly as before —
    // silence must not promote work — and the word now says the landing of
    // slice 1 could not be asked, which is what sent a reader to the plan.
    expect(hold(readings, 'feature/two')).toBe('prior-unknown');
    expect(hold(readings, 'feature/one')).toBe('merge-unknown');
  });

  it('keeps the next slice held when the view says the PR did not merge', async () => {
    const { world, asked } = failing(
      [plan([['feature/one'], ['feature/two']])],
      [indexRow(12, 'feature/one', 'CLOSED')],
      () => 'not-landed',
    );
    const readings = await readQueue([], world);

    // THE ASSERTION THAT SEPARATES THE TWO WORDS. The host ANSWERED here — it
    // said the PR did not merge — so slice 2 is waiting its turn rather than
    // waiting on the host, and a change relabelling every `not-claimable`
    // would fail exactly here.
    expect(hold(readings, 'feature/two')).toBe('not-claimable');
    // The view already answered feature/one, so it is not asked again by branch.
    expect(asked.branches).not.toContain('feature/one');
  });

  it('reads a merged index row for no host call', async () => {
    const { world, asked } = failing(
      [plan([['feature/one'], ['feature/two']])],
      [indexRow(12, 'feature/one', 'MERGED')],
      () => 'unknown',
    );
    const readings = await readQueue([], world);

    expect(hold(readings, 'feature/two')).toBeNull();
    expect(asked.views).toEqual([]);
  });

  it('asks nothing by number for a branch no PR number names', async () => {
    const { world, asked } = failing([plan([['feature/one'], ['feature/two']])], [], () => 'landed');
    const readings = await readQueue([], world);

    expect(asked.views).toEqual([]);
    expect(hold(readings, 'feature/two')).toBe('not-claimable');
  });

  it('walks every merged slice of a plan in one pass', async () => {
    const { world, asked } = failing(
      [plan([['feature/a'], ['feature/b'], ['feature/c'], ['feature/d']])],
      [indexRow(1, 'feature/a', 'MERGED'), indexRow(2, 'feature/b', 'OPEN'), indexRow(3, 'feature/c', 'OPEN')],
      () => 'landed',
    );
    const readings = await readQueue([], world);

    expect(hold(readings, 'feature/d')).toBeNull();
    expect(asked.views).toEqual([2, 3]);
  });

  it('reads the index and asks nothing by number when the listing answered', async () => {
    let read = 0;
    const { world, asked } = failing([plan([['feature/one'], ['feature/two']])], [], () => 'landed');
    const readings = await readQueue([], {
      ...world,
      mergedBranches: async () => wholeListing(['feature/one']),
      prIndexRows: async () => {
        read += 1;
        return [];
      },
    });

    expect(read).toBe(0);
    expect(asked.views).toEqual([]);
    expect(hold(readings, 'feature/two')).toBeNull();
  });

  it('bounds the lookups by number in one pass, on an estate of 40 refless branches', async () => {
    // TEN PLANS, each with three merged, refless slices whose PRs the index
    // holds only as stale OPEN rows, and a fourth slice nobody has started.
    // Before #1140 this pass made 11 host calls (the failed listing, then one
    // per-branch question for each plan's first slice) and held all ten fourth
    // slices `not-claimable`.
    const plans = Array.from({ length: 10 }, (_, p) =>
      ({
        ...plan([[`feature/p${p}-a`], [`feature/p${p}-b`], [`feature/p${p}-c`], [`feature/p${p}-d`]]),
        file: `docs/plans/2026-10-01-plan-${p}.md`,
      }) as PlanRecord,
    );
    const rows = plans.flatMap((_, p) =>
      ['a', 'b', 'c'].map((s, i) => indexRow(100 + p * 3 + i, `feature/p${p}-${s}`, 'OPEN')),
    );
    const { world, asked } = failing(plans, rows, () => 'landed');
    const readings = await readQueue([], world);

    expect(asked.listing).toBe(1);
    expect(asked.views).toHaveLength(VIEWS_PER_PASS);
    // Plan 0 settled in three views; its fourth slice is asked once by branch.
    expect(asked.branches).toEqual(['feature/p0-d']);
    expect(hold(readings, 'feature/p0-d')).toBeNull();
    // Plan 1 spent the last two views; its third slice is past the cap and
    // reads `unknown` without a per-branch question into the failed listing.
    expect(hold(readings, 'feature/p1-c')).toBe('merge-unknown');
    // Behind an unanswered landing in its OWN plan, so it names the host.
    expect(hold(readings, 'feature/p1-d')).toBe('prior-unknown');
    expect(hold(readings, 'feature/p9-a')).toBe('merge-unknown');
    // 1 listing + 5 views + 1 per-branch question = 7 host calls in the pass.
    expect(asked.listing + asked.views.length + asked.branches.length).toBe(7);
  });
});

/**
 * A SLICE HELD BEHIND A LANDING NOBODY COULD ASK ABOUT (#1094).
 *
 * Measured 2026-09-30 on a Bitbucket estate under HTTP 429: the supervisor held
 * 36 slices `not-claimable`, among them slices whose earlier waves had merged
 * days before. `not-claimable` means *the plan's ordering blocks this*, so a
 * reader went to the plan and found nothing wrong with it.
 *
 * THE HOLD DOES NOT CHANGE. Silence must not promote work, and these tests
 * assert the slice stays held — only the word it is held under moves.
 */
describe('a slice behind an unanswered landing names the host', () => {
  const twoSlice = (
    answer: LandedAnswer,
    plans: PlanRecord[] = [plan([['feature/one'], ['feature/two']])],
  ) => {
    const asked = { listing: 0, branches: [] as string[] };
    const world: QueueWorld = {
      plans: async () => plans,
      claimedBranches: async () => new Set<string>(),
      mergedBranches: async () => {
        asked.listing += 1;
        return failedListing('throttled');
      },
      prIndexRows: async () => [],
      viewLanded: async () => 'unknown',
      briefPresent: async () => true,
      sliceHasMerged: async () => false,
      subjectProven: async () => null,
      queuedHasLanded: async (branch) => {
        asked.branches.push(branch);
        return answer;
      },
      workerAlive: async () => true,
      blocked: async () => false,
      refused: async () => false,
      remoteHead: async () => 'absent',
      commitSubjects: async () => ({ ok: true, value: [] }),
      now: () => 0,
      defaultBranch: async () => 'main',
    };
    return { world, asked };
  };

  const hold = (readings: Awaited<ReturnType<typeof readQueue>>, branch: string) =>
    whyNotReady(readings.slices.find((s) => s.branch === branch)!);

  it('holds slice 1 `merge-unknown` and slice 2 `prior-unknown`', async () => {
    const { world } = twoSlice('unknown');
    const readings = await readQueue([], world);

    expect(hold(readings, 'feature/one')).toBe('merge-unknown');
    expect(hold(readings, 'feature/two')).toBe('prior-unknown');
  });

  it('holds slice 2 `not-claimable` when slice 1 simply has not landed', async () => {
    // THE SAME WORLD, ONE READING CHANGED. A change that relabelled every
    // `not-claimable` as `prior-unknown` passes the test above and fails this
    // one: the host answered, and slice 2 is waiting its turn.
    const { world } = twoSlice('not-landed');
    const readings = await readQueue([], world);

    expect(hold(readings, 'feature/one')).toBeNull();
    expect(hold(readings, 'feature/two')).toBe('not-claimable');
  });

  it("does not mark a second plan from the first plan's unanswered landing", async () => {
    // A PER-ESTATE FLAG PASSES EVERY SINGLE-PLAN TEST. The two plans share a
    // host and nothing else: plan B's own slice 1 answered, so its slice 2 is
    // held by plan B's ordering.
    const planB = {
      ...plan([['feature/b-one'], ['feature/b-two']]),
      file: 'docs/plans/2026-10-01-plan-b.md',
    } as PlanRecord;
    const { world } = twoSlice('unknown', [plan([['feature/one'], ['feature/two']])]);
    const readings = await readQueue([], {
      ...world,
      plans: async () => [plan([['feature/one'], ['feature/two']]), planB],
      // Plan A's slice 1 goes unanswered; plan B's answers *not merged*.
      queuedHasLanded: async (branch) => (branch === 'feature/one' ? 'unknown' : 'not-landed'),
    });

    expect(hold(readings, 'feature/two')).toBe('prior-unknown');
    expect(hold(readings, 'feature/b-two')).toBe('not-claimable');
  });

  it('never marks a later slice that is claimable in its own right', async () => {
    // Slice 1 merged, so slice 2 is claimable and keeps its own landing
    // question — here unanswered, which is `merge-unknown` and not its
    // predecessor's problem.
    const { world } = twoSlice('unknown');
    const readings = await readQueue([], {
      ...world,
      mergedBranches: async () => ({ ...wholeListing(['feature/one']), whole: false, failed: true }),
      subjectProven: async () => new Map([['docs/plans/2026-09-04-a-plan.md', new Set(['feature/one'])]]),
    });

    const two = readings.slices.find((s) => s.branch === 'feature/two');
    expect(two?.claimable).toBe(true);
    expect(two?.priorUnknown).toBe(false);
    expect(hold(readings, 'feature/two')).toBe('merge-unknown');
  });

  it('costs no host call beyond the ones the pass already took', async () => {
    // NO NEW HOST CALL. The `unknown` answers are this pass's own: one listing
    // and one per-branch question for the slice that could otherwise be handed
    // over. The hold is decided from those readings and asks nothing.
    const { world, asked } = twoSlice('unknown');
    await readQueue([], world);

    expect(asked.listing).toBe(1);
    expect(asked.branches).toEqual(['feature/one']);
  });

  it("carries the listing's state and the refusal's kind beside the slices", async () => {
    const { world } = twoSlice('unknown');
    const readings = await readQueue([], world);

    expect(readings.mergedSet).toEqual({ state: 'unaskable', kind: 'throttled' });
  });

  it('reads a whole listing as `whole`, with no kind to name', async () => {
    const readings = await readQueue([], {
      ...twoSlice('not-landed').world,
      mergedBranches: async () => wholeListing([]),
    });

    expect(readings.mergedSet).toEqual({ state: 'whole', kind: null });
  });

  it('reads an answered listing that left a refusal as `partial`', async () => {
    // `partial` AND `unaskable` ARE NOT ONE WORD. This listing ANSWERED and
    // left a refusal behind, so its rows are real but may be incomplete; an
    // unaskable listing has no rows at all.
    const readings = await readQueue([], {
      ...twoSlice('not-landed').world,
      mergedBranches: async () => ({
        merged: new Set(['feature/one']),
        whole: false,
        kind: 'secondary',
        failed: false,
      }),
    });

    expect(readings.mergedSet).toEqual({ state: 'partial', kind: 'secondary' });
  });

  it('names a refusal `failed` where the listing gave no kind', async () => {
    const readings = await readQueue([], {
      ...twoSlice('not-landed').world,
      mergedBranches: async () => ({
        merged: new Set<string>(),
        whole: false,
        kind: null,
        failed: false,
      }),
    });

    // A state with no cause would print `partial()`; something refused it.
    expect(readings.mergedSet).toEqual({ state: 'partial', kind: 'failed' });
  });
});

/**
 * THE QUEUE READS THE PLAN'S OWN HEADINGS.
 *
 * **THIS IS THE REACH TEST, AND IT CATCHES THE FAILURE THIS REPOSITORY KEEPS
 * MEASURING.** `setSprintState` named nine refusals and had no caller outside
 * its own test file, and a master agent wrote the field it guarded by hand.
 * `whyNotReady`'s own tests are green against a `queueOfPlan` that never sets
 * `unnamed` — so the hold is asserted here through `readQueue`, over a plan
 * record whose slice carries no heading.
 */
describe('a slice its plan names under no heading is held by the queue', () => {
  /** A plan whose single approved slice carries no `###` heading. */
  const unnamedPlan = (): PlanRecord =>
    ({
      file: 'docs/plans/2026-10-02-an-unnamed-slice.md',
      phase: 'approved',
      slices: [{ name: '', branches: [{ branch: 'feature/nameless', deferred: false, waitsOn: [] }] }],
    }) as unknown as PlanRecord;

  /** A world that answers everything a hand-over needs, and counts host calls. */
  const asked = () => {
    const calls = { listing: 0, landed: 0, views: 0 };
    const world: QueueWorld = {
      plans: async () => [unnamedPlan()],
      claimedBranches: async () => new Set<string>(),
      mergedBranches: async () => {
        calls.listing += 1;
        return wholeListing([]);
      },
      prIndexRows: async () => [],
      viewLanded: async () => {
        calls.views += 1;
        return 'unknown';
      },
      briefPresent: async () => true,
      sliceHasMerged: async () => false,
      subjectProven: async () => null,
      queuedHasLanded: async () => {
        calls.landed += 1;
        return 'not-landed';
      },
      workerAlive: async () => true,
      blocked: async () => false,
      refused: async () => false,
      remoteHead: async () => 'absent',
      commitSubjects: async () => ({ ok: true, value: [] }),
      now: () => 0,
      defaultBranch: async () => 'main',
    };
    return { world, calls };
  };

  it('carries the reading from the plan record onto the queued slice', async () => {
    const readings = await readQueue([], asked().world);

    const slice = readings.slices.find((s) => s.branch === 'feature/nameless');
    expect(slice?.unnamed).toBe(true);
    expect(whyNotReady(slice!)).toBe('slice-unnamed');
  });

  it('reads a named slice as named, so the hold fires on the heading alone', async () => {
    // THE SAME WORLD, ONE READING CHANGED. A `queueOfPlan` hardcoding `true`
    // passes the case above and fails this one.
    const { world } = asked();
    const readings = await readQueue([], {
      ...world,
      plans: async () => [plan([['feature/nameless']])],
    });

    const slice = readings.slices.find((s) => s.branch === 'feature/nameless');
    expect(slice?.unnamed).toBe(false);
    expect(whyNotReady(slice!)).toBeNull();
  });

  it('asks the host nothing extra — the heading is a property of the plan', async () => {
    // THE READING COSTS NO CALL OF ITS OWN. It comes from the slices the plan
    // store already parsed, so an unnamed slice costs exactly what the same
    // slice costs when it is named — asserted as a COMPARISON rather than as a
    // zero, because this slice is claimable and briefed and the per-branch
    // landing question is asked of it either way, as it was before this hold.
    const unnamedRun = asked();
    await readQueue([], unnamedRun.world);

    const namedRun = asked();
    await readQueue([], {
      ...namedRun.world,
      plans: async () => [plan([['feature/nameless']])],
    });

    expect(unnamedRun.calls).toEqual(namedRun.calls);
    // AND THE PASS MAKES THE ONE BUNDLED LISTING IT ALWAYS MADE, never a call
    // per branch.
    expect(unnamedRun.calls.listing).toBe(1);
    expect(unnamedRun.calls.views).toBe(0);
  });
});

/**
 * A SLICE AN AGENT WAS HANDED AND REFUSED.
 *
 * Measured 2026-10-03: an agent handed `bug/the-queue-reads-the-scans-order`
 * wrote `PLOT-BLOCKED.md` and stopped. The next pass read the slice as queued
 * — no ref, nothing this reading could see — and handed it to another free
 * agent, which met the same refusal. 250 desks came from one slice this way.
 *
 * The world answers by BRANCH, never by worktree: a desk's manifest cannot be
 * trusted to still name the branch by the time the supervisor looks.
 */
describe('a slice an agent refused is held, by a reading that never latches', () => {
  /** A world that answers everything a hand-over needs, over one branch. */
  const world = (over: Partial<QueueWorld> = {}): QueueWorld => ({
    plans: async () => [plan([['feature/refused']])],
    claimedBranches: async () => new Set<string>(),
    mergedBranches: async () => wholeListing([]),
    prIndexRows: async () => [],
    viewLanded: async () => 'unknown',
    briefPresent: async () => true,
    sliceHasMerged: async () => false,
    subjectProven: async () => null,
    queuedHasLanded: async () => 'not-landed',
    workerAlive: async () => true,
    blocked: async () => false,
    refused: async () => false,
    remoteHead: async () => 'absent',
    commitSubjects: async () => ({ ok: true, value: [] }),
    now: () => 0,
    defaultBranch: async () => 'main',
    ...over,
  });

  it('sets `refused: true` for the branch a world names', async () => {
    const readings = await readQueue([], world({ refused: async (branch) => branch === 'feature/refused' }));

    const slice = readings.slices.find((s) => s.branch === 'feature/refused');
    expect(slice?.refused).toBe(true);
    expect(whyNotReady(slice!)).toBe('refused');
  });

  it("leaves a sibling branch alone — the reading is per branch, not per plan", async () => {
    // CATCHES A READING THAT MARKS EVERY BRANCH ONCE ONE IS REFUSED, rather
    // than the one a world actually names.
    const readings = await readQueue(
      [],
      world({
        plans: async () => [plan([['feature/refused'], ['feature/clear']])],
        refused: async (branch) => branch === 'feature/refused',
        remoteHead: async () => 'absent',
        commitSubjects: async () => ({ ok: true, value: [] }),
        now: () => 0,
        defaultBranch: async () => 'main',
      }),
    );

    expect(readings.slices.find((s) => s.branch === 'feature/refused')?.refused).toBe(true);
    expect(readings.slices.find((s) => s.branch === 'feature/clear')?.refused).toBe(false);
  });

  it('reads `false` once the world clears the refusal — IT NEVER LATCHES', async () => {
    // THE HOLD IS A READING THE CALLER TAKES FRESH EACH PASS, not a state this
    // rule remembers. A world that answered `true` yesterday and `false` today
    // is exactly what a cleared marker or a removed record line looks like.
    const refusedPass = await readQueue([], world({ refused: async () => true }));
    expect(refusedPass.slices.find((s) => s.branch === 'feature/refused')?.refused).toBe(true);

    const clearedPass = await readQueue([], world({ refused: async () => false }));
    expect(clearedPass.slices.find((s) => s.branch === 'feature/refused')?.refused).toBe(false);
  });

  it('asks nothing of an unclaimable slice — the same bound `briefPresent` keeps', async () => {
    // THE SAME DISCIPLINE `briefPresent` AND THE LANDING QUESTION FOLLOW: an
    // unclaimable slice reads `not-claimable` regardless, so asking the world
    // would pay for an answer nothing reads.
    let asked = 0;
    const readings = await readQueue(
      [],
      world({
        plans: async () => [plan([['feature/refused'], ['feature/blocked-by-plan']], 'draft')],
        refused: async () => {
          asked += 1;
          return true;
        },
      }),
    );

    expect(asked).toBe(0);
    expect(readings.slices.every((s) => s.refused === false)).toBe(true);
  });
});

describe('a `waits:` prerequisite holds a slice through the real join', () => {
  const planWithWait = (waitsOn: readonly string[]): PlanRecord =>
    ({
      file: 'docs/plans/2026-10-01-a-plan.md',
      phase: 'approved',
      slices: [
        { name: 'A named slice', branches: [{ branch: 'feature/waiter', deferred: false, waitsOn }] },
      ],
    }) as unknown as PlanRecord;

  const world = (over: Partial<QueueWorld> = {}): QueueWorld => ({
    plans: async () => [planWithWait(['feature/prereq'])],
    claimedBranches: async () => new Set<string>(),
    mergedBranches: async () => wholeListing([]),
    prIndexRows: async () => [],
    viewLanded: async () => 'unknown',
    briefPresent: async () => true,
    sliceHasMerged: async () => false,
    subjectProven: async () => null,
    queuedHasLanded: async () => 'not-landed',
    workerAlive: async () => true,
    blocked: async () => false,
    refused: async () => false,
    remoteHead: async () => 'absent',
    commitSubjects: async () => ({ ok: true, value: [] }),
    now: () => 0,
    defaultBranch: async () => 'main',
    ...over,
  });

  it('holds the slice as `waits` with `unmerged` on a whole listing', async () => {
    const readings = await readQueue([], world());
    const slice = readings.slices.find((s) => s.branch === 'feature/waiter')!;
    expect(whyNotReady(slice)).toBe('waits');
    expect(slice.waitsOn).toEqual(['feature/prereq']);
    expect(slice.waitHeld).toBe('unmerged');
  });

  it('holds the slice as `waits` with `unreachable` on a partial listing', async () => {
    // THE PARTIAL-LISTING ROW: the listing has rows but did not answer whole,
    // and none of its rows name the prerequisite. Reading this as `unmerged`
    // would be the same hold for the wrong reason.
    const readings = await readQueue(
      [],
      world({
        mergedBranches: async () => ({
          merged: new Set(['unrelated/branch']),
          whole: false,
          kind: 'throttled',
          failed: false,
        }),
      }),
    );
    const slice = readings.slices.find((s) => s.branch === 'feature/waiter')!;
    expect(whyNotReady(slice)).toBe('waits');
    expect(slice.waitHeld).toBe('unreachable');
  });

  it('clears the hold once the merged listing names the prerequisite', async () => {
    const readings = await readQueue(
      [],
      world({ mergedBranches: async () => wholeListing(['feature/prereq']) }),
    );
    const slice = readings.slices.find((s) => s.branch === 'feature/waiter')!;
    expect(whyNotReady(slice)).toBeNull();
    expect(slice.waitHeld).toBe('');
  });
});

/**
 * THE QUEUE READS THE ASSIGNMENT, NOT ONLY THE CLAIM REF.
 *
 * Measured 2026-10-01: the supervisor handed agent `8111e3ec` a second slice
 * while its manifest still named the first, because `readQueue` read claim
 * refs and never manifests. A dispatch writes the manifest before its claim
 * push lands, so between a hand-over and that push nothing a remote ref can
 * see recorded the assignment.
 */
describe('readQueue — a live manifest closes the gap before the claim push lands', () => {
  const world = (over: Partial<QueueWorld> = {}): QueueWorld => ({
    // TWO INDEPENDENT PLANS, EACH A SINGLE SLICE — so neither branch's ordering
    // depends on the other, and `not-claimable` cannot be mistaken for the
    // assignment hold this test is about.
    plans: async () => [
      plan([['bug/x']]),
      { ...plan([['bug/y']]), file: 'docs/plans/2026-09-04-a-second-plan.md' } as PlanRecord,
    ],
    claimedBranches: async () => new Set<string>(),
    mergedBranches: async () => wholeListing([]),
    prIndexRows: async () => [],
    viewLanded: async () => 'unknown',
    briefPresent: async () => true,
    sliceHasMerged: async () => false,
    subjectProven: async () => null,
    queuedHasLanded: async () => 'not-landed',
    workerAlive: async () => true,
    blocked: async () => false,
    refused: async () => false,
    remoteHead: async () => 'absent',
    commitSubjects: async () => ({ ok: true, value: [] }),
    now: () => 0,
    defaultBranch: async () => 'main',
    ...over,
  });

  it('holds the branch a LIVE agent’s manifest names `assigned`, and offers the dead agent’s', async () => {
    // A NAIVE FILTER ON "manifest names a branch" PASSES THE FIRST HALF AND
    // HOLDS THE SECOND FOREVER. `bug/x`'s agent is alive (`workerAlive: true`);
    // `bug/y`'s is dead (`workerAlive: false` for that one worktree) — #1039's
    // negative control, so `bug/y` must read as queued rather than `assigned`.
    const entries = [
      manifest({ session: 'live', branch: 'bug/x', worktree: '/estate/.worktrees/bug-x' }),
      manifest({ session: 'dead', branch: 'bug/y', worktree: '/estate/.worktrees/bug-y' }),
    ];
    const readings = await readQueue(
      entries,
      world({
        workerAlive: async (worktree) => worktree === '/estate/.worktrees/bug-x',
      }),
    );

    const x = readings.slices.find((s) => s.branch === 'bug/x')!;
    const y = readings.slices.find((s) => s.branch === 'bug/y')!;
    expect(x.assignedTo).toBe('live');
    expect(whyNotReady(x)).toBe('assigned');
    expect(y.assignedTo).toBe('');
    expect(whyNotReady(y)).toBeNull();
  });

  it('holds the branch a WAITING agent’s manifest names, too — blocked still holds a slot', async () => {
    const entries = [manifest({ session: 'blocked', branch: 'bug/x' })];
    const readings = await readQueue(entries, world({ blocked: async () => true }));

    const x = readings.slices.find((s) => s.branch === 'bug/x')!;
    expect(x.assignedTo).toBe('blocked');
    expect(whyNotReady(x)).toBe('assigned');
  });

  it('reads the branch unassigned once no live manifest names it — the reading never latches', async () => {
    const assignedPass = await readQueue(
      [manifest({ session: 'a', branch: 'bug/x' })],
      world(),
    );
    expect(assignedPass.slices.find((s) => s.branch === 'bug/x')?.assignedTo).toBe('a');

    const clearedPass = await readQueue([], world());
    expect(clearedPass.slices.find((s) => s.branch === 'bug/x')?.assignedTo).toBe('');
  });
});

/**
 * THE TICK REPLAY OF THE 2026-10-01 SEQUENCE.
 *
 * Agent A is handed `bug/x` (its manifest names it) and its claim push has not
 * yet landed — no remote ref. A second tick, with a second free agent, must not
 * hand `bug/x` to it too. This FAILS ON `main` TODAY: the queue reads claim
 * refs and never manifests, so `bug/x` reads as unclaimed and a second agent
 * takes it.
 */
describe('the tick replay — a hand-over decided but not yet pushed is not re-handed', () => {
  it('does not hand the already-assigned branch to a second free agent', async () => {
    const entries = [
      // AGENT A HOLDS `bug/x` BY MANIFEST ALONE — no claim ref exists yet.
      manifest({ session: 'agent-a', branch: 'bug/x', worktree: '/estate/.worktrees/bug-x' }),
      // AGENT B IS FREE AND ABOUT TO BE MATCHED AGAINST THE QUEUE.
      manifest({ session: 'agent-b', branch: '', worktree: '/estate/.worktrees/agent-b' }),
    ];
    const world: QueueWorld = {
      plans: async () => [plan([['bug/x']])],
      claimedBranches: async () => new Set<string>(),
      mergedBranches: async () => wholeListing([]),
      prIndexRows: async () => [],
      viewLanded: async () => 'unknown',
      briefPresent: async () => true,
      sliceHasMerged: async () => false,
      subjectProven: async () => null,
      queuedHasLanded: async () => 'not-landed',
      workerAlive: async () => true,
      blocked: async () => false,
      refused: async () => false,
      remoteHead: async () => 'absent',
      commitSubjects: async () => ({ ok: true, value: [] }),
      now: () => 0,
      defaultBranch: async () => 'main',
    };

    const readings = await readQueue(entries, world);
    const x = readings.slices.find((s) => s.branch === 'bug/x')!;

    expect(x.assignedTo).toBe('agent-a');
    expect(whyNotReady(x)).toBe('assigned');
  });
});
