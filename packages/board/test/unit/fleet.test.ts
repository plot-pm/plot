import { describe, it, expect } from 'vitest';
import { classify, humanAge, rowsFromPulse } from '../../src/server/fleet.js';
import type { FleetPulse } from '../../src/contract/schema.js';
import type { PrRecord } from '../../src/server/fleet.js';

// The classifier is where the tab's judgments live: which group a branch lands
// in IS the answer to "what should I do next". Tested as pure functions rather
// than through HTTP — a wrong group is a wrong answer no plumbing can fix.

const QUIET = 30;

describe('classify', () => {
  it('puts an unclaimed branch of an eligible wave in not-started', () => {
    const r = classify('open', 'eligible', null, QUIET);
    expect(r.group).toBe('not-started');
    expect(r.note).toMatch(/nobody has taken it/);
  });

  it('distinguishes blocked-and-unstarted from eligible-and-unstarted', () => {
    // Both are "not started", but only one is actionable now. Showing them
    // identically would invite dispatching work whose seam has not landed.
    const eligible = classify('open', 'eligible', null, QUIET);
    const blocked = classify('open', 'blocked', null, QUIET);
    expect(eligible.group).toBe(blocked.group);
    expect(eligible.note).not.toBe(blocked.note);
    expect(blocked.note).toMatch(/earlier wave/);
  });

  it('treats a claim with no commits as quiet, not as working', () => {
    // The group that matters most: a claim with no progress is either a worker
    // still thinking or a dead one, and only a human can tell which.
    const r = classify('claimed', 'eligible', 3, QUIET);
    expect(r.group).toBe('quiet');
    expect(r.note).toMatch(/no commits/);
  });

  it('calls a recent commit working and a stale one quiet', () => {
    expect(classify('wip', 'eligible', 5, QUIET).group).toBe('working');
    expect(classify('wip', 'eligible', 200, QUIET).group).toBe('quiet');
  });

  it('respects the configured quiet window rather than a hard-coded 30', () => {
    // The default is a guess; a repo whose agents think for an hour raises it.
    expect(classify('wip', 'eligible', 45, 30).group).toBe('quiet');
    expect(classify('wip', 'eligible', 45, 60).group).toBe('working');
  });

  it('does not claim a branch is working when its age is unknown', () => {
    // Unknown must not read as fresh — that shows a dead worker as busy.
    const r = classify('wip', 'eligible', null, QUIET);
    expect(r.group).toBe('quiet');
    expect(r.note).toMatch(/unknown/);
  });

  it('reports a deferred branch as deferred, never as abandoned', () => {
    const r = classify('deferred', 'eligible', null, QUIET);
    expect(r.group).toBe('not-started');
    expect(r.note).toBe('deferred');
  });

  it('puts merged work in done, not in quiet', () => {
    // Found by looking at the rendered tab: "go check whether it died" is the
    // wrong prompt for a branch that landed. Quiet asks a question; done does
    // not. A real mis-answer, not a cosmetic one.
    expect(classify('merged', 'complete', 1, QUIET).group).toBe('done');
    expect(classify('merged', 'eligible', 1, QUIET).group).toBe('done');
    expect(classify('merged', 'complete', 1, QUIET).note).toBe('merged');
    expect(classify('merged', 'eligible', 1, QUIET).note).toMatch(/wave still open/);
  });

  it('scales the age unit so a note never reads "30300 min"', () => {
    // Also found on screen. Minutes are right for the first hour and become
    // arithmetic the reader has to do after that.
    expect(humanAge(45)).toBe('45 min');
    expect(humanAge(60)).toBe('1 hour');
    expect(humanAge(150)).toBe('2 hours');
    expect(humanAge(1440)).toBe('1 day');
    expect(humanAge(30300)).toBe('21 days');
    expect(classify('wip', 'eligible', 30300, QUIET).note).toMatch(/21 days/);
  });
});

describe('rowsFromPulse', () => {
  const pulse: FleetPulse = {
    main: 'main',
    head: 'abc1234',
    plans: [{
      file: '2026-08-15-example-plan.md',
      waves: [
        {
          name: 'Tracer', verdict: 'complete',
          branches: [{ branch: 'feature/a', state: 'merged', deferred: false, claimed: '' }],
        },
        {
          name: 'Implementation', verdict: 'eligible',
          branches: [
            { branch: 'feature/b', state: 'wip', deferred: false, claimed: '' },
            { branch: 'feature/c', state: 'open', deferred: false, claimed: '' },
            { branch: 'feature/d', state: 'claimed', deferred: false, claimed: '2026-08-15, s-1' },
          ],
        },
      ],
    }],
    summary: { plans: 1, waves: 2, branches: 4, claimed: 1, eligible: 1, blocked: 0, deferred: 0 },
  };
  const ages = new Map<string, number | null>([
    ['feature/b', 4], ['feature/a', 90], ['feature/d', 240],
  ]);

  it('orders groups by what they ask of you, not by plan', () => {
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET);
    const groups = rows.map((r) => r.group);
    // working first (nothing to do but look), quiet next (go check), then
    // not-started (decide). Workable top to bottom.
    expect(groups[0]).toBe('working');
    // done sits last: it asks nothing of you at all.
    expect(groups.at(-1)).toBe('done');
  });

  it('strips the date prefix so the plan column stays readable', () => {
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET);
    expect(rows[0].plan).toBe('example-plan');
  });

  it('carries the claim note onto the row', () => {
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET);
    const claimed = rows.find((r) => r.branch === 'feature/d');
    expect(claimed?.note).toMatch(/s-1/);
  });

  it('keeps the repo column populated even with one repo', () => {
    // Constant today, present so the second repo is an addition not a rebuild.
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET);
    expect(rows.every((r) => r.repo === 'plot')).toBe(true);
  });

  it('sorts the oldest first inside a group — stale work surfaces', () => {
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET);
    const quiet = rows.filter((r) => r.group === 'quiet');
    for (let i = 1; i < quiet.length; i++) {
      expect(quiet[i - 1].ageMinutes ?? -1).toBeGreaterThanOrEqual(quiet[i].ageMinutes ?? -1);
    }
  });
});

describe('classify with PR data', () => {
  const pr = (over: Partial<PrRecord> = {}): PrRecord => ({
    number: 42, head: 'feature/x', draft: false, checks: 'green', review: '', ...over,
  });

  it('sends a green PR to waiting-on-you', () => {
    const r = classify('wip', 'eligible', 3, QUIET, pr());
    expect(r.group).toBe('waiting-on-you');
    expect(r.note).toMatch(/#42 green/);
  });

  it('sends a pending PR to waiting-on-a-machine', () => {
    const r = classify('wip', 'eligible', 3, QUIET, pr({ checks: 'pending' }));
    expect(r.group).toBe('waiting-on-machine');
    expect(r.note).toMatch(/CI running/);
  });

  it('treats a PR with NO checks as waiting on you, saying so', () => {
    // GitHub starts no workflow for a bot PR until a person approves the run.
    // "no checks" says why it is not green; calling it pending would show CI
    // running while nothing runs, and nobody would look.
    const r = classify('wip', 'eligible', 3, QUIET, pr({ checks: 'none' }));
    expect(r.group).toBe('waiting-on-you');
    expect(r.note).toMatch(/no checks/);
  });

  it('treats unknown check state as unavailable, never as green', () => {
    // Bitbucket carries no rollup. An honest gap beats an invented verdict.
    const r = classify('wip', 'eligible', 3, QUIET, pr({ checks: 'unknown' }));
    expect(r.group).toBe('waiting-on-you');
    expect(r.note).toMatch(/unavailable/);
  });

  it('sends failing checks to waiting-on-you, not to a machine', () => {
    const r = classify('wip', 'eligible', 3, QUIET, pr({ checks: 'failing' }));
    expect(r.group).toBe('waiting-on-you');
    expect(r.note).toMatch(/failing/);
  });

  it('leaves a green DRAFT PR to its author rather than to you', () => {
    const r = classify('wip', 'eligible', 3, QUIET, pr({ draft: true }));
    expect(r.group).toBe('working');
  });

  it('shows review state as a note without ever gating on it', () => {
    // Approved is approved with or without a review: membership comes from
    // checks, and the review only annotates. Both of these are waiting-on-you.
    const awaiting = classify('wip', 'eligible', 3, QUIET, pr({ review: 'REVIEW_REQUIRED' }));
    const approved = classify('wip', 'eligible', 3, QUIET, pr({ review: 'APPROVED' }));
    expect(awaiting.group).toBe('waiting-on-you');
    expect(approved.group).toBe('waiting-on-you');
    expect(awaiting.note).toMatch(/awaiting review/);
    expect(approved.note).toMatch(/approved/);
  });

  it('emits no review note when the host has nothing to say', () => {
    // "" must not render as "nobody reviewed it" — the honest reading is that
    // this host does not carry review state at all.
    const r = classify('wip', 'eligible', 3, QUIET, pr({ review: '' }));
    expect(r.note).not.toMatch(/review/);
  });

  it('lets git answer for merged and unpushed branches even with a PR present', () => {
    // A merged branch is done; an unpushed one has not started. Neither
    // question is answered by whatever its PR says.
    expect(classify('merged', 'complete', 1, QUIET, pr()).group).toBe('done');
    expect(classify('open', 'eligible', null, QUIET, pr()).group).toBe('not-started');
  });

  it('falls back to git state when no PR exists', () => {
    // The step-1 behaviour must survive untouched for branches without a PR.
    expect(classify('wip', 'eligible', 3, QUIET, null).group).toBe('working');
    expect(classify('claimed', 'eligible', 3, QUIET, null).group).toBe('quiet');
  });
});
