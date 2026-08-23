---
title: Making parallel work visible
author: jwloka
status: active
created: 2026-08-15
updated: 2026-08-22
---

# Making parallel work visible

## Objective

Give a person running several agents at once a single place to answer two
questions: **where does this work stand**, and **what is everything waiting
for**. Four plans across five months had each answered part of that when this
story was written; **seventy-one** claim it as of 2026-08-22, sixty of them
released. The frame held — that growth is the story working, not outgrowing
itself — and the objective stays open while nine plans are still unanswered.

> Two of those nine had no `Story:` field until 2026-08-22 and were invisible to
> every reader that groups by story — a board-rendering bug and the lifecycle
> gap that leaves delivered work reading `Approved`. Both are board work by
> subject; the field was simply never filled.

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
- 🔄 `bb-state-vocabulary` — the board's PR data reaches Bitbucket repos at all; drafted 2026-08-18

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

- ⏸️ **A PR that cannot be merged reads *"no checks"*, which is true and
  useless.** Seen 2026-08-17 on PR #149: GitHub says *"This branch has conflicts
  that must be resolved"*, the board says `PR #149, no checks`.

  Both are correct. Measured: `mergeable=CONFLICTING`, `mergeStateStatus=DIRTY`,
  and `statusCheckRollup` is genuinely **empty** — GitHub does not start CI for
  a conflicting PR. So the board reports the *symptom* and withholds the
  *cause*.

  That makes `no checks` mean two unrelated things, needing opposite actions:
  a workflow awaiting human approval (`action_required`, the case the code
  comment describes) versus a branch that must be rebased. One waits on a
  person's click, the other on a rebase.

  The data exists and is simply never requested: `plot-host.sh pr-state`
  returns `number`, `state`, `draft`, `url`, `mergeCommit` — no mergeability
  field at all. The fix is a field in the adapter and a case in `classify`, not
  a new mechanism.

  Same shape as the rest of this story: one label covering two states, and the
  distinction is what the reader is supposed to do next.

- ⏸️ **The server binds one address family and the browser picks the other.**
  Observed 2026-08-17: the board sat at `ERR_CONNECTION_REFUSED` in Chrome while
  the process was running and healthy. Measured:

  | Address | Result |
  |---|---|
  | `http://[::1]:7777/` | **200** |
  | `http://127.0.0.1:7777/` | **000** — refused |
  | `http://localhost:7777/` (curl) | 200 — curl resolved to `::1` |

  `lsof` confirms it: `TCP [::1]:7777 (LISTEN)`, IPv6 only. Whether `localhost`
  resolves to `::1` or `127.0.0.1` is the client's choice, so one URL works in
  one program and fails in another on the same machine.

  It is the same class as the port defect `board-binds-port-zero` fixed, one
  layer down: not *which port* but *which address family*. And no in-page
  mechanism can report it — the document never loads, so the reader gets
  Chrome's own error page rather than anything the board could say.

  Noticed alongside it: a third `board-server.mjs` was running out of an agent's
  worktree, which is the accumulation the `pnpm board` point below describes.

- ⏸️ **WAITING ON A MACHINE has never once been populated**, and three separate
  causes keep it that way. Asked 2026-08-16 after the group sat empty through an
  evening in which roughly a dozen CI runs completed.

  **One entrance, and a draft PR cannot reach it.** Only `pr.checks ===
  'pending'` routes there (`fleet.ts:664`). But `fleet.ts:928` short-circuits
  every draft PR to `waiting-on-you` before `classify` runs, so a draft with CI
  in flight never arrives. That matters more than it sounds: `/plot-idea`
  creates every plan PR as a draft, so on a planning-heavy day *most* PRs are
  drafts.

  The sharp form of it — and this is more precise than the earlier reading that
  the checks were simply discarded: `draftNote` **does** read `pr.checks` and
  writes them into the text, so the row says *"PR #146, draft, CI running"*
  while sitting in the group that means *a person must act*. **The note and the
  group contradict each other on the same line.** The note was fixed; the
  routing was not.

  **The window is narrow but not impossibly so.** Measured across five runs:
  35 s, 141 s, 144 s and two that never started. PR data refreshes every
  60–120 s, so a 35-second run is genuinely likely to be missed — but a
  144-second one should appear in at least one poll. Timing alone does not
  explain an empty group.

  **And the operator was the waiter.** Every CI run that evening was awaited in
  a blocking loop and merged the moment it went green. The group exists so that
  *nobody* waits; waiting by hand keeps it empty by construction. The habit is
  the finding, not just the code.

  A fourth case is correct as it stands: GitHub reports `action_required` for
  workflows it will not start without human approval. Those have `checks:
  'none'` and route to WAITING ON YOU with the note *"no checks"*, which is
  exactly right — nobody is waiting on a machine that has not been allowed to
  start.

- ✅ **The data to fix the Draft-in-NOT-STARTED bug landed an hour after it was
  found, and nothing reads it.** → #154, 2026-08-17. Something reads it now, and
  the prediction held: one condition in `classify()`, no new field. Since #140 the pulse reports each plan's own
  `phase` — deliberately as data only: *"It is reported, never decides"*,
  *"nothing here decides which column"*. That split is right (scripts collect,
  consumers interpret), but it means the fix is now smaller than the finding
  below suggests: no new field, no scan change, just a condition in `classify()`.

  Seen again 2026-08-16, minutes after `working-rows-show-motion` was drafted:
  its two branches appeared under NOT STARTED, one reading *eligible — nobody
  has taken it*, while `plot-plan-meta.sh` reports `phase: draft`, no
  `Approved:` record and no `Started:`. Its plan PR had not even finished CI.

  The waiting age is the tell, and it is honest by accident: `plot-sprint-support`
  shows `6mo` while the draft's rows show `—`, because the waiting age is
  measured from the `Approved:` record and a Draft has none. So the row already
  *knows* it cannot answer — it just renders that as "age unknown" rather than
  "not approved yet".

- ✅ **A DRAFT plan's branches sit in NOT STARTED, inviting a dispatch that
  would be refused.** → #154, 2026-08-17. `classify()` reads the plan's own
  phase (`fleet.ts:719`) and answers `DRAFT_PLAN_NOTE` instead of `eligible`;
  the note is a shared constant so the two callers cannot drift. The fix landed
  exactly as predicted below — no new field and no scan change, because #140 had
  already put the phase in the pulse as data. Spotted 2026-08-16 from a
  screenshot: minutes after
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
- ⏸️ **Agents working on the board break the operator's board, and the reason
  compounds.** Seen 2026-08-17 with five agents in flight: the Agents tab
  reported *"Last scan failed"* and rendered **`0 branches across 0 plans`** —
  not a stale view, an empty one.

  Two causes, both measured:

  **`node --watch` restarts on every agent edit.** The operator's board runs
  under `--watch`, and three of the five agents were editing files under
  `packages/board/`. Every save restarts the server, and a freshly restarted
  process has **no cached pulse to fall back on** — so the *degrade, do not
  hide* behaviour from #141 has nothing to degrade to. The banner worked
  perfectly and named the exact failing command; there was simply no last-good
  payload behind it.

  **The scan reads other people's worktrees.** Since #137 `plot-fleet-scan.sh`
  runs `git status` inside every worktree on the machine. While an agent is
  mid-`commit` or mid-`rebase`, git holds `.git/index.lock` and that call fails.
  The function that makes agents visible is the one that trips over them.

  Compounding it: `pgrep` found **four** `board-server.mjs` processes, two
  started from agent worktrees — the agents launched boards to check their own
  work, exactly as their briefs asked them to test. That is the accumulation the
  point below describes, now with a second source: not just terminals, but
  agents.

  **Measured again at 02:00 on 2026-08-17, and the accumulation is narrower and
  worse than "terminals pile up".** Four processes; the two from an agent
  worktree listened on `56939` and `56967` — random high ports, so **`PORT=0`**,
  and `packages/board/test/helpers.mjs:37` is where that comes from. They were
  **orphans**: parent PID 1, started 01:54:31 and 01:54:49, the test run that
  spawned them long gone. Both still answered `/api/fleet` with `200`, so both
  were still polling.

  This bounds the `EADDRINUSE` adoption from #123 rather than contradicting it:
  that check answers *"is this port taken?"*, and a process asking for `PORT=0`
  has opted out of the question by construction. It cannot adopt and was never
  meant to. So the surviving hole is not the operator opening terminals — it is
  **test servers outliving their run**, and every worktree multiplies the
  chance. A third appeared within seconds of killing the first two, from the
  same worktree, because that agent was running its suite.

  A fourth process had **no listener at all** — the `--watch` supervisor between
  restarts. That is precisely the window that serves `0 branches across 0 plans`.

  The quota was fine (213/5000 GraphQL), so #123's backoff holds. The cost is no
  longer quota; it is that nobody can tell which board they are looking at.

  Worth stating plainly because it bounds the value of the fleet view: **the
  more parallel work there is, the less reliable the view of it becomes.**

- ⏸️ **A plan PR runs the whole board build to merge two markdown files.**
  Asked on 2026-08-17: *do we really need the build on `idea/` branches?*

  Measured. `ci.yml` triggers on `pull_request: branches: [main]` with no path
  filter, so every PR runs every step: `pnpm install`, skill parse and
  frontmatter validation, reconcile and e2e tests, board typecheck, a full board
  build with an artifact-freshness diff, 70 node:test, **a Playwright Chromium
  download**, and 398 vitest. PR #162 changes exactly two files, both markdown,
  and pays all of it — 2.5 to 4 minutes.

  **Seven plan-only PRs merged on 2026-08-17 alone** (#138, #139, #142, #145,
  #146, #150, #152), so this is the common case rather than an edge one.

  The cost is not only waiting. `validate` is a **required status check**, so a
  plan PR cannot merge without it — and on 2026-08-17 a run failed on #162 for
  *"picks up a plan pushed to a NEW branch"*, a test that passes locally and had
  passed on the identical `main` commit minutes earlier. **A flake in a board
  test blocked a pull request containing no code**, and the red check said
  nothing about the change it was gating.

  The obvious fix has a trap worth recording: `paths-ignore` on a **required**
  check leaves the PR permanently pending rather than green, because a skipped
  workflow is not a passing one. The shape that works is a job that still
  reports, and skips the expensive steps when the diff touches only docs.

  Not entirely free of judgement: `pnpm test` and `pnpm run validate` check that
  every skill parses, and a plan PR touching a skill file is legitimate. So the
  question is not *build or not* but *which steps hang on which paths*, and the
  cheap parse checks probably stay unconditional while the board build, the
  browser download and the integration suite become conditional.

  **Two different flakes in one evening, both on markdown-only branches**, which
  turns the cost from irritating into misleading:

  | PR | Failing test | Locally |
  |---|---|---|
  | #162 | `picks up a plan pushed to a NEW branch after the first read` | 11/11 pass |
  | #157 | `refuses with 403 when HOST is not localhost` (+2 more) | 11/11 pass |

  Neither branch contains a line of code. Both failing suites start **real
  servers on real ports** — the same surface the orphan and restart defects live
  on — so the reader is asked to distinguish a real regression from
  environmental noise on a PR that could not have caused either. A red required
  check that carries no information about its own PR is worse than a slow one.

  It also compounds the point above: because the checks are required, each flake
  costs a rerun of the *whole* pipeline, browser download included, to merge two
  markdown files.

- ⏸️ **`Approve` asks for configuration that `Start work` does not, for the
  same kind of work.** Asked on 2026-08-17 looking at a board where every Draft
  card offered `Start work` and none offered `Approve`: *if you can approve a
  plan, why can a button not?*

  Measured, and the asymmetry is real. `Start work` calls
  `plot-dispatch.sh` — a **script**, shipped with Plot, which the server spawns
  directly. `Approve` (#161) spawns `sh -c '<Approve command> "<prompt>"'` and
  hands it a prompt, so it needs **an agent** to execute the skill, and without
  the config key the button renders disabled naming that key.

  The code's own justification does not survive the comparison: *"it can approve
  only where the project has said how to run an agent"* — but `/plot-approve`
  under `Review: pr` merges a PR, flips a phase, writes an `Approved:` line and
  pushes. Every one of those is `gh` and `git`, which Plot already requires, and
  `plot-host.sh pr-merge` already does the first. Dispatch needs `Worker
  command` because it starts an agent that will WRITE AN IMPLEMENTATION;
  approving writes one line.

  So the difference is not *approve needs an agent* — it is **approve has no
  script**. The mechanical half belongs in `plot-approve.sh` beside its sibling,
  leaving the skill the judging parts (the tracer heuristic, the ceremony
  questions). Manifesto Principle 3 draws the line in the same place: scripts
  collect and report, skills interpret — and merging a PR is collecting.

  Also noticed on the same button: `ApproveButton` uses the **native**
  `disabled` attribute, which #160 deliberately abandoned for `StartWorkButton`
  — a natively disabled control leaves the tab order and takes its `title`
  explanation with it, out of reach of the reader who most needs it. Two buttons
  on one surface, two opposite patterns, because they were built in parallel.

- ⏸️ **A plan appears twice on the board while its own idea-branch is checked
  out.** Seen 2026-08-17: `agent-rows-line-up` rendered as two identical
  Discovery cards.

  **Not the symlink**, which was the first guess and wrong.
  `collectPlanFiles` already resolves through `fs.realpathSync` into a `seen`
  set, and its comment says so — a plan symlinked from `active/` is counted once
  under its canonical path. That mechanism is correct.

  The duplicate comes from the *other* collector: the board also stages plans
  found on **idea branches**, so a plan that is visible before it merges. With
  the plan's own branch checked out, the same plan exists twice — once in the
  working tree, once on its remote branch — and the two collectors do not know
  about each other. The staging comment anticipates a neighbouring case (*"two
  branches can carry same-named plans"*) but not this one.

  Narrow but not rare: writing a plan means having its branch checked out, and
  running the board while writing is the normal way to see the effect.

- ⏸️ **A test fixture inside the repo reads the repo's own config, not its
  own.** Found 2026-08-17 while building the board's Approve action.
  `plot-config.sh` locates configuration through
  `git rev-parse --show-toplevel`, so `packages/board/test/fixtures/tiny-garden`
  — a nested directory, not a repository — resolves to **plot's** `CLAUDE.md`
  and reads every key from there.

  It went unnoticed because the two agreed on every key that existed.
  `Approve command` is the first key where they differ, and the test would have
  passed while asserting plot's configuration rather than the fixture's: a green
  test measuring the wrong thing, which is worse than a red one.

  Worked around rather than fixed — those tests now copy the garden **outside**
  the checkout, where it is its own repository. The general case is untouched:
  any fixture nested in the repo has the same blind spot, and so does any
  adopting project that keeps a sub-project inside its own tree. Whether
  `plot-config.sh` should walk up to the nearest `CLAUDE.md` instead of the
  nearest git root is the open question — and it is a question about Plot's
  config resolution, not about the board.

- ⏸️ **`pnpm board` starts another board instead of adopting the running one.**
  **Partly fixed, and re-measured 2026-08-17 into a sharper finding.** The
  `EADDRINUSE` path added since means a second `pnpm board` on the same port now
  names the first and exits — pinned by the test *"a second board names the
  first and exits"*, which passes. What that cannot reach is a process that asks
  for **`PORT=0`**, which is what `packages/board/test/helpers.mjs` does for
  every integration test: it has opted out of the port question, so adoption
  cannot apply. Those are the ones that survive — see the orphan measurement in
  the point above. **The remaining defect is test servers outliving their run,
  not operators opening terminals.** Original finding, unchanged:
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
- ✅ **The checked-in artifact collides on every parallel branch** → #144,
  2026-08-16. `.gitattributes` marks `board-server.mjs` as `-merge`, so git
  keeps one side whole rather than splicing markers into 690 KB of generated
  output; the fix is *take either side, rebuild, commit*. Exercised twice on
  2026-08-17 (#154, #155), and both times the rebuild changed the file — proving
  the side taken was "wrong" and that it genuinely cannot matter. An attribute
  rather than a merge driver on purpose: a driver's definition lives in each
  clone's `git config`, so it would silently do nothing for anyone who cloned
  and configured nothing. The collision itself remains, and is now mechanical.
  Originally: three
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
- ⏸️ **`same branch` work is invisible to the fleet until pushed** — **half
  fixed, and the remaining half is the decision, not the code.** Same session,
  same screenshot: `feature/push-main-bypass` sat under NOT STARTED reading
  *"eligible — nobody has taken it"* while five commits existed for it locally.

  The **seeing** half landed with `fleet-sees-unpushed-commits` (2026-08-17):
  `local_ahead` counts commits the remote lacks, `local_dirty` reports an edited
  worktree, and a branch holding either is lifted out of quiet. So *this*
  machine now sees its own unpushed work.

  What that cannot reach is the flow itself. The scan derives everything from
  remote refs (Principle 1), so a branch nobody pushed is invisible to every
  *other* machine by construction — `local_ahead` is a local answer to a local
  question. `/plot-dispatch` pushes a claim; `/plot-implement` under
  `Impl: same branch` does not. **Whether it should push the branch at start
  remains undecided**, and it is the whole of what is left here.
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

### 2026-08-18 — The adapter translates replies, but not requests

**Expected:** `plot-host.sh` isolates both hosts behind one interface, so the
board's `pr-list --rich --state all --limit 300` works on Bitbucket as on
GitHub.

**Discovered:** It fails outright — `invalid --state 'ALL'`. The adapter maps
Bitbucket's vocabulary when *reading* a response (`DECLINED`→`CLOSED`, at every
call site) but sends the caller's GitHub word unchanged. `bb` has no `all`
token and calls closed PRs `declined`. A second flag, `--limit`, does not exist
in `bb` at all and was being forwarded the same way — so fixing only the state
word would have failed at the same line with a different error.

**Impact:** Every PR-dependent board group is empty on a Bitbucket repo, and has
been since the Bitbucket backend was added. It survived because Plot develops on
GitHub: its own backend is `github`, so that branch has no daily user and no CI
coverage. The fix is small; the missing piece is a stub-`bb` test giving the
Bitbucket path its first coverage. Planned in
[`bb-state-vocabulary`](../../plans/2026-08-18-bb-state-vocabulary.md).

**A `bb` defect found alongside, not fixed here:** repeated `--state` flags are
accepted and silently keep only the last — `--state open --state merged`
returned 50 PRs, all MERGED, the 3 open ones gone. No error, a plausible list.
Reported to `agent-skills`, which owns `bb`; the adapter issues one call per
state, so it does not depend on that fix.

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

### 2026-08-17 — A test that mistakes the machine for its sandbox

`discovery.test.mjs:276` asserts that repeated builds leave no staging
directory behind, and counts them like this:

```js
fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('plot-board-branch-')).length
```

The reasoning in its own comment is right — *"repeated builds must not
GROW the set … the one a single snapshot cannot see"* — but the counted
set is **`os.tmpdir()` globally**, not this run. While any other board
process is alive on the machine, the test measures that process's cleanup
too.

Measured on 2026-08-17 with up to five agents plus a live `pnpm board` on
one host: the test failed locally (`2 !== 1`), passed 11/11 on an
immediate re-run with no code change, and passed on a clean `main`. In CI
the same shared state failed the other way — `ENOTEMPTY: rmdir
'/tmp/plot-board-nested-*/outer/.git'` — a teardown race in which every
visible assertion passed (95/95, `# fail 0`) and the step still exited 1.

**This is the same shape as #166** (`test-boards-die-with-their-run`),
where test servers outlived their run: a test that treats the machine as
its own sandbox. Same trigger, too — several agents on one host, which
only became normal this month.

The fix is to scope the temp directories per run rather than counting a
global glob. Not yet planned.

A red required check that carries no information about its own PR is
worse than a slow one: it trains everyone to re-run rather than read, and
the one time it means something, nobody looks.

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
