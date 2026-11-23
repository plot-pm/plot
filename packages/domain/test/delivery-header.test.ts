import { describe, it, expect } from 'vitest';
import { deliveryHeader, type DeliveryHeaderInput } from '../src/rules/delivery-header.js';
import type { FleetGroup } from '../src/rules/delivery-placement.js';

const agents = (...groups: FleetGroup[]) => groups.map((group) => ({ group }));

const input = (over: Partial<DeliveryHeaderInput> = {}): DeliveryHeaderInput => ({
  you: {
    counts: [
      { key: 'blocks-delivery', count: 1 },
      { key: 'input-to-the-fleet', count: 2 },
      { key: 'unblock', count: 3 },
      { key: 'tickets', count: 30 },
    ],
    ages: [120, 30],
    releases: [],
    ticketNote: null,
  },
  work: { groups: [{ key: 'at-a-gate', count: 1 }, { key: 'being-built', count: 0 }, { key: 'queued', count: 2 }], ages: [2880] },
  unplaced: [],
  agents: agents('working', 'free', 'working'),
  supervisor: { state: 'up', label: 'fleet running', shown: false },
  switches: { dispatch: true, review: true, verify: false, design: false },
  parallelAgents: 3,
  machine: {
    headroom: 'clear', load1: 2, cores: 8,
    host: { connector: 'github', buckets: [
      { bucket: 'graphql', limit: 5000, remaining: 4000, resetAt: null },
      { bucket: 'core', limit: 5000, remaining: 100, resetAt: null },
    ] },
  },
  hostAnswer: 'answered',
  ...over,
});

const clearYou: DeliveryHeaderInput['you'] = {
  counts: [
    { key: 'blocks-delivery', count: 0 }, { key: 'input-to-the-fleet', count: 0 },
    { key: 'unblock', count: 0 }, { key: 'tickets', count: 0 },
  ],
  ages: [],
  releases: [],
  ticketNote: null,
};
const clearWork: DeliveryHeaderInput['work'] = { groups: [], ages: [] };
const unreadItem = { subject: 'item' as const, reason: 'unread' };
const unreadAgent = { subject: 'agent' as const, reason: 'unread' };

describe('deliveryHeader — You', () => {
  it('counts 0 for a You number the placement does not name', () => {
    const you = deliveryHeader(input({ you: { ...input().you, counts: [{ key: 'tickets', count: 4 }] } })).you;
    expect(you.numbers.map((n) => n.count)).toEqual([0, 0, 0]);
    expect(you.kind).toBe('counts');
  });
  it('shows the three numbers with their tones, the oldest wait and the triage count', () => {
    const you = deliveryHeader(input()).you;
    expect(you.numbers).toEqual([
      { key: 'blocks-delivery', count: 1, words: 'blocks delivery', tone: 'red' },
      { key: 'input-to-the-fleet', count: 2, words: 'input', tone: 'amber' },
      { key: 'unblock', count: 3, words: 'unblock', tone: 'grey' },
    ]);
    expect(you.kind).toBe('counts');
    expect(you.oldest).toBe('oldest waits 2h');
    expect(you.tickets.text).toBe('30 tickets need triage');
  });
  it('reads clear where the three numbers and the triage count are 0 and nothing is unread', () => {
    const you = deliveryHeader(input({ you: clearYou })).you;
    expect(you.kind).toBe('clear');
    expect(you.clear).toBe('✓ nothing waits on you');
    expect(you.unread).toBeNull();
  });
  it('shows "! N not read" and never the clear sentence where an item is unread', () => {
    const you = deliveryHeader(input({ you: clearYou, unplaced: [unreadItem, unreadItem, unreadAgent] })).you;
    expect(you.kind).toBe('unread');
    expect(you.unread?.text).toBe('! 2 not read');
    expect(you.clear).toBeNull();
  });
  it('reads "tickets unread" and never 0 where the triage count is unread, with the last good rows note', () => {
    const you = deliveryHeader(input({
      you: { ...clearYou, counts: clearYou.counts.map((c) => (c.key === 'tickets' ? { ...c, count: null } : c)), ticketNote: 'showing the rows from 5m ago' },
    })).you;
    expect(you.kind).toBe('unread');
    expect(you.tickets).toEqual({ count: null, text: 'tickets unread', note: 'showing the rows from 5m ago' });
    expect(you.clear).toBeNull();
  });
  it('names a release approval that cannot run as a grey line with its reason and adds nothing to the red number', () => {
    const you = deliveryHeader(input({
      you: { ...clearYou, releases: [{ label: '2.7.0', blocks: false, reason: 'no passkey registered' }] },
    })).you;
    expect(you.numbers[0].count).toBe(0);
    expect(you.releases).toEqual([{ label: 'Approve release 2.7.0', reason: 'no passkey registered' }]);
  });
  it('omits an approvable release from the grey lines; its count reaches the red number through youHeader', () => {
    const you = deliveryHeader(input({
      you: { ...clearYou, counts: clearYou.counts.map((c) => (c.key === 'blocks-delivery' ? { ...c, count: 1 } : c)), releases: [{ label: '2.7.0', blocks: true, reason: '' }] },
    })).you;
    expect(you.numbers[0]).toMatchObject({ count: 1, tone: 'red' });
    expect(you.releases).toEqual([]);
    expect(you.kind).toBe('counts');
  });
});

describe('deliveryHeader — Work items', () => {
  it('shows at a gate, being built and queued, and the oldest wait', () => {
    const work = deliveryHeader(input()).work;
    expect(work.numbers.map((n) => [n.words, n.count])).toEqual([['at a gate', 1], ['being built', 0], ['queued', 2]]);
    expect(work.oldest).toBe('oldest waits 2d');
    expect(work.kind).toBe('counts');
  });
  it('reads clear where the three numbers are 0 and nothing is unread', () => {
    const work = deliveryHeader(input({ work: clearWork })).work;
    expect(work.kind).toBe('clear');
    expect(work.clear).toBe('✓ no work item waits');
  });
  it('shows "! N not read" and never the clear sentence where an item is unread', () => {
    const work = deliveryHeader(input({ work: clearWork, unplaced: [unreadItem] })).work;
    expect(work.kind).toBe('unread');
    expect(work.unread?.text).toBe('! 1 not read');
    expect(work.clear).toBeNull();
  });
});

describe('deliveryHeader — Fleet', () => {
  it('shows circles working first, the count line, the marks and the parallel value', () => {
    const fleet = deliveryHeader(input({ agents: agents('free', 'blocked', 'working') })).fleet;
    expect(fleet.circles).toEqual(['working', 'blocked', 'free']);
    expect(fleet.line).toBe('1 working · 1 blocked · 1 free');
    expect(fleet.marks.map((m) => m.text)).toEqual(['✓ dispatch', '✓ review', '– verify', '– design']);
    expect(fleet.parallel).toBe('parallel 3');
    expect(fleet.kind).toBe('counts');
    expect(fleet.status).toBeNull();
  });
  it('omits the blocked clause where no agent is blocked', () => {
    expect(deliveryHeader(input()).fleet.line).toBe('2 working · 1 free');
  });
  it('reads clear where the supervisor is up and no agent is placed', () => {
    const fleet = deliveryHeader(input({ agents: [] })).fleet;
    expect(fleet.kind).toBe('clear');
    expect(fleet.clear).toBe('✓ no agent runs');
  });
  it('shows "! N not read" and never the clear sentence where an agent is unread', () => {
    const fleet = deliveryHeader(input({ agents: [], unplaced: [unreadAgent, unreadItem] })).fleet;
    expect(fleet.kind).toBe('unread');
    expect(fleet.unread?.text).toBe('! 1 not read');
    expect(fleet.clear).toBeNull();
  });
  it('reads "fleet not read yet" where the supervisor is absent', () => {
    const fleet = deliveryHeader(input({ supervisor: null, agents: [] })).fleet;
    expect(fleet).toMatchObject({ kind: 'unread', status: 'fleet not read yet', clear: null, line: null });
  });
  it('reads the verdict label in the unread kind for a stale up', () => {
    const fleet = deliveryHeader(input({ supervisor: { state: 'up', label: 'fleet silent for 12m', shown: true } })).fleet;
    expect(fleet).toMatchObject({ kind: 'unread', status: 'fleet silent for 12m', clear: null });
  });
  it.each(['down', 'died'] as const)('reads "fleet stopped" for %s and never idle with zeros, marks still shown', (state) => {
    const fleet = deliveryHeader(input({ supervisor: { state, label: 'x', shown: true }, agents: [] })).fleet;
    expect(fleet).toMatchObject({ kind: 'stopped', status: 'fleet stopped', clear: null, line: null });
    expect(fleet.marks).toHaveLength(4);
  });
  it('shows "! N not read" on a stopped fleet with an unread agent, and no clear sentence', () => {
    const fleet = deliveryHeader(input({ supervisor: { state: 'down', label: 'x', shown: true }, agents: [], unplaced: [unreadAgent] })).fleet;
    expect(fleet.kind).toBe('stopped');
    expect(fleet.unread?.text).toBe('! 1 not read');
    expect(fleet.clear).toBeNull();
  });
  it('reads "fleet state unknown" for unknown, marks still shown', () => {
    const fleet = deliveryHeader(input({ supervisor: { state: 'unknown', label: 'x', shown: true } })).fleet;
    expect(fleet).toMatchObject({ kind: 'unread', status: 'fleet state unknown' });
    expect(fleet.marks).toHaveLength(4);
    expect(fleet.line).toBe('2 working · 1 free');
  });
  it('reads the parallel value as unread where it is absent', () => {
    expect(deliveryHeader(input({ parallelAgents: null })).fleet.parallel).toBe('parallel —');
  });
  it('turns a spinner beside the label at the fastest working pace', () => {
    expect(deliveryHeader(input({ agents: [{ group: 'working', pace: 'slow' }, { group: 'working', pace: 'fast' }] })).fleet.pace).toBe('fast');
    expect(deliveryHeader(input({ agents: [{ group: 'working', pace: 'slow' }, { group: 'free', pace: null }] })).fleet.pace).toBe('slow');
  });
  it('shows no spinner where no agent works or no pace was given', () => {
    expect(deliveryHeader(input({ agents: [{ group: 'free', pace: null }] })).fleet.pace).toBeNull();
    expect(deliveryHeader(input({ agents: agents('working') })).fleet.pace).toBeNull();
    expect(deliveryHeader(input({ agents: [] })).fleet.pace).toBeNull();
  });
});

describe('deliveryHeader — Machine', () => {
  it('shows load, GraphQL and REST meters on a split host', () => {
    const meters = deliveryHeader(input()).machine.meters;
    expect(meters.map((m) => [m.label, m.text, m.tone])).toEqual([
      ['load', 'load 2.0 of 8 cores', 'green'],
      ['GraphQL', 'GraphQL 4,000 / 5,000 left', 'green'],
      ['REST', 'REST 100 / 5,000 left', 'amber'],
    ]);
    expect(meters[1].share).toBeCloseTo(0.2);
  });
  it('names a missing split bucket "not recorded"', () => {
    const meters = deliveryHeader(input({
      machine: { headroom: 'clear', load1: 1, cores: 4, host: { connector: 'github', buckets: [{ bucket: 'graphql', limit: 10, remaining: 5, resetAt: null }] } },
    })).machine.meters;
    expect(meters[2]).toMatchObject({ label: 'REST', share: null, text: 'REST not recorded' });
  });
  it('shows one meter labelled API on a one-pool host', () => {
    const meters = deliveryHeader(input({
      machine: { headroom: 'clear', load1: 1, cores: 4, host: { connector: 'bitbucket', buckets: [{ bucket: '', limit: 1000, remaining: 0, resetAt: null }] } },
    })).machine.meters;
    expect(meters.map((m) => m.label)).toEqual(['load', 'API']);
    expect(meters[1]).toMatchObject({ text: 'API 0 / 1,000 left', tone: 'red', share: 1 });
  });
  it('reads "not measured" where load1 or cores is null', () => {
    const at = (load1: number | null, cores: number | null) =>
      deliveryHeader(input({ machine: { headroom: 'unmeasured', load1, cores, host: null } })).machine.meters[0];
    expect(at(null, 8)).toMatchObject({ text: 'load not measured', share: null });
    expect(at(2, null)).toMatchObject({ text: 'load not measured', share: null });
  });
  it('names an unasked host and shows no budget figure', () => {
    const meters = deliveryHeader(input({ hostAnswer: 'unasked' })).machine.meters;
    expect(meters.slice(1)).toEqual([{ key: 'host', label: 'host', share: null, text: 'host not checked yet', tone: 'grey' }]);
  });
  it('reads red where the host is rate-limited and no budget is recorded', () => {
    const meters = deliveryHeader(input({ hostAnswer: 'rate-limited', machine: { headroom: 'clear', load1: 1, cores: 4, host: null } })).machine.meters;
    expect(meters[1]).toMatchObject({ key: 'host', share: null, tone: 'red' });
  });
  it('shows the budgets where the host is rate-limited and a budget is recorded', () => {
    const meters = deliveryHeader(input({ hostAnswer: 'rate-limited' })).machine.meters;
    expect(meters.map((m) => m.label)).toEqual(['load', 'GraphQL', 'REST']);
  });
  it('reads "API not recorded" where the host records no bucket', () => {
    const meters = deliveryHeader(input({ machine: { headroom: 'clear', load1: 1, cores: 4, host: { connector: 'github', buckets: [] } } })).machine.meters;
    expect(meters.slice(1)).toEqual([{ key: 'api', label: 'API', share: null, text: 'API not recorded', tone: 'grey' }]);
  });
  it('names a bucket that is not split by its own word', () => {
    const meters = deliveryHeader(input({
      machine: { headroom: 'clear', load1: 1, cores: 4, host: { connector: 'github', buckets: [{ bucket: 'search', limit: 30, remaining: 30, resetAt: null }] } },
    })).machine.meters;
    expect(meters[1]).toMatchObject({ key: 'search', label: 'search', text: 'search 30 / 30 left', tone: 'green', share: 0 });
  });
  it('reads unread where the machine reading is absent', () => {
    expect(deliveryHeader(input({ machine: null })).machine.kind).toBe('unread');
  });
});

describe('deliveryHeader — scope', () => {
  // The board narrows You and Work items by the scope's rows; the fleet and
  // machine readings are the same in both scopes.
  const release = input();
  const mySprint = input({
    you: { ...release.you, counts: release.you.counts.map((c) => (c.key === 'blocks-delivery' ? { ...c, count: 0 } : c)), ages: [30] },
    work: { groups: [{ key: 'queued', count: 1 }], ages: [] },
  });
  it('gives different You and Work items facts and the same Fleet and Machine facts', () => {
    const a = deliveryHeader(release);
    const b = deliveryHeader(mySprint);
    expect(a.you).not.toEqual(b.you);
    expect(a.work).not.toEqual(b.work);
    expect(a.fleet).toEqual(b.fleet);
    expect(a.machine).toEqual(b.machine);
  });
});
