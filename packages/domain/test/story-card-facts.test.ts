import { describe, expect, it } from 'vitest';
import { CardFactsSchema } from '../src/entities/card-facts.js';
import { storyCardFacts, type StoryCardFactsReadings, type StoryPlanCardReading } from '../src/rules/story-card-facts.js';

const plan = (slug: string, over: Partial<StoryPlanCardReading> = {}): StoryPlanCardReading => ({
  slug, key: null, title: slug.toUpperCase(), status: 'approved', state: 'approved', sprint: '', ...over,
});

const reading = (over: Partial<StoryCardFactsReadings> = {}): StoryCardFactsReadings => ({
  slug: 'nothing-runs',
  title: 'Nothing changed, nothing runs',
  path: 'docs/stories/nothing-runs/STORY-nothing-runs.md',
  status: 'draft',
  archived: false,
  committed: true,
  author: '',
  created: '2026-11-01',
  updated: '',
  objective: '',
  issue: { kind: 'none' },
  plans: { value: [] },
  sprints: { value: [] },
  ...over,
});

const facts = (over: Partial<StoryCardFactsReadings> = {}, directory = {}) => {
  const out = storyCardFacts(reading(over), directory);
  // Every projection parses against the schema, so the invariants the schema holds hold here.
  expect(CardFactsSchema.safeParse(out).success).toBe(true);
  return out;
};

describe('storyCardFacts: identity', () => {
  it('is a story that opens itself', () => {
    const f = facts();
    expect(f.identity.kind).toBe('story');
    expect(f.identity.opens).toEqual({ kind: 'story', slug: 'nothing-runs', title: 'Nothing changed, nothing runs', status: 'draft', archived: false });
  });

  it('carries the issue its issue: names as the key, and links that ticket', () => {
    const f = facts({ issue: { kind: 'key', key: '3170' } });
    expect(f.identity.key).toBe('3170');
    expect(f.lineage.tickets).toEqual({ value: [{ kind: 'ticket', key: '3170', title: '3170', lane: null }] });
  });

  it('alerts an issue: this repository does not accept, and links no ticket', () => {
    const f = facts({ issue: { kind: 'unreadable', value: 'https://github.com/x/y/issues/1' } });
    expect(f.identity.alerts).toEqual([{ kind: 'issue-link-unreadable', value: 'https://github.com/x/y/issues/1' }]);
    expect(f.lineage.tickets).toEqual({ value: [] });
    expect(f.identity.key).toBeNull();
  });

  it('reads the ticket as unknown where the link could not be decided', () => {
    expect(facts({ issue: { kind: 'unknown' } }).lineage.tickets).toEqual({ unknown: 'unasked' });
  });

  it('alerts a status behind what its plans prove, with the proven standing', () => {
    const f = facts({ status: 'draft', plans: { value: [plan('a', { state: 'delivered' }), plan('b', { state: 'released' })] } });
    expect(f.identity.alerts).toEqual([{ kind: 'status-behind', proven: 'done' }]);
  });

  it('raises no status alert for a status ahead of its plans', () => {
    expect(facts({ status: 'done', plans: { value: [plan('a', { state: 'draft' })] } }).identity.alerts).toEqual([]);
  });

  it('caps the summary at 280 characters and gives none for an empty objective', () => {
    expect(facts({ objective: 'x'.repeat(400) }).identity.summary).toHaveLength(280);
    expect(facts({ objective: '  ' }).identity.summary).toBeNull();
  });
});

describe('storyCardFacts: lineage and progress', () => {
  it('opens its status with the written status', () => {
    expect(facts({ status: 'active' }).progress.state).toEqual({ value: { kind: 'story', status: 'active' } });
  });

  it('reads an absent or unadmitted status as unknown, never as draft', () => {
    expect(facts({ status: '' }).progress.state).toEqual({ unknown: 'failed' });
    expect(facts({ status: 'UNKNOWN' }).progress.state).toEqual({ unknown: 'failed' });
  });

  it('counts its plans, done being Delivered or Released', () => {
    const f = facts({ plans: { value: [plan('a', { state: 'delivered' }), plan('b', { state: 'released' }), plan('c')] } });
    expect(f.progress.work).toEqual({ unit: 'plans', done: { value: 2 }, total: 3 });
  });

  it('counts a table slug with no file as not started in the total', () => {
    const table = Array.from({ length: 18 }, (_, i) => `p${i}`);
    const files = table.slice(0, 4).map((slug) => plan(slug, { state: 'delivered' }));
    const f = facts({ status: 'ready', plans: { value: files }, tablePlans: table });
    expect(f.progress.work).toEqual({ unit: 'plans', done: { value: 4 }, total: 18 });
  });

  it('adds a plan file the table does not name to the total', () => {
    const table = ['p0', 'p1'];
    const files = [plan('p0', { state: 'delivered' }), plan('extra', { state: 'delivered' })];
    expect(facts({ plans: { value: files }, tablePlans: table }).progress.work)
      .toEqual({ unit: 'plans', done: { value: 2 }, total: 3 });
  });

  it('shows no work where the plans were not read, whatever the table names', () => {
    expect(facts({ plans: { unknown: 'failed' }, tablePlans: ['a', 'b'] }).progress.work).toBeNull();
  });

  it('still alerts status-behind on a ready story whose plans are all delivered', () => {
    const f = facts({ status: 'ready', plans: { value: [plan('a', { state: 'delivered' })] } });
    expect(f.identity.alerts).toContainEqual({ kind: 'status-behind', proven: 'done' });
  });

  it('shows no work for a story with no plans', () => {
    expect(facts().progress.work).toBeNull();
  });

  it('links each plan with its ticket key and measured status', () => {
    const f = facts({ plans: { value: [plan('a', { key: '3092', status: 'in-progress' })] } });
    expect(f.lineage.plans).toEqual({ value: [{ kind: 'plan', slug: 'a', key: '3092', title: 'A', status: 'in-progress' }] });
  });

  it('links each sprint its plans name once, with its release', () => {
    const f = facts({
      plans: { value: [plan('a', { sprint: 's1' }), plan('b', { sprint: 's1' }), plan('c', { sprint: 'gone' })] },
      sprints: { value: [{ slug: 's1', title: 'Sprint one', state: 'Active', release: '2.32.0' }] },
    });
    expect(f.lineage.sprints).toEqual({
      value: [
        { kind: 'sprint', slug: 's1', title: 'Sprint one', state: 'Active', release: '2.32.0' },
        { kind: 'sprint', slug: 'gone', title: 'gone', state: null, release: null },
      ],
    });
  });

  it('reads plans and sprints as unknown where the plans were not read, and shows no count', () => {
    const f = facts({ plans: { unknown: 'failed' } });
    expect(f.lineage.plans).toEqual({ unknown: 'failed' });
    expect(f.lineage.sprints).toEqual({ unknown: 'failed' });
    expect(f.progress.work).toBeNull();
  });

  it('reads sprints as unknown where the sprints were not read', () => {
    expect(facts({ plans: { value: [plan('a', { sprint: 's1' })] }, sprints: { unknown: 'failed' } }).lineage.sprints)
      .toEqual({ unknown: 'failed' });
  });

  it('carries 62 plans and 9 sprints as lists, for the card to count', () => {
    const plans = Array.from({ length: 62 }, (_, i) => plan(`p${i}`, { sprint: `s${i % 9}`, state: i < 60 ? 'delivered' : 'approved' }));
    const f = facts({ plans: { value: plans } });
    expect('value' in f.lineage.plans && f.lineage.plans.value).toHaveLength(62);
    expect('value' in f.lineage.sprints && f.lineage.sprints.value).toHaveLength(9);
    expect(f.progress.work).toEqual({ unit: 'plans', done: { value: 60 }, total: 62 });
  });
});

describe('storyCardFacts: next', () => {
  it('offers Add plan as the primary on a live story with no plans', () => {
    expect(facts().next).toEqual({ primary: { action: 'add-plan', enabled: true, reason: null }, secondary: [] });
  });

  it('offers Add plan as a secondary on a live story with plans', () => {
    expect(facts({ plans: { value: [plan('a')] } }).next).toEqual({
      primary: null, secondary: [{ action: 'add-plan', enabled: true, reason: null }],
    });
  });

  it('offers nothing on a done or archived story', () => {
    expect(facts({ status: 'done' }).next).toEqual({ primary: null, secondary: [] });
    expect(facts({ archived: true }).next).toEqual({ primary: null, secondary: [] });
  });

  it('offers nothing on a story whose slug the endpoint refuses', () => {
    expect(facts({ slug: 'FOOBAR-12-audit' }).next).toEqual({ primary: null, secondary: [] });
  });

  it('offers nothing on a story only the working tree holds', () => {
    expect(facts({ committed: false }).next).toEqual({ primary: null, secondary: [] });
  });
});

describe('storyCardFacts: ownership', () => {
  it('assigns the author, resolved through People', () => {
    const f = facts({ author: 'Jan Wloka' }, { 'jan wloka': 'jwloka' });
    expect(f.ownership.assignees).toEqual({ value: ['jwloka'] });
    expect(f.ownership.assignedFrom).toEqual({ source: 'assigned' });
  });

  it('reads no author as unassigned, never as unknown', () => {
    const f = facts({ author: '  ' });
    expect(f.ownership.assignees).toEqual({ value: [] });
    expect(f.ownership.assignedFrom).toBeNull();
  });

  it('dates the card by updated:, else created:', () => {
    expect(facts({ updated: '2026-11-05T10:00:00Z' }).ownership.since).toEqual({ at: '2026-11-05', event: 'updated' });
    expect(facts({ updated: '' }).ownership.since).toEqual({ at: '2026-11-01', event: 'opened' });
    expect(facts({ updated: '', created: '' }).ownership.since).toBeNull();
  });

  it('names its file as its source', () => {
    expect(facts().ownership.source).toEqual({ path: 'docs/stories/nothing-runs/STORY-nothing-runs.md' });
  });
});
