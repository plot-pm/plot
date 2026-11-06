import { describe, expect, it } from 'vitest';
import { CardFactsSchema } from '../src/entities/card-facts.js';
import { cardControls, type CardControlsReadings } from '../src/rules/card-controls.js';
import {
  planCardFacts,
  withActionAvailability,
  type PlanCardFactsReadings,
} from '../src/rules/plan-card-facts.js';

const controls = (over: Partial<CardControlsReadings> = {}) =>
  cardControls({ state: 'approved', status: 'approved', started: false, ...over });

const reading = (over: Partial<PlanCardFactsReadings> = {}): PlanCardFactsReadings => ({
  slug: 'x',
  title: 'X',
  path: 'docs/plans/2026-11-01-x.md',
  type: 'feature',
  assignee: '',
  state: 'approved',
  issues: [],
  records: { designRaw: '', approvedRaw: '', startedRaw: '', deliveredRaw: '', releasedRaw: '' },
  status: 'approved',
  controls: controls(),
  deliverable: false,
  rounds: null,
  slices: { total: 2, complete: 0, eligible: 1, waitsOn: [] },
  spike: null,
  prs: { value: [] },
  verification: null,
  cost: null,
  story: null,
  sprint: null,
  notPushed: false,
  ...over,
});

const facts = (over: Partial<PlanCardFactsReadings> = {}, directory = {}) => {
  const out = planCardFacts(reading(over), directory);
  // Every projection parses against the schema, so the invariants the schema holds hold here.
  expect(CardFactsSchema.safeParse(out).success).toBe(true);
  return out;
};

describe('planCardFacts: identity', () => {
  it('reads the type lowercased', () => {
    expect(facts({ type: 'Bug' }).identity.type).toBe('bug');
  });

  it('gives no type where the plan stated none', () => {
    expect(facts({ type: '' }).identity.type).toBeNull();
  });

  it('carries the first issue as the key and the plan as what the title opens', () => {
    const f = facts({ issues: ['1089'] });
    expect(f.identity.key).toBe('1089');
    expect(f.identity.opens).toEqual({ kind: 'plan', slug: 'x', title: 'X', status: 'approved' });
  });

  it('alerts an unpushed plan, with its commits not counted', () => {
    expect(facts({ notPushed: true }).identity.alerts).toEqual([{ kind: 'not-pushed', commits: null }]);
    expect(facts().identity.alerts).toEqual([]);
  });
});

describe('planCardFacts: ownership', () => {
  it('the assignee is the plan\'s Assignee:, resolved through People', () => {
    expect(facts({ assignee: 'Max Albrecht' }, { 'max albrecht': 'eins78' }).ownership.assignees).toEqual({ value: ['eins78'] });
  });

  it('an approved plan keeps its assignee, never the approver', () => {
    const f = facts(
      { assignee: 'jwloka', records: { ...reading().records, approvedRaw: '2026-10-15, Max Albrecht, plan-PR #1753 merged' } },
      { 'max albrecht': 'eins78' },
    );
    expect(f.ownership.assignees).toEqual({ value: ['jwloka'] });
  });

  it('a plan naming nobody is read and unassigned', () => {
    expect(facts().ownership.assignees).toEqual({ value: [] });
  });

  it('several assignees, comma-separated, are each resolved; an undeclared spelling stays as written', () => {
    expect(facts({ assignee: 'jwloka, nobody-declared' }).ownership.assignees).toEqual({ value: ['jwloka', 'nobody-declared'] });
  });

  it('since is the newest dated record, else the file date', () => {
    const f = facts({ records: { ...reading().records, designRaw: '2026-11-02, a, cli', approvedRaw: '2026-11-04, a, pr' } });
    expect(f.ownership.since).toEqual({ at: '2026-11-04', event: 'transitioned' });
    expect(facts().ownership.since).toEqual({ at: '2026-11-01', event: 'opened' });
  });

  it('names the plan file as its source', () => {
    expect(facts().ownership.source).toEqual({ path: 'docs/plans/2026-11-01-x.md' });
  });
});

describe('planCardFacts: lineage', () => {
  it('a relation the plan names nothing for is read and empty', () => {
    const f = facts();
    expect(f.lineage.stories).toEqual({ value: [] });
    expect(f.lineage.sprints).toEqual({ value: [] });
    expect(f.lineage.tickets).toEqual({ value: [] });
  });

  it('a story and sprint the board read are refs with their phase', () => {
    const f = facts({
      story: { value: { slug: 's', title: 'S', status: 'active', archived: false } },
      sprint: { value: { slug: 'sp', title: 'Sp', state: 'Active', release: '2.32.0' } },
    });
    expect(f.lineage.stories).toEqual({ value: [{ kind: 'story', slug: 's', title: 'S', status: 'active', archived: false }] });
    expect(f.lineage.sprints).toEqual({ value: [{ kind: 'sprint', slug: 'sp', title: 'Sp', state: 'Active', release: '2.32.0' }] });
  });

  it('a story that could not be read is unknown, never empty', () => {
    expect(facts({ story: { unknown: 'failed' } }).lineage.stories).toEqual({ unknown: 'failed' });
  });

  it('every issue key the plan names is a ticket ref, read from the plan; the first is the key', () => {
    const f = facts({ issues: ['3101', 'PROJ-12'] });
    expect(f.identity.key).toBe('3101');
    expect(f.lineage.tickets).toEqual({
      value: [
        { kind: 'ticket', key: '3101', title: '3101', lane: null },
        { kind: 'ticket', key: 'PROJ-12', title: 'PROJ-12', lane: null },
      ],
    });
  });
});

describe('planCardFacts: progress', () => {
  it('opens with the plan\'s State:, and reads an unreadable one as unknown', () => {
    expect(facts({ state: 'Design' }).progress.state).toEqual({ value: { kind: 'plan', state: 'design' } });
    expect(facts({ state: '' }).progress.state).toEqual({ unknown: 'failed' });
  });


  it('counts complete slices, or says the pulse was not read', () => {
    expect(facts().progress.work).toEqual({ unit: 'slices', done: { value: 0 }, total: 2 });
    const cold = facts({ slices: { total: 2, complete: null, eligible: null, waitsOn: [] } });
    expect(cold.progress.work?.done).toEqual({ unknown: 'unasked' });
  });

  it('keeps each PR\'s own check reading, unknown included', () => {
    const prs = [
      { number: 1, branch: 'feature/a', checks: 'green' as const, mergeable: 'mergeable' as const, checksLookup: null },
      { number: 2, branch: 'feature/b', checks: 'unknown' as const, mergeable: 'unknown' as const, checksLookup: null },
    ];
    expect(facts({ prs: { value: prs } }).progress.prs).toEqual({ value: prs });
  });

  it('carries rounds only while the plan is under review', () => {
    const draft = facts({ status: 'draft', controls: controls({ state: 'draft', status: 'draft' }), rounds: 2 });
    expect(draft.progress.design).toEqual({ rounds: 2, spike: null });
    expect(facts({ rounds: 2 }).progress.design).toBeNull();
  });

  it('carries verification and cost as read', () => {
    const cost = { tokens: null, measured: 0, absent: 3, unreadable: 0, fromRuns: 0, slices: 3 };
    const f = facts({ verification: { state: 'refuted', refuted: 2 }, cost: { value: cost } });
    expect(f.progress.verification).toEqual({ state: 'refuted', refuted: 2 });
    expect(f.progress.cost).toEqual({ value: cost });
  });
});

describe('planCardFacts: next', () => {
  it('a ready plan with an eligible slice offers Start work as its primary', () => {
    expect(facts().next).toEqual({ primary: { action: 'start-work', enabled: true, reason: null }, secondary: [] });
  });

  it('with no fleet scan yet, Start work is disabled with awaiting-fleet-scan', () => {
    const f = facts({ slices: { total: 2, complete: null, eligible: null, waitsOn: [] } });
    expect(f.next.primary).toEqual({ action: 'start-work', enabled: false, reason: { kind: 'awaiting-fleet-scan' } });
  });

  it('with nothing eligible, Start work is disabled naming the slices it waits on', () => {
    const f = facts({ slices: { total: 2, complete: 0, eligible: 0, waitsOn: [{ branch: 'feature/x', pr: 3105 }] } });
    expect(f.next.primary).toEqual({
      action: 'start-work',
      enabled: false,
      reason: { kind: 'nothing-eligible', waitsOn: [{ kind: 'slice', plan: 'x', branch: 'feature/x', pr: 3105 }] },
    });
  });

  it('an uncounted complete total leaves Start work to the eligible count', () => {
    const f = facts({ slices: { total: 2, complete: null, eligible: 1, waitsOn: [] } });
    expect(f.progress.work?.done).toEqual({ unknown: 'unasked' });
    expect(f.next.primary).toEqual({ action: 'start-work', enabled: true, reason: null });
  });

  it('a plan with no slices lets Start work through to the dispatcher', () => {
    expect(facts({ slices: null }).next.primary?.enabled).toBe(true);
  });

  it('an in-progress plan keeps Start work, as a secondary, while a slice is eligible', () => {
    const f = facts({ status: 'in-progress', controls: controls({ status: 'in-progress', started: true }) });
    expect(f.next).toEqual({ primary: null, secondary: [{ action: 'start-work', enabled: true, reason: null }] });
  });

  it('an in-progress plan with nothing eligible omits the disabled secondary', () => {
    const f = facts({
      status: 'in-progress', controls: controls({ status: 'in-progress', started: true }),
      slices: { total: 2, complete: 0, eligible: 0, waitsOn: [] },
    });
    expect(f.next).toEqual({ primary: null, secondary: [] });
  });

  it('a draft offers Approve with Interrogate as a secondary', () => {
    const f = facts({ status: 'draft', controls: controls({ state: 'draft', status: 'draft' }) });
    expect(f.next).toEqual({
      primary: { action: 'approve', enabled: true, reason: null },
      secondary: [{ action: 'interrogate', enabled: true, reason: null }],
    });
  });

  const spikeSlices = [{ branches: [{ branch: 'feature/spike', spike: true }] }, { branches: [{ branch: 'feature/b', spike: false }] }];

  it('a Design plan with an unapproved spike offers Approve spike', () => {
    const c = controls({ state: 'design', status: 'draft', slices: spikeSlices });
    expect(facts({ controls: c, spike: { branch: 'feature/spike', pr: null } }).next.primary)
      .toEqual({ action: 'approve-spike', enabled: true, reason: null });
  });

  it('a Design plan waiting on its approved spike shows Approve disabled with awaits-spike', () => {
    const c = controls({ state: 'design', status: 'draft', slices: spikeSlices, spikeApproved: '2026-11-06, a, b, feature/spike' });
    const f = facts({ controls: c, spike: { branch: 'feature/spike', pr: 7 } });
    expect(f.next.primary).toEqual({
      action: 'approve',
      enabled: false,
      reason: { kind: 'awaits-spike', spike: { kind: 'slice', plan: 'x', branch: 'feature/spike', pr: 7 } },
    });
    expect(f.next.secondary).toEqual([{ action: 'interrogate', enabled: true, reason: null }]);
  });

  it('a merged spike with no Spike approved: record offers Approve spike, and Confirm slices as a secondary', () => {
    const c = controls({ state: 'design', status: 'draft', slices: spikeSlices, spikeMerged: true });
    const f = facts({ controls: c, spike: { branch: 'feature/spike', pr: 7 } });
    expect(f.next.primary).toEqual({ action: 'approve-spike', enabled: true, reason: null });
    expect(f.next.secondary[0]).toEqual({ action: 'confirm-slices', enabled: true, reason: null });
  });

  it('a merged spike offers Confirm slices', () => {
    const c = controls({
      state: 'design', status: 'draft', slices: spikeSlices, spikeApproved: '2026-11-06, a, b, feature/spike', spikeMerged: true,
    });
    expect(facts({ controls: c }).next.primary).toEqual({ action: 'confirm-slices', enabled: true, reason: null });
  });

  it('a deliverable plan offers Deliver as its primary', () => {
    const f = facts({ status: 'deliverable', controls: controls({ status: 'deliverable' }), deliverable: true });
    expect(f.next).toEqual({ primary: { action: 'deliver', enabled: true, reason: null }, secondary: [] });
  });

  it('reason is non-null exactly when enabled is false, across every projection here', () => {
    for (const f of [
      facts(), facts({ slices: { total: 1, complete: null, eligible: null, waitsOn: [] } }),
      facts({ status: 'draft', controls: controls({ state: 'draft', status: 'draft' }) }),
    ]) {
      for (const a of [f.next.primary, ...f.next.secondary]) {
        if (a) expect(a.enabled).toBe(a.reason === null);
      }
    }
  });
});

describe('withActionAvailability', () => {
  it('disables a primary the board will not run, naming the action', () => {
    const f = withActionAvailability(facts(), { 'start-work': false });
    expect(f.next.primary).toEqual({
      action: 'start-work', enabled: false, reason: { kind: 'action-unavailable', action: 'start-work' },
    });
  });

  it('keeps a secondary the board\'s configuration refuses, disabled with action-unavailable', () => {
    const draft = facts({ status: 'draft', controls: controls({ state: 'draft', status: 'draft' }) });
    expect(withActionAvailability(draft, { interrogate: false }).next.secondary).toEqual([
      { action: 'interrogate', enabled: false, reason: { kind: 'action-unavailable', action: 'interrogate' } },
    ]);
  });

  it('still omits a secondary the plan\'s own state disables, whatever the board runs', () => {
    const blocked = facts({
      status: 'in-progress', controls: controls({ status: 'in-progress', started: true }),
      slices: { total: 2, complete: 0, eligible: 0, waitsOn: [] },
    });
    expect(blocked.next.secondary).toEqual([]);
    expect(withActionAvailability(blocked, { 'start-work': false }).next.secondary).toEqual([]);
    expect(withActionAvailability(blocked, { 'start-work': true }).next.secondary).toEqual([]);
  });

  it('keeps an already-disabled primary\'s own reason', () => {
    const cold = facts({ slices: { total: 2, complete: null, eligible: null, waitsOn: [] } });
    expect(withActionAvailability(cold, { 'start-work': false }).next.primary?.reason).toEqual({ kind: 'awaiting-fleet-scan' });
  });
});
