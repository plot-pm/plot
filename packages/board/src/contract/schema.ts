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
