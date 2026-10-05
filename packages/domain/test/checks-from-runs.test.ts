import { describe, it, expect } from 'vitest';
import { checksFromRuns, checksVerdict, type ChecksFromRunsReadings } from '../src/rules/checks-verdict.js';
import type { ShaRun } from '../src/entities/build.js';

const PUSHED = 'f743e5730000000000000000000000000000000';
const OTHER = '0e64fafd0000000000000000000000000000000';

const runningRun = (sha: string): ShaRun => ({
  sha,
  status: 'in_progress',
  conclusion: null,
  url: 'https://example.invalid/runs/1',
  startedAt: '2026-10-04T12:00:00.000Z',
});

const concludedRun = (sha: string, conclusion: string): ShaRun => ({
  sha,
  status: 'completed',
  conclusion,
  url: 'https://example.invalid/runs/1',
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
});
