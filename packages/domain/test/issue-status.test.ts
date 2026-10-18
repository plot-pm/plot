import { describe, expect, it } from 'vitest';

import {
  isPlanStatePhase,
  issueStatusWrites,
  planStateWrites,
  trackerReportOf,
  trackerWriteSummary,
  type IssueStatusWords,
} from '../src/rules/issue-status.js';

const both: IssueStatusWords = { approved: 'Approved', delivered: 'In Review', released: 'Done' };

describe('a finished plan owes its issues a status', () => {
  it('owes nothing where the plan names no issue, at either phase', () => {
    // The path 90% of plans take — a rule writing on phase alone fails here.
    expect(issueStatusWrites({ phase: 'delivered', issues: [], words: both })).toEqual([]);
    expect(issueStatusWrites({ phase: 'released', issues: [], words: both })).toEqual([]);
  });

  it.each(['draft', 'design'])('owes nothing at %s, issues and words notwithstanding', (phase) => {
    expect(issueStatusWrites({ phase, issues: ['935'], words: both })).toEqual([]);
  });

  it('never falls back from one phase’s word to the other’s', () => {
    const deliveredOnly = { approved: '', delivered: 'In Review', released: '' };
    expect(issueStatusWrites({ phase: 'released', issues: ['935'], words: deliveredOnly })).toEqual([]);
    const releasedOnly = { approved: '', delivered: '', released: 'Done' };
    expect(issueStatusWrites({ phase: 'delivered', issues: ['935'], words: releasedOnly })).toEqual([]);
  });

  it('writes each phase’s own word', () => {
    expect(issueStatusWrites({ phase: 'delivered', issues: ['7'], words: both })).toEqual([
      { issue: '7', status: 'In Review' },
    ]);
    expect(issueStatusWrites({ phase: 'released', issues: ['7'], words: both })).toEqual([
      { issue: '7', status: 'Done' },
    ]);
  });

  it('writes the approved word at approved, and owes nothing where it is empty', () => {
    expect(issueStatusWrites({ phase: 'approved', issues: ['7'], words: both })).toEqual([
      { issue: '7', status: 'Approved' },
    ]);
    const noApproved = { approved: '', delivered: 'In Review', released: 'Done' };
    expect(issueStatusWrites({ phase: 'approved', issues: ['7'], words: noApproved })).toEqual([]);
  });

  it('owes one write per issue, not the first alone', () => {
    expect(issueStatusWrites({ phase: 'released', issues: ['1', '2'], words: both })).toEqual([
      { issue: '1', status: 'Done' },
      { issue: '2', status: 'Done' },
    ]);
  });

  it('carries a non-standard word verbatim', () => {
    const words = { approved: '', delivered: '', released: 'Shipped to prod' };
    expect(issueStatusWrites({ phase: 'released', issues: ['PROJ-7'], words })).toEqual([
      { issue: 'PROJ-7', status: 'Shipped to prod' },
    ]);
  });
});

describe('a plan reflects its phase on its issues', () => {
  it('owes nothing where the plan names no issue, at any phase', () => {
    for (const phase of ['draft', 'approved', 'delivered', 'released']) {
      expect(planStateWrites({ phase, issues: [], planLink: 'docs/plans/x.md' })).toEqual([]);
    }
  });

  it('owes nothing outside the four phases', () => {
    expect(planStateWrites({ phase: 'design', issues: ['7'], planLink: 'docs/plans/x.md' })).toEqual([]);
  });

  it('owes draft a write with no configured word needed', () => {
    expect(planStateWrites({ phase: 'draft', issues: ['7'], planLink: 'idea/x plan PR link' })).toEqual([
      { issue: '7', phase: 'draft', planLink: 'idea/x plan PR link' },
    ]);
  });

  it('owes one write per issue, not the first alone', () => {
    expect(planStateWrites({ phase: 'approved', issues: ['1', '2'], planLink: 'docs/plans/x.md' })).toEqual([
      { issue: '1', phase: 'approved', planLink: 'docs/plans/x.md' },
      { issue: '2', phase: 'approved', planLink: 'docs/plans/x.md' },
    ]);
  });

  it('carries the version where the caller passes one, and omits it where not', () => {
    expect(planStateWrites({ phase: 'released', issues: ['7'], planLink: 'docs/plans/x.md', version: 'v1.2.3' })).toEqual([
      { issue: '7', phase: 'released', planLink: 'docs/plans/x.md', version: 'v1.2.3' },
    ]);
    expect(planStateWrites({ phase: 'delivered', issues: ['7'], planLink: 'docs/plans/x.md' })).toEqual([
      { issue: '7', phase: 'delivered', planLink: 'docs/plans/x.md' },
    ]);
  });
});

describe('a run’s write outcomes reduce to the one a caller reports', () => {
  it('reports none where nothing was owed', () => {
    expect(trackerWriteSummary([])).toBe('none');
  });

  it('reports the one outcome present', () => {
    expect(trackerWriteSummary(['written'])).toBe('written');
    expect(trackerWriteSummary(['failed'])).toBe('failed');
  });

  it('reports failed over written — one failed write among several is a failed report', () => {
    expect(trackerWriteSummary(['written', 'failed'])).toBe('failed');
    expect(trackerWriteSummary(['failed', 'written'])).toBe('failed');
  });

  it('ranks every pair worst-first: written < no-target < unaskable < failed', () => {
    expect(trackerWriteSummary(['written', 'no-target'])).toBe('no-target');
    expect(trackerWriteSummary(['no-target', 'unaskable'])).toBe('unaskable');
    expect(trackerWriteSummary(['unaskable', 'failed'])).toBe('failed');
  });
});

describe('a phase word is one of the four, or none', () => {
  it('accepts the four and refuses anything else', () => {
    for (const phase of ['draft', 'approved', 'delivered', 'released']) expect(isPlanStatePhase(phase)).toBe(true);
    expect(isPlanStatePhase('release')).toBe(false);
  });
});

describe('a tracker-write run reads into what its caller reports', () => {
  it('reads the per-issue lines and the summary of a clean run', () => {
    const run = { stdout: '7\twritten\tapproved\nsummary: tracker=written\n', stderr: '', code: 0 };
    expect(trackerReportOf(run)).toEqual({ lines: ['7\twritten\tapproved'], outcome: 'written' });
  });

  it('reads none where nothing was owed', () => {
    expect(trackerReportOf({ stdout: 'summary: tracker=none\n', stderr: '', code: 0 })).toEqual({ lines: [], outcome: 'none' });
  });

  it('reports a non-zero exit as failed, with the script’s stderr as the reason', () => {
    const run = { stdout: 'summary: tracker=failed\n', stderr: "plot-plan-state: 'x.md' is not a plan file\nplot-plan-state: usage: …\n", code: 2 };
    expect(trackerReportOf(run)).toEqual({
      lines: ["plot-plan-state: 'x.md' is not a plan file", 'plot-plan-state: usage: …'],
      outcome: 'failed',
    });
  });

  it('reports a run with no summary as failed, naming the exit code where stderr is empty', () => {
    expect(trackerReportOf({ stdout: '', stderr: '', code: 0 })).toEqual({ lines: ['exited 0 with no tracker summary'], outcome: 'failed' });
  });

  it('reports an unknown summary word as failed rather than passing it on', () => {
    expect(trackerReportOf({ stdout: 'summary: tracker=maybe\n', stderr: '', code: 0 }).outcome).toBe('failed');
  });
});
