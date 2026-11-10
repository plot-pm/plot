import { describe, expect, it } from 'vitest';

import type { Finding } from '../src/entities/finding.js';
import {
  agentFinding,
  agentFindingLine,
  changesetReading,
  finalPassDue,
  lookupPrAnswer,
  needsPrAnswer,
  passPrAnswer,
  type AgentFindingReadings,
} from '../src/rules/agent-finding.js';

const WT = '/desks/watched';

/** A desk that owes nothing: no marker, clean, pushed, commits, a PR, a changeset. */
const settled = (over: Partial<AgentFindingReadings> = {}): AgentFindingReadings => ({
  worktree: WT,
  markers: [],
  dirty: [],
  unpushed: [],
  commitsAhead: 2,
  pr: 'has',
  changeset: 'has',
  ...over,
});

describe('agentFinding', () => {
  it('reads owes a review on a branch with commits, a clean tree and no PR', () => {
    expect(agentFinding(settled({ pr: 'none' }))).toEqual({
      finding: 'owes a review',
      evidence: 'the branch carries commits, the tree is clean and no PR exists; finished work is invisible',
    });
  });

  it('reads nothing once a PR exists and a changeset is added', () => {
    expect(agentFinding(settled())).toBeNull();
  });

  it('reads owes an answer on a PLOT-BLOCKED marker and names the first marker', () => {
    expect(agentFinding(settled({ markers: ['PLOT-BLOCKED.md', 'PLOT-BLOCKED-2.md'] }))).toEqual({
      finding: 'owes an answer',
      evidence: `a PLOT-BLOCKED.md marker is in the tree at ${WT}; the agent stopped and a person has not answered`,
    });
  });

  it('reads holds unlanded work on an uncommitted tree, naming the count and the first file', () => {
    expect(agentFinding(settled({ dirty: ['a.txt', 'b.txt'] }))).toEqual({
      finding: 'holds unlanded work',
      evidence: `2 uncommitted file(s) at ${WT}, the first being a.txt; the work exists only on this desk`,
    });
  });

  it('reads holds unlanded work on commits no remote holds', () => {
    expect(agentFinding(settled({ unpushed: ['abc1234'] }))).toEqual({
      finding: 'holds unlanded work',
      evidence: 'the branch carries commits its upstream does not have; the work exists only on this machine',
    });
  });

  it('reads owes a gate on a PR whose branch adds no changeset', () => {
    expect(agentFinding(settled({ changeset: 'none' }))).toEqual({
      finding: 'owes a gate',
      evidence: 'the branch has a PR but adds no .changeset/*.md; it would land red on the changeset gate',
    });
  });

  it('reads unknown where the PR cannot be asked', () => {
    expect(agentFinding(settled({ pr: 'unaskable', changeset: 'none' }))).toBe('unknown');
  });

  it('reads nothing on a branch with no commits, even with no PR', () => {
    expect(agentFinding(settled({ commitsAhead: 0, pr: 'none' }))).toBeNull();
  });

  it('reads unknown where the commit count is unknown', () => {
    expect(agentFinding(settled({ commitsAhead: 'unknown', pr: 'none' }))).toBe('unknown');
  });

  it('reads unknown, and no gate finding, where the changeset reading is unknown', () => {
    expect(agentFinding(settled({ changeset: 'unknown' }))).toBe('unknown');
  });

  it('reads unknown where dirt or unpushed commits are unknown, and a marker still wins', () => {
    expect(agentFinding(settled({ dirty: 'unknown' }))).toBe('unknown');
    expect(agentFinding(settled({ unpushed: 'unknown' }))).toBe('unknown');
    expect(agentFinding(settled({ dirty: 'unknown', markers: ['PLOT-BLOCKED.md'] }))).toMatchObject({ finding: 'owes an answer' });
  });

  it('orders a marker over unlanded work, unlanded work over an owed review', () => {
    expect(agentFinding(settled({ markers: ['PLOT-BLOCKED.md'], dirty: ['a'], pr: 'none' }))).toMatchObject({ finding: 'owes an answer' });
    expect(agentFinding(settled({ dirty: ['a'], unpushed: ['c'], pr: 'none' }))).toMatchObject({ evidence: expect.stringMatching(/uncommitted/) });
    expect(agentFinding(settled({ unpushed: ['c'], pr: 'none' }))).toMatchObject({ finding: 'holds unlanded work' });
  });

  it('reads owes a review and not owes a gate on a branch with no PR and no changeset', () => {
    expect(agentFinding(settled({ pr: 'none', changeset: 'none' }))).toMatchObject({ finding: 'owes a review' });
  });
});

describe('needsPrAnswer', () => {
  it('is true only for a clean, pushed desk with commits and no marker', () => {
    const { pr: _pr, ...base } = settled();
    expect(needsPrAnswer(base)).toBe(true);
    expect(needsPrAnswer({ ...base, markers: ['PLOT-BLOCKED.md'] })).toBe(false);
    expect(needsPrAnswer({ ...base, dirty: ['a'] })).toBe(false);
    expect(needsPrAnswer({ ...base, dirty: 'unknown' })).toBe(false);
    expect(needsPrAnswer({ ...base, unpushed: ['c'] })).toBe(false);
    expect(needsPrAnswer({ ...base, unpushed: 'unknown' })).toBe(false);
    expect(needsPrAnswer({ ...base, commitsAhead: 0 })).toBe(false);
    expect(needsPrAnswer({ ...base, commitsAhead: 'unknown' })).toBe(false);
  });
});

describe('passPrAnswer', () => {
  it('reads a listed PR in any state as a PR', () => {
    expect(passPrAnswer('OPEN')).toBe('has');
    expect(passPrAnswer('MERGED')).toBe('has');
    expect(passPrAnswer('CLOSED')).toBe('has');
  });

  it('reads none only where the branch stage licensed it, and unaskable otherwise', () => {
    expect(passPrAnswer('none')).toBe('none');
    expect(passPrAnswer('unreadable')).toBe('unaskable');
  });
});

describe('lookupPrAnswer', () => {
  it('reads a host answer: a PR, no PR, or a refusal', () => {
    expect(lookupPrAnswer({ ok: true, value: { state: 'OPEN' } })).toBe('has');
    expect(lookupPrAnswer({ ok: true, value: null })).toBe('none');
    expect(lookupPrAnswer({ ok: false })).toBe('unaskable');
  });
});

describe('changesetReading', () => {
  it('reads an added changeset file at the changeset root', () => {
    expect(changesetReading(['src/a.ts', '.changeset/brave-fox.md'], 40)).toBe('has');
  });

  it('reads none where no changeset file is listed and the list is whole', () => {
    expect(changesetReading(['src/a.ts', '.changeset/sub/x.md', '.changeset/config.json'], 40)).toBe('none');
  });

  it('reads unknown where the list reached its cap without a changeset', () => {
    expect(changesetReading(['a', 'b'], 2)).toBe('unknown');
    expect(changesetReading(['a', '.changeset/x.md'], 2)).toBe('has');
  });
});

describe('agentFindingLine', () => {
  const held = (finding: Finding['finding']): Finding => ({
    monitor: 'AgentMonitor',
    branch: 'feature/x',
    worktree: WT,
    finding,
    since: '2026-11-10T00:00:00Z',
    evidence: 'e',
    measuredAt: '2026-11-10T00:00:00Z',
  });
  const AT = '2026-11-10T01:00:00Z';

  it('writes a new finding with since set to the reading time', () => {
    expect(
      agentFindingLine({ held: null, next: { finding: 'owes a review', evidence: 'ev' }, branch: 'feature/x', worktree: WT, at: AT }),
    ).toEqual({
      monitor: 'AgentMonitor',
      branch: 'feature/x',
      worktree: WT,
      finding: 'owes a review',
      since: AT,
      evidence: 'ev',
      measuredAt: AT,
    });
  });

  it('writes nothing while the held finding still holds, whatever its evidence', () => {
    expect(
      agentFindingLine({ held: held('owes a review'), next: { finding: 'owes a review', evidence: 'other' }, branch: 'feature/x', worktree: WT, at: AT }),
    ).toBeNull();
  });

  it('writes nothing where the new reading is unknown, so the held finding stays', () => {
    expect(agentFindingLine({ held: held('owes a review'), next: 'unknown', branch: 'feature/x', worktree: WT, at: AT })).toBeNull();
  });

  it('writes nothing for a desk that owed nothing and still owes nothing', () => {
    expect(agentFindingLine({ held: null, next: null, branch: 'feature/x', worktree: WT, at: AT })).toBeNull();
  });

  it('writes clear, naming the finding that stopped holding', () => {
    expect(agentFindingLine({ held: held('holds unlanded work'), next: null, branch: 'feature/x', worktree: WT, at: AT })).toMatchObject({
      finding: 'clear',
      evidence: 'the holds unlanded work finding no longer holds; this desk owes nothing measurable',
      since: AT,
    });
  });

  it('writes the new finding where a different one held', () => {
    expect(
      agentFindingLine({ held: held('holds unlanded work'), next: { finding: 'owes a review', evidence: 'ev' }, branch: 'feature/x', worktree: WT, at: AT })?.finding,
    ).toBe('owes a review');
  });
});

describe('finalPassDue', () => {
  it('is due when a running worker ends, by any ending', () => {
    for (const state of ['finished', 'failed', 'ended', 'waiting', 'stalled'] as const) expect(finalPassDue('running', state)).toBe(true);
  });

  it('is due for a desk first read ended, as at fleetd start', () => {
    expect(finalPassDue(undefined, 'finished')).toBe(true);
  });

  it('is not due while the worker runs, or once its ending was read', () => {
    expect(finalPassDue('running', 'running')).toBe(false);
    expect(finalPassDue(undefined, 'running')).toBe(false);
    expect(finalPassDue('finished', 'finished')).toBe(false);
    expect(finalPassDue('finished', 'stalled')).toBe(false);
  });

  it('is not due for a desk with no worker record or one on another machine', () => {
    expect(finalPassDue('running', 'none')).toBe(false);
    expect(finalPassDue(undefined, 'elsewhere')).toBe(false);
  });
});
