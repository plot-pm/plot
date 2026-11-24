import { describe, it, expect } from 'vitest';
import {
  deliveryMetrics,
  deliveryMetricsLines,
  isoWeekOf,
  lastIsoWeeks,
  median,
  planTransitionsOf,
  recordDay,
  weekLabel,
  type PlanTransitions,
} from '../src/rules/delivery-metrics.js';

const plan = (over: Partial<PlanTransitions> = {}): PlanTransitions => ({ design: '', approved: '', delivered: '', released: '', ...over });

const at = (iso: string): number => Date.parse(iso);

/** The weeks from the one holding `first` to the one holding `last`, both included. */
const weeksBetween = (first: string, last: string): ReturnType<typeof lastIsoWeeks> => {
  const from = isoWeekOf(at(first)).monday;
  const to = isoWeekOf(at(last)).monday;
  return lastIsoWeeks(to, Math.round((to - from) / (7 * 86_400_000)) + 1);
};

describe('planTransitionsOf', () => {
  it('reads the four records from ## Status and nothing below it', () => {
    const text = [
      '# A plan',
      '',
      '## Status',
      '',
      '- **State:** Delivered',
      '- **Design:** 2026-11-01, eins78, cli',
      '- **Approved:** 2026-11-03, jwloka, plan-PR #12 merged',
      '- **Started:** 2026-11-04, Jan Wloka, `feature/x`',
      '- **Delivered:** 2026-11-10, jwloka, PR #14',
      '',
      '## Notes',
      '',
      '- **Released:** 2026-12-01, v1.0.0',
    ].join('\n');
    expect(planTransitionsOf(text)).toEqual({
      design: '2026-11-01, eins78, cli',
      approved: '2026-11-03, jwloka, plan-PR #12 merged',
      delivered: '2026-11-10, jwloka, PR #14',
      released: '',
    });
  });

  it('reads a template placeholder as no record and lets a later filled line win', () => {
    const text = ['## Status', '- **Delivered:** <!-- YYYY-MM-DD -->', '- **Delivered:** 2026-11-10'].join('\n');
    expect(planTransitionsOf(text).delivered).toBe('2026-11-10');
    expect(planTransitionsOf('## Status\n- **Delivered:** <!-- YYYY-MM-DD -->\n').delivered).toBe('');
  });
});

describe('recordDay', () => {
  it('reads the leading date and refuses a placeholder or an impossible date', () => {
    expect(recordDay('2026-11-24, jwloka, pr')).toBe(Date.UTC(2026, 10, 24));
    expect(recordDay('2026-11-24T10:00:00Z')).toBe(Date.UTC(2026, 10, 24));
    expect(recordDay('<date>')).toBeNull();
    expect(recordDay('2026-02-30')).toBeNull();
    expect(recordDay('')).toBeNull();
  });
});

describe('isoWeekOf', () => {
  it('puts a Sunday and the following Monday in different weeks', () => {
    expect(weekLabel(isoWeekOf(at('2026-11-22')))).toBe('2026-W47');
    expect(weekLabel(isoWeekOf(at('2026-11-23')))).toBe('2026-W48');
  });

  it('keeps 2026-12-28 to 2027-01-03 in week 53 of 2026', () => {
    expect(weekLabel(isoWeekOf(at('2026-12-28')))).toBe('2026-W53');
    expect(weekLabel(isoWeekOf(at('2027-01-03T23:59:59Z')))).toBe('2026-W53');
    expect(weekLabel(isoWeekOf(at('2027-01-04')))).toBe('2027-W01');
  });
});

describe('median', () => {
  it('takes the middle value of an odd count and the mean of the two middle values of an even count', () => {
    expect(median([9, 1, 3])).toBe(3);
    expect(median([1, 30, 2, 4])).toBe(3);
    expect(median([])).toBeNull();
  });
});

describe('deliveryMetrics', () => {
  it('reports weeks with and without deliveries', () => {
    const weeks = weeksBetween('2026-11-09', '2026-11-23');
    const rows = deliveryMetrics(
      [plan({ approved: '2026-11-05, jwloka, pr', delivered: '2026-11-11, jwloka' })],
      [],
      weeks,
    );
    expect(rows.map((r) => [r.week, r.delivered, r.leadDays])).toEqual([
      ['2026-W46', 1, 6],
      ['2026-W47', 0, null],
      ['2026-W48', 0, null],
    ]);
  });

  it('takes the mean of the two middle lead times over an even count of deliveries', () => {
    const delivered = '2026-11-20';
    const rows = deliveryMetrics(
      [
        plan({ approved: '2026-11-19, a, pr', delivered }),
        plan({ approved: '2026-11-17, a, pr', delivered }),
        plan({ approved: '2026-11-15, a, pr', delivered }),
        plan({ approved: '2026-10-21, a, pr', delivered }),
      ],
      [],
      weeksBetween(delivered, delivered),
    );
    expect(rows[0].leadDays).toBe(4);
  });

  it('counts a Sunday delivery and the next Monday delivery in two weeks', () => {
    const rows = deliveryMetrics(
      [plan({ delivered: '2026-11-22' }), plan({ delivered: '2026-11-23' })],
      [],
      weeksBetween('2026-11-22', '2026-11-23'),
    );
    expect(rows.map((r) => r.delivered)).toEqual([1, 1]);
  });

  it('counts a delivered plan with no Approved: line and gives it no lead time', () => {
    const rows = deliveryMetrics([plan({ delivered: '2026-11-23' })], [], weeksBetween('2026-11-23', '2026-11-23'));
    expect(rows[0].delivered).toBe(1);
    expect(rows[0].leadDays).toBeNull();
    expect(deliveryMetricsLines(rows).join('\n')).not.toContain('NaN');
  });

  it('counts a placeholder or an unparseable date nowhere and keeps undelivered plans in the approved and released counts', () => {
    const rows = deliveryMetrics(
      [
        plan({ approved: '2026-11-23, jwloka, pr', delivered: '<!-- YYYY-MM-DD -->' }),
        plan({ approved: '<date>', delivered: 'soon' }),
        plan({ approved: '2026-11-24, eins78, pr', released: '2026-11-25, v1.2.0' }),
      ],
      [],
      weeksBetween('2026-11-23', '2026-11-23'),
    );
    expect(rows[0]).toMatchObject({ approved: 2, delivered: 0, released: 1, leadDays: null });
    expect([...rows[0].approvers]).toEqual([['jwloka', 1], ['eins78', 1]]);
  });

  it('reports design-to-approval days in the delivery week', () => {
    const rows = deliveryMetrics(
      [plan({ design: '2026-11-10, eins78, cli', approved: '2026-11-13, jwloka, pr', delivered: '2026-11-23' })],
      [],
      weeksBetween('2026-11-23', '2026-11-23'),
    );
    expect(rows[0]).toMatchObject({ leadDays: 10, designDays: 3 });
  });

  it('counts the merged rows per week and prints 0 for a readable index with none', () => {
    const rows = deliveryMetrics(
      [],
      ['2026-11-22T23:59:59Z', '2026-11-23T00:00:00Z', '2026-11-24T12:00:00Z', 'not a date'],
      weeksBetween('2026-11-09', '2026-11-23'),
    );
    expect(rows.map((r) => r.merged)).toEqual([0, 1, 2]);
  });

  it('reports merged as unread in every week when the index could not be read', () => {
    const rows = deliveryMetrics([plan({ delivered: '2026-11-23' })], null, weeksBetween('2026-11-09', '2026-11-23'));
    expect(rows.map((r) => r.merged)).toEqual(['unread', 'unread', 'unread']);
    expect(deliveryMetricsLines(rows)[1]).toMatch(/^2026-W46\s+unread\s/);
  });

  it('covers every requested week when the history is shorter', () => {
    const weeks = lastIsoWeeks(at('2026-11-24T08:00:00Z'), 12);
    const rows = deliveryMetrics([plan({ delivered: '2026-11-24' })], [], weeks);
    expect(rows).toHaveLength(12);
    expect(rows[0].week).toBe('2026-W37');
    expect(rows[11]).toMatchObject({ week: '2026-W48', delivered: 1 });
  });
});
