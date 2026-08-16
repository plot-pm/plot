import { describe, it, expect } from 'vitest';
import { classify, humanAge, rowsFromPulse, rateLimitBackoffMs } from '../../src/server/fleet.js';
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

  // A claim with no progress is either a worker still thinking or a dead one,
  // and this used to send BOTH to `quiet` on the grounds that only a human can
  // tell them apart. Watching a real dispatch disproved the premise: for the
  // first minutes every healthy agent looks exactly like this — it is reading
  // the plan — so `quiet`, which means "go check whether it died", was being
  // said about the normal opening of every dispatch. Age separates them, and
  // the age is known because a claim IS a commit.
  it('calls a fresh claim working — it is the normal start of a dispatch', () => {
    const r = classify('claimed', 'eligible', 3, QUIET);
    expect(r.group).toBe('working');
    expect(r.note).toMatch(/no commits/);
  });

  it('calls a claim that stayed silent past the quiet window quiet', () => {
    const r = classify('claimed', 'eligible', QUIET + 1, QUIET);
    expect(r.group).toBe('quiet');
    expect(r.note).toMatch(/still no commits/);
  });

  // Without an age there is nothing to judge, and guessing `working` would
  // assert liveness the data does not support.
  it('falls back to quiet when a claim has no age', () => {
    expect(classify('claimed', 'eligible', null, QUIET).group).toBe('quiet');
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
    // working first (nothing to do but look), then not-started (an opportunity
    // to take), then quiet (an errand to run). Workable top to bottom.
    expect(groups[0]).toBe('working');
    // done sits last: it asks nothing of you at all.
    expect(groups.at(-1)).toBe('done');
  });

  it('sorts an unstarted branch ABOVE a quiet one — actionable before diagnostic', () => {
    // not-started is work a person can pick up right now; quiet asks them to go
    // investigate something that may be dead. The previous order put the errand
    // first. Asserted on the sort itself, not merely on the constant, because
    // the constant is what a refactor moves and the order is what a reader sees.
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET);
    const groups = rows.map((r) => r.group);
    expect(groups.indexOf('not-started')).toBeLessThan(groups.indexOf('quiet'));
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

  it('carries the plan FILENAME beside the display name, so a row can link', () => {
    // `plan` is lossy on purpose (the date prefix is noise in a column), which
    // is exactly why the filename travels separately rather than being
    // reconstructed by whatever needs to build a /plan/ href.
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET);
    expect(rows[0].plan).toBe('example-plan');
    expect(rows[0].planFile).toBe('2026-08-15-example-plan.md');
  });

  it('carries the host URL verbatim, and null where there is no PR', () => {
    const prs = new Map<string, PrRecord>([
      ['feature/b', {
        number: 7, head: 'feature/b', state: 'OPEN', draft: false, checks: 'green',
        review: '', url: 'https://example.test/pr/7',
      }],
    ]);
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET, prs);
    expect(rows.find((r) => r.branch === 'feature/b')?.pr)
      .toEqual({ number: 7, url: 'https://example.test/pr/7' });
    // No PR is the common case, not a degraded one — and it must be null rather
    // than a fabricated address.
    expect(rows.find((r) => r.branch === 'feature/c')?.pr).toBeNull();
  });

  const BASE = 'https://github.com/plot-pm/plot/tree/';

  it('links a branch WITHOUT a PR — the rows the PR-URL derivation would have missed', () => {
    // `feature/c` is `open` / not-started: no PR, and exactly the class where
    // "go look at the branch" is most useful. Deriving the address from a PR URL
    // would have left precisely these rows unlinked.
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET, null, BASE);
    const notStarted = rows.find((r) => r.branch === 'feature/c');
    expect(notStarted?.group).toBe('not-started');
    expect(notStarted?.pr).toBeNull();
    expect(notStarted?.branchUrl).toBe('https://github.com/plot-pm/plot/tree/feature/c');
  });

  it('gives a merged branch no branch link — its remote page is gone', () => {
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET, null, BASE);
    const merged = rows.find((r) => r.branch === 'feature/a');
    expect(merged?.state).toBe('merged');
    expect(merged?.branchUrl).toBe('');
  });

  it('points the branch link and the PR link at DIFFERENT targets', () => {
    // The defect this replaces: one link, on the wrong word — the branch name
    // opened the PR. A test asserting merely "a link exists" passes on that bug,
    // so the assertion has to be that the two addresses differ and that each
    // goes where its own text says.
    const prs = new Map<string, PrRecord>([
      ['feature/b', {
        number: 7, head: 'feature/b', state: 'OPEN', draft: false, checks: 'green',
        review: '', url: 'https://example.test/pr/7',
      }],
    ]);
    const row = rowsFromPulse(pulse, ages, 'plot', QUIET, prs, BASE)
      .find((r) => r.branch === 'feature/b');
    expect(row?.branchUrl).toBe('https://github.com/plot-pm/plot/tree/feature/b');
    expect(row?.pr?.url).toBe('https://example.test/pr/7');
    expect(row?.branchUrl).not.toBe(row?.pr?.url);
  });

  it('renders every branch as plain text when the origin is unrecognised', () => {
    // No base, no guess. An empty base is what an unknown host produces, and it
    // must not become a URL shape borrowed from a host this repo is not on.
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET, null, '');
    expect(rows.every((r) => r.branchUrl === '')).toBe(true);
  });

  it('escapes a branch name into the URL without mangling its slashes', () => {
    // `feature/a b` is legal in git and illegal in a raw URL. The slash is a
    // path separator on both hosts and must survive; everything else is encoded.
    const odd: FleetPulse = {
      ...pulse,
      plans: [{
        file: '2026-08-15-example-plan.md',
        waves: [{
          name: 'w', verdict: 'eligible',
          branches: [{ branch: 'feature/a b', state: 'open', deferred: false, claimed: '' }],
        }],
      }],
    };
    const rows = rowsFromPulse(odd, new Map(), 'plot', QUIET, null, BASE);
    expect(rows[0].branchUrl).toBe('https://github.com/plot-pm/plot/tree/feature/a%20b');
  });

  describe('waitingDays — a different clock, in its own field', () => {
    const DAY = 86_400_000;
    const NOW = Date.parse('2026-08-16T12:00:00Z');
    const approved = new Map([['2026-08-15-example-plan.md', NOW - 22 * DAY]]);

    it('dates an unstarted branch from the plan\'s approval', () => {
      // The point of the field: "approved in February and never begun" is
      // invisible while the row shows only a branch tip that does not exist.
      const rows = rowsFromPulse(pulse, ages, 'plot', QUIET, null, '', approved, NOW);
      const notStarted = rows.find((r) => r.branch === 'feature/c');
      expect(notStarted?.group).toBe('not-started');
      expect(notStarted?.ageMinutes).toBeNull();
      expect(notStarted?.waitingDays).toBe(22);
    });

    it('leaves it null for a branch that HAS a tip to date', () => {
      // `ageMinutes` is the better answer wherever it exists; a second age
      // beside it would only compete. Load-bearing: this is what keeps the two
      // clocks from ever appearing on the same row.
      const rows = rowsFromPulse(pulse, ages, 'plot', QUIET, null, '', approved, NOW);
      for (const r of rows.filter((x) => x.state !== 'open')) {
        expect(r.waitingDays).toBeNull();
      }
    });

    it('is null when the plan records no approval date', () => {
      // Every plan predating the `Approved:` record — including, on this repo,
      // the one not-started plan that motivated the field. Absent must not
      // become zero: "approved at an unknown time" and "approved today" are
      // different statements.
      const rows = rowsFromPulse(pulse, ages, 'plot', QUIET, null, '', new Map(), NOW);
      expect(rows.find((r) => r.branch === 'feature/c')?.waitingDays).toBeNull();
      // And with no map at all — an older cache, or a scan that could not parse.
      const none = rowsFromPulse(pulse, ages, 'plot', QUIET, null, '', null, NOW);
      expect(none.find((r) => r.branch === 'feature/c')?.waitingDays).toBeNull();
    });

    it('never reports a negative wait for a date in the future', () => {
      // A mistyped `Approved:` must not render "waiting -3d", which would look
      // like a bug in the board rather than in the plan.
      const future = new Map([['2026-08-15-example-plan.md', NOW + 3 * DAY]]);
      const rows = rowsFromPulse(pulse, ages, 'plot', QUIET, null, '', future, NOW);
      expect(rows.find((r) => r.branch === 'feature/c')?.waitingDays).toBe(0);
    });
  });

  it('keeps the PR number but no url when the host reported none', () => {
    // An older `gh`/`bb` omits the field. The number is still worth showing;
    // the link is not worth guessing.
    const prs = new Map<string, PrRecord>([
      ['feature/b', {
        number: 7, head: 'feature/b', state: 'OPEN', draft: false, checks: 'green',
        review: '', url: '',
      }],
    ]);
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET, prs);
    expect(rows.find((r) => r.branch === 'feature/b')?.pr).toEqual({ number: 7, url: '' });
  });
});

describe('rateLimitBackoffMs — slow down for a quota, not for a blip', () => {
  // Why this exists: git and the host used to share a 5 s timer, so the board
  // spent 720 GraphQL calls an hour and exhausted a 5000/hour budget in under a
  // working day. It did exactly that on this repo on 2026-08-16, mid-plan.
  // Separating the cadences fixes the spend; this function decides what to do
  // once the host has already said no.

  it('backs off on the bare GraphQL exhaustion message', () => {
    // Verbatim from the failure that prompted the change.
    const ms = rateLimitBackoffMs('GraphQL: API rate limit already exceeded for user ID 870334');
    expect(ms).toBe(120_000);
  });

  it('honours a wait the host names itself', () => {
    const ms = rateLimitBackoffMs(
      'You have exceeded a secondary rate limit. Please wait 90 seconds before trying again.',
    );
    expect(ms).toBe(90_000);
  });

  it('never waits LESS than the ordinary cadence', () => {
    // A 5-second retry would just spend another call to be told the same thing.
    const ms = rateLimitBackoffMs('rate limited, please retry in 5 seconds');
    expect(ms).toBe(60_000);
  });

  it('waits until an absolute reset stamp when one is given', () => {
    const now = 1_700_000_000_000;
    const ms = rateLimitBackoffMs(
      `API rate limit exceeded; reset at 1700000180`, now,
    );
    expect(ms).toBe(180_000);
  });

  it('returns null for an ordinary failure, so the normal timer continues', () => {
    // The load-bearing negative. A VPN blip or a missing `gh` must NOT buy two
    // minutes of silence — the board would look stalled for a reason nothing
    // could explain, which is the same class of unexplained emptiness this plan
    // exists to remove.
    expect(rateLimitBackoffMs('bash: plot-host.sh: No such file or directory')).toBeNull();
    expect(rateLimitBackoffMs('dial tcp: lookup api.github.com: no such host')).toBeNull();
    expect(rateLimitBackoffMs('')).toBeNull();
  });

  it('ignores a reset stamp already in the past', () => {
    // A stale stamp must not produce a negative wait; fall through to the
    // ceiling instead of retrying instantly against a live limit.
    const ms = rateLimitBackoffMs('API rate limit exceeded; reset at 1600000000', 1_700_000_000_000);
    expect(ms).toBe(120_000);
  });
});

describe('classify with PR data', () => {
  const pr = (over: Partial<PrRecord> = {}): PrRecord => ({
    number: 42, head: 'feature/x', state: 'OPEN', draft: false, checks: 'green', review: '',
    url: 'https://example.test/pr/42', ...over,
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
    // The git-only behaviour must survive untouched for branches without a PR —
    // including for claims, which now answer by age like everything else.
    expect(classify('wip', 'eligible', 3, QUIET, null).group).toBe('working');
    expect(classify('claimed', 'eligible', 3, QUIET, null).group).toBe('working');
    expect(classify('claimed', 'eligible', QUIET + 1, QUIET, null).group).toBe('quiet');
  });
});
