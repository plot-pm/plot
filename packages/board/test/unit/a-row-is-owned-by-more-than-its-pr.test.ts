import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parsePersonDirectory, type OwnedRow } from '@plot-pm/domain';
import {
  AgentEntrySchema,
  AgentRowSchema,
  BoardSchema,
  CardSchema,
  ColumnSchema,
  DraftPlanSchema,
  FleetSchema,
  type AgentEntry,
  type AgentRow,
  type Board,
  type Card,
  type Column,
  type DraftPlan,
  type Fleet,
} from '../../src/contract/schema.js';
import {
  agentsForReader,
  boardForReader,
  draftsForReader,
  ownedFromCard,
  ownedFromRow,
  readerFrom,
  rowsForReader,
} from '../../src/app/lib/agent-rows/mine-filter.js';
import { AgentList } from '../../src/app/components/AgentList.js';

/**
 * `a-row-is-owned-by-more-than-its-pr` — the ownership rule reaches agents and
 * plan cards, and every population it still cannot place answers `unknown` and
 * stays.
 *
 * The directory is this repository's own `People` value. `eins78` is Max
 * Albrecht, who added each of the four plans carrying that spelling.
 */

/** Every row `isMine` is asked about, recorded through the production module. */
const asked = vi.hoisted(() => [] as OwnedRow[]);
/** Set to make the spied rule refuse every agent, so its answer is visible. */
const refuseAgents = vi.hoisted(() => ({ on: false }));

vi.mock('@plot-pm/domain', async (importOriginal) => {
  const real = await importOriginal<typeof import('@plot-pm/domain')>();
  return {
    ...real,
    isMine: (owned: OwnedRow, reader: Parameters<typeof real.isMine>[1]) => {
      asked.push(owned);
      if (refuseAgents.on && owned.kind === 'agent') return false;
      return real.isMine(owned, reader);
    },
  };
});

// FIXTURES FROM THE SCHEMAS, not from `../catalogue/`: importing the catalogue
// marks a file as a browser test, and this one drives no page.
const row = (over: Partial<AgentRow> = {}): AgentRow => AgentRowSchema.parse({
  repo: 'garden', kind: 'branch', branch: 'feature/a-branch', plan: 'a-plan',
  planFile: '2026-08-24-a-plan.md', wave: 'Wave', state: 'wip', phase: 'Development',
  group: 'working', ageMinutes: 30, note: '', pr: null, branchUrl: '', ...over,
});
const agent = (over: Partial<AgentEntry> = {}): AgentEntry => AgentEntrySchema.parse({
  session: 'sess0000', branch: 'feature/a-branch', worktree: '/wt/a-branch', command: '',
  startedAt: '', pid: '', previousPid: '', relaunches: 0, state: 'running', ...over,
});
const card = (over: Partial<Card> = {}): Card => CardSchema.parse({
  slug: 'a-plan', title: 'A plan', type: 'feature', phase: 'Development',
  path: 'docs/plans/2026-08-24-a-plan.md',
  controls: { approve: false, needsDesign: false, interrogate: false, roundsBadge: false, dispatch: true, readyToStart: false }, ...over,
});
const column = (over: Partial<Column> = {}): Column => ColumnSchema.parse({ phase: 'Development', cards: [], ...over });
const draft = (over: Partial<DraftPlan> = {}): DraftPlan => DraftPlanSchema.parse({
  plan: 'a-plan', planFile: '2026-08-24-a-plan.md', title: 'A plan', ...over,
});
const board = (over: Partial<Board> = {}): Board => BoardSchema.parse({
  generatedAt: '2026-08-30T12:00:00.000Z', columns: [], sprints: [], stories: [], checklist: null, ...over,
});
const fleet = (over: Partial<Fleet> = {}): Fleet => FleetSchema.parse({
  generatedAt: '2026-08-30T12:00:00.000Z', ageSeconds: 1, ready: true, error: null, rows: [], slices: [],
  summary: { plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
  stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
  prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null, ...over,
});

const people = parsePersonDirectory('jwloka = Jan Wloka; eins78 = Max Albrecht');
const server = { hostUser: 'jwloka', gitEmail: 'jan.wloka@quatico.com', people };
const reader = readerFrom(server);

describe('readerFrom carries the directory', () => {
  it('passes the server\'s People directory to the rule', () => {
    expect(reader.directory).toEqual(people);
  });

  it('leaves it absent for an older server that never sent it', () => {
    expect(readerFrom({ hostUser: 'jwloka' }).directory).toBeUndefined();
  });
});

describe('plan cards reach the rule by their assignee', () => {
  const kanban = board({
    columns: [
      column({
        phase: 'Development',
        cards: [
          card({ slug: 'by-login', assignee: 'jwloka' }),
          card({ slug: 'by-name', assignee: 'Jan Wloka' }),
          card({ slug: 'by-max', assignee: 'eins78' }),
          card({ slug: 'by-nobody', assignee: '' }),
          card({ slug: 'by-stranger', assignee: 'Someone New' }),
        ],
      }),
    ],
  });
  const slugs = (b: typeof kanban) => b.columns.flatMap((c) => c.cards.map((x) => x.slug));

  it('maps a card to a plan row', () => {
    expect(ownedFromCard({ assignee: 'Jan Wloka' })).toEqual({ kind: 'plan', assignee: 'Jan Wloka' });
  });

  it('carries a card author and approver through to the plan row', () => {
    expect(ownedFromCard({ assignee: '', author: 'Jan Wloka', approver: 'Max Albrecht' })).toEqual({
      kind: 'plan',
      assignee: '',
      author: 'Jan Wloka',
      approver: 'Max Albrecht',
    });
  });

  // CONTRACT CHANGE (feature/mine-mode-control): `boardForReader` now returns
  // `{ board, hiddenCount }`, not a bare `Board` — every call site destructures `.board`.
  it('returns the board untouched when off', () => {
    expect(boardForReader(kanban, reader, 'all').board).toBe(kanban);
  });

  it('hides only the card the directory declares for another person', () => {
    expect(slugs(boardForReader(kanban, reader, 'mine-and-unknown').board)).toEqual(['by-login', 'by-name', 'by-nobody', 'by-stranger']);
  });

  it('hides no card without a directory, and keeps the reader\'s other spelling', () => {
    // An exact-match rule would hide `Jan Wloka` here: 51 of the reader's 113
    // assigned plans on this estate.
    const bare = readerFrom({ hostUser: 'jwloka' });
    expect(slugs(boardForReader(kanban, bare, 'mine-and-unknown').board)).toEqual(slugs(kanban));
  });

  it('hides no card when the board names no reader', () => {
    expect(slugs(boardForReader(kanban, readerFrom({ people }), 'mine-and-unknown').board)).toEqual(slugs(kanban));
  });

  // ISSUE #2853's HIGH: the Planning control gates on this count, not on hiddenCount.
  it('counts the cards with no known owner, the same in both «Mine» modes', () => {
    const lenient = boardForReader(kanban, reader, 'mine-and-unknown');
    const strict = boardForReader(kanban, reader, 'mine');
    // `by-nobody` and `by-stranger` have no known owner; `by-max` is somebody else's.
    expect(lenient).toMatchObject({ hiddenCount: 1, unknownCount: 2 });
    expect(strict).toMatchObject({ hiddenCount: 3, unknownCount: 2 });
    expect(slugs(strict.board)).toEqual(['by-login', 'by-name']);
  });

  it('counts unknown cards where no card is somebody else\'s', () => {
    const bare = readerFrom({ hostUser: 'jwloka' });
    expect(boardForReader(kanban, bare, 'mine-and-unknown')).toMatchObject({ hiddenCount: 0 });
    expect(boardForReader(kanban, bare, 'mine-and-unknown').unknownCount).toBeGreaterThan(0);
  });

  it('counts nothing in all mode', () => {
    expect(boardForReader(kanban, reader, 'all')).toMatchObject({ hiddenCount: 0, unknownCount: 0 });
  });
});

describe('each population the rule cannot place answers unknown and stays', () => {
  it('keeps a build row', () => {
    const build = row({ kind: 'build', branch: 'main', pr: null });
    expect(ownedFromRow(build)).toEqual({ kind: 'other' });
    expect(rowsForReader([build], reader, 'mine-and-unknown')).toHaveLength(1);
  });

  it('keeps a bare branch row, whatever its name says', () => {
    const branch = row({ kind: 'branch', branch: 'feature/eins78-something', pr: null });
    expect(ownedFromRow(branch)).toEqual({ kind: 'other' });
    expect(rowsForReader([branch], reader, 'mine-and-unknown')).toHaveLength(1);
  });

  it('keeps a plan row on the Agents tab, which carries no assignee', () => {
    const planRow = row({ kind: 'plan', branch: '', pr: null });
    expect(ownedFromRow(planRow)).toEqual({ kind: 'other' });
    expect(rowsForReader([planRow], reader, 'mine-and-unknown')).toHaveLength(1);
  });

  it('keeps a card whose assignee is empty or undeclared', () => {
    expect(boardForReader(board({ columns: [column({ cards: [card({ assignee: '' }), card({ slug: 'b', assignee: 'Someone New' })] })] }), reader, 'mine-and-unknown')
      .board.columns[0]?.cards).toHaveLength(2);
  });

  it('keeps every agent, since the agent arm never answers theirs', () => {
    const agents = [
      agent({ branch: 'a', identity: 'manifest', state: 'running' }),
      agent({ branch: 'b', identity: 'synthesized', state: 'running' }),
      agent({ branch: 'c', identity: 'manifest', state: 'elsewhere' }),
    ];
    expect(agentsForReader(agents, reader, 'mine-and-unknown')).toHaveLength(3);
    expect(agentsForReader(agents, reader, 'all')).toBe(agents);
  });
});

describe('a row with no PR is owned by its plan\'s assignee, author or approver', () => {
  // The reported case: a Delivery row for a branch no PR has yet, whose plan
  // names `ckehl` (Christian Kehl) as assignee. `ckehl` is not in this
  // repository's own `People` config, so the fixture declares its own
  // directory mapping it to a third person, distinct from `reader`.
  const directory = parsePersonDirectory('jwloka = Jan Wloka; ckehl = Christian Kehl');
  const jwloka = readerFrom({ hostUser: 'jwloka', people: directory });
  const ckehl = readerFrom({ hostUser: 'ckehl', people: directory });

  it('hides the reported row from a reader the assignee does not resolve to', () => {
    const delivery = row({ kind: 'branch', branch: 'feature/ckehl-work', pr: null, assignee: 'ckehl' });
    expect(ownedFromRow(delivery)).toEqual({ kind: 'plan', assignee: 'ckehl', author: '', approver: '' });
    expect(rowsForReader([delivery], jwloka, 'mine-and-unknown')).toHaveLength(0);
  });

  it('shows the same row to the reader the assignee resolves to', () => {
    const delivery = row({ kind: 'branch', branch: 'feature/ckehl-work', pr: null, assignee: 'ckehl' });
    expect(rowsForReader([delivery], ckehl, 'mine-and-unknown')).toHaveLength(1);
  });

  it('keeps a row with no PR whose plan names nobody', () => {
    const unnamed = row({ kind: 'branch', branch: 'feature/unnamed', pr: null, assignee: '', author: '', approver: '' });
    expect(ownedFromRow(unnamed)).toEqual({ kind: 'other' });
    expect(rowsForReader([unnamed], jwloka, 'mine-and-unknown')).toHaveLength(1);
  });

  it('keeps a PR row whose author is another person hidden, and the reader\'s shown, whatever the plan fields say', () => {
    const theirs = row({
      kind: 'branch', branch: 'feature/a-branch', pr: { number: 1, author: 'ckehl' },
      assignee: 'jwloka', author: 'jwloka', approver: 'jwloka',
    });
    const mine = row({
      kind: 'branch', branch: 'feature/b-branch', pr: { number: 2, author: 'jwloka' },
      assignee: 'ckehl', author: 'ckehl', approver: 'ckehl',
    });
    expect(ownedFromRow(theirs)).toEqual({ kind: 'pr', author: 'ckehl' });
    expect(ownedFromRow(mine)).toEqual({ kind: 'pr', author: 'jwloka' });
    expect(rowsForReader([theirs, mine], jwloka, 'mine-and-unknown')).toEqual([mine]);
  });

  it('keeps a row whose assignee, author and approver are all undefined, as an older payload sends', () => {
    const legacy = { pr: null, assignee: undefined, author: undefined, approver: undefined };
    expect(ownedFromRow(legacy)).toEqual({ kind: 'other' });
    expect(rowsForReader([legacy], jwloka, 'mine-and-unknown')).toHaveLength(1);
  });
});

describe('a Draft plan row is owned by its assignee, author or approver', () => {
  // Same reported shape as the branch-row case above: `ckehl` is not in this
  // repository's own `People` config, so the fixture declares its own
  // directory mapping it to a third person, distinct from `reader`.
  const directory = parsePersonDirectory('jwloka = Jan Wloka; ckehl = Christian Kehl');
  const jwloka = readerFrom({ hostUser: 'jwloka', people: directory });

  it('stays visible with the filter on when the assignee resolves to the reader', () => {
    // Catches the filter never being wired at all.
    const mine = draft({ assignee: 'jwloka' });
    expect(draftsForReader([mine], jwloka, 'mine-and-unknown')).toEqual([mine]);
  });

  it('is hidden with the filter on when assignee, author and approver all name a declared stranger', () => {
    // Catches a no-op filter that always keeps everything.
    const theirs = draft({ assignee: 'ckehl', author: 'ckehl', approver: 'ckehl' });
    expect(draftsForReader([theirs], jwloka, 'mine-and-unknown')).toEqual([]);
  });

  it('stays visible with the filter on when all three fields are empty', () => {
    // Catches a stricter-than-`unknown` default — the regression this slice
    // must not introduce. An unowned Draft plan is `unknown`, not `theirs`.
    const unowned = draft();
    expect(unowned.assignee).toBe('');
    expect(unowned.author).toBe('');
    expect(unowned.approver).toBe('');
    expect(draftsForReader([unowned], jwloka, 'mine-and-unknown')).toEqual([unowned]);
  });

  it('is hidden in the strict mode when all three fields are empty', () => {
    // Catches `mine` reading an unowned Draft plan as the reader's own.
    expect(draftsForReader([draft()], jwloka, 'mine')).toEqual([]);
  });

  it('keeps every Draft plan, whoever owns it, when the filter is off', () => {
    // Catches the on/off contract breaking.
    const rows = [draft({ assignee: 'jwloka' }), draft({ plan: 'b', assignee: 'ckehl', author: 'ckehl', approver: 'ckehl' })];
    expect(draftsForReader(rows, jwloka, 'all')).toBe(rows);
  });

  it('maps a Draft plan to a plan row through the same shape a card uses', () => {
    expect(ownedFromCard(draft({ assignee: 'jwloka', author: 'eins78', approver: 'Jan Wloka' }))).toEqual({
      kind: 'plan',
      assignee: 'jwloka',
      author: 'eins78',
      approver: 'Jan Wloka',
    });
  });
});

describe('an agent reaches the agent arm through AgentList', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    asked.length = 0;
    refuseAgents.on = false;
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const render = () => {
    const pulse = fleet({
      rows: [row({ branch: 'feature/a-branch', group: 'working' })],
      agents: [agent({ session: 's-1', branch: 'feature/a-branch', identity: 'manifest', state: 'running' })],
    });
    return renderToStaticMarkup(createElement(AgentList, { fleet: pulse, pollSeconds: 4, server }));
  };

  it('asks the rule about the registry agent when the filter is on', () => {
    store.set('plot-board:agents:mine-only', '1');
    const html = render();
    expect(asked).toContainEqual({ kind: 'agent', identity: 'manifest', state: 'running' });
    // And the worker is still on screen: the arm answered `mine`.
    expect(html).toContain('feature/a-branch');
  });

  it('renders the WORKING section from the rule\'s answer', () => {
    // The agent arm never answers `theirs`, so a real answer cannot show the
    // wiring. A rule that refused every agent must empty WORKING; a component
    // that computed the answer and rendered `fleet.agents` anyway would not.
    store.set('plot-board:agents:mine-only', '1');
    const rows = (html: string) => html.split('data-agent-row=""').length - 1;
    const kept = rows(render());
    refuseAgents.on = true;
    expect(kept).toBeGreaterThan(0);
    expect(rows(render())).toBe(kept - 1);
  });

  it('asks nothing when the filter is off', () => {
    render();
    expect(asked.filter((o) => o.kind === 'agent')).toHaveLength(0);
  });
});
