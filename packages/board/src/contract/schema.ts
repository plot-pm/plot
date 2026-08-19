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
  /**
   * How many rounds of `/plot:challenge-the-plan` this plan has been through.
   *
   * OPTIONAL, and never defaulted to 0 — that is the whole design of the field.
   * `0 rounds` reads as *interrogated and found nothing*; a missing block means
   * *nobody has looked*. Those want opposite reactions from a reader, so the
   * two must not render alike. Same rule, and the same reason, as `claimed` and
   * `eligible` on `WaveSummarySchema`.
   *
   * `plot-plan-meta.sh` omits the key entirely rather than sending a sentinel,
   * so `undefined` here is the parser's own answer and not a decoding artifact.
   * A plan whose metadata block is malformed reports it the same way.
   */
  rounds: z.number().optional(),
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
  /**
   * Rounds of `/plot:challenge-the-plan` this plan has been through, from the
   * metadata block the skill writes into the plan file.
   *
   * OPTIONAL for the reason stated on `PlanMetaSchema.rounds`: absent means no
   * interrogation is recorded, and it must not arrive as 0. A card carrying
   * `undefined` shows no badge at all.
   *
   * Carried on the CARD only. The agent row deliberately does not gain it: a row
   * is a statement about one branch, and most rows name a plan whose design
   * phase closed long ago — attaching a design-time count to all of them would
   * be the crowding this board keeps removing. Same split as `waveSummary`,
   * which is card-only for the same reason.
   */
  rounds: z.number().optional(),
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
  /**
   * The date belonging to THIS card's phase, as `YYYY-MM-DD` — or "" where the
   * plan records none.
   *
   * One field rather than four, and that is the point: a `Released` card is
   * recent by its **release** date and an `Endgame` card by its **delivery**
   * date, so "how recent is this card" has a different answer per column. The
   * server picks the right record once (see `phaseDateOf`) and the client sorts
   * on the answer — otherwise every consumer would carry its own copy of the
   * phase→record mapping, and a column would quietly sort by the wrong clock.
   *
   * Deliberately NOT a fallback chain down to the filename's date prefix. That
   * prefix is when the plan was *written*, which for the thirteen plans in
   * `Released` today is months away from when they shipped — a plausible-looking
   * order that is simply a different question's answer. "" is the honest reply,
   * and a card carrying it sorts last rather than sorting wrong.
   *
   * A DATE, not a timestamp: `Released: 2026-08-16, v2.3.0` is the finest
   * resolution Plot records, so several cards share a day and their relative
   * order within it is undefined. Sorting must therefore be stable — see
   * `truncateColumn`.
   *
   * Defaulted so output from an older server still validates; such a board
   * truncates by the order cards arrive in, which is worse than by date and far
   * better than failing to parse.
   */
  phaseDate: z.string().default(''),
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

/**
 * How to start this board again, in this project's own words.
 *
 * Sent so the unreachable overlay can name a way out rather than only a
 * problem. The board is left running for hours and reloaded rarely, and
 * whoever finds it frozen at midday may not remember how it was started.
 *
 * From the SERVER, never a constant in the client, and that is Principle 5
 * rather than tidiness: `pnpm board` is *this* repo's convention. An adopting
 * project that starts its board some other way would otherwise be handed
 * advice that does not work, by a message whose entire purpose is to work.
 *
 * `port` is the port this server actually BOUND — `boundPort`, not the
 * requested one, which reads 0 under `PORT=0`. The overlay names it so a
 * reader whose server came back on a different port can see why the page still
 * says nothing is there: a page can only ask its own origin, and a board on
 * another port is genuinely unreachable from here. The client never probes for
 * one — a page that guessed could attach itself to a different project's board.
 *
 * Defaulted so an older server (which sends no such field) yields an overlay
 * that states the silence without inventing a command it was never told.
 */
export const ServerInfoSchema = z.object({
  /** e.g. `pnpm board`. Empty where the server does not know its own. */
  restartCommand: z.string().default(''),
  /** The bound port, or 0 where it is not known. */
  port: z.number().default(0),
});
export type ServerInfo = z.infer<typeof ServerInfoSchema>;

export const BoardSchema = z.object({
  generatedAt: z.string(),
  columns: z.array(ColumnSchema),
  /** See DispatchInfoSchema — a server capability, not plan data. */
  dispatch: DispatchInfoSchema.default({ available: false, reason: '' }),
  /** See ServerInfoSchema — how to start this server again, and where it is. */
  server: ServerInfoSchema.default({ restartCommand: '', port: 0 }),
  /**
   * Whether the server will act on an Approve click, and why not.
   *
   * Its own field rather than a reading of `dispatch`, though the two now give
   * the same answer: both `plot-dispatch.sh` and `plot-approve.sh` ship with
   * Plot, so both ask only whether this is a local, same-origin request. It
   * asked a second question once — whether the project declared an
   * `Approve command` — and that is exactly how two controls on one surface came
   * to disagree about whether the board could act. A separate field keeps the
   * capabilities separable; a client reading one flag about two of them is the
   * shape that hid the divergence.
   *
   * Same shape and same default as `dispatch`: an older server sends nothing,
   * and a newer client then hides the button rather than offering one that 403s.
   */
  approve: DispatchInfoSchema.default({ available: false, reason: '' }),
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
 * What the scan found out about a worker on a branch — `worker_state()`'s five
 * outcomes, plus the case where this machine has nowhere to look.
 *
 * The scan's INTERNAL vocabulary, like `BranchStateSchema`: prose belongs to the
 * row, and a board that parsed a human sentence would break on a reworded one.
 *
 * All five of `worker_state()`'s outcomes are kept apart because collapsing them
 * re-creates the defect this exists to fix — `failed` and `finished` are
 * opposite actions, restart versus review. `elsewhere` is the sixth: no worktree
 * here, so the question cannot be answered rather than answered "no".
 */
export const WorkerStateSchema = z.enum([
  'running', 'finished', 'failed', 'ended', 'none', 'elsewhere',
  // Two TASK states beside the six PROCESS states above, added 2026-08-18.
  // Both arrive where the process exited 0 and the tree says the task did not
  // finish with it — see `worker` below for why the exit code cannot tell.
  'waiting', 'stalled',
]);
export type WorkerState = z.infer<typeof WorkerStateSchema>;

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

/**
 * The note for a branch whose PLAN has not been approved yet.
 *
 * A third thing `not-started` holds, beside "nobody has taken it" and "blocked
 * by an earlier wave" — and the one the row had no word for. Seen live twice:
 * a plan drafted minutes earlier, its plan PR still in CI, and its branches
 * immediately reading *eligible — nobody has taken it*, indistinguishable from
 * work that had been waiting since February.
 *
 * NOT STARTED means *discovered, planned, ready for an agent to pick up* — the
 * hand-off point. A plan still under review has not reached it, and
 * `plot-dispatch` would refuse those branches, so the row was offering an
 * action the tool declines. That is the same mismatch the Start button already
 * avoids by appearing only on eligible rows, which is why this note lives
 * beside `ELIGIBLE_NOTE` and is matched the same way: `isStartable` keys on the
 * eligible sentence, so a row carrying this one loses its button by
 * construction rather than by a second rule that could drift.
 *
 * It names the PHASE rather than merely saying *blocked*, because the reader's
 * next question is *blocked by what*, and the answer here is not another branch
 * — it is a review that has not finished. Naming it also tells them what would
 * unblock it, which "blocked" alone does not.
 */
export const DRAFT_PLAN_NOTE = 'plan not approved yet — still in review';

/**
 * The note for a branch whose PLAN has already shipped or been delivered.
 *
 * The counterpart to `DRAFT_PLAN_NOTE` at the other end of the lifecycle, and
 * it exists for the same reason: a finished plan's branch is `open` in git —
 * bit-identical to a branch nobody has started — whenever the work landed
 * somewhere else. `plot-sprint-support` shipped in v1.0.0-beta.3 and its single
 * branch was never created, because the change went straight onto main.
 *
 * Measured 2026-08-18, after a hygiene sweep set 39 delivered plans to
 * `Released`: **ten Released plans in NOT STARTED at once**, each offering a
 * merged branch as available work. The sweep did not cause that — it multiplied
 * a defect that had been hiding behind a single row.
 *
 * Rows carrying this note belong in `done`, never in `not-started`, so unlike
 * `DRAFT_PLAN_NOTE` this sentence is what a DONE row says about a branch git
 * cannot account for. It names the phase because *why is there no branch* is
 * the reader's next question, and "the work landed elsewhere" is the answer.
 *
 * ONE SENTENCE FOR BOTH ROUTES INTO THE SECTION, and deliberately so. A
 * finished plan's branch reaches NOT STARTED as `open` when git has no ref for
 * it, and as `deferred` when the plan itself shelved it — `plot-sprint-support`
 * is annotated `deferred` and was measured under both readings on the same
 * board. The REASON is identical either way and the sentence already says it:
 * the work landed elsewhere, so no branch was needed. A second constant for the
 * shelved case would split one fact in two and re-open the gap that let
 * `deferred` rows skip the phase check for a wave.
 */
export const FINISHED_PLAN_NOTE = 'plan finished — no branch was needed';

/**
 * The note for a plan whose phase this board has never been taught.
 *
 * The allowlist's fallback, and it says the one honest thing available: the
 * phase is NAMED and the placement is admitted as a guess. A row reading
 * *plan phase `abandoned` — the board cannot place this* sends a reader to the
 * plan; a row silently filed as startable sends an agent to a branch nobody
 * decided on.
 *
 * Names the value verbatim rather than paraphrasing it, so the fix — teaching
 * the board the phase, or fixing a typo in the plan file — is visible from the
 * row itself.
 */
export function unknownPhaseNote(phase: string): string {
  return `plan phase \`${phase}\` — the board cannot place this`;
}

/**
 * WHAT A NOT-STARTED ROW IS WAITING FOR — as a value, never as a sentence.
 *
 * Three answers, and the split is by *what would move this*, which is the
 * question a reader scanning the section is actually asking:
 *
 *   `you`   a person must act — the plan is still Draft, or the branch was
 *           shelved. No clock is running; nothing in git can change it.
 *   `click` eligible and unclaimed. Available, and taking it is optional.
 *   `time`  blocked by an earlier wave. Nothing to do, ever — it resolves
 *           itself when its predecessor lands.
 *
 * THREE, NOT FOUR: deferred joins Draft. Both wait on a person, and they differ
 * only in *which* action — approve versus un-shelve — which the note already
 * says. The field answers the coarse question; the prose answers the fine one.
 *
 * A FIELD RATHER THAN A STRING MATCH, and this is load-bearing. `isStartable`
 * derives startability by comparing `note === ELIGIBLE_NOTE` — the "parser for a
 * format nobody declared" shape #175 removed from the PR cell, which drops its
 * answer silently the moment the wording drifts. Deriving a COLOUR that way
 * would be worse, because this same change sharpens the notes: a rule matching
 * on `blocked by an earlier wave` breaks the moment that sentence gains the
 * wave's name, and it breaks by going quiet rather than by failing.
 *
 * Follows `pr.state` (#165) and `stuck` (#183), both of which replaced exactly
 * this shape for exactly this reason.
 *
 * Null wherever the question does not arise — every row outside `not-started`.
 * A row that is being worked on is not waiting for anything.
 */
export const WaitingOnSchema = z.enum(['you', 'click', 'time']);
export type WaitingOn = z.infer<typeof WaitingOnSchema>;

/**
 * The note for a branch an earlier wave is holding back — without the name.
 *
 * The unnamed form is the FALLBACK, not the default: a plan with no `###`
 * sub-headings has an unnamed wave and this is all that can honestly be said.
 * Where the name exists, `blockedNote` appends it, because *blocked by which
 * one?* is the reader's unavoidable next question and it costs one string.
 *
 * A constant plus a defined append, never a sentence assembled at three call
 * sites: `isStartable` already keys on `ELIGIBLE_NOTE` by string comparison,
 * and that is the shape this plan's own field replaces. Nothing new may be
 * built on matching prose — but the prose must still be one thing rather than
 * many, or the next reader cannot tell which spellings exist.
 */
export const BLOCKED_NOTE = 'blocked by an earlier wave';

/** `blocked by `Truth`` where the wave has a name, the bare sentence where not. */
export function blockedNote(wave: string | null): string {
  return wave ? `blocked by ${wave}` : BLOCKED_NOTE;
}

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
   * A local worktree for this branch is holding `.git/index.lock` — a write is
   * in progress THIS INSTANT.
   *
   * A THIRD signal beside `local_dirty` and `local_ahead`, answering a third
   * question. The three are neighbours and none of them is a flavour of another:
   * *someone is editing*, *finished work nobody else can see*, *a write is
   * happening right now*. Collapsing any pair would be the one-label-two-states
   * defect this story keeps finding.
   *
   * It is the most informative state a worktree can be in, and until #167 it was
   * the one the board could not see. `git status` fails under a lock, the scan
   * skipped the worktree in silence, and the branch answered from refs as if this
   * machine had none — so the row read *claimed, no commits yet* while an agent
   * was committing to it. The branch that looked least active was the busiest.
   *
   * LOCKED IS NOT MISSING. Both fail `git status` with identical empty output;
   * the scan interrogates the failure rather than assuming it, and a worktree
   * that has genuinely vanished still reports nothing at all.
   *
   * STRICTLY ONE-DIRECTIONAL, like its two neighbours: `classify` may only use it
   * to LIFT a branch out of quiet, never to downgrade an answer. False on every
   * machine that holds no worktree for the branch, which is exactly the answer
   * that changes nothing.
   *
   * Defaults to false so a pulse from an older scan still validates: absent and
   * "nothing is being written here" are the same statement, and both mean
   * "answer from refs".
   */
  local_locked: z.boolean().default(false),
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
  /**
   * Commits on the local branch that the remote does not have.
   *
   * The half `local_dirty` cannot answer, by construction: dirtiness reports
   * *someone is editing*, and committing CLEARS it. So the moment a worker
   * finishes tidily and pauses before pushing, the worktree is clean, the flag
   * is false, and the row reads *claimed, no commits yet* for a branch holding a
   * complete implementation — measured on the very branch that fixed the other
   * half, at 3 commits ahead and 0 dirty files.
   *
   * A REF fact, not a worktree fact — the distinction the scan is built on, and
   * the reason it is a separate field rather than a flavour of `local_dirty`.
   * Worktrees share one ref database, so a local branch with NO worktree still
   * holds commits nobody else can see, and this reports them.
   *
   * AHEAD ONLY. Being *behind* is not an invisible state — it is in the remote
   * for anyone to read — so this never speaks about divergence.
   *
   * Like `local_dirty`, strictly ONE-DIRECTIONAL: `classify` may only use it to
   * LIFT a branch out of quiet. 0 on a machine with no local ref for the branch
   * — every detached worker, every teammate's laptop, every CI run — which is
   * exactly the answer that changes nothing.
   *
   * Defaults to 0 so a pulse from an older scan still validates: absent and
   * "nothing unpushed here" are the same statement, and both mean "answer from
   * refs".
   */
  local_ahead: z.number().default(0),
  /**
   * Whether anything is actually RUNNING on this branch.
   *
   * A claim is a push: it says a dispatcher TOOK the branch, and nothing more.
   * Three rows sat in WORKING with a pulsing dot on 2026-08-17 while nobody was
   * working on any of them — the claim was real, the worker was never started.
   *
   * EIGHT VALUES, and every one of them earns its place by naming a different
   * next move:
   *
   * | value       | the reader's move                                 |
   * |-------------|---------------------------------------------------|
   * | `running`   | leave it alone                                    |
   * | `finished`  | review it                                         |
   * | `waiting`   | answer it — a marker in the tree asks a question  |
   * | `stalled`   | resume it — work is on the floor and has no PR    |
   * | `failed`    | restart it — `worker_exit` says how it died       |
   * | `ended`     | read the log; the exit status was not recorded    |
   * | `none`      | a worktree is here, but no pid — look in it       |
   * | `elsewhere` | no worktree here — ask the machine that took it   |
   *
   * `waiting` AND `stalled` SPLIT WHAT `finished` USED TO COVER, and they
   * arrive only where the process exited 0. Measured across seven worktrees in
   * a four-agent fleet run: EVERY worker exited 0 — the one that opened its PR,
   * the one that stopped rather than claim a test run it had not seen, and the
   * one that stopped to ask which retry semantics were wanted. All three read
   * `finished`, whose move is *review it*, and two of the three needed an
   * answer instead. The exit code reports how a process TERMINATED, never
   * whether the task is DONE; only the tree separates them.
   *
   * Their moves are as opposite as `failed` and `finished`: *answer it* sends a
   * person to a question, *resume it* sends a worker back to work. Reporting
   * `waiting` as `stalled` is the worse direction — it invites a restart into
   * the same wait, which is a loop rather than a rescue, and was measured
   * happening twice to one branch — so a marker outranks work on the floor.
   *
   * `failed` and `finished` stay apart because their actions are OPPOSITE —
   * restart versus review — and one label over both sends the reader to a log to
   * find out which. That is the same one-label-two-states shape as `no commits
   * yet` covering both an idle branch and a finished-but-unpushed one.
   *
   * `none` means **unknown, never "nobody"**. `plot-dispatch` writes the pid
   * only where it started the worker itself, so a hand-started worker leaves
   * none — and hand-starting is the normal case for as long as `Worker command`
   * is unset. Five agents were started that way in one session; reading a
   * missing pid as "nobody is working" would report every one of them dead.
   * Absent is not false, the rule this file applies to every other missing
   * signal.
   *
   * `elsewhere` is a THIRD state, not a flavour of the second: the pid lives in
   * the worktree, so a branch claimed on another machine has no path to look at
   * at all. Looking and finding nothing differs from having nowhere to look, and
   * the actions differ with it.
   *
   * Defaults to `elsewhere` so a pulse from an older scan still validates:
   * a scan that reports nothing is a scan that could not look, which is exactly
   * what `elsewhere` says. It licenses no claim about a worker either way.
   */
  worker: WorkerStateSchema.default('elsewhere'),
  /**
   * The worker's pid as the SCAN read it, or "".
   *
   * Carried as a value rather than as something to re-derive, and that is the
   * whole point: `kill -0 0` signals the entire process GROUP and succeeds, so a
   * pid of `0` read naively is alive forever. The scan rejects it exactly as
   * `worker_state()` does and reports `none`, so `0` can never arrive here
   * beside `running`. Re-deriving liveness on this side would spring the trap
   * again.
   *
   * A string, not a number: it is an identifier to show a reader, never
   * arithmetic, and "" is the honest rendering of "no pid was recorded".
   */
  worker_pid: z.string().default(''),
  /**
   * The exit code of a worker that stopped, or "".
   *
   * Present with `failed` (and `"0"` with `finished`); empty with `ended`, which
   * is precisely the state that means *the status was not recorded*. Empty is
   * therefore never read as success — guessing `finished` from an absent record
   * is the one answer that tells a reader to stop looking.
   */
  worker_exit: z.string().default(''),
  /**
   * What a `stalled` worker left on the floor — the uncommitted files by name.
   *
   * NAMES RATHER THAN A COUNT, and the count was the cheaper option. `stalled`
   * exists so a person can decide whether to resume a branch, and "3
   * uncommitted files" does not support that decision: three scratch notes and
   * three half-finished modules read identically. The names make the row
   * actionable without a second command, which is the only reason to report
   * this rather than merely count it.
   *
   * EMPTY ON EVERY OTHER STATE, deliberately. Beside `finished` the same list
   * is whatever leftovers a merged branch happens to hold, and showing it would
   * invite exactly the reading `stalled` was added to prevent. Editor leftovers
   * (`.tmp*`, `.swp`, `.orig`, `.rej`, `.bak`) and Plot's own `.plot-worker.*`
   * records are already excluded upstream — they are not work.
   */
  worker_dirty_paths: z.array(z.string()).default([]),
  /**
   * The files that would collide merging this branch into the default branch.
   *
   * A SET, not a yes/no. `plot-merge-queue.sh` has predicted conflicts since it
   * was written and throws the file list away — the right question for a merge
   * ORDER and the wrong one here: on 2026-08-17 two branches (#176, #177)
   * conflicted in exactly one file, the board artifact, whose resolution is
   * mechanical, while a third needed a person. A boolean cannot tell those
   * apart, and every consumer that wanted to would have had to re-run
   * `merge-tree` itself.
   *
   * Computed by `git merge-tree --write-tree`, which merges ENTIRELY IN MEMORY:
   * no working tree, no index, nothing written. So the conflict is FORESEEN
   * rather than present — nothing here has merged anything.
   *
   * EMPTY MEANS NOTHING ON ITS OWN. Read it only beside `conflicts_known`; the
   * two together are what keep "merges cleanly" and "nobody could ask"
   * distinguishable, and reading this list alone turns every unanswerable branch
   * into a mergeable one.
   *
   * Defaults to [] so a pulse from an older scan still validates — and paired
   * with `conflicts_known`'s own false default, that older pulse says exactly
   * what it knows: nothing.
   */
  conflicts: z.array(z.string()).default([]),
  /**
   * Whether this branch's conflict set was OBSERVED — never whether it is empty.
   *
   * `false` is *not looked at*, and every way of reaching it is the same
   * statement: a git too old for `merge-tree --write-tree` (before 2.38 the
   * command exists and answers a DIFFERENT question, so it succeeds while
   * reporting every branch conflict-free), no ref for the branch, or nothing
   * unlanded to merge — a merged branch, or a bare claim, whose only commit
   * touches no file.
   *
   * Absent is not clean — the rule every other signal in this schema follows,
   * and the one hardest to hold here, because an empty list is the shape both
   * answers arrive in.
   */
  conflicts_known: z.boolean().default(false),
  /**
   * The files this branch changes relative to the default branch, capped.
   *
   * EVIDENCE, never a verdict — one of the three lines a CI failure is reported
   * with (*this branch changes only .md*), so a reader can weigh a failing step
   * against what the branch actually touched.
   *
   * Nothing maps steps to paths, deliberately. That mapping is a table nobody
   * maintains and it goes silently wrong the first time a workflow is
   * restructured; Principle 3 puts the split here — scripts collect and report,
   * humans and skills interpret.
   *
   * Capped by the scan (see `PLOT_CHANGED_PATHS_LIMIT`): two hundred paths tell
   * a reader nothing they can hold in their head, and shipping them through a
   * 5 s poll costs without buying.
   */
  changed_paths: z.array(z.string()).default([]),
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
  /**
   * The LOCAL CHECKOUT, and only ever that — despite the name.
   *
   * `head` is `git rev-parse --short HEAD` in the scan, which is the tree the
   * operator is standing on, NOT the ref the scan read (`origin/<main>`). On
   * `main` after a fetch the two agree, which is why the misnomer survived.
   *
   * Kept because the scan still emits it, and read ONLY as a fallback for
   * `local_head` — never for `read_ref`. Mapping it to the ref that was read is
   * the precise bug this pair of fields exists to end.
   */
  head: z.string(),
  /**
   * The ref the scan actually READ — `origin/<main>`, not the local checkout.
   *
   * Optional because it postdates the scan that emits only `head`: a pulse from
   * an older scan (or a bridge file written by one) must still validate. Absent
   * means THE SCAN DID NOT SAY, which is not the same as "the local head", and
   * the two must never collapse — see `readRef` on `FleetSchema`.
   *
   * The scan reports the string `unknown` when `origin/<main>` cannot be
   * resolved at all (no remote, fresh clone). That is a said-so-explicitly
   * absence rather than a silent one, and it is deliberately NOT rewritten to
   * `HEAD`: substituting the local ref where the read ref is unknown
   * reintroduces the original defect exactly where it is hardest to notice.
   */
  read_ref: z.string().optional(),
  /**
   * The local checkout under its honest name, once the scan distinguishes the
   * two. Optional for the same reason as `read_ref`; `head` is its fallback,
   * because `head` has always carried this value.
   */
  local_head: z.string().optional(),
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
 * One line of `plot-fleet-scan.sh --stream`.
 *
 * The scan takes 18 s on 84 branches and a board that renders nothing for that
 * long looks broken, so the same derivation is emitted as it resolves: one
 * `plan` line per plan the moment that plan is fully derived, then one `pulse`
 * line carrying the identical document `--json` prints whole.
 *
 * The terminal `pulse` line is what says the scan FINISHED. A consumer that has
 * seen plan lines and no pulse line holds a partial answer and must say so —
 * and it cannot infer completion from the pipe closing, because a killed scan
 * closes it too.
 *
 * A discriminated union rather than two optional fields: `kind` is what a
 * reader switches on, and an object carrying neither (or both) should fail to
 * parse rather than be interpreted.
 */
export const FleetScanLineSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('plan'), plan: FleetPlanSchema }),
  z.object({ kind: z.literal('pulse'), pulse: FleetPulseSchema }),
]);
export type FleetScanLine = z.infer<typeof FleetScanLineSchema>;

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

/**
 * The four ways a branch can be unable to MOVE — as distinct from what it IS.
 *
 * `classify` answers *what is this branch*: claimed, eligible, blocked, working.
 * None of its answers can say *this cannot advance without someone doing
 * something*, and on 2026-08-17 five branches got stuck in one afternoon while
 * every one of them read as normal. The sharp case is `unpushed`: from outside,
 * a rebase that stayed local is indistinguishable from an agent that stopped.
 *
 * FOUR VALUES, NOT ONE LABEL. *Stuck* as a single word is the
 * one-label-many-states defect this board keeps removing, and here the four
 * differ in the only way that matters — what happens next:
 *
 * | value              | what it means                                        |
 * |--------------------|------------------------------------------------------|
 * | `artifact-conflict`| the conflict set is EXACTLY the build artifact       |
 * | `conflict`         | a conflict needing judgement                          |
 * | `unpushed`         | commits exist that only this machine can see          |
 * | `ci-failing`       | the host reports a failed check — evidence, no verdict |
 *
 * `artifact-conflict` and `conflict` are not degrees of one thing. The first
 * has a resolution whose correctness a rebuild and a CI no-diff gate can prove
 * without anyone reading a diff; the second does not, and the difference is
 * decided by the conflict SET rather than by which files appear in it.
 */
export const StuckStateSchema = z.enum([
  'artifact-conflict', 'conflict', 'unpushed', 'ci-failing',
]);
export type StuckState = z.infer<typeof StuckStateSchema>;

/**
 * The build artifact whose conflicts resolve mechanically — the ONE path for
 * which `artifact-conflict` may be reported.
 *
 * Named in the contract rather than in the detector because both sides of this
 * plan read it, and a second copy would let the two drift into disagreeing about
 * which file is special.
 *
 * Its resolution is provable rather than conventional, which is what earns it a
 * name at all: `.gitattributes` marks it `-merge`, so git keeps one side whole
 * and writes no conflict markers; `build.mjs` embeds no timestamp and no
 * randomness, so a rebuild's output does not depend on which side was kept; and
 * CI's no-diff gate fails the build if the committed artifact does not match a
 * fresh rebuild.
 */
export const BOARD_ARTIFACT_PATH = 'skills/plot/scripts/board/board-server.mjs';

/**
 * What is stuck about a branch, and the evidence that produced it.
 *
 * EVIDENCE TRAVELS WITH THE STATE, always. A row that says *stuck* and makes the
 * reader go find out why has moved the ten minutes of log-reading rather than
 * removed it — which is the cost this whole detection exists to pay off.
 */
export const StuckSchema = z.object({
  state: StuckStateSchema,
  /**
   * The conflicting paths, for the two conflict states — [] for the other two.
   *
   * Carried verbatim so a reader can check the classification rather than
   * take it: *exactly the artifact* is a claim about a set, and the set is
   * right here to be counted.
   */
  conflicts: z.array(z.string()).default([]),
  /**
   * Commits this machine has that the remote does not — `unpushed` only, 0
   * elsewhere.
   *
   * True ONLY on the machine doing the looking, which is exactly why this is
   * reported and never fixed: pushing someone else's uncommitted judgement is
   * not a mechanical act, and the branch reads 0 everywhere else.
   */
  localAhead: z.number().default(0),
  /**
   * What the branch changes — `ci-failing` only, and EVIDENCE rather than a
   * verdict.
   *
   * The row states the failing check, these paths, and the branch's own recent
   * history; a human concludes. Nothing maps a failing step to a changed path:
   * that table is unmaintained by construction and goes silently wrong the first
   * time a workflow is restructured.
   */
  changedPaths: z.array(z.string()).default([]),
  /**
   * WHICH checks failed, by name — `ci-failing` only, [] elsewhere.
   *
   * The first of the three lines a failing check is reported with, and the one
   * that was already in the payload and thrown away. *CI failed* sends a reader
   * to the Actions tab; *CI failed — step: Install Playwright browser* often
   * ends the investigation there.
   *
   * [] means *no names available* — an older adapter, or a host that carries no
   * rollup — never *nothing failed*. `state` is what says a check failed.
   */
  failingChecks: z.array(z.string()).default([]),
  /**
   * The branch's OWN recent CI runs, newest first — `ci-failing` only.
   *
   * The third line of the evidence, and the one that decided the 2026-08-17
   * case: the `403` was transient, and what proved it was that the same branch
   * had been green two minutes earlier. A real failure presents identically in
   * every other respect, which is exactly why this is reported and not
   * concluded from.
   *
   * NOTHING COMPARES THESE RUNS. The row states them; a human reads three lines
   * and concludes in seconds what took ten minutes of log-reading. Deciding
   * instead would mean a heuristic mapping failing steps to changed paths — a
   * table nobody maintains, which goes silently wrong the first time a workflow
   * is restructured.
   *
   * [] where the host cannot answer (Bitbucket has no run listing) — which
   * renders as *unavailable*, never as *this branch has never failed before*.
   */
  runHistory: z.array(z.object({
    workflow: z.string().default(''),
    /** success · failure · cancelled · in_progress … verbatim from the host. */
    conclusion: z.string().default(''),
    /** ISO 8601, as the host reported it — never reformatted here. */
    startedAt: z.string().default(''),
    url: z.string().default(''),
  })).default([]),
});
export type Stuck = z.infer<typeof StuckSchema>;
export type StuckRun = Stuck['runHistory'][number];

/**
 * What happened, or is happening, on the ONE path this system repairs by itself.
 *
 * **EVERY REPAIR IS REPORTED, and that is what this field exists for.** A silent
 * automatic write is indistinguishable from a defect — which is the exact
 * failure mode the whole stuck-branch plan exists to remove — so a repair says
 * so while it runs AND after it ends, whether it pushed or gave up. A field that
 * only reported successes would be quietest precisely when something went wrong.
 *
 * Null on every other branch and most of the time, like `stuck` above: this
 * describes an event, not a state a branch is in.
 */
export const RepairSchema = z.object({
  branch: z.string(),
  /**
   * `running` while the script holds the worktree; `finished` once it exited.
   *
   * Separate from `outcome` because *a repair is in flight* and *a repair ended
   * without pushing* are different things to tell a reader, and collapsing them
   * would make a five-minute suite look like a failure for its whole duration.
   */
  state: z.enum(['running', 'finished']),
  /**
   * How it ended — "" while running.
   *
   * `pushed` is the only success. `abandoned` means the sequence started and its
   * own gate stopped it (a failed rebuild, a red `test:board`, a rejected push);
   * nothing was pushed and the branch is a conflict a human owns. `refused`
   * means it never started: the set was not exactly the artifact after all, or
   * another repair held the lock.
   */
  outcome: z.enum(['pushed', 'abandoned', 'refused']).or(z.literal('')).default(''),
  /** The script's own word for why — `tests-failed`, `not-artifact-only`, … */
  reason: z.string().default(''),
  /** Epoch ms the repair started, or the moment it ended once finished. */
  at: z.number().default(0),
  /** Where the script's own words are, so the full account is one `cat` away. */
  log: z.string().default(''),
});
export type Repair = z.infer<typeof RepairSchema>;

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
   *
   * `state` and `draft` exist so the PR's condition travels as DATA rather than
   * as a sentence. Before them the row carried only `{ number, url }`, and every
   * other fact about the PR — green, draft, no checks — existed solely inside
   * `note`, assembled by different branches of the server's classifier. That is
   * why one row read `PR #57 green` and the next `PR #116, no checks`: nothing
   * downstream could make them agree, and nothing could render a badge from a
   * sentence without parsing it back apart.
   */
  pr: z.object({
    number: z.number(),
    url: z.string().default(''),
    /**
     * Offered for review, or still the author's — a DIFFERENT question from
     * `state`, and deliberately its own boolean.
     *
     * The two are independent: a draft has CI like anything else, and the
     * server's `draftNote` already says so ("draft, CI running"). Folding it
     * into `state` as a seventh value would destroy an answer the code already
     * produces, and it would rebuild a known defect — the classifier used to
     * short-circuit every draft before the checks were consulted, which is the
     * first of three reasons WAITING ON A MACHINE was never once populated.
     * A single-value state moves that short-circuit out of the classifier and
     * into the contract, where it is harder to see and shared by every consumer.
     */
    draft: z.boolean().default(false),
    /**
     * What the PR is waiting for, as a value.
     *
     * - `green` — every check concluded successfully
     * - `pending` — genuinely queued or running; a machine is the blocker
     * - `failing` — a check failed, or one waits on a human click
     *   (`ACTION_REQUIRED`); see `plot-host.sh` for why those are one value
     * - `none` — the rollup is empty. No workflow ran, and the reason is that a
     *   person has not approved the run
     * - `conflicts` — the branch does not merge cleanly
     * - `unknown` — the host cannot report it (Bitbucket carries no rollup)
     *
     * **`conflicts` outranks `none` where both hold**, because it is the cause
     * and the other its consequence: GitHub starts no workflow for a PR that
     * does not merge, so a conflicting PR ALWAYS also reports an empty rollup.
     * A row saying `no checks` there tells the truth about the symptom and
     * withholds the reason — measured on PR #149 and PR #160, both of which read
     * `no checks` while GitHub said *this branch has conflicts*.
     *
     * Defaults to `unknown` so an older pulse still validates, and because
     * unknown is the honest answer for a payload that predates the field —
     * absent is not clean.
     */
    state: z.enum(['green', 'pending', 'failing', 'none', 'conflicts', 'unknown'])
      .default('unknown'),
  }).nullable().default(null),
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
  /**
   * A local worktree for this branch has uncommitted changes — *someone is
   * editing*.
   *
   * The same fact `FleetBranchSchema.local_dirty` carries, forwarded onto the
   * row unchanged. **Not new data**: the scan has produced it since #167 and
   * `rowsFromPulse` already reads it, but only to hand to `classify()` — after
   * which it was dropped, so no component could see it. A predicate about
   * activity has to run where the row is rendered, and the row is what arrives
   * there.
   *
   * Forwarded rather than re-derived, and that is the point: one scan, one
   * answer. A second reading on this side could disagree with the group the
   * first one produced.
   *
   * **LOCAL, and the marker that reads it must say so.** `fleet.ts` is explicit
   * that this is *"true only on the machine doing the looking, and false is what
   * every branch elsewhere reports"* — an agent on another machine produces no
   * dirty signal here, ever. So false means *not observable from this checkout*,
   * never *nobody is working*.
   *
   * Defaults to false so a pulse from an older server still validates. Absent
   * and "no worktree here" are the same statement — and by `ABSENT IS NOT
   * FALSE`, both leave the row UNMARKED rather than marked clean.
   */
  localDirty: z.boolean().default(false),
  /**
   * A local worktree for this branch is holding `.git/index.lock` — a write is
   * in progress THIS INSTANT.
   *
   * `FleetBranchSchema.local_locked`, forwarded the same way and for the same
   * reason. It is the sharpest signal the board has, it was fought for in
   * `board-survives-its-agents` on the argument that a locked worktree must
   * become its own signal rather than silence — and it landed in the contract
   * and stopped there. Producing a signal and never rendering it is a quieter
   * version of the defect that plan fixed.
   *
   * **It is also the one signal that can go stale before the next poll**, which
   * is why the row's marker echoes a seen lock for a few seconds rather than
   * reading this field alone: `.git/index.lock` lives from a fraction of a
   * second to a few seconds and `FLEET_POLL_MS` is 4 s, so most locks are born
   * and die BETWEEN two pulses. See `ActivityEcho`.
   *
   * Shares `localDirty`'s local-only limit, and defaults to false for the same
   * reason.
   */
  localLocked: z.boolean().default(false),
  /**
   * Commits this checkout holds that its remote does not — FINISHED WORK NOBODY
   * ELSE CAN SEE.
   *
   * Deliberately NOT part of the activity predicate, and the distinction is the
   * whole reason this field is its own: `localDirty` and `localLocked` mean
   * *someone is writing*, and this means the opposite — someone wrote, stopped,
   * and the result never left the machine. A branch nobody has touched for
   * hours can be ahead, and OR-ing this into activity would render that
   * stillness as motion.
   *
   * It is not nothing, either, and this repo has the receipt: on 2026-08-17 a
   * rebase that stayed local read from outside exactly like an agent that had
   * stopped, and cost PR #177 half an hour of dead CI. That is why it earns a
   * mark of its own rather than silence.
   *
   * A COUNT rather than a boolean: `2 commits ahead` and `40 commits ahead` are
   * different situations, and the number is free — the scan already has it.
   *
   * Shares the local-only limit of the two fields above (`fleet.ts:702` — *"true
   * only on the machine doing the looking"*), and defaults to 0 for the same
   * reason the others default to false: absent is not zero, it is unobserved,
   * and an unobserved row is marked nothing rather than marked clean.
   */
  localAhead: z.number().default(0),
  /**
   * What this row is waiting for — see `WaitingOnSchema`.
   *
   * Null outside `not-started`, and null is the honest answer there rather than
   * a fourth value: a row being worked on, or waiting on CI, is not waiting for
   * one of these three things. A consumer that finds null renders no colour.
   *
   * Defaults to null so a pulse from an older server still validates — and such
   * a pulse then renders exactly as the board does today: in words, no colour.
   */
  waitingOn: WaitingOnSchema.nullable().default(null),
  /**
   * The name of the earlier wave blocking this row — `waitingOn: 'time'` only,
   * null everywhere else.
   *
   * *Blocked by which one?* is the reader's unavoidable next question, and the
   * server is the only place that can answer it: `verdict` lives on the WAVE
   * (`FleetWaveSchema`) while the row carries only `wave`, its own name. So a
   * row cannot see that it is blocked, let alone by what — the fact must travel.
   *
   * Null rather than "" for absence, because a wave can legitimately be unnamed
   * (a plan with no `###` sub-headings). The note then reads *blocked by an
   * earlier wave* with no name — the old sentence, and still true.
   */
  blockedBy: z.string().nullable().default(null),
  /**
   * Why this branch cannot move, or null — a fact ADDED to the row, never a
   * replacement for one.
   *
   * `group`, `state` and `note` all answer *what is this branch*; this answers
   * *can it advance*, and they are independent questions. A stuck branch keeps
   * the group it belongs to and gains this beside it — folding stuckness into
   * the group would put a conflicting PR and an unpushed rebase under one
   * heading, which is the one-label-many-states shape this row keeps splitting
   * apart.
   *
   * NULL IS THE COMMON CASE, and deliberately: a branch that is not stuck
   * produces nothing at all. A watcher that flags everything flags nothing, and
   * the whole value of this field is that a populated one is rare enough to
   * look at.
   *
   * Defaults to null so a pulse from an older scan still validates — and null
   * is the honest answer for a payload that predates the detection, which is
   * *nothing was looked for* rather than *nothing was found*.
   */
  stuck: StuckSchema.nullable().default(null),
  /**
   * The automatic repair on this branch, running or recently finished.
   *
   * BESIDE `stuck`, never folded into it. `stuck` says why a branch cannot move
   * and is re-derived from git on every pulse; this says what the machine DID
   * about it, which is an event with a beginning and an end. A branch stays
   * `artifact-conflict` for the whole repair — the refs do not change until the
   * push lands — so a reader with only `stuck` sees nothing happening for five
   * minutes and concludes the pulse ignored it.
   *
   * Null on every branch nothing was attempted on, which is nearly all of them.
   * Defaults to null so an older payload still validates: *nothing was
   * attempted* is the honest reading of a pulse that predates the resolver.
   */
  repair: RepairSchema.nullable().default(null),
  /**
   * What the scan found out about a worker on this branch —
   * `FleetBranchSchema.worker`, forwarded onto the row unchanged.
   *
   * **Not new data**, and that is the whole justification. The scan has
   * produced these eight states since `plot-worker-state.sh` grew them, and
   * `rowsFromPulse` already reads them — but only to hand to `classify()`,
   * after which the value was dropped and survived onto the row solely as
   * PROSE inside `note`. The exact shape `localDirty` and `localLocked` were
   * in before they were forwarded, and it is forwarded here for their reason:
   * a consumer that needs the fact should read the fact.
   *
   * FORWARDED, NEVER RE-DERIVED. One scan, one answer. The pid-of-0 trap
   * (`kill -0 0` signals the whole process group and succeeds) was sprung once
   * by re-deriving liveness, and a structural test now asserts the check exists
   * exactly once, in the shared classifier. This field is a copy of that
   * classifier's verdict travelling outward — not a second opinion about it.
   *
   * A FIELD RATHER THAN A STRING MATCH, which is what `/api/attention` needed
   * and could not honestly have. `note` distinguishes *waiting on an answer*
   * from *stopped with work unfinished* in words only, and this file's standing
   * rule — stated at `ELIGIBLE_NOTE` and again at `waitingOn` — is that nothing
   * new may be built on matching prose: a reworded note does not break such a
   * consumer, it makes it quietly stop classifying. Two of these states
   * (`waiting`, `stalled`) name OPPOSITE moves — answer it versus resume it —
   * so a consumer silently losing the distinction is the precise defect the
   * split was made to end.
   *
   * Defaults to `elsewhere` so a pulse from an older scan still validates, and
   * because `elsewhere` is the honest reading of a payload that predates the
   * field: nobody could look, which licenses no claim about a worker either way.
   */
  worker: WorkerStateSchema.default('elsewhere'),
});
export type AgentRow = z.infer<typeof AgentRowSchema>;

/**
 * What a successful scan LOST relative to the one before it.
 *
 * ## Why a success needs a guard at all
 *
 * The cache already refuses to let a FAILED refresh overwrite a good result,
 * and says why: replacing real state with emptiness because one scan failed is
 * what makes a monitoring view untrustworthy. That rule has an unstated
 * assumption underneath it — *any success is authoritative* — and it is false.
 * A scan can exit 0, emit schema-valid JSON, and describe fewer plans than the
 * scan before it. Measured 2026-08-18: `origin/main` carried three plans, the
 * scan reported two, because it enumerates the working tree rather than the ref
 * it names. Nothing treated the smaller answer as suspicious, so it was cached,
 * rendered, and replaced by the next full one — rows vanishing and returning
 * seconds later, with no error and no staleness marker.
 *
 * ## Why it is carried rather than acted on
 *
 * A smaller pulse is NOT rejected. Plans really do get delivered, and a
 * monitoring view that cannot shrink is a different kind of lie — it would keep
 * a dead row forever. So the new pulse is accepted (it may well be correct) and
 * this rides beside it, letting the tab MARK the view instead of swapping it
 * without comment. *Degrade, do not hide*, the rule the bridge already follows
 * for staleness.
 *
 * Null is the overwhelmingly common case and the only one that renders nothing:
 * a view flagged on every poll is a view nobody reads.
 */
export const PulseShrinkSchema = z.object({
  /**
   * Plan files present in the previous pulse and absent from this one, BY NAME.
   *
   * Identities rather than counts, and the extra set difference is the point.
   * "3 plans became 2" cannot tell an operator whether the plan that vanished is
   * one they just delivered — expected — or one another agent pushed a minute
   * ago, which is the defect. The name answers that at a glance.
   *
   * It also catches a shape counts cannot see: one plan appearing while another
   * disappears leaves the total unchanged, so a count comparison passes it in
   * silence even though a row really did vanish.
   */
  plans: z.array(z.string()),
  /**
   * Branches that were in the previous pulse and are not in this one, by branch
   * name — including branches whose PLAN survived. A plan that keeps its file
   * but loses a wave's branches produces no plan-level difference at all, and
   * that is precisely the reported symptom: WORKING rows for agents that were
   * demonstrably running, gone and then back.
   */
  branches: z.array(z.string()),
  /**
   * Epoch ms of the pulse these were lost FROM — the age of the larger answer,
   * not of this one.
   *
   * The tab needs it to say *how long ago the board knew more*, which is what
   * makes the mark actionable: seconds old is a scan caught mid-rebase, minutes
   * old is a plan that genuinely went away.
   */
  previousAt: z.number(),
});
export type PulseShrink = z.infer<typeof PulseShrinkSchema>;

/**
 * An open tracker issue that no plan references — a signal nobody has decided
 * about yet.
 *
 * NOT AN `AgentRow`, and the distance is the point. Every field on that type
 * describes a BRANCH (its state, its tip age, its PR, the plan governing it),
 * and an issue has none of them: it has not entered the plan lifecycle, which
 * is exactly what the manifesto means by keeping issues as the inbox. Giving it
 * an `AgentRow` with six empty fields would make it a plan in an earlier state,
 * and the four phases would then have a fifth in everything but name.
 *
 * So it is its own small shape, carrying only what a human needs to answer the
 * one question the row exists for — *is this worth a plan?* — and nothing that
 * mirrors tracker state. No labels, no assignee, no status: those age into lies
 * the moment the tracker moves, and Plot never writes them back.
 */
export const IssueRowSchema = z.object({
  number: z.number(),
  title: z.string(),
  /**
   * The tracker address, or "" when the host reported none. The consumer then
   * renders the number as PLAIN TEXT rather than inventing a link — the rule
   * `AgentRow.pr.url` already follows, and for the same reason: a fabricated
   * URL is indistinguishable from a real one until it 404s.
   */
  url: z.string().default(''),
  /** Minutes since the issue was opened, or null when the host gave no date. */
  ageMinutes: z.number().nullable().default(null),
});
export type IssueRow = z.infer<typeof IssueRowSchema>;

/**
 * Whether the tracker could be asked at all — THREE answers, kept apart.
 *
 * - `answered` — the host replied; `issues` is what it said, and an empty array
 *   honestly means there are none unplanned.
 * - `unsupported` — this host has no issue listing (Bitbucket; `bb` exposes
 *   none). Nothing is missing and nothing is broken, so the board renders no
 *   section rather than an empty one implying an empty tracker.
 * - `failed` — the question was asked and did not come back.
 *
 * COLLAPSING ANY TWO REBUILDS `an-outage-is-not-an-answer`. An empty list is a
 * claim about the tracker; a failed lookup is the absence of one, and a board
 * that renders the second as the first tells a reader their inbox is clear
 * using data it never received.
 */
export const IssueAnswerSchema = z.enum(['answered', 'unsupported', 'failed']);
export type IssueAnswer = z.infer<typeof IssueAnswerSchema>;

export const FleetSchema = z.object({
  generatedAt: z.string(),
  /** Seconds since the cached scan completed — the tab shows this. */
  ageSeconds: z.number(),
  /**
   * The commit the cached scan actually READ — the same honesty the tab gets
   * from "scanned 10s ago", for a consumer that cannot see the tab.
   *
   * The gap this closes was measured, not imagined. During a two-agent dispatch
   * on 2026-08-18 an operator read current-looking data while their local
   * `origin/main` was behind other agents' pushes; three wrong diagnoses
   * followed, including "the fleet endpoint is broken". The board was right
   * every time — it simply could not say WHICH WORLD it was right about.
   * `ageSeconds` dates the READ; this names what was read.
   *
   * NULL MEANS THE SCAN DID NOT SAY, and it may never be filled in from
   * `localHead` to avoid a null. Those are different facts, and substituting
   * one for the other is the original defect: a report signed with the name of
   * a commit it did not read. Null before the first scan, and null against a
   * scan predating `read_ref`.
   *
   * The string `unknown` is distinct from null: the scan looked and could not
   * resolve the ref (no remote, fresh clone). Absence of an answer, either way,
   * never reads as a confident one.
   */
  readRef: z.string().nullable().default(null),
  /**
   * How old that read is, in seconds — the age OF THE REF, stated beside it.
   *
   * The same number as `ageSeconds` by construction, because the board caches
   * one scan and both facts come off it. It is named separately rather than
   * left implicit: a consumer reading `readRef` must not have to know that a
   * field named for the tab happens to date it. Null exactly when there is no
   * scan to date — never 0, which would claim a read that just happened.
   */
  readRefAge: z.number().nullable().default(null),
  /**
   * The local checkout, which MAY DIFFER from `readRef` — and when it does,
   * that difference is the whole answer.
   *
   * Reported even when it agrees with `readRef`, because "these two are the
   * same" is a fact a consumer needs stated rather than inferred from one
   * field's absence. Null when no scan has landed.
   */
  localHead: z.string().nullable().default(null),
  /** False until the first scan lands: "not ready yet", never an empty fleet. */
  ready: z.boolean(),
  /**
   * Whether `rows` and `summary` describe EVERY plan the scan found, or only
   * the ones that had resolved when this answer was built.
   *
   * A third state `ready` cannot express, and beside it for the same reason
   * `shrink` sits beside `error`: `ready` asks *has anything arrived*, this
   * asks *has everything*. A scan is 18.3 s on 84 branches against a 5 s
   * cadence, so between the two there is a long window where rows exist and
   * more are coming — and rendering that window as a finished answer is a count
   * of what has been measured presented as a count of what there is.
   *
   * What a consumer must do with `false`: render the rows it has, and render
   * every AGGREGATE — the summary counts, the stuck tally — as not-yet-arrived
   * rather than as the number given. The rows are true; the totals are true
   * about a document that is still being written.
   *
   * Defaults to true so a payload from a server predating the streaming scan
   * still validates, and reads as what that server actually meant: it only ever
   * published whole documents.
   */
  complete: z.boolean().default(true),
  /** Last scan error, if any. A failed refresh never clears a good result. */
  error: z.string().nullable(),
  /**
   * What the most recent SUCCESSFUL scan lost relative to its predecessor.
   *
   * A DIFFERENT condition from `error`, and beside it rather than folded into
   * it, because the two are opposites in the one way that matters: `error` is a
   * scan that failed and whose result was therefore discarded, this is a scan
   * that SUCCEEDED and whose result was accepted. Reporting a shrink as an error
   * would claim the numbers below are the last good ones when they are in fact
   * the new ones.
   *
   * Cleared by the first scan that does not shrink — it describes the last
   * transition, never an accumulated history. A mark that outlived the condition
   * would leave the tab flagged permanently after one blip, which is the same
   * "flags everything, so flags nothing" failure `stuck` avoids by staying null.
   *
   * Defaults to null so a payload from an older server still validates, and null
   * reads as *nothing was compared* — which for that server is true.
   */
  shrink: PulseShrinkSchema.nullable().default(null),
  rows: z.array(AgentRowSchema),
  summary: FleetPulseSchema.shape.summary,
  /**
   * How many branches cannot move, and in which of the four ways.
   *
   * A machine-countable tally beside the rows, the way every scan in this repo
   * ends on one: `plot-fleet-scan.sh`, `plot-merge-queue.sh` and
   * `plot-reconcile-scan.sh` all emit a summary line so a consumer reads it
   * rather than re-counting a body.
   *
   * EVERY STATE NAMED, EVERY ONE PRESENT AT ZERO. `stuck` alone would be the
   * one-label-many-states defect wearing a number — two conflicts and two
   * unpushed rebases are the same count and opposite errands — and a key that
   * disappeared when zero could not be read as zero, only as unknown.
   *
   * DERIVED FROM THE ROWS, never tallied beside the decision that produces
   * them: a counter incremented in parallel with a classification is a second
   * implementation of it, and the two drift the first time a state is added.
   *
   * All zeroes on an older payload, which is also the healthy-fleet answer.
   * That collision is acceptable here and nowhere else in this file: the
   * summary says HOW MANY, and `ready` already says whether anything was
   * looked at.
   */
  stuck: z.object({
    stuck: z.number(),
    artifact: z.number(),
    conflict: z.number(),
    unpushed: z.number(),
    ci: z.number(),
  }).default({ stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 }),
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
  /**
   * Open tracker issues no plan references, for WAITING ON YOU.
   *
   * Beside `rows` rather than inside it — see `IssueRowSchema`. Defaults to []
   * so a client talking to an older server validates; `issueAnswer` is what
   * says whether that emptiness means anything, and a consumer must read the
   * two TOGETHER. [] alone is not "no issues".
   */
  issues: z.array(IssueRowSchema).default([]),
  /**
   * Whether the tracker could be asked. Defaults to `unsupported`, which is the
   * only safe default: an older server sends no issues and no answer, and
   * reading that silence as `answered` would render "your inbox is clear" from
   * a server that was never asked the question.
   */
  issueAnswer: IssueAnswerSchema.default('unsupported'),
  /** The failure, when `issueAnswer` is `failed` — shown, never swallowed. */
  issueError: z.string().nullable().default(null),
});
export type Fleet = z.infer<typeof FleetSchema>;

/* ------------------------------------------------------------------ */
/* /api/attention — what needs doing, and by whom                      */
/* ------------------------------------------------------------------ */

/**
 * WHY a row needs attention — a verdict, which is the one thing `/api/fleet`
 * deliberately does not produce.
 *
 * The read path answers *what is true* and is silent on *what should I do*.
 * That silence is not an oversight — a board for an eye that glances renders
 * facts and lets a person conclude — but it means every consumer assembles the
 * same conclusion by hand from `state`, `group`, `note`, `worker`, `localDirty`
 * and `localAhead`. An operator did exactly that for an afternoon on
 * 2026-08-18, in a shell guard beside the board, and it gathered nothing the
 * board did not already have: its whole value was three lines of judgement.
 *
 * EVERY VERDICT TRACES TO A FACT THE SCAN ALREADY REPORTS, and the `evidence`
 * field below carries the trace so a reader can check the claim rather than
 * take it. A verdict the board guessed is the defect this repo has spent days
 * removing; the rule that prevents it is that this enum can only ever RENAME
 * something already in the payload.
 *
 * | verdict        | traces to                        | the move          |
 * |----------------|----------------------------------|-------------------|
 * | `abandoned`    | `worker: 'failed' \| 'ended'`     | restart it        |
 * | `unfinished`   | `worker: 'stalled'`              | resume it         |
 * | `question`     | `worker: 'waiting'`              | answer it         |
 * | `ci-approval`  | `pr.state: 'none'`               | approve the run   |
 * | `ci-failing`   | `pr.state: 'failing'`            | look at the checks|
 * | `conflict`     | `pr.state: 'conflicts'`          | rebase it         |
 * | `review`       | `worker: 'finished'`, or a green PR | review it      |
 * | `unpushed`     | `stuck.state: 'unpushed'`        | push it           |
 * | `eligible`     | `waitingOn: 'click'`             | claim it          |
 *
 * `abandoned` COVERS `failed` AND `ended` AND NOTHING ELSE. Both mean a process
 * stopped and left nobody working, and both take the same move — restart it —
 * which is the only test that matters for merging two states into one verdict.
 * `stalled` is deliberately NOT among them: its move is *resume*, which sends a
 * worker back to work rather than starting one over, and the guard that
 * conflated them restarted a branch into work it had already done.
 *
 * `question` NEVER READS AS `abandoned`, and this is the verdict the prototype
 * learned the hard way. It restarted one branch twice while its worker waited
 * on an answer it had asked for; the second restart re-ran what the first had
 * finished. Uncommitted files look identical whether a worker walked away or is
 * holding the door open — only a marker IN THE TREE separates them, and the
 * scan is what reads it.
 */
export const AttentionVerdictSchema = z.enum([
  'abandoned',
  'unfinished',
  'question',
  'ci-approval',
  'ci-failing',
  'conflict',
  'review',
  'unpushed',
  'eligible',
]);
export type AttentionVerdict = z.infer<typeof AttentionVerdictSchema>;

/**
 * One thing that needs attention, with the fact that says so.
 *
 * EVIDENCE TRAVELS WITH THE VERDICT — the rule `StuckSchema` states for the
 * same reason. An entry that says *abandoned* and makes the reader go find out
 * why has moved the investigation rather than removed it, and worse, it cannot
 * be audited: a caller has no way to tell a verdict read off the scan from one
 * the endpoint invented. `evidence` names the row field the verdict came from,
 * so the claim is checkable against `/api/fleet` without running anything.
 */
export const AttentionItemSchema = z.object({
  /** The branch this is about, or "" for a PR that no plan's branch list names. */
  branch: z.string().default(''),
  /** Why it needs attention — see `AttentionVerdictSchema`. */
  verdict: AttentionVerdictSchema,
  /**
   * The single move that clears it, in words — *restart it*, *answer it*.
   *
   * PROSE, and prose ONLY, deliberately. `verdict` is the value a consumer
   * branches on; this is the sentence it shows a person. They are separate
   * fields precisely so nobody has to parse the sentence to get the value —
   * the "parser for a format nobody declared" shape this contract keeps
   * removing. A reworded action must never change a caller's behaviour.
   */
  action: z.string(),
  /**
   * The row field this verdict was read from — `worker: failed`, `pr.state:
   * none`. The audit trail, and the whole reason a caller can trust the list.
   */
  evidence: z.string(),
  /**
   * The PR number where one exists, else null.
   *
   * Null rather than 0: a branch with no PR has no number, and 0 is a number.
   * The same rule every absent value in this file follows.
   */
  pr: z.number().nullable().default(null),
  /** The plan file this branch belongs to, or "" for an unplanned PR. */
  planFile: z.string().default(''),
  /** The row's own note, verbatim — the fuller sentence the board renders. */
  note: z.string().default(''),
});
export type AttentionItem = z.infer<typeof AttentionItemSchema>;

/**
 * A branch nobody has taken, with what an agent needs to take it.
 *
 * Its own shape rather than an `AttentionItem`, because it answers a different
 * question. The other three lists say *something went wrong, here is the move*;
 * this one says *here is work, here is where the specification is*. Forcing one
 * shape over both would give every claimable branch an empty `evidence` and a
 * `verdict` that never varies — a field carrying no information is worse than
 * no field.
 */
export const ClaimableSchema = z.object({
  branch: z.string(),
  /** The plan's filename, as `/plan/<file>` wants it. */
  plan: z.string(),
  /** The wave this branch sits in — `(unnamed)` where the plan has no `###`. */
  wave: z.string(),
  /**
   * Where this branch's hand-off brief IS or WOULD BE — a path, always, plus
   * `briefExists` saying which of the two it is.
   *
   * BOTH FIELDS, because a missing brief is the NORMAL case rather than an
   * error. `plot-dispatch.sh` reports `brief=missing` unconditionally and says
   * why: it cannot write one and never will — a brief is interpretation, and
   * `/plot-implement` owns it. So an eligible branch usually has none, and a
   * path alone would be a confident claim about a file that is not there.
   *
   * The path is still worth reporting when the file is absent: it is where the
   * caller should LOOK, and where `/plot-implement` will put it.
   */
  brief: z.string(),
  /** Whether the file at `brief` exists. False is common and is not an error. */
  briefExists: z.boolean().default(false),
  /**
   * How long this has been waiting to be started, in days, or null.
   *
   * `AgentRow.waitingDays` forwarded — a different clock from a branch's tip
   * age, and the one that matters for work nobody has begun. Null where the
   * plan's approval date is unavailable, never 0, which would claim it was
   * approved today.
   */
  waitingDays: z.number().nullable().default(null),
});
export type Claimable = z.infer<typeof ClaimableSchema>;

/**
 * What needs attention right now, split by WHO can clear it.
 *
 * Four lists rather than one, and the split is by actor rather than by
 * severity, because that is the question a caller actually has. An agent asks
 * *what can I pick up* and reads `claimable`; it asks *what did my fleet drop*
 * and reads `needsAgent`. A person asks *what is on me* and reads `needsHuman`
 * and `waiting`. One ranked list would make every caller filter, and they would
 * filter differently.
 *
 * READ-ONLY AND IDEMPOTENT. It NAMES candidates; it reserves nothing and starts
 * nothing. `/api/dispatch` spawns work and is same-origin locked precisely
 * because it does — keeping this endpoint read-only preserves the split this
 * repo rests on, where read-only investigation gates every write, and it leaves
 * the seam where a person can disagree with a verdict. That seam earned its
 * place: the prototype's judgement was wrong twice before it learned about
 * questions.
 */
export const AttentionSchema = z.object({
  generatedAt: z.string(),
  /**
   * FALSE UNTIL THE FIRST SCAN LANDS — and the reason this field exists is that
   * without it a cold cache and a quiet fleet are the same four empty lists.
   *
   * They are opposite facts. *Nothing to do* invites a caller to stop; *nothing
   * has been read yet* invites it to wait and ask again. A caller that cannot
   * tell them apart concludes the first, exits, and the fleet sits still — the
   * failure `2026-08-18-not-yet-asked-is-not-nothing` shipped this same rule
   * for on the board's own rows.
   *
   * `Fleet.ready` verbatim, not a second computation of it.
   */
  ready: z.boolean(),
  /** Seconds since the cached scan completed, or null when none has. */
  ageSeconds: z.number().nullable().default(null),
  /**
   * The commit the scan actually read, or null — `Fleet.readRef` forwarded.
   *
   * WHICH WORLD these verdicts are about. A verdict is a stronger claim than a
   * fact, so it needs the provenance at least as much: *restart this branch* is
   * advice, and advice about a world three pushes old is worse than none.
   * Never filled in from `localHead` to avoid a null — those are different
   * commits, and substituting one is the original defect wave 1 removed.
   */
  readRef: z.string().nullable().default(null),
  /** Last scan error, if any — a failed refresh never clears a good result. */
  error: z.string().nullable().default(null),
  /** Work that stopped and needs a machine put back on it. */
  needsAgent: z.array(AttentionItemSchema).default([]),
  /** Work that cannot move without a person: a click, a look, a review. */
  needsHuman: z.array(AttentionItemSchema).default([]),
  /**
   * Workers holding the door open on an unanswered question.
   *
   * ITS OWN LIST rather than part of `needsHuman`, although a person clears
   * both. The distinction is what it costs to get it wrong: an unanswered
   * question is the one state where the WRONG move — restarting — actively
   * destroys work, by re-running what the worker already finished before it
   * asked. Everything in `needsHuman` merely waits longer if ignored. A list
   * that a caller can see and skip is not the same as one folded into a general
   * pile, and the prototype folded it in twice.
   */
  waiting: z.array(AttentionItemSchema).default([]),
  /** Branches nobody has taken, and where each one's specification is. */
  claimable: z.array(ClaimableSchema).default([]),
});
export type Attention = z.infer<typeof AttentionSchema>;
