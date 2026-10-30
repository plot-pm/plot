import { describe, it, expect } from 'vitest';
import type { WorkflowShaRun } from '../src/entities/build.js';
import { REPAIR_RECORD_VERSION, type RepairRecord } from '../src/entities/repair-record.js';
import { RERUN_GRACE_MS, rerunSettledOf } from '../src/rules/repair-start.js';

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
