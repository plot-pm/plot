import { describe, expect, it } from 'vitest';

import { issueStatusWrites, type IssueStatusWords } from '../src/rules/issue-status.js';

const both: IssueStatusWords = { delivered: 'In Review', released: 'Done' };

describe('a finished plan owes its issues a status', () => {
  it('owes nothing where the plan names no issue, at either phase', () => {
    // The path 90% of plans take — a rule writing on phase alone fails here.
    expect(issueStatusWrites({ phase: 'delivered', issues: [], words: both })).toEqual([]);
    expect(issueStatusWrites({ phase: 'released', issues: [], words: both })).toEqual([]);
  });

  it.each(['approved', 'draft', 'design'])('owes nothing at %s, issues and words notwithstanding', (phase) => {
    expect(issueStatusWrites({ phase, issues: ['935'], words: both })).toEqual([]);
  });

  it('never falls back from one phase’s word to the other’s', () => {
    const deliveredOnly = { delivered: 'In Review', released: '' };
    expect(issueStatusWrites({ phase: 'released', issues: ['935'], words: deliveredOnly })).toEqual([]);
    const releasedOnly = { delivered: '', released: 'Done' };
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

  it('owes one write per issue, not the first alone', () => {
    expect(issueStatusWrites({ phase: 'released', issues: ['1', '2'], words: both })).toEqual([
      { issue: '1', status: 'Done' },
      { issue: '2', status: 'Done' },
    ]);
  });

  it('carries a non-standard word verbatim', () => {
    const words = { delivered: '', released: 'Shipped to prod' };
    expect(issueStatusWrites({ phase: 'released', issues: ['PROJ-7'], words })).toEqual([
      { issue: 'PROJ-7', status: 'Shipped to prod' },
    ]);
  });
});
