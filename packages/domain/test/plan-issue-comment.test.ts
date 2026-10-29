import { describe, expect, it } from 'vitest';

import { filled, planIssueComment, priorPlanLinesOf, PLAN_STATE_MARKER } from '../src/rules/plan-issue-comment.js';
import type { PlanStateWrite } from '../src/ports/tracker.js';

const write = (extra: Partial<PlanStateWrite> = {}): PlanStateWrite => ({
  issue: '#1979',
  phase: 'approved',
  planLink: 'https://github.com/o/r/blob/main/docs/plans/2026-10-17-a-planned-issue.md',
  ...extra,
});

describe('planIssueComment', () => {
  it('renders a body byte-identical to the historic two-line body when progress and tickets are both absent', () => {
    const body = planIssueComment(write());
    expect(body).toBe(`${PLAN_STATE_MARKER}\nPlan approved: https://github.com/o/r/blob/main/docs/plans/2026-10-17-a-planned-issue.md`);
  });

  it('names the version only at released', () => {
    const body = planIssueComment(write({ phase: 'released', version: 'v1.2.3' }));
    expect(body.split('\n')[1]).toBe(
      'Plan released in v1.2.3: https://github.com/o/r/blob/main/docs/plans/2026-10-17-a-planned-issue.md',
    );
  });

  it('keeps the progress line and every ticket link on a Delivered write', () => {
    const body = planIssueComment(
      write({
        phase: 'delivered',
        sliceProgress: '2 of 3 slices merged',
        highTickets: [{ title: 'Fix the flaky test', url: 'https://github.com/o/r/issues/2001' }],
      }),
    );
    expect(body).toBe(
      [
        PLAN_STATE_MARKER,
        'Plan delivered: https://github.com/o/r/blob/main/docs/plans/2026-10-17-a-planned-issue.md',
        '2 of 3 slices merged',
        '- [Fix the flaky test](https://github.com/o/r/issues/2001)',
      ].join('\n'),
    );
  });

  it('keeps the progress line and every ticket link on a Released write', () => {
    const body = planIssueComment(
      write({
        phase: 'released',
        version: 'v2',
        sliceProgress: '3 of 3 slices merged',
        highTickets: [
          { title: 'A', url: 'https://x/1' },
          { title: 'B', url: 'https://x/2' },
        ],
      }),
    );
    expect(body.split('\n')).toEqual([
      PLAN_STATE_MARKER,
      'Plan released in v2: https://github.com/o/r/blob/main/docs/plans/2026-10-17-a-planned-issue.md',
      '3 of 3 slices merged',
      '- [A](https://x/1)',
      '- [B](https://x/2)',
    ]);
  });

  it('renders no ticket lines where highTickets is an explicit empty array, keeping the progress line', () => {
    const body = planIssueComment(write({ sliceProgress: '0 of 3 slices merged', highTickets: [] }));
    expect(body.split('\n')).toEqual([
      PLAN_STATE_MARKER,
      'Plan approved: https://github.com/o/r/blob/main/docs/plans/2026-10-17-a-planned-issue.md',
      '0 of 3 slices merged',
    ]);
  });
});

describe('priorPlanLinesOf', () => {
  it('reads no progress and no tickets from a two-line body', () => {
    const prior = priorPlanLinesOf(planIssueComment(write()));
    expect(prior).toEqual({ sliceProgress: null, highTickets: [] });
  });

  it('reads the progress line and every ticket link back from a rendered body', () => {
    const body = planIssueComment(
      write({
        sliceProgress: '1 of 2 slices merged',
        highTickets: [{ title: 'Fix it', url: 'https://x/9' }],
      }),
    );
    expect(priorPlanLinesOf(body)).toEqual({
      sliceProgress: '1 of 2 slices merged',
      highTickets: [{ title: 'Fix it', url: 'https://x/9' }],
    });
  });

  it('skips the marker and phase line whatever they say', () => {
    const prior = priorPlanLinesOf('garbage\nalso garbage\nsurvivor line');
    expect(prior.sliceProgress).toBe('survivor line');
  });
});

describe('filled', () => {
  it('fills absent progress and tickets from the prior body', () => {
    const result = filled(write(), {
      sliceProgress: '2 of 3 slices merged',
      highTickets: [{ title: 'T', url: 'https://x/1' }],
    });
    expect(result.sliceProgress).toBe('2 of 3 slices merged');
    expect(result.highTickets).toEqual([{ title: 'T', url: 'https://x/1' }]);
  });

  it('keeps a write-named field even where the prior body held a different value', () => {
    const result = filled(write({ sliceProgress: '3 of 3 slices merged', highTickets: [] }), {
      sliceProgress: '1 of 3 slices merged',
      highTickets: [{ title: 'Stale', url: 'https://x/0' }],
    });
    expect(result.sliceProgress).toBe('3 of 3 slices merged');
    expect(result.highTickets).toEqual([]);
  });

  it('leaves both absent where there is no prior body to read', () => {
    const result = filled(write(), null);
    expect(result.sliceProgress).toBeUndefined();
    expect(result.highTickets).toBeUndefined();
  });
});
