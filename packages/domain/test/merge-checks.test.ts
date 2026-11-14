import { describe, it, expect } from 'vitest';
import { mergeChecksVerdict } from '../src/rules/merge-checks.js';
import type { CheckRun } from '../src/entities/pr.js';

const run = (name: string, status: string, conclusion: string): CheckRun => ({ name, status, conclusion });
const done = (name: string) => run(name, 'COMPLETED', 'SUCCESS');
const dated = (name: string, conclusion: string, at: string): CheckRun => ({ name, status: 'COMPLETED', conclusion, at });

describe('mergeChecksVerdict — every named check has a completed success on the head', () => {
  it('reads green where no check is named, whatever the runs say', () => {
    expect(mergeChecksVerdict(undefined, [])).toEqual({ read: 'green' });
    expect(mergeChecksVerdict([run('build', 'IN_PROGRESS', '')], [])).toEqual({ read: 'green' });
  });

  it('reads green where every named check completed with success', () => {
    expect(mergeChecksVerdict([done('validate'), done('build')], ['validate', 'build'])).toEqual({ read: 'green' });
    expect(mergeChecksVerdict([run('validate', '', 'SUCCESS')], ['validate'])).toEqual({ read: 'green' });
  });

  it('reads a status context whose state is SUCCESS as a completed success', () => {
    expect(mergeChecksVerdict([run('validate', 'SUCCESS', '')], ['validate'])).toEqual({ read: 'green' });
  });

  it('reads a named check with no run on the head as pending', () => {
    // Measured 2026-11-10 on PR #3365: `gh run rerun --failed` removed `validate`
    // from the check list until it ran again, and every remaining run read success.
    expect(mergeChecksVerdict([done('build')], ['validate'])).toEqual({ read: 'pending', name: 'validate', seen: 'no run' });
    expect(mergeChecksVerdict(undefined, ['validate'])).toEqual({ read: 'pending', name: 'validate', seen: 'no run' });
  });

  it('reads a queued or running named check as pending', () => {
    for (const status of ['QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED', 'PENDING', 'EXPECTED', '']) {
      expect(mergeChecksVerdict([run('validate', status, '')], ['validate'])).toEqual({ read: 'pending', name: 'validate', seen: status === '' ? 'unfinished' : status });
    }
  });

  it('reads a named check that completed without success as failing', () => {
    for (const conclusion of ['FAILURE', 'SKIPPED', 'NEUTRAL', 'CANCELLED']) {
      expect(mergeChecksVerdict([run('validate', 'COMPLETED', conclusion)], ['validate'])).toEqual({ read: 'failing', name: 'validate', seen: conclusion });
    }
    expect(mergeChecksVerdict([run('validate', 'FAILURE', '')], ['validate'])).toEqual({ read: 'failing', name: 'validate', seen: 'FAILURE' });
  });

  it('reads every run of a named check, so one unfinished run beside a success is pending', () => {
    expect(mergeChecksVerdict([done('validate'), run('validate', 'IN_PROGRESS', '')], ['validate']))
      .toEqual({ read: 'pending', name: 'validate', seen: 'IN_PROGRESS' });
  });

  it('lets the latest completed run of a named check decide, so a later success replaces an earlier failure', () => {
    // Measured 2026-11-07 on release PR #3080: a dispatched CI run failed `validate` at 23:59,
    // and the pull_request run's second attempt passed it at 07:41 on the same head.
    expect(mergeChecksVerdict([dated('validate', 'SUCCESS', '2026-11-07T07:41:02Z'), dated('validate', 'FAILURE', '2026-11-06T23:59:14Z')], ['validate']))
      .toEqual({ read: 'green' });
    expect(mergeChecksVerdict([dated('validate', 'FAILURE', '2026-11-07T07:41:02Z'), dated('validate', 'SUCCESS', '2026-11-06T23:59:14Z')], ['validate']))
      .toEqual({ read: 'failing', name: 'validate', seen: 'FAILURE' });
  });

  it('reads every completed run where none is dated, and an undated run before a dated one', () => {
    expect(mergeChecksVerdict([done('validate'), run('validate', 'COMPLETED', 'FAILURE')], ['validate']))
      .toEqual({ read: 'failing', name: 'validate', seen: 'FAILURE' });
    expect(mergeChecksVerdict([run('validate', 'COMPLETED', 'FAILURE'), dated('validate', 'SUCCESS', '2026-11-07T07:41:02Z')], ['validate']))
      .toEqual({ read: 'green' });
  });

  it('reads an unfinished run as pending even where a later run succeeded', () => {
    expect(mergeChecksVerdict([{ ...run('validate', 'IN_PROGRESS', ''), at: '2026-11-06T23:59:14Z' }, dated('validate', 'SUCCESS', '2026-11-07T07:41:02Z')], ['validate']))
      .toEqual({ read: 'pending', name: 'validate', seen: 'IN_PROGRESS' });
  });

  it('answers the first named check that is not a completed success, in the order given', () => {
    expect(mergeChecksVerdict([done('a'), run('b', 'COMPLETED', 'FAILURE')], ['a', 'c', 'b']))
      .toEqual({ read: 'pending', name: 'c', seen: 'no run' });
  });
});
