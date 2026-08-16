import { z } from 'zod';

/**
 * The contract between Plot's plan-format helper (`plot-plan-meta.sh`) and the
 * board. `plot-plan-meta.sh` is the ONE parser of plan files; the board
 * consumes its JSON-lines output and never parses a plan itself. Zod validates
 * at that boundary — everything downstream is typed.
 */

// ─── Helper output: one JSON object per plan file ────────────────────────────

/** Raw record emitted by `plot-plan-meta.sh` (one JSON line per plan). */
export const PlanMetaSchema = z.object({
  file: z.string(),
  format: z.string(),
  /** Normalized, lowercase: draft|approved|delivered|released|rejected|… */
  phase: z.string(),
  type: z.string().default(''),
  title: z.string().default(''),
  sprint: z.string().default(''),
  story: z.string().default(''),
  assignee: z.string().default(''),
  branches: z.array(z.string()).default([]),
  /**
   * Branches grouped into waves by `### ` subheading under `## Branches`, in
   * document order. A wave is eligible once every non-deferred branch in every
   * prior wave is merged — that arithmetic lives in `plot-fleet-scan.sh`, not
   * here; the board only renders what the helper reports.
   *
   * `claimed` is a REFLECTION of a claim, not the claim itself: a worker takes
   * a branch by pushing its ref (atomic), then writes this annotation for
   * humans and the board. Where the two disagree, git wins.
   *
   * Defaults to empty so output from a pre-wave `plot-plan-meta.sh` still
   * validates. `branches` above stays the complete flat set — never derive one
   * from the other at this layer.
   */
  waves: z.array(z.object({
    name: z.string().default(''),
    branches: z.array(z.object({
      branch: z.string(),
      deferred: z.boolean().default(false),
      claimed: z.string().default(''),
    })).default([]),
  })).default([]),
  prs: z.array(z.number()).default([]),
  /** Plot 2 ceremony fields (absent on pre-Plot-2 plans). */
  review: z.string().default('NONE'),
  impl: z.string().default('NONE'),
  approved_raw: z.string().default(''),
  // Empty until /plot-release records it. Defaulted so a plan written
  // before the field existed still parses — the board must never fail on
  // an old plan file.
  released_raw: z.string().default(''),
  started_raw: z.array(z.string()).default([]),
  error: z.string().optional(),
});
export type PlanMeta = z.infer<typeof PlanMetaSchema>;

// ─── Board output: what GET /api/board returns ───────────────────────────────

/**
 * The columns the board renders, in order. These are the WORKFLOW phases, which
 * differ from the plan's four lifecycle states by asking *who leads* rather
 * than *what has happened*:
 *
 *   Discovery    Draft — the plan is still being found          👤 human-led
 *   Design       Approved with no Started: record               👤 human-led
 *   Development  Approved WITH a Started: record                🤖 agent-led
 *   Endgame      Delivered, not yet Released                    👤 human-led
 *   Released     done
 *
 * Design therefore means exactly one thing — designed, not yet started. Draft
 * belongs in Discovery instead: while a plan is under review the work is
 * deciding what the plan should be, which is a spike carried in a plan file,
 * and approval is where that ends.
 *
 * `Approved` spans a boundary: a plan nobody has started sits at the end of
 * Design, one with work in flight is in Development. That distinction —
 * human-led versus agent-led — is what the whole model turns on, and the board
 * already had the data for it (`started`) without reading it as a phase change.
 *
 * Development ends at the MERGE, not at the release: Delivered means the code
 * landed and the agents are done, so what remains is verification and signoff.
 * A column is a partition, so Delivered belongs to Endgame alone.
 */
export const BOARD_PHASES = [
  'Discovery', 'Design', 'Development', 'Endgame', 'Released',
] as const;
export type Phase = (typeof BOARD_PHASES)[number];

/**
 * Who leads each column. Carried as a symbol AND a word, never as colour alone:
 * roughly one man in twelve distinguishes red from green poorly, and the same
 * page shows up in greyscale screenshots. Colour may only repeat what these say.
 */
export const PHASE_LEADERSHIP: Record<Phase, { icon: string; who: string }> = {
  Discovery: { icon: '👤', who: 'human-led' },
  Design: { icon: '👤', who: 'human-led' },
  Development: { icon: '🤖', who: 'agent-led' },
  Endgame: { icon: '👤', who: 'human-led' },
  Released: { icon: '✓', who: 'done' },
};

/** Sprint lifecycle phases (parsed from sprint files, not plan files). */
export const SPRINT_PHASES = ['Planning', 'Committed', 'Active', 'Closed'] as const;
export type SprintPhase = (typeof SPRINT_PHASES)[number];

/** Story lifecycle statuses (from story-tracking front matter). */
export const STORY_STATUSES = ['draft', 'ready', 'active', 'in-review', 'paused', 'done'] as const;
export type StoryStatus = (typeof STORY_STATUSES)[number];

/**
 * Wave state condensed to the numbers a board tile can show — from TWO sources,
 * deliberately, and the split is the whole point.
 *
 * `waves`, `branches` and `deferred` are plan-derived: they say how the plan is
 * shaped, they are true whether or not git can be read, and they keep rendering
 * when the fleet cache is cold.
 *
 * `claimed` and `eligible` are git-derived, read from the fleet pulse — because
 * a claim is a pushed ref, never a note in a file. They are OPTIONAL for the
 * reason this schema exists at all: `claimed: 0` and "no pulse has landed yet"
 * must not render identically. A card built without a pulse omits them, and the
 * tile shows nothing rather than a zero it cannot stand behind.
 */
export const WaveSummarySchema = z.object({
  waves: z.number(),
  /** Non-deferred branches only — deferred work is not outstanding. */
  branches: z.number(),
  /** Branches whose git state is `claimed`. Absent when there is no pulse. */
  claimed: z.number().optional(),
  /** Open branches in an eligible wave — startable now. Absent without a pulse. */
  eligible: z.number().optional(),
  deferred: z.number(),
});
export type WaveSummary = z.infer<typeof WaveSummarySchema>;

/**
 * A pull request as a card names it: the number the plan wrote down, and the
 * link the HOST gave us for it.
 *
 * `url` is empty whenever the board does not know one — the PR data has not
 * landed yet, or the host CLI reported none. The board never fills that gap:
 * nothing under `packages/board/src` may learn that a PR number plus a repo
 * makes a github.com address, because the same arithmetic produces a confidently
 * wrong link for GitHub Enterprise or a self-hosted Bitbucket. An empty `url`
 * renders as plain text, exactly as Bitbucket's `checks:"unknown"` renders as
 * unavailable rather than green.
 */
export const CardPrSchema = z.object({
  number: z.number(),
  url: z.string().default(''),
});
export type CardPr = z.infer<typeof CardPrSchema>;

export const CardSchema = z.object({
  slug: z.string(),
  title: z.string(),
  type: z.string(),
  phase: z.enum(BOARD_PHASES),
  sprint: z.string().optional(),
  story: z.string().optional(),
  assignee: z.string().optional(),
  /**
   * Approved cards only: true once the plan has a `Started:` record —
   * the board's Ready (approved, idle) vs In-progress split.
   */
  started: z.boolean().optional(),
  /** Repo-relative path, e.g. docs/plans/2026-07-12-kanban-board-v1.md */
  path: z.string(),
  /**
   * The plan's pull requests, in the order `plot-plan-meta.sh` reports them
   * (sorted, unique). Defaults to empty — a plan that names none is the common
   * case, not a degraded one.
   */
  prs: z.array(CardPrSchema).default([]),
  /**
   * Glanceable wave state for a card: how many waves, how much outstanding
   * work, how much of it is taken, and how much could be started now.
   * Deliberately a summary rather than the nested `waves` structure — a tile
   * answers "how much is left and is anyone on it?", not "which branch sits in
   * which wave".
   *
   * Optional: pre-wave plans and older helper output produce cards without it.
   * Present for single-wave plans too — "is anyone working on this?" is the same
   * question whether a plan has one branch or nine.
   */
  waveSummary: WaveSummarySchema.optional(),
});
export type Card = z.infer<typeof CardSchema>;

export const ColumnSchema = z.object({
  phase: z.enum(BOARD_PHASES),
  cards: z.array(CardSchema),
});
export type Column = z.infer<typeof ColumnSchema>;

export const SprintCardSchema = z.object({
  slug: z.string(),
  title: z.string(),
  phase: z.string(),
});
export type SprintCard = z.infer<typeof SprintCardSchema>;

export const StoryCardSchema = z.object({
  slug: z.string(),
  title: z.string(),
  status: z.string(),
});
export type StoryCard = z.infer<typeof StoryCardSchema>;

/**
 * Whether the server will act on a Start work click, and why not.
 *
 * A statement about the SERVER, not about any plan — which is why it rides on
 * the board document rather than on a card. The route refuses a non-localhost
 * binding with 403; without this the button could only learn that by being
 * clicked, and a control that looks live and then refuses is a worse answer
 * than one that says up front what it cannot do.
 *
 * Defaults to unavailable so an older server (which sends no such field) makes
 * a newer client hide the button rather than offer one that 404s.
 */
export const DispatchInfoSchema = z.object({
  available: z.boolean(),
  /** Empty when available; a human sentence otherwise. */
  reason: z.string().default(''),
});
export type DispatchInfo = z.infer<typeof DispatchInfoSchema>;

export const BoardSchema = z.object({
  generatedAt: z.string(),
  columns: z.array(ColumnSchema),
  /** See DispatchInfoSchema — a server capability, not plan data. */
  dispatch: DispatchInfoSchema.default({ available: false, reason: '' }),
  /**
   * Newest release checklist, for the Endgame column: what is left before
   * signoff. null when no checklist exists or none could be parsed — the board
   * shows no badge rather than a guessed count.
   */
  checklist: z.object({ done: z.number(), total: z.number() }).nullable(),
  sprints: z.array(SprintCardSchema),
  stories: z.array(StoryCardSchema),
});
export type Board = z.infer<typeof BoardSchema>;

/**
 * Map a helper `phase` value to a board column, or null if the plan should not
 * appear on the board (rejected / superseded / unknown / legacy plans).
 */
export function toBoardPhase(helperPhase: string, started = false): Phase | null {
  switch (helperPhase) {
    case 'draft':
      // Draft IS discovery: a plan under review is the investigation deciding
      // whether there is a commitment at all, and approval is the moment that
      // investigation ends. Mapping it to Design put unfinished designs beside
      // finished ones and left Discovery a column nothing could ever reach.
      return 'Discovery';
    case 'approved':
      // The one place the board reads a plan state as two phases. Without a
      // Started: record the plan is Ready — designed, waiting for a person to
      // begin. With one, an agent is working.
      return started ? 'Development' : 'Design';
    case 'delivered':
      return 'Endgame';
    case 'released':
      return 'Released';
    default:
      return null;
  }
}

// --- Fleet: what agents are doing, and what they wait for -------------------
//
// A different time axis from the board above: minutes rather than days,
// processes rather than artifacts. Kept in the same contract file because both
// are things the server promises the client, but deliberately its own document
// — forcing them together would answer each question halfway.

/** The scan's INTERNAL vocabulary, not the prose labels people read. */
export const BranchStateSchema = z.enum(['open', 'wip', 'merged', 'claimed', 'deferred']);
export type BranchState = z.infer<typeof BranchStateSchema>;

export const WaveVerdictSchema = z.enum(['complete', 'eligible', 'blocked']);
export type WaveVerdict = z.infer<typeof WaveVerdictSchema>;

export const FleetBranchSchema = z.object({
  branch: z.string(),
  state: BranchStateSchema,
  deferred: z.boolean(),
  /** Claim note from the plan, or "" — never null (house style). */
  claimed: z.string(),
});
export type FleetBranch = z.infer<typeof FleetBranchSchema>;

export const FleetWaveSchema = z.object({
  name: z.string(),
  verdict: WaveVerdictSchema,
  branches: z.array(FleetBranchSchema),
});

export const FleetPlanSchema = z.object({
  file: z.string(),
  waves: z.array(FleetWaveSchema),
});

/** The raw `plot-fleet-scan.sh --json` document, parsed. */
export const FleetPulseSchema = z.object({
  main: z.string(),
  head: z.string(),
  plans: z.array(FleetPlanSchema),
  summary: z.object({
    plans: z.number(),
    waves: z.number(),
    branches: z.number(),
    claimed: z.number(),
    eligible: z.number(),
    blocked: z.number(),
    deferred: z.number(),
  }),
});
export type FleetPulse = z.infer<typeof FleetPulseSchema>;

/**
 * Groups are ordered by what they ask OF YOU, not by plan: review it, nothing,
 * nothing, go check whether it died, decide whether to start it. Sorted this
 * way the list is workable top to bottom, and when only `working` is populated
 * you can walk away.
 */
export const WaitingGroupSchema = z.enum([
  'waiting-on-you',
  'working',
  'waiting-on-machine',
  'quiet',
  'not-started',
  'done',
]);
export type WaitingGroup = z.infer<typeof WaitingGroupSchema>;

export const AgentRowSchema = z.object({
  /** Constant today. Present so the second repo is an addition, not a rebuild. */
  repo: z.string(),
  branch: z.string(),
  /** Display name: the plan file without its date prefix or `.md`. */
  plan: z.string(),
  /**
   * The plan's FILENAME (basename, with date prefix and extension) — what
   * `/plan/<file>` needs. Kept beside `plan` rather than reconstructed from it,
   * because stripping the date is lossy and no consumer should have to guess
   * it back. Defaults to "" so an older pulse still validates; a row with none
   * renders its plan as plain text.
   */
  planFile: z.string().default(''),
  wave: z.string(),
  state: BranchStateSchema,
  group: WaitingGroupSchema,
  /** Minutes since the branch tip, or null when there is no branch yet. */
  ageMinutes: z.number().nullable(),
  note: z.string(),
  /**
   * The open PR for this branch, if the host reported one. `url` may be "" even
   * when `number` is set — an older host CLI reports no address — and the row
   * then shows the number without a link rather than inventing one.
   */
  pr: z.object({ number: z.number(), url: z.string().default('') }).nullable().default(null),
});
export type AgentRow = z.infer<typeof AgentRowSchema>;

export const FleetSchema = z.object({
  generatedAt: z.string(),
  /** Seconds since the cached scan completed — the tab shows this. */
  ageSeconds: z.number(),
  /** False until the first scan lands: "not ready yet", never an empty fleet. */
  ready: z.boolean(),
  /** Last scan error, if any. A failed refresh never clears a good result. */
  error: z.string().nullable(),
  rows: z.array(AgentRowSchema),
  summary: FleetPulseSchema.shape.summary,
  /**
   * PR data ages separately from the pulse, because the two sources fail
   * separately. null means it has never landed — not that it is fresh.
   */
  prAgeSeconds: z.number().nullable(),
  prError: z.string().nullable(),
});
export type Fleet = z.infer<typeof FleetSchema>;
