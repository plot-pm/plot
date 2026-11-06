import { describe, it, expect } from 'vitest';
import type { Issue } from '../src/entities/issue.js';
import { findOpenReviewIssue, readTicketVerdict, reviewIssueTitle, reviewTicketSettled, ticketStayOpenComment, TICKET_TRIAGE_MARKER } from '../src/rules/review-issue.js';

const issue = (id: string, title: string): Issue => ({
  id, title, url: '', createdAt: null, body: null, status: 'open', statusCategory: 'To Do', closedAt: null,
} as Issue);

describe('reviewIssueTitle', () => {
  it('names the PR and no counts, so a later head cannot contradict it', () => {
    expect(reviewIssueTitle(7)).toBe('plot-review: findings on PR #7');
  });
});

describe('findOpenReviewIssue', () => {
  it('matches the current title and the counted titles of issues opened before it', () => {
    expect(findOpenReviewIssue([issue('5', reviewIssueTitle(7))], 7)?.id).toBe('5');
    expect(findOpenReviewIssue([issue('6', 'plot-review: 2 HIGH findings on PR #7')], 7)?.id).toBe('6');
    expect(findOpenReviewIssue([issue('8', 'plot-review: MEDIUM 0, LOW 1 on PR #7')], 7)?.id).toBe('8');
  });

  it('does not match PR #1 against PR #12', () => {
    expect(findOpenReviewIssue([issue('5', reviewIssueTitle(12))], 1)).toBeNull();
    expect(findOpenReviewIssue([issue('5', reviewIssueTitle(1))], 12)).toBeNull();
  });

  it('does not match a title without the plot-review prefix', () => {
    expect(findOpenReviewIssue([issue('5', 'follow up on PR #7')], 7)).toBeNull();
  });

  it('answers null for no issues', () => {
    expect(findOpenReviewIssue([], 7)).toBeNull();
  });
});

describe('reviewTicketSettled', () => {
  const ticket = (findings = 'Findings: HIGH 0, MEDIUM 2, LOW 4') => ({ body: `Review.\n${findings}\n` });
  const verdict = (states: string[]) => `Default: abc1234\n${states.map((s, i) => `- finding ${i}: ${s}`).join('\n')}\n`;
  const six = ['fixed', 'fixed', 'wont-fix', 'not-reproduced', 'fixed', 'fixed'];

  it('settles when every one of the ticket\'s findings is judged settled', () => {
    expect(reviewTicketSettled(ticket(), verdict(six))).toBe('settled');
  });

  it('stays open on one still-true line', () => {
    expect(reviewTicketSettled(ticket(), verdict([...six.slice(0, 5), 'still-true']))).toBe('open');
  });

  it('is unjudged for a short verdict, a missing verdict, and an unreadable line', () => {
    expect(reviewTicketSettled(ticket(), verdict(six.slice(0, 5)))).toBe('unjudged');
    expect(reviewTicketSettled(ticket(), null)).toBe('unjudged');
    expect(reviewTicketSettled(ticket(), verdict([...six.slice(0, 5), 'maybe']))).toBe('unjudged');
    expect(reviewTicketSettled(ticket(), verdict(six).replace('Default: abc1234\n', ''))).toBe('unjudged');
    expect(reviewTicketSettled({ body: 'no count' }, verdict(six))).toBe('unjudged');
    expect(reviewTicketSettled({ body: null }, verdict(six))).toBe('unjudged');
    expect(reviewTicketSettled(ticket(), `Default: a\n${verdict(six)}`)).toBe('unjudged');
  });

  it('takes no merge state: the function has two parameters, a body and a verdict text', () => {
    expect(reviewTicketSettled.length).toBe(2);
    expect(reviewTicketSettled(ticket(), null)).toBe('unjudged');
  });

  it('renders the same comment for the same verdict and lists only still-true findings', () => {
    const read = readTicketVerdict(verdict(['fixed', 'still-true']))!;
    expect(ticketStayOpenComment(read)).toBe(ticketStayOpenComment(read));
    expect(ticketStayOpenComment(read)).toContain('- finding 1');
    expect(ticketStayOpenComment(read)).not.toContain('- finding 0');
    expect(ticketStayOpenComment(read).startsWith(TICKET_TRIAGE_MARKER)).toBe(true);
  });
});
