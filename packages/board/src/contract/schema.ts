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
  /**
   * The delivery record as written — a date, usually bare.
   *
   * NOT the same statement as `phase: 'delivered'`. A plan can carry the phase
   * with this left empty (`reconcile-scan-accuracy.md` does today), which is a
   * bookkeeping fault rather than a delivery at an unknown time. Anything
   * needing a DATE must read this and treat "" as absent — never fall back to
   * the phase, and never to now.
   */
  delivered_raw: z.string().default(''),
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
  /**
   * Where this plan's branches are checked out on THIS machine — one entry per
   * branch that has a local worktree, in the pulse's own order.
   *
   * Present for CLEAN worktrees too, unlike the group lift a dirty one produces.
   * That is the one place the clean/dirty distinction goes the other way, and it
   * is consistent: dirtiness is evidence of *work*, presence is evidence of
   * *location*, and this answers location — *where did I put this*.
   *
   * In the MODAL rather than on a row or a tile. A row is a triage line and is
   * already full; a filesystem path is what you want once you have stopped
   * triaging and decided to go look.
   *
   * Empty (and so absent from the card) wherever this machine has no worktree —
   * a modal opened on a teammate's laptop shows no path rather than one that
   * does not exist there. Same rule as `local_dirty`, and the reason both can be
   * added without weakening refs-as-truth.
   */
  worktrees: z.array(z.object({ branch: z.string(), path: z.string() })).optional(),
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
  /**
   * Repo-relative path to the story's own file, e.g.
   * docs/stories/plot-board/STORY-plot-board.md — or "" where the board found
   * no file for it.
   *
   * Carried for the same reason `Card.path` is: the consumer must not
   * reconstruct it. A story slug is a directory name AND a filename component
   * (`<slug>/STORY-<slug>.md`), so rebuilding it client-side means encoding
   * that convention twice and letting the copies drift.
   *
   * "" is the honest answer for a plan naming a story nobody has written, and
   * it renders as no link at all — the rule plan rows already follow for
   * `planFile: ''`. The card keeps its title and status, which are true
   * regardless; hiding it would lose real information to avoid a broken link.
   * Defaulted so output from an older server still validates.
   */
  path: z.string().default(''),
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

/**
 * The note the server composes for a branch no earlier wave blocks — the one
 * kind of `not-started` row a person can actually pick up.
 *
 * In the CONTRACT rather than in `fleet.ts`, because both sides read it: the
 * server writes it from the wave verdict, and the Agents tab keys its Start
 * button on it. A row carries no `verdict` field, so this sentence is the only
 * place that verdict survives onto the row — and two copies of it would let a
 * reword turn every startable row into a blocked-looking one, with nothing
 * failing except the button quietly not appearing. (It cannot live in
 * `fleet.ts`: that module imports `node:child_process`, and the client bundle
 * must not reach it.)
 *
 * The better shape is a `verdict` field on `AgentRowSchema`, so the split is
 * data rather than prose. That widens the row contract two other branches are
 * widening today, so it is deliberately not done here.
 */
export const ELIGIBLE_NOTE = 'eligible — nobody has taken it';

export const FleetBranchSchema = z.object({
  branch: z.string(),
  state: BranchStateSchema,
  deferred: z.boolean(),
  /** Claim note from the plan, or "" — never null (house style). */
  claimed: z.string(),
  /**
   * A local worktree for this branch has uncommitted changes.
   *
   * The one thing the refs cannot see: an agent that has edited files and not
   * committed has written nothing git can report, so a branch someone is
   * actively working reads as abandoned. The scan runs on the machine that owns
   * the worktrees and reports what it finds there.
   *
   * STRICTLY ONE-DIRECTIONAL, and that is what lets it coexist with
   * refs-as-truth: `classify` may only use it to LIFT a branch out of quiet,
   * never to downgrade an answer. On a machine with no worktree for the branch
   * — every detached worker, every teammate's laptop, every CI run — it is
   * false, which is exactly the answer that changes nothing.
   *
   * Defaults to false so a pulse from an older scan still validates: absent and
   * "no worktree here" are the same statement, and both mean "answer from refs".
   */
  local_dirty: z.boolean().default(false),
  /**
   * Where this branch is checked out on THIS machine, or "".
   *
   * Kept although `local_dirty` is what moves the group, because it answers a
   * different question — *where did I put this* — and the plan modal is where
   * that gets asked. Shown for CLEAN worktrees too: dirtiness is evidence of
   * work, presence is evidence of location.
   *
   * True on this machine and meaningless on any other, so a reader elsewhere
   * gets "" and no path at all — a path that does not exist where you are
   * reading is worse than no path.
   */
  local_worktree: z.string().default(''),
});
export type FleetBranch = z.infer<typeof FleetBranchSchema>;

export const FleetWaveSchema = z.object({
  name: z.string(),
  verdict: WaveVerdictSchema,
  branches: z.array(FleetBranchSchema),
});

export const FleetPlanSchema = z.object({
  file: z.string(),
  /**
   * The plan's own lifecycle state, as `plot-plan-meta.sh` normalizes it
   * (draft|approved|delivered|released|…). Half of a row's phase; the branch's
   * git state is the other half, and the two are composed by `rowPhase` rather
   * than by either source.
   *
   * The plan's `Started:` COUNT deliberately does not travel with it. A row is a
   * statement about one branch, and whether THAT branch has work is a question
   * git answers per branch — see `rowPhase`. The count is still what the board's
   * CARD reads, because a card is a statement about the plan.
   *
   * Defaults to "" so a pulse from an older scan still validates — and ""
   * yields no row phase at all, which renders as nothing rather than as a
   * guessed column.
   */
  phase: z.string().default(''),
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
  /**
   * Which board phase this ROW is in — derived from the PAIR (the plan's phase
   * and this branch's git state), never from the plan file alone.
   *
   * The plan file alone produces rows that contradict themselves, and this repo
   * had the example: `opus5-longhorizon-hardening` is `Phase: Approved` with
   * zero `Started:` records while six of its branches carry real commits. Read
   * from the file the row says *Design*; read from git the note beside it says
   * *no commit for 22 days*. Two statements about one branch that cannot both
   * be true, and exactly the defect class this board has hit three times.
   *
   * See `rowPhase` for the mapping and for the one place the two sources
   * disagree deliberately. null where no phase can honestly be named — a plan
   * whose phase is rejected, superseded or simply unknown — and the cell then
   * renders empty rather than guessing a column.
   */
  phase: z.enum(BOARD_PHASES).nullable().default(null),
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
  /**
   * Where this branch lives on the git host, or "" — the address the row's own
   * branch name points at.
   *
   * Composed by the server from `git remote get-url origin`, NOT derived from
   * the PR URL: that derivation works only for rows that have a PR, and
   * `not-started`, `quiet` and fresh claims — the rows where "go look at the
   * branch" is most useful — have none.
   *
   * "" in the two cases where no honest address exists: an origin whose host
   * shape the board does not recognise, and a MERGED branch, whose remote page
   * is gone. Both render as plain text, by the same rule `CardPrSchema` states
   * for PR links. Defaults to "" so an older pulse still validates.
   */
  branchUrl: z.string().default(''),
  /**
   * Days since the plan was approved, for a branch nobody has started — or null.
   *
   * A DIFFERENT CLOCK from `ageMinutes`, and deliberately its own field.
   * Everywhere else `ageMinutes` means "since the branch tip moved", measured in
   * minutes; this means "since the plan was approved", measured in days or
   * months. Overloading one field with two meanings is precisely the ambiguity
   * that makes `22d` (no commits for three weeks) unreadable beside `22d` (never
   * begun) — so the row labels it rather than merging it.
   *
   * Only `open` branches carry it: a branch that exists has a real tip age, and
   * that is the better answer for it.
   *
   * null wherever the date is unavailable — a plan approved before Plot recorded
   * `Approved:` at all, or one whose record does not parse. Not zero, not "just
   * now": the same rule the PR countdown follows, for the same reason.
   */
  waitingDays: z.number().nullable().default(null),
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
  /**
   * Seconds until the server intends to fetch PR data again — backoff included,
   * because it is read from the one gate the fetch actually obeys.
   *
   * Optional, and its absence is load-bearing. `PR_REFRESH_MS` is 60 s but backs
   * off to 120 s when the host reports a rate limit, so a client ASSUMING 60 s
   * would count to zero and sit there through the wait — rendering "I don't
   * know" as "any moment now", which is the exact failure this whole view exists
   * to remove. An older server sends nothing here, and the client must then show
   * no PR countdown at all: the age alone is still true.
   */
  prNextInSeconds: z.number().nullable().default(null),
  /**
   * Seconds until the server rescans git — the companion to `ageSeconds`, and
   * for the same reason `prNextInSeconds` exists.
   *
   * The client cannot compute this from its own poll interval, and trying to
   * was a real bug: `ageSeconds` dates the SERVER's scan (5 s timer) while the
   * client polls every 4 s, so `interval − age` was reliably negative and the
   * countdown sat at "next in 0s" forever. Two clocks, one subtraction.
   *
   * Null on an older server, and the client then shows the age without a
   * countdown — the same honest degradation as the PR side.
   */
  scanNextInSeconds: z.number().nullable().default(null),
  prError: z.string().nullable(),
});
export type Fleet = z.infer<typeof FleetSchema>;
