import { describe, it, expect } from 'vitest';
import { summariseFromPulse, worktreesFromPulse } from '../../src/server/board.js';
import { PlanMetaSchema, type FleetReading } from '../../src/contract/schema.js';

// The defect these tests exist for: a card's `claimed` count was read from
// `b.claimed`, a plan-file annotation nobody writes — claims are pushed as git
// refs. The count was therefore not stale but permanently 0, and it agreed with
// "nothing is claimed" while the Agents tab, reading the same refs, showed the
// claim. Every assertion below is about which source answers which question.

const meta = (over: Record<string, unknown> = {}) =>
  PlanMetaSchema.parse({
    file: '/repo/docs/plans/2026-08-16-board-reads-git.md',
    format: 'canonical',
    phase: 'approved',
    ...over,
  });

/**
 * One wave, whatever branches it was given. A third tuple element is the local
 * worktree path, which is absent for every branch this machine does not have
 * checked out — which is the common case, and the default here.
 */
const slice = (
  name: string,
  verdict: 'complete' | 'eligible' | 'blocked',
  branches: Array<[string, 'open' | 'wip' | 'merged' | 'claimed' | 'deferred', string?]>,
) => ({
  name,
  verdict,
  branches: branches.map(([branch, state, worktree]) => ({
    branch,
    state,
    deferred: state === 'deferred',
    claimed: '',
    local_dirty: false,
    local_worktree: worktree ?? '',
  })),
});

const pulse = (file: string, slices: ReturnType<typeof slice>[]): FleetReading => ({
  main: 'main',
  head: 'abc1234',
  plans: [{ file, slices }],
  summary: {
    plans: 1, waves: slices.length, branches: 0, claimed: 0,
    eligible: 0, blocked: 0, deferred: 0,
  },
});

describe('summariseFromPulse — the card reads claims from git', () => {
  it('reports a claimed branch as claimed: 1', () => {
    // THE regression. This is the plan's two-branch wave with one branch taken
    // by a dispatcher — the exact state that rendered as 0 before.
    const m = meta({
      branches: ['bug/board-claimed-from-git', 'bug/dispatch-records-started'],
      waves: [{
        name: 'Fixes',
        branches: [
          { branch: 'bug/board-claimed-from-git', deferred: false, claimed: '' },
          { branch: 'bug/dispatch-records-started', deferred: false, claimed: '' },
        ],
      }],
    });
    const p = pulse('2026-08-16-board-reads-git.md', [
      slice('Fixes', 'eligible', [
        ['bug/board-claimed-from-git', 'claimed'],
        ['bug/dispatch-records-started', 'open'],
      ]),
    ]);
    const s = summariseFromPulse(m, p);
    expect(s.claimed).toBe(1);
    // ...and the other branch is startable, which the card could not say at all
    // before: SliceSummary carried no `eligible`.
    expect(s.eligible).toBe(1);
  });

  it('counts a claim even though the plan file annotates none', () => {
    // The mechanism, isolated. Every plan-side `claimed` is "" here — exactly
    // as real plan files have it, since nobody writes that annotation — and the
    // count is 1 regardless, because it comes from the ref.
    const m = meta({
      waves: [{
        name: 'Fixes',
        branches: [{ branch: 'feature/a', deferred: false, claimed: '' }],
      }],
    });
    const p = pulse('2026-08-16-board-reads-git.md', [
      slice('Fixes', 'eligible', [['feature/a', 'claimed']]),
    ]);
    expect(summariseFromPulse(m, p).claimed).toBe(1);
  });

  it('omits both counts when there is no pulse — absent, not zero', () => {
    // The distinction the whole plan turns on. A cold cache must not render
    // identically to an idle plan.
    const m = meta({
      waves: [{
        name: 'Fixes',
        branches: [{ branch: 'feature/a', deferred: false, claimed: '' }],
      }],
    });
    const s = summariseFromPulse(m, null);
    expect(s.claimed).toBeUndefined();
    expect(s.eligible).toBeUndefined();
    // Shape still renders: it comes from the plan and is true without git.
    expect(s).toMatchObject({ slices: 1, branches: 1, deferred: 0 });
  });

  it('omits the counts when the pulse does not know this plan', () => {
    // A plan the scan did not cover is a plan git has said nothing about —
    // reporting 0 claimed would be an assertion nobody made.
    const m = meta({
      waves: [{
        name: 'Fixes',
        branches: [{ branch: 'feature/a', deferred: false, claimed: '' }],
      }],
    });
    const p = pulse('2026-01-01-some-other-plan.md', [
      slice('Fixes', 'eligible', [['feature/z', 'claimed']]),
    ]);
    expect(summariseFromPulse(m, p).claimed).toBeUndefined();
  });

  it('matches a plan by basename, since the pulse names it that way', () => {
    // meta.file is an absolute real path; the scan reports the basename it
    // resolved through docs/plans/active/. Joining on anything else silently
    // matches nothing — which would look exactly like the bug being fixed.
    const m = meta({
      file: '/somewhere/else/docs/plans/2026-08-16-board-reads-git.md',
      waves: [{
        name: 'Fixes',
        branches: [{ branch: 'feature/a', deferred: false, claimed: '' }],
      }],
    });
    const p = pulse('2026-08-16-board-reads-git.md', [
      slice('Fixes', 'eligible', [['feature/a', 'claimed']]),
    ]);
    expect(summariseFromPulse(m, p).claimed).toBe(1);
  });

  it('reports zero claimed when git says so — a real zero, not a missing one', () => {
    // The counterpart to the omission tests. With a pulse in hand, 0 is an
    // answer and must be present.
    const m = meta({
      waves: [{
        name: 'Fixes',
        branches: [{ branch: 'feature/a', deferred: false, claimed: '' }],
      }],
    });
    const p = pulse('2026-08-16-board-reads-git.md', [
      slice('Fixes', 'eligible', [['feature/a', 'open']]),
    ]);
    expect(summariseFromPulse(m, p).claimed).toBe(0);
  });
});

describe('summariseFromPulse — eligible means startable now', () => {
  const m = meta({
    waves: [
      { name: 'Tracer', branches: [{ branch: 'feature/a', deferred: false, claimed: '' }] },
      {
        name: 'Implementation',
        branches: [
          { branch: 'feature/b', deferred: false, claimed: '' },
          { branch: 'feature/c', deferred: false, claimed: '' },
        ],
      },
    ],
  });

  it('excludes open branches of a BLOCKED wave', () => {
    // Outstanding work, but not startable work. Counting it would tell someone
    // to begin a branch whose seam has not landed.
    const p = pulse('2026-08-16-board-reads-git.md', [
      slice('Tracer', 'eligible', [['feature/a', 'open']]),
      slice('Implementation', 'blocked', [['feature/b', 'open'], ['feature/c', 'open']]),
    ]);
    expect(summariseFromPulse(m, p).eligible).toBe(1);
  });

  it('does not count a claimed or merged branch as eligible', () => {
    // Someone already took it, or it already landed. Neither is startable, and
    // a branch must never be counted in both buckets.
    const p = pulse('2026-08-16-board-reads-git.md', [
      slice('Tracer', 'complete', [['feature/a', 'merged']]),
      slice('Implementation', 'eligible', [['feature/b', 'claimed'], ['feature/c', 'open']]),
    ]);
    const s = summariseFromPulse(m, p);
    expect(s.claimed).toBe(1);
    expect(s.eligible).toBe(1);
  });

  it('reports nothing eligible once every wave is complete', () => {
    const p = pulse('2026-08-16-board-reads-git.md', [
      slice('Tracer', 'complete', [['feature/a', 'merged']]),
      slice('Implementation', 'complete', [['feature/b', 'merged'], ['feature/c', 'merged']]),
    ]);
    expect(summariseFromPulse(m, p).eligible).toBe(0);
  });
});

describe('summariseFromPulse — shape comes from the plan', () => {
  it('excludes deferred branches from the branch count', () => {
    // Deferred work is not outstanding; counting it makes a finished plan look
    // unfinished.
    const m = meta({
      waves: [{
        name: 'Fixes',
        branches: [
          { branch: 'feature/a', deferred: false, claimed: '' },
          { branch: 'feature/gone', deferred: true, claimed: '' },
        ],
      }],
    });
    const s = summariseFromPulse(m, null);
    expect(s.branches).toBe(1);
    expect(s.deferred).toBe(1);
  });

  it('summarises a SINGLE-wave plan rather than skipping it', () => {
    // board.ts used to guard with `meta.waves.length > 1`, which withheld the
    // counts from every single-wave plan — i.e. from most of this repo, and
    // from precisely the plan that exposed the bug.
    const m = meta({
      waves: [{
        name: 'Fixes',
        branches: [{ branch: 'feature/a', deferred: false, claimed: '' }],
      }],
    });
    const p = pulse('2026-08-16-board-reads-git.md', [
      slice('Fixes', 'eligible', [['feature/a', 'claimed']]),
    ]);
    expect(summariseFromPulse(m, p)).toEqual({
      slices: 1, branches: 1, deferred: 0, claimed: 1, eligible: 0,
    });
  });
});

describe('worktreesFromPulse — where the work is checked out HERE', () => {
  // The path is collected by the scan anyway (`git worktree list --porcelain`
  // returns it beside the branch), and it answers a question the row cannot:
  // where is this on my machine. It belongs in the modal, and these tests are
  // about the one rule that keeps it honest — nothing is shown where the path
  // would not exist for the reader.

  const m = meta({
    waves: [{
      name: 'Fixes',
      branches: [
        { branch: 'bug/one', deferred: false, claimed: '' },
        { branch: 'bug/two', deferred: false, claimed: '' },
      ],
    }],
  });

  it('reports the path for every branch checked out on this machine', () => {
    const p = pulse('2026-08-16-board-reads-git.md', [
      slice('Fixes', 'eligible', [
        ['bug/one', 'wip', '/Users/x/wt-one'],
        ['bug/two', 'claimed', '/Users/x/wt-two'],
      ]),
    ]);
    expect(worktreesFromPulse(m, p)).toEqual([
      { branch: 'bug/one', path: '/Users/x/wt-one' },
      { branch: 'bug/two', path: '/Users/x/wt-two' },
    ]);
  });

  it('includes a CLEAN worktree — presence is evidence of location', () => {
    // The one place the clean/dirty distinction inverts. A clean checkout lifts
    // no group (it is not evidence of work) and still answers "where did I put
    // this" perfectly well.
    const p = pulse('2026-08-16-board-reads-git.md', [
      slice('Fixes', 'eligible', [['bug/one', 'wip', '/Users/x/wt-one']]),
    ]);
    expect(worktreesFromPulse(m, p)[0].path).toBe('/Users/x/wt-one');
  });

  it('reports nothing for a branch this machine does not have', () => {
    // The absent case, and the reason the field can exist at all: a path that
    // does not exist on the reader's machine is worse than no path. Every
    // detached worker and every teammate's laptop lands here.
    const p = pulse('2026-08-16-board-reads-git.md', [
      slice('Fixes', 'eligible', [['bug/one', 'wip'], ['bug/two', 'open']]),
    ]);
    expect(worktreesFromPulse(m, p)).toEqual([]);
  });

  it('reports nothing without a pulse, and nothing for an unknown plan', () => {
    // Same two degradations `summariseFromPulse` makes: a cold cache and a plan
    // the scan did not cover both mean "git has said nothing", not "no
    // worktrees".
    expect(worktreesFromPulse(m, null)).toEqual([]);
    const other = pulse('2026-01-01-some-other-plan.md', [
      slice('Fixes', 'eligible', [['bug/one', 'wip', '/Users/x/wt-one']]),
    ]);
    expect(worktreesFromPulse(m, other)).toEqual([]);
  });
});
