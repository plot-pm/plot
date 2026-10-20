import { describe, it, expect } from 'vitest';
import {
  buildFindingFor,
  checksFromRuns,
  checksVerdict,
  runWasNotAcquired,
  runWasTimedOut,
  type ChecksFromRunsReadings,
} from '../src/rules/checks-verdict.js';
import type { ShaRun } from '../src/entities/build.js';

const PUSHED = 'f743e5730000000000000000000000000000000';
const OTHER = '0e64fafd0000000000000000000000000000000';
const URL = 'https://example.invalid/runs/1';

const runningRun = (sha: string): ShaRun => ({
  sha,
  status: 'in_progress',
  conclusion: null,
  url: URL,
  startedAt: '2026-10-04T12:00:00.000Z',
});

const concludedRun = (sha: string, conclusion: string): ShaRun => ({
  sha,
  status: 'completed',
  conclusion,
  url: URL,
  startedAt: '2026-10-04T12:00:00.000Z',
});

const base: ChecksFromRunsReadings = {
  pushedSha: PUSHED,
  run: null,
  tip: 'pushed',
  waitedSeconds: 0,
  boundSeconds: 3600,
};

describe('checksFromRuns — the loop asking its own CI wait', () => {
  it('waits when the branch has no run at all yet', () => {
    expect(checksFromRuns(base)).toBe('wait');
  });

  it('waits while the run for the pushed commit has not concluded', () => {
    expect(checksFromRuns({ ...base, run: runningRun(PUSHED) })).toBe('wait');
  });

  it('settles on a passing run for the pushed commit', () => {
    expect(checksFromRuns({ ...base, run: concludedRun(PUSHED, 'success') })).toBe('settled');
  });

  it('settles on a failing run for the pushed commit', () => {
    expect(checksFromRuns({ ...base, run: concludedRun(PUSHED, 'failure') })).toBe('settled');
  });

  it('settles on a run needing approval', () => {
    expect(checksFromRuns({ ...base, run: concludedRun(PUSHED, 'action_required') })).toBe('settled');
  });

  it('keeps waiting on a conclusion the settled list does not name, until the bound', () => {
    // `cancelled` is not evidence either way; absent is not false.
    expect(checksFromRuns({ ...base, run: concludedRun(PUSHED, 'cancelled') })).toBe('wait');
    expect(
      checksFromRuns({
        ...base,
        run: concludedRun(PUSHED, 'cancelled'),
        waitedSeconds: 3600,
      }),
    ).toBe('no-answer');
  });

  it('ends no-answer once the wait reaches Checks wait with nothing conclusive', () => {
    expect(checksFromRuns({ ...base, waitedSeconds: 3600 })).toBe('no-answer');
  });

  it('does not end no-answer before the bound', () => {
    expect(checksFromRuns({ ...base, waitedSeconds: 3599 })).toBe('wait');
  });

  it('ends tip-moved the instant the remote tip is no longer the pushed commit', () => {
    // #1199: a person pushed 0e64fafd on top of the agent's f743e573. The wait
    // ends even with no run at all and even inside the bound — a build of
    // 0e64fafd would never be about the agent's own work.
    expect(checksFromRuns({ ...base, tip: 'other', waitedSeconds: 10 })).toBe('tip-moved');
  });

  it('ends tip-moved even where a green run exists for the new tip', () => {
    // A rule reading only the newest run would pass this case by mistake —
    // the run named is for OTHER, not for the pushed commit, and the tip
    // reading is what catches it.
    expect(
      checksFromRuns({
        ...base,
        tip: 'other',
        run: concludedRun(OTHER, 'success'),
      }),
    ).toBe('tip-moved');
  });

  it('keeps waiting on an unreadable tip, because a failure to observe is not evidence', () => {
    expect(checksFromRuns({ ...base, tip: 'unknown' })).toBe('wait');
  });

  it('ends an unknown tip at the bound as no-answer, never as tip-moved', () => {
    expect(checksFromRuns({ ...base, tip: 'unknown', waitedSeconds: 3600 })).toBe('no-answer');
  });

  it('answers none for a bound of 0, before any wait starts, as checksVerdict does', () => {
    expect(checksFromRuns({ ...base, boundSeconds: 0 })).toBe('none');
    expect(checksFromRuns({ ...base, boundSeconds: 0, tip: 'other' })).toBe('none');
    expect(checksFromRuns({ ...base, boundSeconds: -1, run: concludedRun(PUSHED, 'failure') })).toBe('none');
    expect(
      checksVerdict({
        branch: 'b',
        head: PUSHED,
        pushed: true,
        prOpen: true,
        last: null,
        waitedSeconds: 0,
        boundSeconds: 0,
      }),
    ).toBe('none');
  });

  it('reads a run for another sha as evidence about its own sha only, never the pushed one', () => {
    // BuildPort.runForSha is documented to answer only for the sha it was
    // asked about, but this rule reads `run.sha` rather than assuming it: a
    // run whose sha differs from pushedSha settles nothing about the pushed
    // commit, so the tip (not this rule re-deriving a sha comparison) is what
    // the wait leans on.
    const other = concludedRun('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'success');
    expect(checksFromRuns({ ...base, run: other })).toBe('wait');
  });

  it('waits, then ends no-answer, on a failed run no runner ever picked up (#1295)', () => {
    // #1295: a GitHub Actions outage cancelled jobs after 15 minutes with 0
    // steps and an empty runner name. Reading this as `settled` spent a
    // slice's whole correction budget on an outage.
    const unacquired = { ...concludedRun(PUSHED, 'failure'), jobs: [{ conclusion: 'cancelled', steps: [] }] };
    expect(checksFromRuns({ ...base, run: unacquired })).toBe('wait');
    expect(checksFromRuns({ ...base, run: unacquired, waitedSeconds: 3600 })).toBe('no-answer');
  });

  it('settles a mix of one unacquired job and one real failure — the agent is still owed the correction', () => {
    const mixed = {
      ...concludedRun(PUSHED, 'failure'),
      jobs: [
        { conclusion: 'cancelled', steps: [] },
        { conclusion: 'failure', steps: ['success', 'failure', 'success', 'success'] },
      ],
    };
    expect(checksFromRuns({ ...base, run: mixed })).toBe('settled');
  });

  it('settles a failed run with no jobs field — absent is not 0 steps', () => {
    expect(checksFromRuns({ ...base, run: concludedRun(PUSHED, 'failure') })).toBe('settled');
  });

  it('answers timed-out, never settled, for a run whose cancelled job carries the timeout fingerprint', () => {
    // Real shape, measured on a confirmed timeout (run 39357335917,
    // 2026-10-20): some `success` steps, one `cancelled` (the step running
    // when the 25-minute cap fired), `skipped` steps, then `success` again —
    // GitHub's own "Post " cleanup steps, which run regardless of why the job
    // was cancelled. Elapsed time (25m21s here) is what the fingerprint alone
    // cannot supply.
    const timedOut = {
      ...concludedRun(PUSHED, 'cancelled'),
      jobs: [
        {
          conclusion: 'cancelled',
          startedAt: '2026-10-20T02:09:01Z',
          completedAt: '2026-10-20T02:34:22Z',
          steps: ['success', 'success', 'cancelled', 'skipped', 'skipped', 'success', 'success'],
        },
      ],
    };
    expect(checksFromRuns({ ...base, run: timedOut })).toBe('timed-out');
    // Inside the bound and at it alike: a timed-out run never waits for more.
    expect(checksFromRuns({ ...base, run: timedOut, waitedSeconds: 3600 })).toBe('timed-out');
  });

  it('does not settle a not-acquired run even though it shares the cancelled conclusion', () => {
    // The naive patch this test is written to catch: treating every
    // `cancelled` run as settled would also settle a host-outage run
    // `runWasNotAcquired` exists to keep unsettled (#1295).
    const notAcquired = {
      ...concludedRun(PUSHED, 'cancelled'),
      jobs: [{ conclusion: 'cancelled', startedAt: null, completedAt: null, steps: [] }],
    };
    expect(checksFromRuns({ ...base, run: notAcquired })).toBe('wait');
    expect(checksFromRuns({ ...base, run: notAcquired, waitedSeconds: 3600 })).toBe('no-answer');
  });

  it('does not settle a concurrency-superseded run — same step shape as a timeout, too little elapsed time', () => {
    // Real shape, measured on a confirmed supersession (run 39363175090,
    // 2026-10-20): the step fingerprint is IDENTICAL to a real timeout once
    // "Post " cleanup steps are accounted for — `success*, cancelled,
    // skipped*, success*`. What differs is elapsed time: 53 s here against
    // 25+ minutes for a real timeout.
    const superseded = {
      ...concludedRun(PUSHED, 'cancelled'),
      jobs: [
        {
          conclusion: 'cancelled',
          startedAt: '2026-10-20T03:14:19Z',
          completedAt: '2026-10-20T03:15:12Z',
          steps: ['success', 'success', 'success', 'success', 'success', 'success', 'success', 'cancelled', 'skipped', 'success', 'success', 'success'],
        },
      ],
    };
    expect(checksFromRuns({ ...base, run: superseded })).toBe('wait');
    expect(checksFromRuns({ ...base, run: superseded, waitedSeconds: 3600 })).toBe('no-answer');
  });
});

describe('runWasTimedOut — a cancelled run whose job hit its own timeout-minutes', () => {
  const timing = { startedAt: '2026-10-04T12:00:00Z', completedAt: '2026-10-04T12:25:00Z' };
  const tooShort = { startedAt: '2026-10-04T12:00:00Z', completedAt: '2026-10-04T12:00:53Z' };

  it('answers false for a running or successful run', () => {
    expect(runWasTimedOut(runningRun(PUSHED))).toBe(false);
    expect(runWasTimedOut(concludedRun(PUSHED, 'success'))).toBe(false);
  });

  it('answers false for a failure conclusion — the fingerprint is cancelled-only', () => {
    expect(
      runWasTimedOut({
        ...concludedRun(PUSHED, 'failure'),
        jobs: [{ conclusion: 'failure', ...timing, steps: ['success', 'failure'] }],
      }),
    ).toBe(false);
  });

  it('answers false when jobs is absent', () => {
    expect(runWasTimedOut(concludedRun(PUSHED, 'cancelled'))).toBe(false);
  });

  it('answers true for the measured fingerprint run long enough: success(es), one cancelled, then skipped/success', () => {
    expect(
      runWasTimedOut({
        ...concludedRun(PUSHED, 'cancelled'),
        jobs: [
          {
            conclusion: 'cancelled',
            ...timing,
            steps: ['success', 'success', 'cancelled', 'skipped', 'skipped', 'success'],
          },
        ],
      }),
    ).toBe(true);
  });

  it('answers false for a not-acquired run — no steps ran at all', () => {
    expect(
      runWasTimedOut({
        ...concludedRun(PUSHED, 'cancelled'),
        jobs: [{ conclusion: 'cancelled', startedAt: null, completedAt: null, steps: [] }],
      }),
    ).toBe(false);
  });

  it('answers false when no success step precedes the cancelled one', () => {
    expect(
      runWasTimedOut({
        ...concludedRun(PUSHED, 'cancelled'),
        jobs: [{ conclusion: 'cancelled', ...timing, steps: ['cancelled', 'skipped'] }],
      }),
    ).toBe(false);
  });

  it('answers false for a supersession — the identical step shape, but cancelled too soon to be a timeout', () => {
    // Measured on real data (2026-10-20): a confirmed supersession produces
    // the SAME step shape as a confirmed timeout once "Post " steps are
    // counted. Elapsed time is the only signal that tells them apart.
    expect(
      runWasTimedOut({
        ...concludedRun(PUSHED, 'cancelled'),
        jobs: [
          {
            conclusion: 'cancelled',
            ...tooShort,
            steps: ['success', 'success', 'cancelled', 'skipped', 'success'],
          },
        ],
      }),
    ).toBe(false);
  });

  it('answers false when a step after the cancelled one is neither skipped nor success', () => {
    // Two jobs cancelled independently, or a shape wave 1 did not measure —
    // refuse the fingerprint rather than guess.
    expect(
      runWasTimedOut({
        ...concludedRun(PUSHED, 'cancelled'),
        jobs: [{ conclusion: 'cancelled', ...timing, steps: ['success', 'cancelled', 'cancelled'] }],
      }),
    ).toBe(false);
  });

  it('answers false when job timing is absent even though the step shape and conclusion match', () => {
    expect(
      runWasTimedOut({
        ...concludedRun(PUSHED, 'cancelled'),
        jobs: [
          {
            conclusion: 'cancelled',
            startedAt: null,
            completedAt: null,
            steps: ['success', 'success', 'cancelled', 'skipped'],
          },
        ],
      }),
    ).toBe(false);
  });

  it('answers false when job timing is the other absent shape — fields left undefined rather than null', () => {
    expect(
      runWasTimedOut({
        ...concludedRun(PUSHED, 'cancelled'),
        jobs: [
          {
            conclusion: 'cancelled',
            steps: ['success', 'success', 'cancelled', 'skipped'],
          },
        ],
      }),
    ).toBe(false);
    expect(
      runWasTimedOut({
        ...concludedRun(PUSHED, 'cancelled'),
        jobs: [
          {
            conclusion: 'cancelled',
            startedAt: '2026-10-04T12:00:00Z',
            steps: ['success', 'success', 'cancelled', 'skipped'],
          },
        ],
      }),
    ).toBe(false);
  });

  it('answers true when at least one job of several carries the fingerprint', () => {
    expect(
      runWasTimedOut({
        ...concludedRun(PUSHED, 'cancelled'),
        jobs: [
          { conclusion: 'skipped', startedAt: null, completedAt: null, steps: ['skipped'] },
          { conclusion: 'cancelled', ...timing, steps: ['success', 'cancelled', 'skipped'] },
        ],
      }),
    ).toBe(true);
  });
});

describe('runWasNotAcquired — a failed or cancelled run no runner ever ran a step of', () => {
  it('answers false for a running or successful run', () => {
    expect(runWasNotAcquired(runningRun(PUSHED))).toBe(false);
    expect(runWasNotAcquired(concludedRun(PUSHED, 'success'))).toBe(false);
  });

  it('answers false when jobs is absent, even for a failed conclusion', () => {
    expect(runWasNotAcquired(concludedRun(PUSHED, 'failure'))).toBe(false);
  });

  it('answers false when jobs is present but empty', () => {
    expect(runWasNotAcquired({ ...concludedRun(PUSHED, 'failure'), jobs: [] })).toBe(false);
  });

  it('answers true when every failed or cancelled job ran 0 steps', () => {
    expect(
      runWasNotAcquired({
        ...concludedRun(PUSHED, 'cancelled'),
        jobs: [{ conclusion: 'cancelled', steps: [] }],
      }),
    ).toBe(true);
  });

  it('answers false when any failed or cancelled job ran at least one step', () => {
    expect(
      runWasNotAcquired({
        ...concludedRun(PUSHED, 'failure'),
        jobs: [{ conclusion: 'failure', steps: ['failure'] }],
      }),
    ).toBe(false);
  });

  it('ignores a successful job sitting beside the 0-step ones', () => {
    expect(
      runWasNotAcquired({
        ...concludedRun(PUSHED, 'failure'),
        jobs: [
          { conclusion: 'success', steps: Array(12).fill('success') },
          { conclusion: 'cancelled', steps: [] },
        ],
      }),
    ).toBe(true);
  });
});

// Each case maps to one of `plot-build-monitor.sh`'s `sample_finding` arms.
// `head moved` has no case here: that arm fires when `monitor_run_for_sha`
// answers about a sha other than the head, which this rule's own `run`
// reading (`checksFromRuns`, above) already excludes before `buildFindingFor`
// is ever called — `run.sha` here is always `pushedSha`.
describe('buildFindingFor — the loop\'s own BuildMonitor finding, from a settled run', () => {
  it('reports build passed for a successful conclusion, mirroring "build passed"', () => {
    expect(buildFindingFor(concludedRun(PUSHED, 'success'))).toEqual({
      finding: 'build passed',
      evidence: `the run at ${URL} for ${PUSHED} concluded success`,
    });
  });

  it('reports build failed for a failing conclusion, mirroring "build failed"', () => {
    expect(buildFindingFor(concludedRun(PUSHED, 'failure'))).toEqual({
      finding: 'build failed',
      evidence: `the run at ${URL} for ${PUSHED} concluded failure`,
    });
  });

  it('answers null for a conclusion checksFromRuns itself never settles on', () => {
    // The shell's `sample_finding` reads `timed_out`/`cancelled`/`startup_failure`
    // as `build failed` too, but `checksFromRuns` only calls a run settled on
    // `success`/`failure`/`action_required` (SETTLED_CONCLUSIONS) — a `timed_out`
    // or plain `cancelled` run keeps the loop at `wait`/`no-answer` and never
    // reaches `buildFindingFor` through the loop's own call site. Documented as
    // a gap from the shell's wider vocabulary, not ported here.
    expect(buildFindingFor(concludedRun(PUSHED, 'timed_out'))).toBeNull();
    expect(buildFindingFor(concludedRun(PUSHED, 'cancelled'))).toBeNull();
  });

  it('reports build timed out for a cancelled run whose job hit its own timeout-minutes', () => {
    // Same real shape as the `checksFromRuns` fixture above (run 39357335917,
    // 2026-10-20) — this is the arm checked before the generic failure arm so
    // a timeout is never reported as a plain `build failed`.
    const timedOut = {
      ...concludedRun(PUSHED, 'cancelled'),
      jobs: [
        {
          conclusion: 'cancelled',
          startedAt: '2026-10-20T02:09:01Z',
          completedAt: '2026-10-20T02:34:22Z',
          steps: ['success', 'success', 'cancelled', 'skipped', 'skipped', 'success', 'success'],
        },
      ],
    };
    expect(buildFindingFor(timedOut)).toEqual({
      finding: 'build timed out',
      evidence: `the run at ${URL} for ${PUSHED} hit its own timeout-minutes before a conclusion`,
    });
  });

  it('reports build needs approval for an action_required conclusion, mirroring "build needs approval"', () => {
    expect(buildFindingFor(concludedRun(PUSHED, 'action_required'))).toEqual({
      finding: 'build needs approval',
      evidence: `the run at ${URL} for ${PUSHED} is waiting for a manual approval before it can start`,
    });
  });

  it('reports build needs approval for a waiting status even with no conclusion yet', () => {
    expect(buildFindingFor({ ...runningRun(PUSHED), status: 'waiting' })).toEqual({
      finding: 'build needs approval',
      evidence: `the run at ${URL} for ${PUSHED} is waiting for a manual approval before it can start`,
    });
  });

  it('answers null for a run with no conclusion and no approval wait — nothing has changed yet', () => {
    expect(buildFindingFor(runningRun(PUSHED))).toBeNull();
  });

  it('answers an unknown-url placeholder sentence when the run names no url', () => {
    expect(buildFindingFor({ ...concludedRun(PUSHED, 'success'), url: '' })).toEqual({
      finding: 'build passed',
      evidence: `the run at an unknown url for ${PUSHED} concluded success`,
    });
  });
});
