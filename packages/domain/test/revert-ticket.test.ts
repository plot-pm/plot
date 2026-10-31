import { describe, expect, it } from 'vitest';

import {
  REVERT_TICKET_LABEL,
  planSlugOfBranch,
  revertTicketBody,
  revertTicketHead,
  revertTicketTitle,
} from '../src/rules/revert-ticket.js';

describe('revert ticket', () => {
  it('carries the label every Plot ticket carries', () => {
    expect(REVERT_TICKET_LABEL).toBe('ai-generated');
  });

  it('keys the record head and the title by PR number', () => {
    expect(revertTicketHead(12)).toBe('revert-12');
    expect(revertTicketTitle(12)).toContain('PR #12');
  });

  it('reads the plan from the part of the branch after the first slash', () => {
    expect(planSlugOfBranch('feature/the-slug')).toBe('the-slug');
    expect(planSlugOfBranch('feature/a/b')).toBe('a/b');
    expect(planSlugOfBranch('nobranchprefix')).toBe('');
  });

  it('names the reverted PR, its plan, the revert PR and the red commit', () => {
    const body = revertTicketBody({ revertedPr: 12, revertedBranch: 'feature/the-slug', revertPr: 13, firstRedSha: 'abc' });
    expect(body).toContain('Reverted PR: #12');
    expect(body).toContain('Plan: the-slug');
    expect(body).toContain('Revert PR: #13');
    expect(body).toContain('abc');
  });

  it('says so where the branch name gives no plan', () => {
    const body = revertTicketBody({ revertedPr: 12, revertedBranch: 'detached', revertPr: 13, firstRedSha: 'abc' });
    expect(body).toContain('Plan: not derivable from the branch name');
  });
});
