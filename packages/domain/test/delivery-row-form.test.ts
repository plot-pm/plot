// The seven columns of a Delivery row and what each cell links to, per the
// design's "Links by Row" table. One test per row of the table: a test that
// checks only the slice-at-a-gate row passes with every other row wrong.
import { describe, it, expect } from 'vitest';
import type { AgentPlacement, ItemPlacement } from '../src/rules/delivery-placement.js';
import {
  ROW_COLUMNS,
  ageValue,
  agentRowCells,
  groupHeader,
  itemRowCells,
  type DeliverySwitches,
  type ItemRowFacts,
} from '../src/rules/delivery-row-form.js';

const work = (group: 'at-a-gate' | 'being-built' | 'queued', agents: string[] = [], kind: ItemPlacement['kind'] = 'slice'): ItemPlacement =>
  ({ id: 'slice:a', kind, section: 'work-items', group, reason: null, agents });
const you = (reason: Extract<ItemPlacement, { section: 'you' }>['reason'], group: Extract<ItemPlacement, { section: 'you' }>['group'], agents: string[] = [], kind: ItemPlacement['kind'] = 'slice'): ItemPlacement =>
  ({ id: 'slice:a', kind, section: 'you', group, reason, agents });
const facts: ItemRowFacts = { plan: 'the-plan', slice: 'first', branch: 'feature/x', pr: 12, ciRun: '#901', ageMinutes: 125 };

describe('the seven columns', () => {
  it('are KIND, ITEM, WHERE, STATUS, DO, BY, AGE in that order', () => {
    expect([...ROW_COLUMNS]).toEqual(['kind', 'item', 'where', 'status', 'do', 'by', 'age']);
    const cells = itemRowCells(work('queued'), facts)!;
    expect(Object.keys(cells)).toEqual([...ROW_COLUMNS]);
  });

  it('show DO under You only', () => {
    expect(itemRowCells(work('being-built'), facts)!.do).toBeNull();
    expect(itemRowCells(work('at-a-gate'), facts)!.do).toBeNull();
    expect(itemRowCells(you('plan-approval', 'input-to-the-fleet', [], 'plan'), facts)!.do).toEqual({
      value: 'approve ›', links: [{ to: 'action', action: 'approve', id: 'slice:a' }],
    });
  });
});

describe('links by row', () => {
  it('slice, queued: ITEM links to the plan § slice, STATUS to the slice it waits on, WHERE and BY are empty', () => {
    const c = itemRowCells(work('queued'), { ...facts, waitsOn: 'zero' })!;
    expect(c.item).toEqual({ value: 'first', links: [{ to: 'plan', plan: 'the-plan', slice: 'first' }] });
    expect(c.where).toBeNull();
    expect(c.status).toEqual({ value: 'waits on zero', links: [{ to: 'slice', id: 'zero' }] });
    expect(c.by).toBeNull();
  });

  it('slice, queued: no wait names no STATUS', () => {
    expect(itemRowCells(work('queued'), facts)!.status).toBeNull();
  });

  it('slice, being built: WHERE links to the branch, BY to the agent row, STATUS is empty', () => {
    const c = itemRowCells(work('being-built', ['agent-1']), facts)!;
    expect(c.item!.links).toEqual([{ to: 'plan', plan: 'the-plan', slice: 'first' }]);
    expect(c.where).toEqual({ value: 'feature/x', links: [{ to: 'branch', branch: 'feature/x' }] });
    expect(c.status).toBeNull();
    expect(c.by).toEqual({ value: 'agent-1', links: [{ to: 'agent', id: 'agent-1' }] });
  });

  it('slice, at a gate: WHERE links to branch and PR, STATUS to the CI run, BY to the fixer row', () => {
    const c = itemRowCells(work('at-a-gate', ['fixer-f3a1']), { ...facts, prReading: { ci: 'failed', review: 'unread' } })!;
    expect(c.where).toEqual({
      value: 'feature/x · #12',
      links: [{ to: 'branch', branch: 'feature/x' }, { to: 'pr', pr: 12 }],
    });
    expect(c.status).toEqual({ value: 'CI ✗ #901', links: [{ to: 'ci-run', run: '#901' }] });
    expect(c.by).toEqual({ value: 'fixer-f3a1', links: [{ to: 'agent', id: 'fixer-f3a1' }] });
  });

  it('slice, at a gate: a review gate links STATUS to the review', () => {
    const c = itemRowCells(work('at-a-gate', ['reviewer-1']), { ...facts, ciRun: undefined, prReading: { ci: 'unread', review: 'pending' } })!;
    expect(c.status).toEqual({ value: 'review ⟳', links: [{ to: 'review', pr: 12 }] });
  });

  it('slice, stuck: STATUS links to the agent question, WHERE to branch and PR, BY to the agent row', () => {
    const c = itemRowCells(you('blocked-marker', 'unblock', ['agent-2']), { ...facts, question: 'q-7' })!;
    expect(c.item!.links).toEqual([{ to: 'plan', plan: 'the-plan', slice: 'first' }]);
    expect(c.where!.links).toEqual([{ to: 'branch', branch: 'feature/x' }, { to: 'pr', pr: 12 }]);
    expect(c.status).toEqual({ value: 'blocked · question', links: [{ to: 'question', id: 'q-7' }] });
    expect(c.by).toEqual({ value: 'agent-2', links: [{ to: 'agent', id: 'agent-2' }] });
    expect(c.do).toEqual({ value: 'answer ›', links: [{ to: 'action', action: 'continue', id: 'slice:a' }] });
  });

  it('slice, stuck by a failed build: STATUS links to the failed CI run', () => {
    const c = itemRowCells(you('fleet-stuck', 'unblock', ['agent-2']), { ...facts, prReading: { ci: 'failed', review: 'unread' } })!;
    expect(c.status).toEqual({ value: 'stuck · CI ✗ #901', links: [{ to: 'ci-run', run: '#901' }] });
  });

  it('PR with no plan: ITEM links to the PR, WHERE to the branch, STATUS to the CI run, BY to the agent', () => {
    const c = itemRowCells(work('at-a-gate', ['agent-3'], 'pr'), { branch: 'feature/y', pr: 40, ciRun: '#7', prReading: { ci: 'running', review: 'unread' } })!;
    expect(c.kind).toEqual({ value: 'PR', links: [] });
    expect(c.item).toEqual({ value: '#40', links: [{ to: 'pr', pr: 40 }] });
    expect(c.where).toEqual({ value: 'feature/y', links: [{ to: 'branch', branch: 'feature/y' }] });
    expect(c.status).toEqual({ value: 'CI ⟳ #7', links: [{ to: 'ci-run', run: '#7' }] });
    expect(c.by).toEqual({ value: 'agent-3', links: [{ to: 'agent', id: 'agent-3' }] });
  });

  it('PR with no plan and no agent: BY is empty', () => {
    expect(itemRowCells(work('at-a-gate', [], 'pr'), { pr: 40 })!.by).toBeNull();
  });

  it('agent: ITEM links to its panel, WHERE to the work item row, STATUS to its question, BY to who started it', () => {
    const p: AgentPlacement = { id: 'agent-9', role: 'fixer', section: 'fleet', group: 'blocked', actsOn: 'slice:a', linked: true, blockedOn: 'person' };
    const c = agentRowCells(p, { question: 'q-1', startedBy: 'fleetd', ageMinutes: 5 });
    expect(c.kind).toEqual({ value: 'fixer', links: [] });
    expect(c.item).toEqual({ value: 'agent-9', links: [{ to: 'agent', id: 'agent-9' }] });
    expect(c.where).toEqual({ value: 'slice:a', links: [{ to: 'item', id: 'slice:a' }] });
    expect(c.status).toEqual({ value: 'your answer', links: [{ to: 'question', id: 'q-1' }] });
    expect(c.do).toBeNull();
    expect(c.by).toEqual({ value: 'fleetd', links: [] });
    expect(c.age).toEqual({ value: '5m', links: [] });
  });

  it('agent blocked on CI: STATUS names the gate and links to the log', () => {
    const p: AgentPlacement = { id: 'a', role: 'loop', section: 'fleet', group: 'blocked', actsOn: 'x', linked: false, blockedOn: 'ci' };
    const c = agentRowCells(p, { gateRef: '#3234' });
    expect(c.status).toEqual({ value: 'CI #3234', links: [{ to: 'log', id: 'a' }] });
    expect(c.where).toBeNull();
  });
});

describe('absent is not false', () => {
  it('shows no STATUS for a PR whose checks nobody read', () => {
    const c = itemRowCells(work('at-a-gate'), { ...facts, prReading: { ci: 'unread', review: 'unread' } })!;
    expect(c.status).toBeNull();
  });

  it('shows no AGE where none was read, and none of "0m"', () => {
    expect(itemRowCells(work('queued'), { plan: 'p' })!.age).toBeNull();
  });

  it('holds no pid, manifest count or desk path in any cell', () => {
    const c = itemRowCells(work('being-built', ['agent-1']), facts)!;
    const text = JSON.stringify(c);
    expect(text).not.toMatch(/pid|manifest|synthesized|worktree|\.worktrees/);
  });
});

describe('ageValue', () => {
  it.each([[0, '0m'], [59, '59m'], [60, '1h'], [125, '2h'], [1440, '1d'], [-5, '0m']])('%d minutes reads %s', (m, v) => {
    expect(ageValue(m)).toBe(v);
  });
});

describe('groupHeader', () => {
  const on: DeliverySwitches = { autoDispatch: true, autoReview: true, autoVerify: true, autoDesign: true };
  const queued = [work('queued'), work('queued'), work('queued')];

  it('names auto-dispatch in the Queued header when the switch is off', () => {
    const h = groupHeader('Queued', 'work-items', 'queued', queued, { ...on, autoDispatch: false });
    expect(h.text).toBe('Queued (3) · auto-dispatch off · start ›');
    expect(h.held).toEqual([{ switch: 'autoDispatch', name: 'auto-dispatch', action: 'start' }]);
    expect(h.count).toBe(3);
  });

  it('names nothing when the switch is on', () => {
    expect(groupHeader('Queued', 'work-items', 'queued', queued, on).text).toBe('Queued (3)');
  });

  it('names nothing for an empty group', () => {
    expect(groupHeader('Queued', 'work-items', 'queued', [], { ...on, autoDispatch: false }).held).toEqual([]);
  });

  it('holds Input to the fleet by auto-design only where a draft plan sits there', () => {
    const off = { ...on, autoDesign: false };
    const draft = you('draft-plan', 'input-to-the-fleet', [], 'plan');
    const approval = you('plan-approval', 'input-to-the-fleet', [], 'plan');
    expect(groupHeader('Input to the fleet', 'you', 'input-to-the-fleet', [draft], off).text).toBe('Input to the fleet (1) · auto-design off · design ›');
    expect(groupHeader('Input to the fleet', 'you', 'input-to-the-fleet', [approval], off).held).toEqual([]);
  });

  it('holds Review a result by auto-review and auto-verify by the reasons its items carry', () => {
    const off = { ...on, autoReview: false, autoVerify: false };
    const items = [you('review-pr', 'review-a-result'), you('test-delivered-plan', 'review-a-result', [], 'plan')];
    expect(groupHeader('Review a result', 'you', 'review-a-result', items, off).held.map((h) => h.switch)).toEqual(['autoReview', 'autoVerify']);
    expect(groupHeader('Review a result', 'you', 'review-a-result', [items[0]!], off).held.map((h) => h.switch)).toEqual(['autoReview']);
  });

  it('never holds At a gate, Being built or a Fleet group', () => {
    const off = { autoDispatch: false, autoReview: false, autoVerify: false, autoDesign: false };
    expect(groupHeader('At a gate', 'work-items', 'at-a-gate', [work('at-a-gate')], off).held).toEqual([]);
    expect(groupHeader('Working', 'fleet', 'working', [], off).held).toEqual([]);
  });
});
