import { describe, it, expect } from 'vitest';
import { reviewIssueUrl, reviewRequestBlock, reviewVerdict } from '../src/rules/review-verdict.js';

const refused = (text: string): string => {
  const verdict = reviewVerdict(text);
  if (verdict.read !== 'refused') throw new Error('expected a refusal');
  return verdict.why;
};

describe('reviewVerdict', () => {
  it('reads the counts from the one Findings line', () => {
    expect(reviewVerdict('- a finding\n\nFindings: HIGH 2, MEDIUM 0, LOW 11\n')).toEqual({
      read: 'counted',
      counts: { high: 2, medium: 0, low: 11 },
    });
  });

  it('reads a file with CRLF line endings', () => {
    expect(reviewVerdict('x\r\nFindings: HIGH 0, MEDIUM 1, LOW 0\r\n')).toEqual({
      read: 'counted',
      counts: { high: 0, medium: 1, low: 0 },
    });
  });

  it('refuses a file with no Findings line', () => {
    expect(refused('- a finding\nno counts here\n')).toMatch(/no "Findings:" line/);
    expect(refused('')).toMatch(/no "Findings:" line/);
  });

  it('refuses a file with two Findings lines', () => {
    expect(refused('Findings: HIGH 0, MEDIUM 0, LOW 0\nFindings: HIGH 1, MEDIUM 0, LOW 0\n')).toMatch(/2 "Findings:" lines/);
  });

  it('refuses a non-integer count', () => {
    expect(refused('Findings: HIGH two, MEDIUM 0, LOW 0')).toMatch(/not "Findings: HIGH/);
    expect(refused('Findings: HIGH 1.5, MEDIUM 0, LOW 0')).toMatch(/not "Findings: HIGH/);
    expect(refused('Findings: HIGH -1, MEDIUM 0, LOW 0')).toMatch(/not "Findings: HIGH/);
    expect(refused('Findings: HIGH , MEDIUM 0, LOW 0')).toMatch(/not "Findings: HIGH/);
  });

  it('refuses counts in another order or with a severity missing', () => {
    expect(refused('Findings: MEDIUM 0, HIGH 0, LOW 0')).toMatch(/not "Findings: HIGH/);
    expect(refused('Findings: HIGH 0, MEDIUM 0')).toMatch(/not "Findings: HIGH/);
  });

  it('refuses a count beyond the safe integer range', () => {
    expect(refused('Findings: HIGH 99999999999999999999, MEDIUM 0, LOW 0')).toMatch(/out of range/);
  });
});

describe('reviewIssueUrl', () => {
  it('composes a Jira key against the tracker address', () => {
    expect(reviewIssueUrl('jira', 'https://j.example/', 'PROJ-12', 'https://github.com/o/r/pull/3')).toBe(
      'https://j.example/browse/PROJ-12',
    );
  });

  it('composes a GitHub issue from the PR URL', () => {
    expect(reviewIssueUrl('github-issues', '', '41', 'https://github.com/o/r/pull/3')).toBe(
      'https://github.com/o/r/issues/41',
    );
  });

  it('answers null where nothing composes', () => {
    expect(reviewIssueUrl('jira', '', 'PROJ-12', 'https://github.com/o/r/pull/3')).toBeNull();
    expect(reviewIssueUrl('github-issues', '', 'abc', 'https://github.com/o/r/pull/3')).toBeNull();
    expect(reviewIssueUrl('github-issues', '', '41', '')).toBeNull();
  });
});

describe('reviewRequestBlock', () => {
  it('names the PR, the head, the base, the rubric, the read-only rule and the file', () => {
    const block = reviewRequestBlock({ pr: 7, headSha: 'abc123', base: 'main', verdictFile: '/g/plot/state/reviews/7-abc123.md' });
    for (const part of ['#7', 'abc123', 'main', 'HIGH:', 'MEDIUM:', 'LOW:', 'Read-only', '/g/plot/state/reviews/7-abc123.md', 'Findings: HIGH <n>']) {
      expect(block).toContain(part);
    }
  });
});
