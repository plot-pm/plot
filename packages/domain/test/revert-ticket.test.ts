import { describe, expect, it } from 'vitest';

import {
  REVERT_TICKET_LABEL,
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

  it('names the reverted PR, its branch, its plan file, the revert PR and the red commit', () => {
    const body = revertTicketBody({
      revertedPr: 12,
      revertedBranch: 'feature/a-red-main-is-reverted',
      plan: 'docs/plans/2026-10-29-a-red-default-branch-is-repaired.md',
      revertPr: 13,
      firstRedSha: 'abc',
    });
    expect(body).toContain('Reverted PR: #12');
    expect(body).toContain('Branch: feature/a-red-main-is-reverted');
    expect(body).toContain('Plan: docs/plans/2026-10-29-a-red-default-branch-is-repaired.md');
    expect(body).toContain('Revert PR: #13');
    expect(body).toContain('abc');
  });

  it('says why the plan is not derivable, and never names the branch slug as the plan', () => {
    const facts = { revertedPr: 12, revertPr: 13, firstRedSha: 'abc' };
    expect(revertTicketBody({ ...facts, revertedBranch: 'feature/the-slug', plan: '' })).toContain(
      "Plan: not derivable: no plan's slices name feature/the-slug",
    );
    expect(revertTicketBody({ ...facts, revertedBranch: 'feature/the-slug', plan: undefined })).toContain(
      'Plan: not derivable: the plans were not read',
    );
    const unread = revertTicketBody({ ...facts, revertedBranch: undefined, plan: undefined });
    expect(unread).toContain('Branch: not read');
    expect(unread).toContain('Plan: not derivable: the branch of the reverted PR was not read');
  });
});
