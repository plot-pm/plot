import { describe, it, expect } from 'vitest';
import type { DefaultBranchReading } from '../src/entities/default-branch.js';
import { REPAIR_RECORD_VERSION, type RepairRecord } from '../src/entities/repair-record.js';
import type { RepairMergeReading } from '../src/rules/repair-pr.js';
import { mainHoldStatus, type MainHoldPr } from '../src/rules/main-hold-status.js';

const GREEN = 'a'.repeat(40);
const RED = '17a7fc4385d0e2b1c9a8f7e6d5c4b3a291807f6e';
const REPAIR_BRANCH = `bug/main-repair-${GREEN.slice(0, 12)}`;
const AT = '2026-11-23T10:00:00Z';
const NOW = Date.parse(AT) + 60_000;
const WAIT = 3_600_000;

const redOn = (sha: string, over: Partial<DefaultBranchReading> = {}): DefaultBranchReading => ({
  v: 1,
  branch: 'main',
  headSha: sha,
  head: 'red',
  headSince: AT,
  settled: { sha, state: 'red' },
  failingRuns: [],
  askedAt: AT,
  at: AT,
  ...over,
});

const record = (over: Partial<RepairRecord> = {}): RepairRecord => ({
  v: REPAIR_RECORD_VERSION,
  branch: 'main',
  state: 'idle',
  lastGreenSha: GREEN,
  firstRedSha: RED,
  redSince: AT,
  candidates: [],
  rerun: 'none',
  preRevertRerun: 'none',
  at: AT,
  repairPr: 3685,
  ...over,
});

const open = (over: Partial<RepairMergeReading> = {}): RepairMergeReading => ({
  record: record(),
  episode: 'open',
  redRuns: 'red',
  ...over,
});

const pr = (over: Partial<MainHoldPr> = {}): MainHoldPr => ({ number: 3682, head: 'feature/x', base: 'main', ...over });
const repairPr = pr({ number: 3685, head: REPAIR_BRANCH });

describe('mainHoldStatus', () => {
  it('fails a PR on a red reading with no admitted PR, naming the red commit', () => {
    const status = mainHoldStatus(redOn(RED), open(), pr(), NOW, WAIT, 'main');
    expect(status).toEqual({ state: 'failure', description: 'main is red on 17a7fc438; merge the repair PR first' });
  });

  it('fails a PR on a red reading where the record names no open PR', () => {
    expect(mainHoldStatus(redOn(RED), undefined, pr(), NOW, WAIT, 'main')).toMatchObject({ state: 'failure' });
  });

  it('passes the admitted repair PR', () => {
    expect(mainHoldStatus(redOn(RED), open(), repairPr, NOW, WAIT, 'main')).toEqual({
      state: 'success',
      description: 'repair PR for 17a7fc438',
    });
  });

  it('fails a named repair PR whose episode is closed', () => {
    expect(mainHoldStatus(redOn(RED), open({ episode: 'closed' }), repairPr, NOW, WAIT, 'main')).toMatchObject({ state: 'failure' });
  });

  it('fails a named repair PR whose head branch is not bug/main-repair-<12 hex of lastGreenSha>', () => {
    expect(mainHoldStatus(redOn(RED), open(), pr({ number: 3685, head: 'feature/fix' }), NOW, WAIT, 'main')).toMatchObject({
      state: 'failure',
    });
  });

  it('fails a named repair PR whose red commit no longer reads red', () => {
    expect(mainHoldStatus(redOn(RED), open({ redRuns: 'pending' }), repairPr, NOW, WAIT, 'main')).toMatchObject({ state: 'failure' });
  });

  it('passes every PR on a green reading', () => {
    const green = redOn(RED, { head: 'green', settled: { sha: RED, state: 'green' } });
    expect(mainHoldStatus(green, undefined, pr(), NOW, WAIT, 'main')).toEqual({ state: 'success', description: 'main is not red' });
  });

  it('passes every PR on a red reading older than Checks wait', () => {
    expect(mainHoldStatus(redOn(RED), open(), pr(), Date.parse(AT) + WAIT + 1, WAIT, 'main')).toMatchObject({ state: 'success' });
  });

  it('passes every PR where no reading exists', () => {
    expect(mainHoldStatus(null, undefined, pr(), NOW, WAIT, 'main')).toMatchObject({ state: 'success' });
  });

  it('passes every PR on a reading with no settled commit', () => {
    const unsettled = redOn(RED, { head: 'pending' });
    delete (unsettled as { settled?: unknown }).settled;
    expect(mainHoldStatus(unsettled, undefined, pr(), NOW, WAIT, 'main')).toEqual({ state: 'success', description: 'main is not red' });
  });

  it('names the default branch it was given where no reading exists', () => {
    expect(mainHoldStatus(null, undefined, pr({ base: 'trunk' }), NOW, WAIT, 'trunk')).toEqual({ state: 'success', description: 'trunk is not red' });
    expect(mainHoldStatus(null, undefined, pr(), NOW, WAIT, 'unaskable')).toEqual({ state: 'success', description: 'main is not red' });
    expect(mainHoldStatus(null, undefined, pr(), NOW, WAIT, undefined)).toEqual({ state: 'success', description: 'main is not red' });
    expect(mainHoldStatus(null, undefined, pr(), NOW, WAIT, '')).toEqual({ state: 'success', description: 'main is not red' });
  });

  it('writes no status for a PR into a sprint base', () => {
    expect(mainHoldStatus(redOn(RED), open(), pr({ base: 'sprint/2026-w48' }), NOW, WAIT, 'main')).toBe('none');
  });

  it('holds a PR with an empty base, as the merge does', () => {
    expect(mainHoldStatus(redOn(RED), open(), pr({ base: '' }), NOW, WAIT, 'main')).toMatchObject({ state: 'failure' });
  });
});
