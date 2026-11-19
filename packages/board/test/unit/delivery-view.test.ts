import { describe, it, expect } from 'vitest';
import { DELIVERY_LAYOUT, deliveryScope, parsePersonDirectory } from '@plot-pm/domain';
import type { AgentRow, DraftPlan, Slice } from '../../src/contract/schema.js';
import { deliveryMapping, sprintCardViewOf, type RegistryAgent } from '../../src/app/lib/agent-rows/delivery-readings.js';
import { GLYPH_PATH } from '../../src/app/lib/glyphs.js';
import { groupAnchor, nestItems, placeMapping, planBlockShown, summarise, type PlacedItemView } from '../../src/app/lib/agent-rows/delivery-view.js';

const row = (over: Record<string, unknown>): AgentRow => ({
  branch: '', plan: '', wave: '', kind: 'branch', phase: 'Development', state: 'wip',
  group: 'working', pr: null, question: null, blockedBy: null,
  assignee: '', author: '', approver: '', ...over,
}) as unknown as AgentRow;

const slice = (name: string): Slice => ({
  plan: 'p', name, branches: [], verdict: 'eligible', section: 'building', complete: false,
  planSliceCount: 1,
}) as unknown as Slice;

const agent = (over: Record<string, unknown>): RegistryAgent => ({
  session: 's', branch: '', state: 'running', pid: 1, ...over,
}) as unknown as RegistryAgent;

const view = (rows: AgentRow[], agents: RegistryAgent[] = []) => {
  const slices = ['A', 'B'].map(slice);
  return placeMapping(deliveryMapping({
    rows, slices, agents, drafts: [], reader: { hostUser: 'me' }, mode: 'all',
    config: { autoReview: true, correctionBudget: 2 },
  }), slices);
};

describe('delivery view order', () => {
  it('renders the sections and groups in exactly DELIVERY_LAYOUT order', () => {
    const v = view([]);
    expect(v.sections.map((s) => s.key)).toEqual(DELIVERY_LAYOUT.map((l) => l.section));
    for (const [i, layout] of DELIVERY_LAYOUT.entries()) {
      expect(v.sections[i]!.groups.map((g) => g.key)).toEqual([...layout.groups]);
    }
  });

  it('shows an item once and links its agent both ways', () => {
    const v = view(
      [row({ branch: 'feature/a', plan: 'p', wave: 'A' })],
      [agent({ session: 'x', branch: 'feature/a' })],
    );
    const items = v.sections.flatMap((s) => s.groups.flatMap((g) => g.items));
    const agents = v.sections.flatMap((s) => s.groups.flatMap((g) => g.agents));
    expect(items).toHaveLength(1);
    expect(agents).toHaveLength(1);
    expect(items[0]!.links.map((l) => l.anchor)).toEqual([agents[0]!.anchor]);
    expect(agents[0]!.links.map((l) => l.anchor)).toEqual([items[0]!.anchor]);
  });

  it('names a section hint without a forecast', () => {
    for (const s of view([]).sections) expect(s.hint).not.toContain('will finish');
  });
});

describe('delivery view nesting', () => {
  it('nests a plan\'s slices under one plan head per group', () => {
    const v = view([
      row({ branch: 'feature/a', plan: 'p', wave: 'A' }),
      row({ branch: 'feature/b', plan: 'p', wave: 'B' }),
    ]);
    const blocks = v.sections.flatMap((s) => s.groups.flatMap((g) => g.blocks));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'plan', plan: 'p' });
    expect(blocks[0]!.kind === 'plan' && blocks[0]!.slices).toHaveLength(2);
  });

  it('puts a delivered slice under Release delivery, not in a work group', () => {
    const v = view([row({ branch: 'feature/a', plan: 'p', wave: 'A', phase: 'Testing', state: 'merged', group: 'done' })]);
    expect(v.sections.flatMap((s) => s.groups.flatMap((g) => g.blocks))).toEqual([]);
    expect(v.releaseBlocks).toHaveLength(1);
    expect(v.releaseBlocks[0]!.plans).toHaveLength(1);
    expect(v.releaseRows).toHaveLength(1);
  });

  describe('Release delivery plan rows', () => {
    const merged = (plan: string, name: string) => row({ branch: `feature/${plan}-${name}`, plan, wave: name, phase: 'Testing', state: 'merged', group: 'done' });
    const mergedSlice = (plan: string, name: string): Slice => ({ ...slice(name), plan, complete: true, merge: 'merged' }) as Slice;
    const planView = (rows: AgentRow[], slices: Slice[], sprints: never[] = []) =>
      placeMapping(deliveryMapping({
        rows, slices, agents: [], drafts: [], reader: { hostUser: 'me' }, mode: 'all',
        config: { autoReview: true, correctionBudget: 2 },
      }), slices, sprints);

    it('gives 40 merged slices over 8 plans 8 rows', () => {
      const plans = Array.from({ length: 8 }, (_, i) => `plan-${i}`);
      const slices = plans.flatMap((p) => ['a', 'b', 'c', 'd', 'e'].map((n) => mergedSlice(p, n)));
      const rows = slices.map((s) => merged(s.plan, s.name));
      const v = planView(rows, slices);
      expect(v.releaseBlocks).toHaveLength(1);
      expect(v.releaseBlocks[0]!.plans).toHaveLength(8);
      expect(v.releaseBlocks[0]!.header).toBe('8 plans · 40 of 40 slices delivered · 0 blocked');
      expect(v.releaseBlocks[0]!.plans[0]!.stripText).toBe('5 / 5 delivered');
    });

    it('names the approver as Owner of a plan that no sprint lists, by its People handle', () => {
      const slices = [mergedSlice('p1', 'a'), mergedSlice('p2', 'a')];
      const rows = [
        { ...merged('p1', 'a'), approver: 'Jan Wloka', author: 'Jan Wloka' },
        { ...merged('p2', 'a'), approver: '', author: 'Max Albrecht' },
      ] as AgentRow[];
      const v = placeMapping(deliveryMapping({
        rows, slices, agents: [], drafts: [], mode: 'all', config: { autoReview: true, correctionBudget: 2 },
        reader: { hostUser: 'me', directory: parsePersonDirectory('jwloka = Jan Wloka; eins78 = Max Albrecht') },
      }), slices);
      expect(v.releaseBlocks[0]!.plans.map((p) => [p.plan, p.owner])).toEqual([['p1', 'jwloka'], ['p2', 'eins78']]);
    });

    it('links a plan row to its plan route, and leaves a row with no plan file unlinked', () => {
      const slices = [mergedSlice('p1', 'a'), mergedSlice('p2', 'a')];
      const rows = [{ ...merged('p1', 'a'), planFile: 'docs/plans/2026-11-01-p1.md' }, merged('p2', 'a')] as AgentRow[];
      const v = planView(rows, slices);
      expect(v.releaseBlocks[0]!.plans.map((p) => [p.plan, p.href])).toEqual([['p1', '/plan/2026-11-01-p1.md'], ['p2', '']]);
    });

    it('lists a slice with no branch and no agent under To do, not as a Work items row', () => {
      const slices = [{ ...slice('A'), plan: 'p', merge: 'open' }, { ...slice('B'), plan: 'p', merge: 'open' }] as Slice[];
      const v = planView([row({ branch: '', plan: 'p', wave: 'A', state: 'open', group: 'not-started', startability: 'start-work' })], slices);
      const blocks = v.sections.filter((s) => s.key === 'work-items').flatMap((s) => s.groups.flatMap((g) => g.items));
      expect(blocks).toHaveLength(0);
      const lines = v.releaseBlocks[0]!.plans[0]!.lines;
      expect(lines.filter((l) => l.heading === 'to-do').map((l) => l.slice)).toContain('A');
    });

    it('carries Start and the waits-for name from blockedBy on a slice waiting across plans', () => {
      const slices = [{ ...slice('A'), plan: 'p', merge: 'open' }] as Slice[];
      const v = planView([row({ branch: '', plan: 'p', wave: 'A', state: 'open', group: 'not-started', startability: 'start-work', blockedBy: 'other-plan › Z' })], slices);
      const line = v.releaseBlocks[0]!.plans[0]!.lines[0]!;
      expect(line.start).toBe(true);
      expect(line.text).toContain('waits for other-plan › Z');
    });

    it('groups plans by Release: value and counts a plan named by two sprints once', () => {
      const slices = [mergedSlice('p1', 'a'), mergedSlice('p2', 'a')];
      const rows = slices.map((s) => merged(s.plan, s.name));
      const sprint = (release: string, members: string[]) => ({ release, ownerHandle: 'jwloka', members: members.map((slug) => ({ slug })) });
      const v = planView(rows, slices, [sprint('2.0', ['p1']), sprint('2.0', ['p1', 'p2']), sprint('2.1', ['p2'])] as never[]);
      expect(v.releaseBlocks.map((b) => [b.release, b.plans.map((p) => p.plan)])).toEqual([['2.0', ['p1', 'p2']], ['2.1', ['p2']]]);
      expect(v.releaseBlocks[0]!.plans[0]!.owner).toBe('jwloka');
    });

    it('puts a sprint with no Owner on the no owner card of its release', () => {
      const slices = [mergedSlice('p1', 'a')];
      const rows = slices.map((s) => merged(s.plan, s.name));
      const sprints = [{ slug: 's1', title: 'One', release: '2.0', members: [{ slug: 'p1' }] }];
      const v = planView(rows, slices, sprints as never[]);
      expect(v.releaseBlocks[0]!.cards.map((c) => [c.label, c.sprints.map((x) => x.slug)])).toEqual([['no owner', ['s1']]]);
    });

    it('draws the same bar on the person card as on the sprint card for a sprint with a Draft member', () => {
      const slices = [mergedSlice('p1', 'a')];
      const input = {
        rows: slices.map((s) => merged(s.plan, s.name)),
        slices,
        agents: [],
        drafts: [{ plan: 'p2', planFile: 'p2.md', title: '', issues: [], assignee: '', author: '', approver: '' }] as unknown as DraftPlan[],
        reader: { hostUser: 'jwloka', directory: parsePersonDirectory('jwloka = Jan Wloka') },
        mode: 'all' as const,
        config: { autoReview: true, correctionBudget: 2 },
      };
      const sprint = {
        slug: 's1', title: 'One', release: '2.0', end: '', ownerHandle: 'jwloka',
        members: [{ slug: 'p1', tier: 'must' as const, checked: false, known: true }, { slug: 'p2', tier: 'must' as const, checked: false, known: true }],
      };
      const sprintCard = sprintCardViewOf([sprint], input.reader, input).cards[0]!;
      const personBar = placeMapping(deliveryMapping(input), slices, [sprint] as never[]).releaseBlocks[0]!.cards[0]!.sprints[0]!;
      expect(sprintCard.bar).not.toBeNull();
      expect(personBar.readingMissing).toBe(false);
      expect(personBar.bar).toEqual(sprintCard.bar);
    });

    it('says progress not read where no slice has a reading', () => {
      const slices = [{ ...slice('A'), plan: 'p', merge: 'open' }] as Slice[];
      const v = planView([], slices);
      expect(v.releaseBlocks[0]!.plans[0]!.stripText).toBe('progress not read');
    });
  });

  it('opens a plan head over one slice and folds one over several', () => {
    const one = view([row({ branch: 'feature/a', plan: 'p', wave: 'A' })]);
    const two = view([
      row({ branch: 'feature/a', plan: 'p', wave: 'A' }),
      row({ branch: 'feature/b', plan: 'p', wave: 'B' }),
    ]);
    const head = (v: ReturnType<typeof view>) => {
      const b = v.sections.flatMap((s) => s.groups.flatMap((g) => g.blocks))[0]!;
      if (b.kind !== 'plan') throw new Error('not a plan head');
      return b;
    };
    expect(planBlockShown(head(one), new Set())).toBe(true);
    expect(planBlockShown(head(two), new Set())).toBe(false);
    expect(planBlockShown(head(two), new Set([`open:${head(two).key}`]))).toBe(true);
  });
});

describe('section header summary', () => {
  const section = (v: ReturnType<typeof view>, key: string) => v.sections.find((s) => s.key === key)!;

  it('keeps the count of an empty group at 0 and links nowhere', () => {
    const v = view([], [agent({ session: 'x', branch: 'feature/a' })]);
    const counts = section(v, 'fleet').summary;
    expect(counts.map((c) => c.key)).toEqual(['working', 'blocked', 'free']);
    const empty = counts.filter((c) => c.count === 0);
    expect(empty.length).toBeGreaterThan(0);
    for (const c of empty) expect(c.anchor).toBeNull();
    for (const c of counts.filter((x) => x.count > 0)) expect(c.anchor).toBe(groupAnchor(c.key));
  });

  it('counts the fleet\'s working, blocked and free groups', () => {
    const fleet = section(view([], [agent({ session: 'x', branch: '' })]), 'fleet');
    expect(fleet.summary.map((c) => c.label)).toEqual(['Working', 'Blocked', 'Free agents']);
    expect(fleet.summary.map((c) => c.count)).toEqual(fleet.groups.map((g) => g.count));
  });

  it('gives a section with no groups no counts', () => {
    const v = view([]);
    expect(section(v, 'release-delivery').summary).toEqual([]);
    expect(section(v, 'machine').summary).toEqual([]);
    expect(summarise([])).toEqual([]);
  });

  it('draws every section from an entry in the glyph table', () => {
    for (const s of view([]).sections) expect(GLYPH_PATH[s.icon]).toMatch(/^M/);
  });
});

describe('Work items header and group columns', () => {
  const work = (v: ReturnType<typeof view>) => v.sections.find((s) => s.key === 'work-items')!;

  it('names the three groups and their columns, one column name per group', () => {
    const w = work(view([]));
    expect(w.groups.map((g) => [g.key, g.column])).toEqual([
      ['at-a-gate', 'Gates'], ['being-built', 'Progress'], ['queued', 'Waits on'],
    ]);
    expect(w.summary.map((c) => c.text)).toEqual(['0 at a gate', '0 being built', '0 queued']);
  });

  it('gives the other sections no group column, and Fleet the header line wording', () => {
    const v = view([], [agent({ session: 'x', branch: '' })]);
    for (const g of v.sections.find((s) => s.key === 'fleet')!.groups) expect(g.column).toBeNull();
    expect(v.sections.find((s) => s.key === 'fleet')!.summary.map((c) => c.text)).toEqual(['0 working', '0 blocked', '1 free']);
  });

  it('names the oldest age across the section and prints none without an age reading', () => {
    expect(work(view([row({ branch: 'feature/a', plan: 'p', wave: 'A' })])).oldest).toBeNull();
    const aged = view([
      row({ branch: 'feature/a', plan: 'p', wave: 'A', ageMinutes: 5 }),
      row({ branch: 'feature/b', plan: 'p', wave: 'B', ageMinutes: 190 }),
    ]);
    expect(work(aged).oldest).toBe('oldest waits 3h');
  });
});

describe('a Draft plan in You', () => {
  const placed = (anchor: string, over: Record<string, unknown>): PlacedItemView => ({
    placement: { section: 'you', reason: 'draft-plan', id: anchor }, rows: [], draft: null, ticket: null,
    label: anchor, anchor, links: [], looseActions: { delete: false, release: false }, ...over,
  }) as unknown as PlacedItemView;
  const sliceItem = (n: string) => placed(`s-${n}`, { rows: [row({ branch: `feature/${n}`, plan: 'p', wave: n })] });
  const draftItem = placed('d', { draft: { plan: 'p', planFile: 'p.md' }, rows: [row({ kind: 'plan', plan: 'p', wave: '' })] });

  it('is one row in You and its slices show as none', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map(sliceItem);
    const blocks = nestItems('input-to-the-fleet', [draftItem, ...items], undefined, true);
    expect(blocks.map((b) => b.kind)).toEqual(['item']);
  });

  it('keeps the nesting of a plan that has no draft item of its own', () => {
    const blocks = nestItems('input-to-the-fleet', ['a', 'b', 'c'].map(sliceItem), undefined, true);
    expect(blocks.map((b) => b.kind)).toEqual(['plan']);
  });

  it('keeps its nesting in the other sections', () => {
    const items = ['a', 'b'].map(sliceItem).map((i) => ({ ...i, placement: { section: 'work-items', group: 'queued', id: i.anchor } }) as unknown as PlacedItemView);
    const blocks = nestItems('queued', [draftItem, ...items], undefined, false);
    expect(blocks.map((b) => b.kind).sort()).toEqual(['item', 'plan']);
  });
});

describe('the domain fields the view passes on', () => {
  const sliceOf = (plan: string, name: string, more: Record<string, unknown> = {}): Slice =>
    ({ ...slice(name), plan, merge: 'open', ...more }) as Slice;
  const place = (rows: AgentRow[], slices: Slice[], sprints: never[] = [], scope?: never, now?: Date) =>
    placeMapping(deliveryMapping({
      rows, slices, agents: [], drafts: [], reader: { hostUser: 'me' }, mode: 'all',
      config: { autoReview: true, correctionBudget: 2 },
    }), slices, sprints, scope, now);
  const figures = (b: { counts: { count: number; words: string }[] }) => b.counts.map((c) => `${c.count} ${c.words}`);

  it('gives every section count words that follow the number and hold none', () => {
    const v = view([row({ branch: 'feature/a', plan: 'p', wave: 'A' })]);
    for (const s of v.sections) for (const c of s.summary) expect(c.words).not.toMatch(/\d/);
    const work = v.sections.find((s) => s.key === 'work-items')!.summary;
    for (const c of work) expect(c.text).toBe(`${c.count} ${c.words}`);
    const other = v.sections.find((s) => s.key === 'you')!.summary;
    for (const c of other) expect(c.text).toBe(`${c.words} ${c.count}`);
  });

  it('sets counts on a release block equal to the figures its header prints', () => {
    const slices = [sliceOf('p', 'A', { merge: 'merged', complete: true }), sliceOf('p', 'B')];
    const v = place([row({ branch: 'feature/b', plan: 'p', wave: 'B', phase: 'Development' })], slices);
    const b = v.releaseBlocks[0]!;
    expect(b.counts.map((c) => c.key)).toEqual(['plans', 'delivered', 'blocked']);
    expect(b.header).toBe(figures(b).join(' · '));
  });

  it('sets counts on a sprint block under the my-sprint scope, equal to its header figures', () => {
    const slices = [sliceOf('p', 'A', { merge: 'merged', complete: true })];
    const sprint = { slug: 's', title: 'Title s', release: '', ownerHandle: 'me', members: [{ slug: 'p' }] };
    const reader = { hostUser: 'me', directory: parsePersonDirectory('me = Me') };
    const scope = deliveryScope(['s'], reader, [sprint]);
    const v = place([row({ branch: 'feature/p-a', plan: 'p', wave: 'A', phase: 'Testing', state: 'merged', group: 'done' })], slices, [sprint] as never[], scope as never);
    const b = v.releaseBlocks[0]!;
    expect(b.sprint).toBe('s');
    expect(figures(b)).toEqual(['1 plan', '1 of 1 slices delivered', '0 blocked']);
    expect(b.header).toContain(figures(b).join(' · '));
  });

  it('gives a plan row the phase and accent of its rows, and none where no row names one', () => {
    const slices = [sliceOf('p', 'A'), sliceOf('q', 'A')];
    const v = place([
      row({ branch: 'feature/p-a', plan: 'p', wave: 'A', phase: 'Development' }),
      row({ branch: 'feature/q-a', plan: 'q', wave: 'A', phase: null }),
    ], slices);
    const plans = v.releaseBlocks[0]!.plans;
    expect(plans.find((p) => p.plan === 'p')).toMatchObject({ phase: 'Development', accent: 'Development' });
    const q = plans.find((p) => p.plan === 'q')!;
    expect('phase' in q).toBe(false);
    expect('accent' in q).toBe(false);
  });

  it('reads the relative merge time against the clock it is given, and none without one', () => {
    const slices = [sliceOf('p', 'A', { merge: 'merged', complete: true, mergedFact: { pr: 4, mergedAt: '2026-11-17T12:00:00Z' } })];
    const rows = [row({ branch: 'feature/p-a', plan: 'p', wave: 'A', phase: 'Testing', state: 'merged', group: 'done' })];
    const at = (now?: Date) => place(rows, slices, [], undefined, now).releaseBlocks[0]!.plans[0]!.lines[0]!;
    expect(at(new Date('2026-11-19T12:00:00Z'))).toMatchObject({ state: 'delivered', pr: 4, merged: 'merged 2 days ago' });
    expect(at().merged).toBeUndefined();
  });

  it('carries the open PR of an In flight slice and leaves pr absent where no row has one', () => {
    const slices = [sliceOf('p', 'A'), sliceOf('p', 'B')];
    const v = place([
      row({ branch: 'feature/a', plan: 'p', wave: 'A', state: 'open', group: 'at-a-gate', pr: { number: 12, state: 'open', open: true } }),
      row({ branch: 'feature/b', plan: 'p', wave: 'B' }),
    ], slices);
    const lines = v.releaseBlocks[0]!.plans[0]!.lines;
    expect(lines.find((l) => l.slice === 'A')!.pr).toBe(12);
    expect(lines.find((l) => l.slice === 'B')!.pr).toBeUndefined();
  });
});
