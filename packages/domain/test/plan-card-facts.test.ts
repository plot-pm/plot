import { describe, expect, it } from 'vitest';
import { CardFactsSchema } from '../src/entities/card-facts.js';
import { cardControls, type CardControlsReadings } from '../src/rules/card-controls.js';
import {
  planCardApprover,
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

describe('planCardApprover', () => {
  it('reads the who position from a well-formed record', () => {
    expect(planCardApprover('2026-10-15, Jan Wloka, plan-PR #1753 merged')).toBe('Jan Wloka');
  });

  it('gives no approver for a legacy bare-timestamp record', () => {
    expect(planCardApprover('2026-03-15T21:02:30Z')).toBe('');
  });

  it('gives no approver for the template placeholder', () => {
    expect(planCardApprover('<date>, <who>, <channel>')).toBe('');
  });

  it('gives no approver for an empty record', () => {
    expect(planCardApprover('')).toBe('');
  });
});

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
  it('owner is the assignee on an unapproved plan', () => {
    expect(facts({ assignee: 'jwloka' }).ownership.owner).toBe('jwloka');
  });

  it('owner is the approver, resolved through People, on an Approved plan', () => {
    const f = facts(
      { assignee: 'jwloka', records: { ...reading().records, approvedRaw: '2026-10-15, Max Albrecht, plan-PR #1753 merged' } },
      { 'max albrecht': 'eins78' },
    );
    expect(f.ownership.owner).toBe('eins78');
  });

  it('gives no owner where nobody is named', () => {
    expect(facts().ownership.owner).toBeNull();
  });

  it('renders an owner spelling undeclared in People as written', () => {
    expect(facts({ assignee: 'nobody-declared' }).ownership.owner).toBe('nobody-declared');
  });

  it('gives no owner where an Approved record names no person, even with an assignee', () => {
    const f = facts({ assignee: 'jwloka', records: { ...reading().records, approvedRaw: '2026-03-15T21:02:30Z' } });
    expect(f.ownership.owner).toBeNull();
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
      sprint: { value: { slug: 'sp', title: 'Sp', state: 'Active' } },
    });
    expect(f.lineage.stories).toEqual({ value: [{ kind: 'story', slug: 's', title: 'S', status: 'active', archived: false }] });
    expect(f.lineage.sprints).toEqual({ value: [{ kind: 'sprint', slug: 'sp', title: 'Sp', state: 'Active' }] });
  });

  it('a story that could not be read is unknown, never empty', () => {
    expect(facts({ story: { unknown: 'failed' } }).lineage.stories).toEqual({ unknown: 'failed' });
  });

  it('a named ticket the plan card does not read is unasked', () => {
    expect(facts({ issues: ['12'] }).lineage.tickets).toEqual({ unknown: 'unasked' });
  });
});

describe('planCardFacts: progress', () => {
  it('counts complete slices, or says the pulse was not read', () => {
    expect(facts().progress?.work).toEqual({ unit: 'slices', done: { value: 0 }, total: 2 });
    const cold = facts({ slices: { total: 2, complete: null, eligible: null, waitsOn: [] } });
    expect(cold.progress?.work?.done).toEqual({ unknown: 'unasked' });
  });

  it('keeps each PR\'s own check reading, unknown included', () => {
    const prs = [
      { number: 1, branch: 'feature/a', checks: 'green' as const },
      { number: 2, branch: 'feature/b', checks: 'unknown' as const },
    ];
    expect(facts({ prs: { value: prs } }).progress?.prs).toEqual({ value: prs });
  });

  it('carries rounds only while the plan is under review', () => {
    const draft = facts({ status: 'draft', controls: controls({ state: 'draft', status: 'draft' }), rounds: 2 });
    expect(draft.progress?.design).toEqual({ rounds: 2, spike: null });
    expect(facts({ rounds: 2 }).progress?.design).toBeNull();
  });

  it('carries verification and cost as read', () => {
    const cost = { tokens: null, measured: 0, absent: 3, unreadable: 0, fromRuns: 0, slices: 3 };
    const f = facts({ verification: { state: 'refuted', refuted: 2 }, cost: { value: cost } });
    expect(f.progress?.verification).toEqual({ state: 'refuted', refuted: 2 });
    expect(f.progress?.cost).toEqual({ value: cost });
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

  it('omits a secondary the board will not run', () => {
    const draft = facts({ status: 'draft', controls: controls({ state: 'draft', status: 'draft' }) });
    expect(withActionAvailability(draft, { interrogate: false }).next.secondary).toEqual([]);
  });

  it('keeps an already-disabled primary\'s own reason', () => {
    const cold = facts({ slices: { total: 2, complete: null, eligible: null, waitsOn: [] } });
    expect(withActionAvailability(cold, { 'start-work': false }).next.primary?.reason).toEqual({ kind: 'awaiting-fleet-scan' });
  });
});
