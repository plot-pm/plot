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
- **CI:** github-actions
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
- **Implement command:** PLOT_UNATTENDED=1 claude -p --permission-mode bypassPermissions

<!-- `Implement command` runs `/plot-implement <slug>` for the board's
     `Implement` control and for `WriteBriefButton`, which is the same route
     under the word a refused row is asking. Unset until 2026-09-06, and that
     was measured rather than noticed: nine eligible slices sat unbriefed for
     hours while eight agents idled, `/api/dispatch` refused every one with
     `no-implement-command`, and the button that fixes it could not act either.
     The remedy shipped; the key naming how to run it did not. -->

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
| Command | `plot-board-setup/` | Adopt the board in a project that has Plot: probe prerequisites, record git-host and CI config, and prove it serves. Adoption only since 2026-09-06 — its `--start` flag was removed, not aliased |
| Command | `plot-board/` | Board control — `--start`, `--stop`, `--status` over the local board. Processes, not plans: `--stop` finds the board by TWO facts that must agree — the pid `--start` recorded, and whoever holds the port, which must be that pid or descend from it because `node --watch` supervises the child that binds. Every disagreement is named and refused; a `pkill -f` over process names killed an operator's board on 2026-09-04, and that guess is what the rule refuses |
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
| `plot-sprint-release.sh` | A sprint's declared `Release:` target and the state of every MoSCoW item (`done`/`open`/`disputed`) as JSON — the facts behind the release gate, and nothing else: /plot-release applies the rule, and this never exits non-zero for unfinished work. **It decides nothing because it no longer holds the rule** — since 2026-09-08 it asks `board/plot-sprint-score.mjs`, which calls the domain's `scoreItem`, one hop per tier rather than 134. Its own `item_state` was a second implementation and the two had drifted: the shell reads `delivered` three-valued and takes an item naming no plan at its checkbox, which `scoreItem`'s boolean could not express, so it scored the same item `disputed` — 4 of 134 items on this estate, all four checked, all four disagreeing. The plan estate outranks the checkbox where there is one to read, but only in one direction — a checked box over an undelivered plan is `disputed`, while an unchecked box over a delivered one is `done`, because /plot-deliver moves the plan and nobody re-ticks the box; an item naming NO plan has only its checkbox and can never be `disputed`. **Unfinished work still exits 0; an unaskable rule does not** — a bundle that cannot answer stops the script, because printing `"must":[]` reads as a sprint that promised nothing, which is the one direction a release gate's input must never be lenient in. Reports every active sprint, since two teams may share one train |
| `plot-sprint-candidates.sh` | The plans a sprint could contain — every unfinished plan (phase neither delivered nor released) with its title, story and changelog as JSON, plus `changelog_available`. Collects and ranks **nothing**: which plans serve a stated goal is the semantic judgement `/plot-sprint` makes at Frontier tier, and the case the feature exists for — goal *"the board tells the truth"* against plan *"none printed before the first fetch"* — shares no word, so any score a shell could compute would rank it last. A file with no phase is skipped: `docs/plans/` holds decision logs and worker reports that are not plans. Assembles through `node`, not `sed`, because a `"title":"[^"]*"` match truncates at an escaped quote and this repo titles plans `... is not "no commits yet"` |
| `plot-release-gate.sh` | The sprint gate in front of a release: collects `plot-sprint-release.sh`'s facts and asks `board/plot-release-gate.mjs` for the verdict `workflows/release.ts` decides. **The rule was finished and dead** — the workflow names five refusals, carries a full test file, and had no importer outside `packages/domain/` until 2026-09-09, while `/plot-release` applied the same rule in skill prose. A refusal names every open Must, its sprint, whether it is undelivered or checked-but-not, and what clears it, because a caller reporting *"the sprint refuses"* throws away the half a person acts on. **It decides the gate and not the release**: nothing is tagged, written or pushed, and the operator still names the version — a release is the one action nobody can undo, so this is the refusal in front of the approval rather than a replacement for it. `--candidate` stands the Must-Have gate down, since an RC is how a sprint's remaining work gets verified and gating it would remove the tool operators use to finish the very items gated on; `--ignore-sprint` is the named escape and clears that gate and nothing else. Exit 0 permits, 1 refuses, 2 means the facts were unreadable — which is a broken installation, not a sprint's state |
| `plot-update-board.sh` | Update GitHub Projects board status for a PR — the write arm of the `tracker-github` connector, and reached only through it. It exits 0 on a graceful skip (no token scope, no such project, no such status option), so a caller reading the exit code alone reports every skip as a write; the connector reads the warnings |
| `plot-deliverable-search.sh` | The search `/plot-idea` step 3 runs over the estate for a deliverable a plan proposes to build, reading the `builds:` annotation the plan declares. **It reports and never refuses** — exit 0 always — because a plan may legitimately propose replacing what it matched, and two of the five measured duplications were. FOUR NAMED CORPORA, not the tree: `packages/*/src`, `skills/plot/scripts`, `scripts/`, and the reconcile scan's `== N. ... ==` section headings, which are the four places five plans in one week hid a thing the estate already had. **Each corpus is searched separately, and that is what finds the hard case** rather than a nicety of layout: `check-host-cli-callers.sh` was missed by a search for `check-*gh*` because the plan said *gh* and the estate says *host CLI*, and `gh` names 30 files across the four corpora together against exactly ONE inside `scripts/`. The declared name is expanded into its own tokens, matched whole, plus each token's bare nouns, matched as substrings without regard to case — that second rule is what reaches `storyDrift` from a proposed `computeStatusDrift`, since `git grep -w Drift` does not match inside a longer word. No term is dropped for being short: a `length >= 3` filter was written first and it silently deleted `gh`, the two characters that ARE the hard case, so a term is refused by measurement (`for` names 282 files) and never by a proxy for one. It excludes the generated bundles, read from `.gitattributes` rather than hardcoded, and **it excludes itself** — its header names all five duplications and it lives in a corpus it searches |
| `plot-plan-meta.sh` | Parse plan files → JSON (phase, type, title, sprint, story, assignee, branches, PRs, `Review:`/`Impl:` ceremony answers, `Approved:`/`Started:`/`Delivered:`/`Released:` transition records); the plan-format contract |
| `plot-context.sh` | Read-only: which plan governs the current branch, its phase, wave, and PRs → JSON. Supplies plot-shaped facts to whatever writes session logs; Plot never writes them itself |
| `plot-detect-repo.sh` | Read-only adoption probe → JSON (git host, DoD candidates, the ticket prefix and its count, how many subjects match each commit notation, existing planning systems, hub docs, how many German words the hub docs carry). **It reports counts and never the answer they imply** — since 2026-09-08 the thresholds are `proposeStack`'s, and the fields the probe used to decide (`commit_style`, `language_hint`, a suppressed one-off prefix) are gone rather than kept beside them, because a field left behind is the second answer the split removes |
| `plot-board-probe.sh` | Read-only board-readiness probe → JSON (node version, the major `.nvmrc` pins, repo shape, artifact location, config presence, plan count, `gh`/`bb`/`jen` auth). Auth is `ok`/`failed`/`unknown` — an unrecognised output reads as *cannot verify*, never as authenticated. `node_floor` replaced `node_ok`, which hardcoded `>= 20` seven lines below the file's own *"It DECIDES NOTHING"* header, had **no reader on the estate**, and disagreed with `plot-fleetctl.sh`, which reads the same `.nvmrc`. The floor is the reading; whether the node meets it is `proposeNode`'s answer, and `/plot-board-setup` now acts on it where it acted on nothing |
| `plot-board-verify.sh` | Starts the board on an OS-assigned port, fetches `/api/board`, prints the payload, and reaps the server via `trap`. A script rather than skill prose *because* of the teardown: "always stop the server" is a rule an agent can believe it followed; the trap is a gate the shell enforces on every exit path |
| `plot-open-pr.sh` | The mechanical half of opening a slice's pull request: take the readings, ask `board/plot-slice-pr.mjs` what to open, then call `plot-host.sh pr-create` with exactly that. **The title is the wave heading the plan names the branch under, never `git log -1`** — measured 2026-09-09, a PR opened by hand for the branch that built this took the title `the rule that decides a slice's PR` from its last commit, a sentence about one file on a slice about the action. Four refusals: a branch no plan names, a plan naming it under no wave heading, a branch a PR already carries (**by number**, over every state, because an open PR and a merged one both mean the branch is carried), and a branch holding no commit its base does not — the host's own *"No commits between main and branch"*, refused before the call rather than after it. **It names a marker-only branch and opens it anyway**: `a-merged-pr-carried-work` measured 60 merged PRs, seven carried nothing and only two were the defect, so a refusal would have been right about the PR and wrong about the plan. The reading is the branch against its base, where delivery's is the merge commit — at open time nothing has merged. **The plan DIRECTORY is searched, not the active index**: the plan that governs a branch may carry no symlink, measured on this very branch, and a missing link gates nothing. Candidates are grepped first — 253 plans parsed took 103 s against 0.6 s, and a plan not containing the branch name cannot name it |
| `plot-sprint-state.sh` | The mechanical half of moving a sprint through its lifecycle: ask `board/plot-sprint-transition.mjs` for the transition, then perform the write it decided — the state line, the close date beside it, and the `active/` symlink, which FOLLOWS the decided state rather than being a second decision. `setSprintState` named nine refusals and had no caller outside its own test file until 2026-09-09; measured 2026-09-08, a master agent wrote `State: Planned` with `sed`, linked with `ln -s` and activated a sprint whose nine items nothing could parse, while `state-unrecognised`, `commitment-empty` and `state-unreachable` sat exported and silent. A refusal prints the rule's own sentence and writes nothing — the file is replaced by one `mv` from a scratch copy, so a refused sprint is the sprint that was found. It commits nothing: the caller owns that, the way /plot-sprint's steps already do. `--states` asks the schema for the four words, so a skill listing them cannot invent a fifth |
| `plot-config.sh` | Read a `## Plot Config` key with a default (`get <key> [default]`); includes the optional `Plan template` override key, the `Agent registry` key (where the board's registry reads agent manifests; default `.plot/agents`, so a single-checkout project is unaffected), the agent-runner keys (`Worker command`, `Approve command`), and the Plot 2 posture keys (`Plan PRs`, `Implementation home`, `Hosts plans`, `Tracker`, `Git host`) |
| `plot-install-prompt.sh` | Writes `.plot/worker-prompt.sh` from the shipped template at adoption, and **never overwrites one**. The loop sources that file on every prompt of every agent, and until 2026-09-05 Plot shipped no template for it: `find skills -name '*worker-prompt*'` returned nothing, so every adopting project wrote it from a comment inside the loop and this repo's own copy hardcoded `--session-id` until three agents failed their second slices at once. An existing file is classified by what it PASSES rather than by comparison — `current` interpolates `PLOT_SESSION_FLAG`, `stale` hardcodes a flag, `present` passes none — because a project that rewrote every word is not out of date. `stale` and `present` exit 3 and are REPORTS: the caller offers the update and the wording stays the project's, which is `plot-worker-loop.sh:19` and /plot-init's own "propose, don't interrogate" applied to one file |
| `plot-host.sh` | Git-host adapter (gh/bb): `backend`, `default-branch`, `pr-state`, `pr-create`, `pr-merge`, `pr-list`, `pr-body`, `issue-list`, `issue-view`, `issue-status` — the ONE place that talks to the host CLI, gated by `scripts/check-host-cli-callers.sh` since 2026-09-05. `pr-list` takes `--repo` like `pr-state` and `pr-merged`: a checkout with remotes on two hosts lets an unpinned list enumerate the wrong repository, and a caller joining it against `origin/*` refs then reads every branch as having no PR. The two issue ops READ: `issue-list` runs on the PR timer and omits bodies; `issue-view` fetches one issue's body per click, for the board's *Create plan* action. Both exit 4 where the connector cannot be asked at all, which is not the same answer as an empty list. **`issue-status` is the ONE write to a tracker, and it writes a status.** Plot creates no ticket, closes none, and touches no comment, label or assignee — a plan referencing an issue is Plot's record, not the tracker's, and the status is the one fact the tracker owns a copy of because it is the one a person reads in the tracker rather than in Plot. Amended 2026-09-06; this line read *"The two issue ops READ and never write"* until the tracker got its own port, and the sentence is amended rather than quietly broken. The three ops are the `tracker` port's, reached only by its connectors |
| `plot-approve.sh` | The mechanical half of approving a plan: merge the plan PR, flip the phase, fill `Approved:`, clear the `.plot/hold` entry for each branch the plan names, update the sprint annotation, push via `plot-push-main.sh`. Idempotent — step 2 writes irreversibly to the host, so re-running is the repair for any interruption after it; every step tests the source it would have written, never a progress file. Refuses a non-Draft plan, a `Review:` other than `pr`, and a draft/closed/absent PR |
| `plot-deliver.sh` | The mechanical half of delivering a plan: flip `State: Approved` → `Delivered`, fill the `Delivered:` record, move the `active/` → `delivered/` symlink (best-effort), update the sprint annotation, push via `plot-push-main.sh`. Idempotent — the push is irreversible, so re-running is the repair for any interruption; every step tests the source it would have written, never a progress file. Refuses a non-Approved plan and any non-deferred branch unmerged |
| `plot-phase-gate.sh` | PreToolUse hook (see `hooks/hooks.json`): blocks implementation commits while the governing plan is Draft; plan-only commits pass; fails open. Reads the plan from `origin/<main>`, never the working tree — an approval nobody else can see is not one. When that ref is unreadable it allows the commit **and says the phase went unverified**: failing open, not failing silently |
| `plot-state-gate.sh` | PreToolUse hook (see `hooks/hooks.json`), beside `plot-phase-gate.sh`: blocks a commit that **changes** a `State:` line in a plan or sprint file unless the script that owns that write made it. **The reading is the diff** — the value in `HEAD` against the staged one — so a file with no `HEAD` version is a CREATION and a plan or sprint written from a template passes, and an unchanged value passes, which is nearly every commit a plan receives. **The owners announce themselves with a receipt** (`plot-state-receipt.sh`), and that is what makes it a gate: the commit message, the branch and the author are all things an agent types, while a receipt is only produced by running `plot-approve.sh`, `plot-deliver.sh` or `plot-sprint-state.sh`. It is spent when it clears, so one approval licenses one commit. It fails open on its own machinery — no git, no diff to read — and **refuses** a transition it can see with no receipt, because that is the case it exists for. Measured 2026-09-08: a master agent set a plan's phase with `python re.sub`, a sprint's with `sed`, and made the active symlink with `ln -s`; every other refusal in the estate fires when something is INVOKED, and an editor on a markdown line invokes nothing |
| `plot-state-receipt.sh` | The receipt a lifecycle write leaves behind — **sourced, not run**, by the three scripts that own a `State:` line and by `plot-state-gate.sh`, which refuses every other writer. One file, because the gate and the owners must agree on where a receipt lives. Machine-local under `.plot/state/`, for `plot-boardctl.sh:83`'s reason: a receipt travelling in a commit would clear the gate on every checkout that pulled it. **It does not prove the tree holds only that write** — a second edit changes the value and the receipt stops matching, so only a re-write to the same value passes, and that write is a no-op. **Run rather than sourced it is the named escape**, `--unowned <path> <value> <reason>`, for the three writes no script owns: `/plot-approve` step 3b under `Review: in-session` or `ballot` (`plot-approve.sh:190` refuses both by name — a script cannot stand in for a human reviewer or read a ballot), `/plot-release` writing `Released`, and `/plot-reject` running the lifecycle backwards. **A gate with no exit is one people route around**, `plot-dispatch.sh`'s `--allow-local` in the same tradition — and the reason is REQUIRED and recorded to `.plot/state/unowned-state-writes.tsv`, so each use counts a routing gap the later slices of `the-master-agent-uses-the-controllers` close, rather than turning the gate off |
| `plot-commit-record.sh` | `post-commit` hook (installed by `plot-install-commit-record.sh`, never by cloning): records a commit that set a file to content that path already held, and is otherwise SILENT. **It is an observation, not a gate** — three explanations of the defect have been proposed and all three disproved in sandboxes, so there is no condition to refuse on and refusing on a guessed one would block honest work. Post-commit and `|| true`, so it can never affect a commit; fail-silent, because a broken observer must not disturb one. Reads only what git already holds — the commit's name-status, and a depth-bounded history per modified path resolved in ONE `cat-file --batch-check`. It never fetches and never asks the host: 0.67 s on the largest commit in 200 here, 0.4 s on a typical one, against 3.0 s for the per-commit `rev-parse` fork it replaced. Records go to `.plot/state/commit-records/YYYY-MM-DD.jsonl`, one file per day and the last 30 kept — the day is the unit because that is how a forensic record is asked for, and pruning whole days is one `rm` rather than a rewrite. Measured over 150 recent commits on main: **2 records**, one the known incident `3a3efcac` and the other `8d45eaca`, a third occurrence nobody had found |
| `plot-install-commit-record.sh` | Installs the `post-commit` record hook, or reports what is there (`written`/`current`/`present`; `--check` writes nothing). **Installing is a decision the repo makes, not a side effect of cloning** — a git hook changes every contributor's machine, and git ships none on clone, so `/plot-init` offers it only where the probe found the signal. Never overwrites an existing `post-commit`: a repository may run one for its own reasons and this cannot tell an important hook from an abandoned one, so it reports and names the one line to add. Honours `core.hooksPath`, and writes to the COMMON git dir so every dispatch worktree is covered by one install. The installed file is a two-line shim calling the script from the checkout, so an updated Plot takes effect without reinstalling |
| `plot-install-hooks.sh` | Registers Plot's gates as `PreToolUse` hooks in the adopting repository's own `.claude/settings.json`, or reports what is there (`written`/`current`/`present`; `--check` writes nothing). **`hooks/hooks.json` reaches only a plugin install** — every path in it is `${CLAUDE_PLUGIN_ROOT}`-relative, so a repository that vendors the skills or clones the repo gets no gates and nothing says so. Measured 2026-09-10, the route this uses instead: a settings-registered `PreToolUse` hook FIRES, a `$CLAUDE_PROJECT_DIR`-rooted command resolves with the hook's `pwd` at the repository root, and two hooks on one matcher BOTH run rather than one shadowing the other. **That last measurement is why a plugin-registered gate reports `current` and is never added again** — the state gate spends its receipt when it clears, so a second reader finds it spent and refuses a write that was properly owned; the phase gate would survive a duplicate and the state gate would not, and which fires first is not the installer's to control, so the duplicate is prevented by never creating it. Matching is on the SCRIPT BASENAME, since the plugin's `${CLAUDE_PLUGIN_ROOT}` entry and a repo-relative one are textually different and the same gate. **The gate set is read from `hooks/hooks.json` and never hardcoded**: it carried two gates when this was planned and three when it was built, and an installer naming its own pair ships a repository missing whichever landed last. Never overwrites a foreign `PreToolUse` hook — reports `present`, names the entries to add, keeps the rest |
| `plot-story-lint.sh` | Story-estate drift check (missing STORY files, frontmatter, done-not-archived, index sync); machine-countable footer; exit 1 on findings |
| `plot-reconcile-scan.sh` | Read-only plan/branch drift sweep (eighteen sections + machine-countable footer); section 3 classifies empty claims — `deferred:`/`moved:` in the plan means reapable, a bare `claimed:` means needs judgment. Section 5 (`attention=`) is what gates; index drift (`index_drift=`) is convenience and gates nothing — since the phase grouping became derived, a plan with no symlink is visible everywhere that decides anything, so a missing link is a browsing gap while a **dangling** link is still a broken pointer. A file with no `State:` field is not a plan, the same rule `plot-fleet-scan.sh` applies. Section 12 (`double_claims=`) reports a branch listed by MORE THAN ONE plan, naming both and their waves; it reports and never gates. Section 13 (`rounds_drift=`) reports a **Draft** plan amended since its own recorded `Rounds:` value, naming the round and both commits — a hint about a badge, never a reason to stop a delivery; a plan recording no round is silent, because an unquestioned plan is honestly unquestioned, while `Rounds: 0` IS a recorded value and reports like any other. Section 14 (`sprint_index_drift=`) reports a sprint whose `State:` disagrees with `docs/sprints/active/` — Active with no link, or linked while Planned or Closed. Two records of one fact, and nothing read the pair: measured in both directions twice in four days, each found by a person reading the directory. It is NOT `sprint_drift=`, which counts plans whose `Sprint:` field disagrees; this counts sprints, and one number answering both is one a reader must re-derive the split from. The phase is read and never derived — a sprint ends when somebody says it ended — and the link is resolved by READING it, since links are named for the slug and files for the week. It reports and never gates. Section 15 (`sprint_shipped=`) reports a sprint that is **not Closed** whose declared `Release:` has been tagged — measured, `a-half-landed-workflow-says-so` targets 2.13.0, which shipped as `v2.13.0`, while the file reads `Phase: Planning` and none of its eight items ever became a plan. The facts come from `plot-sprint-release.sh` rather than a second reader of the same line, and the first `N.N.N` in the field is the target because a `Release:` may carry prose after the version. **It reports and never closes**: a shipped release says the sprint's window passed, not that its work is done, so a person closes it. A third question, distinct from both counters above it. Section 16 (`stated_waits=`) reports a **live** slice — Draft or Approved — whose body claims a wait its branch line does not carry, quoting the sentence: two records of one fact, and only the `waits:` annotation reaches the fleet, so a slice whose body said *"IT WAITS FOR ... (#705)"* read as eligible and a person recognising the prose was the only thing that stopped it dispatching. It matches the CLAIM, never the reference — the drafted rule, *a body linking a plan or naming a PR*, fired on 391 of 477 slices, because plans cite each other as context constantly. One phrase, `waits for` / `waits on`, and the SUBJECT must be the slice: that anchor is what separates a claim from a `--stop` that waits for each worker to exit, and a backticked span quotes the phrase rather than claiming it. It reports and never gates, because the annotation names a branch no shell can guess. Section 17 (`unclaimed_work=`) reports a remote branch carrying FILE changes that no plan names and no open PR carries. Section 18 (`merged_refs=`) reports the opposite population: a branch whose PR **merged** and whose ref still exists. Section 17 skips one explicitly — its last guard is `if branch_merged "$b"; then continue; fi` — because unclaimed *work* is unfinished and a merged branch is finished, so these are two questions with two actions and two counters. Measured 2026-09-07: after all eight of section 17's findings were resolved, nine of the fifteen surviving refs had merged PRs and nothing named them. `plot-release-refs.sh` is the right tool and stays plan-scoped, which is exactly why a merged ref belonging to an undelivered plan, or to no plan at all, is reached by nothing. **The scan is the right place because it reports and never deletes** — the blast-radius argument that keeps the sweep plan-scoped does not apply to a finding. It asks the HOST through the scan's bundled merged-PR list and never `branch_merged`, whose ancestry fallback would name a branch that reached main by another route as a merged PR while this finding prints the PR number. **An unreachable host reports nothing, not everything**: without the merged list every ref reads as unmerged, so `pr_reliable` gates the section and an outage cannot become a list of deletion candidates. It names whether a plan claims it, and that decides who acts — a delivered plan routes to `plot-release-refs.sh`, a live one to its own delivery, and a ref no plan names to a person. It reports and never gates. **The blocking set is 1–6, and a `== blocking sections end ==` line says where it ends.** `/plot-deliver`'s gate reads to that marker rather than to `== 7.`, which meant *the first non-blocking section* and said *seven*: this scan has been renumbered twice, and each time the agreement held because somebody noticed. A new blocking section goes above the line and a new advisory one below it, and no consumer reads a number |
| `plot-dispatch.sh` | Slice fan-out: it hands slice + brief to the registry and returns, creating no desk, pushing no claim and starting no worker — `DESIGN-agent.md:157`, *"nothing starts a worker"*, and the desk is the agent's because only the agent can see its own tree. It refuses nothing for want of a free agent and never asks: the queue absorbs the timing, and a queue longer than the pool is the normal case. The eligible list is read ONCE rather than pulled per branch, because nothing the run does moves the scan's answer once no claim is pushed. `--restart` and `--start` are the two verbs that launch a worker; `--dry-run`/`--no-start`/`--max N`; idempotent — re-running adopts rather than duplicates. `--start [N]` brings FREE agents into existence — registered, waiting, holding no slice, defaulting to three — which is the last link in *dispatch queues → registry matches → an agent takes it* and had no starter at all until 2026-09-05, when a dispatch reported `started=0` against `agents registered: 0`. Each desk is cut DETACHED at `origin/<main>`: a free agent has no branch to cut one from, the loop's own `reset_desk` already passes through exactly that state, and detached is not the default branch `plot-reap.sh` refuses on for a reason that describes a tree whose dispatched branch was never checked out. The count is a REQUEST — `rules/fleet-size.ts` subtracts the workers already running and lets the machine reduce it further — and a shortfall is reported and never remembered. Its phase gate reads the plan from `origin/<main>`, never the working tree, and **fails closed** when that ref is unreadable — `--allow-local` is the explicit, named escape for a repo with no remote. Before fanning out it reports which other branches already hold which files, read from local refs and worktrees (so unpushed and uncommitted work counts) — that report refuses nothing, because nothing on the candidate side is predicted. It DOES refuse a branch whose own worktree exists carrying unlanded work: a shared file is a prediction, but a desk somebody is sitting at is a measurement. Unlanded means commits not in the default branch OR uncommitted changes — an agent mid-edit has often committed nothing, and a worktree cut minutes ago reads as merged by ancestry alone. The worktree is found by asking git which one holds the branch, never by rebuilding the path from the branch name: hand-made worktrees are the population with no claim ref, and they rarely follow dispatch's naming. It reads the same local refs and worktrees, which is why dispatch is the only component that can see it — the fleet scan derives from `origin/<branch>`, and the measured failure was two implemented, green branches whose work was never pushed, so no claim existed and both read `eligible`. It names the worktree and claims nothing on the operator's behalf; `--allow-local` has no bearing on it, and a leftover worktree whose tip already merged stays dispatchable. `--restart <branch>` is the counterpart to `--stop`: it hands a branch that ALREADY holds a claim to a new worker, the one thing a slug dispatch can never do, because `--next` offers only `open` branches and that lock does not move. The branch is explicit and never auto-selected — replacing a stopped worker rather than reviewing, reaping or abandoning its work is a person's call. **The PR is asked FIRST, before the state word:** five of five `failed` worktrees measured here held a PR (four open, one merged), since `plot-worker-state.sh` refines `finished` by the tree and deliberately does not refine `failed`, so a gate on the state word alone would restart all five and destroy what the `finished` refusal protects. It then refuses on a live pid and on a `PLOT-BLOCKED` marker, and restarts `stalled`/`failed`/`ended`/`none` alike; a `failed` worker with NO PR must restart, or the verb cannot do its job. No `--force`, and the tree is inherited untouched — a stall IS uncommitted work, and one measured here left 324 finished lines on the floor. It starts through `start_worker`, so the manifest is written by one writer and the fleet can see what it started |
| `plot-merge-queue.sh` | Merge order + `git merge-tree` conflict prediction per plan; flags branches that collide with one ahead of them in the queue |
| `plot-resolve-artifact.sh` | The ONE automatic write: repairs an artifact-only merge conflict — merge, take a side, `pnpm build:board`, `pnpm run test:board`, push **only on green**. Refuses any conflict set that is not exactly the artifact, and takes a per-branch lock so two repairs never run on one branch. Licensed by three verified properties (`-merge` keeps the file valid, the rebuild is deterministic, CI's no-diff gate proves it) and by nothing else — a script rather than an agent, because judgement's absence *is* the permission |
| `plot-reap.sh` | Removes a dispatch worktree whose work has landed, and nothing else — the reaper `plot-reconcile-scan.sh:323` already referred to before one existed. `--dry-run` by default; `--yes` removes; `--max N` bounds it. Refuses on five MEASUREMENTS, never a judgement: a live worker pid, uncommitted changes, a `PLOT-BLOCKED*` marker, a tree sitting on the default branch (its dispatched branch is not checked out, so its state was never measured), or no merged PR. Reads `mergedAt` and **never** `state` — a merged PR reports `CLOSED`, and squash-merge leaves the branch permanently "ahead of main", which is why ancestry alone cleared 1 of 29 finished trees here and the host cleared the other 28. Branches and refs are untouched: it removes CHECKOUTS, so every reap is re-creatable with `git worktree add` — refs are `plot-release-refs.sh`'s, which runs after it and needs its own licence because a deleted ref is not re-creatable at all |
| `plot-release-refs.sh` | Deletes the REMOTE refs of ONE plan's merged branches, after the reap. Plan-scoped where the reaper is slug-blind, and that asymmetry is the safety argument: a removed checkout comes back with `git worktree add`, a deleted ref does not, so the blast radius is bounded by the plan file — a sweep over every merged ref on the estate satisfies "a delivered plan's merged branches lose their refs" and destroys unlanded work belonging to plans nobody delivered. `--dry-run` by default; `--yes` deletes; `--max N` bounds it. Five guards: a `deferred:`/`moved:` branch (given up, not finished — `/plot-reconcile` needs the ref *plus* its annotation), no merged PR, an **open** PR (`changeset-release/main` is merged repeatedly and Changesets recreates and reuses it, so a live release PR sits on a ref whose own older PR merged), a branch checked out in any worktree, and the default branch. **The five are conditions in `rules/reapable.ts`'s `finishedWith`, which states every condition that can hold a desk and judges none** — the reaper reads the same rule and names its own set, so the two can no longer drift the way they had by 2026-09-06, when this script never asked whether a worker was alive and the reaper never asked `pr_open`. **It gains none of the reaper's three**: `liveWorker`, `uncommittedChanges` and `blockedMarker` are answered and deliberately not consulted, because folding them in would widen a licence written narrow on purpose. **`unknown` permits here.** Four conditions need a worktree and 69% of branches have none, so each guard tests `true` and an unaskable condition falls through — the reaper reads the same `unknown` as *nothing to reap*, and refusing on it would keep every ref on two branches in three. Deleting the remote ref only: the scan derives from `origin/<branch>`, so a local branch costs it nothing and is the last copy of a reflog. Measured 2026-08-27 — deleting nine merged branches took the scan 218.5 s → 111.5 s |
| `plot-pr-merged.sh` | The ONE answer to "did the host merge ANY PR for this branch?" — **sourced, not run**, by `plot-reap.sh` and `plot-release-refs.sh`. Extracted from the reaper on 2026-08-28 because ref deletion needs the SAME gate and the two must never disagree: the reaper removes a re-creatable checkout, ref deletion is not undoable, so a second implementation drifting toward permissive would fail in the direction that cannot be repaired. Reads `mergedAt`, never `state` (a merged PR reports `CLOSED`) and never ancestry (squash-merge leaves a branch ahead of main forever), across ANY PR rather than the newest (`--limit 1` reported three branches unlanded whose work was on main, each masked by a duplicate the fleet opened itself). An unreachable host answers *not merged*, so silence is never permission. `pr_open` sits beside it and can only ever KEEP a ref |
| `plot-fleet-scan.sh` | Read-only wave/claim state per plan (complete/eligible/blocked + machine-countable footer); `--next` names one claimable branch (exit 1 = nothing to start); stateless — re-derived from git refs every run. `--stream` emits the same `--json` derivation as it resolves — one line per plan, then a terminal `pulse` line — because the scan is 18.3 s against the board's 5 s cadence and git alone is 12.7 s of that, so the wait is structural. The terminal line is what says the scan finished; a closed pipe does not, since a killed scan closes it too. A branch in a **terminal** state — merged or deferred, 26 of 54 here — is asked about once: the board holds the answers in memory and hands them back through `PLOT_TERMINAL_CACHE`, the scan reports the next pulse's map on stderr. Only the host round trip is skipped; git is re-consulted every pass and the entry is discarded the moment it disagrees, which is what keeps it a derivation rather than a record |
| `plot-fleetctl.sh` | Fleet control's mechanics: `--once` (one supervisor tick, the gate — a tick decides and performs nothing, so it is free), `--status` (is the supervisor alive, which agents run, how long each has been quiet — starts nothing, exits 1 when it is not loaded), `--start [N]` (fill the platform's unit, verify the fill, load it, then hand the agent count to `plot-dispatch.sh --start`), `--stop`. Four refusals, each a measurement: no `plot-registryd.mjs`, a `node` that is not `.nvmrc`'s major (**the unit bakes `$NODE` in permanently** — measured 2026-09-05, `command -v node` answered 26.7.0 against a repo pinned to 24), no launchd or systemd, and a label already loaded (launchd keys by LABEL, so a second checkout loading over the first supervises the wrong estate silently). The fill is VERIFIED rather than assumed — a surviving `__PLACEHOLDER__` deletes the unit and refuses, and `plutil -lint` gates the plist. `--stop` is an ORCHESTRATION, not a second stop rule: it calls `plot-dispatch.sh --stop <branch>` once per dispatched agent, reports each branch as it goes, bounds each wait at 30 s (`--wait N`) and names what did not exit rather than waiting forever, and unloads the supervisor LAST — it is what would notice a desk falling idle, so a stop that fails partway leaves a watcher over the remainder. A FREE agent holds no branch (`--start` cuts its desk detached at `origin/<main>`), so the one stop rule cannot name it; those are reported and left running rather than signalled through an invented second rule |
| `plot-boardctl.sh` | Board control's mechanics: `--status` (does a board answer, on which port, since when, and for WHICH checkout — it reads `server.repo` from `/api/board`, the only fact that separates two boards on one machine; starts nothing, exits 1 when nothing listens), `--start` (resolve the artifact through `plot-board-probe.sh`, refuse on `artifact_source: none`, start from the repo root, record the TREE's root pid, and prove the board answers rather than reading an exit code — the server reports a busy port and exits 0, so the exit code answers a different question), `--stop`. **`--stop` needs TWO facts to agree**: the recorded pid and the port's listener, where the listener must BE that pid or DESCEND from it — `node --watch` (9518) supervises the child that binds (27674), measured on the live board, so equality alone would refuse every healthy board. Neither fact is sufficient: a pidfile outlives its process and may name a recycled pid, and the port finds whichever board answers, which on a machine running several is not this repository's. Four disagreements, each named and refused rather than guessed through — a `pkill -f 'board-server.mjs'` on 2026-09-04 killed an operator's board along with the stale jobs it was aimed at, and a pattern over process names is exactly that guess. It stops the TREE: killing only the port-holder leaves the watcher running with nothing serving, which reads to `ps` like a board that is still up. The tree walk is ONE `awk` pass — measured 2026-09-06, this machine lists 1109 processes and a shell loop forking `awk` per line took 10.6 s, so a `--stop` exceeded 120 s and printed nothing, against 0.055 s for the walk it replaced. **It touches the supervisor nowhere** and `plot-fleetctl.sh` touches the board nowhere: `DESIGN-process.md` §1 makes them independent systems sharing a machine, and their process trees share no edge |
| `plot-worker-state.sh` | The ONE answer to "is a worker running in this worktree?" — **sourced, not run**, by both `plot-dispatch.sh` and `plot-fleet-scan.sh`. Returns facts (state, pid, exit code) and renders nothing, because the two callers need different shapes of one computation: `--status` prints prose for a person, `--json` emits tab-separated fields for a machine. It carried five of its six states in duplicate until 2026-08-18, and the copies had already drifted on the sixth. It now answers eight: six about the PROCESS, plus `waiting` and `stalled` about the TASK — every worker exits 0, so the exit code cannot say whether the work is done |
| `plot-estate-changed.sh` | Has the estate changed since this run last asked? `0` = changed (or cannot tell) → ask; `1` = unchanged. The shell half of the master agent's entry point: `plot-ask.mjs` answers the QUESTION, this answers *is a second ask owed?* A **measurement, never a timer** — it hashes what the scan reads, every remote ref's SHA and every plan file's CONTENT, so the delivery gate's own fix is always seen (a phase flip changes plan bytes, the push that follows moves a ref). A clock would answer "was it recent?" when the question is "did it change?", and those differ in exactly the case the gate creates. mtime is a clock too: a checkout moves it without changing what the scan reads. It **fails toward asking** — no git, no plan directory, an unwritable state file all exit 0 — because skipping a scan costs minutes while skipping the gate costs a half-landed delivery nobody notices. A separate script rather than a flag on `plot-ask.mjs` because a skill runs each bash block in its own process, so the digest must outlive the process in a file; the file's SCOPE replaces the object's lifetime, and it is deleted when the gate clears because the guard cannot see a PR merged on the host |
| `board/plot-ask.mjs` | The master agent's entry point — the board's controller reached without HTTP: `plot-ask.mjs <board\|fleet>`, one JSON answer on stdout. `node` rather than a call to a live board, because a board is optional and none was running when the choice was measured; seven skills would have gained a dependency whose failure arrives as a skill that works on the operator's machine and not in a worker's. The cost is stated: this path re-derives what a running board already computed, and an HTTP fast path can be added later **without changing any caller**, because this artifact is the seam. A SECOND bundle rather than a flag on `board-server.mjs` — `index.ts` binds a port at import time, so a flag would mean a skill that asks a question also starts a server. The transport fields are left exactly as the controller emits them: rewriting would invent a permission no caller granted, so an unavailable capability with an EMPTY reason reads as an absence, and every real refusal carries a sentence |
| `board/plot-propose-stack.mjs` | What an adoption probe's readings PROPOSE — `proposeStack` reached without HTTP, for `/plot-init` and `/plot-board-setup`. Its own bundle rather than a verb on `plot-ask.mjs`: a caller asking what a repository proposes should not load the fleet controller. **1.9 KB against `plot-ask.mjs`'s 491**, because the rule imports no entity schemas — the plan budgeted a third of a megabyte and the measurement was two orders smaller. It answers `node`, `commitStyle`, `ticket` and `language`, each carrying the counts behind it, and the seven thresholds it holds were `if` chains in two collectors that no test could reach |
| `board/plot-sprint-transition.mjs` | The sprint lifecycle's write — `setSprintState` reached without HTTP, for `/plot-sprint`'s start, commit and close. The sprint file arrives on stdin as text: the domain reaches no filesystem, and a bundle that opened the file would put the one I/O call this rule needs inside the artifact rather than in the shell that owns it. **The state is carried through UNPARSED**, so the rule is what recognises it — narrowing in the parser would refuse in the parser's words and leave `state-unrecognised` as dead as it was. Wiring it found the crash the rule's own tests could not reach: every gate indexes `NEXT` by the current state, and a state read from a file can be any word |
| `board/plot-slice-pr.mjs` | What opening a slice's PR writes — `openSlicePr` reached without HTTP, for `plot-open-pr.sh`. Its own bundle rather than a verb on `plot-ask.mjs`, for the reason `entry/transition.ts` gives: that entry answers `board` and `fleet` by RUNNING `plot-fleet-scan.sh`, so a script asking it to open a PR would call an artifact that calls the script. **2.7 KB**, because it spawns nothing and reads nothing — every reading arrives on stdin from the shell that took it. JSON in, JSON out, where the transition entries take tab-separated words: the answer carries a markdown body, and a flat wire would mean the shell re-assembling what the rule just composed |
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

  **There are now two connector ports, and that is the shape rather than an
  exception.** `host` reaches the git host; `tracker` reaches the issue tracker.
  `Tracker` is a `## Plot Config` key declared **independently of `Git host`**,
  so a repository whose code lives with one vendor and whose tickets live with
  another has TWO remote services with two accounts, two tokens and two windows
  — and asking one interface about both made a capability belonging to one
  service report *not my department* through the other. The tracker's two
  implementations are likewise two connectors rather than one adapter with a
  vendor branch: neither ever sees the other's credentials or budget. A
  repository that declared no tracker gets `trackerNone`, which answers
  `unaskable` on every operation **including the write** — a silent success
  there would report a status reaching a tracker somebody configured while
  nothing left the machine.

  **It stays on the adapter side of the port, with one exception that is not
  yet fixed — and the exception has moved.** `Host` names six questions and no
  transport, no account, no bucket, and **`ports/host.ts:16` now declares
  `HostBackend = string`**: the port is open. The closed list survives one layer
  down, at `host-shell.ts:30` — `const DRIVES = ['github', 'bitbucket']`, which
  `:275` throws on. So adding GitLab is **not** an adapter-only change today,
  but what blocks it is an adapter's own list rather than a type in the domain.
  Treat the adapter-only property as the target, not the current state. See
  [`the-build-pipeline-is-its-own-connector`](docs/plans/2026-09-07-the-build-pipeline-is-its-own-connector.md),
  whose second slice removes it.
- **No domain-specific code or behaviour lives outside the domain.**

**Both boundaries are now gated, and the outer one is a ratchet with room left.**
The purity gate holds the inner boundary: outside
`packages/domain/src/adapters/`, the domain may import `zod` and nothing else —
measured 0 violations (`ci.yml:186`). The outer boundary is held by *One place
reaches a process* (`ci.yml:259`), which counts direct `spawn`/`execFile` sites
outside `adapters/` and fails when the number **grows**: measured 2026-09-07,
**19 sites against `allowed=28`, target 0**.

**No shell script is reached outside an adapter.** Of those 19, **zero** call a
`plot-*.sh`. What remains is `git` (in `idea.ts` and `continue.ts`), a
caller-supplied command (`registry.ts`, `fleet.ts`), and the `sh -c` starts for a
project's configured command in the eight action endpoints. Different tools
through different contracts, and the gate's own comment names them as the next
slice's scope.

> This paragraph read *"the outer boundary is not enforced: `packages/board/src`
> holds **65** `spawn`/`execFile` lines across 23 files, and CI has zero path
> references to it"* until 2026-09-07, when both halves were measured false.
> `the-sprint-proves-its-own-goal` added the ratchet and `production-calls` did
> the migration it counts — and nothing came back to say so.

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

## A Shell Script Asks The Domain

**The other direction, and it has its own contract:** [docs/shell-and-domain.md](docs/shell-and-domain.md). The layering rule above says a script is reached only from an adapter; this says how a **bash** script reaches a **rule**.

**Settled 2026-09-07, and the cost rule is a measurement.** `node -e ''` starts in 34 ms and a shipped bundle under `skills/plot/scripts/board/` answers in 39 ms. A script that runs **once per operator command** calls the domain — `plot-approve.sh` already does. A script that runs **once per agent per pass** duplicates the rule, and a corpus comparison holds the pair; `plot-worker-loop.sh` is that case.

**Duplication is allowed and undeclared duplication is not.** `plot-pr-merged.sh` is sourced by four scripts while `rules/reapable.ts` and `rules/queue.ts` answer the same question in TypeScript, deliberately. What makes it safe is not that one side is authoritative — it is that a test says they agree.

**A duplicated rule joins the corpus tier** at `packages/domain/corpus/`, and a disagreement names both answers and the subject: `the-scripts-say-slice :: state :: rule="withdrawn" shell="open"`. `corpus/sprint-score.corpus.test.ts` is the first — `scoreItem` against `plot-sprint-release.sh`'s `item_state`. **On a disagreement the branch stops**; adjusting either side to make the comparison pass is the one move forbidden.

**No gate enforces this**, and it is a rule for the reason the domain's arrow-function rule is one: which of two implementations is right is judgement, and a grep cannot tell a declared duplicate from a forgotten one. What is gated is the pair once declared — the corpus test fails when they drift.

## The Master Agent Uses The Controllers

**Settled 2026-09-08. No shortcuts.** A master agent performs a lifecycle action by calling its controller. Not the script the controller calls, not `sed` over the field the script writes, not `git` where the controller would have used it. **And what the controller refuses does not happen** — a refusal is not advice to weigh, it is the end of that action.

**The two halves are one rule.** Routing through a controller and then proceeding past its refusal is the same failure as never calling it: in both cases the decision was made somewhere no rule could reach.

**Nine actions exist as controller endpoints today** — `dispatch`, `approve`, `deliver`, `idea`, `implement`, `drop`, `reslice`, `commission`, `continue` — reachable without HTTP through `skills/plot/scripts/board/plot-ask.mjs`, which is the seam `a-shell-script-asks-the-domain` built for exactly this.

**Measured 2026-09-08, in one session, by the agent that writes these rules:**

| the action | how it was done | the controller that existed |
|---|---|---|
| activate a sprint | `sed` + `ln -s` | `setSprintState` — nine refusals, zero callers |
| approve four plans | `python re.sub` on `State:` | the `approve` endpoint |
| dispatch slices | `plot-dispatch.sh` directly | the `dispatch` endpoint |
| deliver a plan | `plot-deliver.sh` directly | the `deliver` endpoint |

**Four of five actions had a controller and none was used.** The sprint one cost an hour: `State: Planned` is a word `SprintStateSchema` does not contain, the file was written by hand instead of from `templates/sprint.md` so the board parsed none of its nine items, and `commitment-empty` — the refusal for exactly that — never ran.

**Where no controller exists, the gap is the finding.** **Where a rule exists and nothing calls it, that is a defect to report** — never a licence to write the field by hand.

**Opening a slice's PR was that gap, and it is closed.** `skills/plot/scripts/plot-open-pr.sh` asks `board/plot-slice-pr.mjs`, which asks `openSlicePr`. This paragraph read *"Opening a PR has none, and that is worth filing rather than working around silently"* until 2026-09-09 — amended rather than quietly broken, the way the `plot-host.sh` line above it was. **`gh pr create` is not the route**, and the reason is a measurement rather than a preference: three slice PRs were opened that way on 2026-09-08 and each took its title from the last commit subject, which on this estate is routinely `plot: build the board artifact`. A sprint PR is not a slice PR and still goes through `plot-host.sh pr-create` — the adapter, not the controller, because no plan names a sprint branch under a wave heading.

**This binds the master agent specifically**, because a dispatched worker's changes are reviewed as code and a master agent's hand edits are not. Every mistake above was invisible to review: no diff of a script, no test, no PR.

**And since 2026-09-09 a gate sees the one shape review cannot.** `plot-state-gate.sh` refuses a commit that changes a `State:` line in a plan or sprint file unless `plot-approve.sh`, `plot-deliver.sh` or `plot-sprint-state.sh` made the write — proved by a receipt those scripts leave and no editor can forge. It covers the lifecycle FIELD and nothing else: routing an action past a controller that has no `State:` write remains a rule, and the rest of this section is why. What the gate adds is that the four hand edits measured above now stop at the commit, each naming the command that owns the write.

## Gates Over Rules

**For important agent behaviors, always implement gates, not rules.** ([Reference](https://blog.fsck.com/2026/04/07/rules-and-gates/))

- A **rule** is a guideline the agent can rationalize around. Rules live in `CLAUDE.md` or skill instructions and depend on the agent choosing to follow them.
- A **gate** is a hard stop with objective verification — enforced via hooks (PreToolUse / PostToolUse) where the agent cannot proceed without meeting a concrete, checkable condition.
- **The test:** Can you answer "Did I complete this?" without actually doing the work? If yes, it's a rule. If no, it's a gate.

When writing skills that include critical workflows (phase guardrails, branch creation, PR state checks, destructive operations), prefer gates via hooks over prose-only instructions. Even when the user casually says "add a rule for X," evaluate whether it should be a gate and implement accordingly.

**Skill authors:** If your skill includes a "MUST" or "NEVER" instruction, ask: is this enforced by a hook, or just written in prose? If prose-only, it's a rule and will eventually be violated. Convert critical MUSTs to gates.

**`plot-host.sh` is the ONE place that talks to the host CLI — and that is now a gate.** It was prose here throughout, and on 2026-09-05 four scripts violated it: `plot-reconcile-scan.sh`, `plot-agent-monitor.sh`, `plot-pr-state.sh` and `plot-pr-merged.sh` each held their own `gh` call. A second caller does not merely duplicate — every one of those asked about GitHub and nothing else, so a Bitbucket checkout got a helper that was absent rather than wrong. `scripts/check-host-cli-callers.sh` is the gate; its exception list names four scripts, each with the reason it asks a different question.

**Examples in plot:**
- The four phase guardrails (cannot approve unreviewed draft, cannot deliver with open impl PRs, cannot release undelivered work, etc.) are rules embedded in spoke commands. Stronger forms would be gates: a PreToolUse hook on `gh pr merge` that reads the plan's phase and blocks merges that violate the lifecycle. **What a gate now covers is the write those guardrails protect**: `plot-state-gate.sh` refuses a `State:` line changed by anything but the script that owns it, so a guardrail cannot be skipped by editing the field it guards. The guardrails themselves are still rules — the gate says *who may write*, not *whether this transition is allowed*, which is the domain's answer and only reachable by calling it.
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
pnpm run test:contracts   # contract tests for the helper estate + CI gates (75 files)
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

**A changeset may name the plan it implements**, on a `plan:` line in the same
block:

```markdown
The description, which is what the changelog publishes.

<!--
plan: docs/plans/2026-09-06-a-changeset-names-its-plan.md
bumps:
  skills:
    plot: patch
-->
```

**It is optional.** A changeset written by hand, or by a contributor with no
plan, is valid without one — 0 of 19 carried one when the field was added, so a
gate demanding it would refuse every changeset in flight. What it buys is
mechanisability: `/plot-release` step 3 cross-checks changesets against plans by
semantic match over descriptions, at Frontier tier, re-derived per changeset per
release. A link makes that a lookup; without one the match runs as before.

**The `plan:` line obeys the same order rule, and for the same reason.** Written
first it IS the published description — and `plan: docs/plans/x.md` is 21
characters, one over the floor, so length alone does not catch it. The gate
refuses it explicitly.

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
