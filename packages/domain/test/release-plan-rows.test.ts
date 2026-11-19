import { describe, expect, it } from 'vitest';
import {
  doneDetail,
  headerCountParts,
  headerCounts,
  headerText,
  mergedFactOf,
  planLines,
  planRowFacts,
  planStrip,
  releaseBlocks,
  releaseDeliveryHeader,
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

describe('the relative merge time of a Done line', () => {
  const NOW = new Date('2026-11-19T12:00:00Z');
  const daysBefore = (n: number): string => new Date(NOW.getTime() - n * 86_400_000).toISOString();
  const merged = (mergedAt: string | undefined) => planLines([slice('a', 'delivered', { merged: { pr: 5, ...(mergedAt === undefined ? {} : { mergedAt }) } })], NOW)[0]!;
  it('is absent for no merge time, an empty one or one that does not parse', () => {
    expect(merged(undefined).merged).toBeUndefined();
    expect(merged('').merged).toBeUndefined();
    expect(merged('not a date').merged).toBeUndefined();
  });
  it('is absent where the caller has no clock', () => {
    expect(planLines([slice('a', 'delivered', { merged: { pr: 5, mergedAt: daysBefore(1) } })])[0]!.merged).toBeUndefined();
  });
  it('reads merged today for the same day, for equal times and for a merge ahead of the clock', () => {
    expect(merged(daysBefore(0.1)).merged).toBe('merged today');
    expect(merged(NOW.toISOString()).merged).toBe('merged today');
    expect(merged(daysBefore(-1)).merged).toBe('merged today');
  });
  it('reads merged yesterday for one day', () => {
    expect(merged(daysBefore(1)).merged).toBe('merged yesterday');
  });
  it('reads N days ago from 2 to 6 days and N weeks ago from 7 to 29', () => {
    expect(merged(daysBefore(2)).merged).toBe('merged 2 days ago');
    expect(merged(daysBefore(6)).merged).toBe('merged 6 days ago');
    expect(merged(daysBefore(7)).merged).toBe('merged 1 weeks ago');
    expect(merged(daysBefore(29)).merged).toBe('merged 4 weeks ago');
  });
  it('reads the locale date from 30 days', () => {
    expect(merged(daysBefore(30)).merged).toBe(`merged ${new Date(daysBefore(30)).toLocaleDateString()}`);
  });
  it('keeps text with the ISO date', () => {
    expect(merged('2026-11-17T08:00:00Z').text).toBe('✓ merged · a · #5 · 2026-11-17');
  });
});

describe('the fields of a plan line', () => {
  it('carries the slice state on every line', () => {
    expect(planLines(five).map((l) => l.state)).toEqual(['delivered', 'at-a-gate', 'being-built', 'blocked', 'not-started']);
  });
  it('carries the merged PR on a Done line and a carried open PR on an In flight line', () => {
    const lines = planLines([
      slice('a', 'delivered', { merged: { pr: 9, mergedAt: '2026-11-01T00:00:00Z' } }),
      slice('b', 'at-a-gate', { pr: 12 }),
      slice('c', 'being-built'),
    ]);
    expect(lines.map((l) => l.pr)).toEqual([9, 12, undefined]);
  });
});

describe('the phase of a plan row', () => {
  it('gives a default phase its own name as the accent', () => {
    expect(planRowFacts('p', '', five, { phase: 'Development' })).toMatchObject({ phase: 'Development', accent: 'Development' });
  });
  it('gives a declared phase the neutral accent', () => {
    expect(planRowFacts('p', '', five, { phase: 'Shaping' })).toMatchObject({ phase: 'Shaping', accent: 'neutral' });
  });
  it('leaves phase and accent absent where no row names a phase', () => {
    for (const phase of [null, undefined, ''] as const) {
      const facts = planRowFacts('p', '', five, { phase });
      expect('phase' in facts).toBe(false);
      expect('accent' in facts).toBe(false);
    }
  });
});

describe('headerCountParts', () => {
  const rows = [planRowFacts('p', '', five), planRowFacts('q', '', [slice('x', 'unread'), slice('y', 'delivered')])];
  it('prints the figures headerText prints, with and without the strip', () => {
    const counts = headerCounts(rows);
    for (const strip of [undefined, { blocked: 1 }]) {
      const joined = headerCountParts(counts, strip).map((p) => `${p.count} ${p.words}`).join(' · ');
      expect(headerText(counts, '', strip)).toBe(joined);
    }
  });
  it('prints unread only above 0 and blocked only with a strip', () => {
    expect(headerCountParts(headerCounts([planRowFacts('p', '', five)])).map((p) => p.key)).toEqual(['plans', 'delivered']);
    expect(headerCountParts(headerCounts(rows), { blocked: 0 }).map((p) => p.key)).toEqual(['plans', 'delivered', 'blocked', 'unread']);
  });
});

describe('headerCountParts with an at-a-gate count', () => {
  it('prints at a gate between delivered and blocked, and agrees with headerText', () => {
    const counts = headerCounts([planRowFacts('p', '', five)]);
    const strip = { blocked: 1, 'at-a-gate': 0 };
    expect(headerCountParts(counts, strip).map((p) => p.key)).toEqual(['plans', 'delivered', 'at-a-gate', 'blocked']);
    expect(headerText(counts, '', strip)).toBe('1 plan · 1 of 5 slices delivered · 0 at a gate · 1 blocked');
  });
});

describe('releaseDeliveryHeader', () => {
  const gated = planRowFacts('gated', '', [slice('g', 'at-a-gate'), slice('h', 'delivered')]);
  const done = planRowFacts('done', '', [slice('a', 'delivered')]);
  const open = planRowFacts('open', '', five);
  const unread = planRowFacts('unread', '', [slice('u', 'unread')]);

  it('shows every count of 0 with no target', () => {
    const head = releaseDeliveryHeader('Release delivery', [{ scope: '2.35.0', rows: [done] }]);
    expect(head.counts.map((c) => [c.key, c.count, c.words, c.target])).toEqual([
      ['plans', 1, 'plan', 'done'],
      ['delivered', 1, 'of 1 slices delivered', 'done'],
      ['at-a-gate', 0, 'at a gate', null],
      ['blocked', 0, 'blocked', null],
    ]);
  });

  it('links a non-zero count to the first plan row holding a slice it counts', () => {
    const head = releaseDeliveryHeader('Release delivery', [{ scope: '2.36.0', rows: [done, gated, open] }]);
    const target = Object.fromEntries(head.counts.map((c) => [c.key, c.target]));
    expect(target).toEqual({ plans: 'done', delivered: 'done', 'at-a-gate': 'gated', blocked: 'open' });
    expect(head.counts.find((c) => c.key === 'at-a-gate')!.count).toBe(2);
  });

  it('keeps an unread count as not read, never a 0, and links it', () => {
    const head = releaseDeliveryHeader('Release delivery', [{ scope: '', rows: [done, unread] }]);
    expect(head.counts.at(-1)).toEqual({ key: 'unread', count: 1, words: 'not read', target: 'unread' });
    expect(releaseDeliveryHeader('Release delivery', [{ scope: '', rows: [done] }]).counts.some((c) => c.key === 'unread')).toBe(false);
  });

  it('names the scope of one block only', () => {
    expect(releaseDeliveryHeader('Sprint delivery', [{ scope: 'bug-fixes-2-36-0', rows: [done] }])).toMatchObject({ name: 'Sprint delivery', scope: 'bug-fixes-2-36-0' });
    expect(releaseDeliveryHeader('Release delivery', [{ scope: '2.35.0', rows: [done] }, { scope: '2.36.0', rows: [gated] }]).scope).toBe('');
    expect(releaseDeliveryHeader('Release delivery', []).scope).toBe('');
  });

  it('counts a plan two blocks list once', () => {
    const head = releaseDeliveryHeader('Sprint delivery', [{ scope: 's1', rows: [done, gated] }, { scope: 's2', rows: [gated] }]);
    expect(head.counts.slice(0, 3).map((c) => c.count)).toEqual([2, 2, 1]);
  });
});
