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
      /**
       * WHY the branch was deferred — the sentence after the colon in
       * `<!-- deferred: ... -->`, as the plan wrote it.
       *
       * The flag said a branch would not be built and the reason stayed in the
       * plan file, so a row could show `deferred` beside `no commits` and never
       * say the first was the cause of the second.
       *
       * `''` means TWO different things and the flag separates them: not
       * deferred at all, or deferred with nothing recorded (the bare
       * `<!-- deferred -->`). Read `deferred` first.
       *
       * Defaulted, so output from a `plot-plan-meta.sh` predating the field
       * still validates.
       */
      deferred_reason: z.string().default(''),
      claimed: z.string().default(''),
    })).default([]),
  })).default([]),
  prs: z.array(z.number()).default([]),
  /** Plot 2 ceremony fields (absent on pre-Plot-2 plans). */
  review: z.string().default('NONE'),
  impl: z.string().default('NONE'),
  /**
   * The Design transition record as written — a date, who, and what was done.
   *
   * Empty on a plan that never entered Design, which is most of them: Design is
   * an optional phase between Draft and Approved. Defaulted so a plan written
   * before the phase existed still parses. It is the clock the Design column
   * sorts by — an approved plan has an `Approved:` date, but a plan *in* Design
   * has only this one, so `phaseDateOf` reads it rather than `approved_raw`.
   */
  design_raw: z.string().default(''),
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
 * differ from the plan's lifecycle states by asking *who leads* rather than
 * *what has happened*:
 *
 *   Discovery    Draft — the plan is still being found          👤 human-led
 *   Design       Design — a question approval cannot answer     👤 human-led
 *   Development  Approved — handed to an agent, or waiting      🤖 agent-led
 *   Testing      Delivered, not yet Released                    👤 human-led
 *   Released     done
 *
 * Design is a real phase now, not a state the board infers. A plan enters it
 * when it is written but a question stands that approval cannot answer —
 * whether the approach works — and someone runs a spike, a tracer bullet or a
 * spec against reality to find out. It is work performed, not the absence of
 * it. Draft belongs in Discovery: while a plan is under review the work is
 * deciding what the plan should be, and approval is where that ends.
 *
 * `Approved` is Development whether or not a branch has started. An
 * approved-but-unstarted plan is work waiting for an agent — it belongs beside
 * the Start button that offers it, not in Design. The board once forked
 * `approved` on `started` to manufacture the Design column; that fork is gone,
 * because Design now holds design in progress rather than approved work nobody
 * has picked up.
 *
 * Development ends at the MERGE, not at the release: Delivered means the code
 * landed and the agents are done, so what remains is verification and signoff.
 * A column is a partition, so Delivered belongs to Testing alone.
 */
export const BOARD_PHASES = [
  'Discovery', 'Design', 'Development', 'Testing', 'Released',
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
  Testing: { icon: '👤', who: 'human-led' },
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

/**
 * A plan's MEASURED status — the fact its branches make true, beside `phase`,
 * the DECISION a human writes into the file.
 *
 * `phase` and `status` answer two different questions with two different owners,
 * and conflating them is the defect this field exists to end:
 *
 * |            | measurement (`status`) | decision (`phase`)     |
 * |------------|------------------------|------------------------|
 * | written by | nobody — derived       | a human, via a command |
 * | changes    | every scan             | at a lifecycle event   |
 * | storage    | none; re-derived       | recorded in the plan   |
 * | wrong by   | a stale scan           | nobody running the cmd |
 *
 * `status` is DERIVED EVERY SCAN and STORED NOWHERE, exactly like a wave's
 * `verdict`. Storing it would create a second source of truth for something git
 * already answers, and it could go stale — the failure `phase` has and this
 * field exists to compensate for, not to reproduce. Nothing new is written to
 * disk: `plot-plan-meta.sh` is untouched and no plan file gains a field.
 *
 * The seven, and what each is measured from (`planStatus` in `board.ts`):
 *
 * | value         | means                                    | measured from            |
 * |---------------|------------------------------------------|--------------------------|
 * | `draft`       | created; discovery is going on           | phase draft, no plan PR  |
 * | `open`        | discovery done; out for approval         | phase draft, `Review: pr`|
 * | `approved`    | development possible, not started        | phase approved, no start |
 * | `in-progress` | implementation under way                 | ≥1 `Started:` or a claim |
 * | `deliverable` | all waves merged; ready for /plot-deliver| every wave complete, still approved |
 * | `delivered`   | reviewed and /plot-deliver was called    | phase delivered          |
 * | `released`    | released — terminal                      | phase released           |
 *
 * `deliverable` IS THE VALUE THAT EARNS THE FIELD: the measurement has arrived
 * and the decision has not. It is a queue of decisions waiting for a person,
 * and it is what DONE holds and the plan row's `Deliver` action appears on.
 *
 * `reviewing` is DELIBERATELY ABSENT — a branch under review is implementation
 * in flight, and `in-progress` already says so. Naming it would split one answer
 * into two consumers must both handle, and would need a per-branch host call the
 * scan avoids.
 *
 * **`status: deliverable` MUST NEVER SATISFY A GATE.** The release gate reads
 * `phase` and must continue to: a release is a decision, and gating it on a
 * measurement would let work ship that nobody signed off. That `deliverable` and
 * `phase: approved` are independently observable is what keeps a measurement
 * from becoming a commitment.
 */
export const PlanStatusSchema = z.enum([
  'draft', 'open', 'approved', 'in-progress', 'deliverable', 'delivered', 'released',
]);
export type PlanStatus = z.infer<typeof PlanStatusSchema>;

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
   * Whether a dispatcher log exists for this plan — `plot-dispatch-<slug>.log`
   * beside the repo, written the first time anyone clicks Start work on it.
   *
   * A PRESENCE BIT, never the contents: the log's body travels only on demand
   * through `/api/dispatch-log`, and this is one `stat` per card so the row's
   * `...` menu can offer a `Status` entry *whenever a dispatcher log exists* and
   * omit it otherwise. Same discipline as `worktrees` above — the pulse reports
   * that a thing exists and where, never what is in it.
   *
   * Optional and defaulted false: an older server that never looked, and a plan
   * nobody has dispatched, both read as *no log* — which is the honest answer,
   * and the one that leaves the entry off the menu.
   */
  hasDispatchLog: z.boolean().optional(),
  /**
   * Whether this plan is DELIVERABLE — every non-deferred branch merged, and the
   * plan not yet delivered. The affordance signal the Deliver control reads.
   *
   * **A measurement, not a decision.** *Every wave being complete is a
   * measurement; delivering is a decision* (`docs/board-domain-model.md`). This
   * bit says the measurement holds — the code has landed and git can prove it —
   * and nothing more: reaching it flips no phase and writes no `Delivered:`
   * record. Delivering stays a person's click on the control this gates.
   *
   * Set ONLY on a card the server auto-bumped from Development into Testing
   * because `allWavesMerged` held (see `buildBoard`). An already-`delivered`
   * plan also lands in Testing, and it deliberately does NOT carry this — its
   * decision was already made, so the control it would gate must not appear.
   * That asymmetry is the whole reason this is its own bit rather than
   * `phase === 'Testing'`.
   *
   * Optional and absent-when-false, the discipline of `worktrees`/`hasDispatchLog`
   * above: a plan that is not deliverable, and an older server that never looked,
   * both read as *not deliverable* — which leaves the control off either way.
   */
  deliverable: z.boolean().optional(),
  /**
   * The plan's MEASURED status — one of the seven {@link PlanStatus} values,
   * derived every scan from this plan's waves and stored nowhere.
   *
   * The GENERALISATION of `deliverable` above, not a replacement for it. That
   * boolean names one of these seven states (`deliverable`); this names which
   * one the plan is IN, so `deliverable === (status === 'deliverable')` by
   * construction — the Deliver control can read the one word the button's rule
   * needs (*offer Deliver where `status === 'deliverable'`*) instead of a fifth
   * place re-deriving *is this plan done?*.
   *
   * A MEASUREMENT beside `phase`, the plan's DECISION. The two are independently
   * observable on purpose: a `deliverable` plan reports `phase: Testing`-adjacent
   * nothing — its `phase` is still Approved — which is the gap a person acts
   * from and the reason `status: deliverable` must never satisfy a gate.
   *
   * Optional and defaulted, the discipline every derived card field follows: an
   * older server that never computed it, and this field's absence, read the same
   * — `approved` is the honest floor for a card that reached the board at all,
   * since a plan the mapper drops (rejected/unknown) never becomes a card.
   */
  status: PlanStatusSchema.optional(),
  /**
   * The date belonging to THIS card's phase, as `YYYY-MM-DD` — or "" where the
   * plan records none.
   *
   * One field rather than four, and that is the point: a `Released` card is
   * recent by its **release** date and a `Testing` card by its **delivery**
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

/**
 * One plan a sprint names, read from a `- [ ] [slug]` / `- [x] [slug]` line.
 *
 * `tier` is the MoSCoW section the line sits under. `deferred` is carried as a
 * tier of its own — a `### Deferred` item is in the file and is NOT a commitment,
 * so the consumer can exclude it from counts while the list stays faithful.
 *
 * `known` says whether the slug names a plan the board actually found. A sprint
 * can list a plan since renamed or deleted; that member is REPORTED (`known:
 * false`), never dropped, so the sprint's own scope stays knowable. The flag is
 * set by `collectSprints`, which sees the plan estate; `parseSprintFile` reading
 * the file alone cannot tell, so it emits `known: true`.
 */
export const SprintMemberSchema = z.object({
  slug: z.string(),
  tier: z.enum(['must', 'should', 'could', 'deferred']),
  /** `- [x]` vs `- [ ]`. A ticked item is still a member. */
  checked: z.boolean(),
  known: z.boolean().default(true),
});
export type SprintMember = z.infer<typeof SprintMemberSchema>;

export const SprintCardSchema = z.object({
  slug: z.string(),
  title: z.string(),
  phase: z.string(),
  /**
   * The sprint's target release — the `- **Release:** x.y.z` record from its
   * `## Status` section, or "" where the file names none.
   *
   * "" rather than a placeholder, deliberately: the Agents-tab control renders
   * the release beside the sprint's name and reads NOTHING where it is absent,
   * because *"→ —"* is noise and *absent is not false*. Defaults to "" so a
   * sprint file predating a `Release:` line — or a hand-built SprintCard — still
   * validates.
   */
  release: z.string().default(''),
  /**
   * The plans the sprint names, one per distinct slug. A slug sliced across
   * several waves lists once here (first, highest tier wins). Defaults to `[]`
   * so a sprint file with no member list — or a hand-built SprintCard — is valid.
   */
  members: z.array(SprintMemberSchema).default([]),
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
  /**
   * The branch this server is serving the artifact from — the worktree it was
   * started in. With 22+ worktrees on this repo a reader who sees a layout they
   * changed and concludes the fix failed may simply be looking at another
   * branch's artifact; this names which one so the two are told apart.
   *
   * Empty means DETACHED HEAD or unreadable — `git branch --show-current`
   * prints nothing for a detached worktree, several of which exist here. The
   * header renders NO element for the empty value rather than a chip saying
   * `unknown` or a fabricated short SHA: a SHA answers a question nobody asked
   * and reads as a branch name to anyone skimming. Absent (an older server that
   * never sent the field) collapses to the same empty, and to the same silence.
   */
  branch: z.string().default(''),
});
export type ServerInfo = z.infer<typeof ServerInfoSchema>;

export const BoardSchema = z.object({
  generatedAt: z.string(),
  columns: z.array(ColumnSchema),
  /** See DispatchInfoSchema — a server capability, not plan data. */
  dispatch: DispatchInfoSchema.default({ available: false, reason: '' }),
  /** See ServerInfoSchema — how to start this server again, and where it is. */
  server: ServerInfoSchema.default({ restartCommand: '', port: 0, branch: '' }),
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
   * Whether "Continue with an answer" will act — the same binding question
   * `dispatch` and `approve` ask, kept separate for the same reason they are.
   *
   * A CONTINUATION, NOT A REPLY, and the field name follows the control rather
   * than the wish: `claude -p` has no stdin after launch, so the agent that
   * asked is gone and what starts is a new run in its worktree. A field called
   * `reply` would name a channel that does not exist.
   *
   * Same default as the two above: an older server sends nothing and a newer
   * client hides the control rather than offering one that 403s.
   */
  continue: DispatchInfoSchema.default({ available: false, reason: '' }),
  /**
   * Whether "Create plan" will act — the fourth capability, kept apart from the
   * other three for the reason `approve` records at length.
   *
   * **It answers only half the question the control needs**, and that split is
   * deliberate. This field says whether THIS BOARD can act: it is bound to
   * localhost, and creating a plan spawns an agent that writes to the repo.
   * Whether the TRACKER can be asked at all is `Fleet.issueAnswer`, and a host
   * with no issue listing (`unsupported`) or a lookup that broke (`failed`)
   * must offer no action however this flag reads. Neither field implies the
   * other, and a control that consulted one alone would offer a button that
   * cannot work — see `IssueRowView`.
   *
   * Same default as the three above: an older server sends nothing, and a newer
   * client hides the control rather than offering one that 403s.
   */
  idea: DispatchInfoSchema.default({ available: false, reason: '' }),
  /**
   * Whether "Commission design" will act — the fifth capability, and the twin of
   * `idea`: both spawn a plot agent that writes a plan to this disk, so both
   * answer the same localhost binding today. It stays its own field for the
   * reason `approve` records — one flag for two capabilities is how they diverge
   * when a later change makes only one of them local.
   *
   * Commission design is a decision about a Draft plan (the row already names
   * it), so unlike `idea` it needs no tracker; the server checks the plan's own
   * phase before spawning. Same default as the four above, for the same reason:
   * an older server sends nothing and a newer client hides the control rather
   * than offering one that 403s.
   */
  commission: DispatchInfoSchema.default({ available: false, reason: '' }),
  /**
   * Whether "Slice this wave" will act — the sixth capability, twin of `idea`
   * and `commission`: it spawns a plot agent (`/plot-reslice`) that rewrites a
   * plan's `## Branches` on this disk, so it answers the same localhost binding
   * they do. It stays its own field for the reason `approve`/`commission`
   * record — one flag for two capabilities is how they diverge when a later
   * change makes only one of them local. Same default as the five above: an
   * older server sends nothing and a newer client hides the control rather than
   * offering one that 403s.
   */
  reslice: DispatchInfoSchema.default({ available: false, reason: '' }),
  /**
   * Whether "Deliver" will act — the seventh capability, twin of `idea`,
   * `commission` and `reslice`: it spawns a plot agent (`/plot-deliver`) that
   * flips a plan's phase on this disk, so it answers the same localhost binding
   * they do. It stays its own field for the reason `approve`/`commission`/
   * `reslice` record — one flag for two capabilities is how they diverge when a
   * later change makes only one of them local.
   *
   * **It answers only half the question the control needs.** This field says
   * whether THIS BOARD can act; whether a given plan is *deliverable* — every
   * non-deferred branch merged — is `Card.deliverable`, computed per plan from
   * the pulse. A control that consulted this flag alone would offer Deliver on a
   * plan with an open branch, which `/plot-deliver` (and this route) refuses.
   *
   * Same default as the six above: an older server sends nothing and a newer
   * client hides the control rather than offering one that 403s.
   */
  deliver: DispatchInfoSchema.default({ available: false, reason: '' }),
  /**
   * Whether "Implement" will act — the eighth capability, twin of `idea`,
   * `commission`, `reslice` and `deliver`: it spawns a plot agent
   * (`/plot-implement`) that prepares an approved plan on this disk, so it
   * answers the same localhost binding they do. It stays its own field for the
   * reason `approve`/`commission`/`reslice` record — one flag for two
   * capabilities is how they diverge when a later change makes only one of them
   * local.
   *
   * **It answers only half the question the control needs.** This field says
   * whether THIS BOARD can act; whether a given plan has work to start — approved
   * and `waveSummary.eligible > 0` — is `hasEligibleWork`, computed per plan.
   * The control gates on the card first, and reads this flag for its refusal.
   *
   * Same default as the seven above: an older server sends nothing and a newer
   * client hides the control rather than offering one that 403s.
   */
  implement: DispatchInfoSchema.default({ available: false, reason: '' }),
  /**
   * Whether "Drop this agent" will act — the ninth capability, and the simplest
   * of the write routes: it removes a registry manifest from this disk, nothing
   * more. It answers the same localhost binding the eight above do — dropping is
   * a write, and the same boundary applies. It stays its own field for the reason
   * every flag above it records: one flag for two capabilities is how they diverge
   * when a later change makes only one of them local.
   *
   * **It answers only half the question the control needs.** This field says
   * whether THIS BOARD can act; whether a given agent is LIVE — `running` or
   * `waiting` — is checked by the endpoint itself. A row renders no Drop action
   * for a live worker, but the server refuses anyway if the client somehow asks.
   *
   * Same default as the eight above: an older server sends nothing and a newer
   * client hides the control rather than offering one that 403s.
   */
  drop: DispatchInfoSchema.default({ available: false, reason: '' }),
  /**
   * Newest release checklist, for the Testing column: what is left before
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
 *
 * The second parameter (`_started`) no longer changes any answer — an approved
 * plan is Development whether or not a branch has started. It is kept, unread,
 * so that `rowPhase` and the board card compose ONE mapping rather than two that
 * can drift, and so the seam is already in place the day a phase forks on
 * `started` again. Callers pass the real value; this function ignores it.
 */
export function toBoardPhase(helperPhase: string, _started = false): Phase | null {
  switch (helperPhase) {
    case 'draft':
      // Draft IS discovery: a plan under review is the investigation deciding
      // whether there is a commitment at all, and approval is the moment that
      // investigation ends. Mapping it to Design put unfinished designs beside
      // finished ones and left Discovery a column nothing could ever reach.
      return 'Discovery';
    case 'design':
      // Design is now a phase Plot has, not a state the board infers. A plan
      // enters it when it is written but a question stands that approval cannot
      // answer — a spike, a tracer bullet, a spec completed against reality —
      // and leaves toward Approved when the answer holds or back to Draft when
      // it does not. Human-led work someone performs, not the absence of work.
      return 'Design';
    case 'approved':
      // Approved is Development, whether or not a branch has started. An
      // approved-but-unstarted plan is work waiting for an agent — it belongs
      // in Development beside the Start button that offers it, not in Design,
      // whose name means the approach is still open. This is the fork the board
      // used to manufacture the Design column with; removing it is the change.
      return 'Development';
    case 'delivered':
      return 'Testing';
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

/**
 * WHAT KIND OF THING A ROW IS — the seven, and the second slot of the tuple.
 *
 * Every row on this board is one of these, and each answers the same six
 * questions: icon, kind, name, artifact links, status, age. The list is the
 * SHAPE rather than an inventory of what exists today — four of the seven have
 * no row yet (see the table below), and they are named here anyway, because a
 * shape that admits only today's kinds has to be reopened for each new one.
 * That is precisely how this board arrived at three row components and two
 * competing grids.
 *
 * | kind | has a row today | data on the row |
 * |---|---|---|
 * | `ticket` | yes (`IssueRowView`) | yes |
 * | `plan` | yes (`PlanRow`) | yes |
 * | `branch` | yes (`Row`) | yes |
 * | `pr` | a CELL inside a branch row, not a row | yes — 67 of 80 live rows |
 * | `release` | an unmarked branch row | yes, undistinguished |
 * | `build` | none | derivable from the row's checks |
 * | `agent` | none | NO — the registry is not merged |
 *
 * A kind with no data renders NO ROW; it does not render an empty one.
 *
 * ## Why this is a field and not a derivation
 *
 * The alternative — deciding a row's kind in the renderer from `pr`, `issue` or
 * `planFile` — is DECLINED, and the reason is the defect this contract exists
 * to fix. A derivation is a guess with a rule attached, and the rule breaks
 * first where two kinds share fields: **a release is a PR** whose branch is
 * named `changeset-release/main`, so any renderer-side rule must either
 * hardcode that name or misclassify the one row nobody should merge by reflex.
 *
 * The board has already paid for this once. The phase column read a wave name,
 * a plan phase, nothing, or a plan phase on a ticket — four meanings in one
 * column — and it was a derivation, from the plan's wave count. `kind` is set
 * where the row is CREATED, because the server is the only place that knows why
 * the row exists.
 *
 * ## `kind` is what the row is ABOUT, not which object it came from
 *
 * Measured 2026-08-20: of 80 live rows, **67 carry both a branch and a PR** and
 * only 13 a branch alone. So the both-case is the normal case, and `branch` and
 * `pr` are not two kinds of row — they are two ROLES one row can be in. The
 * rule that picks between them:
 *
 *   - a **merge conflict** makes it `branch`, because no PR resolves a conflict
 *     and the reader has to go to the branch;
 *   - anything else with an open PR makes it `pr`, because the fix updates the
 *     PR.
 *
 * This costs the design a simplification, and the loss is worth stating: `kind`
 * is not a property of a thing, it is a JUDGEMENT about a row. The server makes
 * it once, where it holds both facts — which is exactly why it must not be
 * remade in the renderer, where only some of them arrive.
 */
/**
 * `wave` is the eighth, and since 2026-08-21 it is the kind a branch row REACHES
 * FOR FIRST once anything at all is true of it.
 *
 * It began as a client-side grouping — assembled from the branches under a plan,
 * the way `plan` is assembled by `groupByPlan` — and it was ranked last in
 * `rowKind` on the argument that a wave is *"the weakest claim"*, saying only
 * which slice of a plan a branch fell into. That was a mis-classification of the
 * model rather than a mis-ordering within it.
 *
 * **A wave is the process construct that carries a plan forward**, and the
 * published method says so in the words this kind should have been built on.
 * *Ein Team, ein Plan, viele Agenten* (Quatico factsheet, 2026) states the defect
 * directly: *"Pull Request und Branch stehen in dieser Liste an der falschen
 * Stelle: **Sie sind nicht der Gegenstand, sie sind das Vehikel.** … Wer die
 * Zeile mit dem Branchnamen führt, zeigt allen dreien dasselbe Gesicht — und der
 * Mensch muss jedes Mal erst herausfinden, was von ihm verlangt wird."*
 *
 * Its table of what a person waits on names five subjects — ticket, plan, wave,
 * branch-in-flight, release — and for the wave it names the vehicle separately:
 * a wave *"fährt auf einem Branch mit Pull Request und eigenem Worktree auf"*.
 * Subject and vehicle are different columns of that table, and `rowKind` had them
 * in one.
 *
 * Plot's model is `plan → wave → branch`: the wave is what a plan is sliced into,
 * what `plot-dispatch` claims by ref push, what a worktree is created for, and
 * what has to complete before the next wave becomes eligible — *"Eine Welle
 * öffnet erst, wenn jeder Branch aller früheren Wellen gemerged ist."* Work
 * advances one wave at a time. A PR, a CI run, a review and an agent are EVENTS
 * at a branch while its wave is being carried out: each can appear and vanish
 * without the wave changing, and the wave cannot change without the plan's
 * progress changing with it. So the row is about the carrier, and the events are
 * its status, its links and its notes.
 *
 * **The one exception is deliberate and the factsheet argues for it too.** The
 * conflict arm still outranks the wave, because there the vehicle IS the subject:
 * *"Branch in Flug — fährt auf sich selbst — das Vehikel ist das Problem"*, the
 * only row in that table needing no decision about content and still costing a
 * person their attention.
 *
 * That is why `build` and `agent` below no longer have arms in `rowKind`. Both
 * existed to make a row's kind track what a machine or an agent was doing, and a
 * wave row states the same fact without a second kind: *CI is running* and
 * *worked on by X* are things happening to a wave. `build` never rendered outside
 * `mock-fleet.ts`, and `agent` named a branch and printed the branch's state,
 * which its own comment admits *"says nothing about an agent"*.
 *
 * The enum keeps every kind regardless of whether an arm returns it, and the
 * reason is the two `Record<RowKind, …>` tables the tuple keeps: `KIND_LABEL`
 * and `KIND_ICON_PATH`. A kind absent from the enum gets its word and its icon
 * from nowhere and has to invent both at its construction site, which is how a
 * kind ends up rendering a branch's glyph. Being in the enum makes both tables a
 * compile error until they answer for it — a gate rather than a rule.
 */
export const RowKindSchema = z.enum([
  'ticket', 'plan', 'pr', 'build', 'agent', 'branch', 'release', 'wave',
]);
export type RowKind = z.infer<typeof RowKindSchema>;

/**
 * What the server writes where a plan divides its work into no named waves.
 *
 * IN THE CONTRACT because three modules need it and it was defined **twice** —
 * `AgentList.tsx` and `tuple-row.ts` each held a copy, and the server was about
 * to need a third. Three copies of one string is how the kind icons came to
 * disagree; the server writes this value (`fleet.ts`, `wave.name || …`) and both
 * clients test for it, so it belongs where both already import from.
 */
export const UNNAMED_WAVE = '(unnamed)';

/**
 * The wave names that mean a SPIKE — a wave whose product may be a changed plan.
 *
 * ## Why a tracer is a different kind of wave
 *
 * `tracer-bullets` Step 4 states the two outcomes: *"if validating a design,
 * **refine the plan**. If implementing, merge the tracer and build on it."* So a
 * tracer is **pre-planning**: a spike that informs how the plan is sliced, and a
 * failure sends the reader back to the plan rather than to a rebase.
 *
 * An implementation wave carries out a slice a tracer has already de-risked. The
 * two differ in the KIND of outcome, not merely in their order — and the board
 * showed them identically until 2026-08-21: measured, `Tracer` read `green` and
 * `Implementation` read `5 stalled`, with nothing saying which failure means
 * *rethink the plan*.
 *
 * ## Why a name list rather than a contract field
 *
 * `### Tracer` is a documented convention `plot-approve` Step 2b recommends by
 * name — *"Add a `### Tracer` subsection"* — and `plot-plan-meta.sh` already
 * carries the heading through as the wave's name. The signal is free; three plans
 * in this estate use it today.
 *
 * `Spike` is the same idea under the name most teams use. Matching is
 * case-insensitive on the WHOLE name, so `Tracer bullet` and `spike` read as one
 * and `Tracer-adjacent refactor` does not.
 */
export const SPIKE_WAVES = ['tracer', 'spike'] as const;

/** Is this wave a spike — one whose outcome may be a refined plan? */
export function isSpikeWave(wave: string): boolean {
  const w = wave.trim().toLowerCase();
  return SPIKE_WAVES.some((s) => w === s || w === `${s} bullet` || w === `${s} bullets`);
}

/**
 * Is this wave the SOLE wave of its plan — so the plan row carries its status?
 *
 * A plan with exactly one wave renders that wave's status on the plan row
 * rather than nesting a wave row beneath it: the wave adds no information
 * beyond what the plan itself says. The test is `planWaveCount === 1`,
 * evaluated on DECLARED waves (the plan's `### ` headings), not on how many
 * remain unfinished.
 *
 * Measured on this estate: 35 of 54 plans have exactly one wave. Every plan
 * that shipped before the multi-wave convention (2026-03-15) is one-wave by
 * construction, and 19 of the 35 are that vintage. The other 16 are genuinely
 * small plans whose scope never needed slicing.
 *
 * A Wave whose `planWaveCount` defaults (because the server predates this
 * field) answers `false` — show the wave row, the safe reading of unknown.
 */
export function isOneWavePlan(wave: { planWaveCount?: number }): boolean {
  return wave.planWaveCount === 1;
}

export const WaveVerdictSchema = z.enum(['complete', 'eligible', 'blocked']);
export type WaveVerdict = z.infer<typeof WaveVerdictSchema>;

/**
 * WHAT A ROW SAYS ABOUT WHETHER IT CAN BE STARTED — the four verdicts.
 *
 * Introduced by `the-row-says-whether-you-can-start-it`: measured on the live
 * board, 26 rows said `eligible` and 5 could be started. `eligible` answers
 * *has every prior wave landed*, a true answer to a question nobody asked. This
 * answers *can I start this*, with four honest values:
 *
 *   `start-work`           the branch can be started now
 *   `needs-brief`          `/plot-implement` must write a brief first
 *   `waiting-on-approval`  the plan is Draft; approve it or leave it
 *   `someone-is-on-it`     `wip` or `claimed` — not yours to start
 *
 * A MERGED branch carries no startability verdict — finished work is not
 * someone working. `null` rather than a fifth value, since the question does
 * not apply.
 *
 * Derived in `classify`, where the plan phase is in scope. `isStartable` reads
 * the field rather than re-deriving it, so the row and the menu cannot disagree.
 *
 * THE SCAN KEEPS `eligible` and keeps meaning *every prior wave landed*: it is
 * a correct measurement about waves, other components read it, and the fleet's
 * ordering depends on it. What changes is that the ROW stops rendering a
 * wave-ordering fact as though it were an instruction.
 */
export const StartabilityVerdictSchema = z.enum([
  'start-work', 'needs-brief', 'waiting-on-approval', 'someone-is-on-it',
]);
export type StartabilityVerdict = z.infer<typeof StartabilityVerdictSchema>;

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
 * Whether a RUNNING worker's child is actually doing work — the secondary cue
 * that says WHICH kind of running a `running` worker is in.
 *
 * A CUE, NOT A STATE, and that distinction is the whole point. `worker` is the
 * state; this is an attribute of one of its values. `running` is honest and
 * coarse — measured across the fleet 2026-08-25 it covered a worker mid-thought,
 * a worker between waves, and a worker whose child had crashed hours earlier
 * while the loop waited on it, with 11 of 13 workers in that last, worst case.
 * This tells the first from the last WITHOUT promoting `idle` to a sixth
 * `worker` state and WITHOUT touching `AgentStateSchema`, whose five members are
 * pinned by a test: an idle worker with a live child still IS running.
 *
 * `working` when the worker's descendant CPU is advancing, `idle` when its clock
 * is frozen. `''` is the ONLY value beside every state but `running` — the cue
 * answers nothing there, and empty is the one absent-value shape the other
 * worker sibling fields (`worker_exit`, `worker_dirty_paths`) already use.
 *
 * THE DISCRIMINATOR IS THE CHILD'S CPU, NOT THE SHELL'S. The loop shell waits on
 * its child and burns near-zero CPU in every case, so `plot-worker-state.sh`
 * samples the whole descendant tree twice and compares — the growth is the
 * signal. Measured on the process table with no new bookkeeping.
 */
export const WorkerActivitySchema = z.enum(['working', 'idle', '']);
export type WorkerActivity = z.infer<typeof WorkerActivitySchema>;

/**
 * The note the server composes for a branch no earlier wave blocks — the one
 * kind of `not-started` row a person can actually pick up.
 *
 * In the CONTRACT rather than in `fleet.ts`, because both sides read it: the
 * server writes it from the wave verdict, and two copies of it would let a
 * reword turn every startable row into a blocked-looking one. (It cannot live
 * in `fleet.ts`: that module imports `node:child_process`, and the client
 * bundle must not reach it.)
 *
 * THIS SENTENCE IS NO LONGER THE VERDICT'S ONLY CARRIER, and the note above
 * said so as a proposal until `AgentRowSchema.verdict` was built. The row now
 * carries the verdict as data, so the split is a value rather than a phrase —
 * and the Start button already reads `waitingOn` rather than this string.
 *
 * The sentence stays, because it is what a READER hears: *eligible* is a word
 * for a person, and the field is a value for a consumer. What must not come
 * back is a consumer matching this text — `verdict` is what it should read, and
 * anything built on the prose fails by going quiet when the wording drifts.
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
 * USED TO derive startability by comparing `note === ELIGIBLE_NOTE` — the
 * "parser for a format nobody declared" shape #175 removed from the PR cell,
 * which drops its answer silently the moment the wording drifts. It reads this
 * field now, and the prediction that made the case for the field came true in
 * the same change that added it: *blocked by an earlier wave* gained the wave's
 * name, so a rule matching that sentence would have gone quiet rather than
 * failed. Deriving a COLOUR that way would have been worse still.
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
 * WHETHER A BRANCH HAS THE ONE FILE A WORKER IS TOLD TO READ FIRST.
 *
 *   `present` the brief is there. Nothing stands between this branch and a
 *             worker.
 *   `missing` it is not. `/plot-implement` writes it, and until it does a
 *             dispatch starts an agent that reads a file which is not there.
 *   `unknown` the question could not be answered — `.plot/briefs` itself would
 *             not be read, or nobody looked.
 *
 * THREE, AND THE THIRD IS THE POINT. `ClaimableSchema.briefExists` — the same
 * fact, answered for `/api/attention` since #236 — is a BOOLEAN that returns
 * `false` on any error, so *absent* and *could not tell* arrive as one value.
 * That is defensible there: a caller asking *what should I do next* over a
 * filtered set is being handed a path either way, and looking is its next move.
 *
 * It is not defensible on a ROW. A row is read by a person deciding whether to
 * start work, and *no brief — write one first* is a claim about a repository.
 * Made on the strength of an `EACCES`, it sends that person to write a file
 * that already exists. This is the board's own standing rule — stated at
 * `plot-board-probe.sh` for auth (`ok`/`failed`/`unknown`), at `conflicts_known`
 * for an unexamined branch, and at `verdict` for a phase the board cannot place:
 * **an unrecognised answer reads as *cannot verify*, never as the negative.**
 *
 * A FIELD RATHER THAN A SENTENCE, which is this file's other standing rule —
 * see `ELIGIBLE_NOTE` and `waitingOn`. The note says what a reader hears; the
 * field is what a consumer reads.
 */
export const BriefStateSchema = z.enum(['present', 'missing', 'unknown']);
export type BriefState = z.infer<typeof BriefStateSchema>;

/**
 * The note for a branch an earlier wave is holding back — without the name.
 *
 * The unnamed form is the FALLBACK, not the default: a plan with no `###`
 * sub-headings has an unnamed wave and this is all that can honestly be said.
 * Where the name exists, `blockedNote` appends it, because *blocked by which
 * one?* is the reader's unavoidable next question and it costs one string.
 *
 * A constant plus a defined append, never a sentence assembled at three call
 * sites. Nothing new may be built on matching this prose — `verdict` on the row
 * is what a consumer reads, and `blockedBy` carries the name — but the prose
 * must still be one thing rather than many, or the next reader cannot tell
 * which spellings exist.
 *
 * THE COUNT RIDES WITH THE NAME, never without it. *blocked by Fold* answers
 * *which wave*; *— 2 outstanding* answers *how many branches are left in that
 * wave* — and "that wave" is only referable once it is named. So the count
 * decorates the named form and the unnamed fallback stays bare: a dangling
 * *— 2 outstanding* on *blocked by an earlier wave* would attach a number to a
 * wave the reader was never given. The number is the blocker wave's
 * non-deferred, unmerged branch count, matching `plot-fleet-scan.sh`'s own
 * arithmetic; the caller derives it, this only spells it.
 */
export const BLOCKED_NOTE = 'blocked by an earlier wave';

/**
 * `blocked by `Truth` — 2 outstanding` where the wave has a name and a count,
 * `blocked by `Truth`` where the count is absent, the bare sentence where the
 * wave itself is unnamed.
 */
export function blockedNote(wave: string | null, outstanding?: number): string {
  if (!wave) return BLOCKED_NOTE;
  return outstanding === undefined
    ? `blocked by ${wave}`
    : `blocked by ${wave} — ${outstanding} outstanding`;
}

/**
 * The note for a branch whose PR state could not be read from the origin.
 *
 * `unknown` is a GAP, not a state. An origin that could not be asked — a
 * spent GitHub quota, an unreachable Bitbucket, a Jenkins with no credentials
 * — propagates as *the question was not answered*, never as a value a verdict
 * can be computed from. This is the same rule `plot-host.sh` states for its
 * three-outcome issue ops and `plot-board-probe.sh` states for `auth`: being
 * wrong in the reassuring direction is the worst way to be wrong.
 *
 * A row carrying this note belongs in `waiting-on-you`, not `not-started`.
 * The wave verdict is WITHHELD, not negated: git answered and the branch
 * might well be eligible, but the board cannot say so without the host.
 *
 * Unlike `ELIGIBLE_NOTE`, this note does NOT make a row startable. The
 * distinction is a single boolean: a reader seeing this knows the
 * board is degraded, and `/plot-dispatch` would refuse the branch for the
 * same reason the row withholds the verdict.
 *
 * Host-agnostic deliberately — stated for *an origin*, not for the GitHub PR
 * map, so a backend added later inherits it instead of re-deciding.
 */
export const PR_UNKNOWN_NOTE = 'cannot read the PR — the host could not be asked';

export const FleetBranchSchema = z.object({
  branch: z.string(),
  state: BranchStateSchema,
  deferred: z.boolean(),
  /**
   * WHY the branch was deferred, as the plan recorded it — "" where nothing
   * was, and "" on every branch that is not deferred. `deferred` says which.
   *
   * Defaulted, so a pulse from a scan predating the field still validates: an
   * older scan cannot report a reason, and absent is the same answer it gave
   * before the field existed.
   */
  deferred_reason: z.string().default(''),
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
   * Seconds since the newest write in this worktree, or null where none was
   * observed — `changed_ago_seconds` on the wire.
   *
   * THE FIELD THAT MAKES A WRITE AN EVENT. `local_dirty` is a SWITCH: it flips
   * once and stays flipped for as long as anything is uncommitted, so a change
   * detector watching it fires on the first keystroke of a session and never
   * again. Measured on the live board: three modified files, zero flashes in
   * 40 seconds.
   *
   * A timestamp does not have that shape. Every save moves it, so `true → true`
   * is still a change when the number beneath it moved — which is what the
   * reader means by *show me that writing is happening*.
   *
   * The scan has computed this per worktree all along (`changed_ago_of`); the
   * board simply never read it.
   */
  changed_ago_seconds: z.number().nullable().default(null),
  /**
   * The epoch second of that same newest evidence — what a CHANGE detector must
   * watch. `changed_ago_seconds` is recomputed against `now` on every scan, so
   * it moves once a second whether or not anything happened; watching it fires
   * on every pulse forever. This moves only when a commit lands, a file is
   * written, or the worker's log grows. Null wherever the age is null.
   */
  changed_at: z.number().nullable().default(null),
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
   * A local worktree holds this branch AND its tip has not merged — somebody
   * holds it.
   *
   * THE DERIVATION `local_worktree` IS ONE INPUT TO, not a rename of it.
   * `local_worktree` answers *where is this checked out here*; `held` answers
   * *is that checkout evidence the branch is taken*. They diverge on exactly one
   * branch: a CLEAN worktree left on a branch whose work has landed. That is a
   * leftover directory — several exist on any machine that has run a fleet — and
   * reading it as *someone is working here* is the merged-leftover misread that
   * put shipped plans in WORKING. The scan excludes `merged` before it sets this,
   * so a consumer reads one boolean instead of re-deriving `!merged` itself.
   *
   * THE CLAIM REF STAYS PRIMARY. Held is additive and cannot lower an answer:
   * it is the only local signal a detached worker on another host cannot
   * produce, so a branch claimed and worked elsewhere reports `held: false` here
   * and answers from its claim ref exactly as before. Worktree evidence can only
   * move a branch from free to held, never the reverse.
   *
   * NEVER AN INPUT TO WAVE ELIGIBILITY. A wave settles on `merged` alone; a held
   * branch neither completes its own wave nor opens the next. Holding is a fact
   * the board reports, not a state the arithmetic reads.
   *
   * Defaults to false so a pulse from an older scan still validates: absent and
   * "nothing here holds it" are the same statement, and both mean "answer from
   * refs and the claim ref".
   */
  held: z.boolean().default(false),
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
   * THE MOVES ARE WHY THE VALUES ARE SEPARATE, NOT WHAT THE ROW SAYS. This
   * column is the argument for eight values — two states that take one move
   * would not need two names — and it is read here and nowhere else. Two
   * surfaces render from these states and they say different kinds of thing on
   * purpose: `AttentionItem` gives ADVICE (`action: 'restart it'`, beside the
   * `verdict` a consumer branches on and the `evidence` it traces to, which is
   * that endpoint's declared job), while a row's `note` states only what was
   * OBSERVED — an exit code, a stalled marker, a log's location. So *restart
   * it* is right in the first and wrong in the second, and the three broken
   * states (`failed`, `ended`, `stalled`) stopped saying it in notes on
   * 2026-08-20: whether a crash is worth restarting depends on its log and on
   * what else is in flight, neither of which the classifier can see.
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
   * Whether a `running` worker's child is doing work — `working`, `idle`, or "".
   *
   * The secondary cue beside `worker: 'running'`. `running` is honest and coarse
   * — it covers a worker mid-thought and a worker whose child crashed hours ago
   * while the loop waited on it — and this says which, without a sixth `worker`
   * state. Empty on every other state, the same absent-value shape
   * `worker_dirty_paths` above uses beside every state but `stalled`: the cue
   * answers nothing where a worker is not running.
   *
   * Measured, not tracked. `plot-worker-state.sh` samples the worker's whole
   * descendant CPU twice and reports the growth — the loop shell is near-zero
   * CPU in every case, so only the CHILD's clock separates a busy worker from a
   * dead one. Defaults to "" so a pulse from an older scan still validates.
   */
  worker_activity: WorkerActivitySchema.default(''),
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
   * EVIDENCE, never a verdict — one of the three facts a CI failure is reported
   * with (*this branch changes only .md*), so a reader can weigh a failing step
   * against what the branch actually touched.
   *
   * REPORTED, but no longer PRINTED IN THE ROW. Since 2026-08-20 the row states
   * the step and the run history and puts this list behind the `⋯` menu: it is
   * the one of the three that is unbounded and consulted rarely, and six wrapped
   * paths of prose made every reader scroll past it. The field is unchanged and
   * so is the rule — the evidence travels with the state, and the menu is one
   * click on the same pulse, with no fetch.
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
 * way the list is workable top to bottom.
 *
 * "ONLY `working` IS POPULATED, SO WALK AWAY" USED TO BE THE RULE HERE, AND IT
 * NO LONGER HOLDS. A `waiting` agent belongs in `working` — it is an agent, not
 * a result, and the section answers *who is working?* — but what unblocks it is
 * an answer from a person. So a populated `working` section may still hold one
 * row that wants you, and its note is what says so.
 *
 * That is a smaller loss than it reads as, and it is the honest trade. The
 * alternative kept the walk-away rule by filing waiting agents under
 * `waiting-on-you`, where they arrived carrying nothing that section is built
 * to show — no PR, no checks, nothing to inspect on the host — and where every
 * operator counting agents in `working` undercounted the ones that had stopped
 * to ask. A rule that is checkable at a glance is worth less than a section
 * whose membership is true.
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
 * A WAVE the contract carries — the entity `plan → wave → branch` names in the
 * middle, given a place to live for the first time.
 *
 * Until now a wave existed only as ROWS THAT SHARE A STRING: every `AgentRow`
 * carries `wave` (its name) and `verdict`, and anything a wave *has* — its
 * section, its completeness, the branches under it — was re-derived at every
 * call site that asked, from a predicate the asker chose. Measured: 33 call
 * sites reached for `.wave`, and five defects were those derivations
 * disagreeing (`the-wave-is-a-thing-the-board-can-hold`). This is the same move
 * the board already made one level down, when `TupleRow` replaced two row
 * components with one thing that has a `kind`: **the abstraction goes where the
 * repetition is, not into the renderer.**
 *
 * DERIVED ONCE, SERVER-SIDE — `deriveWaves` in `fleet.ts`, where the scan's
 * verdicts already are. The renderer must not recompute any part of it. The
 * same rule `kind` settled: *a derivation is a guess with a rule attached, and
 * the server is the only place that knows why the row exists.*
 *
 * A WAVE HAS A `verdict` AND INHERITS A `phase`; IT NEVER HAS A PHASE OF ITS
 * OWN. Every wave of a plan shares that plan's phase — measured across the
 * estate, zero plans have waves reporting different phases — so a phase on the
 * Wave would be a field that only ever repeats the plan's. It is deliberately
 * absent; read the plan's phase where a wave's phase is wanted.
 */
export const WaveSchema = z.object({
  /**
   * WHICH PLAN this wave belongs to — the plan's basename, exactly as a row
   * carries it in `plan`. Half of a wave's identity: names repeat across plans
   * (`Tracer`, `Implementation`), so `plan` alone does not name a wave and
   * `name` alone does not either. The pair is the id `openWaves` already keys
   * on and `waveKeyOf` already spells; this field is its first half.
   */
  plan: z.string(),
  /**
   * THE WAVE'S NAME — its `### ` heading in the plan file, or `(unnamed)` where
   * the plan divided its work into no named waves. `UNNAMED_WAVE` is the value
   * the server already substitutes on a row (`fleet.ts`, `wave.name || …`), and
   * the same value is carried here so a consumer joining a Wave to its rows
   * reads one spelling from both. A wave with no name is NOT hidden and does not
   * fail — six such waves exist, all in plans predating the naming convention.
   */
  name: z.string(),
  /**
   * THE BRANCHES this wave HOLDS, by name — its contents, whatever each
   * branch's individual state. The containment link, pointing DOWN: a wave has
   * branches, a branch does not have a wave. Zero-or-more, and this is the kind
   * that uses the upper end of that: a five-branch wave lists five.
   *
   * Names rather than whole rows, because the rows already travel in `rows` and
   * a consumer that wants a branch's full state joins on the name. Carrying the
   * row twice would be two copies of one fact, the drift this entity exists to
   * end.
   */
  branches: z.array(z.string()),
  /**
   * THE SCAN'S VERDICT for the wave — `complete | eligible | blocked`,
   * forwarded UNCHANGED from `plot-fleet-scan.sh`. Never re-derived here: the
   * scan aggregated every branch and answered, and this is that answer
   * travelling outward.
   *
   * NULL WHERE THE SCAN REPORTED NONE — a pulse from a scan whose verdict this
   * board does not recognise, the same honest absence `AgentRow.verdict`
   * keeps. Absent is not a guess; a wave with null here has no verdict a
   * consumer may assert.
   */
  verdict: WaveVerdictSchema.nullable(),
  /**
   * THE ONE SECTION this wave belongs in — derived once, here, so no consumer
   * has to pick a predicate and disagree with the next one.
   *
   * A wave whose every non-deferred branch is merged is `done`; otherwise the
   * wave is where its UNFINISHED work is, which for a wave is `not-started` —
   * `the-wave-is-a-thing-the-board-can-hold` settles that a wave never reaches
   * `working` (an agent works, a wave does not) or `waiting-on-machine` (a wave
   * is not a build). This is the wave-level answer; a branch's own `group` is
   * finer and stays on the row.
   *
   * Derived from `complete` below rather than from `verdict`, and the two agree
   * on a healthy fleet — but completeness reads the branch states directly, so
   * a wave with a merged branch and an open one cannot report `done` however
   * its verdict reads. The mixed `Inverted` wave is the case this closes: one
   * merged branch, one open, and the scan still calling the wave unfinished.
   */
  section: WaitingGroupSchema,
  /**
   * WHETHER EVERY NON-DEFERRED BRANCH IS MERGED — the wave's completeness,
   * asked once and answered the same everywhere it is read.
   *
   * A deferred branch is exempt: `plot-deliver` skips deferred branches in its
   * own completeness gate, so `{merged, deferred}` is a complete wave and
   * `{merged, open}` is not. A wave with only deferred branches (nothing to
   * merge) is complete — there is no unfinished work in it.
   *
   * SEPARATE FROM `verdict`, deliberately. `verdict` is the scan's aggregate;
   * this reads the branch states this payload carries. They agree today, and
   * keeping both lets a consumer that has one check it against the other rather
   * than choosing which to trust.
   */
  complete: z.boolean(),
  /**
   * HOW MANY WAVES THE PLAN DECLARES — the count a plan row needs to decide
   * whether to show a separate wave row.
   *
   * A plan with exactly one wave renders that wave's status on the PLAN row
   * rather than nesting a wave row beneath it: the wave adds no information
   * beyond what the plan itself says, and a second row costs vertical space
   * without earning it. The test is `planWaveCount === 1`, evaluated on the
   * DECLARED wave count (the plan's `### ` headings), not on how many remain
   * unfinished.
   *
   * Defaulted so a pulse from a server predating this field still validates:
   * absent means *show every wave row*, and 2 is the minimal count at which
   * every wave row appears. Null would be the honest shape for *unknown*, but
   * a client ternary that read `planWaveCount === 1` would treat `null` as
   * *multi-wave* anyway, and a default of 2 is that same rule spelled once.
   */
  planWaveCount: z.number().default(2),
});
export type Wave = z.infer<typeof WaveSchema>;

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
  // TWO PLANS CLAIM THIS BRANCH — a fifth reason a branch cannot move, and it
  // belongs here for the reason the other four do: nobody can act on it until a
  // person decides. `plot-dispatch` would hand an agent one of two briefs and
  // there is no way to know which, so the branch is stuck in the strict sense.
  //
  // The same shape as `conflict` one level up: that one is *two branches
  // disagree about a file*, this is *two plans disagree about a branch*.
  //
  // Found because the board FLASHED. Two rows for one branch shared a
  // `rowKey` (`repo/branch`, no plan), so each pulse one overwrote the other's
  // remembered `wave`, saw a difference, and lit the change mark — for hours,
  // on a branch nobody had touched. Reported as *"why do always the same two
  // waves flash if no one is changing them"*.
  'double-claimed',
  // A WAVE HOLDING SEVERAL BRANCHES — invalid, and the sixth reason a branch
  // cannot move cleanly.
  //
  // The model, settled with the operator 2026-08-21: a tracer or spike produces a
  // REFINED PLAN; that plan is sliced into waves; and **each wave is carried out
  // in exactly one branch and one worktree**. So `plan → * wave → 1 branch`, and a
  // wave with five branches means the plan was never re-sliced after its spike.
  //
  // Measured on this estate: **49 waves hold one branch, 8 hold more** — and 7 of
  // those 8 are already `complete`, so they shipped before the model was stated.
  // The one unfinished case is `opus5-longhorizon-hardening :: Implementation`:
  // five branches, `blocked`, 26 days, behind a tracer whose PR is green and
  // unmerged. Exactly the failure the tracer exists to prevent.
  //
  // REPORTED, never repaired here. Re-slicing needs NAMES for the new waves, and
  // naming is judgement — so the repair cannot be the licensed deterministic kind
  // (`plot-resolve-artifact.sh`, whose permission *is* judgement's absence) and
  // there is no script to wrap. It is its own plan.
  'unsliced-wave',
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
   * The plans that each claim this branch — two or more on `double-claimed`,
   * empty on every other state.
   *
   * NAMED rather than counted, for the reason `shrinkNote` states about the
   * pulse: *"3 plans became 2 makes the reader open a terminal to find out
   * which"*. Resolving this means editing one of the two plan files, so the row
   * has to say which two.
   */
  claimedBy: z.array(z.string()).default([]),
  /**
   * The sibling branches sharing this branch's wave — two or more on
   * `unsliced-wave`, empty on every other state.
   *
   * NAMED rather than counted, for the reason `claimedBy` states: repairing this
   * means slicing the wave into one per branch, so the row has to say which
   * branches are entangled.
   */
  waveSiblings: z.array(z.string()).default([]),
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
   * The FIRST LINE the row prints for a failing check, and the one that was
   * already in the payload and thrown away. *CI failed* sends a reader
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
   * The SECOND LINE the row prints (the third of the three facts, and the last
   * of the two the row still shows — see `changedPaths`), and the one that
   * decided the 2026-08-17 case: the `403` was transient, and what proved it was that the same branch
   * had been green two minutes earlier. A real failure presents identically in
   * every other respect, which is exactly why this is reported and not
   * concluded from.
   *
   * NOTHING COMPARES THESE RUNS. The row states them; a human reads the evidence
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

/**
 * Where a running process lives: on the git HOST, or on THIS machine.
 *
 * TWO VALUES, because the reader's next move differs and nothing else about the
 * entry does. A `host` process is inspected on the git host — the run page, the
 * check name, someone else's machine doing the work. A `local` process is
 * inspected HERE: its pid is on this box and `ps` will answer for it. One label
 * over both would send a reader to the wrong place, which is the
 * one-label-many-states shape this contract keeps splitting apart.
 *
 * It is also the honesty boundary. A `local` process is observable only on the
 * machine doing the looking — the same rule `localDirty`, `localLocked` and
 * `localAhead` each carry — so a board on another host reports none of them.
 * Naming the origin is what keeps an empty list from reading as *nothing is
 * running anywhere*.
 *
 * `local` HAS NO PRODUCER SINCE 2026-08-20 and is kept anyway. The one writer
 * was `machineProcesses`, pushing an entry for every running worker, and that
 * put agents in WAITING ON A MACHINE — an agent IS the machine, so it is never
 * the thing you wait on. The variant stays because this is a WIRE contract: the
 * board's page is a built artifact a reader may have open across a restart, so
 * an older server can still hand this client a payload carrying one, and a
 * narrowed enum would fail to parse it — trading a stale entry for a blank
 * page. Nothing renders from it: membership is `group` alone (`inMachineSection`).
 */
export const MachineProcessOriginSchema = z.enum(['host', 'local']);
export type MachineProcessOrigin = z.infer<typeof MachineProcessOriginSchema>;

/**
 * One process this board can see running for a branch.
 *
 * A PROCESS IS NOT A HOLDER, and that distinction is the whole reason this
 * exists as its own entity rather than as another field on the row. The board
 * has two sections asking two different questions:
 *
 * | Section              | Lists     | An entry is                |
 * |----------------------|-----------|----------------------------|
 * | WORKING              | agents    | *this agent is on `bug/x`* |
 * | WAITING ON A MACHINE | processes | *CI is running for `bug/x`* |
 *
 * One row per branch cannot express both, and two measured cases prove it. An
 * agent that exited cleanly while its checks still ran belonged to NEITHER
 * section under a holder-keyed rule — no agent held it, and its checks had not
 * landed. An agent watching its own CI belongs to BOTH, and a single `group`
 * must pick one and be wrong about the other. The same branch appearing twice
 * is not duplication: the entities differ, and each entry names its branch so
 * two rows never read as one repeated.
 *
 * EVIDENCE, NEVER A FORECAST. `evidence` says what was OBSERVED — *a test run
 * is in progress here* — and no field carries a remaining time, because nothing
 * measures when a local run ends. A countdown nobody can honour is the shape
 * this repo removes rather than adds, and Principle 3 puts the conclusion with
 * the human: the scan collects, the reader decides whether to wait.
 */
export const MachineProcessSchema = z.object({
  origin: MachineProcessOriginSchema,
  /**
   * What was observed, as a sentence — the row's own words for this process.
   *
   * A SENTENCE BESIDE A VALUE, not instead of one. `origin` is what a consumer
   * branches on; this is what a person reads, and it exists because *a machine
   * is working* is useless without saying WHICH machine and on what. Composed
   * where the facts are, never parsed by anyone — the standing rule at
   * `ELIGIBLE_NOTE`: nothing new may be built on matching prose.
   */
  evidence: z.string().default(''),
  /**
   * The pid, for a `local` process — "" for a host one, which has none here.
   *
   * Carried so a reader can go LOOK rather than take the row's word for it, the
   * same standing `worker_pid` has. Never re-derived on the far side: `kill -0
   * 0` signals the whole process group and succeeds, so liveness is decided once
   * in the shared classifier and this value only ever renders.
   */
  pid: z.string().default(''),
});
export type MachineProcess = z.infer<typeof MachineProcessSchema>;

/**
 * The branch a `changeset-release` PR rides on — the ONE name this repo matches.
 *
 * IN THE CONTRACT because both sides ask the question: the server derives a
 * row's `kind`, and the client's `isReleaseBranch` asks the same thing of the
 * same string. `fleet.ts` states the rule this obeys — the name is matched in
 * exactly one place, and *"a second copy on the client would be the defect"*.
 * A shared constant is how that holds without the client importing server code.
 */
export const RELEASE_BRANCH = /^changeset-release\//;

export const AgentRowSchema = z.object({
  /** Constant today. Present so the second repo is an addition, not a rebuild. */
  repo: z.string(),
  /**
   * WHAT THIS ROW IS — see {@link RowKindSchema} for the seven and for why this
   * is a field rather than something the renderer works out.
   *
   * Set by the server at every site that creates a row, and read by the tuple
   * row as slot 2. It ends two defects in one move: the phase column that read
   * four different sorts of word depending on the plan's wave count, and the
   * hover-only tooltip that was the only place a row said what kind of thing it
   * was. A label the reader can see, stated once.
   *
   * Defaults to `branch` so a pulse from an older server still validates — and
   * `branch` rather than a nullable, because every row this board has ever
   * emitted from a pulse IS a branch row: the default is the truth about the
   * payloads that predate the field, not a placeholder standing in for one.
   */
  kind: RowKindSchema.default('branch'),
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
  /**
   * The ACTIVE SPRINT whose member list names this row's plan — its slug — or ""
   * where no active sprint lists it. `""` covers three cases at once: a row with
   * no plan (`planFile: ''` — a release row, an unplanned PR), a plan no active
   * sprint commits to, and every pulse that predates this field.
   *
   * MEMBERSHIP IS THE SPRINT FILE'S, not the plan's `Sprint:` field. A sprint
   * lists its plans as `- [ ] [slug]` lines (see {@link SprintMemberSchema}), and
   * that list is complete by construction — a person edits it when they commit.
   * The plan's own `Sprint:` field is a back-reference, allowed to be stale: on
   * this estate 19 plans are listed and only 5 carry the field, so joining on the
   * field would show a third of the commitment and silently hide the rest.
   *
   * SET WHERE THE ROW IS CREATED, in the server, by joining the row's plan slug
   * to that member list — never derived in the renderer from `planFile`. `kind`
   * learned this lesson in this same file: a derivation is a guess with a rule
   * attached, and it goes wrong first on the rows that have no plan. The client
   * reads the value; it does not compute it.
   *
   * ONE SLUG, not a list: where two sprints are Active and both list a plan, the
   * FIRST active sprint wins — deterministic, matching the first-wins dedup the
   * member list itself uses. The filter that renders one control per active
   * sprint is a later wave's concern; this field only records which sprint claims
   * the row.
   *
   * A VIEW, never a fetch: this field exists so the client can HIDE out-of-sprint
   * rows. It does not narrow what the pulse collects — the server fetches every
   * plan once and the cache is shared across consumers.
   */
  sprint: z.string().default(''),
  /**
   * The version a RELEASE row is about — `2.7.0` — or "" on every other row.
   *
   * **Read from `package.json` on the release branch, never derived.** That
   * distinction is the whole licence for this field. `releaseVersion` used to
   * refuse the question, and its reason was exact: *"deriving 2.7.0 from a
   * changeset file would mean reading and summing pending bumps, which is what
   * would this ship — the question the plan explicitly refuses to answer on a
   * board."*
   *
   * On a `changeset-release/*` branch that sum is **already computed**:
   * changesets has consumed the `.changeset/*.md` files and written the new
   * version into `package.json` on that branch. Verified 2026-08-20 —
   * `origin/changeset-release/main:package.json` reads `2.7.0` where `main`
   * reads `2.6.0`. Reading a file the release tool wrote is reading a FACT; the
   * refusal stands against the board computing what a release would contain.
   *
   * "" where the file cannot be read — an unreadable ref, a repo whose root
   * package carries no version — and the row then names its PR number, which is
   * the honest fallback rather than an invented tag.
   */
  version: z.string().default(''),
  wave: z.string(),
  state: BranchStateSchema,
  /**
   * WHY this branch was deferred, where the plan recorded a reason.
   *
   * `state: 'deferred'` says the branch will not be built; this says what
   * decided that. The two arrived separately: the plan file has carried the
   * sentence since April (`never created — the work landed directly on main`)
   * while `plot-plan-meta.sh` tested only for the annotation's PRESENCE, so the
   * board could put `deferred` beside `no commits` and never say the first was
   * the reason for the second. A reader with no access to the plan file saw a
   * branch nobody had started and no statement that nobody should.
   *
   * "" on every row that is not deferred, and "" on a deferred row whose plan
   * recorded no reason — read `state` to tell those apart. Defaulted so an
   * older pulse still validates.
   */
  deferredReason: z.string().default(''),
  /**
   * Which board phase this ROW is in — derived from the PAIR (the plan's phase
   * and this branch's git state), never from the plan file alone.
   *
   * Derived from the PAIR because the two sources still disagree in the cases
   * that remain — a `deferred` branch reads from the plan phase, not its
   * commits, and a late commit under a `delivered` plan does not pull the row
   * back. (The `opus5-longhorizon-hardening` shape that first motivated this —
   * `Phase: Approved`, zero `Started:` records, real commits — no longer
   * diverges: approved is Development on both surfaces now that Design is its
   * own phase.)
   *
   * See `rowPhase` for the mapping and for the places the two sources disagree
   * deliberately. null where no phase can honestly be named — a plan whose
   * phase is rejected, superseded or simply unknown — and the cell then renders
   * empty rather than guessing a column.
   */
  phase: z.enum(BOARD_PHASES).nullable().default(null),
  group: WaitingGroupSchema,
  /** Minutes since the branch tip, or null when there is no branch yet. */
  ageMinutes: z.number().nullable(),
  note: z.string(),
  /**
   * The PR for this branch, if the host reported one — IN ANY STATE. `url` may
   * be "" even when `number` is set — an older host CLI reports no address — and
   * the row then shows the number without a link rather than inventing one.
   *
   * **MERGED AND CLOSED PRs ARE CARRIED HERE, and that is deliberate.** This
   * read *the open PR* until 2026-08-20, and the narrowing was not a decision
   * about the contract so much as a leak from the server's cache: `prs` is
   * OPEN-only so that a merged PR never reaches `classify` and reopens a
   * question the merge closed, and the same map was also deciding the row's
   * link. Measured on this repo — #252, #253 and #254 were `MERGED` with real
   * URLs and deleted refs, and all three reached the row as `null` while the
   * plan name beside them was a link and the branch name was inert text.
   *
   * **A PR OUTLIVES ITS BRANCH.** That is the whole reason the field cannot be
   * open-only: the row a reader most wants to follow is the finished one whose
   * ref is gone, because the PR page is the only remaining record of it. See
   * `prOutranks` in `fleet.ts` for which PR a head with several of them yields.
   *
   * `state` is therefore `unknown` on a merged row — GitHub stops computing
   * mergeability once a branch lands — and consumers must not read that as an
   * outage. `hostCannotReportCi` excludes merged rows for exactly this reason:
   * a finished PR has no live condition to report, which is not the same claim
   * as a host that cannot report one.
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
     * **THIS FIELD IS THE WINNER OF `states`, AND STAYS.** It answers the
     * question most of its consumers actually ask — *the one thing this row
     * waits for* — and every one of them was audited before `states` was added
     * beside it rather than in place of it. What changed is that the losing
     * facts are no longer destroyed to produce it: see `states`.
     *
     * Defaults to `unknown` so an older pulse still validates, and because
     * unknown is the honest answer for a payload that predates the field —
     * absent is not clean.
     */
    // `closed` is the seventh, and it is not a check result — it is the PR's own
    // standing, which outranks every check. A closed PR is ABANDONED work, and
    // reporting `green` about it says *ready* where the truth is *given up*.
    //
    // Measured 2026-08-21: PRs #51-#55, closed as drafts 26 days earlier, all
    // rendered `green` + `draft`, so the board read *five reviews are waiting on
    // you* about a wave somebody deliberately dropped. They reach a row because
    // `prsByHead` keeps finished PRs on purpose — right about the LINK, and it
    // was silently deciding the STATUS too.
    state: z.enum(['green', 'pending', 'failing', 'none', 'conflicts', 'unknown', 'closed'])
      .default('unknown'),
    /**
     * EVERYTHING the PR is waiting for — a SET, because a PR can be waiting for
     * two things at once and `state` can only name one.
     *
     * The measured loss: a PR that both conflicts and has a failed check reads
     * `conflicts` and NOTHING SAYS THE BUILD FAILED. `state`'s own comment
     * documents the precedence as deliberate, and it is — for a single value.
     * The precedence was never the defect; producing it by *discarding* the
     * loser was. This field keeps both facts and lets each consumer decide
     * which it needs, which is the one-observable-two-causes shape this estate
     * keeps finding and removing.
     *
     * ORDERED BY PRECEDENCE, most-blocking first, so `states[0] === state` on
     * every row. That is asserted by a test rather than left as a convention:
     * two fields deriving one answer separately is exactly how a row's word and
     * its sentence come to disagree, and the contract already records that
     * failure twice (`classify` mirrors `prState`, and both say so).
     *
     * A row's SUBJECT is read from this, not from `state` — a conflict is
     * branch work and a failing check is PR work, so a PR carrying both leads
     * with the branch and names the build failure separately. That rule needs
     * both facts present to be expressible at all.
     *
     * `unknown` and `green` are ALWAYS ALONE. Neither composes with anything:
     * `unknown` means the host could not answer, so a second entry beside it
     * would claim knowledge the row does not have, and `green` means nothing is
     * outstanding, which is the absence of the other values rather than a peer
     * of them. Only the errands compose.
     *
     * Defaults to `[]` so an older pulse still validates. Empty is NOT a
     * seventh meaning — it is a payload that predates the field, and a consumer
     * that finds it empty must fall back to `state`, whose default (`unknown`)
     * is the honest answer there.
     */
    states: z.array(z.enum(['green', 'pending', 'failing', 'none', 'conflicts', 'unknown', 'closed']))
      .default([]),
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
  /** Seconds since the newest write in this row's worktree — see
      `changed_ago_seconds`. Null where no write was observed.
      FOR DISPLAY ONLY: it is recomputed against `now` every scan, so it moves
      once a second whether or not anything happened. A change DETECTOR must
      watch {@link AgentRow.changedAt} instead. */
  changedAgo: z.number().nullable().default(null),
  /** The epoch second of that same newest write — stable between pulses, moving
      only when a commit lands, a file is written, or the worker's log grows.
      This is the field a change detector watches; see `changedAgo` for why the
      age cannot be. Null wherever the age is null. */
  changedAt: z.number().nullable().default(null),
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
   * WHETHER THIS BRANCH HAS ITS BRIEF — see `BriefStateSchema`.
   *
   * The fact the row was missing, and the one that decides whether *eligible*
   * can be acted on. `waitingOn: 'click'` above says the WAVE ordering is
   * satisfied; this says whether the branch has the specification a worker is
   * told to read first. Both are true of a startable branch and only the first
   * was ever reported, so nine rows read *eligible — nobody has taken it* on
   * 2026-08-19 and not one of them could be started.
   *
   * ALREADY MEASURED ELSEWHERE, AND THAT IS THE DEFECT RATHER THAN THE FIX.
   * `ClaimableSchema.briefExists` has answered this for `/api/attention` since
   * #236 — so an agent asking the API was told and a person reading the row was
   * not, because the two answers are built by different code from one repo.
   * This closes that, and closes it as a THIRD reader of the convention rather
   * than by importing `attention.ts`: see `briefState` in `fleet.ts` for why,
   * and `continue.ts`'s `briefPathFor`, which made the same choice first.
   *
   * `unknown` IS THE DEFAULT, and the choice is the opposite of `localDirty`'s.
   * There, absent and false are one statement — a machine with no worktree
   * honestly reports nothing. Here they are not: a server that never looked has
   * said nothing about the repository, while `missing` is a claim that would
   * send a reader to write a file. A pulse from a server predating this field
   * therefore renders as it always did — the note, with nothing added.
   *
   * ON EVERY ROW, not only the startable ones. The question *does this branch
   * have its brief* has an answer whatever the branch is doing, and scoping the
   * field to `not-started` would make a row's own history unreadable the moment
   * it moved. The RENDERER decides where saying so helps; see `AgentList.tsx`.
   */
  brief: BriefStateSchema.default('unknown'),
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
   * The verdict of the WAVE this row sits in — `complete`, `eligible` or
   * `blocked`, forwarded from `FleetWaveSchema.verdict`.
   *
   * THE SAME THREE VALUES, and reusing `WaveVerdictSchema` is the decision
   * rather than the default. A row does not classify itself here: it repeats
   * what the scan already decided about its wave, so a fourth value would have
   * to mean something the scan cannot say. The row's OWN questions are answered
   * by fields that already exist — `state` for its git shape, `group` for its
   * section, `waitingOn` for what would move it — and a second three-value enum
   * meaning almost the same thing is the drift this field exists to prevent.
   *
   * A FIELD RATHER THAN A STRING MATCH — the shape `ELIGIBLE_NOTE` proposed
   * above and declined to build, and the same argument `worker`, `waitingOn`
   * and `pr.state` each settled before it. Until this field existed the wave's
   * verdict survived onto the row only as PROSE: `ELIGIBLE_NOTE` for eligible,
   * `blockedNote()` for blocked, and NOTHING for complete — a `complete` wave's
   * merged branch says *merged*, which is true of the branch and silent about
   * the wave. So a consumer wanting the verdict had two sentences to match and
   * one case it could not reach at all.
   *
   * FORWARDED, NEVER RE-DERIVED, like its neighbours. `classify` returns it
   * beside the note it composed from the same input, so the field and the
   * sentence cannot disagree — which is the entire point of having both, and
   * what the tests assert as a pair.
   *
   * NULL WHERE THERE IS NO WAVE, which is two cases and both are honest
   * absences rather than defaults:
   *
   *   - a planless row (built from the PR map) belongs to no plan, so no wave
   *     has a verdict about it;
   *   - a pulse from a scan whose verdict this board does not recognise. ""
   *     and an unknown word are not the three values, and guessing one would
   *     put a confident claim where nothing was reported. Same rule as
   *     `planPhase` in `classify`: absent is not a guess.
   *
   * Defaults to null so a client talking to an older server still validates,
   * and null renders as nothing — exactly as the board reads today.
   */
  verdict: WaveVerdictSchema.nullable().default(null),
  /**
   * WHETHER THIS ROW CAN BE STARTED — see `StartabilityVerdictSchema`.
   *
   * Computed in `classify`, where the plan phase is in scope. Four verdicts:
   *
   *   `start-work`           the branch can be started now
   *   `needs-brief`          `/plot-implement` must write a brief first
   *   `waiting-on-approval`  the plan is Draft; approve it or leave it
   *   `someone-is-on-it`     `wip` or `claimed` — not yours to start
   *
   * NULL where the question does not apply: a MERGED branch has no startability
   * verdict — finished work is not someone working — and a row outside
   * `not-started` is already past the question. Also null where an older server
   * never computed it, so the client defaults gracefully.
   *
   * THE ROW RENDERS THIS, NOT `eligible`. `eligible` answers *has every prior
   * wave landed*, which is true on 26 rows and actionable on 5. This answers
   * *can I start this*, and every value is either actionable or explicitly
   * closes the question.
   *
   * `isStartable` READS THIS FIELD rather than re-deriving it, so the row and
   * the menu cannot disagree — the promise/refusal mismatch this field exists
   * to end.
   *
   * Defaults to null so a client talking to an older server still validates,
   * and null renders NO startability word at all — not a fallback to `eligible`,
   * which is the word this plan exists to remove.
   */
  startability: StartabilityVerdictSchema.nullable().default(null),
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
  /**
   * Whether a `running` worker's child is doing work — `FleetBranchSchema.
   * worker_activity`, forwarded onto the row unchanged.
   *
   * The secondary cue beside `worker`. `workerStatus` reads it to say WHICH kind
   * of running a `running` worker is in — a child mid-work reads differently
   * from one whose clock is frozen — without a sixth `worker` state and without
   * touching the registry's five-member `AgentStateSchema`. Empty on every state
   * but `running`, where it answers nothing: the same absent-value shape the
   * other worker fields use. Forwarded, never re-derived — the scan measured it
   * once, and this carries that verdict outward.
   */
  worker_activity: WorkerActivitySchema.default(''),
  /**
   * The processes this board can see running for this branch — [] when it can
   * see none.
   *
   * A SECOND ENTITY ON THE ROW, and the row is the only place to put it: the
   * pulse is keyed by branch, so a process is discovered while a branch is being
   * read and has no carrier of its own. What travels here is the PROCESS entity
   * the WAITING ON A MACHINE section lists, alongside the AGENT entity `group`
   * and `worker` describe — the two the board had folded into one placement.
   *
   * IT DOES NOT DECIDE THE SECTION, and that is deliberate. `group` still says
   * where the branch's own row goes, unchanged; this says which processes the
   * machine section additionally lists. A row can therefore be in WORKING and
   * have a process in WAITING ON A MACHINE at once — the agent-watching-its-own-CI
   * case — without either field contradicting the other, because they answer
   * different questions. Folding process liveness into `group` is what made that
   * case a coin toss.
   *
   * DERIVED, NEVER COLLECTED ANEW. Every entry is composed from facts the pulse
   * already carries — `worker`/`worker_pid` for a local run, `pr.checks` for a
   * host one — so this field adds no scan cost and cannot disagree with the
   * fields it reads. The same rule `worker` itself follows: forwarded, not
   * re-derived.
   *
   * EMPTY MEANS *NONE OBSERVED*, which for `local` entries is only ever a claim
   * about THIS machine. A branch whose worker runs on another host reports none
   * here, exactly as `localDirty` reports false — absent is not false, and the
   * `origin` field is what lets a reader tell the two apart.
   *
   * Defaults to [] so a client talking to an older server still validates, and
   * because [] is the honest reading of a payload that predates the field:
   * nothing was looked for.
   */
  processes: z.array(MachineProcessSchema).default([]),
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
  /**
   * `ticket`, always — and stated rather than assumed, for the same reason
   * `AgentRow.kind` is a field: the tuple row reads slot 2 from the data, and a
   * renderer that knew "this array holds tickets" would be deriving the kind
   * from its call site. One constant here costs nothing and keeps every one of
   * the seven kinds arriving the same way.
   *
   * A literal rather than the full enum: an issue cannot honestly be any other
   * kind, and a wider type here would invite a caller to say so.
   */
  kind: z.literal('ticket').default('ticket'),
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

/**
 * How the registry answers *is this agent still running?* — one fact per pulse.
 *
 * The first four are exactly the states `plot-worker-state.sh` distinguishes,
 * carried onto the entry unchanged: `running` where the pid answers `kill -0`,
 * `finished` where it is gone and the work reached review or left nothing
 * behind, `waiting` where a `PLOT-BLOCKED:` marker sits in the tree, `stalled`
 * where uncommitted or unpushed work is on the floor with no PR.
 *
 * `unknown` is the registry's own honest fifth: an older manifest with no pid,
 * an agent between branches with no worktree to look in, or a check that could
 * not run. Absent is not a guess — the rule this contract follows everywhere,
 * and the reason a stale record can never masquerade as a live one.
 */
export const AgentStateSchema = z.enum(['running', 'finished', 'waiting', 'stalled', 'unknown']);
export type AgentState = z.infer<typeof AgentStateSchema>;

/**
 * The registry states that mean a LIVE WORKER — the one deciding whether an
 * agent is working RIGHT NOW.
 *
 * `running` is a live process. `waiting` is a worker that stopped to ask a
 * person and whose worktree still holds its half-done branch: it is mid-task,
 * not finished. `finished`, `stalled` and `unknown` are NOT live — a finished
 * worker handed its branch back, a stalled one left the desk with work on the
 * floor, and `unknown` is the board unable to say either way.
 *
 * IT LIVES IN THE CONTRACT so the dispatcher and the board share ONE definition
 * of a worker. `auto-dispatch.ts` measures the concurrency cap against it, and
 * WORKING renders exactly its members; a second copy is how the two would drift
 * on the one word — `working` — they both depend on. It sits here rather than in
 * `auto-dispatch.ts` because that module reaches for `node:child_process`, and
 * the board's client bundle must import this set without dragging Node in.
 */
export const LIVE_STATES: ReadonlySet<AgentState> = new Set<AgentState>(['running', 'waiting']);

/**
 * Whether a registry state means a live worker — the DENYLIST reading of
 * {@link LIVE_STATES}, not the allowlist.
 *
 * A known-non-live state (`finished`, `stalled`, `unknown`) is not live; ANY
 * OTHER state — including a sixth an older board does not recognise from a newer
 * registry — reads as live and is shown. A worker nobody can see is the worse
 * failure, so the filter fails toward visibility rather than hiding a state it
 * was not taught. The cost, taken deliberately: `LIVE_STATES` is the complement
 * this is derived from, a weaker guarantee than a bare set-membership test.
 */
export function isLiveState(state: string): boolean {
  return state !== 'finished' && state !== 'stalled' && state !== 'unknown';
}

/**
 * The registry states that mean a BROKEN WORKER — one that stopped without
 * finishing and needs a person to look.
 *
 * `stalled` is work on the floor with no PR: the worker stopped without asking,
 * and what it was doing is uncommitted. `unknown` is a question the board cannot
 * answer: the pid is gone, no exit code was recorded, so the worker's fate is
 * unknown. Both belong in WAITING ON YOU as problem reports.
 *
 * `finished` is NOT broken — the work reached review, and the PR carries it. A
 * finished entry drains through the reconciliation; it needs no row of its own
 * while the PR still does.
 *
 * An allowlist, unlike {@link isLiveState}: an unrecognised state is NOT broken,
 * because calling it broken and filing it in WAITING ON YOU is a claim this
 * function cannot verify. The fallback for an unknown state is WORKING — see
 * `isLiveState` — so an unrecognised sixth state renders where a worker renders
 * rather than where a problem report renders.
 */
export function isBrokenState(state: string): boolean {
  return state === 'stalled' || state === 'unknown';
}

/**
 * One agent from the dispatcher's registry — a process with an identity that
 * outlives the branch it was launched on.
 *
 * The first five fields are LAUNCH-TIME facts, written by `plot-dispatch.sh`
 * before the worker starts; they can never be wrong about the past. `model`,
 * `contextTokens` and `lastActivity` are read from the session transcript and
 * are **optional on purpose**: a transcript that is missing, still empty, or in
 * a format this board does not recognise costs those fields and never the entry.
 * The transcript format is the runtime's private business.
 *
 * `pid` and `state` are what let the registry answer liveness. The manifest now
 * carries the agent's pid — a launch fact, written by the wrapper the instant it
 * learns its own child — and `state` is refreshed on EVERY pulse from
 * `plot-worker-state.sh`, so a stale manifest reads `finished` on the next scan
 * rather than persisting. An earlier design refused a pid outright, having
 * measured one shown for a worker gone hours; the cure was not to drop the pid
 * but to stop reading liveness OFF it — `state` is the liveness, decided per
 * pulse, and `pid` is only the launch fact and the value a reader can go check.
 */
export const AgentEntrySchema = z.object({
  /**
   * The session id, minted at launch. The identity, and the transcript's name.
   *
   * Defaults to `''` — the same *empty is a real value* rule `branch` follows.
   * It is the id the runtime writes its transcript under, so a worktree with no
   * manifest never had one, and the registry SYNTHESIZES an entry for such a
   * worktree to make the section truthful. That entry must validate, so this is
   * `''` rather than required: absent is a real state, not a rejection.
   */
  session: z.string().default(''),
  /** The branch it holds, or `''` while it holds none — empty is a real value. */
  branch: z.string().default(''),
  worktree: z.string().default(''),
  /** The `Worker command` as launched, quotes and newlines intact. */
  command: z.string().default(''),
  startedAt: z.string().default(''),
  /**
   * The AGENT's pid at launch, or `''` where the manifest carried none or one
   * that cannot be a pid (`0`, junk). A launch fact, never liveness on its own —
   * see `state`. Defaults to `''` so a pulse from before the field validates.
   */
  pid: z.string().default(''),
  /**
   * The pid this run DISPLACED when it relaunched in place, or `''` on a first
   * dispatch that displaced nothing.
   *
   * A relaunch in an existing worktree overwrites `pid` with the new process and
   * records the corpse here — the value the row used to name. `/api/continue`
   * already computed this to show *replacing pid Y* and then threw it away;
   * persisting it costs nothing at the write and keeps a fact the board could
   * not otherwise recover once `pid` is overwritten. `''` (not a synthetic 0) so
   * a first dispatch is byte-for-byte what it was before this field existed.
   */
  previousPid: z.string().default(''),
  /**
   * How many times this worktree's worker has been relaunched in place — 0 on a
   * first dispatch.
   *
   * A read-modify-write on each relaunch, deliberately UNLOCKED: a lost
   * increment costs an inaccurate diagnostic count, while a lock would introduce
   * a stale-lock failure mode for a counter nothing yet acts on. A branch
   * restarted three times is struggling, and this is the only place the board
   * can say so. Defaults to 0 so a first dispatch and an older pulse both read
   * as *never relaunched*.
   */
  relaunches: z.number().default(0),
  /**
   * Pulse-refreshed liveness. Defaults to `unknown` so an older pulse — which
   * never carried a state — validates as *cannot say* rather than blanking a
   * client's open page.
   */
  state: AgentStateSchema.default('unknown'),
  model: z.string().optional(),
  contextTokens: z.number().optional(),
  lastActivity: z.string().optional(),
});
export type AgentEntry = z.infer<typeof AgentEntrySchema>;

/**
 * Metadata about the registry the board read — the facts that make a
 * synthesized fleet legible rather than silent.
 *
 * The bug this exists for: a board started in a worktree with no
 * `.plot/agents/` of its own synthesizes the entire fleet from
 * `git worktree list`, and nothing on screen says so. The rows render, the
 * agents carry no sessions, the drop menu vanishes, and the operator has no
 * way to tell a synthesized fleet from one that happens to have nothing to
 * offer. Reporting the directory and the counts makes the state visible.
 *
 * WHY THREE COUNTS. The manifest count alone does not say enough: `0 manifests`
 * could mean "no dispatch has ever run" or "the board is reading an empty
 * directory while the manifests sit elsewhere". The synthesized count is what
 * distinguishes them — `12 synthesized` says the fleet is NOT empty, just
 * identity-less.
 */
export const RegistryInfoSchema = z.object({
  /**
   * The resolved absolute path where the board read manifests — what
   * `resolveManifestDir` returned, so an operator seeing `0 manifests` can
   * verify the directory themselves.
   */
  directory: z.string(),
  /**
   * How many `.json` files were read and successfully parsed as manifests.
   * A manifest that failed to parse (invalid JSON, missing session) is NOT
   * counted — the board is reporting what it SAW, not what the directory held.
   */
  manifestCount: z.number().int(),
  /**
   * How many entries were synthesized from worktrees the registry had no
   * manifest for. A synthesized entry has `session: ''` and no drop action.
   */
  synthesizedCount: z.number().int(),
});
export type RegistryInfo = z.infer<typeof RegistryInfoSchema>;

/**
 * The fleet controls a payload is READ AS when it carries none.
 *
 * Exported, and read by the client rather than only defaulted by Zod. The
 * schema's `.default()` runs where the payload is PARSED, which is the server;
 * `packages/board/src/app` casts the fleet it fetches and never parses it, so a
 * client reading `fleet.fleetControls.autoDispatch` on an older payload throws
 * and the whole Agents tab renders nothing.
 *
 * Measured 2026-08-22: every fixture predating this field — 40 selectors across
 * five browser suites — took a 10s timeout waiting for a section that a
 * TypeError had prevented from rendering at all. The suite read as slow (151s
 * for 15 tests) and CI as a 15-minute timeout; both were this.
 *
 * Off and 3: a fleet that dispatches nothing is the safe reading of silence.
 */
export const FLEET_CONTROLS_DEFAULT = { autoDispatch: false, parallelAgents: 3 } as const;

/**
 * The three exhaustive counts a sprint's plans fall into — the numbers the
 * Agents-tab control renders beside the sprint's name, plus the total.
 *
 * THREE BUCKETS, NOT SEVEN STATUS VALUES. The question the control answers is
 * *how much of this sprint is left*, and that has three answers:
 *
 * | bucket | holds |
 * |---|---|
 * | **open** | committed, not started — Draft/Approved with no branch in flight |
 * | **wip** | started, not delivered — in-progress or deliverable |
 * | **done** | delivered — Phase: Delivered (the Testing column) |
 *
 * Every member lands in exactly one bucket, so `total = open + wip + done`.
 * The old four buckets (`delivered`, `deliverable`, `inProgress`, `approved`)
 * could silently drop a Draft member; these three cannot — the arithmetic
 * fails visibly when a member falls through.
 *
 * `released` is NOT counted. While a sprint is Active its target release has
 * not been cut, so no member can be Released — measured on this repo 2026-08-24:
 * 21 members, 17 delivered, 4 draft, zero released. Where a released member
 * DOES appear under an Active sprint, that is drift worth seeing rather than
 * a case to absorb.
 *
 * COUNTED FROM `plan.status` via {@link PlanStatus}, never recomputed.
 */
export const SprintCountsSchema = z.object({
  /** Total non-deferred members. Always equals `open + wip + done`. */
  total: z.number().int().default(0),
  /** Committed, not started: Draft, open, or Approved with no branch in flight. */
  open: z.number().int().default(0),
  /** Started, not delivered: in-progress or deliverable. */
  wip: z.number().int().default(0),
  /** Delivered: Phase: Delivered (the Testing column). */
  done: z.number().int().default(0),
});
export type SprintCounts = z.infer<typeof SprintCountsSchema>;

/**
 * One Active sprint, as the Agents tab shows it: its name, its target release,
 * and its three exhaustive counts. Distinct from {@link SprintCardSchema} —
 * that carries the MEMBERSHIP the two sprint filters join on; this carries the
 * PROGRESS the fleet control renders, aggregated server-side so the client
 * casts it rather than joining plan status itself.
 *
 * Emitted once per Active sprint. Two teams may share one train, so the fleet
 * carries a list and the control renders one row each — picking the newest
 * would silently hide a commitment.
 */
export const FleetSprintSchema = z.object({
  slug: z.string(),
  title: z.string(),
  /** The sprint's `- **Release:** x.y.z`, or "" — see {@link SprintCardSchema}. */
  release: z.string().default(''),
  counts: SprintCountsSchema,
  /**
   * The sprint's plan array — the same structure `board.sprints` already carries
   * and `parseSprintMembers` produces. `AgentList.tsx` reads the fleet payload,
   * not the board payload, so without this the Agents tab cannot join on sprint
   * membership (the bug that #386 did not fix).
   */
  members: z.array(SprintMemberSchema).default([]),
});
export type FleetSprint = z.infer<typeof FleetSprintSchema>;

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
  /**
   * THE WAVES this fleet holds — one entry per `(plan, wave)`, derived once on
   * the server beside the rows. See {@link WaveSchema} for what a wave is and
   * why it is a thing the contract carries rather than a string re-grouped by
   * every consumer.
   *
   * BESIDE `rows`, NOT DERIVED FROM THEM BY THE CLIENT — the `issues`/`agents`
   * precedent, and the whole point of the entity. A row is a branch that names
   * its wave; this is the wave that holds branches, and the section/completeness
   * it carries are the answers a consumer would otherwise re-derive from the
   * rows and disagree about.
   *
   * Defaults to [] so a client talking to an older server still validates. BUT
   * THE DEFAULT DOES NOT SAVE A CLIENT THAT CASTS: a Zod `.default()` fires only
   * at parse time, and the board CASTS this payload (`board as Board`) rather
   * than parsing it, so a renderer reading `fleet.waves` on a pre-wave pulse
   * gets `undefined`, not `[]`. This repo has shipped that bug before
   * (`FLEET_CONTROLS_DEFAULT`, 2026-08-22). A consumer must guard for the
   * absent case, and the server emits this field unconditionally — cold cache
   * included — so a live server never leaves it off.
   */
  waves: z.array(WaveSchema).default([]),
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
   * Every agent the dispatcher has launched, from the manifests under
   * `.plot/agents/`, newest first.
   *
   * **Beside `rows`, and not derived from them, because an agent is not a
   * branch.** A row is a branch and mentions its agent; this list is agents and
   * mentions their branches — `branch` is `''` for one that holds none, which is
   * the state `waiting` needs and no row can express. A running worker therefore
   * appears twice, as its branch's row and as its own entry, and that is not
   * duplication: the two entities differ.
   *
   * Defaults to [] so a client talking to an older server validates — the
   * `issues` precedent. Unlike `issues` it needs **no companion answer field**,
   * and the difference is worth stating: `issues` asks a remote tracker that can
   * refuse, time out or rate-limit, so `[]` there is ambiguous between "none"
   * and "never asked". This reads a local directory. An unreadable or absent
   * `.plot/agents` means no dispatch has run, which is a real answer rather than
   * a failure to obtain one.
   */
  agents: z.array(AgentEntrySchema).default([]),
  /**
   * Metadata about the registry the board read — directory, manifest count, and
   * how many entries were synthesized. Makes a synthesized fleet legible: a
   * reader seeing `0 manifests, 12 synthesized` knows immediately that the
   * fleet on screen has no identities and no drop actions.
   *
   * Optional so a client talking to an older server still validates. The client
   * must guard for the absent case — a missing `registry` renders as nothing
   * rather than as zeroes. The server emits this field unconditionally.
   */
  registry: RegistryInfoSchema.optional(),
  /**
   * Whether the tracker could be asked. Defaults to `unsupported`, which is the
   * only safe default: an older server sends no issues and no answer, and
   * reading that silence as `answered` would render "your inbox is clear" from
   * a server that was never asked the question.
   */
  issueAnswer: IssueAnswerSchema.default('unsupported'),
  /** The failure, when `issueAnswer` is `failed` — shown, never swallowed. */
  issueError: z.string().nullable().default(null),
  /**
   * The two fleet controls, SHARED across every board reading this repo.
   *
   * The switch belongs to NOT STARTED (*is the queue being served?*) and the
   * cap to WORKING (*how many agents at once?*), each rendered on the section it
   * is about. They ride here rather than in `localStorage` on purpose: they
   * spawn agents that write code, so two people reading one board must not
   * disagree about whether the fleet is running — the board's one departure from
   * *view state in the URL, convenience in localStorage*. The server reads them
   * from `.plot/state/fleet-controls.json` on every render, seeded from
   * `## Plot Config`; the client renders these values and POSTs a change to
   * `/api/fleet-controls`, holding no authoritative copy of its own.
   *
   * Defaults `{ autoDispatch: false, parallelAgents: 3 }` so a payload from a
   * server predating this wave still validates and reads as a fleet that is not
   * serving its queue — the safe direction, since this wave dispatches nothing
   * and wave 3 acts only while the switch is on.
   */
  fleetControls: z
    .object({
      autoDispatch: z.boolean(),
      parallelAgents: z.number().int(),
      /**
       * How many workers are in WORKING — the registry size, one derivation
       * read twice.
       *
       * The WORKING section renders one row per registry entry (`agents`). This
       * is that same count, computed server-side so the stepper's "N working"
       * label matches the rows without re-deriving in the client. `agents.length`
       * is the whole rule — every entry renders, so every entry is counted.
       *
       * This is NOT the cap's balance (that's `parallelAgents − liveAgentCount`,
       * computed by auto-dispatch). It is the size of what the user sees in the
       * WORKING section.
       *
       * OPTIONAL for backwards compatibility: a payload from a server predating
       * this field should render no count rather than a wrong one.
       */
      working: z.number().int().optional(),
    })
    .default(FLEET_CONTROLS_DEFAULT),
  /**
   * The Active sprints, each with its release and four `status` counts — what
   * the Agents-tab sprint control renders. One entry per Active sprint (two
   * teams may share one train); [] where none is Active, which the control shows
   * as its disabled-but-visible state.
   *
   * Aggregated server-side from `plan.status` on the render clock, beside `rows`
   * and for the same reason: a sprint file edited between two scans, or a plan
   * whose status just moved, shows on the very next poll. Emitted
   * UNCONDITIONALLY — [] on a cold cache — because the client CASTS this payload
   * and a Zod `.default([])` never fires client-side; a field the server left
   * off would reach the renderer as `undefined`, the `fleetControls` lesson from
   * 2026-08-22.
   */
  sprints: z.array(FleetSprintSchema).default([]),
  /**
   * Estate-wide counts over ALL plans, the same three buckets the sprint counts
   * use. Shown in the sprint control when the filter is OFF, so a reader sees
   * the effect of turning it on: "21 members" versus "112 plans".
   *
   * Computed by the same derivation as the sprint counts (`open + wip + done =
   * total`), which is the plan's requirement — one derivation, two scopes, so
   * the numbers cannot disagree about what a bucket means.
   *
   * Defaults to zeroes so a payload from an older server still validates, and
   * zeroes beside `ready: false` read as *nothing measured yet* rather than
   * *an empty estate*. The same rule the stuck counts already follow.
   */
  estateTotals: SprintCountsSchema.default({ total: 0, open: 0, wip: 0, done: 0 }),
  /**
   * The branch the MAIN CHECKOUT is on — where a person and the master agent
   * do the concept work — derived from git, never recorded.
   *
   * NOT THE SERVER'S CHECKOUT. The board server may run from a linked worktree,
   * or from the main checkout while the operator works in another. What this
   * names is the first entry of `git worktree list`, which is the main checkout
   * whether or not it is where the server started. Measured 2026-08-25: the
   * first entry is `…/plot` at `bug/a-head-counts-its-own-waves`, the operator's
   * branch, regardless of which worktree `pnpm board` ran in.
   *
   * READ ON A TTL, NOT ONCE. Unlike `server.branch`, which is the branch the
   * server process serves and changes only when a new process starts, this can
   * change WHILE THE SERVER RUNS: the operator `git checkout` in the main tree
   * while the board stays open. The TTL shape from `server-info.ts` (#410) is
   * copied, 5 s — the fork stays off the per-request path and a checkout shows
   * up within seconds.
   *
   * EMPTY STRING FOR EVERY FAILURE. Detached HEAD, not a git repo, unresolvable
   * main checkout — all three produce `''`, and `''` renders NO ROW AT ALL. Not
   * the label alone, not a placeholder, not a short SHA. Absent is not false;
   * the field is `''` and never absent. The schema's convention is that absent
   * and empty answer different questions, and this is the empty one: the board
   * asked and got no answer.
   *
   * Defaults to `''` so a client talking to an older server validates. `''` is
   * also the signal to render nothing, so the default is the honest one.
   */
  masterAgentBranch: z.string().default(''),
  /**
   * The prefix for constructing branch URLs on this repo's host.
   *
   * `branchUrlBase(origin)` in `fleet.ts` — `https://github.com/org/repo/tree/`
   * for GitHub, `https://bitbucket.org/org/repo/branch/` for Bitbucket Cloud,
   * `''` for any host whose branch-page shape the board does not recognise.
   *
   * THE MASTER AGENT ROW needs it to link its branch. Every other row receives
   * its `branchUrl` fully constructed server-side; this row is assembled
   * client-side from `masterAgentBranch`, so the prefix must travel with it.
   *
   * `''` renders as plain text — the same rule `branchUrl` follows on rows.
   * Defaults to `''` so a client talking to an older server validates; that
   * default is also the "unknown host" answer, so the two are consistent.
   */
  branchUrlBase: z.string().default(''),
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

/**
 * `POST /api/claim` — the result of reserving one branch.
 *
 * IT RETURNS THE RESULTING STATE, NOT AN ACKNOWLEDGEMENT. That is the whole
 * reason the endpoint exists rather than being a second button. An agent's loop
 * today is *edit markdown, push, and hope the derived view agrees*, and every
 * step of it can fail quietly — the failure that produced a plan which was
 * valid and invisible at the same time. A `200 OK` with no state leaves the
 * caller doing exactly what this replaces: asking a second endpoint whether the
 * first one landed, and guessing when the answer is stale.
 *
 * `claimed` is the fact; `branch` is what the claim mechanism CHOSE. The
 * endpoint takes a plan slug and not a branch name because `plot-dispatch.sh`
 * picks the branch itself, by asking the fleet scan which one is eligible —
 * eligibility is wave arithmetic and lives in one place. A caller that wants a
 * specific branch is asking for a rule this system deliberately does not have.
 */
export const ClaimResultSchema = z.object({
  /** The plan the claim was requested against. */
  slug: z.string(),
  /**
   * Whether a branch is now reserved for this caller.
   *
   * FALSE IS NOT AN ERROR, and the distinction is the endpoint's most useful
   * one. Losing a claim race is the normal outcome of a fleet doing its job:
   * two dispatchers ask at once, the refs diverge, and the loser's push is
   * rejected as non-fast-forward. That rejection IS the concurrency control, so
   * a caller that gets `claimed: false` should ask again for different work,
   * not retry this branch or report a fault.
   */
  claimed: z.boolean(),
  /**
   * The branch that was claimed, or null when nothing was.
   *
   * Null in two different situations that share a shape: nothing was eligible,
   * and something was eligible but another session won it. `reason` is what
   * tells them apart, and a caller that acts on the null alone will retry a
   * plan that has no work left in it.
   */
  branch: z.string().nullable().default(null),
  /** Where the worktree for that branch is, or null when nothing was claimed. */
  worktree: z.string().nullable().default(null),
  /**
   * The claim mechanism's own words — never this server's paraphrase of them.
   *
   * `plot-dispatch.sh` says `dispatched <branch> → <path>`, or
   * `skipped <branch> (claimed by another session)`, or nothing at all when the
   * eligible set is empty. Forwarding that verbatim is what keeps the endpoint
   * a wrapper: a summary written here would be a second account of an outcome
   * that already has one, free to disagree with it exactly when something
   * unusual happened.
   */
  reason: z.string(),
  /** The script's machine-countable footer, forwarded whole for auditing. */
  summary: z.string().default(''),
});
export type ClaimResult = z.infer<typeof ClaimResultSchema>;

/**
 * The phase transitions this API can apply.
 *
 * ONE ENTRY, AND THE SHORTNESS OF THIS LIST IS A FINDING RATHER THAN A GAP.
 * Plot has four phases and three transitions between them, but only
 * `Draft → Approved` has a mechanical implementation: `plot-approve.sh`, which
 * performs seven writes with no judgement in any of them. `Delivered` and
 * `Released` are written by /plot-deliver and /plot-release as PROSE — an agent
 * editing markdown — and there is no script to wrap.
 *
 * So supporting them here would mean writing the phase rules a second time,
 * beside the ones that already exist in the spokes, which is the single thing
 * this branch was told not to do. The endpoint refuses them by name instead,
 * and says which command owns them. A refusal that names the owner is a smaller
 * failure than a duplicate guardrail that drifts.
 */
export const TransitionSchema = z.enum(['approve']);
export type Transition = z.infer<typeof TransitionSchema>;

/**
 * `POST /api/transition` — the result of applying one phase transition.
 *
 * THE GUARDRAILS ARE NOT NEGOTIABLE THROUGH THIS ROUTE. A transition the spoke
 * would refuse is refused here, with the spoke's own reason, because the spoke
 * is what evaluates it: this endpoint runs `plot-approve.sh` and reports what
 * it said. There is no phase check in this server at all, and that absence is
 * the design — an API that could approve an unreviewed draft would have become
 * a bypass of the lifecycle rather than an interface to it.
 */
export const TransitionResultSchema = z.object({
  slug: z.string(),
  /** Which transition was requested. */
  transition: TransitionSchema,
  /** Whether the plan is now in the target phase. */
  applied: z.boolean(),
  /**
   * The plan's phase AFTER the attempt, re-read from the file — never assumed
   * from the exit code.
   *
   * READ BACK, NOT INFERRED. The endpoint's entire promise is that the caller
   * never has to re-derive whether its write landed, and inferring `Approved`
   * from `exit 0` would be the same act of hoping this replaces. Null when the
   * plan cannot be parsed at all, which is itself worth reporting rather than
   * flattening into a phase that sounds plausible.
   */
  phase: z.string().nullable().default(null),
  /**
   * Why, in the words of whatever decided it.
   *
   * On a refusal this is the spoke's own sentence — *"Plan is still a draft PR
   * (#N). Mark it ready for review first."* — forwarded rather than replaced.
   * Replacing it with a status name sends the reader to a terminal, and then
   * the command could have been typed there in the first place.
   */
  reason: z.string(),
});
export type TransitionResult = z.infer<typeof TransitionResultSchema>;
