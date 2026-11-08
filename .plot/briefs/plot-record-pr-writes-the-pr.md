## Implementation brief — plot-record-pr-writes-the-pr

- **Plan (canonical):** `docs/plans/2026-11-07-plot-record-pr-writes-the-pr.md` on main
- **Approved:** 2026-11-07, Jan Wloka, plan-PR #3226 merged
- **Branch:** `bug/plot-record-pr-writes-the-pr` (base: `main`)
- **Ends as:** one PR to `main`, opened with `../plot/scripts/plot-open-pr.sh`
- **Review of the code:** `Auto-review: true` — the review app reviews the PR; a HIGH finding gets a fix agent.

One slice, one wave. Nothing waits on it and it waits on nothing. Issue #3225.

### What to build

`annotateSlicePr` (`packages/domain/src/rules/slice-pr-annotation.ts`) finds its line with `lines.findIndex(bullet.test)` over the whole file. Its doc comment says "under `## Slices` or `## Branches`" and the code tests no section. Measured 2026-11-07 on `docs/plans/2026-11-03-open-plot-review-findings-from-the.md`: line 102, under `## Design` › `### Ordering`, begins `` - `bug/a-high-gets-its-own-fixer-attempts` `` and took `→ #3169` (commit `978de4c77`). The slice line, 115 under `## Slices`, stayed bare. Two effects: `plot-deliver --release 2.31.0 open-plot-review-findings-from-the` refuses with "names no '→ #N' annotation", and a re-run of the recorder refuses `already-annotated` because the duplicate check reads line 102. The controller cannot repair its own record.

The fix: the recorder selects its line the way `branchClaims` (`rules/cross-repo-reference.ts`) does — inside `## Slices` or `## Branches`, outside code fences — and the duplicate check reads only that line. Extract the section and fence walk (`SECTION`, `FENCE`, the `inSection`/`inFence` toggles) into one exported helper in `cross-repo-reference.ts` and have both `branchClaims` and `annotateSlicePr` call it. Two copies of that walk is how the defect arose.

The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

**A branch claimed on more than one line inside the section is refused, never resolved.** The recorder refuses, names every line that claims the branch, and writes nothing. It never takes the first line. Taking the first line is the exact defect being fixed, one section narrower. Settled by jwloka, 2026-11-07. This needs a new refusal in `SlicePrAnnotationRefusal` (for example `branch-claimed-twice`) that carries the line numbers, and `packages/board/src/server/entry/record-pr.ts:80-83` maps refusals to messages, so it needs the new arm too. Read that mapping before choosing the result's shape.

**The bullet match stays anchored to the backticked branch** (`^\s*-\s*\`<branch>\``). Do not widen it to `LIST_CLAIM`'s prefix rule: `branchClaims` needs a prefix filter because it enumerates unknown tokens, the recorder is handed a branch by name. `branchClaims` allows top-level `- ` only and the recorder's regex allows leading whitespace; decide which one the shared helper keeps, and say in the PR what changes for an indented bullet.

**Not `branchClaims` itself.** It answers *which branches does the plan claim*; the recorder needs *which line*. The helper shares the walk, not the answer.

**Absent is not false.** A branch with no bullet inside the section answers `branch-unaddressed`, as it does today for a branch no bullet names — including a file with no `## Slices` heading at all.

**The stray `→ #3169` on line 102 stays.** The recorder edits only the slice line. The repair is operational and not part of this slice: after merge, `plot-record-pr.sh bug/a-high-gets-its-own-fixer-attempts 3169`, then book the plan with the 2.32.0 release (sprint `card-alignment`). Do not hand-edit that plan.

### Done when

The plan's slice line is the specification: `annotateSlicePr` restricted to the claim line inside `## Slices`, section and fence rules shared with `branchClaims`, the corpus comparison, the 2026-11-03 fixture. Assertions that exist because a naive implementation passes without them:

- **Fixture with a prose line before the slice line.** A plan with `- \`bug/x\` … → #1` under `## Design` and the bare slice line under `## Slices`. A section-less implementation annotates the prose line or refuses `already-annotated`; this one annotates the slice line and leaves the prose line byte-identical.
- **A `→ #N` on the prose line does not refuse.** Without it the duplicate check could still read the wrong line.
- **A branch on two slice lines refuses and writes nothing**, and the refusal names both line numbers. Assert the content is unchanged, not only the outcome.
- **A claim inside a code fence is no candidate.** Mutation-test it: remove the fence rule and the test must fail.
- **Existing tests.** `packages/domain/test/slice-pr-annotation.test.ts` has cases with bare bullets and no `## Slices` heading (the second and third). They pass today because the match is file-wide; after the fix they fail by design. Give them a `## Slices` heading; do not weaken the rule to keep them green.
- **The corpus comparison** under `packages/domain/corpus/` (model it on `branch-claims.corpus.test.ts`, using `compare.ts`, `production.ts` and `describingAs`): run `branchClaims` and `annotateSlicePr` over every plan in `docs/plans/` and fail when a branch `branchClaims` reports has its annotation recorded on another line. A disagreement names both answers and the subject, in the form `<slug> :: <field> :: rule="…" shell="…"` per `docs/shell-and-domain.md`. **On a disagreement the branch stops** — adjusting either side to make the comparison pass is the one move forbidden. A plan that carries a double claim today is a finding to report, not an entry to hide in a known-divergence list.

Plus: `plot-record-pr.mjs` is a shipped bundle under `skills/plot/scripts/board/`. Do not commit a rebuilt bundle — `scripts/check-no-bundle-diff.sh` refuses it and `main` builds its own. A changeset is required: package `plot`, description first, `bumps:` block last, `plan: docs/plans/2026-11-07-plot-record-pr-writes-the-pr.md` inside the comment; no skill changes, so `bumps:` may be omitted. Run `./scripts/check-changeset-packages.sh`.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `test:e2e`.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file; if `plot-record-pr.sh` needs a change, pay for the growth in the same change.

Domain code is arrow functions (`export const f = (…) => …`), with factual TSDoc: what it does, parameters, return, failure. The reasoning goes in the commit message, not in the comment. That includes the measurement above, which belongs in the commit so `git log -S` finds it.

### Bookkeeping

When the PR opens, append `→ #<number>` to this branch's line in the plan's `## Slices` section — through the fixed recorder once it merges, or by `plot-record-pr.sh` before. Push the first real commit as soon as it exists. Open the PR with `../plot/scripts/plot-open-pr.sh`, not `gh pr create`.

### Scope guard

This branch owns:

- `packages/domain/src/rules/slice-pr-annotation.ts` and `packages/domain/src/rules/cross-repo-reference.ts`
- `packages/domain/test/slice-pr-annotation.test.ts` (and the `cross-repo-reference` tests if the helper needs its own)
- `packages/domain/corpus/` — one new corpus file
- `packages/board/src/server/entry/record-pr.ts` and `packages/board/test/unit/record-pr.test.ts`, for the new refusal's message only
- one file under `.changeset/`

Not this branch's: `docs/plans/2026-11-03-open-plot-review-findings-from-the.md`, `HEADING_CLAIM` and the `(Branch: \`infra/x\`)` divergence declared in `branch-claims.corpus.test.ts`, and any other recorder behaviour. Only one slice of this plan exists; no other branch of it is in flight. If you find something the plan did not anticipate, report it rather than improvising outside scope.
