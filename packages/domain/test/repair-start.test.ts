import { describe, it, expect } from 'vitest';
import type { WorkflowShaRun } from '../src/entities/build.js';
import { REPAIR_RECORD_VERSION, type RepairRecord } from '../src/entities/repair-record.js';
import { DEFAULT_BRANCH_VERSION, type DefaultBranchReading } from '../src/entities/default-branch.js';
import { redMainStep } from '../src/rules/repair.js';
import {
  RERUN_GRACE_MS,
  lastGreenRerunOverdue,
  lastGreenRerunSettledOf,
  repairAttemptStep,
  repairStartAction,
  rerunSettledOf,
  type RepairStartActionInput,
  type RerunReading,
} from '../src/rules/repair-start.js';

const ASKED = Date.parse('2026-10-30T07:00:00Z');
const AFTER = ASKED + RERUN_GRACE_MS;
const WAIT_MS = 3_600_000;

const record = (over: Partial<RepairRecord> = {}): RepairRecord => ({
  v: REPAIR_RECORD_VERSION,
  branch: 'main',
  state: 'rerun',
  lastGreenSha: 'a'.repeat(40),
  firstRedSha: 'b'.repeat(40),
  redSince: '2026-10-30T06:00:00Z',
  candidates: [],
  rerun: 'asked',
  preRevertRerun: 'none',
  at: '2026-10-30T07:00:00Z',
  ...over,
});

const run = (workflow: string, conclusion: string | null): WorkflowShaRun => ({
  sha: 'b'.repeat(40),
  workflow,
  status: conclusion === null ? 'in_progress' : 'completed',
  conclusion,
  url: '',
  startedAt: '',
});

const pending = (reason: string) => ({ settled: 'pending', reason });

describe('rerunSettledOf', () => {
  it('reads none while no re-run is asked', () => {
    expect(rerunSettledOf(record({ rerun: 'none' }), [run('CI', 'failure')], [], AFTER, WAIT_MS)).toEqual({ settled: 'none' });
  });

  it('reads rerun-grace inside the grace window, whatever the runs say', () => {
    expect(rerunSettledOf(record(), [run('CI', 'failure')], [], AFTER - 1, WAIT_MS)).toEqual(pending('rerun-grace'));
  });

  it('reads rerun-unanswered where CI did not answer', () => {
    expect(rerunSettledOf(record(), null, [], AFTER, WAIT_MS)).toEqual(pending('rerun-unanswered'));
  });

  it('reads rerun-grace where the record time does not parse, inside Checks wait of redSince', () => {
    const since = record({ at: 'not a time', redSince: '2026-10-30T06:30:00Z' });
    expect(rerunSettledOf(since, [run('CI', 'success')], [], AFTER, WAIT_MS)).toEqual(pending('rerun-grace'));
  });

  it('measures the wait from redSince where the record time does not parse', () => {
    const since = record({ at: 'not a time', redSince: '2026-10-30T06:30:00Z' });
    expect(rerunSettledOf(since, null, [], Date.parse('2026-10-30T07:30:00Z') - 1, WAIT_MS)).toEqual(pending('rerun-grace'));
    expect(rerunSettledOf(since, null, [], Date.parse('2026-10-30T07:30:00Z'), WAIT_MS)).toEqual({ settled: 'overdue' });
  });

  it('reads overdue where neither the record time nor redSince parses', () => {
    const unreadable = record({ at: 'not a time', redSince: 'not a time either' });
    expect(rerunSettledOf(unreadable, null, [], AFTER, WAIT_MS)).toEqual({ settled: 'overdue' });
  });

  it.each([
    ['rerun-unanswered', null],
    ['rerun-unconcluded', [run('CI', null)]],
    ['rerun-unmatched', [run('CI/other', 'success')]],
  ] as const)('reads %s before Checks wait of the ask and overdue at it', (reason, runs) => {
    expect(rerunSettledOf(record(), runs, ['CI'], ASKED + WAIT_MS - 1, WAIT_MS)).toEqual(pending(reason));
    expect(rerunSettledOf(record(), runs, ['CI'], ASKED + WAIT_MS, WAIT_MS)).toEqual({ settled: 'overdue' });
  });

  it('reads a settled green or red inside Checks wait as before, and past it too', () => {
    for (const now of [AFTER, ASKED + WAIT_MS - 1, ASKED + 2 * WAIT_MS]) {
      expect(rerunSettledOf(record(), [run('CI', 'failure')], ['CI'], now, WAIT_MS)).toEqual({ settled: 'red' });
      expect(rerunSettledOf(record(), [run('CI', 'success')], ['CI'], now, WAIT_MS)).toEqual({ settled: 'green' });
    }
  });

  it('reads none while no re-run is asked, however long ago the record was written', () => {
    expect(rerunSettledOf(record({ rerun: 'none' }), null, ['CI'], ASKED + 2 * WAIT_MS, WAIT_MS)).toEqual({ settled: 'none' });
  });

  it('reads red and green once the declared runs conclude, with no reason', () => {
    expect(rerunSettledOf(record(), [run('CI', 'failure')], ['CI'], AFTER, WAIT_MS)).toEqual({ settled: 'red' });
    expect(rerunSettledOf(record(), [run('CI', 'success')], ['CI'], AFTER, WAIT_MS)).toEqual({ settled: 'green' });
  });

  it('reads rerun-unconcluded while a declared run is still going and none failed', () => {
    expect(rerunSettledOf(record(), [run('CI', null)], ['CI'], AFTER, WAIT_MS)).toEqual(pending('rerun-unconcluded'));
  });

  it('reads rerun-unmatched where the declared checks match no run', () => {
    expect(rerunSettledOf(record(), [run('CI', 'success')], ['CI/validate'], AFTER, WAIT_MS)).toEqual(pending('rerun-unmatched'));
  });

  it('ignores a workflow outside the declared checks', () => {
    expect(rerunSettledOf(record(), [run('CI', 'success'), run('publish', 'failure')], ['CI'], AFTER, WAIT_MS)).toEqual({ settled: 'green' });
  });

  it('reads rerun-unmatched where no run exists', () => {
    expect(rerunSettledOf(record(), [], ['CI'], AFTER, WAIT_MS)).toEqual(pending('rerun-unmatched'));
  });
});

describe('repairStartAction', () => {
  const red: RerunReading = { settled: 'red' };
  const input = (over: Partial<RepairStartActionInput> = {}): RepairStartActionInput => ({
    step: 'await-rerun',
    record: record(),
    hasReading: true,
    openPr: null,
    rerun: { settled: 'none' },
    ...over,
  });
  const BRANCH = 'bug/main-repair-aaaaaaaaaaaa';

  it('asks the re-run where none is recorded and a reading exists', () => {
    expect(repairStartAction(input({ record: record({ state: 'idle', rerun: 'none' }) }))).toEqual({ action: 'ask-rerun' });
  });

  it('waits on an asked re-run with its reason, never asking again', () => {
    const rerun = pending('rerun-unanswered') as RerunReading;
    expect(repairStartAction(input({ rerun }))).toEqual({ action: 'awaiting-rerun', rerun });
  });

  it('waits rather than asks where no reading exists to name the branch', () => {
    expect(repairStartAction(input({ record: record({ state: 'idle', rerun: 'none' }), hasReading: false }))).toEqual({
      action: 'awaiting-rerun',
      rerun: { settled: 'none' },
    });
  });

  it('starts the repair on start-repair with an overdue re-run', () => {
    expect(repairStartAction(input({ step: 'start-repair', rerun: { settled: 'overdue' } }))).toEqual({ action: 'start-repair' });
  });

  it('starts the repair on start-repair', () => {
    expect(repairStartAction(input({ step: 'start-repair', rerun: red }))).toEqual({ action: 'start-repair' });
  });

  it('records an open fix PR the record does not yet name', () => {
    const repairing = record({ state: 'repairing', attempt: { branch: BRANCH } });
    expect(repairStartAction(input({ step: 'await-repair', record: repairing, openPr: 7 }))).toEqual({ action: 'record-pr', pr: 7 });
  });

  it('waits on the repair where no PR is open, the claim was lost, or the PR is already recorded', () => {
    const repairing = (over: Partial<RepairRecord> = {}) => record({ state: 'repairing', attempt: { branch: BRANCH }, ...over });
    expect(repairStartAction(input({ step: 'await-repair', record: repairing(), openPr: null }))).toEqual({ action: 'awaiting-repair' });
    expect(
      repairStartAction(input({ step: 'await-repair', record: repairing({ attempt: { branch: BRANCH, outcome: 'lost' } }), openPr: 7 })),
    ).toEqual({ action: 'awaiting-repair' });
    expect(repairStartAction(input({ step: 'await-repair', record: repairing({ repairPr: 7 }), openPr: 7 }))).toEqual({
      action: 'awaiting-repair',
    });
  });

  it.each(['none', 'hold', 'revert', 'close-prs', 'exhausted'] as const)('does nothing on %s', (step) => {
    expect(repairStartAction(input({ step }))).toEqual({ action: 'none' });
  });
});

describe('the repair-start decision, from the readings', () => {
  const RED = 'b'.repeat(40);
  const NOW = Date.parse('2026-11-06T11:19:00Z');
  const redReading = (now = NOW, sha = RED): DefaultBranchReading => ({
    v: DEFAULT_BRANCH_VERSION,
    branch: 'main',
    headSha: sha,
    head: 'red',
    settled: { sha, state: 'red' },
    failingRuns: [],
    headSince: '2026-11-06T10:18:00Z',
    askedAt: new Date(now - 30_000).toISOString(),
    at: new Date(now - 30_000).toISOString(),
  });
  const episode = (over: Partial<RepairRecord> = {}): RepairRecord =>
    record({ firstRedSha: RED, redSince: '2026-11-06T10:18:00Z', at: '2026-11-06T10:20:27Z', ...over });
  const decide = (
    reading: DefaultBranchReading | null,
    rec: RepairRecord,
    runs: readonly WorkflowShaRun[] | null,
    over: { openPr?: number | null; repairInFlight?: boolean; now?: number } = {},
  ) => {
    const now = over.now ?? NOW;
    const rerun: RerunReading =
      reading !== null && rec.rerun === 'asked' ? rerunSettledOf(rec, runs, ['CI'], now, 3_600_000) : { settled: 'none' };
    const step = redMainStep(reading, rec, {
      now,
      checksWaitMs: 3_600_000,
      mainRepairBoundMs: 3_600_000,
      descendsFromRecordedRed: 'yes',
      pickerAnswer: 'unknown',
      rerunSettled: rerun.settled,
      repairInFlight: over.repairInFlight ?? false,
      lastGreenRerunSettled: 'none',
    });
    return repairStartAction({ step, record: rec, hasReading: reading !== null, openPr: over.openPr ?? null, rerun });
  };

  it('waits on the 2026-11-06 re-run with runs null, naming rerun-unanswered', () => {
    expect(decide(redReading(), episode(), null)).toEqual({ action: 'awaiting-rerun', rerun: pending('rerun-unanswered') });
  });

  it('asks the re-run once where none is recorded', () => {
    expect(decide(redReading(), episode({ state: 'idle', rerun: 'none' }), null)).toEqual({ action: 'ask-rerun' });
  });

  it('starts the repair once the re-run reads red', () => {
    expect(decide(redReading(), episode(), [run('CI', 'failure')])).toEqual({ action: 'start-repair' });
  });

  it('records the fix PR while the repair runs, and waits once it is recorded', () => {
    const repairing = episode({ state: 'repairing', redSince: '2026-11-06T10:50:00Z', attempt: { branch: 'bug/main-repair-aaaaaaaaaaaa' } });
    expect(decide(redReading(), repairing, null, { openPr: 7, repairInFlight: true })).toEqual({ action: 'record-pr', pr: 7 });
    expect(decide(redReading(), { ...repairing, repairPr: 7 }, null, { openPr: 7, repairInFlight: true })).toEqual({
      action: 'awaiting-repair',
    });
  });

  describe('the re-run bound, on the 2026-11-06 readings', () => {
    const HEAD = '501d32861'.padEnd(40, '0');
    const at = (time: string) => Date.parse(`2026-11-06T${time}Z`);
    const headRed = (now: number) => redReading(now, HEAD);

    it('waits at 11:19Z and starts the repair at 11:21Z', () => {
      expect(decide(headRed(at('11:19:00')), episode(), null, { now: at('11:19:00') })).toEqual({
        action: 'awaiting-rerun',
        rerun: pending('rerun-unanswered'),
      });
      expect(decide(headRed(at('11:21:00')), episode(), null, { now: at('11:21:00') })).toEqual({ action: 'start-repair' });
    });

    it('starts the repair at exactly record.at + Checks wait, and waits one millisecond before', () => {
      const end = at('10:20:27') + 3_600_000;
      expect(decide(headRed(end - 1), episode(), null, { now: end - 1 }).action).toBe('awaiting-rerun');
      expect(decide(headRed(end), episode(), null, { now: end })).toEqual({ action: 'start-repair' });
    });

    it('starts the repair when the overdue wait is on the first red SHA itself', () => {
      expect(decide(redReading(at('11:21:00')), episode(), null, { now: at('11:21:00') })).toEqual({ action: 'start-repair' });
    });

    it('measures from redSince where record.at does not parse', () => {
      const unparsed = episode({ at: 'not a time' });
      expect(decide(headRed(at('11:17:59')), unparsed, null, { now: at('11:17:59') }).action).toBe('awaiting-rerun');
      expect(decide(headRed(at('11:18:00')), unparsed, null, { now: at('11:18:00') })).toEqual({ action: 'start-repair' });
    });

    it('starts the repair where neither record.at nor redSince parses', () => {
      const unparsed = episode({ at: 'not a time', redSince: 'not a time either' });
      expect(decide(headRed(at('10:25:00')), unparsed, null, { now: at('10:25:00') })).toEqual({ action: 'start-repair' });
    });

    it('a write to the rerun record that leaves at unchanged does not restart the bound', () => {
      const rewritten = { ...episode(), repairPr: 7 };
      expect(rewritten.at).toBe(episode().at);
      expect(decide(headRed(at('11:21:00')), rewritten, null, { now: at('11:21:00') })).toEqual({ action: 'start-repair' });
    });

    it('a re-run that settles green inside the bound still waits on the first red SHA and repairs a later red', () => {
      const green = [run('CI', 'success')];
      expect(decide(redReading(at('10:40:00')), episode(), green, { now: at('10:40:00') }).action).toBe('awaiting-rerun');
      expect(decide(headRed(at('10:40:00')), episode(), green, { now: at('10:40:00') })).toEqual({ action: 'start-repair' });
    });

    it('awaits the started repair at 11:22Z and reaches the bound at 12:21Z, measured from startedAt', () => {
      const repairing = episode({
        state: 'repairing',
        at: '2026-11-06T11:21:00Z',
        attempt: { branch: 'bug/main-repair-aaaaaaaaaaaa', startedAt: '2026-11-06T11:21:00Z' },
      });
      const step = (now: number) =>
        redMainStep(headRed(now), repairing, {
          now,
          checksWaitMs: 3_600_000,
          mainRepairBoundMs: 3_600_000,
          descendsFromRecordedRed: 'yes',
          pickerAnswer: { pr: 42 },
          rerunSettled: 'none',
          repairInFlight: true,
          lastGreenRerunSettled: 'none',
        });
      expect(step(at('11:22:00'))).toBe('await-repair');
      expect(step(at('12:20:59'))).toBe('await-repair');
      expect(step(at('12:21:00'))).toBe('revert');
    });
  });

  it('does nothing where no reading exists, as the tick does today', () => {
    expect(decide(null, episode(), null)).toEqual({ action: 'none' });
    expect(decide(null, episode({ state: 'idle', rerun: 'none' }), null)).toEqual({ action: 'none' });
  });
});

describe('lastGreenRerunSettledOf', () => {
  const asked = record({ state: 'reverting', preRevertRerun: 'asked' });
  const started = (workflow: string, conclusion: string | null, startedAt: string): WorkflowShaRun => ({
    ...run(workflow, conclusion),
    startedAt,
  });
  const OLD = '2026-10-30T05:59:00Z';
  const NEW = '2026-10-30T07:00:30Z';

  it('answers none while no pre-revert re-run is asked', () => {
    expect(lastGreenRerunSettledOf(record({ preRevertRerun: 'none' }), [started('CI', 'failure', NEW)], [], AFTER)).toBe('none');
  });

  it('reads pending inside the grace window and where CI did not answer', () => {
    expect(lastGreenRerunSettledOf(asked, [started('CI', 'failure', NEW)], ['CI'], AFTER - 1)).toBe('pending');
    expect(lastGreenRerunSettledOf(asked, null, ['CI'], AFTER)).toBe('pending');
  });

  it('never reads the old green attempt as the answer', () => {
    expect(lastGreenRerunSettledOf(asked, [started('CI', 'success', OLD)], ['CI'], AFTER)).toBe('pending');
    expect(lastGreenRerunSettledOf(asked, [started('CI', 'success', '')], ['CI'], AFTER)).toBe('pending');
  });

  it('waits for every declared run to report the new attempt', () => {
    const runs = [started('CI', 'success', NEW), started('Lint', 'success', OLD)];
    expect(lastGreenRerunSettledOf(asked, runs, ['CI', 'Lint'], AFTER)).toBe('pending');
  });

  it('reads the new attempt red or green as it concluded', () => {
    expect(lastGreenRerunSettledOf(asked, [started('CI', 'failure', NEW)], ['CI'], AFTER)).toBe('red');
    expect(lastGreenRerunSettledOf(asked, [started('CI', 'success', NEW)], ['CI'], AFTER)).toBe('green');
    expect(lastGreenRerunSettledOf(asked, [started('CI', null, NEW)], ['CI'], AFTER)).toBe('pending');
  });
});

describe('repairAttemptStep', () => {
  const BRANCH = 'bug/main-repair-aaaaaaaaaaaa';

  it('claims where no attempt is recorded', () => {
    expect(repairAttemptStep(undefined, false, 'none')).toBe('claim');
  });

  it('starts nothing once another machine won the claim', () => {
    expect(repairAttemptStep({ branch: BRANCH, outcome: 'lost' }, false, 'none')).toBe('lost');
  });

  it('starts nothing once the attempt ended, whatever the run reads', () => {
    for (const run of ['none', 'alive', 'ended', 'crashed'] as const) {
      expect(repairAttemptStep({ branch: BRANCH, outcome: 'ended' }, true, run)).toBe('ended');
    }
  });

  it('waits while the run is alive', () => {
    expect(repairAttemptStep({ branch: BRANCH }, true, 'alive')).toBe('wait');
  });

  it('ends the attempt where the run wrote its ending record', () => {
    expect(repairAttemptStep({ branch: BRANCH }, true, 'ended')).toBe('record-ended');
  });

  it('resumes a crashed run once, then ends the attempt', () => {
    expect(repairAttemptStep({ branch: BRANCH }, true, 'crashed')).toBe('resume');
    expect(repairAttemptStep({ branch: BRANCH, resumed: true }, true, 'crashed')).toBe('record-ended');
  });

  it('records a failed start, resumes once, then holds the episode', () => {
    expect(repairAttemptStep({ branch: BRANCH }, true, 'start-failed')).toBe('record-start-failed');
    expect(repairAttemptStep({ branch: BRANCH, outcome: 'start-failed' }, true, 'start-failed')).toBe('resume');
    expect(repairAttemptStep({ branch: BRANCH, outcome: 'start-failed', resumed: true }, true, 'start-failed')).toBe('held');
  });

  it('starts the role on a desk it holds, and claims where it holds none', () => {
    expect(repairAttemptStep({ branch: BRANCH }, true, 'none')).toBe('start');
    expect(repairAttemptStep({ branch: BRANCH }, false, 'none')).toBe('claim');
  });
});

describe('lastGreenRerunOverdue', () => {
  const since = Date.parse('2026-10-30T06:00:00Z');
  it('is overdue from redSince plus the repair bound plus Checks wait, not before', () => {
    expect(lastGreenRerunOverdue(record(), since + 3000 - 1, 1000, 2000)).toBe(false);
    expect(lastGreenRerunOverdue(record(), since + 3000, 1000, 2000)).toBe(true);
  });
  it('is never overdue where redSince does not parse', () => {
    expect(lastGreenRerunOverdue(record({ redSince: 'x' }), since * 2, 1000, 2000)).toBe(false);
  });
  it('measures from the attempt’s startedAt where it parses', () => {
    const started = record({ attempt: { branch: 'bug/main-repair-aaaaaaaaaaaa', startedAt: '2026-10-30T07:00:00Z' } });
    const start = Date.parse('2026-10-30T07:00:00Z');
    expect(lastGreenRerunOverdue(started, start + 3000 - 1, 1000, 2000)).toBe(false);
    expect(lastGreenRerunOverdue(started, start + 3000, 1000, 2000)).toBe(true);
  });
});
