import { describe, expect, it } from 'vitest';

import { DEFAULT_BRANCH_VERSION, type DefaultBranchReading } from '../src/entities/default-branch.js';
import { REPAIR_RECORD_VERSION, type RepairRecord } from '../src/entities/repair-record.js';
import {
  episodeOpen,
  redMainPicker,
  redMainStep,
  type RedMainCandidate,
  type RedMainStepInput,
} from '../src/rules/repair.js';

const AT = '2026-10-10T00:00:00.000Z';
const WAIT = 3_600_000;
const BOUND = 3_600_000;

const reading = (over: Partial<DefaultBranchReading> = {}): DefaultBranchReading => ({
  v: DEFAULT_BRANCH_VERSION,
  branch: 'main',
  headSha: 'r'.repeat(40),
  head: 'red',
  settled: { sha: 'r'.repeat(40), state: 'red' },
  failingRuns: [],
  headSince: AT,
  askedAt: AT,
  at: AT,
  ...over,
});

const record = (over: Partial<RepairRecord> = {}): RepairRecord => ({
  v: REPAIR_RECORD_VERSION,
  branch: 'main',
  state: 'idle',
  lastGreenSha: 'g'.repeat(40),
  firstRedSha: 'r'.repeat(40),
  redSince: AT,
  candidates: [],
  rerun: 'none',
  preRevertRerun: 'none',
  at: AT,
  ...over,
});

const input = (over: Partial<RedMainStepInput> = {}): RedMainStepInput => ({
  now: Date.parse(AT),
  checksWaitMs: WAIT,
  mainRepairBoundMs: BOUND,
  descendsFromRecordedRed: 'yes',
  pickerAnswer: 'unknown',
  rerunSettled: 'none',
  repairInFlight: false,
  lastGreenRerunSettled: 'none',
  ...over,
});

describe('episodeOpen', () => {
  it('is open when the settled SHA is the record’s own first red SHA', () => {
    expect(episodeOpen(reading(), record(), 'yes')).toBe(true);
  });

  it('is open when a moved red SHA still descends from the recorded red', () => {
    const moved = reading({ settled: { sha: 'm'.repeat(40), state: 'red' } });
    expect(episodeOpen(moved, record(), 'yes')).toBe(true);
  });

  it('closes once a green has settled', () => {
    const green = reading({ settled: { sha: 'g'.repeat(40), state: 'green' } });
    expect(episodeOpen(green, record(), 'yes')).toBe(false);
  });

  it('closes when the moved SHA does not descend from the recorded red', () => {
    const moved = reading({ settled: { sha: 'm'.repeat(40), state: 'red' } });
    expect(episodeOpen(moved, record(), 'no')).toBe(false);
  });

  it('closes when there is no settled reading at all', () => {
    expect(episodeOpen(reading({ settled: undefined }), record(), 'yes')).toBe(false);
  });
});

describe('redMainStep', () => {
  it('a stale red reading never reverts — holds instead', () => {
    const stale = reading({ askedAt: new Date(Date.parse(AT) - 2 * WAIT).toISOString() });
    const answer = redMainStep(
      stale,
      record({ state: 'reverting', preRevertRerun: 'asked', redSince: new Date(Date.parse(AT) - 2 * BOUND).toISOString() }),
      input({ now: Date.parse(AT), lastGreenRerunSettled: 'green' }),
    );
    expect(answer).toBe('hold');
  });

  it('a pending head blocks the revert', () => {
    const pendingHead = reading({ headSha: 'n'.repeat(40) });
    const answer = redMainStep(
      pendingHead,
      record({ state: 'reverting', preRevertRerun: 'asked', redSince: new Date(Date.parse(AT) - 2 * BOUND).toISOString() }),
      input({ lastGreenRerunSettled: 'green', pickerAnswer: { pr: 42 } }),
    );
    expect(answer).toBe('hold');
  });

  it('a moved red SHA in the same episode still answers revert', () => {
    const moved = reading({ settled: { sha: 'm'.repeat(40), state: 'red' }, headSha: 'm'.repeat(40) });
    const answer = redMainStep(
      moved,
      record({ state: 'reverting', preRevertRerun: 'asked', redSince: new Date(Date.parse(AT) - 2 * BOUND).toISOString() }),
      input({ descendsFromRecordedRed: 'yes', lastGreenRerunSettled: 'green', pickerAnswer: { pr: 42 } }),
    );
    expect(answer).toBe('revert');
  });

  it('a settled green answers close-prs', () => {
    const green = reading({ settled: { sha: 'g'.repeat(40), state: 'green' } });
    expect(redMainStep(green, record({ state: 'repairing' }), input())).toBe('close-prs');
  });

  it('a pending re-run answers await-rerun', () => {
    expect(redMainStep(reading(), record({ state: 'rerun' }), input({ rerunSettled: 'pending' }))).toBe('await-rerun');
  });

  it('a green re-run answers none (the episode ends with no agent)', () => {
    expect(redMainStep(reading(), record({ state: 'rerun' }), input({ rerunSettled: 'green' }))).toBe('close-prs');
  });

  it('red with no record answers hold', () => {
    expect(redMainStep(reading(), null, input())).toBe('hold');
  });

  it('no record and a reading that is not red answers none', () => {
    const green = reading({ settled: { sha: 'g'.repeat(40), state: 'green' } });
    expect(redMainStep(green, null, input())).toBe('none');
  });

  it('a merged revert with main still red answers exhausted', () => {
    const answer = redMainStep(
      reading(),
      record({ state: 'reverting', revertPr: 99, redSince: new Date(Date.parse(AT) - 2 * BOUND).toISOString() }),
      input({ lastGreenRerunSettled: 'green' }),
    );
    expect(answer).toBe('exhausted');
  });

  it('a red re-run read on the first red SHA moves to start-repair', () => {
    expect(redMainStep(reading(), record({ state: 'idle' }), input({ rerunSettled: 'red' }))).toBe('start-repair');
  });

  it('a red pre-revert re-run of the last green SHA answers exhausted', () => {
    const answer = redMainStep(
      reading(),
      record({ state: 'reverting', preRevertRerun: 'asked', redSince: new Date(Date.parse(AT) - 2 * BOUND).toISOString() }),
      input({ lastGreenRerunSettled: 'red' }),
    );
    expect(answer).toBe('exhausted');
  });

  it('a terminal record (done) answers none even on a red reading', () => {
    expect(redMainStep(reading(), record({ state: 'done' }), input())).toBe('none');
  });

  it('a terminal record (exhausted) answers none even on a red reading', () => {
    expect(redMainStep(reading(), record({ state: 'exhausted' }), input())).toBe('none');
  });

  it('an attempt in flight under repairing answers await-repair before the bound', () => {
    expect(redMainStep(reading(), record({ state: 'repairing' }), input({ repairInFlight: true }))).toBe('await-repair');
  });

  it('repairing with no attempt yet answers start-repair before the bound', () => {
    expect(redMainStep(reading(), record({ state: 'repairing' }), input({ repairInFlight: false }))).toBe('start-repair');
  });

  it('the bound reached with the picker answering unknown answers exhausted, never revert', () => {
    const answer = redMainStep(
      reading(),
      record({ state: 'repairing', redSince: new Date(Date.parse(AT) - 2 * BOUND).toISOString() }),
      input({ pickerAnswer: 'unknown' }),
    );
    expect(answer).toBe('exhausted');
  });

  it('the bound reached, fresh reading, head at settled, picker names a PR: revert', () => {
    const answer = redMainStep(
      reading(),
      record({ state: 'repairing', redSince: new Date(Date.parse(AT) - 2 * BOUND).toISOString() }),
      input({ pickerAnswer: { pr: 7 } }),
    );
    expect(answer).toBe('revert');
  });
});

const candidate = (over: Partial<RedMainCandidate> = {}): RedMainCandidate => ({
  sha: 'c'.repeat(40),
  subject: 'Fix the thing (#12)',
  prMerged: true,
  hostMergeCommit: 'c'.repeat(40),
  settledRed: true,
  touchesState: false,
  ...over,
});

describe('redMainPicker', () => {
  it('answers the PR number for one qualifying squash-merge candidate', () => {
    expect(redMainPicker([candidate()])).toEqual({ pr: 12 });
  });

  it('answers unknown with no candidates', () => {
    expect(redMainPicker([])).toBe('unknown');
  });

  it('answers unknown for a direct push with no PR number in the subject', () => {
    expect(redMainPicker([candidate({ subject: 'Fix the thing directly' })])).toBe('unknown');
  });

  it('answers unknown when the subject names a PR but the mergeCommit points elsewhere', () => {
    expect(redMainPicker([candidate({ hostMergeCommit: 'd'.repeat(40) })])).toBe('unknown');
  });

  it('answers unknown with two qualifying candidates', () => {
    const other = candidate({ sha: 'e'.repeat(40), subject: 'Other fix (#13)', hostMergeCommit: 'e'.repeat(40) });
    expect(redMainPicker([candidate(), other])).toBe('unknown');
  });

  it('parses GitHub’s merge-commit subject form', () => {
    const c = candidate({ subject: 'Merge pull request #20 from acme/fix-branch' });
    expect(redMainPicker([c])).toEqual({ pr: 20 });
  });

  it('parses Bitbucket’s merge-commit subject form', () => {
    const c = candidate({ subject: 'Merged in fix-branch (pull request #21)' });
    expect(redMainPicker([c])).toEqual({ pr: 21 });
  });

  it('answers unknown when the candidate touches a State: line', () => {
    expect(redMainPicker([candidate({ touchesState: true })])).toBe('unknown');
  });

  it('answers unknown when the candidate is not itself settled red', () => {
    expect(redMainPicker([candidate({ settledRed: false })])).toBe('unknown');
  });

  it('answers unknown when the host does not read the PR as merged', () => {
    expect(redMainPicker([candidate({ prMerged: false })])).toBe('unknown');
  });
});
