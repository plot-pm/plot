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
  FleetSchema,
  type AgentEntry,
  type AgentRow,
  type Board,
  type Card,
  type Column,
  type Fleet,
} from '../../src/contract/schema.js';
import {
  agentsForReader,
  boardForReader,
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
  path: 'docs/plans/2026-08-24-a-plan.md', ...over,
});
const column = (over: Partial<Column> = {}): Column => ColumnSchema.parse({ phase: 'Development', cards: [], ...over });
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

  it('returns the board untouched when off', () => {
    expect(boardForReader(kanban, reader, false)).toBe(kanban);
  });

  it('hides only the card the directory declares for another person', () => {
    expect(slugs(boardForReader(kanban, reader, true))).toEqual(['by-login', 'by-name', 'by-nobody', 'by-stranger']);
  });

  it('hides no card without a directory, and keeps the reader\'s other spelling', () => {
    // An exact-match rule would hide `Jan Wloka` here: 51 of the reader's 113
    // assigned plans on this estate.
    const bare = readerFrom({ hostUser: 'jwloka' });
    expect(slugs(boardForReader(kanban, bare, true))).toEqual(slugs(kanban));
  });

  it('hides no card when the board names no reader', () => {
    expect(slugs(boardForReader(kanban, readerFrom({ people }), true))).toEqual(slugs(kanban));
  });
});

describe('each population the rule cannot place answers unknown and stays', () => {
  it('keeps a build row', () => {
    const build = row({ kind: 'build', branch: 'main', pr: null });
    expect(ownedFromRow(build)).toEqual({ kind: 'other' });
    expect(rowsForReader([build], reader, true)).toHaveLength(1);
  });

  it('keeps a bare branch row, whatever its name says', () => {
    const branch = row({ kind: 'branch', branch: 'feature/eins78-something', pr: null });
    expect(ownedFromRow(branch)).toEqual({ kind: 'other' });
    expect(rowsForReader([branch], reader, true)).toHaveLength(1);
  });

  it('keeps a plan row on the Agents tab, which carries no assignee', () => {
    const planRow = row({ kind: 'plan', branch: '', pr: null });
    expect(ownedFromRow(planRow)).toEqual({ kind: 'other' });
    expect(rowsForReader([planRow], reader, true)).toHaveLength(1);
  });

  it('keeps a card whose assignee is empty or undeclared', () => {
    expect(boardForReader(board({ columns: [column({ cards: [card({ assignee: '' }), card({ slug: 'b', assignee: 'Someone New' })] })] }), reader, true)
      .columns[0]?.cards).toHaveLength(2);
  });

  it('keeps every agent, since the agent arm never answers theirs', () => {
    const agents = [
      agent({ branch: 'a', identity: 'manifest', state: 'running' }),
      agent({ branch: 'b', identity: 'synthesized', state: 'running' }),
      agent({ branch: 'c', identity: 'manifest', state: 'elsewhere' }),
    ];
    expect(agentsForReader(agents, reader, true)).toHaveLength(3);
    expect(agentsForReader(agents, reader, false)).toBe(agents);
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
