import { describe, expect, it } from 'vitest';

import { CardSchema, IssueRowSchema, type DispatchInfo } from '../../src/contract/schema.js';
import {
  rowMenuOf,
  type BranchMenuFacts,
  type PlanMenuFacts,
  type RowMenuItem,
  type RowMenuView,
  type SliceMenuFacts,
  type ScopeTicketMenuFacts,
  type TicketMenuFacts,
} from '../../src/app/lib/agent-rows/delivery-view.js';
import { SOME_FACTS } from '../fixtures/card-facts.js';
import { NO_ADDRESS_REASON, NO_TICKET_ROW_REASON, PLAN_NAMED_REASON } from '@plot-pm/domain/rules/scope-tickets';

/**
 * Each plan, slice, branch and Tickets row lists a fixed item set in its `⋯`. An item that cannot run stays listed,
 * disabled with its reason, and the trigger never shows disabled while the list holds an item.
 */

const ON: DispatchInfo = { available: true, reason: '' };
const OFF: DispatchInfo = { available: false, reason: 'the board runs read-only' };

const card = CardSchema.parse({
  slug: 'menus', title: 'Menus', type: 'feature', phase: 'Development', path: 'docs/plans/menus.md', facts: SOME_FACTS,
  controls: { approve: true, needsDesign: true, interrogate: false, roundsBadge: false, dispatch: true, readyToStart: true },
  sliceSummary: { slices: 1, branches: 1, claimed: 0, eligible: 1, deferred: 0 },
});

const itemsOf = (view: RowMenuView): RowMenuItem[] => {
  if (view.kind !== 'items') throw new Error(`expected an item list, got ${view.kind}`);
  return view.items;
};
const actions = (view: RowMenuView): string[] => itemsOf(view).map((i) => i.action);
const find = (view: RowMenuView, action: string): RowMenuItem => {
  const hit = itemsOf(view).find((i) => i.action === action);
  if (hit === undefined) throw new Error(`no ${action} item`);
  return hit;
};

const planOn: PlanMenuFacts = {
  kind: 'plan', plan: 'menus', card, isDraft: true, needsDesign: true, deliverable: true, hasEligible: true,
  soleSlice: 'feature/one', approve: ON, deliver: ON, implement: ON, dispatch: ON,
};
const planOff: PlanMenuFacts = {
  kind: 'plan', plan: 'menus', card: null, isDraft: false, needsDesign: false, deliverable: false, hasEligible: false,
  soleSlice: null, approve: OFF, deliver: OFF, implement: OFF, dispatch: OFF,
};

const branchOn: BranchMenuFacts = {
  kind: 'branch', branch: 'feature/one', card, openUrl: 'https://host/pull/7', openLabel: 'Review', releaseClaim: true,
  startable: true, conflict: true, needsBrief: true, runUrl: 'https://host/runs/1', runLabel: 'Open the failing run',
  hasLog: true, hasStatus: true, changedFiles: 3, dispatch: ON, implement: ON,
};
const branchOff: BranchMenuFacts = {
  kind: 'branch', branch: 'feature/one', card: null, openUrl: '', openLabel: 'Open', releaseClaim: false,
  startable: false, conflict: false, needsBrief: false, runUrl: '', runLabel: '', hasLog: false, hasStatus: false,
  changedFiles: null, dispatch: OFF, implement: OFF,
};

const { kind: _k, card: _c, dispatch: _d, startable: _s, ...branchPart } = branchOn;
const sliceOn: SliceMenuFacts = {
  kind: 'slice', wave: 'One', slug: 'menus', card, eligible: true, unsliced: true, dispatch: ON, reslice: ON, branch: branchPart,
};
const sliceOff: SliceMenuFacts = {
  kind: 'slice', wave: 'One', slug: 'menus', card: null, eligible: false, unsliced: false, dispatch: OFF, reslice: OFF, branch: null,
};

const issue = IssueRowSchema.parse({ number: 228, title: 'Scan asks once', url: 'https://host/issues/228', ageMinutes: 5 });
const ticketOn: TicketMenuFacts = { kind: 'ticket', issue, idea: ON, story: ON, issueAnswer: 'answered' };
const ticketOff: TicketMenuFacts = {
  kind: 'ticket', issue: IssueRowSchema.parse({ number: 229, title: 'No address', ageMinutes: 5 }), idea: OFF, story: OFF, issueAnswer: 'failed',
};

const PLAN = ['approve', 'needs-design', 'deliver', 'implement', 'dispatch', 'start-work'];
const BRANCH = ['open', 'release-claim', 'start-work', 'resolve-conflict', 'write-brief', 'open-run', 'worker-log', 'status', 'changed-files'];
const SLICE = ['start-work', 'reslice', 'open', 'release-claim', 'resolve-conflict', 'write-brief', 'open-run', 'worker-log', 'status', 'changed-files'];
const TICKET = ['create-plan', 'create-story', 'open-issue'];

const CASES = [
  ['plan', planOn, planOff, PLAN],
  ['branch', branchOn, branchOff, BRANCH],
  ['slice', sliceOn, sliceOff, SLICE],
  ['ticket', ticketOn, ticketOff, TICKET],
] as const;

describe('each kind lists one fixed item set', () => {
  for (const [kind, on, off, expected] of CASES) {
    it(`a ${kind} row with every criterion met lists ${expected.length} items, all enabled`, () => {
      const view = rowMenuOf(on);
      expect(actions(view)).toEqual(expected);
      expect(itemsOf(view).filter((i) => !i.enabled)).toEqual([]);
      expect(itemsOf(view).every((i) => i.reason === null)).toBe(true);
    });

    it(`a ${kind} row with no criterion met lists the same ${expected.length} items, each disabled with a reason`, () => {
      const view = rowMenuOf(off);
      expect(actions(view)).toEqual(expected);
      for (const i of itemsOf(view)) {
        expect(i.enabled, i.action).toBe(false);
        expect(i.reason, i.action).toMatch(/\S/);
      }
    });
  }
});

describe('the trigger is never disabled while its list holds an item', () => {
  for (const [kind, on, off] of CASES) {
    it(`a ${kind} row's trigger reads enabled with every item enabled and with every item disabled`, () => {
      for (const view of [rowMenuOf(on), rowMenuOf(off)]) {
        if (view.kind !== 'items') throw new Error('expected an item list');
        expect(view.items.length).toBeGreaterThan(0);
        expect(view.trigger).toBe('enabled');
      }
    });
  }
});

describe('the plan row\'s items', () => {
  it('approve confirms with the approve sentence and refuses a plan that is not a Draft', () => {
    expect(find(rowMenuOf(planOn), 'approve')).toEqual({ action: 'approve', label: 'Approve', enabled: true, reason: null, confirm: 'Approve — approves menus?' });
    expect(find(rowMenuOf({ ...planOn, isDraft: false }), 'approve')).toMatchObject({ enabled: false, reason: 'the plan is not a Draft' });
  });

  it('needs-design confirms and refuses a plan that is not offered to design', () => {
    expect(find(rowMenuOf(planOn), 'needs-design')).toMatchObject({ enabled: true, confirm: 'Needs design — moves menus to Design?' });
    expect(find(rowMenuOf({ ...planOn, needsDesign: false }), 'needs-design')).toMatchObject({ enabled: false, reason: 'only a Draft plan goes to design' });
  });

  it('deliver confirms and refuses a plan that is not deliverable', () => {
    expect(find(rowMenuOf(planOn), 'deliver')).toMatchObject({ enabled: true, confirm: 'Deliver — spawns /plot-deliver for menus?' });
    expect(find(rowMenuOf({ ...planOn, deliverable: false }), 'deliver')).toMatchObject({ enabled: false, reason: 'not every slice has merged' });
  });

  it('implement and dispatch act on one click and refuse a plan with nothing eligible', () => {
    for (const action of ['implement', 'dispatch']) {
      expect(find(rowMenuOf(planOn), action)).toMatchObject({ enabled: true, reason: null, confirm: null });
      expect(find(rowMenuOf({ ...planOn, hasEligible: false }), action)).toMatchObject({ enabled: false, reason: 'no branch is eligible to start' });
    }
  });

  it('start-work names the sole slice and refuses a plan with none', () => {
    expect(find(rowMenuOf(planOn), 'start-work')).toMatchObject({ label: 'Start work on feature/one', enabled: true, confirm: null });
    expect(find(rowMenuOf({ ...planOn, soleSlice: null }), 'start-work')).toMatchObject({ enabled: false, reason: 'the plan has no single slice to start' });
  });

  it('a binding that will not act gives its own reason, and a missing binding says the board has not answered', () => {
    expect(find(rowMenuOf({ ...planOn, deliver: OFF }), 'deliver').reason).toBe('the board runs read-only');
    expect(find(rowMenuOf({ ...planOn, implement: undefined }), 'implement').reason).toBe('this board has not said whether it can implement');
    expect(find(rowMenuOf({ ...planOn, dispatch: { available: false, reason: '' } }), 'dispatch').reason).toBe('this board will not dispatch');
  });
});

describe('the branch row\'s items', () => {
  it('open carries the row\'s own label and refuses a row with no address', () => {
    expect(find(rowMenuOf(branchOn), 'open')).toMatchObject({ label: 'Review', enabled: true, confirm: null });
    expect(find(rowMenuOf({ ...branchOn, openUrl: '' }), 'open')).toMatchObject({ enabled: false, reason: 'no address' });
  });

  it('release-claim confirms with the release sentence and refuses a branch with no orphaned claim', () => {
    const item = find(rowMenuOf(branchOn), 'release-claim');
    expect(item.enabled).toBe(true);
    expect(item.confirm).toMatch(/feature\/one/);
    expect(find(rowMenuOf({ ...branchOn, releaseClaim: false }), 'release-claim')).toMatchObject({ enabled: false, reason: 'the branch holds no orphaned claim' });
  });

  it('start-work refuses a branch that is not startable', () => {
    expect(find(rowMenuOf(branchOn), 'start-work')).toMatchObject({ enabled: true, confirm: null });
    expect(find(rowMenuOf({ ...branchOn, startable: false }), 'start-work')).toMatchObject({ enabled: false, reason: 'the branch is not startable' });
  });

  it('resolve-conflict and write-brief refuse a branch that does not need them', () => {
    expect(find(rowMenuOf({ ...branchOn, conflict: false }), 'resolve-conflict')).toMatchObject({ enabled: false, reason: 'the branch has no merge conflict' });
    expect(find(rowMenuOf({ ...branchOn, needsBrief: false }), 'write-brief')).toMatchObject({ enabled: false, reason: 'the branch needs no brief' });
  });

  it('the reads refuse a row with nothing to read, and the changed-files label counts the files', () => {
    expect(find(rowMenuOf(branchOn), 'open-run')).toMatchObject({ label: 'Open the failing run', enabled: true });
    expect(find(rowMenuOf({ ...branchOn, runUrl: '' }), 'open-run')).toMatchObject({ enabled: false, reason: 'no run to open' });
    expect(find(rowMenuOf({ ...branchOn, hasLog: false }), 'worker-log')).toMatchObject({ enabled: false, reason: 'no agent works on this branch' });
    expect(find(rowMenuOf({ ...branchOn, hasStatus: false }), 'status')).toMatchObject({ enabled: false, reason: 'no dispatcher log for this plan' });
    expect(find(rowMenuOf(branchOn), 'changed-files').label).toMatch(/3/);
    expect(find(rowMenuOf({ ...branchOn, changedFiles: null }), 'changed-files')).toMatchObject({ enabled: false, reason: 'no failing check lists changed files' });
  });

  it('a read stays enabled where the board will not dispatch', () => {
    const view = rowMenuOf({ ...branchOn, dispatch: OFF, implement: OFF });
    for (const action of ['open', 'open-run', 'worker-log', 'status', 'changed-files']) expect(find(view, action).enabled, action).toBe(true);
  });
});

describe('the slice row\'s items', () => {
  it('start-work stays enabled where the dispatch binding acts, and refuses with the binding\'s reason where it does not', () => {
    expect(find(rowMenuOf(sliceOn), 'start-work')).toMatchObject({ enabled: true, reason: null });
    expect(find(rowMenuOf({ ...sliceOn, dispatch: OFF }), 'start-work')).toMatchObject({ enabled: false, reason: 'the board runs read-only' });
    expect(find(rowMenuOf({ ...sliceOn, eligible: false }), 'start-work')).toMatchObject({ enabled: false, reason: 'the slice is not eligible to start' });
  });

  it('reslice confirms with the reslice sentence and refuses a slice that holds one branch', () => {
    expect(find(rowMenuOf(sliceOn), 'reslice')).toMatchObject({ label: 'Slice this plan', enabled: true, confirm: 'Slice this plan — spawns /plot-reslice for menus?' });
    expect(find(rowMenuOf({ ...sliceOn, unsliced: false }), 'reslice')).toMatchObject({ enabled: false, reason: 'the slice holds one branch' });
  });

  it('the branch items refuse a slice with no single branch', () => {
    const view = rowMenuOf({ ...sliceOn, branch: null });
    for (const action of SLICE.slice(2)) expect(find(view, action)).toMatchObject({ enabled: false, reason: 'the slice has no single branch' });
  });
});

describe('the Tickets row\'s items', () => {
  it('create-plan and create-story confirm with their sentences', () => {
    expect(find(rowMenuOf(ticketOn), 'create-plan')).toMatchObject({ enabled: true, confirm: 'Create plan — Draft for #228?' });
    expect(find(rowMenuOf(ticketOn), 'create-story')).toMatchObject({ enabled: true, confirm: 'Create story — track #228?' });
  });

  it('an unread tracker refuses both creates as pending, and a failing one names the failure', () => {
    expect(find(rowMenuOf({ ...ticketOn, issueAnswer: null }), 'create-plan').reason).toBe('the tracker has not been read yet');
    expect(find(rowMenuOf({ ...ticketOn, issueAnswer: null }), 'create-story').reason).toBe('the tracker has not been read yet');
    expect(find(rowMenuOf({ ...ticketOn, issueAnswer: 'failed' }), 'create-plan').reason).toMatch(/failing/);
  });

  it('a binding that will not create gives its own reason', () => {
    expect(find(rowMenuOf({ ...ticketOn, idea: OFF }), 'create-plan').reason).toBe('the board runs read-only');
    expect(find(rowMenuOf({ ...ticketOn, story: OFF }), 'create-story').reason).toBe('the board runs read-only');
  });

  it('open-issue acts on one click and refuses a ticket with no address', () => {
    expect(find(rowMenuOf(ticketOn), 'open-issue')).toEqual({ action: 'open-issue', label: 'Open on host', enabled: true, reason: null, confirm: null });
    expect(find(rowMenuOf(ticketOff), 'open-issue')).toMatchObject({ enabled: false, reason: 'no address' });
  });
});

describe('the scope group row\'s items', () => {
  const TICKETS = { kind: 'tickets' } as const;
  const scopeRow = (over: Partial<ScopeTicketMenuFacts>): ScopeTicketMenuFacts => ({
    kind: 'scope-ticket', issue, idea: ON, story: ON, issueAnswer: 'answered',
    menu: { openOnHost: { href: 'https://host/issues/228', reason: null }, createPlan: TICKETS, createStory: TICKETS },
    ...over,
  });

  it('lists Create plan, Create story and Open on host, in that order', () => {
    expect(actions(rowMenuOf(scopeRow({})))).toEqual(['create-plan', 'create-story', 'open-issue']);
  });

  it('a tickets arm takes the Tickets row\'s item', () => {
    expect(find(rowMenuOf(scopeRow({})), 'create-plan')).toEqual(find(rowMenuOf(ticketOn), 'create-plan'));
    expect(find(rowMenuOf(scopeRow({})), 'create-story')).toEqual(find(rowMenuOf(ticketOn), 'create-story'));
  });

  it('a disabled arm shows its reason', () => {
    const named = scopeRow({ menu: { openOnHost: { href: 'u', reason: null }, createPlan: { kind: 'disabled', reason: PLAN_NAMED_REASON, code: 'plan-named' }, createStory: TICKETS } });
    expect(find(rowMenuOf(named), 'create-plan')).toMatchObject({ enabled: false, reason: PLAN_NAMED_REASON });
    expect(find(rowMenuOf(named), 'create-story').enabled).toBe(true);
  });

  it('a key-only row disables both create items and keeps Open on host where an address exists', () => {
    const keyOnly = scopeRow({ issue: null });
    expect(find(rowMenuOf(keyOnly), 'create-plan')).toMatchObject({ enabled: false, reason: NO_TICKET_ROW_REASON });
    expect(find(rowMenuOf(keyOnly), 'create-story')).toMatchObject({ enabled: false, reason: NO_TICKET_ROW_REASON });
    expect(find(rowMenuOf(keyOnly), 'open-issue').enabled).toBe(true);
  });

  it('Open on host refuses a row with no address', () => {
    const noAddress = scopeRow({ menu: { openOnHost: { href: '', reason: NO_ADDRESS_REASON }, createPlan: TICKETS, createStory: TICKETS } });
    expect(find(rowMenuOf(noAddress), 'open-issue')).toMatchObject({ enabled: false, reason: NO_ADDRESS_REASON });
  });
});
