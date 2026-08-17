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
   * SIX VALUES, and every one of them earns its place by naming a different
   * next move:
   *
   * | value       | the reader's move                                 |
   * |-------------|---------------------------------------------------|
   * | `running`   | leave it alone                                    |
   * | `finished`  | review it                                         |
   * | `failed`    | restart it — `worker_exit` says how it died       |
   * | `ended`     | read the log; the exit status was not recorded    |
   * | `none`      | a worktree is here, but no pid — look in it       |
   * | `elsewhere` | no worktree here — ask the machine that took it   |
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
});
export type Fleet = z.infer<typeof FleetSchema>;
