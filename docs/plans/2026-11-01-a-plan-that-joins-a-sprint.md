# A plan that joins a sprint names the sprint

> One domain rule answers which sprint a plan belongs to, one command writes a sprint's member line and the plan's `Sprint:` field in the same commit, approve and deliver pick the sprint file through the rule, and a gate refuses a commit that adds a plan to an open sprint while the plan names another sprint or none.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** delivery-loop
- **Issue:** #2999
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #3000 merged
- **Started:** 2026-11-01, Jan Wloka, `feature/sprint-membership-is-one-rule`
- **Started:** 2026-11-01, Jan Wloka, `feature/approve-and-deliver-find-the-sprint-by-rule`
- **Started:** 2026-11-01, Jan Wloka, `feature/a-plan-joins-a-sprint-through-one-command`
- **Started:** 2026-11-01, Jan Wloka, `feature/a-sprint-member-names-its-sprint`
- **Started:** 2026-11-02, Jan Wloka, `bug/the-delivery-loop-sprint-is-repaired`
- **Story:** <!-- optional, story slug this plan is part of (docs/stories/<slug>/) -->
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- One domain rule, `sprintOfPlan`, answers which sprint a plan belongs to: the sprint that lists the plan on an unstruck Must, Should or Could line, preferring a sprint that is not Closed, then the newest by `Start:`. A Deferred line and a struck line (`~~[slug]~~`) are not membership.
- `/plot-approve` annotates and `/plot-deliver` ticks the member line in the sprint that `sprintOfPlan` answers, also when the plan's `Sprint:` field is empty. Neither edits a `### Scope Changes` line or a Deferred line any more.
- `plot-sprint-member.mjs add|defer|remove` writes a sprint's member line, a dated `### Scope Changes` line once the sprint is Committed or Active, and the plan's `- **Sprint:**` line, in one commit. `/plot-sprint` creation, scope change and carry-over call it. It refuses an unattended caller, a plan file it cannot find, a Closed sprint, and a plan that another open sprint already lists, and it writes nothing when it refuses.
- `add` sets the plan's field to the sprint, and annotates or ticks the new member line when the plan is already Approved or Delivered. `defer` keeps the field. `remove` clears the field only when no other open sprint lists the plan. A carry-over is an `add` to the next sprint, which moves the field.
- A commit that adds or moves a plan onto a Must, Should or Could line of a sprint in Planning, Committed or Active is refused while the plan's `Sprint:` field differs from `sprintOfPlan`'s answer. The gate runs at commit time beside `plot-state-gate.sh`, and in CI on a pull request over the PR's diff. It never reads a whole file and never runs on a push to `main`.
- A plan that names a sprint which does not list it is reported, not refused. This is allowed while the plan is Draft or Design.
- The board's contract comments (`schema.ts`, `filters.ts`) state the new rule: membership is the sprint file's, and the `Sprint:` field names the one sprint `sprintOfPlan` answers.

<!-- Board impact: small. The board joins sprint membership on the sprint file (App.tsx:1137, schema.ts:2620-2625), and that does not change. The field drives the PlanCard sprint badge (PlanCard.tsx:386) and the story sprint counts (board.ts:2084-2090), which become correct when the field is. Two contract comments change wording (slice "writer"). No view changes. -->

## Motivation

A plan that joins a sprint after the sprint starts keeps an empty `Sprint:` field. Two prose steps in `skills/plot-sprint/SKILL.md` ask for the field: step 6 of creation (`:337-344`) and the Scope Change flow (`:781`, "If plan-backed (`[slug]`), update the plan's Sprint field"). No command writes the field, and no check compares a sprint member with its plan. Step 6 also says "after the Phase line"; plans have no Phase line, and the template puts `Sprint:` after `Type:` (`.plot/templates/plan.md:14-15`).

### Measured cases

On `docs/sprints/2026-W44-delivery-loop.md`, five plans joined after creation. Each joining commit changed only the sprint file (`789fed2e3`, `ab0ab107b`, `b1df72cf1` for two plans, `fc06f0678`). 3 of the 5 named no sprint: `the-plan-walk-moves-into-the` (#2980) and `the-commit-gates-match-only-the` (#2974) had no `Sprint:` line, and `every-plan-reference-shows-its-issue` (#2993) had an empty one. They were fixed by hand in `a9d743627` and `b3e145659`. 2 of the 5 (`ci-runs-what-the-change-touches`, `the-bundle-gate-refuses-the-repair`) have no `### Scope Changes` line.

The empty field has a cost today, because approve and deliver use it only as an "is it empty" guard:

- `the-commit-gates-match-only-the` was delivered at `251b2abfc` (2026-11-01 02:37) with no `Sprint:` line. `tickSprint` returned `none` at its guard (`deliver.ts:583`). The field was filled at `b3e145659` (14:15). Its member line on `origin/main` is still `- [ ]` under Should Have.
- The three Should Have items carry no `<!-- pr:, branch: -->` annotation; the twelve Must Have items carry one. Each of the three plans was approved before it joined the sprint (`cbdf00859` and `54d9ffacd` on 2026-10-31 before `b1df72cf1` at 18:31; `8235c973a` at 13:05 on 2026-11-01 before `fc06f0678` at 13:06). So approve found no line, and its empty-field guard (`approve.ts:754`) skipped the sprint directory as well. Nothing annotates a plan that joins a sprint after its approval.

Approve and deliver choose the sprint file by text search, not by the field's value. `annotateSprint` (`approve.ts:747-771`) and `tickSprint` (`deliver.ts:574-599`) walk the sprint directory and act on the first file whose text contains `[slug]`. `annotateSprintItem` (`sprint-annotation.ts:27`) annotates every line that contains `[slug]`, including a `### Scope Changes` line. `tickSprintItem` (`sprint-tick.ts:33`) ticks the first unchecked line that contains it, in any section. Measured: `f57425ec0` (deliver `board-hides-a-green-draft-slice`, 2026-10-23) ticked the `### Deferred` line of the Closed sprint `2026-W42-bitbucket-jira-and-jenkins-work-with-the-board`, while the plan said `Sprint: bugfix-2-28-1` and that sprint listed it under Must Have.

### The estate

Measured at `origin/main` 68fde7aa8 by one method (see Notes, "Measurement method"):

- 25 sprint files: 24 Closed, 1 Active (`delivery-loop`).
- 428 member lines name a slug; 16 name no plan; 412 name a plan. 335 of the 412 agree with the plan's field, and 77 do not: 23 plans have no `Sprint:` line, 17 have an empty one, and 37 name another sprint. 74 of the 77 are on a Must, Should or Could line and 3 on a Deferred line.
- The 77 sit in 11 sprint files, all Closed. The Active sprint has 0.
- 27 plans are listed by two sprint files (25 of them on a Must, Should or Could line of both). Carry-over makes this the normal case: close moves unfinished Must Haves to Deferred (`SKILL.md:655`), and the next sprint lists them again (`SKILL.md:745`). `entities/plan.ts:212` says a plan has at most one sprint, so a rule must choose.
- 417 of 623 plans name a sprint. 82 of them are on no member line of the sprint they name; 1 of these names a sprint by its file name (`2026-W36-the-board-shows-the-strategic-layer`), which no sprint slug matches. This plan is one of the 82: it names `delivery-loop`, which does not list it yet.

`plot-reconcile-scan.sh` already reports the sprint-to-plan drift read-only, in `== 9. Unplanned sprint members ==`, `== 10. Sprint field unset ==` and `== 11. Sprint mismatch ==`. Those sections answer *is something wrong now*, for a person to fix by hand. This plan answers *which sprint is the plan's* (the rule), *can the wrong state be written* (the writer), and *can a commit land that leaves it wrong* (the gate).

## Design

### Approach

**The sprint files are the source of membership.** The `Sprint:` field names the one sprint that the membership rule answers. The writer keeps the field equal to that answer for every change it makes. The gate refuses a commit that adds a plan to an open sprint and leaves the field different. Closed sprints are history and are never rewritten.

**One domain rule answers membership.** `packages/domain/src/rules/sprint-membership.ts` holds arrow functions with factual TSDoc. It takes readings as values and imports no port.

- `sprintMembers(content)` answers the slugs a sprint file lists on an unstruck Must, Should or Could line. It reuses `itemsFrom` (`entities/sprint.ts:129`), which reads only lines under a tier heading (`TIER_HEADINGS`, `:59`) and accepts `MEMBER_LINE` (`:95`), and drops the slugs that `struckSlugs` reads (`rules/sprint-scope.ts:29-43`, exported for this). A line under `### Deferred`, `### Scope Changes`, `### Also shipped` or any other heading is not membership.
- `sprintOfPlan(slug, sprints)` takes `{ file, content }[]` for every dated sprint file and answers `{ sprint, file } | null`. The sprint slug is `slugOf('sprint', file)` (`rules/state-transition.ts:96`); the state and start date are the `State:` and `Start:` fields the sprint entity reads. Among the sprints whose `sprintMembers` contain the slug, it prefers a sprint whose state is not Closed, then the latest `Start:`, then the file name that sorts last. `null` means no sprint lists the plan.
- `sprintsListing(slug, sprints)` answers every sprint that lists the plan, with its state. The writer and the gate use it to name the other open sprint in a refusal.
- `memberLineIndex(content, slug)` answers the index of the plan's member line under a tier heading, or `-1`. `annotateSprintItem` and `tickSprintItem` take it, so they edit the member line only.

**Approve and deliver call the rule.** `annotateSprint` (`approve.ts:747-771`) and `tickSprint` (`deliver.ts:574-599`) read every sprint file through `PlanStore`, ask `sprintOfPlan`, and edit that one file. They drop the empty-field guard (`approve.ts:754`, `deliver.ts:583`), because the sprint file decides. They return `none` where `sprintOfPlan` answers `null`. Deliver stages the one sprint file it changed instead of the sprint directory (`deliver.ts:361`). The `f57425ec0` case then ticks `bugfix-2-28-1`, the open sprint that lists the plan under Must Have, and leaves the Closed W42 sprint's Deferred line unchanged.

**One writer.** `packages/board/src/server/entry/sprint-member.ts`, built to `skills/plot/scripts/board/plot-sprint-member.mjs` (`packages/board/build.mjs`, `contract/bundles.generated.ts`), with a row in `skills/plot/scripts/README.md`. A skill calls it with `node`; there is no shell launcher, so the shell-line ratchet (`scripts/check-shell-lines.sh`) does not change. The text transitions are pure domain functions in `packages/domain/src/transitions/sprint-member.ts`: each takes the sprint text, the plan text, the readings of the other sprint files and the date, and returns the two new texts or a named refusal.

- `plot-sprint-member.mjs add <sprint> <slug> --tier must|should|could [--reason "<text>"]`. It writes `- [ ] [<slug>] <plan title> (#<issue>)` under the tier heading. A plan already listed in this sprint moves to the tier. It sets `- **Sprint:** <sprint>`. When the plan is Approved or later, it annotates the line with the plan PR from the `Approved:` record and the first branch in `## Slices`, the inputs approve uses (`approve.ts:679`). When the plan is Delivered or later, it ticks the line.
- `plot-sprint-member.mjs defer <sprint> <slug> [--reason "<text>"]`. It moves the member line under `### Deferred` and keeps the field.
- `plot-sprint-member.mjs remove <sprint> <slug> [--reason "<text>"]`. In a Planning sprint it deletes the member line. In a Committed or Active sprint it strikes the reference (`~~[<slug>]~~`), the form the sprint template documents for an item that left the sprint. It clears the field when no other open sprint lists the plan; otherwise it sets the field to `sprintOfPlan`'s answer.
- In a Committed or Active sprint, every verb writes one dated line under `### Scope Changes`, in the formats `SKILL.md:780`, `:790` and `:794` give: `- YYYY-MM-DD: Added [slug] to Must — <reason>`, `Deferred [slug] from Must — <reason>`, `Reprioritized [slug] Must → Should — <reason>`, `Removed [slug] from Must — <reason>`. A Planning sprint gets no log line; it has no commitment yet.
- The field write is scoped to the first `## Status` section. It replaces an empty value or a placeholder comment (`<!-- optional -->` on 7 plans, the template's `<!-- optional, filled when plan is added to a sprint -->` on 8), and it inserts the line after `- **Type:**` when there is none. It refuses a value that is any other comment (4 plans hold a record such as `<!-- not a member; the sprint closed 2026-08-26 -->`) and names the plan. Measured over the 623 plans at 68fde7aa8 with the method in Notes.
- Refusals, each naming the slug and the sprint: `unattended` (under `PLOT_UNATTENDED=1`, as `entry/needs-design.ts:329` refuses; sprint scope is a person's decision), `plan-not-found` (no plan file for the slug in the checked-out tree; the writer never checks out or writes another branch), `sprint-not-found`, `sprint-closed`, `listed-elsewhere` (another open sprint lists the plan on a Must, Should or Could line; the refusal names that sprint and the `defer` or `remove` that frees the plan), `not-a-member` (`defer` or `remove` of a plan the sprint does not list), and `field-record` (the comment case above).
- No partial write. The writer computes both new texts before it writes. It writes the plan file, then the sprint file. When the second write fails, it restores the plan file from the text it read and refuses. A re-run with the same arguments changes nothing and exits 0.
- It commits the two paths with a pathspec commit (`git commit -m <subject> -- <plan> <sprint>`), so other staged paths stay out of the commit, through the same tree adapters approve uses (`stageApproval`, `approve.ts:777`). `--no-commit` stages the two paths and does not commit; `/plot-sprint` creation passes it for each plan and commits the skeleton and every plan in step 7, in one commit.

**`/plot-sprint` calls the writer.** Step 6 (`SKILL.md:337-344`) calls `add --no-commit` for each plan-backed item. The Scope Change flow (`SKILL.md:752-794`) calls `add`, `defer` and `add` with a new tier in place of its hand edits; the "dispatched work only" check (`:756-776`) stays a person's check in the skill. The close flow's "Move incomplete must-haves to Deferred" (`:655`) calls `defer`, and its carry-over (`:745`) calls `add` on the next sprint. The skill's Model Guidance table changes with the steps.

**The gate reads only what a commit adds.** `packages/domain/src/rules/sprint-member-gate.ts` holds `sprintMemberRefusals(changes, readings)`. `changes` is the list of changed sprint files with their `HEAD` text (or `null` for a new file) and their new text. `readings` gives the new text of every sprint file and a lookup of a plan's `Sprint:` value in the new tree. The rule:

- It reads a sprint file only when its new `State:` is Planning, Committed or Active.
- A member line is *added or moved* when its slug is in the new `sprintMembers` and was not in the old one, or sat on another tier. A tick, an annotation, a Deferred line and a struck line are not.
- For each added or moved slug that names a plan, it refuses when the plan's field (comment removed, trimmed) differs from `sprintOfPlan`'s answer over the new tree. The refusal names the plan, the sprint, the line to write, and the command: `plot-sprint-member.mjs add <sprint> <slug> --tier <tier>`.
- A slug with no plan passes; reconcile section 9 reports it.
- A plan file whose `Sprint:` value a commit sets or changes, to a sprint that does not list it, is not refused. The commit-time form prints one line to stderr, and the CI form prints a `::notice::`.

Two forms run the one rule:

- At commit time, a row `sprint-member` in `GATES` (`packages/board/src/server/entry/gate.ts:993-1001`), beside `stateGate` (`:299`). `plot-gates.sh` already runs `plot-gate.mjs --all` from `hooks/hooks.json`, so the row adds no hook and no shell. It reads the staged text, as `stateGate` does through `effectivePaths`. Approve and deliver commit inside a node process, which no PreToolUse hook sees; the CI form covers them.
- In CI, a step in the `checks` job (`ci.yml:951`), after `Build the board bundles` (`:1051-1052`), with `if: github.event_name == 'pull_request'`, the condition `A PR carries no bundle` uses (`:1039-1041`). It runs `scripts/check-sprint-members.sh`, a launcher that runs `plot-sprint-member.mjs check --base <merge base of origin/main and HEAD>`. It never runs on a push to `main`, so a commit that bypasses the hook cannot turn `main` red and hold the merge queue through `default-branch-red`. A missing bundle fails the step: in CI the bundle is built one step earlier, so a missing bundle is a broken build, not an install to repair.

Replayed over every non-merge commit on `origin/main` from 2026-10-01 to 68fde7aa8 that touches `docs/sprints/` (321 commits, 191 added or moved member lines), the gate refuses 19 lines in 13 commits. Every one is a scope-change commit that added a plan whose field was empty, among them `b1df72cf1` and `fc06f0678`. It refuses none of the 191 approve and deliver commits in that range, none of the 23 approve and deliver commits of `delivery-loop`, and not `f57425ec0`. Over today's tree, the one open sprint has 0 disagreements, so the gate refuses 0 commits that touch it.

**A Draft may name the sprint it is about to join.** A plan on its `idea/` branch may carry `- **Sprint:** <slug>` before the sprint lists it. That states intent, and the Scope Change rule (`SKILL.md:758-760`) admits it to a running sprint only once it is dispatched. This is allowed while the plan is Draft or Design. For a plan that is Approved or later, the same state is drift: the gate does not refuse it, and the report names the `add` or the field clear that repairs it.

**The board.** Membership stays the sprint file's: the Delivery tab, the sprint filter and the sprint panel join on member lines (`App.tsx:1137`). A plan listed by two sprints appears in each sprint's member list and passes the filter for either (`slugPassesSprintFilter`, `rules/sprint-selection.ts`), as today. The Planning card's sprint badge (`PlanCard.tsx:386`) and the story's sprint counts (`board.ts:2084-2090`) show the one sprint the field names, which is `sprintOfPlan`'s answer. The writer slice rewrites `schema.ts:2620-2625` ("a back-reference, allowed to be stale") and `filters.ts:124-130` ("HISTORY and does not clear") to state this, and `entities/plan.ts:212` to say the field names the sprint `sprintOfPlan` answers.

**The current sprint is repaired through the new code.** After the writer and the approve and deliver changes merge, one commit on `main` runs `plot-sprint-member.mjs add delivery-loop <slug> --tier should` for `the-plan-walk-moves-into-the`, `the-commit-gates-match-only-the` and `every-plan-reference-shows-its-issue`. Each plan is already listed and already names the sprint, so the add writes only what the plan's state owes: the annotation for all three (plan PRs #2981, #2984, #2994), and the tick for the delivered `the-commit-gates-match-only-the`. It also adds this plan to `delivery-loop` once this plan is dispatched. No line is edited by hand.

### Decisions

- [x] **The writer is a domain transition behind a bundle**, `plot-sprint-member.mjs`, callable with no board, as `plot-approve.mjs` and `plot-needs-design.mjs` are. It is not an action on `plot-sprint-state.sh`: that script performs `setSprintState` and owns the `State:` receipt, and membership changes no `State:` line, so the writer needs no receipt. A board endpoint can call the same transition later. (All four jurors.)
- [x] **The gate runs at commit time and in CI on pull requests, over one domain rule, scoped to added or moved member lines in open sprints.** A whole-file or whole-tree check refuses the 11 Closed sprint files and every approve or deliver commit that touches one. The commit-time form stops a hand edit like `b1df72cf1`; the CI form sees commits that no hook saw. (All four jurors on the scope; seams wanted no CI form, and safety and testability wanted one; see the panel.)
- [x] **A Deferred plan keeps the sprint's name** while no other sprint lists it on a Must, Should or Could line. When a later sprint adds it, the field moves to that sprint, and the old Deferred line is history the rule does not read. (All four jurors.)
- [x] **A struck reference is not membership.** `sprintMembers` agrees with `sprint-scope.ts`, which reads a struck slug as out of scope, and not with `plot-reconcile-scan.sh`'s member regex, which does not match `~~[` at all. `itemsFrom` still lists a struck line as an item for the release gate; this rule answers a different question.
- [x] **Approve and deliver choose the sprint through the rule**, in this plan, as their own slice. Without it a correct field still sends a carried plan's tick to a Closed sprint (`f57425ec0`).

### Open Questions

- [x] Is the writer a new action on `plot-sprint-state.sh`, a domain rule behind a bundle, or a board controller endpoint? A domain rule behind the bundle `plot-sprint-member.mjs`.
- [x] Does the gate run at commit time (like `plot-state-gate.sh`) or in CI (a `scripts/check-*.sh`), or both? Both, over one rule, reading only added or moved member lines of open sprints; the CI form runs on pull requests only.
- [x] Does a plan in Deferred keep the sprint's name? Yes, until another sprint adds it.

## Slices

### Membership rule

- `feature/sprint-membership-is-one-rule` — `packages/domain/src/rules/sprint-membership.ts` with `sprintMembers`, `sprintOfPlan`, `sprintsListing` and `memberLineIndex`, exported from the package index; `struckSlugs` exported from `rules/sprint-scope.ts`; `packages/domain/test/sprint-membership.test.ts` with the rule rows of the test table, including a fixture built from the W42 and `bugfix-2-28-1` texts at `f57425ec0^`. No caller changes. <!-- builds: sprintOfPlan domain rule --> → #3002

### Approve and deliver

- `feature/approve-and-deliver-find-the-sprint-by-rule` — `annotateSprint` (`packages/board/src/server/entry/approve.ts:747-771`) and `tickSprint` (`packages/board/src/server/entry/deliver.ts:574-599`) call `sprintOfPlan` and drop the empty-field guard; deliver stages one sprint file (`deliver.ts:361`); `annotateSprintItem` (`packages/domain/src/rules/sprint-annotation.ts`) and `tickSprintItem` (`packages/domain/src/rules/sprint-tick.ts`) edit only the line `memberLineIndex` answers; tests in `packages/domain/test/rules-sprint-annotation.test.ts`, `packages/domain/test/sprint-tick.test.ts`, `packages/board/test/unit/approve.test.ts` and `packages/board/test/unit/deliver-retry-real-repo.test.ts`. <!-- waits: feature/sprint-membership-is-one-rule --> <!-- builds: approve and deliver pick the sprint by rule --> → #3005

### Writer

- `feature/a-plan-joins-a-sprint-through-one-command` — `packages/domain/src/transitions/sprint-member.ts` and its test `packages/domain/test/sprint-member.test.ts`; the entry `packages/board/src/server/entry/sprint-member.ts` with its unit test; the bundle wiring in `packages/board/build.mjs` and `packages/board/src/contract/bundles.generated.ts`; a row for `board/plot-sprint-member.mjs` in `skills/plot/scripts/README.md`; `skills/plot-sprint/SKILL.md` step 6, Scope Change, close and carry-over call the writer, with its Model Guidance table; the comments at `packages/board/src/contract/schema.ts:2620-2625`, `packages/board/src/app/lib/filters.ts:124-130` and `packages/domain/src/entities/plan.ts:212`; the comment at `skills/plot/scripts/plot-reconcile-scan.sh:1688-1690` ("a script writing one would be inventing it") reworded with no added line; a changeset that bumps `plot-sprint`. <!-- waits: feature/sprint-membership-is-one-rule --> <!-- builds: plot-sprint-member.mjs add, defer and remove --> → #3013

### Gate

- `feature/a-sprint-member-names-its-sprint` — `packages/domain/src/rules/sprint-member-gate.ts` and `packages/domain/test/sprint-member-gate.test.ts`; the `sprint-member` row in `GATES` (`packages/board/src/server/entry/gate.ts`); the `check` verb of `plot-sprint-member.mjs`; `scripts/check-sprint-members.sh` and its PR-only step in `.github/workflows/ci.yml`; the contract test `test/reconcile/sprint-member-gate.test.mjs`, which replays the four real commits through the hook. The gate waits on the writer so that its refusal names a command that exists. <!-- waits: feature/sprint-membership-is-one-rule, feature/a-plan-joins-a-sprint-through-one-command --> <!-- builds: sprint-member gate --> → #3021

### Repair

- `bug/the-delivery-loop-sprint-is-repaired` — runs `plot-sprint-member.mjs add delivery-loop <slug> --tier should` for the three Should Have plans, which writes their annotations and ticks `the-commit-gates-match-only-the`, and commits the result through the writer. Touches only `docs/sprints/2026-W44-delivery-loop.md`. <!-- waits: feature/approve-and-deliver-find-the-sprint-by-rule, feature/a-plan-joins-a-sprint-through-one-command --> <!-- builds: delivery-loop member lines repaired -->

## Done when

Each row names the test that proves it. Domain rows run in `pnpm --filter @plot-pm/domain exec vitest run`; board rows in `pnpm --filter @plot-pm/board exec vitest run`; contract rows in `node --test test/reconcile/sprint-member-gate.test.mjs`.

| Claim | Input | Expected | Test | Slice |
|---|---|---|---|---|
| A tier line is membership | sprint with `[a]` under Should Have | `sprintMembers` holds `a` | `sprint-membership.test.ts` | Membership rule |
| A Deferred, struck, log or untiered line is not | `[a]` under `### Deferred`; `~~[b]~~` under Must; `Added [c]` under `### Scope Changes`; `[d]` under `### Also shipped` | none of `a`, `b`, `c`, `d` | `sprint-membership.test.ts` | Membership rule |
| An open sprint wins over a Closed one | `a` on W42 Must (Closed) and on `bugfix-2-28-1` Must (Planning) | `bugfix-2-28-1` | `sprint-membership.test.ts` | Membership rule |
| The newest open sprint wins | `a` in two Active sprints, `Start:` 2026-10-28 and 2026-10-29 | the 2026-10-29 sprint | `sprint-membership.test.ts` | Membership rule |
| Only Closed sprints list it | `a` in two Closed sprints | the later `Start:` | `sprint-membership.test.ts` | Membership rule |
| No sprint lists it | `a` only on a Deferred line | `null` | `sprint-membership.test.ts` | Membership rule |
| A sprint slug is cut by `slugOf` | file `2026-W36-the-board-shows-the-strategic-layer.md` | `the-board-shows-the-strategic-layer` | `sprint-membership.test.ts` | Membership rule |
| Deliver ticks the sprint the rule answers (old and new code disagree) | W42 and `bugfix-2-28-1` at `f57425ec0^` | `bugfix-2-28-1` Must line ticked; W42 unchanged (old code ticked W42 Deferred) | `deliver-retry-real-repo.test.ts` | Approve and deliver |
| Deliver ticks with an empty field | plan with no `Sprint:` line, listed by one Active sprint | the member line ticked (old code returned `none`) | `deliver-retry-real-repo.test.ts` | Approve and deliver |
| Approve annotates with an empty field | plan with an empty `Sprint:`, listed under Should | the member line annotated | `approve.test.ts` | Approve and deliver |
| Annotation and tick skip a log line | sprint whose `### Scope Changes` names `[a]` | only the member line changes | `rules-sprint-annotation.test.ts`, `sprint-tick.test.ts` | Approve and deliver |
| Deliver stages one sprint file | an unrelated edit in another sprint file | that edit stays unstaged | `deliver-retry-real-repo.test.ts` | Approve and deliver |
| `add` writes three lines in one commit | Active sprint, plan with no `Sprint:` line | member line under the tier, a dated `Added` line, `- **Sprint:** <sprint>` after `Type:`; `git show --stat HEAD` lists exactly the two files | `sprint-member.test.ts` and the entry unit test | Writer |
| `add` in a Planning sprint logs nothing | Planning sprint | member line and field; no Scope Changes line | `sprint-member.test.ts` | Writer |
| `add` handles every field form | no line; empty value; `<!-- optional -->`; the template placeholder comment; `delivery-loop` already set; `<!-- not a member … -->` | the first five end as `- **Sprint:** <sprint>`; the sixth refuses `field-record` | `sprint-member.test.ts` | Writer |
| `add` writes only the first `## Status` | a plan that quotes a Status block in prose | the quoted block unchanged | `sprint-member.test.ts` | Writer |
| `add` owes the plan's state | Approved plan; Delivered plan | annotation with the plan PR and first branch; annotation and tick | `sprint-member.test.ts` | Writer |
| `add` moves a tier | plan listed under Must | the line under Should; `Reprioritized [a] Must → Should` | `sprint-member.test.ts` | Writer |
| Carry-over moves the field | plan on a Closed sprint's Deferred line, `add` to the next sprint | field names the next sprint | `sprint-member.test.ts` | Writer |
| `defer` keeps the field | Active sprint, Must line | line under `### Deferred`, `Deferred [a] from Must`, field unchanged | `sprint-member.test.ts` | Writer |
| `remove` clears the field | Active sprint, no other open sprint lists the plan | `~~[a]~~`, `Removed [a] from Must`, field empty | `sprint-member.test.ts` | Writer |
| `remove` keeps another open sprint's name | a second open sprint lists the plan | field names `sprintOfPlan`'s answer | `sprint-member.test.ts` | Writer |
| `remove` in Planning deletes | Planning sprint | the line is gone; no log line | `sprint-member.test.ts` | Writer |
| Refusals write nothing | `PLOT_UNATTENDED=1`; unknown slug; unknown sprint; Closed sprint; plan listed by another open sprint; `defer` of a non-member | `unattended`, `plan-not-found`, `sprint-not-found`, `sprint-closed`, `listed-elsewhere` (names the other sprint), `not-a-member`; both files byte-identical | entry unit test | Writer |
| No partial write | the sprint write fails after the plan write | the plan file restored; refusal | entry unit test | Writer |
| A re-run is a no-op | the same `add` twice | second run changes nothing, exits 0 | entry unit test | Writer |
| Other staged paths stay out | an unrelated staged file | the commit holds only the plan and the sprint | entry unit test | Writer |
| The writer's commit passes the gate | the `add` commit above | no refusal | `sprint-member-gate.test.mjs` | Gate |
| Gate refuses an added member with an empty field (old and new code disagree) | replay `b1df72cf1` and `fc06f0678` on their parents | exit 2; stderr names the plan, `- **Sprint:** delivery-loop` and the `add` command (old code: exit 0) | `sprint-member-gate.test.mjs` | Gate |
| Gate passes a member whose plan names the sprint | replay `ab0ab107b` | exit 0 | `sprint-member-gate.test.mjs` | Gate |
| Gate passes a tick | replay `d1c9e7eeb` and `f57425ec0` | exit 0 | `sprint-member-gate.test.mjs` | Gate |
| Gate ignores drift a commit did not add | open sprint with an existing member whose field is empty, commit ticks another line | exit 0 | `sprint-member-gate.test.ts` | Gate |
| Gate ignores Closed sprints and Deferred lines | `[a]` added to a Closed sprint; `[a]` added under `### Deferred` of an Active sprint | no refusal | `sprint-member-gate.test.ts` | Gate |
| Gate refuses another sprint's name | `[a]` added to an Active sprint, field names a Closed sprint | refusal | `sprint-member-gate.test.ts` | Gate |
| Gate checks a tier move | `[a]` moved from Deferred to Must, field empty | refusal | `sprint-member-gate.test.ts` | Gate |
| Gate passes a member with no plan | `[no-such-plan]` added | no refusal | `sprint-member-gate.test.ts` | Gate |
| A Draft may name a sprint | plan-only commit setting `Sprint: delivery-loop`, sprint does not list it | exit 0, one stderr line | `sprint-member-gate.test.mjs` | Gate |
| Removing the check fails a test | `sprintMemberRefusals` mutated to return `[]` | the `b1df72cf1` and `fc06f0678` rows fail; the result goes in the PR body | manual mutation step on `sprint-member-gate.test.mjs` | Gate |
| CI runs the gate on a pull request only | `ci.yml` | the step carries `if: github.event_name == 'pull_request'` and runs after `Build the board bundles` | `ci.yml` review and the step's first PR run | Gate |
| Today's estate passes | the CI form over a PR that ticks a `delivery-loop` line | 0 refusals | the step's first PR run | Gate |
| The current sprint is repaired | `add delivery-loop <slug> --tier should` for the three Should Have plans | three annotations (#2981, #2984, #2994); `the-commit-gates-match-only-the` is `- [x]`; the commit passes the gate | the repair commit's diff | Repair |

## Notes

### Measurement method

Every count in this plan uses one reader, the domain's: a tree from `git archive 68fde7aa8 docs/sprints docs/plans`; sprint files are `docs/sprints/YYYY-Www-*.md` at the top level (the `active/` link excluded); a member line is a line under `### Must Have`, `### Should Have`, `### Could Have` or `### Deferred` that matches `MEMBER_LINE` with a slug-shaped reference, deduplicated by slug per file with the first tier kept (`itemsFrom`); a struck line starts `- [ ] ~~[`; the sprint slug is `slugOf('sprint')` and the plan slug `slugOf('plan')`; a plan's field is the first `- **Sprint:**` line in its `## Status`, comments removed and trimmed. The replay applies the gate rule of the Approach to `git log --no-merges --since=2026-10-01 68fde7aa8 -- docs/sprints/`. Other readers give other counts: a checkbox regex over the whole file reads 446 lines and 93 disagreements, and counts 59 instead of 82 plans naming a sprint that does not list them, because it also reads lines under headings that `itemsFrom` skips.

### Seams

`every-plan-reference-shows-its-issue` has two open slices that edit the same files as this plan. `feature/the-panels-name-a-plan-one-way` adds a `check-plan-routes.sh` step to `.github/workflows/ci.yml`; this plan's Gate slice adds `check-sprint-members.sh` in the same `checks` job. `feature/the-fleet-payload-indexes-its-plans` adds an optional field to `packages/board/src/contract/schema.ts`; this plan's Writer slice rewrites the comment at `:2620-2625`. Both are adjacent edits, not shared lines. The slice that merges second rebases and keeps both.

### Out of scope

- The 77 disagreements in Closed sprints stay as history. Reconcile sections 9 to 11 still report them.
- Reconcile sections 9 to 11 keep their own member regex. Moving them onto `sprintMembers` through a bundle would remove that duplicate and lower the shell line count; it is a follow-up.
- A commit that clears or changes a plan's field while an open sprint lists it is not refused; only an added or moved member line is. Reconcile section 10 and 11 report it.
- The "dispatched work only" rule for a running sprint (`SKILL.md:756-776`) stays a person's check in the skill, because it needs a remote read.

Created from tracker issue #2999 (https://github.com/plot-pm/plot/issues/2999). Definition of Done: docs/definition-of-done.md.
