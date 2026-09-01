import {
  AgentEntrySchema, AgentRowSchema, BoardSchema, CardSchema, ColumnSchema, FleetSchema,
  SprintCardSchema, StoryCardSchema, WaveSchema,
  type AgentEntry, type AgentRow, type Board, type Card, type Column, type Fleet,
  type SprintCard, type StoryCard, type Wave,
} from '../../src/contract/schema.js';
import type { z } from 'zod';

/**
 * THE ONE BUILDER. Every named state in the catalogue is assembled from these
 * six functions, and nothing else builds a payload.
 *
 * ## Why these PARSE rather than cast
 *
 * The client CASTS its payload — `App.tsx` reads `(await res.json()) as Board`
 * and `as Fleet`, so Zod defaults never run in the browser and a field a fixture
 * omits reaches the renderer as `undefined` rather than as an error. That is the
 * shape behind two defects already recorded in this repo's memory, and it is why
 * thirty-nine hand-built fixtures could each be wrong in a different way without
 * anything saying so.
 *
 * Parsing here moves the failure to the earliest place that can see it:
 *
 *   - a REQUIRED field the builder forgets throws when the fixture is built,
 *     naming the field, instead of rendering blank three components deep;
 *   - a required field the schema GAINS fails `tsc` on the defaults below,
 *     because they are typed as `z.input<…>` — which makes exactly the defaulted
 *     fields optional and exactly the required ones required.
 *
 * That second half is `Done when` item 4 of the plan, and it is a property of
 * the types rather than a promise: `pnpm run typecheck` is the gate, and
 * `tsconfig.json` includes this directory so the gate can reach it.
 *
 * ## Why `z.input` and not the inferred type
 *
 * `AgentRow` (the OUTPUT type) has every defaulted field present and non-
 * optional, so a literal typed as `Partial<AgentRow>` accepts an omission of a
 * field that has NO default — the exact case that must fail. `z.input` is the
 * type of what `parse` accepts, so it carries the distinction the schema makes.
 *
 * ## Why each builder's defaults are a SEPARATELY NAMED const
 *
 * Inside `Schema.parse({ …defaults, ...over })` TypeScript widens the literal —
 * `phase: 'Development'` infers as `string` — so the spread checks the CALLER's
 * override and not the builder's own defaults. Measured while writing this file:
 * `phase: 'Approved'` (a PLAN phase, and not one of the five BOARD phases) was
 * flagged at the two call sites and silently accepted at three defaults, where
 * it would instead have thrown at `parse` time.
 *
 * Naming the defaults with their input type checks them where they are written.
 * Every scenario inherits them, so this is the half that matters most.
 */
type RowInput = z.input<typeof AgentRowSchema>;
type WaveInput = z.input<typeof WaveSchema>;
type CardInput = z.input<typeof CardSchema>;
type ColumnInput = z.input<typeof ColumnSchema>;
type FleetInput = z.input<typeof FleetSchema>;
type BoardInput = z.input<typeof BoardSchema>;
type AgentInput = z.input<typeof AgentEntrySchema>;
type StoryInput = z.input<typeof StoryCardSchema>;
type SprintInput = z.input<typeof SprintCardSchema>;

/** A stable clock. A catalogue whose ages move is a catalogue that flakes. */
const EPOCH = Date.parse('2026-08-30T12:00:00.000Z');
export const generatedAt = new Date(EPOCH).toISOString();

/**
 * The least interesting row that is still a valid one — a branch somebody is
 * working, on a plan with one wave — so a scenario states only what it is ABOUT.
 */
const ROW_DEFAULTS: RowInput = {
  repo: 'garden',
  kind: 'branch',
  branch: 'feature/a-branch',
  plan: 'a-plan',
  planFile: '2026-08-24-a-plan.md',
  wave: 'Wave',
  state: 'wip',
  phase: 'Development',
  group: 'working',
  ageMinutes: 30,
  note: '',
  pr: null,
  branchUrl: 'https://github.com/tiny/garden/tree/feature/a-branch',
};

/** One branch row. */
export const row = (over: Partial<RowInput> = {}): AgentRow =>
  AgentRowSchema.parse({ ...ROW_DEFAULTS, ...over });

/** One wave — the cohort a plan's branches sit in. */
const WAVE_DEFAULTS: WaveInput = {
  plan: 'a-plan',
  name: 'Wave',
  branches: ['feature/a-branch'],
  verdict: 'eligible',
  section: 'not-started',
  complete: false,
};

export const wave = (over: Partial<WaveInput> = {}): Wave =>
  WaveSchema.parse({ ...WAVE_DEFAULTS, ...over });

/** One plan card, as `/api/board` carries it. */
const CARD_DEFAULTS: CardInput = {
  slug: 'a-plan',
  title: 'A plan',
  type: 'feature',
  phase: 'Development',
  path: 'docs/plans/2026-08-24-a-plan.md',
};

export const card = (over: Partial<CardInput> = {}): Card =>
  CardSchema.parse({ ...CARD_DEFAULTS, ...over });

/** One board column — a phase and the cards in it. */
const COLUMN_DEFAULTS: ColumnInput = { phase: 'Development', cards: [] };

export const column = (over: Partial<ColumnInput> = {}): Column =>
  ColumnSchema.parse({ ...COLUMN_DEFAULTS, ...over });

/**
 * One registry entry — an Agent, as `/api/fleet` carries it.
 *
 * The WORKING section renders one row per registry entry, joined to a branch row
 * by `branch`. So a scenario whose rows include a `working` branch and whose
 * `agents` array does not name it renders an EMPTY working section, with every
 * assertion against it timing out on a locator.
 *
 * That is the `waves`-shaped failure the plan records, one field along, and it
 * is why {@link fleet} derives `agents` from the rows rather than leaving the
 * schema's `[]` default to stand.
 */
const AGENT_DEFAULTS: AgentInput = {
  session: 'sess0000',
  branch: 'feature/a-branch',
  worktree: '/wt/plot-wt-a-branch',
  command: '',
  startedAt: '',
  pid: '',
  previousPid: '',
  relaunches: 0,
  state: 'running',
};

export const agent = (over: Partial<AgentInput> = {}): AgentEntry =>
  AgentEntrySchema.parse({ ...AGENT_DEFAULTS, ...over });

/**
 * A whole fleet pulse.
 *
 * `summary` is DERIVED from the rows and waves unless a scenario states
 * otherwise, because a summary that contradicts its own rows is a fixture bug
 * rather than a state worth naming — and hand-maintained counts are the first
 * thing to rot when a scenario gains a row.
 */
const FLEET_DEFAULTS: FleetInput = {
  generatedAt,
  ageSeconds: 1,
  ready: true,
  error: null,
  rows: [],
  waves: [],
  summary: { plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
  stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
  prAgeSeconds: 1,
  prNextInSeconds: 59,
  scanNextInSeconds: 4,
  prError: null,
};

export const fleet = (over: Partial<FleetInput> = {}): Fleet => {
  const rows = (over.rows ?? []) as RowInput[];
  const waves = (over.waves ?? []) as WaveInput[];
  return FleetSchema.parse({
    ...FLEET_DEFAULTS,
    /**
     * WORKING RENDERS FROM THE REGISTRY, so `agents` is derived from the rows
     * for the same reason `summary` is: a pulse whose working rows name no agent
     * renders an empty WORKING section, and every assertion against it times out
     * on a locator that reads exactly like a selector typo.
     *
     * The join is by `branch`. An explicit `over.agents` still wins, for a
     * scenario that is ABOUT the registry — a session id, an order, an agent
     * whose branch has no row.
     */
    agents: rows
      .filter((r) => (r.group ?? ROW_DEFAULTS.group) === 'working')
      .map((r) => agent({ session: `s-${r.branch}`, branch: r.branch })),
    summary: {
      plans: new Set(rows.map((r) => r.plan)).size,
      waves: waves.length,
      branches: rows.length,
      claimed: rows.filter((r) => r.state === 'wip').length,
      eligible: rows.filter((r) => r.verdict === 'eligible').length,
      blocked: rows.filter((r) => r.verdict === 'blocked').length,
      deferred: rows.filter((r) => r.state === 'deferred').length,
    },
    ...over,
  });
};

/**
 * A whole board payload. Defaults to a board that can do NOTHING — every act
 * left at the schema's `available: false` — so a scenario that wants a button
 * says which one, and none silently inherits a capability it did not ask for.
 */
const BOARD_DEFAULTS: BoardInput = {
  generatedAt,
  columns: [],
  sprints: [],
  stories: [],
  checklist: null,
  /**
   * WHAT THE SERVER SAYS ABOUT ITSELF, and it is stated rather than defaulted.
   *
   * `BoardSchema` defaults this to empty strings and a port of 0, which is the
   * right default for a PARSER — a payload from an older build should not fail
   * to load over a field it never had. It is the wrong default for a CATALOGUE,
   * because a component that renders `restartCommand` only when the server sent
   * one is then untestable: the mock silently declines to say anything, the
   * block correctly does not render, and the test reads as a component bug.
   *
   * Measured 2026-08-31: three assertions in `unreachable-overlay` failed
   * exactly this way — the overlay's message is built from these fields, and
   * with the schema defaults it could name neither the command nor the port.
   *
   * So the catalogue serves a plausible, FIXED answer, in the same spirit as
   * `generatedAt`: a scenario that is about server identity overrides it, and
   * every other scenario gets a board that describes itself the way a real one
   * does.
   */
  server: {
    restartCommand: 'pnpm board',
    port: 4711,
    branch: 'main',
    repo: 'garden',
  },
};

/**
 * One sprint card, as `/api/board` carries it.
 *
 * The sprint FILTER's options come from these, not from `card.sprint`: a plan's
 * `Sprint:` field is history and does not clear when its sprint closes, so
 * deriving options from the cards offered closed sprints beside open ones with
 * nothing to tell them apart.
 */
const SPRINT_DEFAULTS: SprintInput = {
  slug: 'a-sprint',
  title: 'A sprint',
  phase: 'active',
};

export const sprint = (over: Partial<SprintInput> = {}): SprintCard =>
  SprintCardSchema.parse({ ...SPRINT_DEFAULTS, ...over });

/**
 * One story card, as `/api/board` carries it.
 *
 * `path` defaults to a real-looking file because that is the ordinary case; a
 * story nobody has written states `path: ''`, which is what `storyHref` reads as
 * *no link at all*. The slug is both a directory name and a filename component,
 * so the path is CARRIED rather than rebuilt.
 */
const STORY_DEFAULTS: StoryInput = {
  slug: 'a-story',
  title: 'A story',
  status: 'active',
  path: 'docs/stories/a-story/STORY-a-story.md',
};

export const story = (over: Partial<StoryInput> = {}): StoryCard =>
  StoryCardSchema.parse({ ...STORY_DEFAULTS, ...over });

export const board = (over: Partial<BoardInput> = {}): Board =>
  BoardSchema.parse({ ...BOARD_DEFAULTS, ...over });
