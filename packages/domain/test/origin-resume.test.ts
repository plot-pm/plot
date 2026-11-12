import { describe, expect, it } from 'vitest';

import { originResume, type OriginResumeReadings } from '../src/rules/origin-resume.js';

const branch = 'feature/triggers-replace-the-tick-scan';
const claim = { subject: `plot: claim ${branch}`, tree: 't0', parentTree: 't0' };
const work = { subject: 'plot: scan on trigger', tree: 't1', parentTree: 't0' };

const resumable: OriginResumeReadings = {
  branch,
  unattended: false,
  plan: { kind: 'named', file: 'docs/plans/p.md', phase: 'approved', deferred: false, base: 'sprint/triggers-and-connectors' },
  origin: { kind: 'present', commits: [work, claim] },
  local: { kind: 'absent' },
  pr: { kind: 'none' },
  merged: 'not-merged',
  liveHolders: [],
};

const reasonOf = (readings: Partial<OriginResumeReadings>): string => {
  const verdict = originResume({ ...resumable, ...readings });
  return verdict.kind === 'refused' ? verdict.reason : 'resume';
};

describe('originResume', () => {
  it('resumes a claimed branch with work on origin and carries the sprint base', () => {
    expect(originResume(resumable)).toEqual({ kind: 'resume', base: 'sprint/triggers-and-connectors', plan: 'docs/plans/p.md', work: 1 });
  });

  it('carries an empty base for a default-branch plan', () => {
    const verdict = originResume({ ...resumable, plan: { kind: 'named', file: 'docs/plans/p.md', phase: 'approved', deferred: false, base: '' } });
    expect(verdict).toMatchObject({ kind: 'resume', base: '' });
  });

  it('resumes where the local branch holds nothing origin lacks', () => {
    expect(reasonOf({ local: { kind: 'contained' } })).toBe('resume');
  });

  it('resumes an open draft PR', () => {
    expect(reasonOf({ pr: { kind: 'found', number: 9, state: 'OPEN', draft: true } })).toBe('resume');
  });

  it('refuses an unattended caller before any other reading', () => {
    expect(reasonOf({ unattended: true, origin: { kind: 'absent' } })).toBe('unattended');
  });

  it('refuses no-worktree where origin holds no ref', () => {
    expect(reasonOf({ origin: { kind: 'absent' } })).toBe('no-worktree');
  });

  it('refuses origin-unreadable for a failed fetch and for unreadable plans', () => {
    expect(reasonOf({ origin: { kind: 'unreadable' } })).toBe('origin-unreadable');
    expect(reasonOf({ plan: { kind: 'unreadable' } })).toBe('origin-unreadable');
  });

  it('refuses not-claimed where no plan names the branch', () => {
    expect(reasonOf({ plan: { kind: 'none' } })).toBe('not-claimed');
  });

  it('refuses not-claimed where the plan is not approved', () => {
    const verdict = originResume({ ...resumable, plan: { kind: 'named', file: 'docs/plans/p.md', phase: 'delivered', deferred: false, base: '' } });
    expect(verdict).toMatchObject({ kind: 'refused', reason: 'not-claimed' });
    expect(verdict.kind === 'refused' && verdict.detail).toContain('delivered');
  });

  it('refuses not-claimed where the plan defers the branch', () => {
    expect(reasonOf({ plan: { kind: 'named', file: 'docs/plans/p.md', phase: 'approved', deferred: true, base: '' } })).toBe('not-claimed');
  });

  it('refuses not-claimed where origin carries no claim marker for this branch', () => {
    expect(reasonOf({ origin: { kind: 'present', commits: [work] } })).toBe('not-claimed');
    expect(reasonOf({ origin: { kind: 'present', commits: [work, { ...claim, subject: 'plot: claim feature/other' }] } })).toBe('not-claimed');
    expect(reasonOf({ origin: { kind: 'present', commits: [work, { ...claim, tree: 't9' }] } })).toBe('not-claimed');
  });

  it('refuses no-work where origin carries only the claim', () => {
    expect(reasonOf({ origin: { kind: 'present', commits: [claim] } })).toBe('no-work');
  });

  it('refuses held-by-agent where a live agent names the branch', () => {
    const verdict = originResume({ ...resumable, liveHolders: ['3f2a'] });
    expect(verdict).toMatchObject({ kind: 'refused', reason: 'held-by-agent' });
    expect(verdict.kind === 'refused' && verdict.detail).toContain('3f2a');
  });

  it('refuses local-unpushed where the local branch holds commits origin lacks, or cannot be counted', () => {
    expect(reasonOf({ local: { kind: 'unpushed', count: 2 } })).toBe('local-unpushed');
    expect(reasonOf({ local: { kind: 'unreadable' } })).toBe('local-unpushed');
  });

  it('refuses pr-unanswerable where the host was not asked or did not answer', () => {
    expect(reasonOf({ pr: { kind: 'unasked' } })).toBe('pr-unanswerable');
    expect(reasonOf({ pr: { kind: 'unanswerable' } })).toBe('pr-unanswerable');
    expect(reasonOf({ merged: 'unknown' })).toBe('pr-unanswerable');
  });

  it('refuses reached-review for an open PR, a merged PR and a closed PR', () => {
    expect(reasonOf({ pr: { kind: 'found', number: 7, state: 'OPEN', draft: false } })).toBe('reached-review');
    expect(reasonOf({ pr: { kind: 'found', number: 7, state: 'MERGED', draft: false } })).toBe('reached-review');
    expect(reasonOf({ pr: { kind: 'found', number: 7, state: 'CLOSED', draft: false } })).toBe('reached-review');
  });

  it('refuses reached-review where an older PR merged behind a newer one', () => {
    expect(reasonOf({ pr: { kind: 'none' }, merged: 'merged' })).toBe('reached-review');
  });
});
