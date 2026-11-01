## Implementation brief — a-plan-that-joins-a-sprint (wave: Writer)

- **Plan (canonical):** docs/plans/2026-11-01-a-plan-that-joins-a-sprint.md on main
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #3000 merged
- **Branch:** `feature/a-plan-joins-a-sprint-through-one-command` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review, per repo convention

Two slices ahead of this one are already merged: `feature/sprint-membership-is-one-rule` (PR #3002, the `sprintOfPlan` rule) and `feature/approve-and-deliver-find-the-sprint-by-rule` (PR #3005, approve/deliver call the rule). The Gate slice (`feature/a-sprint-member-names-its-sprint`) and the Repair slice (`bug/the-delivery-loop-sprint-is-repaired`) both wait on this one — the Gate's refusal needs to name a command that exists, and the Repair commit needs the writer to run.

### What to build

A new writer, `plot-sprint-member.mjs`, with three verbs (`add`, `defer`, `remove`) that each write a sprint's member line, the plan's `- **Sprint:**` field, and (in a Committed/Active sprint) a `### Scope Changes` log line — all in one commit, covering the gap the plan's Motivation section measures: five plans joined `delivery-loop` by hand-editing only the sprint file, leaving 3 with no `Sprint:` field and 2 with no Scope Changes line.

Concretely:
- `packages/domain/src/transitions/sprint-member.ts` — pure functions, one per verb, each taking the sprint text, the plan text, the other sprint files' readings and the date, returning the two new texts or a named refusal. No port import.
- `packages/board/src/server/entry/sprint-member.ts` — the entry that reads/writes through `PlanStore`, builds to `skills/plot/scripts/board/plot-sprint-member.mjs` via `packages/board/build.mjs` and `packages/board/src/contract/bundles.generated.ts`.
- A row in `skills/plot/scripts/README.md` for the new bundle.
- `skills/plot-sprint/SKILL.md`: step 6 (creation), the Scope Change flow, the close flow's "Move incomplete must-haves to Deferred", and carry-over all call the writer in place of their current hand-edit prose; update its Model Guidance table.
- Comment updates (wording only, matching the plan's § 103): `packages/board/src/contract/schema.ts:2620-2625`, `packages/board/src/app/lib/filters.ts:124-130`, `packages/domain/src/entities/plan.ts:212`, and `skills/plot/scripts/plot-reconcile-scan.sh:1688-1690`.
- A changeset bumping `plot-sprint` (description first, `bumps:` block last).

### Decisions already settled — do not re-derive them

**The membership-reading function is `unstruckSprintMembers`, not `sprintMembers`.** The plan's Approach section (§64-69) and Done-when table name `sprintMembers` throughout, but PR #3002 landed it as `unstruckSprintMembers` (`packages/domain/src/rules/sprint-membership.ts:44`) — the name states what it excludes, which the plan's own design explains ("subtracts `struckSlugs`... so an item left in the sprint by that strikethrough is not also counted"). Use `unstruckSprintMembers`; it is the only membership reader that exists. `sprintOfPlan`, `sprintsListing`, and `memberLineIndex` landed exactly as the plan names them.

**`memberLineIndex` exists but has zero callers today.** It is exported from `sprint-membership.ts:125` and used only by its own test. The merged `annotateSprintItem` (`packages/domain/src/rules/sprint-annotation.ts`) and `tickSprintItem` (`packages/domain/src/rules/sprint-tick.ts`) still find their line by a literal `[slug]` substring search across the *whole file* — not scoped through `memberLineIndex`, and not restricted to a Must/Should/Could tier. (`tickSprintItem`'s own doc comment calls this out explicitly: "Finds the line BY CONTENT... never by line number or position.") This writer slice is the first caller of `memberLineIndex`, and it is this slice's job to scope `add`/`defer`/`remove`'s edits to the line `memberLineIndex` answers, per the plan's own text (§90, §97 analogue) — do not assume the existing annotation/tick helpers already demonstrate the pattern; they predate this rule and were not revisited when it landed.

**`sprintsListing` has no caller yet either.** Landed in #3002 with a doc comment saying so explicitly: "Not consumed by this slice's callers yet: the writer and gate slices use it." This slice is where it first gets used, for `remove`'s "does another open sprint still list the plan" check and for the `listed-elsewhere` refusal's message naming that other sprint.

**No partial write, enforced by order, not a transaction.** The plan requires: compute both new texts first, write the plan file, then the sprint file; on the second write's failure, restore the plan file from the text originally read and refuse. `approve.ts`'s own `stageApproval`/write pattern (nearby, `approve.ts:770-780`) is the precedent for staging exactly the changed paths — reuse `ctx.trees.stage` with explicit paths, never the sprint directory, so an unrelated staged file or sprint edit stays out of the commit.

**The pathspec commit, not `git add -A`.** `git commit -m <subject> -- <plan> <sprint>` through the same tree adapters `approve.ts`'s `stageApproval` uses. `--no-commit` stages the two paths without committing — `/plot-sprint` creation needs this to batch several plans into one skeleton commit (plan §82, §84).

**The field-write scope is the first `## Status` block only**, and it must refuse (not silently skip) a value that is any other HTML comment, naming the plan — four plans in the current estate hold a record like `<!-- not a member; the sprint closed 2026-08-26 -->` and overwriting that silently would lose the record. An empty value, the bare `<!-- optional -->`, and the template's longer placeholder comment are all legitimate "unset" states that `add` may overwrite freely.

**Rules about what counts as logged, from `sprint-tick.ts`'s existing invariant** ("THE TICK ONLY... nothing else on the line is touched"): the Scope Changes log line is written only in a Committed or Active sprint — a Planning sprint has no commitment yet and gets no log line for any verb, including `add`.

### Done when

The plan's `## Done when` table rows tagged "Writer" are the specification (lines 161–175 of the plan file). Pull out these because a naive implementation passes without them:
- The re-run-is-a-no-op row: a second identical `add` must exit 0 and change nothing — this catches an implementation that recomputes a `Scope Changes` line unconditionally instead of checking whether the member line already sits in the target tier.
- The "other staged paths stay out" row: verify via `git show --stat HEAD` listing exactly two files, not via trusting the staging call to have been scoped correctly.
- The six field-form row (no line / empty / two placeholder-comment variants / already-set / other-comment) — each of the first five must converge to the same field value; the sixth must refuse `field-record` by name.

Plus: the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — the tests naming a changed file, related tests and typecheck for `packages/domain` and `packages/board`, and the gate tests/`scripts/check-*.sh`. The suites in the `CI suites` config key run in CI only; do not run `test:e2e` locally. Add a changeset (description first, `bumps:` block last — `./scripts/check-changeset-packages.sh` refuses the reverse order). A PR carries no generated bundle (`scripts/check-no-bundle-diff.sh`).

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows past its merge base. This slice adds no shell launcher (the bundle is called with `node` directly, per the plan's own note at §73: "there is no shell launcher"), so the ratchet should not move — if a change to this slice does touch a `.sh` file, that growth must be paid for by removing shell elsewhere in the same change.

### Bookkeeping

Open the PR through the controller once the branch exists and carries a commit:
```
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```
Never `gh pr create` directly. Push the first real commit as soon as it exists, so the PR can be opened early.

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section (the Writer heading, line 133).

### Scope guard

This branch owns: `packages/domain/src/transitions/sprint-member.ts` and its test, `packages/board/src/server/entry/sprint-member.ts` and its test, the bundle wiring (`packages/board/build.mjs`, `packages/board/src/contract/bundles.generated.ts`), the `skills/plot/scripts/README.md` row, `skills/plot-sprint/SKILL.md`'s writer-calling edits, the four comment-wording updates, and the changeset.

It does **not** touch `packages/domain/src/rules/sprint-member-gate.ts` (Gate slice, waits on this one), `packages/board/src/server/entry/gate.ts`'s `GATES` row (also Gate slice), or `docs/sprints/2026-W44-delivery-loop.md` (Repair slice, waits on this one and on the merged Approve/deliver slice). Both downstream slices are blocked on this branch merging — keep the diff to exactly what's listed above so they can start.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
