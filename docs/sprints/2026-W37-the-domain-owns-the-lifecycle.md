# Sprint: The domain owns the lifecycle

> Plot's elements each have a lifecycle, and the rules governing them live in
> prose — in `DESIGN-*.md`, in `CLAUDE.md`, in comments beneath shell
> conditionals. This sprint moves those lifecycles into the domain and puts a
> test behind each refusal, so a rule that is violated fails a build rather than
> waiting for someone to read a diff.

## Status

- **State:** Closed
- **Closed:** 2026-09-07, 2.14.0 released
- **Start:** 2026-09-05
- **End:** 2026-09-19
- **Release:** 2.14.0

## Sprint Goal

**Every domain element's lifecycle is enforced by a test, and no script changes
a lifecycle state without asking the domain.**

Two halves, and the second is what makes the first stick. A rule the domain owns
that a script routes around is not enforced; a script that asks a rule which
refuses nothing is not governed.

**Three conditions, and all three must hold.**

| condition | what it rules out |
|---|---|
| **named** | a concept the code discusses in two vocabularies — a plan's *states* called its *phases*, a Slice called a Wave |
| **owned** | a lifecycle decided in a shell script the domain cannot call, or in a comment nothing enforces |
| **enforced** | a rule written down and violated anyway, which is where this sprint starts |
| **routed** | a script that changes a lifecycle state on its own authority |

**The fourth is measurable, and the estate is further along than it looks.**
`plot-approve.sh` and `plot-deliver.sh` ask the domain through
`plot-transition.mjs`, and `plot-reap.sh` says so in its own header: it *"reads
`packages/domain/src/rules/reapable.ts` and ACTS on the answer; it holds no
judgement."* That is the shape, already working, in the script whose five
refusals are the most consequential in the fleet.

**`plot-release-refs.sh` is the one that decides for itself.** Its five guards
answer the same question about the same desk — is this branch finished with? —
and they are written separately, in a script that deletes a remote ref, which
`plot-reap.sh`'s own comments call out as the operation that cannot be undone.
Two implementations of one judgement, where the more dangerous one is the copy.

**The third is what makes it a sprint rather than a refactor.** `CLAUDE.md`
already states the failure mode — *"If prose-only, it's a rule and will
eventually be violated"* — and the estate proved it three times while these
plans were being written:

- an approval record landed **inside** an HTML comment block on two plans,
  because `plot-approve.sh` inserts after the first placeholder it finds. Both
  reported `record=written`; both parsed empty.
- three plans authored under the story that exists to fix Plot's vocabulary all
  wrote `## Branches`, months after a migration script renamed the estate.
- a plan bundled six branches under three headings, which
  `DESIGN-slice.md` forbids in one sentence.

Every one was caught by a person reading output, and every one is the shape a
rule takes when nothing refuses it.

### What "owns" means here

**A rule takes readings as values and returns a refusal or a decision.**
`transitions/plan.ts` is the working example — `Precondition`, `RefusalReason`,
`Decision`, 41 tests with 24 refusal assertions, called from a bundle by
`plot-approve.sh`, `plot-deliver.sh` and `server/entry/transition.ts`. One rule,
three entrances, no second implementation.

**But there are two shapes, and the sprint says so up front.** `DESIGN-plan.md`:
*"Plan and Story are the only two entities whose state is a stated fact rather
than a derived relation."* A Plan's transition returns **writes the caller
performs**; an Agent's, a Worktree's and a Slice's returns **a verdict on a
change that already happened**. The refusals are shared; the decisions are not.

### No release until a lifecycle can refuse

**2.14.0 waits until at least one lifecycle beyond `plan` refuses in
production** — not until a plan is delivered, not until this sprint closes.

The reason is the previous sprint's own lesson, recorded in
`2026-W36-the-domain-is-one-implementation.md`: 2.12.0 shipped four entries and
not one was a change a user notices. A sprint that renames `Phase` to
`PlanState` and adds a `transitions/story.ts` nobody calls has moved code and
changed nothing. **The condition is that something is refused that was
previously allowed.**

## MoSCoW

Stories: [[the-domain-knows-what-plot-knows]] — every plan here belongs to it,
and it holds no plans outside this sprint.

### Must Have

- [x] [the-workflow-owns-the-word-phase] A plan has a **state**, the development workflow has **phases**, and each phase names its work — a delivered plan is in the Testing phase: the state is `delivered`, the phase is `Testing`, and one word carries both today. `Phase` is declared twice in `packages/domain/src` meaning different things, and `PHASE_LEADERSHIP` — who leads each phase — sits in the board's contract file. **Approved 2026-09-04, 5 slices, 2 rounds.** Lands first: the four `transitions/` files below are written after it or they copy the conflation into four new files <!-- status: delivered -->
- [x] [a-lifecycle-is-enforced-by-a-test] `transitions/` for Story, Agent, Worktree and Slice, each refusing with a test per refusal, plus the ratchet that stops the next lifecycle hiding. **Approved 2026-09-04, 5 slices, 2 rounds.** Story leads: it is the one disagreement still standing after two of the three cited violations were fixed while the plan waited <!-- status: delivered -->
- [x] [every-element-is-a-domain-concept] Branch, Plan and Slice become types that carry the rules judging them — the reaper's five refusals and the ref-deleter's five guards are one question asked twice. Amended after approval with the recognition rule: given a ref, Plot says whether it is a plan under review, a slice's branch, or nothing Plot planned. **Approved 2026-09-04, 6 slices, 1 round** <!-- status: delivered -->

### Should Have

- [x] [a-process-is-started-by-its-own-command] Both long-lived processes get a command that owns them, and an agent can be brought into existence — measured 2026-09-05: a dispatch reported `handed over … started=0` and the supervisor ticked `agents=0 queued=456`, so the chain *dispatch queues → registry matches → an agent takes it* had no last link. **Approved 2026-09-05, 5 slices, 4 rounds**, reordered the same day so the agent starter leads: dispatching the rename first queued the plan's own first branch against an estate with no agent to take it <!-- status: delivered -->

- [x] [a-branch-state-is-derived-once] Three domain rules read `BranchState` and none produces one — the eight states are decided in four places across a 4,008-line shell script, and `unknown` versus `open` turns on whether a question was put or went unanswered. **Draft (#702), 2 slices, 2 rounds.** Should rather than Must because the three above give the domain its words and its rules; this gives it an answer it currently has to be told

### Could Have

- [x] [every-generated-bundle-is-marked] Every bundle `build.mjs` emits is marked `-merge`, and the repair path recognises the set rather than one file — measured 2026-09-05: `board-server.mjs` took 0 conflict markers through a rebase while the two unmarked bundles took 8, and `plot-resolve-artifact.sh` then refused the branch as *not artifact-only*, declining the exact case it exists for. **Draft, 2 slices, 4 rounds** <!-- status: delivered -->
- [x] [the-board-answers-while-it-scans] The board keeps serving while it scans — it stops for seconds at a time at zero CPU. **WITHDRAWN 2026-08-31, Jan Wloka, in-session** — the plan carries `State: Rejected` and a `Rejected:` record. Ticked because the sprint's question is *is this item still owed*, and a withdrawn item is not; `plot-sprint-release.sh` knows three states and none of them is *withdrawn*, so it reads this as `disputed` rather than `open`. That is the honest reading of a box the shell cannot resolve, and it is visible rather than silent.

- [x] [the-scripts-say-slice] The reconcile scan says slice where it means slice — section 7 read *"Unsliced waves (a wave holds one branch)"*, a Slice described in Wave's vocabulary by its own parenthetical. Footer keys renamed with the skill documenting them. **#703, no plan — a rename small enough to be its own PR. Merged 2026-09-05 (`c02d8807`); section 7 now reads *"Uncut slices (a slice holds one branch)"*.**

### Also shipped

**Twenty-three plans were delivered inside this sprint's window and named it in their own `Sprint:` field, and the file did not carry them.** They were written and shipped as the work above uncovered them — a supervisor that handed nothing over, a queue that counted merged slices, a scan that could not see unclaimed work — so they are the sprint's output rather than its plan.

**LISTED SEPARATELY, NOT MERGED INTO THE MoSCoW TIERS.** What was committed to on 2026-09-05 and what emerged afterwards are different claims, and a reader asking *did this sprint deliver what it promised* must be able to see the first without the second. Every one is `Delivered`; none was a Must, a Should or a Could, because none existed when those were chosen.

- [x] [a-merged-slice-leaves-the-queue] A branch whose PR merged is offered to a free agent again. The queue reads *claimed* off the remote ref, and merging deletes the ref — so the one event that finishes a slice is the same event that makes it look unstarted. **Delivered 2026-09-05.**

- [x] [a-changeset-names-its-plan] `/plot-release` cross-checks changesets against plans because nothing links them. Measured 2026-09-06: **0 of 14** changesets on this estate name a plan — worse than the `1 of 42` `DESIGN-release.md` recorded — so every release reconciles by hand what a line in the file would have joined. **Delivered 2026-09-06.**

- [x] [a-dispatch-action-asks-for-its-brief] Nine eligible slices sat unbriefed for hours while eight agents idled. Seven interrogation rounds found that the remedy already shipped — a *Write brief* button, a refusal that names the fix, a route that runs the skill — and that one unset config key made all of it inert. What is still missing is one thing: the unattended loop skips a slice with no brief and asks nobody. **Delivered 2026-09-06.**

- [x] [a-pulse-says-what-changed] The scan re-derives the whole estate every run and prints a full picture. Nothing says what moved since the last one, so a reader compares 47 slices by eye — and the supervisor, which tries, gets it wrong. **Delivered 2026-09-06.**

- [x] [a-second-slice-needs-its-own-session] An agent's first slice succeeds and its second cannot start. The session id is fixed at launch and passed to every prompt, so the runtime refuses the second one — `Session ID … is already in use` — and the loop falls back to waiting for work it has already been handed. **Delivered 2026-09-06.**

- [x] [a-stated-state-is-one-the-domain-admits] Three stories write `status: archived` and one sprint writes `Phase: Planned`. Neither value parses. Both were found by hand, in one session, because nothing checks a written state against the schema that defines it. **Delivered 2026-09-06.**

- [x] [the-slice-contract-says-what-it-reads] Two domain rules disagree about a slice with no branches. `eligible.ts:80` returns `complete` — finished work — and `deliverable.ts:75` skips it. Both shipped, and nothing has caught it because only Released plans carry the shape. **Delivered 2026-09-06.**

- [x] [a-browser-stub-beats-the-first-fetch] `fleet-settings.browser.test.ts` navigates the page, then installs its routes. The page's first `/api/fleet` fetch races that installation, and when it wins the test reads `FLEET_CONTROLS_DEFAULT` instead of its own stub — `parallelAgents: 3` where the test asked for `1`. **Delivered 2026-09-07.**

- [x] [a-desk-is-adopted-and-swept] `plot-init` never proposes `Worktree root`, so an adopting repository dispatches agents into a layout it did not choose and a `.gitignore` it does not have. And the reaper reads five measurements about a desk, none of which is git's own answer that the directory is gone. **Delivered 2026-09-07.**

- [x] [a-desk-is-finished-with-once] `plot-reap.sh` asks the domain whether a worktree may go. `plot-release-refs.sh` answers the same question about the same desk with its own five guards — and it is the one that deletes something no `git worktree add` can bring back. **Delivered 2026-09-07.**

- [x] [a-merged-slice-has-no-ref-to-count] Eight briefed, eligible slices were dispatched and every one was held `not-claimable`. The queue counts a slice's outstanding branches from remote refs, and a merged branch's ref is deleted — so slice 1 reads unfinished forever and every slice behind it reads `blocked`. **Delivered 2026-09-07.**

- [x] [a-plan-greps-for-its-own-deliverable] Five plans this week proposed something the estate already had, and one argued through two interrogation rounds about a gate that had already moved. Every one was caught by grepping; none by reading. `/plot-idea` already detects a duplicate plan and does not detect a duplicate deliverable. **Delivered 2026-09-07.**

- [x] [a-sprint-knows-when-it-ended] A sprint's `Phase:` is written by hand and read by the release gate, and nothing keeps the two honest. Measured 2026-09-06: the one sprint in `active/` said `Planned`, and a displaced sprint still targets a release that shipped a day ago. **Delivered 2026-09-07.**

- [x] [a-stale-plan-file-does-not-travel] Two commits this session reverted a plan annotation written minutes earlier. Neither edited the file. Two explanations were argued and both were wrong — the real one is a single session that staged an index, pulled, and then committed. It needs no second party, and a `pre-commit` hook can see it. **Delivered 2026-09-07.**

- [x] [a-stated-wait-is-a-parsed-wait] A plan said in bold that its slice waits for another plan. The machine could not see it, dispatched the slice as eligible, and a person withheld the brief by hand for a week. `waits:` is a parsed annotation; the prose was not one. **Delivered 2026-09-07.**

- [x] [a-story-says-what-it-is] Three story files carry `status: archived`, a value the domain refuses and `transitions/story.ts` calls derived. A fourth is `draft` while all three of its plans are Approved. The lint reports none of it. **Delivered 2026-09-07.**

- [x] [orphaned-work-is-visible] Twelve branches carry unmerged commits with no PR and no plan naming them. Five hold real file changes — an e2e fix, a typecheck repair, a guard, a corpus fix, six files of monitor work — and nothing on the estate says they exist. The board calls three of them `abandoned` and says nothing about the other nine. **Delivered 2026-09-07.**

- [x] [the-board-says-whether-anything-supervises] The board renders agents and never says whether a supervisor is watching them. Six workers ran 23–25 hours past an 8-hour bound with the supervisor down, all six spent, and the board showed six healthy rows. **Delivered 2026-09-07.**

- [x] [the-brief-command-invokes-a-skill] `Brief command` has run twice and failed twice, identically: 33 bytes reading `Unknown command: /plot-implement`. `plot-implement` is a skill, and the prompt opens with a bare slash command. The board's own runner uses a form that may work, and nobody has compared them. **Delivered 2026-09-07.**

- [x] [the-bundle-set-is-derived-once] The board contract lists the built bundles by hand. It went stale three times in one evening — nine, then ten, then eleven — and each time a merge failed a test nobody was expecting to fail. The shell derives the same set from `build.mjs` and cannot drift. **Delivered 2026-09-07.**

- [x] [the-installed-supervisor-hands-work-over] Both shipped units start `plot-registryd.mjs` with no flags, so the installed supervisor decides every hand-over and performs none. Measured 2026-09-07: `handed=2` for three consecutive ticks while both free agents' manifests carried `branch: ""` and sat quiet for 3,067 seconds. **Delivered 2026-09-07.**

- [x] [the-last-two-callers-ask-the-adapter] `every-pr-question-goes-through-the-adapter` merged as #717 and cleared two of four callers. It left `plot-pr-merged.sh` by instruction and `plot-update-board.sh` unmeasured, and the grep gate it promised did not ship — so nothing stops a third arriving. **Delivered 2026-09-07.**

- [x] [the-supervisor-says-why-it-handed-nothing] `plot-registryd --once` reports `handed=0 queued=480 idle=8` and stops there. Eight free agents, four queued slices with briefs on `origin/main`, and no way to learn which of six holds refused each one. **Delivered 2026-09-07.**

## Notes

Written 2026-09-05. The four plans were written and interrogated on 2026-09-04
— eight rounds between them — and three approved the same day.

**Every round changed something, which is the argument for the sprint's own
goal.** Round 2 on `a-lifecycle-is-enforced-by-a-test` found that two of its
three cited violations had been **fixed by the estate while the plan sat
unapproved**, and that its Agent assertion would have passed on the day it was
written — a refusal that refuses nothing. Round 2 on `a-branch-state-is-derived-once`
replaced its entire gate: a byte-identical differential over live output is
impossible when the scan asks a host that can throttle.

**What this sprint does not do.** It does not give the remaining ~30 state enums
rules. The ratchet in `a-lifecycle-is-enforced-by-a-test` makes every enum
declare its kind — lifecycle, reading, or classification — and that declaration
is the review that finds the next lifecycle nobody had noticed. Guessing which
of the thirty deserve rules is exactly the error this sprint's own plans made
twice, naming `SprintState` and `PrState` as non-lifecycles when both transition.

**A plan-less item is the one the box has to carry alone — and nothing ticked it.** `the-scripts-say-slice` shipped as **#703 on 2026-09-05** (`c02d8807`), and its box stayed unchecked for two days while `plot-sprint-release.sh` reported it `open`. That report was correct: the script resolves a box against the plan estate, *"the plan estate outranks the checkbox where there is one to read"* — and this item deliberately has no plan, so there was nothing to outrank it with.

**So the asymmetry the script documents has a third case it cannot reach.** A checked box over an undelivered plan is `disputed`; an unchecked box over a delivered one is `done`, because `/plot-deliver` moves the plan and nobody re-ticks. But an unchecked box over a merged **PR** with no plan reads `open`, and stays `open` until a person reads the source — which is what happened here, on a question about something else.

**The item was right to have no plan.** A one-PR rename does not earn a plan file, and the sprint line says so. What it costs is the automatic close, and that cost should be paid at the merge: an item whose only record is a PR number needs its box ticked by whoever merges it, because no later sweep will.

**A WITHDRAWN ITEM HAS NO READING, AND BOTH ANSWERS ARE WRONG.** `plot-sprint-release.sh` prints one of three words — `done`, `open`, `disputed` — and derives them from a checkbox and a plan's `delivered` flag. It never reads `State:`, so a plan carrying `Rejected` is indistinguishable from one still being written.

That leaves no honest box. **Unticked**, the item reads `open` and blocks the sprint forever over work somebody decided not to do — the same trap `the-board-answers-while-it-scans` was in for six days as a Draft, and for the same reason its own note gives: *"a withdrawn plan left in Draft sits in the approval queue forever."* **Ticked**, it reads `disputed`, which at least says *these two records disagree, come and look* — and a person looking finds the `Rejected:` line and the reason.

**So it is ticked, and this note is why.** The fix is not a fourth word in the sprint file; it is `plot-sprint-release.sh` learning that `plot-plan-meta.sh:338` already accepts `rejected` and `superseded` beside the four phases. Until it does, a withdrawal is legible to a reader and not to the shell.

**`the-scripts-say-slice` reads `disputed` for a different reason**, and the two must not be conflated: that item ships as PR #703 with no plan file at all, so the shell has nothing to resolve its box against. One item has a plan the shell will not read; the other has no plan to read. Both surface as one word.

## Closed — 2026-09-07

**Released as 2.14.0**, tagged and published with 75 changesets.

**Six of eight items `done`; two `disputed`, and neither is outstanding work.** `the-board-answers-while-it-scans` is a plan you withdrew on 2026-08-31 — `plot-sprint-release.sh` has no reading for *withdrawn*, so the honest box is the one that says *come and look*. `the-scripts-say-slice` shipped as PR #703 with no plan file, so the shell had only a checkbox to resolve.

**Both are the same defect seen twice**, and it has a plan: [`a-withdrawn-item-is-not-open`](../plans/2026-09-07-a-withdrawn-item-is-not-open.md), carried into `the-board-serves-a-team`.

**What the sprint's own goal did not reach:** `plot-sprint-release.sh` still reaches the domain zero times while six sibling scripts do — *"no script changes a lifecycle state without asking the domain"*, unmet in one place. [`a-sprint-item-has-one-scorer`](../plans/2026-09-07-a-sprint-item-has-one-scorer.md) closes it, in the next sprint.
