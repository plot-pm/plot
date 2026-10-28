import { describe, it, expect } from 'vitest';
import { armedLabel } from '../../src/app/components/CreatePlanButton.js';
import type { IssueRow } from '../../src/contract/schema.js';

/**
 * The issue row's one action — the decisions that reduce to functions.
 *
 * What only a rendered page can settle (the confirmation arms, a double click
 * sends one POST, the body carries only a number) lives in
 * `test/integration/issue-becomes-a-plan.browser.test.ts`.
 *
 * **`refusalReason`'s cases moved to `@plot-pm/domain`'s
 * `create-from-issue.test.ts`** — it delegates to `createFromIssueVerdict`,
 * which both `CreatePlanButton` and `CreateStoryButton` now share, so the
 * refusal-order cases are pinned once rather than per button.
 */

const issue = (over: Partial<IssueRow> = {}): IssueRow => ({
  number: 228, title: 'Fleet scan asks the host once per branch', url: '', ageMinutes: 120,
  ...over,
});

describe('the armed label names the boundary, not just the act', () => {
  it('says Draft, because that is what the reader is committing to', () => {
    // A label reading only "create a plan" would leave a reader wondering
    // whether the click also commits the work — precisely the decision this row
    // asks them to make separately.
    expect(armedLabel(issue())).toBe('Create plan — Draft for #228?');
  });
});
