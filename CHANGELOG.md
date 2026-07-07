# plot

## 1.6.0

### Minor Changes

- [#34](https://github.com/plot-pm/plot/pull/34) [`c138ee4`](https://github.com/plot-pm/plot/commit/c138ee4f3c67e25ba6cae05a86454ec1ce98f064) Thanks [@jwloka](https://github.com/jwloka)! - Add `/plot-reconcile` — a read-only plan/branch reconciliation sweep — plus the shared plan parser and Plot Config accessor it is built on.

  A new spoke command that surfaces drift that per-delivery attention misses and only becomes visible in aggregate: a plan's phase disagreeing with which index dir (`active/` vs `delivered/`) its symlink lives in; an `Approved` plan whose impl branch already merged; merged-but-undeleted branches; and malformed plans (missing phase, front-matter `status:`/`phase:` disagreement).

  - **plot-reconcile** (new skill, v1.0.0) — two-stage Scan→Act command. Stage 1 runs `plot-reconcile-scan.sh`, a deterministic five-section report where each finding carries its exact remediating command as copy-paste text. Stage 2 is the human's judgment on what to run. Read-only by construction — the only writes are `git fetch` and (when unset) the local `origin/HEAD` ref.
  - **plot** (dispatcher) — add `/plot-reconcile` to the spoke command list, plus two new shared helpers all tooling should build on: `plot-plan-meta.sh` (plan metadata as JSON — parses both the canonical `## Status` body format and YAML front matter; the plan-format contract, specified by example in `test/reconcile/`) and `plot-config.sh` (the `## Plot Config` reader).

  Forge-aware: open-PR enumeration binds to the forge of the `origin` remote — `gh` on GitHub, `bb` on Bitbucket — and degrades to git merge-state alone otherwise. The main branch is detected from `origin/HEAD` (override with `- **Main branch:** <name>` in `## Plot Config`); plan directory, indexes, and branch prefixes are read from `## Plot Config` too.

  Proven twice in a downstream monorepo (each run caught genuine drift a human then fixed) before being contributed upstream; contract-tested end-to-end in CI.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#35](https://github.com/plot-pm/plot/pull/35) [`ade7164`](https://github.com/plot-pm/plot/commit/ade7164f325023651a4d89c9c02e02046c97bbb0) Thanks [@eins78](https://github.com/eins78)! - Close the drift loop: `/plot` hygiene line + `/plot-deliver` verification gate.

  - **plot** (dispatcher) — step 1 now runs the reconcile scan and reads its one summary line; when findings exist, the Status Summary gains a single `⚠ N hygiene findings — run /plot-reconcile` line (nothing when clean). To make that ambient-cheap, `plot-plan-meta.sh` parses any number of plan files in one awk pass (measured: 3.4s → 0.6s on a 12-plan repo; the old per-file subprocess chain would have cost ~15s at 90 plans) and the scan parses each plan once, reusing the rows across sections.
  - **plot-reconcile** — the report now ends with a machine-countable summary footer (`summary: drift=… merged_not_delivered=… stale=… attention=… concurrent=… pr_source=… main=…`); the dispatcher hygiene line and the Automation Output read it instead of parsing section bodies.
  - **plot-deliver** — new step 7b: after the delivery push, re-run the reconcile scan and grep for the delivered plan's dated basename. A hit means the delivery half-landed (phase flipped but symlink not moved, or vice versa) — the finding and its fix surface immediately instead of weeks later. Supersedes the opt-in post-deliver nudge idea from [#33](https://github.com/plot-pm/plot/issues/33): a targeted post-condition needs no config key and no prompt.

  <!--
  bumps:
    skills:
      plot: minor
      plot-deliver: minor
      plot-reconcile: patch
  -->

### Patch Changes

- [#37](https://github.com/plot-pm/plot/pull/37) [`68ce035`](https://github.com/plot-pm/plot/commit/68ce035d7b67e8db6f4135552af88853f0786e7b) Thanks [@eins78](https://github.com/eins78)! - Follow-up fixes to the reconcile drift loop ([#34](https://github.com/plot-pm/plot/issues/34)/[#35](https://github.com/plot-pm/plot/issues/35)), from review of the combined set:

  - **plot-deliver** — step 7b recast from a rule into a real gate: progression is gated on the reconcile scan's actual output (the grep result / `summary:` footer), not a self-asserted "Verified" bullet (which was emittable without running the scan). Also `mkdir -p docs/plans/delivered` before the symlink move, so the first-ever delivery in a fresh adopter repo can't half-land.
  - **plot** — the reconcile scan now (1) fails loudly with a `command -v jq` guard instead of silently reporting `drift=0` when jq is absent; (2) routes terminal-state (`Superseded`/`Rejected`) symlinks to the `delivered/` terminal index instead of the wrong `active/` default, and flags a terminal plan still symlinked in `active/` as §1 drift; (3) gains `--no-pr`/`--offline` flags, and the `/plot` hygiene line uses `--offline` so it makes no forge network call (previously `--no-fetch` still ran `gh/bb pr list` on every `/plot`). `pr_source` reports `off` for the deliberate skip.
  - **docs** — `CLAUDE.md` Helper Scripts table lists `plot-plan-meta.sh`, `plot-config.sh`, and `plot-reconcile-scan.sh`.

  <!--
  bumps:
    skills:
      plot: patch
      plot-deliver: patch
      plot-reconcile: patch
  -->

## 1.5.0

### Minor Changes

- [#29](https://github.com/plot-pm/plot/pull/29) [`852d2fc`](https://github.com/plot-pm/plot/commit/852d2fcfe366a931b85bdfb53207700033eaa295) Thanks [@eins78](https://github.com/eins78)! - Address remaining points from plot-pm/plot#1:

  - **plot-approve** — set project-board status to "In Progress" (not "Ready") when the impl PR is created; approved work is actively being implemented. Add a "Finishing an impl branch" subsection so the agent knows to run `gh pr ready <number>` when work is done. Reviewers filter by PR state, not by chat messages.
  - **plot** (dispatcher) — replace the single >7-day "stale drafts" heuristic with two distinct signals: **Completed drafts** (draft PRs with real commits — suggest marking ready) and **Abandoned drafts** (>7 days idle — surface for cleanup).
  - **plot-release** — reframe as a participant in the project's release process, not the driver. Step 4 is now "Hand-off to Project Release Process" — version bump, tag, and push belong to the project's release tooling (changesets, CI, or manual), not to plot-release. Summary no longer frames release mechanics as "what remains" for plot to do.

  <!--
  bumps:
    skills:
      plot-approve: patch
      plot: patch
      plot-release: minor
  -->

## 1.4.0

### Minor Changes

- [#25](https://github.com/plot-pm/plot/pull/25) [`e0d5bcb`](https://github.com/plot-pm/plot/commit/e0d5bcb73fcb668799194c871e6f95bc0a7ab580) Thanks [@eins78](https://github.com/eins78)! - story-tracking: define how to archive a completed story. Adds an "Archiving a Story" section (set `status: done` + `archived:` date, `git mv` the folder into `docs/stories/archived/`, repoint inbound links, update the index) plus a matching `archived:` frontmatter field in the template. Previously the skill had no defined end-of-life step for a story. Ported from quatico-solutions/agent-skills#13, which was stranded by the skill's move to this repo.

  <!--
  bumps:
    skills:
      story-tracking: minor
  -->

## 1.3.0

### Minor Changes

- [#23](https://github.com/plot-pm/plot/pull/23) [`08999f8`](https://github.com/plot-pm/plot/commit/08999f81b484e52a0524059bad72002deb59f222) Thanks [@eins78](https://github.com/eins78)! - New skill: challenge-the-plan — deep plan interrogation via adaptive interviews, adopted from quatico-solutions/agent-skills. The design-phase companion: idea → challenge → optional tracer → approve. Plot's companion pool now covers the full design loop (challenge-the-plan, tracer-bullets) plus long-running tracking (story-tracking).

  Also ships the `/challenge-the-plan` command (`commands/challenge-the-plan.md`) — the plugin's first command.

  No `bumps:` block — the skill is new to this repo and ships at its authored version (1.0.0).

- [#22](https://github.com/plot-pm/plot/pull/22) [`dd3737a`](https://github.com/plot-pm/plot/commit/dd3737a8a370a61902eeb269f5092d53a45b5357) Thanks [@eins78](https://github.com/eins78)! - New skill: story-tracking — multi-session work tracking in markdown folders, adopted from quatico-solutions/agent-skills. Stories are the long-running umbrella (research, decisions, session narrative); plans remain the approved, actionable units — sibling concepts, now one plugin. Cross-plugin references softened (markdown/bye skills now optional mentions); provenance noted in the skill README.

  No `bumps:` block — the skill is new to this repo and ships at its authored version (1.0.0).

- [#20](https://github.com/plot-pm/plot/pull/20) [`aa22711`](https://github.com/plot-pm/plot/commit/aa22711ebf167b0237b7c77deb55d5c8df1f1529) Thanks [@eins78](https://github.com/eins78)! - New skill: tracer-bullets — thin vertical slice strategy, adopted from eins78/agent-skills. It returns home: the skill was designed in the Plot workflow family (part of the pre-split 1.0.0 lineage) and `/plot-approve`, the plan template, and the quickstart already reference it as a sibling. Those references now resolve in-repo. Repo-level docs (README, CLAUDE.md, plot SKILL.md sibling section) updated to reflect bundling.

  No `bumps:` block — the skill is new to this repo and ships at its authored version (1.0.0-beta.1).

### Patch Changes

- [#21](https://github.com/plot-pm/plot/pull/21) [`f33b1ef`](https://github.com/plot-pm/plot/commit/f33b1ef3f8685d029cda4858c33917c75ed182ba) Thanks [@eins78](https://github.com/eins78)! - Repo moved to the plot-pm org: github.com/plot-pm/plot (old eins78/plot URLs redirect). All live references updated — README install instructions, CLAUDE.md, package.json, plugin manifest, changeset changelog config, and `metadata.repo` in every SKILL.md. CHANGELOG and sessionlogs left as historical record.

  <!--
  bumps:
    skills:
      plot: patch
      plot-idea: patch
      plot-approve: patch
      plot-deliver: patch
      plot-reject: patch
      plot-release: patch
      plot-sprint: patch
      ralph-plot-sprint: patch
  -->

## 1.2.0

### Minor Changes

- [#18](https://github.com/eins78/plot/pull/18) [`adc77c7`](https://github.com/eins78/plot/commit/adc77c782ab238822513bb5def9c3d3c0cb48c59) - Add local Kanban status board (`pnpm board`) to the plot skill

  <!--
  bumps:
    skills:
      plot: minor
  -->

## 1.0.1

### Patch Changes

- [#15](https://github.com/eins78/plot/pull/15) [`66c6d6c`](https://github.com/eins78/plot/commit/66c6d6ca6555c80c8114345a8581fb1dee689aca) - Add a narrative tutorial for new users, and clarify how Plot relates to GitHub Issues.

  `skills/plot/intro-to-using-plot.md` is a new second-person walkthrough of the lifecycle (Draft → Approved → Delivered → Released), modeled on [changesets' `intro-to-using-changesets.md`](https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md). It closes the gap between the high-level `README.md` and the AI-facing reference manual in `SKILL.md`. Linked from both.

  The MANIFESTO's "Not an issue tracker" bullet is reframed to match. Previously it said GitHub Issues "overlap and conflict" with Plot. The updated wording keeps the strong stance that Plot replaces issue trackers for _planned implementation work_, while acknowledging that issues remain useful **upstream** of the workflow — as the inbox for external feedback (bug reports, user-submitted feature requests, high-level user stories or business goals) that may eventually become plans. The boundary: issues are signals; plans are commitments.

  <!--
  bumps:
    skills:
      plot: patch
  -->

## 1.0.0

### Minor Changes

- [#9](https://github.com/eins78/plot/pull/9) [`230a981`](https://github.com/eins78/plot/commit/230a98185ac5c7d0d70ee2acb9f4ea5b2d7a9ccb) - `plot-sprint`: detect false-positive completions at close. Step 2 of `/plot-sprint <slug> close` now verifies, for each `[x] [slug]` item, that the referenced plan lives in `docs/plans/delivered/` (not `active/`). If any are still in `active/` or missing, close is blocked until resolved via `/plot-deliver`, unchecking the box, or an explicit override that logs a one-liner reason in `## Notes > ### Scope Changes`. The same flag also surfaces in `/plot-sprint status` so the discrepancy is visible during routine checks. Adds a `## Common Mistakes` section. Closes the gap surfaced in [issue #2 / observation 5](https://github.com/eins78/plot/issues/2#issuecomment-4057881195).

- [#11](https://github.com/eins78/plot/pull/11) [`2da3da9`](https://github.com/eins78/plot/commit/2da3da9fde1ba95e130c49359ea54c08514ce851) - `plot-sprint`: optional PR-aware lifecycle for sprint planning.

  After the initial skeleton lands on main (unchanged), Planning-phase refinement may now optionally happen on a `sprint/<slug>` branch with a draft PR. Use a PR when multiple stakeholders need to review scope, when readiness/deferral decisions deserve their own commits, or when scope conversations benefit from inline comments.

  `/plot-sprint <slug> commit` is now PR-aware:

  - If a `sprint/<slug>` PR exists and isn't merged: bump phase to Committed on the PR branch, push, mark ready, and merge with `--merge` (planning history preserved).
  - Otherwise: direct main commit, unchanged from before.

  Default merge strategy is `--merge` (mirrors `plot-approve` for plan PRs). Squash is explicitly forbidden by default — it collapses readiness/defer/date commits into one and erases reasoning. Adds an entry in the new `## Common Mistakes` section.

  Frontmatter `compatibility:` line and intro paragraph updated to reflect the optional PR path. Closes [issue #2](https://github.com/eins78/plot/issues/2) observations 2, 3, 5, and 6 — the "Theme A: Sprint PR lifecycle" bundle from the plot-skills-improvement plan.

### Patch Changes

- [#10](https://github.com/eins78/plot/pull/10) [`c4a9b6c`](https://github.com/eins78/plot/commit/c4a9b6c47bcee44ae5d66ed28a38a5b8cdf74f71) - `plot-sprint`: make the phase-transition rule explicit, and document multiline create input.

  Renames `## Guardrail` → `## Guardrails` and adds a `### Phase Transitions` sub-section stating that the `Phase` field is updated only by named subcommands (`commit`, `start`, `close`). All other actions — opening a PR, refining items, fixing typos — leave the phase unchanged. Closes the gap behind [issue #2 / observation 1](https://github.com/eins78/plot/issues/2) where "start a PR for the sprint" was misread as `/plot-sprint <slug> start`.

  Also adds a one-paragraph note on multiline `$ARGUMENTS` to the Create step 1 (Parse Input): subsequent lines after the first become the body of `## Sprint Goal`, not the one-line headline. Closes [issue #2 / observation 4](https://github.com/eins78/plot/issues/2).

- [#13](https://github.com/eins78/plot/pull/13) [`93152ad`](https://github.com/eins78/plot/commit/93152adaf631fdc00b20d4765136ac8b987baefc) - Release pipeline cleanups:

  - **CHANGELOG.md**: rename `## 1.0.0` heading to `## 1.0.0 — Initial release (pre-changeset history)` to prevent a duplicate heading when changesets generates the real `## 1.0.0` stable-release entry in the future.
  - **ralph-plot-sprint version drift**: bump `skills/ralph-plot-sprint/SKILL.md` from `1.0.0-beta.2` → `1.0.0-beta.3` to align with the rest of the skill versions (pre-existing drift; no content change).
  - **RELEASING.md**: create release guide with a `## Downstream: plot-marketplace` section documenting the manual post-release step and open questions for the maintainer.

## 1.0.0 — Initial release (pre-changeset history)

### Features

- Add Plot skill: git-native planning workflow with hub-and-spoke architecture
- Add `plot-idea`: create plan branches with plan files and draft PRs
- Add `plot-approve`: merge approved plans and fan out implementation branches
- Add `plot-deliver`: verify implementation PRs and deliver plans
- Add `plot-release`: cut versioned releases with changelogs
- Add `plot-sprint`: time-boxed sprint management with MoSCoW prioritization
- Add `ralph-plot-sprint`: automated sprint runner with shell loop wrapper
- Add `tracer-bullets`: standalone thin-vertical-slice skill with plot integration
- Add MANIFESTO.md: founding principles and design boundaries
- Add helper scripts (`plot-pr-state.sh`, `plot-impl-status.sh`, `plot-review-status.sh`) for structured JSON output
- Add model tier guidance (Haiku/Sonnet/Opus) to all skills and scripts
- Add batch mode, automation output mode, and sprint item annotations
- Add quickstart guide and troubleshooting section
- Externalize plan, sprint, and retrospective templates
- Add review tracking with SHA comparison
- Add self-improvement rules to technical skills

### Bug Fixes

- Fix phase mismatch in `plot-approve` — update phase to Approved on main
- Fix `ralph-sprint` worktree staleness and RC re-tag detection
- Fix CSO violation handling and AUTOMERGE=false stall case in `ralph-plot-sprint`

### Refactoring

- Split plot skills into standalone repo from eins78/skills
- Rewrite CLAUDE.md as Plot-specific contributor guide
- Standardize tooling discovery format, third-person voice, and sync comments
