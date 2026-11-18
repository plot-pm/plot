import { describe, expect, it } from 'vitest';
import {
  doneDetail,
  headerCounts,
  headerText,
  mergedFactOf,
  planLines,
  planRowFacts,
  planStrip,
  releaseBlocks,
  stripText,
  type PlanSliceFact,
} from '../src/rules/release-plan-rows.js';

const slice = (name: string, state: PlanSliceFact['state'], more: Partial<PlanSliceFact> = {}): PlanSliceFact => ({
  name, state, linked: false, startable: false, waitsFor: '', begun: false, ...more,
});

const five = [
  slice('a', 'delivered'),
  slice('b', 'at-a-gate', { linked: true }),
  slice('c', 'being-built', { linked: true }),
  slice('d', 'blocked', { linked: true }),
  slice('e', 'not-started'),
];

describe('the strip', () => {
  it('sums its five states to the slice count', () => {
    expect(planStrip(five).reduce((n, s) => n + s.count, 0)).toBe(five.length);
    expect(stripText(five)).toBe('1 / 5 delivered');
  });
  it('says progress not read, never 0 / 5, where no slice has a reading', () => {
    expect(stripText([slice('a', 'unread'), slice('b', 'unread')])).toBe('progress not read');
    expect(stripText([])).toBe('progress not read');
  });
  it('keeps an unread slice outside the total', () => {
    const slices = [slice('a', 'delivered'), slice('b', 'unread')];
    expect(stripText(slices)).toBe('1 / 1 delivered');
    expect(planRowFacts('p', '', slices).unread).toBe(1);
  });
});

describe('the Done line', () => {
  it('carries the PR number and date of a merged row', () => {
    expect(doneDetail({ pr: 12, mergedAt: '2026-11-16T10:00:00Z' })).toBe(' · #12 · 2026-11-16');
  });
  it('is bare where the store gave nothing or no merge time', () => {
    expect(doneDetail(undefined)).toBe('');
    expect(doneDetail({ pr: 12, mergedAt: '' })).toBe('');
  });
  it('shows a named commit as a short hash with no date', () => {
    expect(doneDetail({ commit: 'abcdef1234567' })).toBe(' · abcdef1');
  });
});

describe('the opened lines', () => {
  it('lists every slice under exactly one heading', () => {
    const lines = planLines(five);
    expect(lines).toHaveLength(five.length);
    expect(lines.map((l) => l.heading)).toEqual(['done', 'in-flight', 'in-flight', 'in-flight', 'to-do']);
  });
  it('links an in-flight slice only where its item is placed', () => {
    const lines = planLines([slice('a', 'being-built', { linked: true }), slice('b', 'being-built')]);
    expect(lines.map((l) => l.link)).toEqual([true, false]);
  });
  it('gives Start to a startable To do slice, with the slice it waits for across plans', () => {
    const [line] = planLines([slice('x', 'not-started', { startable: true, waitsFor: 'other-plan › y' })]);
    expect(line?.start).toBe(true);
    expect(line?.text).toBe('x · waits for other-plan › y');
  });
  it('gives no Start to a To do slice that is not startable', () => {
    expect(planLines([slice('x', 'not-started')])[0]?.start).toBe(false);
  });
});

describe('release blocks', () => {
  const approved = ['p1', 'p2', 'p3'];
  it('counts a plan once where two sprints name it', () => {
    const blocks = releaseBlocks([
      { release: '2.0', members: ['p1', 'p2'] },
      { release: '2.0', members: ['p2'] },
    ], approved);
    expect(blocks).toEqual([{ release: '2.0', plans: ['p1', 'p2'] }]);
  });
  it('gives two blocks for two Release values', () => {
    expect(releaseBlocks([
      { release: '2.0', members: ['p1'] },
      { release: '2.1', members: ['p2'] },
    ], approved).map((b) => b.release)).toEqual(['2.0', '2.1']);
  });
  it('lists every approved plan where no sprint names a release', () => {
    expect(releaseBlocks([{ release: '', members: ['p1'] }], approved)).toEqual([{ release: '', plans: approved }]);
  });
});

describe('the header', () => {
  it('counts plans and slices over the block', () => {
    const rows = [planRowFacts('a', '', five), planRowFacts('b', '', [slice('z', 'unread')])];
    const counts = headerCounts(rows);
    expect(counts).toEqual({ plans: 2, delivered: 1, total: 5, unread: 1 });
    expect(headerText(counts, '2.0')).toBe('2.0 · 2 plans · 1 of 5 slices delivered · 1 not read');
  });

  it('says one plan in the singular, omits an empty release and a read block, and adds the blocked figure', () => {
    const counts = headerCounts([planRowFacts('a', '', five)]);
    expect(headerText({ ...counts, unread: 0 }, '', { blocked: 2 })).toBe('1 plan · 1 of 5 slices delivered · 2 blocked');
  });
});

describe('mergedFactOf', () => {
  const row = (over: Record<string, unknown>) => ({ number: 1, head: 'feature/a', state: 'MERGED', draft: false, checks: 'green', review: '', url: '', mergedAt: '2026-11-10T08:00:00Z', ...over });
  const index = (rows: unknown[], complete = true) => ({ complete, rows }) as never;

  it('returns the newest non-draft MERGED row of a complete index', () => {
    const fact = mergedFactOf(['feature/a'], index([row({ number: 4, mergedAt: '2026-11-01T00:00:00Z' }), row({ number: 9 }), row({ number: 12, draft: true, mergedAt: '2026-11-17T00:00:00Z' })]));
    expect(fact).toEqual({ pr: 9, mergedAt: '2026-11-10T08:00:00Z' });
  });

  it('reads a missing mergedAt as the empty time, and prefers a row that has one', () => {
    expect(mergedFactOf(['feature/a'], index([row({ number: 3, mergedAt: undefined })]))).toEqual({ pr: 3, mergedAt: '' });
    expect(mergedFactOf(['feature/a'], index([row({ number: 3, mergedAt: undefined }), row({ number: 5 })]))).toEqual({ pr: 5, mergedAt: '2026-11-10T08:00:00Z' });
    expect(mergedFactOf(['feature/a'], index([row({ number: 5 }), row({ number: 3, mergedAt: undefined })]))).toEqual({ pr: 5, mergedAt: '2026-11-10T08:00:00Z' });
  });

  it('answers nothing for a missing, partial or MERGED-free index', () => {
    expect(mergedFactOf(['feature/a'], null)).toBeUndefined();
    expect(mergedFactOf(['feature/a'], index([row({})], false))).toBeUndefined();
    expect(mergedFactOf(['feature/a'], index([row({ state: 'OPEN' })]))).toBeUndefined();
    expect(mergedFactOf(['feature/b'], index([row({})]))).toBeUndefined();
  });
});
