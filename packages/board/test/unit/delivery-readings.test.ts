import { describe, it, expect } from 'vitest';
import { placeDelivery } from '@plot-pm/domain';
import { placeMapping } from '../../src/app/lib/agent-rows/delivery-view.js';
import type { AgentRow, Slice } from '../../src/contract/schema.js';
import {
  deliveryMapping,
  sliceItemId,
  sprintReleases,
  type DeliveryMapInput,
  type RegistryAgent,
} from '../../src/app/lib/agent-rows/delivery-readings.js';

const reader = { hostUser: 'me' };

const row = (over: Record<string, unknown>): AgentRow => ({
  branch: '', plan: '', wave: '', kind: 'branch', phase: 'Development', state: 'wip',
  group: 'working', pr: null, question: null, blockedBy: null,
  assignee: '', author: '', approver: '', ...over,
}) as unknown as AgentRow;

const pr = (over: Record<string, unknown>) => ({ state: 'pending', open: true, ...over });

const slice = (name: string, over: Record<string, unknown> = {}): Slice => ({
  plan: 'p', name, branches: [], verdict: 'eligible', section: 'building', complete: false,
  planSliceCount: 1, ...over,
}) as unknown as Slice;

const agent = (over: Record<string, unknown>): RegistryAgent => ({
  session: 's', branch: '', state: 'running', pid: 1, ...over,
}) as unknown as RegistryAgent;

const input = (over: Partial<DeliveryMapInput>): DeliveryMapInput => ({
  rows: [], slices: [], agents: [], drafts: [], reader, mode: 'all',
  config: { autoReview: true, correctionBudget: 2 }, ...over,
});

const place = (m: ReturnType<typeof deliveryMapping>) => placeDelivery(m.readings, m.input);

describe('deliveryMapping', () => {
  const mixed = input({
    rows: [
      row({ branch: 'feature/a', plan: 'p', wave: 'A', state: 'wip', pr: pr({ ciChecks: 'failing' }) }),
      row({ branch: 'feature/b', plan: 'p', wave: 'B', state: 'wip' }),
      row({ branch: 'feature/orphan', pr: pr({ ciChecks: 'green', plotReview: 'success' }) }),
      row({ branch: 'feature/nociread', plan: 'p', wave: 'C', pr: pr({ state: 'unknown' }) }),
      row({ branch: 'feature/lost', plan: 'p', wave: 'D', group: null }),
    ],
    slices: ['A', 'B', 'C', 'D'].map((n) => slice(n)),
    agents: [
      agent({ session: 'fix', branch: 'feature/a', role: 'fixer' }),
      agent({ session: 'dead', branch: 'feature/b', state: 'failed' }),
    ],
  });

  it('places every row and agent exactly once, in a section or in unplaced', () => {
    const m = deliveryMapping(mixed);
    const p = place(m);
    const ids = [...p.items.map((i) => i.id), ...p.agents.map((a) => a.id), ...p.unplaced.map((u) => u.id)];
    const expected = [...m.readings.items.map((i) => i.id), ...m.readings.agents.map((a) => a.id)];
    expect(ids.sort()).toEqual(expected.sort());
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of mixed.rows) expect(Object.values(m.rowsByItem).flat()).toContain(r);
  });

  it('lists a row with no CI reading as unplaced for unread', () => {
    const p = place(deliveryMapping(mixed));
    expect(p.unplaced).toContainEqual({ id: sliceItemId('p', 'C'), subject: 'item', reason: 'unread' });
    expect(p.unplaced).toContainEqual({ id: sliceItemId('p', 'D'), subject: 'item', reason: 'unread' });
  });

  it('puts a slice with a fixer at a gate, the fixer in Fleet working, and the slice out of You', () => {
    const p = place(deliveryMapping(mixed));
    const a = p.items.find((i) => i.id === sliceItemId('p', 'A'));
    expect(a).toMatchObject({ section: 'work-items', group: 'at-a-gate' });
    expect(p.agents.find((x) => x.id === 'agent:fix')).toMatchObject({ section: 'fleet', group: 'working' });
    expect(p.items.filter((i) => i.section === 'you').map((i) => i.id)).not.toContain(sliceItemId('p', 'A'));
  });

  it('puts a dead agent on a slice under You to unblock and the agent under Fleet blocked', () => {
    const p = place(deliveryMapping(mixed));
    expect(p.items.find((i) => i.id === sliceItemId('p', 'B'))).toMatchObject({ section: 'you', group: 'blocks-delivery' });
    expect(p.agents.find((x) => x.id === 'agent:dead')).toMatchObject({ group: 'blocked' });
  });

  it('flips a green PR between At a gate and You with the Auto-review key', () => {
    const rows = [row({ branch: 'feature/o', pr: pr({ ciChecks: 'green', plotReview: 'pending' }) })];
    const on = place(deliveryMapping(input({ rows, config: { autoReview: true, correctionBudget: 2 } })));
    const off = place(deliveryMapping(input({ rows, config: { autoReview: false, correctionBudget: 2 } })));
    expect(on.items[0]).toMatchObject({ section: 'work-items', group: 'at-a-gate' });
    expect(off.items[0]).toMatchObject({ section: 'you', group: 'blocks-delivery' });
  });

  it('places a PR whose personComment names its head and is not older than updatedAt under Blocks delivery', () => {
    const open = (over: Record<string, unknown>) => place(deliveryMapping(input({
      rows: [row({ branch: 'feature/o', pr: pr({ ciChecks: 'green', plotReview: 'success', headSha: 'sha-1', updatedAt: '2026-11-18T09:00:00Z', ...over }) })],
    }))).items[0];
    const comment = { head: 'sha-1', at: '2026-11-18T09:30:00Z' };
    expect(open({ personComment: comment })).toMatchObject({ section: 'you', group: 'blocks-delivery', reason: 'person-comment' });
    expect(open({})).toMatchObject({ section: 'work-items', group: 'at-a-gate' });
    expect(open({ personComment: { ...comment, head: 'feature/o' } })).toMatchObject({ section: 'work-items' });
    expect(open({ personComment: comment, updatedAt: '2026-11-18T10:00:00Z' })).toMatchObject({ section: 'work-items' });
    expect(open({ personComment: comment, updatedAt: undefined })).toMatchObject({ section: 'work-items' });
    expect(open({ personComment: { ...comment, at: 'soon' } })).toMatchObject({ section: 'work-items' });
  });

  it('passes the Mine mode and both config keys through unchanged', () => {
    const m = deliveryMapping(input({ mode: 'mine', config: { autoReview: false, correctionBudget: 5 } }));
    expect(m.input).toEqual({ mine: 'strict', autoReview: false, correctionBudget: 5 });
  });

  it('leaves a row it cannot read absent instead of defaulting it', () => {
    const m = deliveryMapping(mixed);
    const c = m.readings.items.find((i) => i.id === sliceItemId('p', 'C'))!;
    expect(c.pr?.ci).toBe('unread');
    expect(c.gateUnpassable).toBeUndefined();
    expect(c.mergeConflict).toBeUndefined();
    const lost = m.readings.items.find((i) => i.id === sliceItemId('p', 'D'))!;
    expect(lost.stage).toBeUndefined();
  });
});

describe('absent config keys', () => {
  it('carries no autoReview or correctionBudget the payload did not state', () => {
    const m = deliveryMapping(input({ config: {} }));
    expect('autoReview' in m.input && m.input.autoReview !== undefined).toBe(false);
    expect('correctionBudget' in m.input && m.input.correctionBudget !== undefined).toBe(false);
  });
});

describe('deliveryMapping phase words', () => {
  const placed = (phase: string) => {
    const m = deliveryMapping(input({
      rows: [row({ branch: 'feature/x', plan: 'p', wave: 'X', phase, state: 'wip', pr: pr({ ciChecks: 'green', plotReview: 'success' }) })],
      slices: [slice('X')],
    }));
    return place(m);
  };

  it('reads Discovery as a plan waiting for input to the fleet', () => {
    expect(placed('Discovery').items[0]).toMatchObject({ section: 'you', group: 'input-to-the-fleet', reason: 'draft-plan' });
  });

  it('reads Design as a plan waiting for input to the fleet', () => {
    expect(placed('Design').items[0]).toMatchObject({ section: 'you', group: 'input-to-the-fleet', reason: 'draft-plan' });
  });

  it('reads Development as a work item', () => {
    expect(placed('Development').items[0]).toMatchObject({ section: 'work-items' });
  });

  it('reads Testing as delivered', () => {
    const p = placed('Testing');
    expect(p.items).toEqual([]);
    expect(p.unplaced).toContainEqual({ id: sliceItemId('p', 'X'), subject: 'item', reason: 'delivered' });
  });

  it('reads Released as delivered', () => {
    const p = placed('Released');
    expect(p.items).toEqual([]);
    expect(p.unplaced).toContainEqual({ id: sliceItemId('p', 'X'), subject: 'item', reason: 'delivered' });
  });

  it('leaves an unknown phase word absent', () => {
    expect(placed('approved').items[0]).toMatchObject({ section: 'work-items' });
  });
});

describe('deliveryMapping PR checks', () => {
  const ciOf = (state: string) => deliveryMapping(input({
    rows: [row({ branch: 'feature/x', plan: 'p', wave: 'X', pr: pr({ state }) })],
    slices: [slice('X')],
  })).readings.items[0]!.pr?.ci;

  it('reads no checks as a reading, not as unread', () => {
    expect(ciOf('none')).toBe('passed');
  });

  it('reads a host that cannot report as unread', () => {
    expect(ciOf('unknown')).toBe('unread');
  });
});

describe('deliveryMapping tickets', () => {
  const source = { service: 'github', match: 'host-login' as const };
  const tk = (number: string, over: Record<string, unknown> = {}) => ({
    kind: 'ticket', number, title: `Ticket ${number}`, url: '', ageMinutes: 1,
    status: 'open', statusCategory: 'To Do', assignees: ['me'], ...over,
  }) as unknown as NonNullable<DeliveryMapInput['tickets']>[number];
  const withTickets = (tickets: DeliveryMapInput['tickets'], over: Partial<DeliveryMapInput> = {}) =>
    place(deliveryMapping(input({ tickets, ticketSource: source, ...over })));

  // A ticket is never an item: the placement lists it in `tickets`.
  const youIds = (p: ReturnType<typeof place>) => p.tickets.map((t) => t.id);

  it('lists an assigned unplanned ticket once in tickets and omits a planned one', () => {
    const p = withTickets([tk('1'), tk('2', { planned: true })]);
    expect(youIds(p)).toEqual(['ticket:1']);
    expect(p.unplaced.some((u) => u.id === 'ticket:2' && u.reason === 'planned')).toBe(true);
  });

  it('keeps the ticket keyed by item id for the view', () => {
    const m = deliveryMapping(input({ tickets: [tk('7')], ticketSource: source }));
    expect(Object.keys(m.ticketsByItem)).toEqual(['ticket:7']);
  });

  it('does not place a closed ticket', () => {
    const p = withTickets([tk('3', { statusCategory: 'Done' })]);
    expect(youIds(p)).toEqual([]);
  });

  it('places nothing when the issue store gave no tickets', () => {
    expect(youIds(withTickets(null))).toEqual([]);
    expect(youIds(withTickets(undefined))).toEqual([]);
  });

  it('lists tickets whatever the sprint filter names', () => {
    const m = deliveryMapping(input({ tickets: [tk('4'), tk('5', { releases: ['2.32.0'] })], ticketSource: source, releases: ['2.32'] }));
    expect(m.input.releases).toEqual(['2.32']);
    expect(youIds(place(m))).toEqual(['ticket:4', 'ticket:5']);
  });
});

describe('sprintReleases', () => {
  const sp = [
    { slug: 'a', release: '2.32' }, { slug: 'b', release: '2.32' },
    { slug: 'c', release: '' }, { slug: 'd', release: '2.33' },
  ];
  it('dedupes the selected sprints\' releases', () => {
    expect(sprintReleases(sp, ['a', 'b', 'd'])).toEqual(['2.32', '2.33']);
  });
  it('is undefined when no selected sprint names a release', () => {
    expect(sprintReleases(sp, ['c'])).toBeUndefined();
    expect(sprintReleases(sp, [])).toBeUndefined();
  });
});

describe('release lines', () => {
  const tickets = {
    open: [{ releases: ['2.32.0'] }, { releases: [] }, {}],
    closed: [{ releases: ['2.32.0'] }],
    closedComplete: true,
    closedSince: '2026-10-27T00:00:00Z',
  };
  const lines = (over: Partial<DeliveryMapInput>) => placeMapping(deliveryMapping(input(over))).releaseLines;

  it('gives one line per distinct target release, with the ticket counts', () => {
    const out = lines({
      releaseTickets: tickets,
      sprints: [
        { release: '2.32.0', started: '2026-11-03' },
        { release: '2.33.0', started: '2026-11-10' },
        { release: '2.32.0', started: '2026-11-04' },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toBe('0 of 0 slices delivered · 0 held at gates · 0 blocked · 2.32.0 tickets: closed 1 · planned 1 · untriaged 1');
    expect(out[1]).toContain('2.33.0 tickets: closed 0 · planned 0 · untriaged 1');
  });

  it('keeps the slice counts alone where no sprint names a release', () => {
    expect(lines({ releaseTickets: tickets, sprints: [{ release: '', started: '' }] }))
      .toEqual(['0 of 0 slices delivered · 0 held at gates · 0 blocked']);
  });

  it('counts the same blocked slices when a review joins Blocks delivery', () => {
    const rows = [
      row({ branch: 'feature/b', plan: 'p', wave: 'B', state: 'wip' }),
      row({ branch: 'feature/c', plan: 'p', wave: 'C', pr: pr({ ciChecks: 'green', plotReview: 'pending' }) }),
    ];
    const base = {
      rows,
      slices: ['B', 'C'].map((n) => slice(n)),
      agents: [agent({ session: 'dead', branch: 'feature/b', state: 'failed' })],
    };
    const reviewJoins = lines({ ...base, config: { autoReview: false, correctionBudget: 2 } });
    expect(place(deliveryMapping(input({ ...base, config: { autoReview: false, correctionBudget: 2 } }))).items
      .filter((i) => i.section === 'you' && i.reason === 'review-pr')).toHaveLength(1);
    expect(reviewJoins[0]).toContain('· 1 blocked');
    expect(lines(base)[0]).toContain('· 1 blocked');
  });

  it('keeps the slice counts alone where the index is missing', () => {
    expect(lines({ releaseTickets: null, sprints: [{ release: '2.32.0', started: '' }] }))
      .toEqual(['0 of 0 slices delivered · 0 held at gates · 0 blocked']);
  });
});

describe('deliveryMapping loose ends', () => {
  const loose = (rows: AgentRow[], agents: RegistryAgent[] = []) =>
    deliveryMapping(input({ rows, agents })).readings.items[0]!.loose;
  // The two states the planless loops in `rowsFromPulse` build, and the worker they state.
  const wip = { state: 'wip', worker: 'elsewhere', group: 'quiet' };
  const claimed = { state: 'claimed', worker: 'elsewhere', group: 'quiet' };

  it('reads a planless wip branch with no desk and no agent as named false and held false', () => {
    expect(loose([row({ branch: 'feature/x', ...wip, desk: false })])).toEqual({ named: false, held: false });
  });

  it('reads a claimed planless branch with no desk as not held: a claim nobody holds is what release gives up', () => {
    expect(loose([row({ branch: 'feature/x', ...claimed, desk: false })])).toEqual({ named: false, held: false });
  });

  it('reads a branch a registry agent names as held', () => {
    expect(loose([row({ branch: 'feature/x', ...wip, desk: false })], [agent({ branch: 'feature/x' })])).toMatchObject({ held: true });
  });

  it('reads a branch with a desk on this machine as held', () => {
    expect(loose([row({ branch: 'feature/x', ...wip, desk: true })])).toMatchObject({ held: true });
  });

  it('reads a branch with a running worker as held', () => {
    expect(loose([row({ branch: 'feature/x', ...wip, worker: 'running', desk: false })])).toMatchObject({ held: true });
  });

  it('leaves held absent where the desk was not read and nothing else holds the branch', () => {
    expect(loose([row({ branch: 'feature/x', ...wip })])).toEqual({ named: false });
  });

  it('reads a branch a plan names as named', () => {
    expect(loose([row({ branch: 'feature/x', plan: 'p', kind: 'pr-link', ...wip })])).toMatchObject({ named: true });
  });

  it('leaves a PR with no fixer record read without a loose reading', () => {
    expect(loose([row({ branch: 'feature/x', kind: 'pr', pr: pr({ ciChecks: 'green' }), ...wip, desk: false })])).toBeUndefined();
  });

  it('carries the fixer mark of a PR whose record was read', () => {
    const open = { branch: 'feature/x', kind: 'pr', pr: pr({ ciChecks: 'green' }), ...wip, desk: false };
    expect(loose([row({ ...open, fixerInFlight: true })])).toEqual({ named: false, held: false, fixing: true });
    expect(loose([row({ ...open, fixerInFlight: false })])).toMatchObject({ fixing: false });
  });

  it('reads a closed PR as closed with no fixer record, and an open PR with none as unread', () => {
    const base = { branch: 'feature/x', kind: 'pr', ...wip, desk: false };
    expect(loose([row({ ...base, pr: pr({ state: 'closed' }) })])).toEqual({ named: false, held: false, closed: true });
    expect(loose([row({ ...base, pr: pr({ ciChecks: 'green' }) })])).toBeUndefined();
  });

  it('places a closed PR under Unblock, and not where a plan names it or a desk holds it', () => {
    const place1 = (over: Record<string, unknown>) =>
      place(deliveryMapping(input({ rows: [row({ branch: 'feature/x', kind: 'pr', pr: pr({ state: 'closed' }), ...wip, desk: false, ...over })] }))).items[0];
    expect(place1({})).toMatchObject({ section: 'you', group: 'unblock', reason: 'loose' });
    expect(place1({ plan: 'p', wave: 'A' })).not.toMatchObject({ reason: 'loose' });
    expect(place1({ desk: true })).not.toMatchObject({ reason: 'loose' });
  });

  it('lists a closed PR whose desk was not read as unplaced', () => {
    const p = place(deliveryMapping(input({ rows: [row({ branch: 'feature/x', kind: 'pr', pr: pr({ state: 'closed' }), ...wip, desk: undefined })] })));
    expect(p.items).toEqual([]);
    expect(p.unplaced).toContainEqual({ id: 'branch:feature/x', subject: 'item', reason: 'unread' });
  });

  it('places a loose wip branch under You > Unblock and a held one elsewhere', () => {
    const place1 = (over: Record<string, unknown>, agents: RegistryAgent[] = []) =>
      place(deliveryMapping(input({ rows: [row({ branch: 'feature/x', ...wip, ...over })], agents }))).items[0];
    expect(place1({ desk: false })).toMatchObject({ section: 'you', group: 'unblock', reason: 'loose' });
    expect(place1({ ...claimed, desk: false })).toMatchObject({ section: 'you', group: 'unblock', reason: 'loose' });
    expect(place1({ desk: false }, [agent({ branch: 'feature/x' })])).not.toMatchObject({ reason: 'loose' });
    expect(place1({ desk: true })).not.toMatchObject({ reason: 'loose' });
  });

  it('lists a planless branch whose desk was not read as unplaced for unread', () => {
    const p = place(deliveryMapping(input({ rows: [row({ branch: 'feature/x', ...wip })] })));
    expect(p.items).toEqual([]);
    expect(p.unplaced).toContainEqual({ id: 'branch:feature/x', subject: 'item', reason: 'unread' });
  });

  it('never places changeset-release/main as loose: its row is a release item', () => {
    const release = row({
      branch: 'changeset-release/main', kind: 'release', ...wip, desk: false, fixerInFlight: false,
      pr: pr({ ciChecks: 'green', plotReview: 'absent' }),
    });
    const m = deliveryMapping(input({ rows: [release], config: { autoReview: true, correctionBudget: 2 } }));
    expect(m.readings.items[0]).toMatchObject({ kind: 'release' });
    expect(m.readings.items[0]!.loose).toBeUndefined();
    expect(place(m).items.map((i) => i.reason)).not.toContain('loose');
  });
});

describe('deliveryMapping: agent roles', () => {
  const runs = [
    { id: 'agent:reviewer:7:abcdef1', role: 'reviewer' as const, pr: 7, startedAt: 5 },
    { id: 'agent:fixer:8', role: 'fixer' as const, pr: 8, startedAt: 6 },
    { id: 'agent:design:pd', role: 'design' as const, plan: 'pd', startedAt: null },
    { id: 'agent:verify:pv', role: 'verify' as const, plan: 'pv', startedAt: null },
  ];
  const registry = [
    agent({ session: 'a-loop', branch: 'feature/x' }),
    agent({ session: 'a-idea', role: 'idea' }),
    agent({ session: 'a-brief', role: 'brief' }),
  ];

  it('places one agent per source with its role and no others', () => {
    const m = deliveryMapping(input({ agents: registry, roleRuns: runs }));
    expect(place(m).agents.map((a) => [a.id, a.role])).toEqual([
      ['agent:a-loop', 'loop'], ['agent:a-idea', 'idea'], ['agent:a-brief', 'brief'],
      ['agent:reviewer:7:abcdef1', 'reviewer'], ['agent:fixer:8', 'fixer'],
      ['agent:design:pd', 'design'], ['agent:verify:pv', 'verify'],
    ]);
  });

  it('gives a registry entry that names the approver no row', () => {
    const m = deliveryMapping(input({ agents: [agent({ session: 'a-appr', role: 'approver' })] }));
    expect(m.readings.agents).toEqual([]);
    expect(place(m).agents).toEqual([]);
  });

  it('carries a null start for design and verify and the source start for the others', () => {
    const m = deliveryMapping(input({ roleRuns: runs }));
    const start = Object.fromEntries(m.readings.agents.map((a) => [a.role, a.startedAt]));
    expect(start).toEqual({ reviewer: 5, fixer: 6, design: null, verify: null });
  });

  it('links a reviewer to the item of the row that holds its PR', () => {
    const m = deliveryMapping(input({ rows: [row({ branch: 'feature/y', pr: pr({ number: 7 }) })], roleRuns: runs }));
    const reviewer = m.readings.agents.find((a) => a.role === 'reviewer');
    expect(reviewer?.actsOn).toBe('branch:feature/y');
    expect(reviewer?.process).toBe('running');
  });

  it('reads a stopped design or verify run as a stopped process blocked on a person', () => {
    const stopped = { reason: 'r', restart: '/plot-deliver --verify pv', log: '/l' };
    const m = deliveryMapping(input({ roleRuns: [{ id: 'agent:verify:pv', role: 'verify', plan: 'pv', startedAt: null, stopped }] }));
    expect(m.readings.agents.map((a) => [a.id, a.process, a.blockedOn])).toEqual([['agent:verify:pv', 'stopped', 'person']]);
    expect(place(m).agents.map((a) => a.id)).toEqual(['agent:verify:pv']);
  });

  it('adds no agent when the payload carries no runs', () => {
    expect(deliveryMapping(input({ roleRuns: null })).readings.agents).toEqual([]);
  });
});

describe('deliveryMapping under a Mine mode', () => {
  // The rows the payload carries, unfiltered: the board passes these, and the
  // mapping applies the Mine mode.
  const rows = [
    row({ branch: 'feature/loose', state: 'wip', worker: 'elsewhere', group: 'quiet', desk: false }),
    row({ branch: 'feature/unsigned', state: 'wip', worker: 'elsewhere', group: 'quiet', desk: false, fixerInFlight: false, pr: pr({ number: 3, author: '', ciChecks: 'green' }) }),
    row({ branch: 'feature/mine', plan: 'p', wave: 'A', state: 'wip', pr: pr({ number: 1, author: 'me', ciChecks: 'pending' }) }),
    row({ branch: 'feature/nobodys', plan: 'p', wave: 'B', state: 'wip', worker: 'running' }),
    row({ branch: 'feature/theirs', plan: 'p', wave: 'C', state: 'wip', pr: pr({ number: 2, author: 'them', ciChecks: 'green', plotReview: 'absent' }) }),
  ];
  const drafts = [
    { plan: 'their-draft', assignee: 'them', author: 'them', approver: '' },
    { plan: 'nobodys-draft', assignee: '', author: '', approver: '' },
  ] as unknown as DeliveryMapInput['drafts'];
  const people = { reader: { hostUser: 'me', directory: { me: 'Me', them: 'Them' } } };
  const placed = (mode: DeliveryMapInput['mode']) =>
    place(deliveryMapping(input({ ...people, rows, drafts, mode, config: { autoReview: false, correctionBudget: 2 } })));
  const youIds = (mode: DeliveryMapInput['mode']) => placed(mode).items.filter((i) => i.section === 'you').map((i) => i.id).sort();
  const shown = (mode: DeliveryMapInput['mode']) => placed(mode).items.map((i) => i.id);

  it('keeps the same You items in every Mine mode, a loose branch and an unknown-owner PR included', () => {
    const all = youIds('all');
    expect(all).toEqual(['branch:feature/loose', 'branch:feature/unsigned', 'plan:nobodys-draft']);
    expect(youIds('mine-and-unknown')).toEqual(all);
    expect(youIds('mine')).toEqual(all);
  });

  it('places a theirs PR and a theirs draft under Work items › Queued with Mine off, and hides both under Mine', () => {
    const off = placed('all').items;
    expect(off.find((i) => i.id === sliceItemId('p', 'C'))).toMatchObject({ section: 'work-items', group: 'queued' });
    expect(off.find((i) => i.id === 'plan:their-draft')).toMatchObject({ section: 'work-items', group: 'queued' });
    for (const mode of ['mine-and-unknown', 'mine'] as const) {
      expect(shown(mode)).not.toContain(sliceItemId('p', 'C'));
      expect(shown(mode)).not.toContain('plan:their-draft');
    }
  });

  it('narrows Work items by the mode: strict drops an unknown-owner slice, lenient keeps it', () => {
    expect(shown('mine-and-unknown')).toContain(sliceItemId('p', 'B'));
    expect(shown('mine')).not.toContain(sliceItemId('p', 'B'));
    expect(shown('mine')).toContain(sliceItemId('p', 'A'));
  });
});
