---
title: Making parallel work visible
author: jwloka
status: active
created: 2026-08-15
updated: 2026-08-15
---

# Making parallel work visible

## Objective

Give a person running several agents at once a single place to answer two
questions: **where does this work stand**, and **what is everything waiting
for**. Four plans across five months have each answered part of that; this
story is the frame that makes them one piece of work rather than four.

## Why Now

The parallel fleet landed in August. Agents can now be dispatched across waves,
claim branches by ref push, and run detached — so for the first time it is
normal for five things to be in flight that no human is watching.

That inverted the bottleneck. When one agent worked at a time, watching the
terminal was enough. With a fleet, the scarce resource is no longer execution;
it is **knowing what is happening**. `/plot-fleet` and `/plot-dispatch --status`
answer it in a terminal, once, and the answer is gone when the scrollback rolls.

The board is the surface that could hold the answer, and it is already
first-class — a package, a contract, tests, a Definition of Done gate. What it
shows is plans. What it does not show is agents.

## Decisions Taken in Scoping

**Why one story for four plans?** They were written five months apart and read
as unrelated: a GitHub Projects sync, a package graduation, a dispatch
mechanism, a visualisation. They share one intent — *the state of work should
be visible without asking* — and the later ones only make sense as answers to
gaps the earlier ones left. Naming that intent once is cheaper than
re-deriving it from four Motivation sections.

**Why not fold them into one plan?** Each was independently reviewable and
shipped on its own. Plot's own Principle 4 is one plan, many branches — a story
is the layer above: many plans, one intent. Rewriting history into a single
plan would destroy the record of how the understanding actually developed.

**Why is this story `active` rather than `done`?** Three plans are delivered
and one is approved with a tracer branch in flight. The agent view is the part
that closes the loop, and it has not been built yet.

## Current Plan

### Phase 1: The board becomes real ✅

- ✅ `board-sync` — plan phase transitions drive GitHub Projects columns (#8) — 2026-03-15
- ✅ `kanban-board-v1` — own TypeScript package, one plan parser, story filter, plan viewer, DoD gate (#40) — 2026-07-13

### Phase 2: Parallel work becomes possible ✅

- ✅ `parallel-agent-fleet` — waves, claim-by-ref, worktree dispatch, merge queue, reaper (#72, #75, #76, #77, #78) — 2026-08-14

### Phase 3: Parallel work becomes visible 🔄

- 🔄 `fleet-agent-view` — the agent tab, in four steps; approved and started 2026-08-15
  - 🔄 Step 1 `feature/fleet-scan-json` → `feature/fleet-api` → `feature/fleet-tab` — git-only agent list, three waves
  - ⏸️ Step 2 — PR/CI data, completing *waiting on a machine*
  - ⏸️ Step 3 — five board columns, leadership colour, Approved split
  - ⏸️ Step 4 — story swimlanes

## Open Points

> **Nothing marks a point resolved when its plan lands.** Swept 2026-08-16 and
> found four of twelve stale — two fixed and merged (#136, #130), one approved
> and waiting (#131) — while `plot-story-lint.sh` reported `0 findings`, because
> it checks the estate's *structure*, not whether a `⏸️` has been overtaken by a
> plan. So the section only ever grows, and "what is still open?" becomes
> unanswerable without opening each entry.
>
> Two of the four candidates in that sweep turned out NOT to be resolved,
> which is the argument for reading each one rather than matching headlines:
> the containment half of the PR-#57 point is still live, and the
> `Impl: same branch` point is about a flow that pushes no ref at all.
>
> Markers: `⏸️` open · `📋` planned, not yet built · `✅` resolved, with the PR
> that did it. Resolved entries keep their original text — the finding is the
> record of why the fix exists.

- ⏸️ **The pulse orders waves within a plan and knows nothing about file
  overlap between plans.** Its wave ordering is stateless and correct — merge
  wave 1 and `--next` names wave 2 on the following run, with no flag to set
  and no bookkeeping to forget. That is the design working.

  What it cannot see is which *files* a branch will touch. Observed 2026-08-16:
  the moment `feature/fleet-row-phase` merged, `--next` offered
  `feature/agent-view-phase-ui` — while `bug/board-shows-staleness`, from a
  different plan, had `AgentList.tsx` open in an agent's worktree. Both branches
  edit that same file. The pulse says *eligible* and is right about waves;
  nothing in the model represents the collision.

  Two kinds, and they differ in severity:
  - **Source overlap** (this case) — two plans naming the same module. Real
    conflicts, resolvable but wasteful.
  - **The built artifact** — `skills/plot/scripts/board/board-server.mjs` is
    rebuilt by *every* board branch, so every pair collides in a minified
    bundle where the conflict cannot be meaningfully resolved. That is the
    separate open point below, and it is the binding constraint on parallel
    board work today.

  A human currently supplies the check by reading worktrees before dispatching.
  Whether the plan format should be able to declare touched paths — or whether
  `plot-merge-queue`'s `git merge-tree` prediction should run *before* dispatch
  rather than before merge — is the open question.

- ⏸️ **A DRAFT plan's branches sit in NOT STARTED, inviting a dispatch that
  would be refused.** Spotted 2026-08-16 from a screenshot: minutes after
  `board-tells-the-truth` was written, its two branches appeared reading
  *"eligible — nobody has taken it"* — while the plan was still Draft and its
  PR not even marked ready for review.

  Measured, and simpler than expected: `plot-fleet-scan.sh` contains **zero**
  references to a plan's phase. It walks every active plan's waves whether the
  plan is Draft or Approved, so a plan still under discussion advertises work
  as ready to pick up. `plot-dispatch` would refuse those branches, which makes
  the row an invitation to an action the tool declines — the same mismatch the
  Start button avoids by appearing only on eligible rows.

  NOT STARTED is meant to mean *discovered, planned, ready for an agent* — the
  hand-off point. A Draft plan has not reached it.

  Belongs with [`agent-view-phase`](../../plans/2026-08-16-agent-view-phase.md),
  which is teaching the scan exactly this plan-phase-to-row connection: there
  for the row's **label**, here for its **group**. Not folded in mid-flight —
  that plan's Data wave is in an agent's hands right now.

- 📋 **A board whose server died looks like a board that is working** — the one
  failure the whole tab exists to prevent, in its own chrome. Cost a real
  diagnosis on 2026-08-16: two screenshots reported a regression ("the nameless
  heading is still there", "the group's plan link is still missing") and both
  were the frozen last render of a page whose server had stopped. On the live
  board neither was true.

  Three things combine, and each is defensible alone:

  - **The Agents tab never consults `fleet.error`.** `AgentList` reads it only
    to decide the pre-first-scan message (line 326); after that the error state
    has no rendering. `App.tsx` line 383 shows *"Failed to load board"* — but
    that branch renders the **Board**, so the Agents tab keeps drawing its last
    payload while the sibling tab reports the outage.
  - **The clock keeps running.** `tick` advances every second whenever
    `pollSeconds !== null`, and `pollSeconds` is the constant `FLEET_POLL_MS /
    1000` — never null while the tab is open. A failed fetch changes nothing.
    So `scanNextInSeconds − tick` counts to 0 and clamps ("next in 0s", reading
    as *about to refresh* rather than *stopped*), while `ageSeconds + tick` ages
    on, describing a scan that is not happening.
  - **Rows stay confident.** Every branch, PR and note keeps its normal styling,
    so nothing distinguishes a two-second-old truth from a two-hour-old one.

  The comment at line 313 already states the rule this breaks: *"a counter
  ticking toward a refresh that is not coming is exactly the false statement the
  countdowns exist to remove."* The guard implements it for a closed tab and
  misses a dead server — the same absence-ambiguity class as the rest of this
  story, one layer up: **stopped polling** and **polling and failing** are
  indistinguishable to the reader.

  Related, and part of the same fix: the board picks its port at startup, so a
  bookmarked tab can point at a port nothing serves. That is how the dead page
  above arose (`:7930` bookmarked, live server on `:7777`), and it makes "is
  this board alive?" a question the reader cannot answer from the page.

- 📋 **`discovery.test.mjs` flakes in CI — a port race, not a timing one.**
  Observed 2026-08-16 on PR #131 (run 31968882967): `a plans dir NESTED in an
  unrelated repo borrows nothing from it` failed, and the *same commit* passed
  on rerun.

  **The first diagnosis here was wrong and is corrected rather than deleted**,
  because the wrong version is instructive. It said the suite "waits on a
  filesystem-watch-driven re-read" and blamed the 9.2 s runtime. There are
  **no sleeps in the file**; the runtime comes from real `git init`/`commit`
  calls, and it is not the problem. The actual mechanism is `helpers.mjs:19`:
  `findFreePort()` binds port 0, reads the number, **closes**, and hands it to
  a different process that binds it later. Between `close()` and `listen()` the
  port belongs to nobody, and CI runs test files in parallel.

  That makes it the same defect as `EADDRINUSE` on `pnpm board` and as a tab
  bookmarked on a dead port: **a port chosen at one moment and used at
  another**. Three symptoms, one root. Planned as
  [`board-tells-the-truth`](../../plans/2026-08-16-board-tells-the-truth.md).

  The lesson worth keeping: the plausible mechanism was accepted for hours
  because it *explained the symptom*. Only reading `helpers.mjs` disproved it.

- ⏸️ **Step 4 has no test case in this repo** — story swimlanes need stories, and
  until this file existed there were none. This story is now the first one; a
  single swimlane still does not prove the layout works with several.
- ⏸️ **What counts as "working" without a local pid?** Answered provisionally for
  step 1 (tip commit newer than `Fleet quiet after`, default 30 min) but the
  default is a guess only real use can correct.

  Observed 2026-08-16, and it bounds what #118 could fix: a branch claimed
  **21 hours ago** and *resumed* today reads as QUIET while an agent is
  actively working on it. #118 separates fresh claims from stale ones by the
  age of the claim commit, which is right for a first dispatch and blind to a
  resumption — the claim is old, the work is new, and git holds no record of
  an agent that has been reading for three minutes. Two branches dispatched
  minutes earlier sat correctly in WORKING at the same moment, because their
  claim commits were themselves fresh. The row self-corrects on the agent's
  first commit.

  **And the group is wrong, not merely incomplete** — worth stating plainly,
  because the first reading of this was too forgiving. The note (*"no commit
  for 21 hours"*) is true. QUIET, however, means *go check whether it died*,
  and following that instruction finds a live agent with two modified files.
  A group that asks you to investigate where there is nothing to investigate
  is a wrong answer, exactly as `merged` and fresh `claimed` were before it.

  There IS an unread signal. `git worktree list` shows the worktree and the
  scan runs on the same machine, so *"a worktree exists for this branch and
  its tree is dirty"* is locally knowable while the refs say nothing. That
  cuts against the fleet deriving state from refs precisely so it works for
  detached workers on other machines — which is why this stays a question
  rather than an obvious fix: a worktree signal would be true only for the
  machine doing the looking, and the fleet's whole point is that it is not
  the only machine.
- ✅ **A running board does not pick up a rebuilt bundle** — fixed: `pnpm board` runs under `node --watch` — cost the user two
  false readings today. The DATA reloads fine (server scan 5 s, client poll
  4 s), but `clientHtml` is inlined into the bundle at build time and the
  server holds it in memory, so `pnpm build:board` changes nothing until the
  process is restarted. A fix landing in `classify` was therefore invisible in
  the board that was already open, which reads exactly like the fix not
  working. A watcher on the artifact that restarts the server would remove the
  trap; until then, restarting after a rebuild is the rule — and rules are what
  this repo keeps finding out are not enough.

  It has now cost more than confusion. The PR-refresh fix landed in #123 and
  the board kept running the pre-#123 bundle, so it went on firing every 5 s
  and **exhausted the GraphQL quota a second time the same afternoon**
  (`used 5002/5000`, 27 minutes to reset, blocking `gh` for everything else).
  The fix for the rate limit was already merged; the process holding the port
  had never heard of it. A trap that quietly reverts a landed fix is worth more
  than a note.

  **Fixed by one word.** `node --watch` is built in and restarts the process
  when the artifact changes — verified by touching the file against a running
  board: one restart event, HTTP 200 immediately after. `pnpm board` now uses
  it. Notable that the fix was a flag rather than the watcher-plus-supervisor
  this entry had imagined: `pnpm board` runs a bare `node`, so `process.exit`
  would have stopped the board rather than reloading it. Checking what actually
  starts the board was the whole difference between a one-word change and a
  feature.
- ⏸️ **`pnpm board` starts another board instead of adopting the running one.**
  Found 2026-08-16 while chasing why the quota kept draining *after* #123 had
  landed and `--watch` was in place: `ps` showed **seven** independent
  board-servers on seven ports, started 13:48, 13:55, 14:05, 15:10 (×2) and
  15:27 (×2). Nobody chooses seven boards; they accumulate, one per `pnpm
  board` in a new terminal, and each keeps polling forever because nothing ever
  stops them.
  Measured after killing the five stale ones — three idle minutes with no
  `gh` calls of my own: **80 GraphQL calls/hour per board.** That is #123
  working exactly as designed (720/h at the old 5 s cadence → 80/h at 60 s plus
  backoff). Seven boards make it **560/h**, or ~4500 across a working day —
  enough to exhaust 5000 on its own, with no agent or human call involved.
  So the earlier diagnosis was right but partial: the stale bundle explained
  the *second* exhaustion; process pile-up explains the drain that outlived the
  fix. One board is harmless, seven are not, and the difference is invisible
  from inside any one of them.
  The shape of the fix is known from elsewhere in this repo: exclusion through
  something observable. Dispatch claims a branch by pushing a ref; `pnpm board`
  should claim its port — adopt a live server (or say which one is already
  serving) rather than opening another. Until then, `ps aux | grep
  board-server` before starting one.
- ⏸️ **The checked-in artifact collides on every parallel branch** — three
  merges in one afternoon (#117, #118, #119), each conflicting in
  `board-server.mjs` and only there, while every source file merged cleanly.
  It is a 690 KB build output, so git has nothing sensible to merge: two
  branches that both ran `pnpm build:board` produce different bytes for the
  same intent. Resolution is mechanical — rebuild, `git add`, done — but it is
  paid per branch per merge, and it is the direct cost of the decision that
  `pnpm board` must work with no install step. Worth revisiting if fleet work
  on the board becomes routine; a merge driver that rebuilds instead of
  diffing would remove the manual step without giving up the checked-in
  artifact.
- ✅ **A card's `claimed` count is always 0** — fixed in #123 — observed 2026-08-16 alongside
  the QUIET finding. `waveSummary` is built from `plot-plan-meta.sh`, which
  reads `claimed` from a *plan-file annotation nobody writes*; the fleet scan
  reads it from *git refs*, where claims actually live. So the same board asks
  two sources about one fact and gets two answers — the Agents tab saw the
  claim, the card said `claimed: 0`. A claim is a git ref by design (Principle
  1), so the plan parser cannot know it unless someone writes it down twice,
  which is the second source of truth Plot exists to avoid. `claimed: 0` means
  "I looked somewhere claims are not kept", and looks exactly like "nobody is
  working".

  It is bigger than one wrong number. `WaveSummarySchema` carries
  `waves / branches / claimed / deferred` and **no `eligible`** — which is also
  why the plan's open question about disabling *Start work* when nothing can
  start has no answer today. The fleet scan already computes both: it reports
  `verdict=eligible` per wave and a `claimed` count in its summary. So the fix
  for all three was one change of source, not three features — build
  `waveSummary` from the pulse the Agents tab already reads, instead of from
  the plan parser. Blocked while `feature/board-start-work` edits `board.ts`.
- ✅ **A freshly claimed branch reads as QUIET** — fixed in #118 — observed 2026-08-16, seven
  minutes after dispatching `feature/board-artifact-links`. `classify()` in
  `fleet.ts` short-circuits `state === 'claimed'` straight to
  `{group: 'quiet', note: 'claimed, no commits yet'}`, regardless of age. The
  note is accurate; the group is wrong. QUIET's own subtitle is *go check
  whether it died*, and a branch claimed minutes ago has just started. This is
  the merged-branch defect again — right state, wrong story — and the fix
  probably means letting `claimed` flow through the same age comparison the
  pushed-work case uses. The age data exists: a claim IS a commit (the empty
  `plot: claim <branch>`). Deliberately not folded into the Navigation wave,
  which touches the same file — that PR should stay one thing.
- ✅ **`/plot-dispatch` starts work without recording that it did** — fixed in #124: dispatch books a `Started:` line on the default branch after the claim, through a disposable branch and `plot-push-main.sh`, and a failed booking never unwinds the fan-out. — observed
  2026-08-16: `board-acts-through-plot` sat in DESIGN badged *Ready* while its
  first wave was claimed and an agent was editing it. The card was rendered
  correctly; the booking was missing. `plot-dispatch.sh` creates the worktree,
  pushes the claim and starts the worker, but writes no `Started:` record —
  `/plot-implement` does that in its step 5, and dispatch never got the
  equivalent. So the two tabs of one board disagreed by design: Agents reads
  git refs and saw the claim, Board reads the plan through
  `toBoardPhase(phase, started)` and saw nothing started. Fixed by hand for this
  plan; the gap in dispatch remains.
- ⏸️ **`same branch` work is invisible to the fleet until pushed** — same
  session, same screenshot: `feature/push-main-bypass` sat under NOT STARTED
  reading *"eligible — nobody has taken it"* while five commits existed for it
  locally. The scan derives everything from remote refs (Principle 1), so this
  is correct behaviour and correct semantics — in a fleet of detached workers,
  a local branch is nobody's business but its machine's. But `/plot-dispatch`
  pushes a claim and `/plot-implement` under `Impl: same branch` does not, so
  that flow produces work the board cannot see. Whether `/plot-implement`
  should push the branch at start is undecided.
- ✅ **Section 2 reports a plan when ONE branch merged, not when all did** — fixed in #122 —
  seen 2026-08-16 the moment #122 landed: the scan named
  `reconcile-scan-accuracy` (two waves still open) and `board-reads-git` (one
  branch still in flight) alongside `push-main-bypass`, which genuinely is
  deliverable. The line says *consider: /plot-deliver*, and as advice that is
  defensible — but a reader acting on all three would try to deliver two plans
  whose work is unfinished, and `/plot-deliver` would then refuse them at its
  own gate. Cheap to sharpen (compare merged branches against the plan's
  non-deferred set) and worth doing before the noise trains people to skip the
  section.

  Related and already visible in the same output: the fleet scan lists those
  merged branches as `open`, because the ref is deleted at merge. Same root as
  the bug #122 fixed, seen from the other side.

  **Escalated 2026-08-16, after #124 merged.** This stopped being a display
  bug the moment the advisory wave gate got an automated reader. With both of
  `board-reads-git`'s PRs merged and both refs deleted,
  `plot-fleet-scan.sh --next` answers `bug/board-claimed-from-git` — finished
  work, named as the next thing to start, which is precisely the question
  `plot-dispatch.sh` asks before it fans out. Worse, a dispatch acting on that
  answer pushes a claim, which **recreates the deleted ref** and re-badges the
  branch `claimed`: the wrong answer manufactures the evidence that justifies
  it. It also explains the ref that had to be restored by hand earlier today
  to unblock a wave — symptom, not cause. Tracked with the evidence in
  [`release-closes-the-loop`](../../plans/2026-08-16-release-closes-the-loop.md).
- ✅ **`packages/board/src/server/fleet.ts` held a literal NUL byte** — fixed: written as the `\0` escape, verified with `node` to produce the identical byte, and gated by a test that walks `src/` and `test/` for raw NULs. The gate was proven to fail by putting the byte back, because a test that has never been red proves nothing. Originally (offset
  5007, line 126) — `` `${opts.repoRoot}\x00${opts.scriptsDir}` ``, the cache-key
  separator. The *choice* is right: NUL cannot occur in a path, so it is the one
  separator that can never be ambiguous. Writing it as a raw byte instead of the
  `\0` escape is what costs. Every line-oriented tool classifies the file as
  binary and **answers nothing**: `grep` returns no matches without saying why,
  and only `rg` names the reason ("binary file matches"). Cost it today — three
  greps for constants that were in the file all along read as "not there", and
  the obvious next move would have been to add code that already existed.
  Diffs and review views are blinded the same way. `node` was run to confirm
  `\0` in a template literal produces the identical byte, so the fix is
  behaviour-preserving and one character wide. Only occurrence in the repo
  (all tracked `.ts/.tsx/.mjs/.js/.sh/.md` scanned).
- ✅ **Design work on an idea branch is invisible to the board.**
  Resolved by [#130](https://github.com/plot-pm/plot/pull/130), delivered
  2026-08-16: a Draft plan living only on an idea branch now renders as a
  Discovery card. Only the *gap* half needed fixing — the WAITING ON YOU half
  below was correct as it stood. Original finding kept. Asked
  2026-08-16 during a four-round `/challenge-the-plan` on #126: shouldn't that
  session have shown up under WAITING ON YOU, then WORKING? Checked, and the
  answer is *no* twice, for two different reasons — one right, one a gap.
  **WAITING ON YOU is correct to stay empty.** `classify()` has an explicit
  rule (`if (pr.draft) break; // a draft is still the author's, not yours`), so
  a draft plan PR deliberately does not nag. It would appear the moment #126 is
  marked ready. Working as designed.
  **WORKING is the gap.** The pulse walks the branches a plan *lists* under
  `## Branches`, and an idea branch is never one of them. Measured: zero pulse
  lines for `idea/fleet-sees-merged-branches`, and **no `idea/` branch appears
  in the pulse at all** — #121 and #126 are both invisible. So the card reads
  `(unnamed) — eligible` with `bug/fleet-merged-branch-state — open`: truthful
  that implementation has not started, and blind to hours of design work
  happening right then on the idea branch.
  The consequence is that the board answers "is anyone building this?" but not
  "is anyone *thinking* about this?", and Plot treats design as a first-class
  phase (Draft → Approved) rather than as pre-work. A plan in Draft with commits
  on its idea branch is exactly as active as one with commits on a bug branch.
  Not obviously the fleet scan's job to fix — it is branch-oriented by design —
  so this may belong to whatever renders the Discovery/Design columns from the
  plan's own PR rather than from `## Branches`.

  **Superseded the same day by the entry below** — the agent view was only the
  half of this I looked at first. The plan itself is missing from the board
  too, which is the larger fact.
- 🔄 **A plan under PR review is on no board column at all — Draft is
  structurally unreachable.** **Half fixed in #130**, and the halves are worth
  keeping apart: the BOARD now maps `draft → Discovery` and sources plan files
  from the prefixed branches, so a Draft plan under review appears in its own
  column. The PULSE still does not — measured after #130: it reports **3 plans
  where the repo has 16**, because `plot-fleet-scan.sh` reads
  `docs/plans/active/` in the local working tree only. A Draft plan therefore
  shows in the Agents tab exactly when you happen to stand on its own idea
  branch. Same question one layer over, tracked in
  [`agent-view-phase`](../../plans/2026-08-16-agent-view-phase.md) (#131) as its
  first wave. Follow-up question, 2026-08-16: *isn't a draft
  plan exactly the discovery work we are doing, and is that why Discovery is
  always empty?* Checked against the running board rather than the code, and
  the answer came out in three layers, the first two of which I had wrong.
  **A draft plan is Design, not Discovery.** `toBoardPhase('draft') →
  'Design'`, explicitly. **Discovery is empty by construction**, not by
  accident: `Swimlanes.tsx` filters it out of the plan columns
  (`BOARD_PHASES.filter((p) => p !== 'Discovery')`) because in this model
  Discovery is where a *story* lives before any plan exists for it. Writing the
  plan file is the act of leaving Discovery.

  **Corrected by screenshot: Discovery IS a column.** The claim above that it
  is "not a column" came from reading `Swimlanes.tsx` and generalising from the
  wrong view. `Board.tsx` renders **all five** columns straight from the API,
  unfiltered — so the plain column view shows `DISCOVERY  0` with *"No plans in
  this phase"*, while the swimlane view uses Discovery as the row header. **Two
  views, two meanings, one name.** And in the column view it is unreachable by
  construction: `toBoardPhase` maps to Design, Development, Endgame and
  Released — never to Discovery. Not empty because nothing is happening; empty
  because nothing *can* be. A rendered column that promises a place for work
  and can never hold any.
  **But #126 is in neither column.** Queried live: Design holds 2 cards
  (`opus5-longhorizon-hardening`, `plot-sprint-support`), Development 3,
  Endgame 1, Released 7, Discovery 0 — and neither #126 nor #121 appears
  anywhere. The board reads plan files from the working tree on the default
  branch, and a `Review: pr` plan lives only on its idea branch until approval
  merges it. Confirmed exhaustively: of every plan file on `main`, **not one is
  in phase Draft** — Draft is not rare on the board, it is unreachable.
  So the column marked 👤 *human-led*, where a person's attention is the scarce
  resource, is missing precisely the plans that need attention. And the failure
  is selective rather than total: plans reviewed `in-session` or already
  approved *are* shown, so Design looks populated and complete while the two
  plans under active review are absent. A column that is wrong-but-plausible is
  worse than one that is visibly empty.
  Worth noting what this is not: not a fleet-scan bug (that view is
  branch-oriented by design). It is that "what plans exist" is sourced from one
  branch's working tree, while plans under PR review deliberately live
  elsewhere — the same git-is-the-database question as
  [[fleet-sees-merged-branches]], one level up: the default branch is not the
  whole database.

  **And the phase mapping is not right after all** — the follow-up question
  *"are plans in Draft not exactly the pre-plan work?"* answers the empty
  column. Measured: #126's Draft phase is 5 commits and 545 lines with **no
  code**, #121's is 2 commits and 141 lines, likewise none — throwaway
  fixtures, a first-parent filter measured and discarded, a second-parent check
  tested and discarded. Investigation, not transcription. Meanwhile the two
  cards sitting in Design are approved-and-never-started, one since July and
  one since **February**: finished designs waiting for capacity, not design
  work.
  So one column holds two different things while the work itself shows nowhere,
  and `Draft → Discovery` / `Approved-not-started → Design` fixes both halves
  with no new vocabulary. The vocabulary decision belongs to
  [[plot-planning-model]] and is recorded there; this entry owns only the
  rendering once that lands. Two changes are needed here either way: the
  mapping, and the source of plan files (a Draft plan under PR review is not on
  the default branch at all, so remapping alone would leave Discovery just as
  empty).

  **The second change is far smaller than that made it sound.** Asked whether a
  Draft plan under PR review is not simply what lives on the `idea/` branches —
  it is, and the branches say so cleanly. Enumerated: each idea branch carries
  exactly **one** plan file absent from the default branch, and it is exactly
  the Draft one; everything else matches `main` because the branch was cut from
  it. So the rule needs no new convention:

  > plan files on branches under the configured idea prefix that are **not** on
  > the default branch — that set *is* the Draft plans.

  `Branch prefixes` is already config (`idea/, feature/, bug/, docs/, infra/`),
  so this stays project-agnostic, and the phase is still read from the file
  exactly as for every other plan — nothing is inferred from the branch name
  beyond *where to look*. It generalises to `Impl: same branch` plans, whose
  plan rides `feature/<slug>` rather than an idea branch: same test, wider net.
  Cost, measured: **`git ls-remote` is 459 ms — a network call — while
  `for-each-ref refs/remotes/origin/idea/*` is 8 ms.** Use the local mirror; it
  is already correct, since the fleet scan fetches every run and the refs are as
  fresh as the pulse. Plus ~7 ms per `ls-tree`/`show`, so ~22 ms for today's two
  branches against the ~1 s the board already spends. Cheap, local, and the
  same git-only discipline that makes `plot-fleet-scan.sh` affordable to poll.
  Third instance today of one underlying question, which is worth naming:
  a deleted ref is not missing work ([[fleet-sees-merged-branches]]), and the
  default branch is not all the plans. Manifesto Principle 1 says git *is* the
  database — the board reads one branch's working tree.
- 📋 **The Agents tab knows *when* a branch moved, never *what phase* it is
  in.** Planned as
  [`agent-view-phase`](../../plans/2026-08-16-agent-view-phase.md), approved
  2026-08-16 via plan-PR #131 after three interrogation rounds. Not dispatched
  yet — `fleet-sees-local-work` holds four of its files uncommitted. Original
  finding kept. Raised 2026-08-16 as two requests that turn out to share one missing
  field: WORKING should say whether a row is Discovery, Design or Development
  work, and NOT STARTED should mean *discovered, planned, ready for an agent*.
  `classify()` is purely temporal — a commit inside the quiet window is
  `working`, outside it `quiet`, regardless of the plan's phase. That is the
  right answer for *is anything moving* and cannot answer *moving on what*.
  Verified rather than assumed: `AgentRow` carries `branch`, `plan`, `wave`,
  `state`, `group` and **no phase**, and `plot-fleet-scan.sh --json` reports
  plan *filenames* with no phase either — while `plot-plan-meta.sh` has parsed
  it all along. The data exists and stops one layer short.
  The `same branch` case shows why this is not cosmetic: `board-ui-polish` had
  its plan written, interrogated and approved **on the branch an agent then
  built on**. One row, one branch, two phases in sequence — and the tab cannot
  tell them apart, so "someone is working" covers both *a human is still
  deciding what this should be* and *an agent is writing the code*.
  The Start button that belongs with it is **not** a new control:
  `StartWorkButton` exists and works, taking `card` / `dispatch` / `pulse`. It
  sits on `PlanCard` only. Moving it into the agent view hits the same obstacle
  as the plan modal in `board-ui-polish` — it needs a `Card`, and a fleet row is
  not one; the card must be looked up by `planFile`.
  Deliberately not started: `board-ui-polish` is mid-implementation in exactly
  these files. Three parallel branches stayed collision-free today only because
  nobody widened a scope after the fan-out began.
- ✅ **A branch no plan names is invisible, including its open PR.**
  Resolved by [#136](https://github.com/plot-pm/plot/pull/136), merged
  2026-08-16: an open PR on a branch no plan claims now gets its own row, and
  an `idea/<slug>` branch is grouped under the plan it carries. Original
  finding kept below. Seen
  2026-08-16 with two PRs waiting to be merged and `WAITING ON YOU` reading
  *none*. Measured: the pulse reports **8 branches where origin has 20**.
  The mechanism is by design — `plot-fleet-scan.sh` walks the branches a plan
  lists under `## Branches`, which is what makes it a *fleet* view rather than a
  branch listing. The consequence is not: a fix branch opened outside a plan
  (`bug/plan-view-branch-plans`, `plot/story-close-findings` — both mine, both
  with open PRs) carries the one thing the tab exists to surface, *something is
  waiting on you*, and cannot show it.
  The twelve unseen branches split four ways, and only one class matters:
  **open PRs with no plan** (2, the finding), merged-and-deleted leftovers,
  `main` and release branches, and stale `worktree-*` refs. So the fix is not
  "show every branch" — that would bury the fleet in housekeeping — but
  something narrower: a branch with an **open PR** is waiting on a person
  whether or not a plan claims it.
  Worth noting how it arose: I created both branches for small fixes without
  writing plans, which Plot's own ceremony rules permit. The tab silently
  assumes every branch worth watching belongs to a plan.
- ⏸️ **The fleet calls a branch quiet while its PR is open one level up.**
  **Still open, and half of it is not** — worth stating, because the two halves
  arrived together and only one has been fixed. #136 gave PR #57 its row; the
  six slices still read *"no commit for 22 days"*. Re-verified 2026-08-16 after
  #136 merged: `git merge-base --is-ancestor` says all six ARE contained in PR
  #57's head, and `git ls-remote` still finds no ref named
  `docs/model-provenance.md`. Both halves below are live.

  Asked 2026-08-16 from a screenshot: why does `feature/opus5-longhorizon-hardening`
  sit in WAITING ON YOU while six `opus5-hardening-*` rows sit in QUIET? They
  are **different branches** — the plan names the six slices, and the seventh is
  the collecting branch carrying PR #57, which no plan names at all (it only
  became visible once unplanned open PRs got rows).
  The six are not idle: verified with `git merge-base --is-ancestor`, each is an
  **ancestor of PR #57's head**. `plot-reconcile-scan.sh` learned this
  distinction in #125 — *contained in an open PR → not orphaned* — and the fleet
  scan has not. So it reads six live slices as "no commit for 22 days, go check
  whether it died", which is the wrong errand: the work is in review, not
  abandoned.
  Fixing it means teaching `branch_state` the containment test #125 already
  implements, and the ordering constraint from that plan carries over (claim
  first, containment second).
  Found alongside a data error worth its own line: that plan lists
  `docs/model-provenance.md` under `## Branches`. It is a FILE NAME, and
  `git ls-remote` confirms no such ref exists — so the plan claims a branch that
  cannot ever merge, and every completeness check has been counting it.
- ⏸️ **Does the board stay one-repo?** The design keeps every data function
  repo-parameterised, and tab 2 is meant to go cross-repo — "what are my agents
  waiting for" is a question about a person, not a repository. Not decided.
- ✅ Where does the agent view live — new tab or extended board? → See Decisions

## Decisions

The five `Q*` rows below come from
[`kanban-board-v1-open-questions.md`](../../plans/kanban-board-v1-open-questions.md),
the `/challenge-the-plan` decision log — that file keeps the working:
the bundle-size table, the install-path comparison, the version-scheme
options. The decision belongs here where it outlives its plan; the
reasoning stays there where it was produced.

Two of them were later reversed. That is recorded rather than corrected —
a decision log that only shows decisions that survived teaches nothing
about how the ground moves.

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-12 | Board becomes its own package, ships a prebuilt dependency-free artifact | `pnpm board` must work with no install step; a board nobody can start is not a board |
| 2026-07-12 | Board consumes `plot-plan-meta.sh` rather than parsing plans itself | Plan format changes in one place or it drifts in two |
| 2026-07-12 | Do not publish to npm; ship the bundled artifact in-repo (Q1) | The npm path stays open — org `plot-pm` exists — but deferred until size or usage justifies it. *Superseded within weeks: `@plot-pm/board` is published (0.2.1, #44), and `npm view` today reports `latest: 0.3.0` alongside an `rc` tag. The deferral held only until someone wanted the board in a repo that was not a Plot checkout* |
| 2026-07-12 | Package name `@plot-pm/board` (Q2) | Scoped to the org that already owns the marketplace name |
| 2026-07-12 | Sprint filter is multi-select, sharing a component with the story filter (Q3) | `?sprint=a,b`; single-value links keep working, so no adopter's bookmark breaks |
| 2026-07-12 | "Board impact in every plan" stays prose, not a CI gate (Q4) | A linter can check that a line exists, not that impact was considered. The mechanical half — *the board must still work* — is CI-gated |
| 2026-07-13 | First release is a release candidate (Q1) | *Superseded: shipped as `0.3.0`; the package stayed in `0.x` rather than reaching `1.0.0-rc.1`* |
| 2026-08-14 | Waves gate concurrency; a wave is eligible once every prior non-deferred branch merged | Dispatching everything at once collides; dispatching one at a time is not a fleet |
| 2026-08-14 | A claim is an empty commit pushed to the branch ref, not a bare pointer | Two branches at the same commit do not diverge, so both pushes succeed and both sides think they hold the claim |
| 2026-08-15 | Artifact status and agent status become **two tabs**, not one view | Days versus minutes, permanent versus transient — one surface answers each halfway |
| 2026-08-15 | Tab 2 groups by *reason for waiting*, not by plan | Each group implies a different action: review it, nothing, nothing, go check whether it died |
| 2026-08-15 | `/api/fleet` serves a server-refreshed cache, not a scan per request | A 1.05 s synchronous scan on a 4 s poll blocks the board's event loop 26% of the time |
| 2026-08-15 | One repo now, every data function repo-parameterised | The second repo should be an addition, not a rebuild |

## Key Findings

### 2026-08-15 — Reading is not verifying

**Expected:** Deliverables described in a merged plan are present in the code.

**Discovered:** Refutation passes at delivery time found two gaps in plans whose
work had shipped months earlier. `board-sync` promised five event-to-column
transitions and built four — new implementation PRs never reached *Ready*,
because the plan was written for Plot 1 where `/plot-approve` created the
branches, and Plot 2 moved that to `/plot-implement` without the transition
moving with it. `kanban-board-v1` shipped as `0.3.0`, never the `1.0.0-rc.1` it
chose.

**Impact:** Neither was caught by reading, by CI, or by five months of use. The
board-sync gap was invisible precisely because *a board update that never
happens looks exactly like a board nobody configured*. Delivery-time refutation
is now how these plans get closed, and `plot-update-board.sh` still has no test.

### 2026-08-15 — The reconcile scan checks shapes, not states

**Expected:** `plot-reconcile-scan.sh` surfaces plans whose work has landed but
were never delivered.

**Discovered:** It missed `kanban-board-v1` for five weeks because that plan ran
single-PR on its idea branch — the scan looks for *implementation branches
merged while the plan is still Approved*, a shape that plan never had. It also
reports the seven `opus5-hardening` branches as orphans although all seven are
ancestors of open PR #57.

**Impact:** Two concrete scan improvements, neither built: recognise
single-PR-mode plans, and treat "contained in an open PR" as distinct from
orphaned via `git merge-base --is-ancestor`.

## Excluded from Scope

| Item | Reason | Revisit If |
|------|--------|------------|
| Editing plans from the board | The board is read-only by design; approving from a web page moves a git-native decision off git | A recorded approval in the file can be produced by the board without becoming the source of truth |
| A public board server (`board.plot.pm`) | Local-only keeps the security surface at zero; researched in `docs/research/2026-07-12-board-public-server.md` | Someone needs to watch a fleet they cannot reach from their own machine |
| Websockets / file watching for live updates | Measured: a full fleet scan is ~0.5 s and a 4 s poll costs a tenth of a core — machinery without a visible difference | A repo large enough that polling is felt |
| Cross-repo boards | One repo first, deliberately; the seam is kept open rather than built | A second repo is actually being watched |

## Progress Tracking

Plan phases are the ones Plot records, not a second vocabulary: **Delivered**
means every implementation PR merged and the plan booked; **In progress** means
approved *and* carrying a `Started:` record. The board derives the same split
from the same field.

| Plan | PRs | Phase | Notes |
|------|-----|-------|-------|
| `board-sync` | [#8](https://github.com/plot-pm/plot/pull/8) | ✅ Delivered 2026-08-15 | Merged 2026-03-15; delivered five months later. Gap found at delivery and closed first ([#98](https://github.com/plot-pm/plot/pull/98)) |
| `kanban-board-v1` | [#40](https://github.com/plot-pm/plot/pull/40) | ✅ Delivered 2026-08-15 | Merged 2026-07-13; delivered five weeks later. Shipped as 0.3.0, not the planned 1.0.0-rc.1 |
| ↳ `kanban-board-v1-open-questions` | — | 📋 Decision log | Output of `/challenge-the-plan`; five questions Max decided 2026-07-12. Not a plan — kept as the record behind Q1's deferred `1.0.0-rc.1` |
| `parallel-agent-fleet` | #72, #75, #76, #77, #78 | ✅ Delivered 2026-08-14 | Five stages; three adversarial audits, four defects found by execution |
| `fleet-agent-view` | [#97](https://github.com/plot-pm/plot/pull/97) (plan) | 🔄 In progress | Started 2026-08-15 on `feature/fleet-scan-json`; brief in `.plot/briefs/`. Step 1 of four |

## Session Log

### 2026-08-15 — Consolidating four plans into one story

Written after delivering the two board plans that had been sitting in
*Approved* — one for five months, one for five weeks. Both were booked, not
built: the work had shipped and was in daily use.

**Key outcomes:**

- Four plans named as one intent: the state of work should be visible without
  asking
- Two delivery-time refutation passes found real gaps in shipped work; one was
  fixed before delivery ([#98](https://github.com/plot-pm/plot/pull/98))
- This is the repo's first story — Plot has built story tooling (`Story:` field,
  board filter, `plot-story-lint.sh`, this template) and never used it, which is
  also why step 4 of the agent view had nothing to render
