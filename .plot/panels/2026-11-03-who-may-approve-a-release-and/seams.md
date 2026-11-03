# Seams juror — who-may-approve-a-release-and

Position: amend

The plan is a Draft that names its own open questions, and it should move to Design. Its line references hold on `origin/main` (`f017f976e`). Its seam list misses one overlapping plan, one existing reviewer definition, the place the `plan:` lines live after a release, and two `waits:` edges. Each gap below would let an unattended Sonnet agent build a slice that conflicts with a sibling plan or reads an empty source.

## Findings

### Claims checked against origin/main

- `release-approve.ts:73` is the `caller === 'unattended'` test, and it is the only caller refusal in `releaseApprove`. True.
- `decision.ts:23` declares `Caller = 'person' | 'unattended' | 'fleetd'`. True. 20 source files under `packages/*/src` name `Caller`, with 30 caller comparisons; a fourth value touches `merge`, `continue`, `restart` and `release`, because `decision.ts:20-21` makes it "one vocabulary across" them.
- `deliver.ts:791` and `restart.ts:70` read `PLOT_UNATTENDED` from the process env; `release.ts:211` only starts the script. True.
- `entry/release-finish.ts:223` is the `releaseFinish(...)` call that passes `scope`; the domain function spans `release-finish.ts:110-177`. True.
- `review.ts:345` calls `reviewerCommand`; `auto-fixer.ts:454-455` reads `fixer.md` from `mainCheckout`; `repair-role.ts:112-113` reads `main-repair.md` from `origin/<default>` through `Refs.showFile`. True.

### S1 — #3074 also edits release-approve, and the plan names three plans, not four (seams)

Open Question 5 names #3070, #3071 and this plan as editors of the `release-approve` refusal sentence in `CLAUDE.md`. #3074 (`docs/plans/2026-11-03-pr-review-accepts-a-plot-review.md` on `idea/pr-review-accepts-a-plot-review`, lines 19 and 162) adds `review-foreign-writer` and `review-writer-unread` to `releaseApproveAt` and to the same sentence. That makes four plans that change one domain workflow (`release-approve.ts`), one entry (`entry/release-approve.ts`), one test file (`packages/domain/test/workflows-release-approve.test.ts`) and one `CLAUDE.md` sentence. Note: #3074 is still Draft (PR #3074 OPEN), not approved, so its order is not fixed yet.

### S2 — the reviewer already loads a definition, and the plan does not name it (seams, layering)

The plan says "no code loads `.claude/agents/reviewer.md`". That is true, but the reviewer reads `.plot/charters/reviewer.json` from the working tree (`review.ts:333`, `:586-588`; `charter.ts:254`). The charter supplies `model` and `effort` to `reviewerCommand`. After the slice, two reviewer definitions exist unless the slice removes one. The plan must say which one wins and what happens to the charter.

### S3 — `roleCommand` drops the reviewer's read-only enforcement (seams, safety)

`reviewerCommand` (`review-verdict.ts:157-190`) passes `--tools`, `--disallowedTools`, `--permission-mode dontAsk`, `--strict-mcp-config` and `--add-dir <reviews>`. `roleCommand` (`role-command.ts:62-87`) passes none of these: it passes `--agents`, `--agent`, `--settings` and `--max-turns`. The `--add-dir` matters: the reviewer reads the diff and verdict files under `<commonDir>/plot/state/reviews` (`review.ts:339`, `:345`). `roleCommand` also needs a settings file, and `origin/main` holds no `.claude/settings/reviewer.json` (only `fixer.json`, `main-repair.json`, `unblocker.json`). `rules/role-gate.ts:1-2` is written for "a non-reviewer role", so the existing settings hook does not fit the reviewer. The slice as written ("through one role-file loader") does not say whether the reviewer moves onto `roleCommand` or only takes its definition text from `origin/<default>` and keeps `reviewerCommand`.

### S4 — #3067's unblocker slice will add a third role-file load (seams)

`feature/fleetd-starts-the-unblocker` (`docs/plans/2026-11-03-a-desk-s-design-question-waits.md:47`, `:110`) starts the unblocker through `roleCommand` and does not say where `unblocker.md` is read from. If it lands first, it adds a third load; if this loader lands first, the unblocker slice should use it. The reviewer slice's `waits:` names only `feature/the-release-review-is-switched-on`. Open Question 9 names #3067, but no annotation or decision holds the order.

### S5 — the `plan:` lines are not in `.changeset/` when the finish runs (seams)

The finish slice "books those a changeset's `plan:` line names". At finish time the release PR has merged, and the version step has deleted every `.changeset/*.md` file: `origin/main:.changeset/` now holds only `README.md`, `_template`, `changelog-functions.js` and `config.json` (#3070's provenance table also lists `.changeset/*.md` as "deletion only"). The `plan:` lines survive inside HTML comments in `CHANGELOG.md` under the version heading (562 `plan: docs/...` lines on `origin/main`, for example `CHANGELOG.md:10`). An agent that reads `.changeset/` finds zero changesets and books nothing, silently. The plan must name the source (the tag's section of `CHANGELOG.md`, and whether `packages/*/CHANGELOG.md` counts) and what happens when a `plan:` line names a plan that is not Delivered (named, not booked; or a refusal).

### S6 — the finish slice waits on one #3071 slice, the question says both (seams)

Open Question 4 says "this work waits on both #3071 slices". The annotation names only `bug/release-approve-tells-its-tracker`. `bug/release-finish-refuses-another-sprint` adds `release-scope-mismatch` to the same domain function and changes the `FinishSprint` reading and the `sprint()` fixture in `release-finish-real-repo.test.ts`. The finish-scope slice changes the same function and the same fixture. Both edges belong in the `waits:` comment.

### S7 — the booking change reverses a decided limit in #3071 (seams)

#3071 (`docs/plans/2026-11-03-a-release-through-release-approve-leaves.md`, "Plans outside the sprint stay out of scope (decided)" and Notes "Limit:") records the opposite of this slice. Its sibling read keeps an issue open when "a Delivered plan outside the booking" names it, and its test "A shared issue stays open through the sibling read" uses such a plan C. The sibling read runs on `tmpwt` after the push, so a plan C that this slice books reads `Released` and the issue closes. The behaviour is correct, but #3071's test fixture loses its meaning once C is booked. The finish slice must name that test and say whether its plan C becomes a plan no `plan:` line names (still Delivered, still holds the issue open).

### S8 — person identity on board routes now has two candidates (seams)

#3067's `bug/an-answer-records-its-true-author` passes `author: "jwloka"` in the `continue` route body (`a-desk-s-design-question-waits.md:98`, `:114`), and `plot-approve.mjs --who <handle>` already takes a self-declared handle. This plan proposes a per-board token for `POST /api/release` and `POST /api/restart`. A request body handle and a page token are two identity mechanisms on one board. The Design phase must decide whether `continue`, `approve`, `release` and `restart` share one, or the plan must name why they differ.

### S9 — the question in Open Question 1 names a route that does not exist

`release-approve` has no board route: `controller-gate.ts:311-317` says "`release-approve` has no route and names its bundle", and `packages/board/src/server/index.ts` registers `/api/release` (per-plan `runRelease`) and `/api/restart` only. So "a refusal of a master agent at `release-approve` loses its effect through the board" applies to `POST /api/release`, which is a different action (`deliver.ts` `--release`), not to `release-approve`. The question should say which release path the caller reading guards: `release-approve` only, `POST /api/release` only, or both.

### Other rubric answers, briefly

- Defect and sprint goal (Q1): the release-approval and finish-scope slices remove two hand steps the sprint counts (the 2.30.0 hand repair in #3071's Motivation). A reader verifies the finish slice by a finish over a release whose `CHANGELOG.md` section names a Delivered plan outside the sprint. The caller slice adds a refusal, so it does not reduce interventions; it limits who acts.
- Failure modes (Q4): none is named yet. S5's empty source is the silent one.
- Unattended build (Q5): no slice is buildable as written; the plan says so (`Approach: Not chosen`). Every decision in *Decisions for a person* below blocks a slice.
- Tests (Q6): the plan holds no test list. The Design phase must add one per slice, each failing on `origin/main`.
- Bash 3.2, shell-lines ratchet, Bitbucket: no shell change is named. A Bitbucket arm is unaffected by the reviewer slice; the finish slice reads `CHANGELOG.md` and is host-free.

## Amendments required

1. Name #3074 as the fourth editor of `release-approve` and its `CLAUDE.md` sentence, and fix the landing order of #3070 `feature/the-release-checks-are-counted`, #3071, #3074 and this plan in the plan (S1).
2. Name `.plot/charters/reviewer.json` and `reviewerCommand`, and state whether the reviewer slice (a) takes only its definition text from `origin/<default>` and keeps `reviewerCommand`'s read-only flags, or (b) moves onto `roleCommand`, adding `.claude/settings/reviewer.json`, the `--add-dir` for the reviews directory, and the tool and permission limits. State which definition file is removed (S2, S3).
3. Add `feature/fleetd-starts-the-unblocker` to the reviewer slice's ordering, or state that the unblocker slice reads through the new loader (S4).
4. State that the finish slice reads `plan:` lines from the tag's section of `CHANGELOG.md`, and what a `plan:` line naming a non-Delivered or missing plan produces (S5).
5. Add `bug/release-finish-refuses-another-sprint` to the finish slice's `waits:` (S6).
6. Name #3071's shared-issue test and state how its plan C fixture stays meaningful (S7).
7. Rewrite Open Question 1 to name which release path the caller reading guards (S9).

## Decisions for a person

- Whether a master agent may run `release-approve` at all, and from which reading the code tells it from a person. Every env-based reading a master agent sets, a person's own shell can also set, so this is a trust decision, not an implementation one.
- One identity mechanism for board clicks across `continue`, `approve`, `release` and `restart`, or one per route (S8).
- Whether `plot-ask.mjs merge` gets the same caller reading as `release-approve`. #3068 leaves `plot-ask.mjs merge` unchanged, and a master agent can call it today.
- Whether the finish books a plan outside the sprint, or only names it (Open Question 3 stands).

## What I ran and what I only read

Ran (read-only): `git fetch`, `git show origin/main:<file>` with `sed -n` over every line reference in the plan, `git grep` on `origin/main` for `charterPath`, `reviewer.md`, `readRoleFile`, `Caller`, `/api/release`, `/api/restart` and `waits:`, `git ls-tree` on `.claude/`, `.plot/charters/` and `.changeset/`, a count of `plan: docs` lines in `CHANGELOG.md`, `gh issue view 3077`, `gh pr view` for #3067, #3068, #3070, #3071 and #3074, and `gh pr list` for the sibling slice branches.

Read only: the plans for #3065 (#3070), #3066 (#3071), #3063 (#3068) and #3064 (#3067) on `origin/main`; the #3074 plan on `idea/pr-review-accepts-a-plot-review`; `role-command.ts`, `role-gate.ts` (head), `review-verdict.ts:135-190`, `controller-gate.ts:300-330`, `skills/plot-release/SKILL.md` steps 3 and 5b. I ran no test suite and no host write.
