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
- **Board command:** pnpm board
- **Worker command:** PLOT_UNATTENDED=1 claude -p "You are implementing the branch $PLOT_BRANCH in this worktree, alone. Read .plot/briefs/${PLOT_BRANCH##*/}.md first — it is the specification, and its decisions were settled during plan interrogation: do not re-derive them, do not widen the scope. If you find something it did not anticipate, implement what you can and report the discovery rather than improvising. If you must stop and ask a person something, write PLOT-BLOCKED: followed by the question into a file in this worktree before you exit — the fleet scan reads that marker from the tree, not from your log, and without it a stopped worker is indistinguishable from a finished one and gets restarted into the same question. Delete the marker once it is answered. Follow CLAUDE.md: pnpm install if node_modules is missing, never skip tests, run pnpm build:board in THIS worktree and commit the artifact, add a changeset with its bumps block, never edit versions by hand, use trash not rm. Push your first real commit as soon as it exists and push again immediately after any rebase. Open a PR to main when done, then append the PR number to this branch's line in the plan's Branches section on main — check git branch --show-current is main before that edit. GitHub's API has returned 503 intermittently; if a push or merge appears to fail, verify the result via gh api rather than trusting the error. End your run with a report: the PR number, the judgement calls you made, and anything the plan did not anticipate." --permission-mode bypassPermissions
<!-- `bypassPermissions` because a detached worker is non-interactive: nobody
     can answer a prompt, and `acceptEdits` left one unable to run `pnpm test`,
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
| Coordination | `plot-fleet/` | Fleet pulse — which branch waves are complete/eligible/blocked, which branches are claimed (read-only, stateless) |
| Automation | `ralph-plot-sprint/` | Automated sprint runner (shell loop wrapper) |
| Companion | `challenge-the-plan/` | Deep plan interrogation (design-phase: idea → challenge → approve) — usable standalone, not a plot spoke |
| Companion | `story-tracking/` | Multi-session work tracking (stories = umbrella around plans) — usable standalone, not a plot spoke |
| Companion | `tracer-bullets/` | Thin vertical slice strategy — usable standalone, not a plot spoke |

Spoke commands reference helper scripts via relative path: `../plot/scripts/plot-pr-state.sh`.

## Helper Scripts

Scripts in `skills/plot/scripts/` that any model tier can use:

| Script | Purpose |
|--------|---------|
| `plot-pr-state.sh` | Query plan PR state (draft/ready/merged/closed) |
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
| `plot-config.sh` | Read a `## Plot Config` key with a default (`get <key> [default]`); includes the optional `Plan template` override key, the agent-runner keys (`Worker command`, `Approve command`), and the Plot 2 posture keys (`Plan PRs`, `Implementation home`, `Hosts plans`, `Tracker`, `Git host`) |
| `plot-host.sh` | Git-host adapter (gh/bb): `backend`, `default-branch`, `pr-state`, `pr-create`, `pr-merge`, `pr-list`, `pr-body`, `issue-list`, `issue-view` — the ONE place that talks to the host CLI. The two issue ops READ and never write: Plot reads the tracker and a plan referencing an issue is Plot's record, not the tracker's. `issue-list` runs on the PR timer and omits bodies; `issue-view` fetches one issue's body per click, for the board's *Create plan* action. Both exit 4 where the host cannot be asked at all (bitbucket), which is not the same answer as an empty list |
| `plot-approve.sh` | The mechanical half of approving a plan: merge the plan PR, flip the phase, fill `Approved:`, clear the `.plot/hold` entry for each branch the plan names, update the sprint annotation, push via `plot-push-main.sh`. Idempotent — step 2 writes irreversibly to the host, so re-running is the repair for any interruption after it; every step tests the source it would have written, never a progress file. Refuses a non-Draft plan, a `Review:` other than `pr`, and a draft/closed/absent PR |
| `plot-phase-gate.sh` | PreToolUse hook (see `hooks/hooks.json`): blocks implementation commits while the governing plan is Draft; plan-only commits pass; fails open. Reads the plan from `origin/<main>`, never the working tree — an approval nobody else can see is not one. When that ref is unreadable it allows the commit **and says the phase went unverified**: failing open, not failing silently |
| `plot-story-lint.sh` | Story-estate drift check (missing STORY files, frontmatter, done-not-archived, index sync); machine-countable footer; exit 1 on findings |
| `plot-reconcile-scan.sh` | Read-only plan/branch drift sweep (seven sections + machine-countable footer); section 3 classifies empty claims — `deferred:`/`moved:` in the plan means reapable, a bare `claimed:` means needs judgment. Section 5 (`attention=`) is what gates; section 7 (`index_drift=`) is convenience and gates nothing — since the phase grouping became derived, a plan with no symlink is visible everywhere that decides anything, so a missing link is a browsing gap while a **dangling** link is still a broken pointer. A file with no `Phase:` field is not a plan, the same rule `plot-fleet-scan.sh` applies |
| `plot-dispatch.sh` | Worktree fan-out: one worktree + claim + detached worker per eligible branch; `--dry-run`/`--no-start`/`--max N`; idempotent — re-running adopts rather than duplicates. Its phase gate reads the plan from `origin/<main>`, never the working tree, and **fails closed** when that ref is unreadable — `--allow-local` is the explicit, named escape for a repo with no remote. Before fanning out it reports which other branches already hold which files, read from local refs and worktrees (so unpushed and uncommitted work counts) — that report refuses nothing, because nothing on the candidate side is predicted. It DOES refuse a branch whose own worktree exists carrying unlanded work: a shared file is a prediction, but a desk somebody is sitting at is a measurement. Unlanded means commits not in the default branch OR uncommitted changes — an agent mid-edit has often committed nothing, and a worktree cut minutes ago reads as merged by ancestry alone. The worktree is found by asking git which one holds the branch, never by rebuilding the path from the branch name: hand-made worktrees are the population with no claim ref, and they rarely follow dispatch's naming. It reads the same local refs and worktrees, which is why dispatch is the only component that can see it — the fleet scan derives from `origin/<branch>`, and the measured failure was two implemented, green branches whose work was never pushed, so no claim existed and both read `eligible`. It names the worktree and claims nothing on the operator's behalf; `--allow-local` has no bearing on it, and a leftover worktree whose tip already merged stays dispatchable |
| `plot-merge-queue.sh` | Merge order + `git merge-tree` conflict prediction per plan; flags branches that collide with one ahead of them in the queue |
| `plot-resolve-artifact.sh` | The ONE automatic write: repairs an artifact-only merge conflict — merge, take a side, `pnpm build:board`, `pnpm run test:board`, push **only on green**. Refuses any conflict set that is not exactly the artifact, and takes a per-branch lock so two repairs never run on one branch. Licensed by three verified properties (`-merge` keeps the file valid, the rebuild is deterministic, CI's no-diff gate proves it) and by nothing else — a script rather than an agent, because judgement's absence *is* the permission |
| `plot-fleet-scan.sh` | Read-only wave/claim state per plan (complete/eligible/blocked + machine-countable footer); `--next` names one claimable branch (exit 1 = nothing to start); stateless — re-derived from git refs every run. `--stream` emits the same `--json` derivation as it resolves — one line per plan, then a terminal `pulse` line — because the scan is 18.3 s against the board's 5 s cadence and git alone is 12.7 s of that, so the wait is structural. The terminal line is what says the scan finished; a closed pipe does not, since a killed scan closes it too. A branch in a **terminal** state — merged or deferred, 26 of 54 here — is asked about once: the board holds the answers in memory and hands them back through `PLOT_TERMINAL_CACHE`, the scan reports the next pulse's map on stderr. Only the host round trip is skipped; git is re-consulted every pass and the entry is discarded the moment it disagrees, which is what keeps it a derivation rather than a record |
| `plot-worker-state.sh` | The ONE answer to "is a worker running in this worktree?" — **sourced, not run**, by both `plot-dispatch.sh` and `plot-fleet-scan.sh`. Returns facts (state, pid, exit code) and renders nothing, because the two callers need different shapes of one computation: `--status` prints prose for a person, `--json` emits tab-separated fields for a machine. It carried five of its six states in duplicate until 2026-08-18, and the copies had already drifted on the sixth. It now answers eight: six about the PROCESS, plus `waiting` and `stalled` about the TASK — every worker exits 0, so the exit code cannot say whether the work is done |
| `board/board-server.mjs` | Local Kanban status board — built artifact of `@plot-pm/board` (`packages/board`); run via `pnpm board`, rebuild via `pnpm build:board`. `pnpm board` runs under `node --watch`, so a rebuild takes effect in the running board — without it, a merged fix stays invisible to an open board and reads exactly like the fix not working |

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

## Gates Over Rules

**For important agent behaviors, always implement gates, not rules.** ([Reference](https://blog.fsck.com/2026/04/07/rules-and-gates/))

- A **rule** is a guideline the agent can rationalize around. Rules live in `CLAUDE.md` or skill instructions and depend on the agent choosing to follow them.
- A **gate** is a hard stop with objective verification — enforced via hooks (PreToolUse / PostToolUse) where the agent cannot proceed without meeting a concrete, checkable condition.
- **The test:** Can you answer "Did I complete this?" without actually doing the work? If yes, it's a rule. If no, it's a gate.

When writing skills that include critical workflows (phase guardrails, branch creation, PR state checks, destructive operations), prefer gates via hooks over prose-only instructions. Even when the user casually says "add a rule for X," evaluate whether it should be a gate and implement accordingly.

**Skill authors:** If your skill includes a "MUST" or "NEVER" instruction, ask: is this enforced by a hook, or just written in prose? If prose-only, it's a rule and will eventually be violated. Convert critical MUSTs to gates.

**Examples in plot:**
- The four phase guardrails (cannot approve unreviewed draft, cannot deliver with open impl PRs, cannot release undelivered work, etc.) are currently rules embedded in spoke commands. Stronger forms would be gates: a PreToolUse hook on `gh pr merge` that reads the plan's phase and blocks merges that violate the lifecycle.
- The "always run `pnpm test`" instruction in Testing above is a rule — a candidate for a gate via a pre-commit / pre-push hook.

## Testing

Plot is a pnpm workspace: the skills live at the repo root, and the board is a
package under `packages/`.

```bash
pnpm install         # install dependencies first if node_modules is missing
pnpm test            # validates all skills parse correctly
pnpm run test:reconcile   # plan-format contract tests (plot-plan-meta.sh)
pnpm run test:e2e         # lifecycle choreography in sandbox repos (stubbed hosts)
pnpm run test:board       # rebuilds the board artifact + runs its tests
pnpm run typecheck        # typechecks @plot-pm/board
```

**Always install dependencies and run tests.** If `pnpm test` fails due to missing `node_modules`, install them and retry — never skip tests or dismiss the failure.

**The board is first-class.** Keeping it working — and considering board impact when planning changes to the plan format, template, helper scripts, or `docs/plans` layout — is part of the [Definition of Done](docs/definition-of-done.md), gated in CI.

**On a conflict in `board-server.mjs`, do not read the diff.** It is generated output marked `-merge` in `.gitattributes`, so git keeps one version whole rather than splicing markers into it. Take **either** side, run `pnpm build:board`, and commit the result — the rebuild overwrites whichever side was kept, so the choice cannot matter. Never phrase it as "take ours": *ours* inverts between `git merge` and `git rebase`. Full procedure: [Definition of Done › Resolving a board artifact conflict](docs/definition-of-done.md#resolving-a-board-artifact-conflict).

**Fleet user test:** [docs/fleet-user-test.md](docs/fleet-user-test.md) — a
guided run of `/plot-fleet`, `/plot-dispatch`, and `/plot-merge-queue` in a
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
release process apply it:

```markdown
<!--
bumps:
  skills:
    plot-dispatch: minor
-->
```

Choose the level the way semver asks:

- **Patch** (`x.y.Z`): bug fixes, wording improvements, minor clarifications
- **Minor** (`x.Y.0`): new sections, new patterns, expanded coverage
- **Major** (`X.0.0`): structural reorganization, removed sections, breaking workflow changes

CI validates that every skill named in a `bumps:` block is a real directory
under `skills/` — a typo fails the build rather than silently bumping nothing.
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
