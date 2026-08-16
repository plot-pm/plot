import { describe, it, expect } from 'vitest';
import { summariseFromPulse } from '../../src/server/board.js';
import { PlanMetaSchema, type FleetPulse } from '../../src/contract/schema.js';

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

/** One wave, whatever branches it was given. */
const wave = (
  name: string,
  verdict: 'complete' | 'eligible' | 'blocked',
  branches: Array<[string, 'open' | 'wip' | 'merged' | 'claimed' | 'deferred']>,
) => ({
  name,
  verdict,
  branches: branches.map(([branch, state]) => ({
    branch, state, deferred: state === 'deferred', claimed: '',
  })),
});

const pulse = (file: string, waves: ReturnType<typeof wave>[]): FleetPulse => ({
  main: 'main',
  head: 'abc1234',
  plans: [{ file, waves }],
  summary: {
    plans: 1, waves: waves.length, branches: 0, claimed: 0,
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
      wave('Fixes', 'eligible', [
        ['bug/board-claimed-from-git', 'claimed'],
        ['bug/dispatch-records-started', 'open'],
      ]),
    ]);
    const s = summariseFromPulse(m, p);
    expect(s.claimed).toBe(1);
    // ...and the other branch is startable, which the card could not say at all
    // before: WaveSummary carried no `eligible`.
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
      wave('Fixes', 'eligible', [['feature/a', 'claimed']]),
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
    expect(s).toMatchObject({ waves: 1, branches: 1, deferred: 0 });
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
      wave('Fixes', 'eligible', [['feature/z', 'claimed']]),
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
      wave('Fixes', 'eligible', [['feature/a', 'claimed']]),
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
      wave('Fixes', 'eligible', [['feature/a', 'open']]),
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
      wave('Tracer', 'eligible', [['feature/a', 'open']]),
      wave('Implementation', 'blocked', [['feature/b', 'open'], ['feature/c', 'open']]),
    ]);
    expect(summariseFromPulse(m, p).eligible).toBe(1);
  });

  it('does not count a claimed or merged branch as eligible', () => {
    // Someone already took it, or it already landed. Neither is startable, and
    // a branch must never be counted in both buckets.
    const p = pulse('2026-08-16-board-reads-git.md', [
      wave('Tracer', 'complete', [['feature/a', 'merged']]),
      wave('Implementation', 'eligible', [['feature/b', 'claimed'], ['feature/c', 'open']]),
    ]);
    const s = summariseFromPulse(m, p);
    expect(s.claimed).toBe(1);
    expect(s.eligible).toBe(1);
  });

  it('reports nothing eligible once every wave is complete', () => {
    const p = pulse('2026-08-16-board-reads-git.md', [
      wave('Tracer', 'complete', [['feature/a', 'merged']]),
      wave('Implementation', 'complete', [['feature/b', 'merged'], ['feature/c', 'merged']]),
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
      wave('Fixes', 'eligible', [['feature/a', 'claimed']]),
    ]);
    expect(summariseFromPulse(m, p)).toEqual({
      waves: 1, branches: 1, deferred: 0, claimed: 1, eligible: 0,
    });
  });
});
