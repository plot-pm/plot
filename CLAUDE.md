# Plot

Git-native planning workflow for software development. Plans are markdown files on branches; git is the source of truth.

**Design authority:** [MANIFESTO.md](skills/plot/MANIFESTO.md) — all design decisions must pass its 9-question checklist. When in doubt, the manifesto wins.

## Plot Config

Plot dog-foods its own config mechanism. Helpers read these via `skills/plot/scripts/plot-config.sh get <key> [default]`.

- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/
- **Plan directory:** docs/plans/
- **Active index:** docs/plans/active/
- **Delivered index:** docs/plans/delivered/
- **Sprint directory:** docs/sprints/
- **Plan template:** .plot/templates/plan.md
- **Claim stale after:** 24
- **Worker bound:** 28800
<!-- Seconds a single prompt run may take before the worker loop ends it — the
     FLOOR under the reading, not the reading itself. Since 2026-08-30 a worker
     ends when the WorkerMonitor reports `idle` (alive, no CPU across two
     passes, tree unchanged, commits on the branch), so this timer fires only
     when the monitor ITSELF has died. It was 3600 while it decided every
     worker's fate, and 3600 is what killed seven working agents on this estate
     that day — each with 3-6 commits, five losing a different last step. At
     28800 (a working day) no honest run reaches it and a monitor-less hang
     still cannot burn a night. `0` disables the floor, not the reading. See
     skills/plot/scripts/plot-worker-loop.sh. -->
- **Agent registry:** /Users/jwloka/Quatico/Agentic-Tools/plot/.plot/agents
- **Board command:** pnpm board
- **Worktree root:** .worktrees
- **Worker command:** PLOT_UNATTENDED=1 skills/plot/scripts/plot-worker-loop.sh
<!-- The loop script implements, then asks `--next` for the next wave, claims
     it, and moves to its worktree — repeating until the plan has no more
     claimable branches. The prompt itself lives in `.plot/worker-prompt.sh`,
     separated because plot-config.sh strips `(...)` as prose and the prompt
     contains shell constructs like ${PLOT_BRANCH##*/}.

     `bypassPermissions` is set in the prompt file, not here, because the loop
     script sources it. A detached worker is non-interactive: nobody can answer
     a prompt, and `acceptEdits` left one unable to run `pnpm test`,
     `pnpm build:board` or `git commit` — it wrote the code, reported honestly
     that it had verified nothing, and left the work uncommitted (2026-08-17).
     The cost is real and chosen: on the same day `plot-resolve-artifact.sh`
     ran `git merge` inside another agent's active worktree and retried 111
     times. Under this mode nothing would have stopped it. The brief is
     therefore the only guard a worker has — keep its scope guards explicit. -->

- **Idea command:** PLOT_UNATTENDED=1 claude -p --permission-mode bypassPermissions

<!-- `Idea command` runs `/plot-idea` on a tracker issue for the board's
     `Create plan` action. The board appends ONE argument naming a file it wrote
     — `Read <path> and follow it.` — and exports `PLOT_IDEA_PROMPT` with that
     path plus `PLOT_ISSUE` with the number. Nothing from the issue is ever a
     shell word: an issue body is free text from anyone who can file an issue,
     and a single `"; rm -rf ~` in a value interpolated into a `sh -c` fragment
     would execute. The file is the safety property, not a convenience.

     Deliberately SHORT where `Worker command` is long. A worker is handed a
     brief and told not to widen its scope, so its guards must be spelled out;
     `/plot-idea` IS the instructions, and every step of it is judgement. A
     prompt here that restated the skill would be a second, drifting copy of it.

     `PLOT_UNATTENDED=1` is a declaration, not a switch: there is nobody at the
     board to answer `AskUserQuestion`, and under `claude -p` that tool is not
     even registered — so a skill that improvises exits 0 having written
     nothing. Set, each skipped question takes the shape its author chose and
     names itself in the log. -->

- **Story command:** PLOT_UNATTENDED=1 claude -p --permission-mode bypassPermissions
- **Brief command:** PLOT_UNATTENDED=1 claude -p --permission-mode bypassPermissions

<!-- `Story command` runs `/story-tracking` on a tracker ticket for the board's
     `Create story` action — the twin of `Idea command`, and the same shape down
     to the argument: ONE argument naming a file the board wrote, `PLOT_ISSUE`
     with the number, `PLOT_STORY_PROMPT` with the path. Nothing from the ticket
     is ever a shell word, for the reason stated above.

     SET HERE, and that is part of the change rather than an afterthought.
     `Idea command` was configured and this was not, which is precisely why one
     button worked and the other refused. Shipping the capability without its
     first configuration would leave *Create story* still refusing in the repo
     that dog-foods Plot — honestly now, but with its happy path unexercised —
     and an unset key looks identical to a broken feature.

     The board counts story homes from `Story directory` (unset here, so the
     default `docs/stories/` — one home), NEVER from the filesystem. A measured
     client repo holds website content and image assets under paths matching
     `stories/`, where a search counts four homes and the declaration says one.
     Several DECLARED homes refuse and name the question rather than guessing: a
     missing story is recoverable, a story in the wrong home is referenced from
     elsewhere before anyone notices. -->

<!-- Optional: **Approve command:** how to run an agent headless for ONE prompt;
     the board appends `/plot-approve <slug>` and gets the full skill — the
     ceremony questions, the tracer heuristic, the in-session walkthrough.
     Without it the board runs `plot-approve.sh` directly, which does the same
     seven mechanical steps and refuses what needs a reader. -->

## Architecture

Plot is a hub-and-spoke skill system:

| Role | Skill | Purpose |
|------|-------|---------|
| Hub | `plot/` | Dispatcher — reads git state, suggests next action |
| Command | `plot-init/` | Adopt Plot in a repo: probe what it already is, propose the config from that, create the skeleton, offer extensions only where a signal justifies them |
| Command | `plot-board-setup/` | Set the board up in a project that has Plot: probe prerequisites, record git-host and CI config, then start the board and prove it serves |
| Command | `plot-idea/` | Create plan with ceremony matched to the change (two-question triage, posture gates) |
| Command | `plot-approve/` | Record the plan's approval through its declared review channel — and stop |
| Command | `plot-implement/` | Start/resume implementation: staleness preflight, branch setup, hand-off brief, Started record |
| Command | `plot-deliver/` | Verify all impl PRs merged (cross-repo aware), deliver the plan |
| Command | `plot-release/` | Cut versioned release with changelog |
| Coordination | `plot-sprint/` | Time-boxed sprint with MoSCoW priorities |
| Coordination | `plot-dispatch/` | Fan out an approved plan: one worktree + one detached worker per eligible branch, each claimed by ref push (the writing half of the fleet) |
| Coordination | `plot-merge-queue/` | Safe merge order + collision prediction for a plan's finished branches (read-only; merges nothing) |
| Coordination | `plot-pulse/` | Fleet pulse — which branch waves are complete/eligible/blocked, which branches are claimed (read-only, stateless) |
| Coordination | `plot-fleet/` | Fleet control — `--once`, `--status`, `--start [N]`, `--stop` over `plot-registryd` and its agents. Processes, not slices: `--stop` orchestrates `plot-dispatch --stop` per branch rather than adding a second stop rule, and unloads the supervisor LAST |
| Coordination | `plot-reslice/` | Slice a plan's multi-branch wave into one wave per branch — reads the branches' diffs and PRs, proposes named waves in an argued dependency order, a person confirms before it rewrites only the `## Branches` section |
| Automation | `ralph-plot-sprint/` | Automated sprint runner (shell loop wrapper) |
| Companion | `challenge-the-plan/` | Deep plan interrogation (design-phase: idea → challenge → approve) — usable standalone, not a plot spoke |
| Companion | `story-tracking/` | Multi-session work tracking (stories = umbrella around plans) — usable standalone, not a plot spoke |
| Companion | `tracer-bullets/` | Thin vertical slice strategy — usable standalone, not a plot spoke |

Spoke commands reference helper scripts via relative path: `../plot/scripts/plot-pr-state.sh`.

## Helper Scripts

Scripts in `skills/plot/scripts/` that any model tier can use:

| Script | Purpose |
|--------|---------|
| `plot-pr-state.sh` | Query plan PR state (draft/ready/merged/closed), asked through `plot-host.sh` so it answers on Bitbucket too. Reports `mergeCommit` rather than `mergedAt` — `git tag --contains <sha>` answers *which release holds this* where a timestamp cannot |
| `plot-impl-status.sh` | Query all implementation PR states for a slug |
| `plot-review-status.sh` | Check review freshness for sprint items |
| `plot-sprint-release.sh` | A sprint's declared `Release:` target and the state of every MoSCoW item (`done`/`open`/`disputed`) as JSON — the facts behind the release gate, and nothing else: /plot-release applies the rule, this decides nothing and never exits non-zero for unfinished work. The plan estate outranks the checkbox where there is one to read, but only in one direction — a checked box over an undelivered plan is `disputed`, while an unchecked box over a delivered one is `done`, because /plot-deliver moves the plan and nobody re-ticks the box. Reports every active sprint, since two teams may share one train |
| `plot-sprint-candidates.sh` | The plans a sprint could contain — every unfinished plan (phase neither delivered nor released) with its title, story and changelog as JSON, plus `changelog_available`. Collects and ranks **nothing**: which plans serve a stated goal is the semantic judgement `/plot-sprint` makes at Frontier tier, and the case the feature exists for — goal *"the board tells the truth"* against plan *"none printed before the first fetch"* — shares no word, so any score a shell could compute would rank it last. A file with no phase is skipped: `docs/plans/` holds decision logs and worker reports that are not plans. Assembles through `node`, not `sed`, because a `"title":"[^"]*"` match truncates at an escaped quote and this repo titles plans `... is not "no commits yet"` |
| `plot-update-board.sh` | Update GitHub Projects board status for a PR |
| `plot-plan-meta.sh` | Parse plan files → JSON (phase, type, title, sprint, story, assignee, branches, PRs, `Review:`/`Impl:` ceremony answers, `Approved:`/`Started:`/`Delivered:`/`Released:` transition records); the plan-format contract |
| `plot-context.sh` | Read-only: which plan governs the current branch, its phase, wave, and PRs → JSON. Supplies plot-shaped facts to whatever writes session logs; Plot never writes them itself |
| `plot-detect-repo.sh` | Read-only adoption probe → JSON (git host, DoD candidates, ticket scheme, commit style, existing planning systems, hub docs); every field is a proposal a human confirms |
| `plot-board-probe.sh` | Read-only board-readiness probe → JSON (node version, repo shape, artifact location, config presence, plan count, `gh`/`bb`/`jen` auth). Auth is `ok`/`failed`/`unknown` — an unrecognised output reads as *cannot verify*, never as authenticated |
| `plot-board-verify.sh` | Starts the board on an OS-assigned port, fetches `/api/board`, prints the payload, and reaps the server via `trap`. A script rather than skill prose *because* of the teardown: "always stop the server" is a rule an agent can believe it followed; the trap is a gate the shell enforces on every exit path |
| `plot-config.sh` | Read a `## Plot Config` key with a default (`get <key> [default]`); includes the optional `Plan template` override key, the `Agent registry` key (where the board's registry reads agent manifests; default `.plot/agents`, so a single-checkout project is unaffected), the agent-runner keys (`Worker command`, `Approve command`), and the Plot 2 posture keys (`Plan PRs`, `Implementation home`, `Hosts plans`, `Tracker`, `Git host`) |
| `plot-host.sh` | Git-host adapter (gh/bb): `backend`, `default-branch`, `pr-state`, `pr-create`, `pr-merge`, `pr-list`, `pr-body`, `issue-list`, `issue-view` — the ONE place that talks to the host CLI, gated by `scripts/check-host-cli-callers.sh` since 2026-09-05. `pr-list` takes `--repo` like `pr-state` and `pr-merged`: a checkout with remotes on two hosts lets an unpinned list enumerate the wrong repository, and a caller joining it against `origin/*` refs then reads every branch as having no PR. The two issue ops READ and never write: Plot reads the tracker and a plan referencing an issue is Plot's record, not the tracker's. `issue-list` runs on the PR timer and omits bodies; `issue-view` fetches one issue's body per click, for the board's *Create plan* action. Both exit 4 where the host cannot be asked at all (bitbucket), which is not the same answer as an empty list |
| `plot-approve.sh` | The mechanical half of approving a plan: merge the plan PR, flip the phase, fill `Approved:`, clear the `.plot/hold` entry for each branch the plan names, update the sprint annotation, push via `plot-push-main.sh`. Idempotent — step 2 writes irreversibly to the host, so re-running is the repair for any interruption after it; every step tests the source it would have written, never a progress file. Refuses a non-Draft plan, a `Review:` other than `pr`, and a draft/closed/absent PR |
| `plot-deliver.sh` | The mechanical half of delivering a plan: flip `Phase: Approved` → `Delivered`, fill the `Delivered:` record, move the `active/` → `delivered/` symlink (best-effort), update the sprint annotation, push via `plot-push-main.sh`. Idempotent — the push is irreversible, so re-running is the repair for any interruption; every step tests the source it would have written, never a progress file. Refuses a non-Approved plan and any non-deferred branch unmerged |
| `plot-phase-gate.sh` | PreToolUse hook (see `hooks/hooks.json`): blocks implementation commits while the governing plan is Draft; plan-only commits pass; fails open. Reads the plan from `origin/<main>`, never the working tree — an approval nobody else can see is not one. When that ref is unreadable it allows the commit **and says the phase went unverified**: failing open, not failing silently |
| `plot-story-lint.sh` | Story-estate drift check (missing STORY files, frontmatter, done-not-archived, index sync); machine-countable footer; exit 1 on findings |
| `plot-reconcile-scan.sh` | Read-only plan/branch drift sweep (twelve sections + machine-countable footer); section 3 classifies empty claims — `deferred:`/`moved:` in the plan means reapable, a bare `claimed:` means needs judgment. Section 5 (`attention=`) is what gates; section 7 (`index_drift=`) is convenience and gates nothing — since the phase grouping became derived, a plan with no symlink is visible everywhere that decides anything, so a missing link is a browsing gap while a **dangling** link is still a broken pointer. A file with no `Phase:` field is not a plan, the same rule `plot-fleet-scan.sh` applies. Section 12 (`double_claims=`) reports a branch listed by MORE THAN ONE plan, naming both and their waves; it reports and never gates, and it sits last so `/plot-deliver`'s `== 7.` gate marker keeps its meaning |
| `plot-dispatch.sh` | Slice fan-out: it hands slice + brief to the registry and returns, creating no desk, pushing no claim and starting no worker — `DESIGN-agent.md:157`, *"nothing starts a worker"*, and the desk is the agent's because only the agent can see its own tree. It refuses nothing for want of a free agent and never asks: the queue absorbs the timing, and a queue longer than the pool is the normal case. The eligible list is read ONCE rather than pulled per branch, because nothing the run does moves the scan's answer once no claim is pushed. `--restart` and `--start` are the two verbs that launch a worker; `--dry-run`/`--no-start`/`--max N`; idempotent — re-running adopts rather than duplicates. `--start [N]` brings FREE agents into existence — registered, waiting, holding no slice, defaulting to three — which is the last link in *dispatch queues → registry matches → an agent takes it* and had no starter at all until 2026-09-05, when a dispatch reported `started=0` against `agents registered: 0`. Each desk is cut DETACHED at `origin/<main>`: a free agent has no branch to cut one from, the loop's own `reset_desk` already passes through exactly that state, and detached is not the default branch `plot-reap.sh` refuses on for a reason that describes a tree whose dispatched branch was never checked out. The count is a REQUEST — `rules/fleet-size.ts` subtracts the workers already running and lets the machine reduce it further — and a shortfall is reported and never remembered. Its phase gate reads the plan from `origin/<main>`, never the working tree, and **fails closed** when that ref is unreadable — `--allow-local` is the explicit, named escape for a repo with no remote. Before fanning out it reports which other branches already hold which files, read from local refs and worktrees (so unpushed and uncommitted work counts) — that report refuses nothing, because nothing on the candidate side is predicted. It DOES refuse a branch whose own worktree exists carrying unlanded work: a shared file is a prediction, but a desk somebody is sitting at is a measurement. Unlanded means commits not in the default branch OR uncommitted changes — an agent mid-edit has often committed nothing, and a worktree cut minutes ago reads as merged by ancestry alone. The worktree is found by asking git which one holds the branch, never by rebuilding the path from the branch name: hand-made worktrees are the population with no claim ref, and they rarely follow dispatch's naming. It reads the same local refs and worktrees, which is why dispatch is the only component that can see it — the fleet scan derives from `origin/<branch>`, and the measured failure was two implemented, green branches whose work was never pushed, so no claim existed and both read `eligible`. It names the worktree and claims nothing on the operator's behalf; `--allow-local` has no bearing on it, and a leftover worktree whose tip already merged stays dispatchable. `--restart <branch>` is the counterpart to `--stop`: it hands a branch that ALREADY holds a claim to a new worker, the one thing a slug dispatch can never do, because `--next` offers only `open` branches and that lock does not move. The branch is explicit and never auto-selected — replacing a stopped worker rather than reviewing, reaping or abandoning its work is a person's call. **The PR is asked FIRST, before the state word:** five of five `failed` worktrees measured here held a PR (four open, one merged), since `plot-worker-state.sh` refines `finished` by the tree and deliberately does not refine `failed`, so a gate on the state word alone would restart all five and destroy what the `finished` refusal protects. It then refuses on a live pid and on a `PLOT-BLOCKED` marker, and restarts `stalled`/`failed`/`ended`/`none` alike; a `failed` worker with NO PR must restart, or the verb cannot do its job. No `--force`, and the tree is inherited untouched — a stall IS uncommitted work, and one measured here left 324 finished lines on the floor. It starts through `start_worker`, so the manifest is written by one writer and the fleet can see what it started |
| `plot-merge-queue.sh` | Merge order + `git merge-tree` conflict prediction per plan; flags branches that collide with one ahead of them in the queue |
| `plot-resolve-artifact.sh` | The ONE automatic write: repairs an artifact-only merge conflict — merge, take a side, `pnpm build:board`, `pnpm run test:board`, push **only on green**. Refuses any conflict set that is not exactly the artifact, and takes a per-branch lock so two repairs never run on one branch. Licensed by three verified properties (`-merge` keeps the file valid, the rebuild is deterministic, CI's no-diff gate proves it) and by nothing else — a script rather than an agent, because judgement's absence *is* the permission |
| `plot-reap.sh` | Removes a dispatch worktree whose work has landed, and nothing else — the reaper `plot-reconcile-scan.sh:323` already referred to before one existed. `--dry-run` by default; `--yes` removes; `--max N` bounds it. Refuses on five MEASUREMENTS, never a judgement: a live worker pid, uncommitted changes, a `PLOT-BLOCKED*` marker, a tree sitting on the default branch (its dispatched branch is not checked out, so its state was never measured), or no merged PR. Reads `mergedAt` and **never** `state` — a merged PR reports `CLOSED`, and squash-merge leaves the branch permanently "ahead of main", which is why ancestry alone cleared 1 of 29 finished trees here and the host cleared the other 28. Branches and refs are untouched: it removes CHECKOUTS, so every reap is re-creatable with `git worktree add` — refs are `plot-release-refs.sh`'s, which runs after it and needs its own licence because a deleted ref is not re-creatable at all |
| `plot-release-refs.sh` | Deletes the REMOTE refs of ONE plan's merged branches, after the reap. Plan-scoped where the reaper is slug-blind, and that asymmetry is the safety argument: a removed checkout comes back with `git worktree add`, a deleted ref does not, so the blast radius is bounded by the plan file — a sweep over every merged ref on the estate satisfies "a delivered plan's merged branches lose their refs" and destroys unlanded work belonging to plans nobody delivered. `--dry-run` by default; `--yes` deletes; `--max N` bounds it. Five guards: a `deferred:`/`moved:` branch (given up, not finished — `/plot-reconcile` needs the ref *plus* its annotation), no merged PR, an **open** PR (`changeset-release/main` is merged repeatedly and Changesets recreates and reuses it, so a live release PR sits on a ref whose own older PR merged), a branch checked out in any worktree, and the default branch. Deleting the remote ref only: the scan derives from `origin/<branch>`, so a local branch costs it nothing and is the last copy of a reflog. Measured 2026-08-27 — deleting nine merged branches took the scan 218.5 s → 111.5 s |
| `plot-pr-merged.sh` | The ONE answer to "did the host merge ANY PR for this branch?" — **sourced, not run**, by `plot-reap.sh` and `plot-release-refs.sh`. Extracted from the reaper on 2026-08-28 because ref deletion needs the SAME gate and the two must never disagree: the reaper removes a re-creatable checkout, ref deletion is not undoable, so a second implementation drifting toward permissive would fail in the direction that cannot be repaired. Reads `mergedAt`, never `state` (a merged PR reports `CLOSED`) and never ancestry (squash-merge leaves a branch ahead of main forever), across ANY PR rather than the newest (`--limit 1` reported three branches unlanded whose work was on main, each masked by a duplicate the fleet opened itself). An unreachable host answers *not merged*, so silence is never permission. `pr_open` sits beside it and can only ever KEEP a ref |
| `plot-fleet-scan.sh` | Read-only wave/claim state per plan (complete/eligible/blocked + machine-countable footer); `--next` names one claimable branch (exit 1 = nothing to start); stateless — re-derived from git refs every run. `--stream` emits the same `--json` derivation as it resolves — one line per plan, then a terminal `pulse` line — because the scan is 18.3 s against the board's 5 s cadence and git alone is 12.7 s of that, so the wait is structural. The terminal line is what says the scan finished; a closed pipe does not, since a killed scan closes it too. A branch in a **terminal** state — merged or deferred, 26 of 54 here — is asked about once: the board holds the answers in memory and hands them back through `PLOT_TERMINAL_CACHE`, the scan reports the next pulse's map on stderr. Only the host round trip is skipped; git is re-consulted every pass and the entry is discarded the moment it disagrees, which is what keeps it a derivation rather than a record |
| `plot-fleetctl.sh` | Fleet control's mechanics: `--once` (one supervisor tick, the gate — a tick decides and performs nothing, so it is free), `--status` (is the supervisor alive, which agents run, how long each has been quiet — starts nothing, exits 1 when it is not loaded), `--start [N]` (fill the platform's unit, verify the fill, load it, then hand the agent count to `plot-dispatch.sh --start`), `--stop`. Four refusals, each a measurement: no `plot-registryd.mjs`, a `node` that is not `.nvmrc`'s major (**the unit bakes `$NODE` in permanently** — measured 2026-09-05, `command -v node` answered 26.7.0 against a repo pinned to 24), no launchd or systemd, and a label already loaded (launchd keys by LABEL, so a second checkout loading over the first supervises the wrong estate silently). The fill is VERIFIED rather than assumed — a surviving `__PLACEHOLDER__` deletes the unit and refuses, and `plutil -lint` gates the plist. `--stop` is an ORCHESTRATION, not a second stop rule: it calls `plot-dispatch.sh --stop <branch>` once per dispatched agent, reports each branch as it goes, bounds each wait at 30 s (`--wait N`) and names what did not exit rather than waiting forever, and unloads the supervisor LAST — it is what would notice a desk falling idle, so a stop that fails partway leaves a watcher over the remainder. A FREE agent holds no branch (`--start` cuts its desk detached at `origin/<main>`), so the one stop rule cannot name it; those are reported and left running rather than signalled through an invented second rule |
| `plot-worker-state.sh` | The ONE answer to "is a worker running in this worktree?" — **sourced, not run**, by both `plot-dispatch.sh` and `plot-fleet-scan.sh`. Returns facts (state, pid, exit code) and renders nothing, because the two callers need different shapes of one computation: `--status` prints prose for a person, `--json` emits tab-separated fields for a machine. It carried five of its six states in duplicate until 2026-08-18, and the copies had already drifted on the sixth. It now answers eight: six about the PROCESS, plus `waiting` and `stalled` about the TASK — every worker exits 0, so the exit code cannot say whether the work is done |
| `plot-estate-changed.sh` | Has the estate changed since this run last asked? `0` = changed (or cannot tell) → ask; `1` = unchanged. The shell half of the master agent's entry point: `plot-ask.mjs` answers the QUESTION, this answers *is a second ask owed?* A **measurement, never a timer** — it hashes what the scan reads, every remote ref's SHA and every plan file's CONTENT, so the delivery gate's own fix is always seen (a phase flip changes plan bytes, the push that follows moves a ref). A clock would answer "was it recent?" when the question is "did it change?", and those differ in exactly the case the gate creates. mtime is a clock too: a checkout moves it without changing what the scan reads. It **fails toward asking** — no git, no plan directory, an unwritable state file all exit 0 — because skipping a scan costs minutes while skipping the gate costs a half-landed delivery nobody notices. A separate script rather than a flag on `plot-ask.mjs` because a skill runs each bash block in its own process, so the digest must outlive the process in a file; the file's SCOPE replaces the object's lifetime, and it is deleted when the gate clears because the guard cannot see a PR merged on the host |
| `board/plot-ask.mjs` | The master agent's entry point — the board's controller reached without HTTP: `plot-ask.mjs <board\|fleet>`, one JSON answer on stdout. `node` rather than a call to a live board, because a board is optional and none was running when the choice was measured; seven skills would have gained a dependency whose failure arrives as a skill that works on the operator's machine and not in a worker's. The cost is stated: this path re-derives what a running board already computed, and an HTTP fast path can be added later **without changing any caller**, because this artifact is the seam. A SECOND bundle rather than a flag on `board-server.mjs` — `index.ts` binds a port at import time, so a flag would mean a skill that asks a question also starts a server. The transport fields are left exactly as the controller emits them: rewriting would invent a permission no caller granted, so an unavailable capability with an EMPTY reason reads as an absence, and every real refusal carries a sentence |
| `board/board-server.mjs` | Local Kanban status board — built artifact of `@plot-pm/board` (`packages/board`); run via `pnpm board`, rebuild via `pnpm build:board`. `pnpm board` runs under `node --watch`, so a rebuild takes effect in the running board — without it, a merged fix stays invisible to an open board and reads exactly like the fix not working |
| `board/plot-registryd.mjs` | The supervisor — one per repository, built artifact of `@plot-pm/board`. Each tick it re-reads the `Agent registry` directory and the desks the manifests name, judges each agent by its declaration plus the five gates, and decides one of five: leave a live worker, reap a finished desk, hand an unfinished one a correction naming what is missing, defer on a bound, or mark a spent one for a person with a `PLOT-BLOCKED` marker. **It decides and performs nothing** — the decision names every write and makes none, so `--once` against a live estate is safe. It holds nothing between ticks, and that is measured rather than argued: a daemon `kill -9`ed two seconds into a 3.4 s tick was followed by a whole tick reaching the identical decision, with no state file written. `attempts` is the supervisor's counter and the only one the budget reads; `relaunches` stays a person's record, so three manual `--restart`s never spend the automatic budget. Tick interval 60 s against a tick measured at 3496 ms for three agents at load 38 — 6% duty, so the per-agent term can grow about tenfold before ticks overlap. The interval is waited AFTER a tick rather than between starts, so two never run at once on one registry. It supervises only the agents this machine registered: reaping a desk needs the desk, and an agent dispatched from another machine dies unsupervised by this daemon. **A tick that cannot complete reports and the loop continues** — the reason goes to stderr, the decision is empty rather than truncated, and the next tick re-reads the registry and the desks from disk; there is no journal, no lock file and no resume path, because the recovery from a failed tick and the recovery from a `kill -9` are one code path. `launchd`/`systemd` keeps the process alive, and the two units plus their install steps are in `skills/plot/units/`. **Each tick also derives the QUEUE and matches it to whoever is free** — an eligible slice with a brief and no claim IS queued, so nothing is stored and a restart mid-pass loses one pass's readings and no assignment. It matches AFTER supervising, because supervision is what frees an agent by reaping a finished desk or marking a spent one. `matchQueue` is the assignment lock and there is only one: one slice to one agent, never the same slice twice, held by the shape of the pass rather than by a check it could forget. **`--start-agents` is the one write it performs**, and it is opt-in: a tick with a queue nothing can take starts free agents towards the board's own `Parallel agents` cap, read fresh every tick so the stepper and the daemon cannot give two answers to one question. Three desks per tick is a rate limit on the tick and not the fleet's size. Every other write the tick names is still decided and never performed, and a run without the flag changes nothing on the machine |

Design split (Manifesto Principle 3): **skills interpret and adapt; scripts collect and report.**

## Model Tiers

Every skill includes a `## Model Guidance` table mapping steps to capability tiers:

- **Small (Haiku)** — Mechanical: git commands, template filling, structured output parsing
- **Mid (Sonnet)** — Heuristic: title similarity, version bump suggestions, discovery with rules
- **Frontier (Opus)** — Judgment: completeness verification, semantic gap detection, unstructured comparison

Smaller models degrade gracefully — they ask humans where larger models decide autonomously. When changing steps in a skill, update its Model Guidance table.

## Phase Guardrails

Four workflow phases: **Draft → Approved → Delivered → Released**

Each command validates the current phase before acting:
- Cannot approve an unreviewed draft
- Cannot deliver with open implementation PRs
- Cannot release undelivered work

## Project-Agnostic Design

Plot contains zero hardcoded project names, paths, or configuration. Adopting projects describe their conventions in a `## Plot Config` section of their `CLAUDE.md`. Plot discovers and adapts — never enforces.

## Skill Authoring

- Each skill directory: `SKILL.md` (frontmatter + instructions) + `README.md` (dev docs, required)
- **Use `/writing-skills`** when planning, creating, editing, or reviewing skills
- Progressive disclosure: overview in SKILL.md, details in referenced files
- Third person ("Processes files" not "I help you process files")
- Keep skills generic — no account-specific data
- When skills say "ask the user", use `AskUserQuestion` (Claude Code) / `ask_question` (Cursor)
- Keep the root README.md skills table in sync

## The Domain Package

`@plot-pm/domain` is new code and holds a stricter style than the board it was
extracted from. These three rules apply to `packages/domain/**` and **not**
retroactively to `packages/board/**` — measured 2026-08-29, the board carries
507 `function` declarations against 6 arrows, and rewriting them would produce a
repo-wide diff with no behaviour change that destroys `git blame` for every
touched line.

**The design spec's terminology is binding.** The specs in
`docs/stories/the-master-agent-holds-the-fleet/` define the vocabulary, and code
follows them rather than the other way round. In particular a **Slice** holds
exactly one branch and belongs to one plan; a **Wave** is the fleet's cohort,
spans plans, and is persisted nowhere ([DESIGN-slice.md](docs/stories/the-master-agent-holds-the-fleet/DESIGN-slice.md)).
The code still says `Wave` where it means `Slice` — that is a known defect with
its own plan, and **no new code may add to it.**

**An Agent is the actor; "worker" is only how a process sees it.**
`DESIGN-agent.md` settles this: *"A 'worker' is not a separate thing an Agent
has — it is the Agent, observed through the process table."* So the actor is
named **Agent** everywhere it is the subject, and future specialised agents that
are not loop-workers stay expressible.

`Worker` survives in exactly two places, and both are about the PROCESS rather
than the actor:

- the six process states (`running`, `finished`, `failed`, `ended`, `none`,
  `elsewhere`) — literal process-table observations
- the config keys `Worker command` and `Worker bound`, which name what a
  dispatched agent *runs* and how long its loop may take

**A Worker is the process an Agent runs on a Machine.** It is not a synonym for
either and not merely a view of one — it is what connects them:

```
Machine  ──hosts──►  workers          (many; the resource they compete for)
Agent    ──runs───►  one worker       (at a time; its process, while it lives)
Worker   = an Agent's process on a Machine
```

**`elsewhere` is the proof.** It means *"no worktree on this machine"*
(`DESIGN-agent.md`) — an agent that exists while its worker runs somewhere else.
That state is only expressible if the worker is the LINK rather than a view: a
view of an agent cannot be somewhere the agent is not. `machineAtDeath` closes
the same circle — a worker dies **on** a machine, and that machine's state at
the moment is worth recording.

**The eight states split along the same line, and the source decides.** Four are
Worker facts read from the process (`running`, `failed`, `ended`, `none`); two
are **Agent** facts read from the desk (`waiting` — a `PLOT-BLOCKED` marker;
`stalled` — unlanded work); `finished` is a Worker fact the desk refines; and
`elsewhere` is a Machine answer. `plot-worker-state.sh:46` decides the two
workflow states from the TREE, never from the process — an exited process is a
precondition for reading them, not the reason they hold.

**For new code this means:** a state answering *what is the process doing?* goes
on the worker; one answering *what does this agent owe, or still hold?* goes on
the agent. They live in one enum today for a historical reason, and that is not
a licence to add a workflow state to the process side.

**So the vocabulary follows the component doing the observing:**

| | **Machine** | **Registry** |
|---|---|---|
| sees | processes | identities |
| counts | **workers** | **agents** |
| answers | *is it running, and what did it cost?* | *who is this, and what may it do?* |
| when absent | the process is gone | the agent was never declared |

The specs already speak this way. `DESIGN-machine.md` measures *"7 workers died
`exit 124`"* and *"five workers ran fine at load 10"*; `DESIGN-agent.md` draws
`registry ──provides──► agents`. **So `Worker` is Machine-side vocabulary and
`Agent` is Registry-side**, and a field belongs to whichever component produced
it.

That is why the exceptions are exceptions rather than inconsistencies: the six
process states, `WorkerActivity`, and `Worker command` / `Worker bound` are all
things the machine observes or launches. **A specialised agent that never
becomes a loop-worker still has a registry entry and still has no worker
fields** — which is precisely the shape this split keeps expressible.

**Arrow functions, not declarations.** `export const f = (…) => …` in the domain
package. The board's style is not the model here.

**And anywhere else, a function you write or rewrite is an arrow.** The scope
above is about what gets CONVERTED, not about what gets written: the board is
not migrated wholesale, but a new helper in a board file or a test is an arrow
like everything else. The rule follows the diff.

**The unit is the function, not the file.** Renaming a type inside an existing
signature does not make its 60 neighbours yours to rewrite — that produces a
diff with no behaviour change and destroys `git blame` for every touched line,
which is the same measurement that scoped the conversion in the first place.
If you are writing the body, it is an arrow; if you are passing through, leave
it.

**No gate enforces this outside `packages/domain/src/`**, and the CI check
greps only there. Measured 2026-08-30: a new test helper in `test/reconcile/`
was written as a declaration, sitting between two arrows in the same file, and
what caught it was a person reading the diff. That is the difference this repo
draws between a rule and a gate — so this one is a rule, and it needs reviewers
who know it.

**Factual API documentation.** A TSDoc block says what an export does, what its
parameters mean, what it returns, and how it fails. It does not narrate the
history of the decision. Measured on the first rule moved into the package:
**28 lines of code carrying 109 lines of comment**, a 4:1 ratio, most of it
argument rather than interface.

**Where the reasoning goes instead**: the plan, and the commit message. Both are
dated, both are searchable, and neither is read by someone trying to learn what
a function returns. A measurement worth keeping — *"a plan with no merged slice
read as delivered, 2026-08-20"* — belongs in the commit that introduced the
guard, so `git log -S` finds it.

## The Layering Rule

**Settled 2026-08-30.** One direction, no shortcuts:

```
controller  →  domain  →  port  ←  adapter  →  script / git / process
```

- **A controller calls the domain.** It never spawns.
- **The domain owns the port** — an `interface`, no runtime code. It defines what
  it needs; it does not import an adapter.
- **An adapter implements the port** and is the only place that may reach the
  world. `machine-system.ts` imports `ports/machine.js`; `ports/machine.ts`
  names `adapters/` zero times. **The dependency points inward.**
- **Scripts can only be called from an adapter implementation.**
- **A connector is a kind of adapter, and the distinction is load-bearing.** A
  connector reaches a **remote service**: it has an account, credentials, a rate
  limit and a transport choice. Every other adapter reaches the local machine,
  where none of those exist. Measured 2026-09-01: of nine adapters, **one** is a
  connector — `host` shells to `plot-host.sh` and its 11 `gh`/`bb`/`jen`/`jira`
  calls, while `refs`, `processes`, `plan-store` and `performer` shell to scripts
  that make **zero**. `refs` carries 12 ops to `host`'s 6 precisely because
  nothing charges for `git rev-parse`.

  **The rate-limit contract therefore belongs to the connector kind, not to
  every adapter.** Only a connector answers *what is your limit and how well do
  you know it*, records what a call spent, and chooses REST versus GraphQL. A
  filesystem port must not be made to implement any of that.

  **It stays on the adapter side of the port, with one exception that is not
  yet fixed.** `Host` names six questions and no transport, no account, no
  bucket. **But `ports/host.ts:6` declares `HostBackend = 'github' |
  'bitbucket'`** — a closed list of vendors, in the domain — and
  `host-shell.ts:110` throws on anything else. So adding GitLab is **not** an
  adapter-only change today; it needs that type widened. Treat the adapter-only
  property as the target, not the current state. See
  [`one-account-has-one-budget`](docs/plans/2026-09-01-one-account-has-one-budget.md).
- **No domain-specific code or behaviour lives outside the domain.**

**Half of this is enforced.** The purity gate holds the inner boundary: outside
`packages/domain/src/adapters/`, the domain may import `zod` and nothing else —
measured 0 violations. The outer boundary is not enforced: `packages/board/src`
holds **65** `spawn`/`execFile` lines across 23 files, and CI has zero path
references to it.

`the-sprint-proves-its-own-goal` adds that gate as a ratchet; `production-calls`
does the migration it counts.

**Every rendered state is a domain property.** Settled 2026-08-30, and it is the
testability half of the rule above:

> **All existing workflows, and all view states that are rendered in HTML, can be
> tested through state properties or behaviour on domain objects.** That makes
> every important thing we can *show* or *manipulate* unit-testable.

**What this rules out** is a decision made in a component. If a row's section, a
button's disabled state, or a badge's wording is computed in `.tsx`, the only way
to test it is to render it — and rendering is how 42 of this repo's 43 browser
tests came to start a full board server.

**What it does not rule out** is browser tests. It changes their subject: they
stop being where behaviour is *decided* and become where it is *seen*. A
`verdict` computed in the domain and asserted in a unit test still needs one
test proving the badge shows it.

**The measurable form:** a view state that cannot be asserted without a browser
is a domain property that has not been extracted yet.

**A note on shape.** The domain here takes **readings as values**, not ports —
`reap(readings, input)` rather than `reap(ports)`. No rule or workflow imports a
port or awaits anything. That keeps the core synchronous and testable without
mocks; the cost is that the caller decides what to read. It is a deliberate
variant of ports-and-adapters, not a deviation from the rule above.

## Gates Over Rules

**For important agent behaviors, always implement gates, not rules.** ([Reference](https://blog.fsck.com/2026/04/07/rules-and-gates/))

- A **rule** is a guideline the agent can rationalize around. Rules live in `CLAUDE.md` or skill instructions and depend on the agent choosing to follow them.
- A **gate** is a hard stop with objective verification — enforced via hooks (PreToolUse / PostToolUse) where the agent cannot proceed without meeting a concrete, checkable condition.
- **The test:** Can you answer "Did I complete this?" without actually doing the work? If yes, it's a rule. If no, it's a gate.

When writing skills that include critical workflows (phase guardrails, branch creation, PR state checks, destructive operations), prefer gates via hooks over prose-only instructions. Even when the user casually says "add a rule for X," evaluate whether it should be a gate and implement accordingly.

**Skill authors:** If your skill includes a "MUST" or "NEVER" instruction, ask: is this enforced by a hook, or just written in prose? If prose-only, it's a rule and will eventually be violated. Convert critical MUSTs to gates.

**`plot-host.sh` is the ONE place that talks to the host CLI — and that is now a gate.** It was prose here throughout, and on 2026-09-05 four scripts violated it: `plot-reconcile-scan.sh`, `plot-agent-monitor.sh`, `plot-pr-state.sh` and `plot-pr-merged.sh` each held their own `gh` call. A second caller does not merely duplicate — every one of those asked about GitHub and nothing else, so a Bitbucket checkout got a helper that was absent rather than wrong. `scripts/check-host-cli-callers.sh` is the gate; its exception list names four scripts, each with the reason it asks a different question.

**Examples in plot:**
- The four phase guardrails (cannot approve unreviewed draft, cannot deliver with open impl PRs, cannot release undelivered work, etc.) are currently rules embedded in spoke commands. Stronger forms would be gates: a PreToolUse hook on `gh pr merge` that reads the plan's phase and blocks merges that violate the lifecycle.
- The "always run `pnpm test`" instruction in Testing above is a rule — a candidate for a gate via a pre-commit / pre-push hook.

## One Answer To "Did This Land"

**The host answers, not git.** `skills/plot/scripts/plot-pr-merged.sh` reads `mergedAt` — never a PR's `state` (a merged PR reports `CLOSED`), and never ancestry. Measured 2026-09-04 on this estate: ten merged branches still carried a remote ref, and `git merge-base --is-ancestor` disagreed with the host on **ten of ten**. Squash-merge rewrites the commits, so a merged branch stays ahead of main forever.

**`scripts/check-ancestry-decisions.sh` is the gate, and it bans the decision rather than the call.** Two ancestry callers here are correct: `plot-merge-queue.sh` skips a branch already in main before predicting a conflict, and `refs-git.ts` answers `unknown` when it cannot tell. Neither asks *did this land* — they ask *can I skip this cheaply*, where a wrong answer costs extra work rather than hiding finished work.

No grep separates them, because the difference is what the answer flows into. So every ancestry call declares its kind within five lines above it, and an undeclared one fails CI:

```
# plot-ancestry: prefilter — the answer only ever SKIPS work. Say what a wrong
#                            answer costs, and why it cannot hide anything.
# plot-ancestry: evidence  — the answer is handed on and something else decides,
#                            including answering `unknown`. Name what decides.
```

There is deliberately no third kind. A site that would need one is a site that should be reading `plot-pr-merged.sh` — or, in TypeScript, the host port's PR state.

## Testing

Plot is a pnpm workspace: the skills live at the repo root, and the board is a
package under `packages/`.

**Node 24.** Pinned in `.nvmrc`, declared in both `package.json` `engines`
blocks, and used by every CI job — run `nvm use` before anything else. This is
not a preference: `pnpm` crashes outright on Node 26, and a background job
under it exits silently having produced nothing, which reads exactly like a
hung test run rather than a wrong interpreter.

```bash
nvm use              # Node 24, per .nvmrc — pnpm crashes on 26
pnpm install         # install dependencies first if node_modules is missing
pnpm test            # validates all skills parse correctly
pnpm run test:reconcile   # plan-format contract tests (plot-plan-meta.sh)
pnpm run test:board       # rebuilds the board artifact + runs its tests
pnpm run typecheck        # typechecks @plot-pm/board

pnpm run test:e2e         # lifecycle choreography in sandbox repos — CI's job,
                          # NOT part of a local run. See below.
```

**`test:e2e` IS CI'S GATE, NOT A LOCAL ONE.** Run it when you are changing the
lifecycle itself and want the feedback; do not run it as a matter of course, and
do not put it in a brief's list of repo gates.

It dispatches **real workers into sandbox repositories** — that is its whole
value and its whole cost. Measured 2026-08-31: two agents running it produced
**53 concurrent `node --test` processes**, load average 8.69, and an operator's
board that could not answer a request in 25 seconds. Three suites here take 5–10
minutes; several agents run them at once, on the one machine the board also
lives on.

**Nothing local depends on it passing.** CI runs it on every PR, bounded by
`timeout-minutes`, and CI is the authority. An agent that runs it locally is
paying the cost twice and starving everything else the second time.

The trade is explicit: skipping it locally means an e2e failure is discovered
after a push, costing one CI round trip. That cost is bounded and serialised. An
unbounded local run is neither, and it takes the machine down with it.

**Always install dependencies and run tests.** If `pnpm test` fails due to missing `node_modules`, install them and retry — never skip tests or dismiss the failure.

**The board is first-class.** Keeping it working — and considering board impact when planning changes to the plan format, template, helper scripts, or `docs/plans` layout — is part of the [Definition of Done](docs/definition-of-done.md), gated in CI.

**On a conflict in `board-server.mjs`, do not read the diff.** It is generated output marked `-merge` in `.gitattributes`, so git keeps one version whole rather than splicing markers into it. Take **either** side, run `pnpm build:board`, and commit the result — the rebuild overwrites whichever side was kept, so the choice cannot matter. Never phrase it as "take ours": *ours* inverts between `git merge` and `git rebase`. Full procedure: [Definition of Done › Resolving a board artifact conflict](docs/definition-of-done.md#resolving-a-board-artifact-conflict).

**Fleet user test:** [docs/fleet-user-test.md](docs/fleet-user-test.md) — a
guided run of `/plot-pulse`, `/plot-dispatch`, and `/plot-merge-queue` in a
real project, covering what the automated flows deliberately cannot (agent
adherence to prose, message clarity, real detached workers).

**Behavioral testing is manual.** The skills have no unit tests — validation is via end-to-end lifecycle testing (full workflow from `/plot-idea` through `/plot-release`). Any change to a spoke command or helper script should be tested with a full lifecycle walkthrough. See `skills/plot/README.md` for documented test runs. (The board, being real code, does have automated tests.)

## Contributing

- **Issues:** https://github.com/plot-pm/plot/issues
- **Decision criteria:** Does the change pass the [manifesto's 9-question checklist](skills/plot/MANIFESTO.md#making-decisions)?
- **Known gaps & improvements:** tracked in `skills/plot/README.md`
- **Evolution history:** `skills/plot/changelog.md`

## Versioning

Every skill MUST have a `metadata.version` field in its SKILL.md frontmatter.

**Do not edit versions by hand.** Declare the bump in your changeset and let the
release process apply it — **with the description FIRST and the `bumps:` block
LAST:**

```markdown
---
'plot': patch
---

The description, which is what the changelog publishes.

<!--
bumps:
  skills:
    plot-dispatch: minor
-->
```

**The order is not cosmetic.** Changesets publishes the first line after the
frontmatter, whatever it is, so a `bumps:` block written first becomes the
release note and the description behind it never ships. Measured 2026-08-30:
19 of 169 published entries — 11% — printed a bare comment-open marker as
their whole description. `./scripts/check-changeset-packages.sh` now refuses
that, and a description shorter than 20 characters.

Choose the level the way semver asks:

- **Patch** (`x.y.Z`): bug fixes, wording improvements, minor clarifications
- **Minor** (`x.Y.0`): new sections, new patterns, expanded coverage
- **Major** (`X.0.0`): structural reorganization, removed sections, breaking workflow changes

CI validates that every skill named in a `bumps:` block is a real directory
under `skills/` — a typo fails the build rather than silently bumping nothing.

It also validates the changeset's own **package** name, which must be `plot` or
`@plot-pm/board`. This is a separate check because it fails differently: an
unknown package makes `changeset version` abort the **entire** release rather
than skip the file. Measured 2026-08-26 — six changesets named `@plot-pm/plot`,
`@plot-pm/skills` and `plot-deliver`, so the release PR could not regenerate and
sat at 8 of 98 changesets for four days, 355 commits behind main, with nothing
reporting why. Run `./scripts/check-changeset-packages.sh` locally to check.
The plugin version in the three metadata files (`package.json`,
`.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`) follows from
the same release, at least as high as the largest skill bump in it.

> This section described manual bumps until 2026-08-17, when the practice was
> measured against it: the last six changes to the plugin version all came from
> `release:` commits and none from a feature commit. A rule that every
> contributor is asked to follow and nobody has followed for six releases is a
> rule that misleads — and it did, five times in one evening, through agents
> instructed from this file.

## Commit Conventions

- `plot: <description>` — hub skill or cross-cutting changes
- `plot-<command>: <description>` — spoke-specific changes (e.g., `plot-approve: fix branch creation`)
- Plain description — repo-level files (README, CLAUDE.md, plugin metadata)

## Status

Version 1.0.0-beta.3. Experimental, evolving through real-world usage. Originated 2026-02-07 across 5 Claude Code sessions in a private project; migrated to this standalone repo 2026-03-13.
