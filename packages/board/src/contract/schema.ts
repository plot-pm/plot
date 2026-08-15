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
  started_raw: z.array(z.string()).default([]),
  error: z.string().optional(),
});
export type PlanMeta = z.infer<typeof PlanMetaSchema>;

// ─── Board output: what GET /api/board returns ───────────────────────────────

/** The four lifecycle phases the board renders as columns, in order. */
export const BOARD_PHASES = ['Draft', 'Approved', 'Delivered', 'Released'] as const;
export type Phase = (typeof BOARD_PHASES)[number];

/** Sprint lifecycle phases (parsed from sprint files, not plan files). */
export const SPRINT_PHASES = ['Planning', 'Committed', 'Active', 'Closed'] as const;
export type SprintPhase = (typeof SPRINT_PHASES)[number];

/** Story lifecycle statuses (from story-tracking front matter). */
export const STORY_STATUSES = ['draft', 'ready', 'active', 'in-review', 'paused', 'done'] as const;
export type StoryStatus = (typeof STORY_STATUSES)[number];

/** Wave state condensed to the four numbers a board tile can show. */
export const WaveSummarySchema = z.object({
  waves: z.number(),
  /** Non-deferred branches only — deferred work is not outstanding. */
  branches: z.number(),
  claimed: z.number(),
  deferred: z.number(),
});
export type WaveSummary = z.infer<typeof WaveSummarySchema>;

/**
 * Condense `PlanMeta.waves` for display. Deferred branches are excluded from
 * `branches` and counted separately: counting them as outstanding would make a
 * finished plan look unfinished on the board.
 */
export function summariseWaves(waves: PlanMeta['waves']): WaveSummary {
  let branches = 0, claimed = 0, deferred = 0;
  for (const w of waves) {
    for (const b of w.branches) {
      if (b.deferred) { deferred += 1; continue; }
      branches += 1;
      if (b.claimed) claimed += 1;
    }
  }
  return { waves: waves.length, branches, claimed, deferred };
}

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
   * Glanceable wave state for a card: how many waves, how much outstanding
   * work, how much of it is taken. Deliberately a summary rather than the
   * nested `waves` structure — a tile answers "how much is left and is anyone
   * on it?", not "which branch sits in which wave".
   *
   * Optional: pre-wave plans and older helper output produce cards without it.
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

export const BoardSchema = z.object({
  generatedAt: z.string(),
  columns: z.array(ColumnSchema),
  sprints: z.array(SprintCardSchema),
  stories: z.array(StoryCardSchema),
});
export type Board = z.infer<typeof BoardSchema>;

/**
 * Map a helper `phase` value to a board column, or null if the plan should not
 * appear on the board (rejected / superseded / unknown / legacy plans).
 */
export function toBoardPhase(helperPhase: string): Phase | null {
  switch (helperPhase) {
    case 'draft':
      return 'Draft';
    case 'approved':
      return 'Approved';
    case 'delivered':
      return 'Delivered';
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
  plan: z.string(),
  wave: z.string(),
  state: BranchStateSchema,
  group: WaitingGroupSchema,
  /** Minutes since the branch tip, or null when there is no branch yet. */
  ageMinutes: z.number().nullable(),
  note: z.string(),
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
