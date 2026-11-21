import { describe, expect, it } from 'vitest';

import type { PrIndexRow } from '../src/entities/pr-index.js';
import type { Sprint } from '../src/entities/sprint.js';
import { defaultBranchRed } from '../src/rules/default-branch.js';
import type { DefaultBranchReading } from '../src/entities/default-branch.js';
import type { RepairMergeReading } from '../src/rules/repair-pr.js';
import type { FixerAttemptsRecord } from '../src/entities/fixer-attempts.js';
import { fixerReadingOf } from '../src/rules/fixer-attempts.js';
import { ciRedArm, conflictArm, fixerPrNext, highArm, mergeArm, nextMerge, restatusArm, reviewArm, slicePrNext, type SlicePrNextReadings } from '../src/rules/slice-pr-next.js';

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const NOW = Date.parse('2026-10-30T12:00:00Z');
const BRANCH = 'feature/x';

/**
 * The writer check's judgment the index would hold for a rollup that reads
 * `success` or `failure` on the head. A test names `plotReviewJudged` itself,
 * or `undefined` to model a row no pass has judged.
 */
const judged = (r: PrIndexRow, over: Partial<PrIndexRow>): PrIndexRow =>
  'plotReviewJudged' in over || (r.plotReview !== 'success' && r.plotReview !== 'failure') || r.plotReviewSha === undefined
    ? r
    : { ...r, plotReviewJudged: r.plotReview, plotReviewCheckedSha: r.headSha, plotReviewCheckedAt: r.plotReviewAt };

const row = (over: Partial<PrIndexRow> = {}): PrIndexRow => judged({
  number: 7,
  head: BRANCH,
  state: 'OPEN',
  draft: false,
  checks: 'green',
  review: '',
  url: 'u',
  headSha: HEAD,
  checksSha: HEAD,
  ciChecks: 'green',
  plotReview: 'absent',
  ...over,
}, over);

const readings = (over: Partial<SlicePrNextReadings> = {}): SlicePrNextReadings => ({
  row: row(),
  newestMerged: null,
  scope: { read: 'scope', sprint: {} as Sprint, slugs: ['x'], branches: [BRANCH] },
  reviewRun: null,
  reviewStarts: null,
  verdict: { read: 'absent' },
  defaultBranch: null,
  desk: { dead: false, why: 'live' },
  backend: 'github',
  mergerApp: { read: 'usable' },
  config: { autoReview: true, reviewBoundMs: 3_600_000, startBudget: 3, checksWaitMs: 3_600_000 },
  now: NOW,
  ...over,
});

describe('slicePrNext', () => {
  it('answers none for a null store', () => {
    expect(slicePrNext(readings({ row: null }))).toEqual({ step: 'none', why: 'no-row' });
  });

  it('answers none for a draft, a closed PR, no scope and a branch out of scope', () => {
    expect(slicePrNext(readings({ row: row({ draft: true }) }))).toMatchObject({ step: 'none', why: 'draft' });
    expect(slicePrNext(readings({ row: row({ state: 'MERGED' }) }))).toMatchObject({ why: 'not-open' });
    expect(slicePrNext(readings({ scope: { read: 'none', why: 'no-active-sprint' } }))).toMatchObject({
      step: 'none',
      why: 'scope-no-active-sprint',
    });
    expect(slicePrNext(readings({ row: row({ head: 'feature/other' }) }))).toMatchObject({ why: 'out-of-scope' });
  });

  it('answers none for a row with no plotReview field: the index never says no', () => {
    const { plotReview: _, ...bare } = row();
    expect(slicePrNext(readings({ row: bare }))).toEqual({ step: 'none', why: 'not-asked' });
  });

  it('reviews a green head whose review is absent', () => {
    expect(slicePrNext(readings())).toEqual({ step: 'review', head: HEAD });
  });

  it('acts on a slice PR into a sprint branch: green selects the review, failing selects the fixer', () => {
    // The row carries no base branch; the sprint scope names the head, so the arms read only the rollup.
    const sprintScope = { read: 'scope', sprint: {} as Sprint, slugs: ['x'], branches: ['infra/sprint-slice'] } as const;
    const fixerFresh = { read: 'record', inFlight: false, highExhausted: false, ciExhausted: false, conflictExhausted: false, conflictTried: false, pushedHead: false } as const;
    const green = row({ head: 'infra/sprint-slice', ciChecks: 'green' });
    expect(reviewArm(readings({ row: green, scope: sprintScope }))).toEqual({ step: 'review', head: HEAD });
    const failing = row({ head: 'infra/sprint-slice', ciChecks: 'failing', checksSha: HEAD });
    expect(
      ciRedArm(readings({ row: failing, scope: sprintScope, fixer: fixerFresh, desk: { dead: true } })),
    ).toEqual({ step: 'fixer', head: HEAD, evidence: 'ci-red' });
  });

  it('reviews a head when the review names an older SHA', () => {
    const r = row({ plotReview: 'success', plotReviewSha: OLD });
    expect(slicePrNext(readings({ row: r }))).toEqual({ step: 'review', head: HEAD });
  });

  it('does not review a head that holds a review on it', () => {
    const r = row({ plotReview: 'success', plotReviewSha: HEAD });
    // With no default-branch reading the merge arm holds, so a passed head no longer ends at `reviewed`.
    expect(slicePrNext(readings({ row: r }))).toEqual({ step: 'hold', reason: 'default-branch-unread' });
  });

  it('holds on a live review run', () => {
    const reviewRun = { head: HEAD, pid: 1, startedAt: NOW, live: true };
    expect(slicePrNext(readings({ reviewRun }))).toEqual({ step: 'hold', reason: 'review-in-flight' });
  });

  it('does not hold on a live run for an older head', () => {
    const reviewRun = { head: OLD, pid: 1, startedAt: NOW, live: true };
    expect(slicePrNext(readings({ reviewRun }))).toEqual({ step: 'review', head: HEAD });
  });

  it('answers none for a fresh pending and reviews a pending past the bound', () => {
    const fresh = row({ plotReview: 'pending', plotReviewSha: HEAD, plotReviewAt: new Date(NOW - 60_000).toISOString() });
    expect(slicePrNext(readings({ row: fresh }))).toMatchObject({ step: 'none', why: 'reviewed' });
    const stale = row({ plotReview: 'pending', plotReviewSha: HEAD, plotReviewAt: new Date(NOW - 3_700_000).toISOString() });
    expect(slicePrNext(readings({ row: stale }))).toEqual({ step: 'review', head: HEAD });
  });

  it('answers none with the budget spent, and with the backoff before the next start', () => {
    const spent = { head: HEAD, count: 3, lastAt: NOW - 10 * 3_600_000 };
    expect(slicePrNext(readings({ reviewStarts: spent }))).toEqual({ step: 'none', why: 'budget-spent' });
    const soon = { head: HEAD, count: 1, lastAt: NOW - 14 * 60_000 };
    expect(slicePrNext(readings({ reviewStarts: soon }))).toEqual({ step: 'none', why: 'backoff' });
    const later = { head: HEAD, count: 1, lastAt: NOW - 16 * 60_000 };
    expect(slicePrNext(readings({ reviewStarts: later }))).toEqual({ step: 'review', head: HEAD });
    const second = { head: HEAD, count: 2, lastAt: NOW - 30 * 60_000 };
    expect(slicePrNext(readings({ reviewStarts: second }))).toEqual({ step: 'none', why: 'backoff' });
  });

  it('counts starts per head: a record for an older head allows a start', () => {
    const old = { head: OLD, count: 3, lastAt: NOW };
    expect(slicePrNext(readings({ reviewStarts: old }))).toEqual({ step: 'review', head: HEAD });
  });

  it('answers none with Auto-review off', () => {
    const config = { autoReview: false, reviewBoundMs: 1, startBudget: 3, checksWaitMs: 1 };
    expect(slicePrNext(readings({ config }))).toEqual({ step: 'none', why: 'auto-review-off' });
  });

  it('answers none when the checks are not bound to the head or not green', () => {
    expect(slicePrNext(readings({ row: row({ checksSha: OLD }) }))).toMatchObject({ why: 'checks-unbound' });
    expect(slicePrNext(readings({ row: row({ ciChecks: 'pending' }) }))).toMatchObject({ why: 'ci-not-green' });
  });

  it('still reviews on a red default branch', () => {
    const defaultBranch = { v: 1, askedAt: new Date(NOW).toISOString(), sha: HEAD, state: 'red' } as never;
    expect(slicePrNext(readings({ defaultBranch }))).toEqual({ step: 'review', head: HEAD });
  });

  it('writes the status of a verdict file the index does not reflect', () => {
    const verdict = { read: 'verdict', state: 'failure', description: 'HIGH 1' } as const;
    expect(slicePrNext(readings({ verdict }))).toEqual({
      step: 'write-status',
      head: HEAD,
      state: 'failure',
      description: 'HIGH 1',
      why: 'verdict-unwritten',
    });
  });

  it('writes nothing when the index already reflects the verdict', () => {
    const verdict = { read: 'verdict', state: 'success', description: 'ok' } as const;
    const r = row({ plotReview: 'success', plotReviewSha: HEAD });
    expect(slicePrNext(readings({ verdict, row: r }))).toEqual({ step: 'hold', reason: 'default-branch-unread' });
  });

  it('holds on an unreadable verdict file', () => {
    expect(slicePrNext(readings({ verdict: { read: 'unread' } }))).toEqual({ step: 'hold', reason: 'unread' });
  });

  it('holds on a live fixer mark over an otherwise green new head, before the review arm', () => {
    const fixer = { read: 'record', inFlight: true, highExhausted: false, ciExhausted: false, conflictExhausted: false, conflictTried: false, pushedHead: false } as const;
    expect(slicePrNext(readings({ fixer }))).toEqual({ step: 'hold', reason: 'fixer-in-flight' });
    expect(slicePrNext(readings({ fixer: { read: 'record', inFlight: false, highExhausted: false, ciExhausted: false, conflictExhausted: false, conflictTried: false, pushedHead: false } }))).toEqual({
      step: 'review',
      head: HEAD,
    });
  });

  it('holds on an unread sibling record', () => {
    expect(slicePrNext(readings({ fixer: { read: 'unread' } }))).toEqual({ step: 'hold', reason: 'unread' });
    expect(slicePrNext(readings({ ticket: { read: 'unread' } }))).toEqual({ step: 'hold', reason: 'unread' });
  });

  it('holds on a live run of the head before it writes a status', () => {
    const reviewRun = { head: HEAD, pid: 1, startedAt: NOW, live: true };
    const verdict = { read: 'verdict', state: 'success', description: 'ok' } as const;
    expect(slicePrNext(readings({ reviewRun, verdict }))).toEqual({ step: 'hold', reason: 'review-in-flight' });
  });

  it('answers none for a verdict with no headSha or plotReview to match against', () => {
    const verdict = { read: 'verdict', state: 'success', description: 'ok' } as const;
    const { headSha: _h, ...noHeadSha } = row();
    expect(slicePrNext(readings({ verdict, row: noHeadSha }))).toEqual({ step: 'none', why: 'not-asked' });
    const { plotReview: _p, ...noPlotReview } = row();
    expect(slicePrNext(readings({ verdict, row: noPlotReview }))).toEqual({ step: 'none', why: 'not-asked' });
  });

  it('holds on an unread repair record once every earlier arm answers none', () => {
    const config = { autoReview: false, reviewBoundMs: 1, startBudget: 3, checksWaitMs: 1 };
    expect(slicePrNext(readings({ repair: { read: 'unread' }, config }))).toEqual({ step: 'hold', reason: 'unread' });
  });

  describe('the re-status arm gates', () => {
    const verdict = { read: 'verdict', state: 'failure', description: 'HIGH 1' } as const;

    it('answers none with Auto-review off and with the budget spent', () => {
      const off = { autoReview: false, reviewBoundMs: 1, startBudget: 3, checksWaitMs: 1 };
      expect(slicePrNext(readings({ verdict, config: off }))).toEqual({ step: 'none', why: 'auto-review-off' });
      const spent = { head: HEAD, count: 3, lastAt: NOW };
      expect(slicePrNext(readings({ verdict, reviewStarts: spent }))).toMatchObject({ step: 'none', why: 'budget-spent' });
      expect(restatusArm(readings({ verdict, reviewStarts: spent }))).toEqual({ step: 'none', why: 'budget-spent' });
    });
  });

  describe('arm order with a real verdict reading', () => {
    it("the HIGH arm's accepted success survives a failure verdict file", () => {
      const r = row({ plotReview: 'failure', plotReviewSha: HEAD });
      const fixer = { read: 'record', inFlight: false, highExhausted: true, ciExhausted: false, conflictExhausted: false, conflictTried: false, pushedHead: false } as const;
      const ticket = { read: 'record', ticket: 'opened', id: '#9', coversHead: true } as const;
      const verdict = { read: 'verdict', state: 'failure', description: 'HIGH 1' } as const;
      expect(slicePrNext(readings({ row: r, fixer, ticket, verdict }))).toEqual({
        step: 'write-status',
        head: HEAD,
        state: 'success',
        description: 'ticketed #9',
        why: 'ticket-accepted',
      });
    });
  });

  describe('the HIGH arm (#2903)', () => {
    it('starts the fixer for a HIGH after two CI-red attempts', () => {
      const r = row({ plotReview: 'failure', plotReviewSha: HEAD });
      const fixer = { read: 'record', inFlight: false, highExhausted: false, ciExhausted: true, conflictExhausted: false, conflictTried: false, pushedHead: false } as const;
      expect(highArm(readings({ row: r, fixer }))).toEqual({ step: 'fixer', head: HEAD, evidence: 'high' });
    });

    const fixerFresh = { read: 'record', inFlight: false, highExhausted: false, ciExhausted: false, conflictExhausted: false, conflictTried: false, pushedHead: false } as const;

    it('starts the fixer for a HIGH bound to the current head', () => {
      const r = row({ plotReview: 'failure', plotReviewSha: HEAD });
      expect(slicePrNext(readings({ row: r, fixer: fixerFresh }))).toEqual({
        step: 'fixer',
        head: HEAD,
        evidence: 'high',
      });
      expect(highArm(readings({ row: r, fixer: fixerFresh }))).toEqual({ step: 'fixer', head: HEAD, evidence: 'high' });
    });

    it('does not trigger on a HIGH recorded against a since-moved head', () => {
      const r = row({ plotReview: 'failure', plotReviewSha: OLD });
      expect(highArm(readings({ row: r, fixer: fixerFresh }))).toEqual({ step: 'none', why: 'no-high' });
    });

    describe('with the attempts spent', () => {
      const r = row({ plotReview: 'failure', plotReviewSha: HEAD });
      const fixer = { read: 'record', inFlight: false, highExhausted: true, ciExhausted: true, conflictExhausted: false, conflictTried: false, pushedHead: false } as const;
      const none = { read: 'record', ticket: 'none' } as const;

      it('asks for a ticket where none is recorded', () => {
        expect(highArm(readings({ row: r, fixer, ticket: none }))).toEqual({ step: 'ticket', head: HEAD });
      });

      it('holds on a pending record, neither opening a second ticket nor writing success', () => {
        expect(highArm(readings({ row: r, fixer, ticket: { read: 'record', ticket: 'pending' } }))).toEqual({
          step: 'hold',
          reason: 'ticket-pending',
        });
      });

      it('holds while the ticket record is unread', () => {
        expect(highArm(readings({ row: r, fixer, ticket: { read: 'unread' } }))).toEqual({ step: 'hold', reason: 'unread' });
      });

      it('asks for the findings of a later head to reach the open ticket', () => {
        const ticket = { read: 'record', ticket: 'opened', id: '#9', coversHead: false } as const;
        expect(highArm(readings({ row: r, fixer, ticket }))).toEqual({ step: 'ticket', head: HEAD });
      });

      it('writes the accepted success where the ticket carries this head', () => {
        const ticket = { read: 'record', ticket: 'opened', id: '#9', coversHead: true } as const;
        expect(highArm(readings({ row: r, fixer, ticket }))).toEqual({
          step: 'write-status',
          head: HEAD,
          state: 'success',
          description: 'ticketed #9',
          why: 'ticket-accepted',
        });
      });

      it('answers none once the head carries an accepted success, leaving the merge to its arm', () => {
        const done = row({ plotReview: 'success', plotReviewSha: HEAD });
        const ticket = { read: 'record', ticket: 'opened', id: '#9', coversHead: true } as const;
        expect(highArm(readings({ row: done, fixer, ticket }))).toEqual({ step: 'none', why: 'no-high' });
      });

      it('answers none where the ticket arm is not built', () => {
        expect(highArm(readings({ row: r, fixer }))).toEqual({ step: 'none', why: 'ticket-not-built' });
      });
    });

    it('answers none for a row never asked about plotReview', () => {
      const { plotReview: _p, ...noPlotReview } = row();
      expect(highArm(readings({ row: noPlotReview, fixer: fixerFresh }))).toEqual({ step: 'none', why: 'not-asked' });
    });

    it('holds while the fixer record is unread', () => {
      const r = row({ plotReview: 'failure', plotReviewSha: HEAD });
      expect(highArm(readings({ row: r, fixer: { read: 'unread' } }))).toEqual({ step: 'hold', reason: 'unread' });
    });

    it('answers none for no row and for a row with no head', () => {
      const { headSha: _h, ...noHead } = row({ plotReview: 'failure' });
      expect(highArm(readings({ row: null, fixer: fixerFresh }))).toEqual({ step: 'none', why: 'not-asked' });
      expect(highArm(readings({ row: noHead, fixer: fixerFresh }))).toEqual({ step: 'none', why: 'not-asked' });
    });
  });

  describe('the CI-red arm (#2903)', () => {
    const fixerFresh = { read: 'record', inFlight: false, highExhausted: false, ciExhausted: false, conflictExhausted: false, conflictTried: false, pushedHead: false } as const;
    const ciRedRow = row({ ciChecks: 'failing', checksSha: HEAD });

    it('starts the fixer once the desk is dead', () => {
      const desk = { dead: true } as const;
      expect(slicePrNext(readings({ row: ciRedRow, fixer: fixerFresh, desk }))).toEqual({
        step: 'fixer',
        head: HEAD,
        evidence: 'ci-red',
      });
      expect(ciRedArm(readings({ row: ciRedRow, fixer: fixerFresh, desk }))).toEqual({
        step: 'fixer',
        head: HEAD,
        evidence: 'ci-red',
      });
    });

    it('starts the fixer on a corrections-spent desk whose fresh session also ended, even though deskDead reads it waiting', () => {
      const desk = { dead: false, why: 'waiting' } as const;
      expect(
        slicePrNext(readings({ row: ciRedRow, fixer: fixerFresh, desk, correctionsSpentExhausted: true })),
      ).toEqual({ step: 'fixer', head: HEAD, evidence: 'ci-red' });
    });

    it('does not start the fixer on a desk merely waiting for any other reason', () => {
      const desk = { dead: false, why: 'waiting' } as const;
      expect(ciRedArm(readings({ row: ciRedRow, fixer: fixerFresh, desk }))).toEqual({ step: 'none', why: 'desk-alive' });
      expect(
        ciRedArm(readings({ row: ciRedRow, fixer: fixerFresh, desk, correctionsSpentExhausted: false })),
      ).toEqual({ step: 'none', why: 'desk-alive' });
    });

    it('starts the fixer on a red head the fixer record proves fixer-pushed', () => {
      const fixer = { read: 'record', inFlight: false, highExhausted: false, ciExhausted: false, conflictExhausted: false, conflictTried: false, pushedHead: true } as const;
      for (const why of ['elsewhere', 'live'] as const) {
        expect(ciRedArm(readings({ row: ciRedRow, fixer, desk: { dead: false, why } }))).toEqual({
          step: 'fixer',
          head: HEAD,
          evidence: 'ci-red',
        });
      }
    });

    it("answers none('desk-alive') for a red head the desk pushed while the desk reads elsewhere", () => {
      const desk = { dead: false, why: 'elsewhere' } as const;
      expect(ciRedArm(readings({ row: ciRedRow, fixer: fixerFresh, desk }))).toEqual({ step: 'none', why: 'desk-alive' });
    });

    it('does not start the fixer on a live desk', () => {
      const desk = { dead: false, why: 'live' } as const;
      expect(ciRedArm(readings({ row: ciRedRow, fixer: fixerFresh, desk }))).toEqual({ step: 'none', why: 'desk-alive' });
    });

    it('holds once the attempts budget is spent on a dead desk with CI still red', () => {
      const desk = { dead: true } as const;
      const fixer = { read: 'record', inFlight: false, highExhausted: true, ciExhausted: true, conflictExhausted: false, conflictTried: false, pushedHead: false } as const;
      expect(slicePrNext(readings({ row: ciRedRow, fixer, desk }))).toEqual({ step: 'hold', reason: 'ci-red-attempts-spent' });
    });

    it('does not trigger on CI red bound to a since-moved head', () => {
      const r = row({ ciChecks: 'failing', checksSha: OLD });
      const desk = { dead: true } as const;
      expect(ciRedArm(readings({ row: r, fixer: fixerFresh, desk }))).toEqual({ step: 'none', why: 'no-ci-red' });
    });

    it('answers none for a row never asked about ciChecks', () => {
      const { ciChecks: _c, ...noCiChecks } = row();
      const desk = { dead: true } as const;
      expect(ciRedArm(readings({ row: noCiChecks, fixer: fixerFresh, desk }))).toEqual({ step: 'none', why: 'not-asked' });
    });

    it('holds while the fixer record is unread', () => {
      const r = row({ ciChecks: 'failing' });
      const desk = { dead: true } as const;
      expect(ciRedArm(readings({ row: r, fixer: { read: 'unread' }, desk }))).toEqual({ step: 'hold', reason: 'unread' });
    });

    it('answers none for no row and for a row with no head', () => {
      const desk = { dead: true } as const;
      const { headSha: _h, ...noHead } = row({ ciChecks: 'failing' });
      expect(ciRedArm(readings({ row: null, fixer: fixerFresh, desk }))).toEqual({ step: 'none', why: 'not-asked' });
      expect(ciRedArm(readings({ row: noHead, fixer: fixerFresh, desk }))).toEqual({ step: 'none', why: 'not-asked' });
    });
  });
});

describe('the conflict arm', () => {
  const TIP = 'c'.repeat(40);
  const fresh = { read: 'record', inFlight: false, highExhausted: false, ciExhausted: false, conflictExhausted: false, conflictTried: false, pushedHead: false } as const;
  const conflicting = row({ mergeable: 'conflicting' });
  const dead = { dead: true } as const;
  const tip = { read: 'tip', sha: TIP } as const;

  it('answers none on a row that is not conflicting', () => {
    for (const mergeable of ['mergeable', 'unknown', 'CONFLICTING', undefined]) {
      expect(conflictArm(readings({ row: row({ mergeable }), fixer: fresh, desk: dead, baseTip: tip }))).toEqual({ step: 'none', why: 'no-conflict' });
    }
  });

  it('answers none with no row, with no head, and before the fixer is built', () => {
    const { headSha: _head, ...headless } = conflicting;
    expect(conflictArm(readings({ row: null, fixer: fresh, desk: dead, baseTip: tip }))).toEqual({ step: 'none', why: 'no-conflict' });
    expect(conflictArm(readings({ row: headless, fixer: fresh, desk: dead, baseTip: tip }))).toEqual({ step: 'none', why: 'no-conflict' });
    expect(conflictArm(readings({ row: conflicting, desk: dead, baseTip: tip }))).toEqual({ step: 'none', why: 'fixer-not-built' });
  });

  it('holds unread on an unread fixer record, an unread base tip, or no base tip', () => {
    expect(conflictArm(readings({ row: conflicting, fixer: { read: 'unread' }, desk: dead, baseTip: tip }))).toEqual({ step: 'hold', reason: 'unread' });
    expect(conflictArm(readings({ row: conflicting, fixer: fresh, desk: dead, baseTip: { read: 'unread' } }))).toEqual({ step: 'hold', reason: 'unread' });
    expect(conflictArm(readings({ row: conflicting, fixer: fresh, desk: dead }))).toEqual({ step: 'hold', reason: 'unread' });
  });

  it('holds conflict-attempted where this head and base tip had an attempt', () => {
    expect(conflictArm(readings({ row: conflicting, fixer: { ...fresh, conflictTried: true }, desk: dead, baseTip: tip }))).toEqual({
      step: 'hold',
      reason: 'conflict-attempted',
    });
  });

  it('holds conflict-attempts-spent once the conflict budget is spent', () => {
    expect(conflictArm(readings({ row: conflicting, fixer: { ...fresh, conflictExhausted: true }, desk: dead, baseTip: tip }))).toEqual({
      step: 'hold',
      reason: 'conflict-attempts-spent',
    });
  });

  it("answers none('desk-alive') for a desk that is not gone", () => {
    expect(conflictArm(readings({ row: conflicting, fixer: fresh, desk: { dead: false, why: 'live' }, baseTip: tip }))).toEqual({
      step: 'none',
      why: 'desk-alive',
    });
  });

  it('starts the fixer with conflict evidence once the desk is gone', () => {
    expect(conflictArm(readings({ row: conflicting, fixer: fresh, desk: dead, baseTip: tip }))).toEqual({ step: 'fixer', head: HEAD, evidence: 'conflict' });
    expect(conflictArm(readings({ row: conflicting, fixer: { ...fresh, pushedHead: true }, desk: { dead: false, why: 'live' }, baseTip: tip }))).toEqual({
      step: 'fixer',
      head: HEAD,
      evidence: 'conflict',
    });
  });

  it('answers conflict, not ci-red, through fixerPrNext on a conflicting row with red CI', () => {
    const red = row({ base: 'main', mergeable: 'conflicting', ciChecks: 'failing', checksSha: HEAD, headSince: new Date(NOW - 7_200_000).toISOString() });
    const { scope: _s, ...rest } = readings({ row: red, fixer: fresh, desk: dead, baseTip: tip, defaultBranchName: 'main' });
    expect(fixerPrNext({ ...rest, owner: 'none' })).toEqual({ step: 'fixer', head: HEAD, evidence: 'conflict' });
  });

  describe('one attempt per head and base tip, two per PR', () => {
    const OTHER_TIP = 'd'.repeat(40);
    const THIRD_TIP = 'e'.repeat(40);
    const attempt = (baseTip: string) => ({ headSha: HEAD, finding: { kind: 'conflict', head: HEAD, baseTip } }) as const;
    const record = (...tips: string[]): FixerAttemptsRecord => ({ v: 1, pr: 7, attempts: tips.map(attempt) });
    const step = (r: FixerAttemptsRecord | 'none', sha: string) =>
      conflictArm(readings({ row: conflicting, fixer: fixerReadingOf(r, HEAD, sha), desk: dead, baseTip: { read: 'tip', sha } }));

    it('starts the first attempt', () => {
      expect(step('none', TIP)).toEqual({ step: 'fixer', head: HEAD, evidence: 'conflict' });
    });

    it('holds a second conflict on the same head and base tip', () => {
      expect(step(record(TIP), TIP)).toEqual({ step: 'hold', reason: 'conflict-attempted' });
    });

    it('starts a second attempt once the base tip moved', () => {
      expect(step(record(TIP), OTHER_TIP)).toEqual({ step: 'fixer', head: HEAD, evidence: 'conflict' });
    });

    it('holds a third as spent', () => {
      expect(step(record(TIP, OTHER_TIP), THIRD_TIP)).toEqual({ step: 'hold', reason: 'conflict-attempts-spent' });
    });
  });
});

describe('the merge arm', () => {
  const TIP = 'c'.repeat(40);
  const reading = (over: Partial<DefaultBranchReading> = {}): DefaultBranchReading => ({
    v: 1,
    branch: 'main',
    headSha: TIP,
    head: 'green',
    settled: { sha: TIP, state: 'green' },
    failingRuns: [],
    headSince: '2026-10-30T11:00:00Z',
    askedAt: '2026-10-30T11:55:00Z',
    at: '2026-10-30T11:55:00Z',
    ...over,
  });
  const passed = row({ plotReview: 'success', plotReviewSha: HEAD });
  const merging = (over: Partial<SlicePrNextReadings> = {}) =>
    slicePrNext(readings({ row: passed, defaultBranch: reading(), ...over }));

  it('merges a passed review on the head against a settled green reading', () => {
    expect(merging()).toEqual({ step: 'merge', head: HEAD });
  });

  it('answers none for a review not on the head, and for a row never asked', () => {
    expect(merging({ row: row({ plotReview: 'success', plotReviewSha: OLD }) })).toEqual({ step: 'review', head: HEAD });
    expect(merging({ row: row({ plotReview: 'failure', plotReviewSha: HEAD }) })).toMatchObject({ step: 'none' });
    const { plotReview: _, ...bare } = row();
    expect(merging({ row: bare })).toMatchObject({ step: 'none' });
  });

  it('holds default-branch-unread with no reading', () => {
    expect(merging({ defaultBranch: null })).toEqual({ step: 'hold', reason: 'default-branch-unread' });
  });

  it('holds default-branch-red on a fresh settled red', () => {
    const red = reading({ settled: { sha: TIP, state: 'red' } });
    expect(merging({ defaultBranch: red })).toEqual({ step: 'hold', reason: 'default-branch-red' });
  });

  it.each(['pending', 'unknown'] as const)('holds default-branch-red while a re-run of the red head reads %s', (head) => {
    const rerun = reading({ head, settled: { sha: TIP, state: 'red' } });
    expect(merging({ defaultBranch: rerun })).toEqual({ step: 'hold', reason: 'default-branch-red' });
  });

  it('holds default-branch-stale where defaultBranchRed lifts its own hold on the same reading', () => {
    const old = reading({ settled: { sha: TIP, state: 'red' }, askedAt: '2026-10-30T09:00:00Z' });
    expect(defaultBranchRed(old, NOW, 3_600_000)).toBe(false);
    expect(merging({ defaultBranch: old })).toEqual({ step: 'hold', reason: 'default-branch-stale' });
    const oldGreen = reading({ askedAt: '2026-10-30T09:00:00Z' });
    expect(merging({ defaultBranch: oldGreen })).toEqual({ step: 'hold', reason: 'default-branch-stale' });
    expect(merging({ defaultBranch: reading({ askedAt: 'never' }) })).toEqual({ step: 'hold', reason: 'default-branch-stale' });
  });

  it('holds default-branch-unsettled for a settled state that is not green', () => {
    expect(merging({ defaultBranch: reading({ settled: { sha: TIP, state: 'pending' } }) })).toEqual({
      step: 'hold',
      reason: 'default-branch-unsettled',
    });
    expect(merging({ defaultBranch: reading({ settled: undefined }) })).toMatchObject({ reason: 'default-branch-unsettled' });
  });

  it('holds merge-in-flight where the settled commit is not the head', () => {
    expect(merging({ defaultBranch: reading({ headSha: 'd'.repeat(40) }) })).toEqual({
      step: 'hold',
      reason: 'merge-in-flight',
    });
  });

  describe('a head past the settled commit by Plot commits only', () => {
    const NEWER = 'd'.repeat(40);
    const SET = ['docs/plans/', 'skills/plot/scripts/board/x.mjs'];
    const trailing = (files: readonly string[] | 'unknown', over: Partial<SlicePrNextReadings> = {}) =>
      merging({
        defaultBranch: reading({ headSha: NEWER }),
        pathSet: SET,
        unsettled: { headSha: NEWER, commits: [{ sha: NEWER, files }] },
        ...over,
      });

    it('merges where every commit past the settled one lies in the set', () => {
      expect(trailing(['docs/plans/p.md'])).toEqual({ step: 'merge', head: HEAD });
      expect(
        merging({
          defaultBranch: reading({ headSha: NEWER }),
          pathSet: SET,
          unsettled: { headSha: NEWER, commits: [{ sha: NEWER, files: ['skills/plot/scripts/board/x.mjs'] }, { sha: 'e'.repeat(40), files: ['docs/plans/p.md'] }] },
        }),
      ).toEqual({ step: 'merge', head: HEAD });
    });

    it('holds merge-in-flight for one code commit, an unread diff and an absent reading', () => {
      expect(trailing(['docs/plans/p.md', 'packages/a.ts'])).toEqual({ step: 'hold', reason: 'merge-in-flight' });
      expect(trailing('unknown')).toEqual({ step: 'hold', reason: 'merge-in-flight' });
      expect(trailing(['docs/plans/p.md'], { unsettled: undefined })).toEqual({ step: 'hold', reason: 'merge-in-flight' });
      expect(trailing(['docs/plans/p.md'], { unsettled: 'unread' })).toEqual({ step: 'hold', reason: 'merge-in-flight' });
    });

    it('holds merge-in-flight where the line ends at another head than the reading', () => {
      expect(trailing(['docs/plans/p.md'], { unsettled: { headSha: 'f'.repeat(40), commits: [{ sha: 'f'.repeat(40), files: ['docs/plans/p.md'] }] } })).toEqual({
        step: 'hold',
        reason: 'merge-in-flight',
      });
    });

    it('still holds a pending settled state', () => {
      expect(trailing(['docs/plans/p.md'], { defaultBranch: reading({ headSha: NEWER, settled: { sha: TIP, state: 'pending' } }) })).toEqual({
        step: 'hold',
        reason: 'default-branch-unsettled',
      });
    });

    it('still holds a red settled state', () => {
      expect(trailing(['docs/plans/p.md'], { defaultBranch: reading({ headSha: NEWER, settled: { sha: TIP, state: 'red' } }) })).toEqual({
        step: 'hold',
        reason: 'default-branch-red',
      });
    });

    it('keeps the newest-merged check', () => {
      expect(trailing(['docs/plans/p.md'], { newestMerged: { mergedAt: '2026-10-30T11:58:00Z' } })).toEqual({ step: 'hold', reason: 'merge-in-flight' });
    });
  });

  it('holds merge-in-flight where a merged row is newer than the reading, though the reading looks settled', () => {
    expect(merging({ newestMerged: { mergedAt: '2026-10-30T11:58:00Z' } })).toEqual({
      step: 'hold',
      reason: 'merge-in-flight',
    });
    expect(merging({ newestMerged: { mergedAt: 'garbled' } })).toMatchObject({ reason: 'merge-in-flight' });
    expect(merging({ newestMerged: { mergedAt: '2026-10-30T11:50:00Z' } })).toMatchObject({ step: 'merge' });
  });

  it('holds conflicting', () => {
    expect(merging({ row: { ...passed, mergeable: 'conflicting' } })).toEqual({ step: 'hold', reason: 'conflicting' });
  });

  it('holds merger-app-missing for an absent key on GitHub', () => {
    expect(merging({ backend: 'github', mergerApp: { read: 'absent' } })).toEqual({ step: 'hold', reason: 'merger-app-missing' });
  });

  it('holds merger-app-invalid for an invalid key on GitHub', () => {
    expect(merging({ backend: 'github', mergerApp: { read: 'invalid', reason: 'malformed' } })).toEqual({
      step: 'hold',
      reason: 'merger-app-invalid',
    });
  });

  it('holds merger-app-unread with no reading on GitHub', () => {
    const { mergerApp: _, ...noReading } = readings();
    expect(slicePrNext({ ...noReading, row: passed, defaultBranch: reading() })).toEqual({
      step: 'hold',
      reason: 'merger-app-unread',
    });
  });

  it('merges with a usable key on GitHub', () => {
    expect(merging({ backend: 'github', mergerApp: { read: 'usable' } })).toMatchObject({ step: 'merge' });
  });

  describe('the base hold', () => {
    const SPRINT = 'sprint/x';
    const red = reading({ settled: { sha: TIP, state: 'red' }, head: 'red' });
    const baseRed = (over: Partial<DefaultBranchReading> = {}): DefaultBranchReading =>
      reading({ branch: SPRINT, settled: { sha: TIP, state: 'red' }, head: 'red', ...over });
    const sprintRow = { ...passed, base: SPRINT };
    const into = (over: Partial<SlicePrNextReadings> = {}) =>
      merging({ row: sprintRow, defaultBranch: red, defaultBranchName: 'main', ...over });

    it('merges a sprint PR on a red main with no base reading', () => {
      expect(into()).toEqual({ step: 'merge', head: HEAD });
    });
    it('holds a PR into main on a fresh settled red, and a row with no base', () => {
      expect(into({ row: { ...passed, base: 'main' } })).toEqual({ step: 'hold', reason: 'default-branch-red' });
      expect(into({ row: passed })).toEqual({ step: 'hold', reason: 'default-branch-red' });
    });
    it('keeps the default-branch holds where the default branch name is absent', () => {
      expect(into({ defaultBranchName: undefined })).toEqual({ step: 'hold', reason: 'default-branch-red' });
    });
    it('merges a sprint PR on a stale or unread main reading, and is not merge-in-flight', () => {
      expect(into({ defaultBranch: null })).toEqual({ step: 'merge', head: HEAD });
      expect(into({ defaultBranch: reading({ askedAt: '2026-10-30T09:00:00Z' }) })).toEqual({ step: 'merge', head: HEAD });
      expect(into({ defaultBranch: reading({ headSha: OLD }) })).toEqual({ step: 'merge', head: HEAD });
    });
    it('holds base-branch-red on a fresh settled-red base reading', () => {
      expect(into({ baseReading: baseRed() })).toEqual({ step: 'hold', reason: 'base-branch-red' });
    });
    it('holds nothing on a base reading older than Checks wait or naming another branch', () => {
      expect(into({ baseReading: baseRed({ askedAt: '2026-10-30T09:00:00Z' }) })).toEqual({ step: 'merge', head: HEAD });
      expect(into({ baseReading: baseRed({ branch: 'sprint/other' }) })).toEqual({ step: 'merge', head: HEAD });
    });
    it('still holds conflicting and a missing merger app on the sprint path', () => {
      expect(into({ row: { ...sprintRow, mergeable: 'conflicting' } })).toEqual({ step: 'hold', reason: 'conflicting' });
      expect(into({ mergerApp: { read: 'unread' } })).toMatchObject({ step: 'hold' });
    });
    it('gives the named repair PR into a sprint branch no admission on a red base', () => {
      const LAST_GREEN = 'e'.repeat(40);
      const repairMerge: RepairMergeReading = {
        record: {
          v: 1, branch: 'main', state: 'repairing', lastGreenSha: LAST_GREEN, firstRedSha: 'f'.repeat(40),
          redSince: '2026-10-10T00:00:00Z', candidates: [], rerun: 'asked', preRevertRerun: 'none',
          repairPr: 7, at: '2026-10-10T00:00:00Z',
        },
        episode: 'open',
        redRuns: 'red',
      };
      const r = { ...sprintRow, head: `bug/main-repair-${LAST_GREEN.slice(0, 12)}` };
      expect(into({ row: r, repairMerge, baseReading: baseRed() })).toEqual({ step: 'hold', reason: 'base-branch-red' });
    });
  });

  describe('the base repair exception', () => {
    const SPRINT = 'sprint/x';
    const LAST_GREEN = 'e'.repeat(40);
    const SPRINT_BRANCH = `bug/sprint-repair-${LAST_GREEN.slice(0, 12)}`;
    const baseRed = reading({ branch: SPRINT, settled: { sha: TIP, state: 'red' }, head: 'red' });
    const sprintRow = { ...passed, base: SPRINT, head: SPRINT_BRANCH };
    const baseRepairMerge = (over: Partial<RepairMergeReading> = {}): RepairMergeReading => ({
      record: {
        v: 1, branch: SPRINT, state: 'idle', lastGreenSha: LAST_GREEN, firstRedSha: 'f'.repeat(40),
        redSince: '2026-10-10T00:00:00Z', candidates: [], rerun: 'none', preRevertRerun: 'none',
        repairPr: passed.number, at: '2026-10-10T00:00:00Z',
      },
      episode: 'open',
      redRuns: 'red',
      scope: 'base',
      ...over,
    });
    const into = (over: Partial<SlicePrNextReadings> = {}) =>
      merging({ row: sprintRow, defaultBranchName: 'main', baseReading: baseRed, scope: { read: 'scope', sprint: {} as Sprint, slugs: ['x'], branches: [BRANCH, SPRINT_BRANCH, 'bug/main-repair-' + LAST_GREEN.slice(0, 12)] }, ...over });

    it('selects the base\'s repair PR on a red base', () => {
      expect(into({ baseRepairMerge: baseRepairMerge() })).toEqual({ step: 'merge', head: HEAD });
    });
    it('holds base-branch-red for every other row into the base', () => {
      expect(into({ baseRepairMerge: baseRepairMerge(), row: { ...sprintRow, number: sprintRow.number + 1 } })).toEqual({ step: 'hold', reason: 'base-branch-red' });
      expect(into()).toEqual({ step: 'hold', reason: 'base-branch-red' });
    });
    it('holds with the verdict\'s reason where the runs no longer read red, or the branch is wrong', () => {
      expect(into({ baseRepairMerge: baseRepairMerge({ redRuns: 'pending' }) })).toEqual({ step: 'hold', reason: 'repair-red-unconfirmed' });
      expect(into({ row: { ...sprintRow, head: 'bug/main-repair-' + LAST_GREEN.slice(0, 12) }, baseRepairMerge: baseRepairMerge() }))
        .toEqual({ step: 'hold', reason: 'repair-branch-mismatch' });
      expect(into({ baseRepairMerge: baseRepairMerge({ episode: 'closed' }) })).toEqual({ step: 'hold', reason: 'repair-episode-closed' });
    });
    it('does not admit a PR the default branch\'s record names', () => {
      const main = baseRepairMerge({ scope: undefined });
      expect(into({ repairMerge: main })).toEqual({ step: 'hold', reason: 'base-branch-red' });
    });
    it('still holds conflicting after admission', () => {
      expect(into({ baseRepairMerge: baseRepairMerge(), row: { ...sprintRow, mergeable: 'conflicting' } })).toEqual({ step: 'hold', reason: 'conflicting' });
    });
    it('admits nothing for a base reading that is not red', () => {
      expect(into({ baseReading: null, baseRepairMerge: baseRepairMerge() })).toEqual({ step: 'merge', head: HEAD });
    });
  });

  describe('the repair exception', () => {
    const LAST_GREEN = 'e'.repeat(40);
    const REPAIR_BRANCH = `bug/main-repair-${LAST_GREEN.slice(0, 12)}`;
    const red = reading({ settled: { sha: TIP, state: 'red' }, head: 'red' });
    const repairMerge = (over: Partial<RepairMergeReading> = {}): RepairMergeReading => ({
      record: {
        v: 1, branch: 'main', state: 'repairing', lastGreenSha: LAST_GREEN, firstRedSha: 'f'.repeat(40),
        redSince: '2026-10-10T00:00:00Z', candidates: [], rerun: 'asked', preRevertRerun: 'none',
        repairPr: 7, at: '2026-10-10T00:00:00Z',
      },
      episode: 'open',
      redRuns: 'red',
      ...over,
    });
    const onRed = (over: Partial<SlicePrNextReadings> = {}, head = REPAIR_BRANCH) =>
      merging({
        defaultBranch: red,
        row: { ...passed, head },
        repairMerge: repairMerge(),
        ...over,
      });

    it('merges the PR the record names on a settled red', () => {
      expect(onRed()).toEqual({ step: 'merge', head: HEAD });
    });

    it('holds default-branch-red for a PR the record does not name', () => {
      expect(onRed({ row: { ...passed, number: 8 } }, BRANCH)).toEqual({ step: 'hold', reason: 'default-branch-red' });
    });

    it('holds default-branch-red with no repair reading, as before', () => {
      expect(merging({ defaultBranch: red, repairMerge: undefined })).toEqual({ step: 'hold', reason: 'default-branch-red' });
    });

    it('holds with the verdict’s reason for a named PR off the repair branch', () => {
      expect(onRed({}, BRANCH)).toEqual({ step: 'hold', reason: 'repair-branch-mismatch' });
    });

    it('holds repair-episode-closed where the episode is closed', () => {
      expect(onRed({ repairMerge: repairMerge({ episode: 'closed' }) }, BRANCH)).toEqual({ step: 'hold', reason: 'repair-episode-closed' });
    });

    it('holds repair-red-unconfirmed where the re-asked runs read green', () => {
      expect(onRed({ repairMerge: repairMerge({ redRuns: 'green' }) })).toEqual({ step: 'hold', reason: 'repair-red-unconfirmed' });
    });

    it('keeps the remaining holds on the admitted PR', () => {
      expect(onRed({ row: { ...passed, head: REPAIR_BRANCH, mergeable: 'conflicting' } })).toEqual({ step: 'hold', reason: 'conflicting' });
      expect(onRed({ defaultBranch: reading({ settled: { sha: TIP, state: 'red' }, headSha: 'd'.repeat(40) }) })).toEqual({ step: 'hold', reason: 'merge-in-flight' });
      expect(onRed({ defaultBranch: reading({ settled: { sha: TIP, state: 'red' }, askedAt: '2026-10-30T09:00:00Z' }) })).toEqual({ step: 'hold', reason: 'default-branch-stale' });
    });

    it('admits the repair PR the open episode names past a scope that lacks its branch', () => {
      expect(onRed()).toEqual({ step: 'merge', head: HEAD });
      expect(onRed({ scope: { read: 'none', why: 'no-active-sprint' } })).toEqual({ step: 'merge', head: HEAD });
    });

    it('admits the repair PR an exhausted episode names', () => {
      const record = { ...(repairMerge().record as object), state: 'exhausted' } as RepairMergeReading['record'];
      expect(onRed({ repairMerge: repairMerge({ record, episode: 'open' }) })).toEqual({ step: 'merge', head: HEAD });
    });

    it('admits the revert PR the open episode names from bug/revert-<pr>', () => {
      const record = { ...(repairMerge().record as object), repairPr: undefined, revertPr: 7, revertedPr: 6 } as RepairMergeReading['record'];
      expect(onRed({ repairMerge: repairMerge({ record }) }, 'bug/revert-6')).toEqual({ step: 'merge', head: HEAD });
    });

    it('holds the admitted repair and revert PRs to the same merger check', () => {
      expect(onRed({ backend: 'github', mergerApp: { read: 'absent' } })).toEqual({ step: 'hold', reason: 'merger-app-missing' });
      expect(onRed({ backend: 'github', mergerApp: { read: 'usable' } })).toEqual({ step: 'merge', head: HEAD });
      const record = { ...(repairMerge().record as object), repairPr: undefined, revertPr: 7, revertedPr: 6 } as RepairMergeReading['record'];
      expect(
        onRed({ repairMerge: repairMerge({ record }), backend: 'github', mergerApp: { read: 'absent' } }, 'bug/revert-6'),
      ).toEqual({ step: 'hold', reason: 'merger-app-missing' });
      expect(
        onRed({ repairMerge: repairMerge({ record }), backend: 'github', mergerApp: { read: 'usable' } }, 'bug/revert-6'),
      ).toEqual({ step: 'merge', head: HEAD });
    });

    it('keeps an out-of-scope PR the record does not name out of scope', () => {
      expect(onRed({ row: { ...passed, number: 8, head: REPAIR_BRANCH } })).toEqual({ step: 'none', why: 'out-of-scope' });
      expect(onRed({ repairMerge: undefined })).toEqual({ step: 'none', why: 'out-of-scope' });
      expect(onRed({ repairMerge: repairMerge({ record: null }) })).toEqual({ step: 'none', why: 'out-of-scope' });
    });

    it('keeps a named out-of-scope PR out of scope on a closed or unaskable episode', () => {
      expect(onRed({ repairMerge: repairMerge({ episode: 'closed' }) })).toEqual({ step: 'none', why: 'out-of-scope' });
      expect(onRed({ repairMerge: repairMerge({ episode: 'unaskable' }) })).toEqual({ step: 'none', why: 'out-of-scope' });
    });

    it('keeps a named out-of-scope PR from the wrong branch out of scope', () => {
      expect(onRed({}, 'bug/main-repair-000000000000')).toEqual({ step: 'none', why: 'out-of-scope' });
    });

    it('does not lift a pending or unsettled reading', () => {
      expect(onRed({ defaultBranch: reading({ settled: { sha: TIP, state: 'pending' } }) })).toEqual({ step: 'hold', reason: 'default-branch-unsettled' });
    });
  });

  it('keeps the unread hold on an unread repair record', () => {
    expect(merging({ repair: { read: 'unread' } })).toEqual({ step: 'hold', reason: 'unread' });
  });
});

describe('a success the writer check has not judged', () => {
  const unjudged = (state: 'success' | 'failure') =>
    row({ plotReview: state, plotReviewSha: HEAD, plotReviewJudged: undefined });
  const foreign = row({ plotReview: 'success', plotReviewSha: HEAD, plotReviewJudged: 'absent', plotReviewCheckedSha: HEAD });
  const TIP = 'c'.repeat(40);
  const green = {
    v: 1 as const, branch: 'main', headSha: TIP, head: 'green' as const, settled: { sha: TIP, state: 'green' as const }, failingRuns: [],
    headSince: '2026-10-30T11:00:00Z', askedAt: '2026-10-30T11:55:00Z', at: '2026-10-30T11:55:00Z',
  };

  it('holds review-writer-unchecked in the review arm, the merge arm and the HIGH arm', () => {
    expect(slicePrNext(readings({ row: unjudged('success'), defaultBranch: green }))).toEqual({ step: 'hold', reason: 'review-writer-unchecked' });
    expect(reviewArm(readings({ row: unjudged('success') }))).toEqual({ step: 'hold', reason: 'review-writer-unchecked' });
    expect(mergeArm(readings({ row: unjudged('success'), defaultBranch: green }))).toEqual({ step: 'hold', reason: 'review-writer-unchecked' });
    expect(highArm(readings({ row: unjudged('failure'), fixer: { read: 'fixer', highExhausted: false } as never }))).toEqual({ step: 'hold', reason: 'review-writer-unchecked' });
  });

  it('starts a review for a success only a foreign writer wrote, and merges nothing', () => {
    expect(slicePrNext(readings({ row: foreign, defaultBranch: green }))).toEqual({ step: 'review', head: HEAD });
    expect(mergeArm(readings({ row: foreign, defaultBranch: green }))).toMatchObject({ step: 'none', why: 'not-passed' });
  });

  it('holds review-writer-unchecked in the re-status arm too', () => {
    const verdict = { read: 'verdict', state: 'failure', description: 'HIGH 1' } as const;
    expect(restatusArm(readings({ row: unjudged('success'), verdict }))).toEqual({ step: 'hold', reason: 'review-writer-unchecked' });
  });

  it('answers none once the head\'s review start budget is spent', () => {
    const spent = { head: HEAD, count: 99, lastAt: NOW };
    expect(slicePrNext(readings({ row: foreign, defaultBranch: green, reviewStarts: spent }))).toMatchObject({ step: 'none', why: 'budget-spent' });
  });
});

describe('nextMerge', () => {
  const m = (pr: number) => ({ pr, step: { step: 'merge' as const, head: `h${pr}` } });
  it('picks the lowest PR number among the merge steps', () => {
    expect(nextMerge([m(9), m(4), { pr: 2, step: { step: 'hold', reason: 'conflicting' } }, m(6)])).toEqual({ pr: 4, head: 'h4' });
  });
  it('answers null where no row merges', () => {
    expect(nextMerge([{ pr: 2, step: { step: 'none', why: 'x' } }])).toBeNull();
    expect(nextMerge([])).toBeNull();
  });
});
