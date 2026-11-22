// The seven columns of a Delivery row and what each cell links to, per the
// design's "Links by Row" table. One test per row of the table: a test that
// checks only the slice-at-a-gate row passes with every other row wrong.
import { describe, it, expect } from 'vitest';
import { youCaseOf, type AgentPlacement, type ItemPlacement, type PrReading, type YouReason } from '../src/rules/delivery-placement.js';
import {
  youFooter,
  ROW_COLUMNS,
  ageValue,
  AGENT_COLUMNS,
  agentRowCells,
  agentWaitsOn,
  deliveryRowForms,
  groupHeader,
  itemRowCells,
  gatesCell,
  progressCell,
  REASON_DO,
  YOU_COLUMNS,
  ageRangeValue,
  looseGroupRow,
  reasonVerb,
  youRowCells,
  youStatusText,
  type DeliverySwitches,
  type ItemRowFacts,
} from '../src/rules/delivery-row-form.js';

const work = (group: 'at-a-gate' | 'being-built' | 'queued', agents: string[] = [], kind: ItemPlacement['kind'] = 'slice'): ItemPlacement =>
  ({ id: 'slice:a', kind, section: 'work-items', group, reason: null, agents });
const you = (reason: Extract<ItemPlacement, { section: 'you' }>['reason'], group: Extract<ItemPlacement, { section: 'you' }>['group'], agents: string[] = [], kind: ItemPlacement['kind'] = 'slice'): ItemPlacement =>
  ({ id: 'slice:a', kind, section: 'you', group, marker: youCaseOf(reason).marker, reason, agents });
const facts: ItemRowFacts = { plan: 'the-plan', slice: 'first', branch: 'feature/x', pr: 12, ciRun: '#901', ageMinutes: 125 };

describe('the seven columns', () => {
  it('are KIND, ITEM, WHERE, STATUS, BY, AGE, DO in that order', () => {
    expect([...ROW_COLUMNS]).toEqual(['kind', 'item', 'where', 'status', 'by', 'age', 'do']);
    const cells = itemRowCells(work('queued'), facts)!;
    expect(Object.keys(cells)).toEqual([...ROW_COLUMNS]);
  });

  it('show DO under You only', () => {
    expect(itemRowCells(work('being-built'), facts)!.do).toBeNull();
    expect(itemRowCells(work('at-a-gate'), facts)!.do).toBeNull();
    expect(itemRowCells(you('plan-approval', 'blocks-delivery', [], 'plan'), facts)!.do).toEqual({
      value: 'Approve ›', links: [{ to: 'action', action: 'approve', id: 'slice:a' }],
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
    const c = itemRowCells(you('blocked-marker', 'blocks-delivery', ['agent-2']), { ...facts, question: 'q-7' })!;
    expect(c.item!.links).toEqual([{ to: 'plan', plan: 'the-plan', slice: 'first' }]);
    expect(c.where!.links).toEqual([{ to: 'branch', branch: 'feature/x' }, { to: 'pr', pr: 12 }]);
    expect(c.status).toEqual({ value: 'blocked · question', links: [{ to: 'question', id: 'q-7' }] });
    expect(c.by).toEqual({ value: 'agent-2', links: [{ to: 'agent', id: 'agent-2' }] });
    expect(c.do).toEqual({ value: 'Answer ›', links: [{ to: 'action', action: 'continue', id: 'slice:a' }] });
  });

  it('slice, stuck by a failed build: STATUS links to the failed CI run', () => {
    const c = itemRowCells(you('fleet-stuck', 'blocks-delivery', ['agent-2']), { ...facts, prReading: { ci: 'failed', review: 'unread' } })!;
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

  it('agent: Agent links to its panel, Acting on to the work item row with the branch beneath, Waits on to its question', () => {
    const p: AgentPlacement = { id: 'agent-9', role: 'fixer', section: 'fleet', group: 'blocked', actsOn: 'slice:a', linked: true, blockedOn: 'person' };
    const c = agentRowCells(p, { question: 'q-1', branch: 'feature/x' });
    expect(c.agent).toEqual({ value: 'agent-9', links: [{ to: 'agent', id: 'agent-9' }] });
    expect(c.role).toEqual({ value: 'fixer', links: [] });
    expect(c.actingOn).toEqual({ value: 'slice:a', links: [{ to: 'item', id: 'slice:a' }] });
    expect(c.branch).toEqual({ value: 'feature/x', links: [{ to: 'branch', branch: 'feature/x' }] });
    expect(c.doingLabel).toBe('Waits on');
    expect(c.doing).toEqual({ value: 'person', links: [{ to: 'question', id: 'q-1' }] });
    expect(c.tokens).toBeNull();
    expect(c.timeLeft).toBeNull();
  });
});

describe('the six agent columns', () => {
  it('are Agent, Role, Acting on, Doing now, Tokens, Time left', () => {
    expect([...AGENT_COLUMNS]).toEqual(['agent', 'role', 'actingOn', 'doing', 'tokens', 'timeLeft']);
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
    const approval = you('plan-approval', 'blocks-delivery', [], 'plan');
    expect(groupHeader('Input to the fleet', 'you', 'input-to-the-fleet', [draft], off).text).toBe('Input to the fleet (1) · auto-design off · design ›');
    expect(groupHeader('Blocks delivery', 'you', 'blocks-delivery', [approval], off).held).toEqual([]);
  });

  it('holds Blocks delivery by auto-review and auto-verify by the reasons its items carry', () => {
    const off = { ...on, autoReview: false, autoVerify: false };
    const items = [you('review-pr', 'blocks-delivery'), you('test-delivered-plan', 'blocks-delivery', [], 'plan')];
    expect(groupHeader('Blocks delivery', 'you', 'blocks-delivery', items, off).held.map((h) => h.switch)).toEqual(['autoReview', 'autoVerify']);
    expect(groupHeader('Blocks delivery', 'you', 'blocks-delivery', [items[0]!], off).held.map((h) => h.switch)).toEqual(['autoReview']);
  });

  it('names no switch on a Blocks delivery group of approvals and blocked slices', () => {
    const off = { autoDispatch: false, autoReview: false, autoVerify: false, autoDesign: false };
    const items = [you('plan-approval', 'blocks-delivery', [], 'plan'), you('blocked-marker', 'blocks-delivery'), you('fleet-stuck', 'blocks-delivery')];
    expect(groupHeader('Blocks delivery', 'you', 'blocks-delivery', items, off).held).toEqual([]);
  });

  it('never holds At a gate, Being built or a Fleet group', () => {
    const off = { autoDispatch: false, autoReview: false, autoVerify: false, autoDesign: false };
    expect(groupHeader('At a gate', 'work-items', 'at-a-gate', [work('at-a-gate')], off).held).toEqual([]);
    expect(groupHeader('Working', 'fleet', 'working', [], off).held).toEqual([]);
  });
});

describe('links by row: plans, releases and loose branches', () => {
  it('plan awaiting a decision: ITEM links to the plan, WHERE to the plan PR, BY to the person, DO to the action', () => {
    const c = itemRowCells(you('plan-approval', 'blocks-delivery', [], 'plan'), { plan: 'the-plan', planPr: 77, person: 'jwloka' })!;
    expect(c.item).toEqual({ value: 'the-plan', links: [{ to: 'plan', plan: 'the-plan', slice: null }] });
    expect(c.where).toEqual({ value: '#77', links: [{ to: 'plan-pr', pr: 77 }] });
    expect(c.status).toEqual({ value: 'approval', links: [] });
    expect(c.by).toEqual({ value: 'jwloka', links: [{ to: 'person', handle: 'jwloka' }] });
  });

  it('plan awaiting a decision with no plan PR or person leaves WHERE and BY empty', () => {
    const c = itemRowCells(you('draft-plan', 'input-to-the-fleet', [], 'plan'), { plan: 'the-plan' })!;
    expect(c.where).toBeNull();
    expect(c.by).toBeNull();
  });

  it('plan in Testing: STATUS links to every merged PR', () => {
    const c = itemRowCells(you('test-delivered-plan', 'blocks-delivery', [], 'plan'), { plan: 'the-plan', mergedPrs: [3, 4], person: 'eins78' })!;
    expect(c.status).toEqual({ value: 'to test · 2 merged', links: [{ to: 'pr', pr: 3 }, { to: 'pr', pr: 4 }] });
    expect(c.where).toBeNull();
    expect(c.by!.value).toBe('eins78');
  });

  it('plan in Testing with no merged PRs read keeps only the reason', () => {
    const c = itemRowCells(you('test-delivered-plan', 'blocks-delivery', [], 'plan'), { plan: 'the-plan' })!;
    expect(c.status).toEqual({ value: 'to test', links: [] });
  });

  it('a plan outside You has no row', () => {
    expect(itemRowCells(work('queued', [], 'plan'), { plan: 'the-plan' })).toBeNull();
  });

  it('release: ITEM links to the PR, WHERE to its branch, STATUS to the gate', () => {
    const c = itemRowCells(you('release-approval', 'blocks-delivery', [], 'release'), { branch: 'changeset-release/main', pr: 90, prReading: { ci: 'passed', review: 'unread' }, ciRun: '#5' })!;
    expect(c.item).toEqual({ value: '#90', links: [{ to: 'pr', pr: 90 }] });
    expect(c.where).toEqual({ value: 'branch', links: [{ to: 'branch', branch: 'changeset-release/main' }] });
    expect(c.status).toEqual({ value: 'release approval · CI ✓ #5', links: [{ to: 'ci-run', run: '#5' }] });
  });

  it('release with no branch or PR read falls back to the id and an empty WHERE', () => {
    const c = itemRowCells(you('release-approval', 'blocks-delivery', [], 'release'), {})!;
    expect(c.item).toEqual({ value: '#slice:a', links: [] });
    expect(c.where).toBeNull();
  });

  it('loose branch: ITEM links to the branch, WHERE to the compare view, STATUS is the last commit, BY is empty', () => {
    const p: ItemPlacement = { id: 'branch:x', kind: 'branch', section: 'you', group: 'blocks-delivery', marker: 'blocks-delivery', reason: 'fleet-stuck', agents: ['a1'] };
    const c = itemRowCells(p, { branch: 'feature/x', lastCommit: 'abc1234' })!;
    expect(c.item).toEqual({ value: 'feature/x', links: [{ to: 'branch', branch: 'feature/x' }] });
    expect(c.where).toEqual({ value: 'compare', links: [{ to: 'compare', branch: 'feature/x' }] });
    expect(c.status).toEqual({ value: 'stuck · abc1234', links: [] });
    expect(c.by).toBeNull();
  });

  it('loose branch with nothing read falls back to the id', () => {
    const p: ItemPlacement = { id: 'branch:x', kind: 'branch', section: 'work-items', group: 'at-a-gate', reason: null, agents: [] };
    const c = itemRowCells(p, {})!;
    expect(c.item).toEqual({ value: 'branch:x', links: [] });
    expect(c.where).toBeNull();
    expect(c.status).toBeNull();
  });

  it('PR with no plan and no PR number falls back to the id', () => {
    const c = itemRowCells(work('at-a-gate', [], 'pr'), {})!;
    expect(c.item).toEqual({ value: '#slice:a', links: [] });
    expect(c.where).toBeNull();
  });
});

describe('the STATUS gate readings', () => {
  const gateOf = (prReading: ItemRowFacts['prReading'], extra: Partial<ItemRowFacts> = {}) =>
    itemRowCells(work('at-a-gate'), { ...facts, ciRun: undefined, prReading, ...extra })!.status;

  it('names a CI reading without a run when none was read', () => {
    expect(gateOf({ ci: 'passed', review: 'unread' })).toEqual({ value: 'CI ✓', links: [] });
  });

  it.each([['high', 'review ✗'], ['passed', 'review ✓']] as const)('reads a %s review as %s', (review, value) => {
    expect(gateOf({ ci: 'unread', review })).toEqual({ value, links: [{ to: 'review', pr: 12 }] });
  });

  it('leaves a review that was never asked out of STATUS', () => {
    expect(gateOf({ ci: 'unread', review: 'none' })).toBeNull();
  });

  it('names no gate where no PR reading exists', () => {
    expect(gateOf(undefined)).toBeNull();
  });

  it('links a review gate to no review where no PR number was read', () => {
    expect(gateOf({ ci: 'unread', review: 'pending' }, { pr: undefined })).toEqual({ value: 'review ⟳', links: [] });
  });

  it('shows WHERE with the PR alone, and with the branch alone', () => {
    expect(itemRowCells(work('at-a-gate'), { plan: 'p', pr: 5 })!.where).toEqual({ value: '#5', links: [{ to: 'pr', pr: 5 }] });
    expect(itemRowCells(work('at-a-gate'), { plan: 'p', branch: 'b' })!.where).toEqual({ value: 'b', links: [{ to: 'branch', branch: 'b' }] });
    expect(itemRowCells(work('at-a-gate'), { plan: 'p' })!.where).toBeNull();
  });

  it('names an item by its plan when no slice was read, and by its id when neither was', () => {
    expect(itemRowCells(work('queued'), { plan: 'p' })!.item!.value).toBe('p');
    expect(itemRowCells(work('queued'), {})!.item).toEqual({ value: 'slice:a', links: [] });
  });

  it('shows a stuck slice with no gate and no question as its reason alone', () => {
    expect(itemRowCells(you('agent-died', 'blocks-delivery', ['a']), { plan: 'p' })!.status).toEqual({ value: 'agent died', links: [] });
  });

  it('shows a loose branch as loose, with its last commit, and offers to release or delete it', () => {
    const cells = itemRowCells(you('loose', 'unblock', [], 'branch'), { branch: 'feature/x', lastCommit: 'abc1234' })!;
    expect(cells.status).toEqual({ value: 'loose · abc1234', links: [] });
    expect(cells.do).toEqual({ value: 'Release or delete ›', links: [{ to: 'action', action: 'release-or-delete', id: 'slice:a' }] });
  });
});

describe('agent rows, the other readings', () => {
  const agent = (over: Partial<AgentPlacement>): AgentPlacement =>
    ({ id: 'a', role: 'loop', section: 'fleet', group: 'working', actsOn: null, linked: false, blockedOn: null, ...over });
  const blocked = (over: Partial<AgentPlacement> = {}): AgentPlacement => agent({ group: 'blocked', actsOn: 'x', linked: true, ...over });

  it('names what a loop agent does, with its commit count', () => {
    expect(agentRowCells(agent({ actsOn: 'x', linked: true }), { commits: 4, lastCommit: 'add the thing' }).doing)
      .toEqual({ value: 'writing code · 4 commits', links: [{ to: 'log', id: 'a' }] });
    expect(agentRowCells(agent({ actsOn: 'x', linked: true }), { commits: 4, lastCommit: 'add the thing' }).doingDetail).toBe('add the thing');
    expect(agentRowCells(agent({ actsOn: 'x', linked: true }), {}).doing!.value).toBe('writing code');
  });

  it('names a reviewer by its head and a fixer by its attempt', () => {
    expect(agentRowCells(agent({ role: 'reviewer', actsOn: 'x' }), { reviewHead: '2d929a6' }).doing!.value).toBe('reviewing head 2d929a6');
    expect(agentRowCells(agent({ role: 'fixer', actsOn: 'x' }), { fixerFinding: 'ci', fixerAttempt: 1 }).doing!.value).toBe('fixing CI ✗ · attempt 1 of 2');
    expect(agentRowCells(agent({ role: 'reviewer', actsOn: 'x' }), {}).doing!.value).toBe('reviewing');
    expect(agentRowCells(agent({ role: 'fixer', actsOn: 'x' }), { fixerFinding: 'high' }).doing!.value).toBe('fixing review ✗');
    expect(agentRowCells(agent({ role: 'fixer', actsOn: 'x' }), {}).doing!.value).toBe('fixing');
    const words: Record<string, string> = {
      design: 'designing', verify: 'verifying', idea: 'writing the idea', brief: 'writing the brief', approver: 'approving',
    };
    for (const [role, word] of Object.entries(words)) {
      expect(agentRowCells(agent({ role: role as never, actsOn: 'x' }), {}).doing!.value).toBe(word);
    }
    expect(agentRowCells(agent({ actsOn: 'x' }), { commits: 1 }).doing!.value).toBe('writing code · 1 commit');
  });

  it.each([
    ['high', 'fixing review ✗'],
    ['ci', 'fixing CI ✗'],
    ['conflict', 'fixing conflict ✗'],
  ] as const)('names a fixer on a %s finding, with and without its attempt', (fixerFinding, word) => {
    const fixer = agent({ role: 'fixer', actsOn: 'x' });
    expect(agentRowCells(fixer, { fixerFinding }).doing!.value).toBe(word);
    expect(agentRowCells(fixer, { fixerFinding, fixerAttempt: 2 }).doing!.value).toBe(`${word} · attempt 2 of 2`);
  });

  it('names a fixer with no finding by the bare word, with and without its attempt', () => {
    const fixer = agent({ role: 'fixer', actsOn: 'x' });
    expect(agentRowCells(fixer, {}).doing!.value).toBe('fixing');
    expect(agentRowCells(fixer, { fixerAttempt: 1 }).doing!.value).toBe('fixing · attempt 1 of 2');
  });

  it('shows no Doing now for an agent with no item', () => {
    expect(agentRowCells(agent({}), {}).doing).toBeNull();
  });

  it('leaves Acting on empty for an agent whose item has no row', () => {
    expect(agentRowCells(agent({ actsOn: 'x', linked: false }), {}).actingOn).toBeNull();
  });

  it('puts the unnamed-desk text in the Agent tooltip and nowhere in the row text', () => {
    const c = agentRowCells(agent({}), { unnamedDesk: 'no manifest names this desk' });
    expect(c.agentTitle).toBe('no manifest names this desk');
    expect(JSON.stringify({ ...c, agentTitle: null })).not.toContain('no manifest');
  });

  it('Waits on: CI running names ci and links to the checks page', () => {
    const w = agentWaitsOn(blocked(), { pr: { ci: 'running', review: 'unread', checksUrl: 'https://h/checks', url: 'https://h/pr' } });
    expect(w).toEqual({ gate: 'ci', cell: { value: 'CI', links: [{ to: 'url', url: 'https://h/checks' }] } });
  });

  it('Waits on: CI passed and review pending names review and links to the PR', () => {
    const w = agentWaitsOn(blocked(), { pr: { ci: 'passed', review: 'pending', checksUrl: 'https://h/checks', url: 'https://h/pr' } });
    expect(w).toEqual({ gate: 'review', cell: { value: 'review', links: [{ to: 'url', url: 'https://h/pr' }] } });
  });

  it('Waits on: CI and review name their gate with no link when the host gave no URL', () => {
    expect(agentWaitsOn(blocked(), { pr: { ci: 'running', review: 'unread' } })).toEqual({ gate: 'ci', cell: { value: 'CI', links: [] } });
    expect(agentWaitsOn(blocked(), { pr: { ci: 'passed', review: 'pending' } })).toEqual({ gate: 'review', cell: { value: 'review', links: [] } });
  });

  it('a blocked agent with no gate has an empty Waits on cell', () => {
    expect(agentRowCells(blocked(), {}).doing).toBeNull();
  });

  it('Waits on: no CI reading is no gate, and unknown limit is neither exhausted nor free', () => {
    expect(agentWaitsOn(blocked(), { pr: { ci: 'unread', review: 'unread' } })).toBeNull();
    expect(agentWaitsOn(blocked(), {})).toBeNull();
    expect(agentWaitsOn(blocked(), { rateLimit: 'unknown' })).toBeNull();
    expect(agentWaitsOn(blocked(), { rateLimit: 'free' })).toBeNull();
    expect(agentWaitsOn(blocked(), { rateLimit: 'exhausted' })!.gate).toBe('rate-limit');
  });

  it('Waits on: two true gates show one value, by the stated order', () => {
    const both = { rateLimit: 'exhausted' as const, pr: { ci: 'running' as const, review: 'unread' as const } };
    expect(agentWaitsOn(blocked(), both)!.gate).toBe('rate-limit');
    expect(agentWaitsOn(blocked({ blockedOn: 'person' }), both)!.gate).toBe('person');
  });

  it('shows no Waits on outside Blocked', () => {
    expect(agentWaitsOn(agent({}), { rateLimit: 'exhausted' })).toBeNull();
  });
});

describe('one Fleet row per agent', () => {
  const agent = (over: Partial<AgentPlacement>): AgentPlacement =>
    ({ id: 'agent:6353f651-f356', role: 'loop', section: 'fleet', group: 'free', actsOn: null, linked: false, blockedOn: null, ...over });

  it('says a running loop with no slice waits for one, and not that it runs', () => {
    expect(agentRowCells(agent({}), { running: true }).doing).toEqual({ value: 'waiting for a slice', links: [{ to: 'log', id: 'agent:6353f651-f356' }] });
  });

  it('says nothing of a free loop whose process is not running or was not read', () => {
    expect(agentRowCells(agent({}), { running: false }).doing).toBeNull();
    expect(agentRowCells(agent({}), {}).doing).toBeNull();
  });

  it('says nothing of a free agent of another role', () => {
    expect(agentRowCells(agent({ role: 'reviewer' }), { running: true }).doing).toBeNull();
  });

  it('names the agent by its short name and keeps its id as the link', () => {
    expect(agentRowCells(agent({}), { name: '6353f651' }).agent).toEqual({ value: '6353f651', links: [{ to: 'agent', id: 'agent:6353f651-f356' }] });
  });

  it('shows the desk in Acting on while the agent acts on no item', () => {
    expect(agentRowCells(agent({}), { desk: 'desk-098aacb8' }).actingOn).toEqual({ value: 'desk-098aacb8', links: [] });
    expect(agentRowCells(agent({ actsOn: 'x', linked: true, group: 'working' }), { desk: 'desk-098aacb8', itemName: 'x' }).actingOn!.value).toBe('x');
    expect(agentRowCells(agent({}), {}).actingOn).toBeNull();
  });

  it('words the idle time, and leaves it out where nobody read it', () => {
    expect(agentRowCells(agent({}), { idleMinutes: 245 }).idle).toBe('idle 4h');
    expect(agentRowCells(agent({}), { idleMinutes: 3 }).idle).toBe('idle 3m');
    expect(agentRowCells(agent({}), {}).idle).toBeNull();
  });
});

describe('deliveryRowForms', () => {
  it('keys item rows and agent rows by id and drops an item with no row shape', () => {
    const placement = {
      items: [work('queued'), { ...work('queued', [], 'plan'), id: 'plan:p' }],
      agents: [{ id: 'a', role: 'loop', section: 'fleet', group: 'working', actsOn: null, linked: false, blockedOn: null }],
    } as unknown as Parameters<typeof deliveryRowForms>[0];
    const forms = deliveryRowForms(placement, () => ({ plan: 'p' }), () => ({ name: 'Ada' }));
    expect([...forms.items.keys()]).toEqual(['slice:a']);
    expect(forms.agents.get('a')!.agent).toEqual({ value: 'Ada', links: [{ to: 'agent', id: 'a' }] });
  });
});

describe('the remaining branches', () => {
  it('reads a You slice that waits on a review as a slice at a gate, not a stuck one', () => {
    const c = itemRowCells(you('review-pr', 'blocks-delivery'), { ...facts, prReading: { ci: 'passed', review: 'pending' } })!;
    expect(c.status).toEqual({ value: 'review · CI ✓ #901', links: [{ to: 'ci-run', run: '#901' }, { to: 'review', pr: 12 }] });
    expect(c.where!.value).toBe('feature/x · #12');
  });

  it('holds Blocks delivery by auto-verify alone where only a delivered plan sits there', () => {
    const off = { autoDispatch: true, autoReview: false, autoVerify: false, autoDesign: true };
    const plan = you('test-delivered-plan', 'blocks-delivery', [], 'plan');
    expect(groupHeader('Blocks delivery', 'you', 'blocks-delivery', [plan], off).held.map((h) => h.switch)).toEqual(['autoVerify']);
  });

  it('gives a ticket no seven-column row, because a ticket keeps its own row', () => {
    expect(itemRowCells(you('loose', 'unblock', [], 'ticket'), facts)).toBeNull();
    expect(itemRowCells(work('queued', [], 'ticket'), facts)).toBeNull();
  });
});

describe('the You row', () => {
  const all: readonly YouReason[] = [
    'draft-plan', 'plan-approval', 'spike-approval', 'release-approval', 'test-delivered-plan', 'review-pr',
    'blocked-marker', 'fleet-stuck', 'merge-conflict', 'person-comment', 'agent-died', 'loose',
  ];
  const kindOf = (r: YouReason): ItemPlacement['kind'] =>
    r === 'loose' ? 'branch' : ['draft-plan', 'plan-approval', 'spike-approval', 'test-delivered-plan'].includes(r) ? 'plan' : 'slice';

  it('is VERB, OBJECT, CONSEQUENCE, MENU, and ROW_COLUMNS stays the seven with DO last', () => {
    expect([...YOU_COLUMNS]).toEqual(['verb', 'object', 'consequence', 'menu']);
    expect([...ROW_COLUMNS]).toEqual(['kind', 'item', 'where', 'status', 'by', 'age', 'do']);
    const cells = youRowCells(you('draft-plan', 'input-to-the-fleet', [], 'plan'), { plan: 'p', ageMinutes: 60 })!;
    expect(Object.keys(cells)).toEqual([...YOU_COLUMNS]);
  });

  it('gives every reason the verb, tone and consequence of the plan table', () => {
    const table: Record<YouReason, [string, string, string | null]> = {
      'draft-plan': ['Interrogate', 'amber', '3 slices wait'],
      'plan-approval': ['Approve', 'red', '3 slices wait'],
      'spike-approval': ['Approve spike', 'red', 'the spike waits'],
      'release-approval': ['Approve release', 'red', null],
      'test-delivered-plan': ['Test', 'red', 'the release waits'],
      'review-pr': ['Review', 'red', 'the merge waits'],
      'blocked-marker': ['Answer', 'red', 'the agent waits'],
      'fleet-stuck': ['Unblock', 'red', 'the fleet waits'],
      'merge-conflict': ['Resolve', 'red', 'the merge waits'],
      'person-comment': ['Answer', 'red', 'the merge waits'],
      'agent-died': ['Restart', 'red', 'the slice stopped'],
      loose: ['Release or delete', 'grey', null],
    };
    for (const r of all) {
      const d = REASON_DO[r];
      expect([d.verb, d.tone, d.consequence({ slices: 3 })], r).toEqual(table[r]);
      expect(reasonVerb(r)).toBe(d.verb);
    }
  });

  it('links the verb of every reason to the row menu, never to an action', () => {
    for (const r of all) {
      const cells = youRowCells(you(r, 'blocks-delivery', [], kindOf(r)), { ...facts, slices: 2 })!;
      expect(cells.verb, r).toEqual({ value: REASON_DO[r].verb, links: [{ to: 'menu', id: 'slice:a' }] });
      expect(cells.menu!.links, r).toEqual([{ to: 'menu', id: 'slice:a' }]);
    }
  });

  it('words the consequence with the slice count and the age, and with no number where nobody counted', () => {
    const plan = you('plan-approval', 'blocks-delivery', [], 'plan');
    expect(youRowCells(plan, { plan: 'p', slices: 1, ageMinutes: 120 })!.consequence?.value).toBe('1 slice waits · 2h');
    expect(youRowCells(plan, { plan: 'p', slices: 4, ageMinutes: 120 })!.consequence?.value).toBe('4 slices wait · 2h');
    expect(youRowCells(plan, { plan: 'p' })!.consequence?.value).toBe('the slices wait');
  });

  it('appends no sprint to the consequence where rowSprintMembership says so', () => {
    const review = you('review-pr', 'blocks-delivery');
    expect(youRowCells(review, facts, 'no sprint')!.consequence?.value).toBe('the merge waits · 2h · no sprint');
    expect(youRowCells(review, facts)!.consequence?.value).toBe('the merge waits · 2h');
  });

  it('keeps the item tuple as the object', () => {
    const cells = youRowCells(you('review-pr', 'blocks-delivery'), facts)!;
    expect(cells.object).toEqual(itemRowCells(you('review-pr', 'blocks-delivery'), facts)!.item);
  });

  it('words a draft plan and a loose branch in the Status text', () => {
    const draft = 'draft-plan';
    expect(youStatusText(draft, { plan: 'p' })).toBe('Draft · not interrogated');
    expect(youStatusText(draft, { plan: 'p', rounds: 2 })).toBe('Draft · 2 rounds');
    expect(youStatusText(draft, { plan: 'p', rounds: 1, phase: 'design' })).toBe('Design · 1 round');
    expect(youStatusText('loose', { branch: 'feature/x' })).toBe('loose · no plan, nobody works on it');
    expect(youStatusText('person-comment', facts)).toContain('comment');
    expect(youStatusText('review-pr', facts)).toContain('review');
  });

  it('is null for a You item with no row shape, and outside You', () => {
    expect(youRowCells(you('review-pr', 'unblock', [], 'ticket'), facts)).toBeNull();
    expect(youRowCells(work('queued'), facts)).toBeNull();
  });
});

describe('the grouped Unblock row', () => {
  it('counts the loose branches as its object and shows the age span alone as its consequence', () => {
    const day = 1440;
    expect(looseGroupRow([{ id: 'a', ageMinutes: 36 * day }, { id: 'b', ageMinutes: 37 * day + 5 }])).toEqual({
      verb: 'Release or delete', tone: 'grey', object: '2 loose branches', consequence: '36–37 days old', ids: ['a', 'b'],
    });
    expect(looseGroupRow([{ id: 'a', ageMinutes: day }])!.object).toBe('1 loose branch');
    expect(looseGroupRow([])).toBeNull();
  });

  it('spans ages below a day in their own units and leaves an unaged item out', () => {
    expect(ageRangeValue([300, 3 * 1440])).toBe('5h–3d old');
    expect(ageRangeValue([1440])).toBe('1 day old');
    expect(ageRangeValue([undefined, 90, 90])).toBe('1h old');
    expect(ageRangeValue([undefined])).toBeNull();
  });
});

describe('the gate-mark outcome', () => {
  const part = (pr: PrReading, mark: 0 | 1) => gatesCell(pr, 7)!.parts![mark]!;
  it.each([
    ['running', 'pending'],
    ['failed', 'fail'],
    ['passed', 'pass'],
  ] as const)('reads CI %s as %s from the reading, not the glyph', (ci, outcome) => {
    expect(part({ ci, review: 'none' }, 0).outcome).toBe(outcome);
  });
  it.each([
    ['pending', 'pending'],
    ['high', 'fail'],
    ['passed', 'pass'],
    ['none', 'none'],
  ] as const)('reads review %s as %s', (review, outcome) => {
    expect(part({ ci: 'passed', review }, 1).outcome).toBe(outcome);
  });
  it('yields no part for an unread CI or an unread review, never a none', () => {
    expect(gatesCell({ ci: 'unread', review: 'passed' }, 7)!.parts!.map((p) => p.value)).toEqual(['review ✓']);
    expect(gatesCell({ ci: 'passed', review: 'unread' }, 7)!.parts!.map((p) => p.value)).toEqual(['CI ✓']);
    expect(gatesCell({ ci: 'unread', review: 'unread' }, 7)).toBeNull();
  });
  it('leaves the outcome absent on the Progress cell parts, which are no gate marks', () => {
    const cell = progressCell({ pr: 3, unpushed: 2 } as never);
    expect(cell.parts!.map((p) => 'outcome' in p)).toEqual([false, false]);
  });
});

describe('the You footer', () => {
  it('links the unplanned tickets assigned to the reader to the Tickets section', () => {
    expect(youFooter({ issueAnswer: 'answered', unplanned: 3, note: null })).toEqual({
      kind: 'triage', count: 3, text: '3 tickets assigned to you have no plan', anchor: 'tickets',
    });
    expect(youFooter({ issueAnswer: 'answered', unplanned: 1, note: null })!.kind === 'triage'
      && youFooter({ issueAnswer: 'answered', unplanned: 1, note: null })).toMatchObject({ text: '1 ticket assigned to you has no plan' });
  });

  it('shows the unread notice with its note while the tracker read failed, never a count', () => {
    expect(youFooter({ issueAnswer: 'failed', unplanned: 0, note: 'last good 2h ago' })).toEqual({
      kind: 'unread', sentence: 'The tracker gave no answer.', note: 'last good 2h ago',
    });
  });

  it('shows nothing where every assigned ticket has a plan, or no tracker is configured', () => {
    expect(youFooter({ issueAnswer: 'answered', unplanned: 0, note: null })).toBeNull();
    expect(youFooter({ issueAnswer: 'unsupported', unplanned: 2, note: null })).toBeNull();
    expect(youFooter({ issueAnswer: null, unplanned: 2, note: null })).toBeNull();
  });
});
