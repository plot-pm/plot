import { describe, expect, it } from 'vitest';

import {
  isPlanStatePhase,
  issueStatusWrites,
  parsePlanSiblingLine,
  planStateWrites,
  releaseIssueDecisions,
  releaseIssueSummary,
  trackerReportOf,
  trackerWriteSummary,
  unfinishedIssuesOf,
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

describe('a release decides which of its issues to close', () => {
  it('closes every issue no other plan still owes', () => {
    expect(releaseIssueDecisions(['7', '8'], new Set())).toEqual([
      { issue: '7', skip: null },
      { issue: '8', skip: null },
    ]);
  });

  it('leaves a shared issue open where another plan has not released yet', () => {
    expect(releaseIssueDecisions(['7'], new Set(['7']))).toEqual([{ issue: '7', skip: 'another-plan-unfinished' }]);
  });

  it('decides each issue on its own — one shared, one not', () => {
    expect(releaseIssueDecisions(['7', '8'], new Set(['7']))).toEqual([
      { issue: '7', skip: 'another-plan-unfinished' },
      { issue: '8', skip: null },
    ]);
  });

  it('decides nothing where the plan names no issue', () => {
    expect(releaseIssueDecisions([], new Set(['7']))).toEqual([]);
  });

  // #2374 (3): a failed sibling read must never read as "no sibling" — every
  // issue the released plan names stays open, unconditionally, rather than
  // closing because the set that would have named it came back empty.
  it('leaves every issue open where the sibling read is unreadable, never closing on an empty-looking set', () => {
    expect(releaseIssueDecisions(['7', '8'], 'unreadable')).toEqual([
      { issue: '7', skip: 'unreadable' },
      { issue: '8', skip: 'unreadable' },
    ]);
  });

  it('decides nothing where the plan names no issue, even where the sibling read is unreadable', () => {
    expect(releaseIssueDecisions([], 'unreadable')).toEqual([]);
  });
});

describe('a guarded reader parses one plot-plan-meta.sh line', () => {
  it('reads the phase and the issues, stringifying numeric issue ids', () => {
    expect(parsePlanSiblingLine('{"phase":"approved","issues":[2480]}')).toEqual({
      phase: 'approved',
      issues: ['2480'],
    });
  });

  it('reads an empty issues array', () => {
    expect(parsePlanSiblingLine('{"phase":"draft","issues":[]}')).toEqual({ phase: 'draft', issues: [] });
  });

  // #2374 (4): the site this guards ran a bare `JSON.parse` with no guard,
  // after the release push had already landed — a malformed line must never
  // throw out of a release whose commit is on main.
  it('reads null, never throwing, where the line is not JSON', () => {
    expect(parsePlanSiblingLine('not json')).toBeNull();
  });

  it('reads null where the line is JSON but names no issues array', () => {
    expect(parsePlanSiblingLine('{"phase":"approved"}')).toBeNull();
  });

  it('reads null where phase is not a string', () => {
    expect(parsePlanSiblingLine('{"phase":7,"issues":[]}')).toBeNull();
  });

  it('reads null where the parsed JSON is not an object', () => {
    expect(parsePlanSiblingLine('"approved"')).toBeNull();
  });

  it('reads null where the parsed JSON is the literal null', () => {
    expect(parsePlanSiblingLine('null')).toBeNull();
  });

  it('reads null where an issue is neither a string nor a number', () => {
    expect(parsePlanSiblingLine('{"phase":"approved","issues":[null]}')).toBeNull();
  });
});

describe('a release reads every unreleased sibling for the issues it still owes', () => {
  it('collects issues from an Active sibling', () => {
    const lines = ['{"phase":"approved","issues":["7"]}'];
    expect(unfinishedIssuesOf(lines)).toEqual(new Set(['7']));
  });

  // #2374 (1): a Delivered sibling must count too — the defect was reading
  // only the Active index, so a sibling plan already Delivered and not yet
  // Released was invisible and its issue closed early.
  it('collects issues from a Delivered sibling the same as an Active one', () => {
    const lines = ['{"phase":"delivered","issues":["7"]}'];
    expect(unfinishedIssuesOf(lines)).toEqual(new Set(['7']));
  });

  it('excludes a sibling already released — its issues do not stay open on its account', () => {
    const lines = ['{"phase":"released","issues":["7"]}'];
    expect(unfinishedIssuesOf(lines)).toEqual(new Set());
  });

  it('unions issues across several siblings', () => {
    const lines = ['{"phase":"approved","issues":["7"]}', '{"phase":"delivered","issues":["8"]}'];
    expect(unfinishedIssuesOf(lines)).toEqual(new Set(['7', '8']));
  });

  it('reads no sibling as no unfinished issue', () => {
    expect(unfinishedIssuesOf([])).toEqual(new Set());
  });

  it('skips a blank line between records', () => {
    const lines = ['{"phase":"approved","issues":["7"]}', '', '  '];
    expect(unfinishedIssuesOf(lines)).toEqual(new Set(['7']));
  });

  // #2374 (4): one unparseable record must stop the whole read rather than
  // silently dropping that line — an unreadable sibling set is not an empty one.
  it('reads unreadable where any one line is not a guarded record, naming nothing it could not parse', () => {
    expect(unfinishedIssuesOf(['{"phase":"approved","issues":["7"]}', 'not json'])).toBe('unreadable');
  });
});

describe('a release’s per-issue outcomes tally into a summary', () => {
  it('reports every issue closed, with no reasons, where none was left open', () => {
    expect(releaseIssueSummary(['closed', 'closed'])).toEqual({ closed: 2, leftOpen: 0, reasons: {} });
  });

  it('reports an empty release as nothing closed and nothing left open', () => {
    expect(releaseIssueSummary([])).toEqual({ closed: 0, leftOpen: 0, reasons: {} });
  });

  it('counts each left-open reason separately', () => {
    expect(releaseIssueSummary(['closed', 'another-plan-unfinished', 'another-plan-unfinished', 'failed'])).toEqual({
      closed: 1,
      leftOpen: 3,
      reasons: { 'another-plan-unfinished': 2, failed: 1 },
    });
  });

  it('omits a reason that never occurred rather than reporting it as zero', () => {
    expect(releaseIssueSummary(['closed', 'no-target']).reasons).toEqual({ 'no-target': 1 });
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
