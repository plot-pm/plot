import { describe, it, expect } from 'vitest';
import type { WorkflowShaRun } from '../src/entities/build.js';
import { REPAIR_RECORD_VERSION, type RepairRecord } from '../src/entities/repair-record.js';
import { RERUN_GRACE_MS, lastGreenRerunSettledOf, repairAttemptStep, rerunSettledOf } from '../src/rules/repair-start.js';

const ASKED = Date.parse('2026-10-30T07:00:00Z');
const AFTER = ASKED + RERUN_GRACE_MS;

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

describe('rerunSettledOf', () => {
  it('reads none while no re-run is asked', () => {
    expect(rerunSettledOf(record({ rerun: 'none' }), [run('CI', 'failure')], [], AFTER)).toBe('none');
  });

  it('reads pending inside the grace window, whatever the runs say', () => {
    expect(rerunSettledOf(record(), [run('CI', 'failure')], [], AFTER - 1)).toBe('pending');
  });

  it('reads pending where CI did not answer', () => {
    expect(rerunSettledOf(record(), null, [], AFTER)).toBe('pending');
  });

  it('reads pending where the record time does not parse', () => {
    expect(rerunSettledOf(record({ at: 'not a time' }), [run('CI', 'success')], [], AFTER)).toBe('pending');
  });

  it('reads red and green once the declared runs conclude', () => {
    expect(rerunSettledOf(record(), [run('CI', 'failure')], ['CI'], AFTER)).toBe('red');
    expect(rerunSettledOf(record(), [run('CI', 'success')], ['CI'], AFTER)).toBe('green');
  });

  it('reads pending while a declared run is still going and none failed', () => {
    expect(rerunSettledOf(record(), [run('CI', null)], ['CI'], AFTER)).toBe('pending');
  });

  it('ignores a workflow outside the declared checks', () => {
    expect(rerunSettledOf(record(), [run('CI', 'success'), run('publish', 'failure')], ['CI'], AFTER)).toBe('green');
  });

  it('reads pending where no run exists', () => {
    expect(rerunSettledOf(record(), [], ['CI'], AFTER)).toBe('pending');
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

  it('starts the role on a desk it holds, and claims where it holds none', () => {
    expect(repairAttemptStep({ branch: BRANCH }, true, 'none')).toBe('start');
    expect(repairAttemptStep({ branch: BRANCH }, false, 'none')).toBe('claim');
  });
});
