## Implementation brief — sprint-to-release-drift-lists-should (wave 1: Count all tiers)

- **Plan (canonical):** `docs/plans/2026-10-21-sprint-to-release-drift-lists-should.md` on `main`
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2286 merged
- **Branch:** `bug/sprint-to-release-drift-lists-should` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is the plan's only wave. Nothing waits on it and it waits on nothing.

### What to build

`plot-sprint-release-gate.sh kafka-gp-sync` on ewz-kus-portal lists 19 keys in `missingFromSprint`, and 6 of them are sprint items: EWZKUS-3863, 3864 and 3867 under Should Have, EWZKUS-3865, 3866 and 3868 under Could Have. `sprintReleaseDrift` (`packages/domain/src/rules/sprint-release.ts`) builds `namedKeys` from the Must Haves alone, and `mustHavesFrom` (`packages/board/src/server/entry/sprint-release-gate.ts:136`) reads `block.must` only. Your fix is right when those six keys leave `missingFromSprint` and nothing else about the verdict moves.

The Release-to-sprint direction counts the resolved key of every item in `must`, `should` and `could`. The sprint-to-Release direction (`missingFromRelease`) and `notCompared` stay Must Have only. The gate entry reads `should` and `could` from the report and resolves each key with `resolveItemKey`, exactly as it does for `must`. Update the TSDoc in `sprint-release.ts` and the `board/plot-sprint-release-gate.mjs` row in `skills/plot/scripts/README.md` (it says "a Release issue no sprint item names" and the code contradicted it). The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The collector needs no change.** Open question 1 is answered: `plot-sprint-release.sh` runs one `emit_tier` for each of `must`, `should` and `could` (`:321-323`), and each item carries `text`, `issues` and `ticket` (`:266`, `:270`). Its own comment at `:256` says a Should or Could row carries the array already. Do not touch `plot-sprint-release.sh`; the shell-lines gate would charge you for it and nothing needs it.

**Tier scope differs per direction, on purpose.** A Should or Could item absent from the Release is not drift: only Must Haves must ship in the Release. So `missingFromRelease` must not read the extra tier. Folding all three tiers into one list is the obvious shape and it is wrong, because it would report an absent Could item as `missingFromRelease`.

**`notCompared` stays Must Have only.** A keyless Should or Could item is not listed there. Open question 2 resolves this way because `notCompared` means "a Must Have we could not compare", and a Should or Could item is never compared in the Release direction. If you find a reason to widen it, report it; do not widen it in this branch.

**No other consumer reads `missingFromSprint` as code.** Open question 3, measured: `grep missingFromSprint packages/*/src` returns only `sprint-release-gate.ts` and `sprint-release.ts`. The board renders nothing from it. The prose consumers are `skills/plot-sprint/SKILL.md:845` and `skills/plot-release/SKILL.md:198`, and both print "carries <n> issue(s) this sprint does not list", which becomes true. Change their wording only if it still says Must Have for that line.

**The shape of the domain signature is yours to choose** (the plan says "likely"): a second list of the other tiers' items, or one list carrying a `tier`. Pick the one that leaves `missingFromRelease` impossible to widen by accident, and keep `SprintReleaseDrift`'s three fields unchanged so the gate's `SprintVerdict` and the SKILL tables do not move.

Rules carried over, unchanged:

- `packages/domain/**` is arrow functions and factual TSDoc. State what each direction counts; no decision history in comments — that goes in the commit message.
- A key of `''` names no issue and never enters the named-key set.
- Absent is not false: a missing `should` or `could` in the report means an empty tier, as `must` already does at `:139`. A present value that is not a list throws, as `must` does.
- `delivered` states such as `withdrawn` are not read by this rule. Do not filter on them here.

### Done when

The plan's `## Done when` list is the specification (the plan carries its tests under Design › Approach). The assertions that exist because a naive implementation would pass without them:

- A domain test where a Should item **and** a Could item are each the only name for a Release key. It catches an implementation that adds only one extra tier.
- A domain test where a Should item is absent from the Release and `missingFromRelease` stays empty. It catches the all-tiers-in-one-list shape.
- A gate-entry test over a report carrying all three tiers with the Release keys named only by `should` and `could`, asserting the whole verdict. It catches a gate that passes the domain test but never reads the new tiers.
- A gate-entry test where `should` is present and not a list, expecting the same refusal `must` gets.

Run each new test against the unfixed source first and see it fail; a test that passes before the fix proves nothing.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run the full suites locally. `skills/plot/scripts/board/plot-sprint-release-gate.mjs` is generated: do not commit a rebuild (`scripts/check-no-bundle-diff.sh`). Add a changeset for package `plot` (patch), description first and the `bumps:` block last. `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows; this slice should touch no `.sh` file.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to the branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/sprint-release.ts`, its test `packages/domain/test/sprint-release.test.ts`, `packages/board/src/server/entry/sprint-release-gate.ts`, its test `packages/board/test/unit/sprint-release-gate.test.ts`, the one README row, the changeset, and at most the two SKILL lines named above. The delivered plan `sprint-release-comparison-drops-must-haves` (#2248) touched the same files and is merged; no other branch in flight holds them (no remote branch for this slug exists at dispatch).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
