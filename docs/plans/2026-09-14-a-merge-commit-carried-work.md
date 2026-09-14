# A merge commit carried work

> `commitFiles` reads a merge commit as empty, so delivery reports every true merge as carrying no implementation.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** an-agent-is-declared-and-corrected
- **Story:** plot-gates
- **Review:** in-session
- **Impl:** own branches

## Changelog

- Delivering a plan whose PR landed as a merge commit no longer reports that the PR carried no implementation. The reading asks git for the merge's first-parent diff, which is what the default branch gained.

<!-- Board impact: none. The board consumes neither `commitFiles` nor
     `emptySlices`; both are read by `/plot-deliver` through the deliverability
     controller. No plan-format, template or layout change. -->

## Design

**`git show --name-only` PRINTS NOTHING FOR A MERGE COMMIT.** Git suppresses the
diff for a commit with two parents, because a merge has no single diff to show.
`carriedWorkOf` ends in `files.value.some(path => !isMarker(path))`, and
`.some()` over an empty array is `false` — so a merge that landed real work
reports *carried no implementation*.

**MEASURED 2026-09-13 OVER THE LAST 120 COMMITS ON `origin/main`: 14 true
merges, 14 misread.** Thirteen carried 3–16 files and reported zero:

```
sha        parents  --name-only  -m --first-parent
109cce0ac  2        0            5      ← PR #907, 410 insertions
52ee3d337  2        0            16
5344bd51f  2        0            9
900285499  2        0            3
851727039  2        0            0      ← genuinely empty; a TRUE finding
```

**THE FIX IS ONE FLAG**, and its blast radius is measured rather than argued:
`git show --name-only --format= -m --first-parent <sha>`. `-m` makes git diff a
merge against its parents at all; `--first-parent` keeps it to the one diff that
means *what main gained*.

- **106 of 106 single-parent commits in that window are byte-identical** under
  the new spelling. The flag is a provable no-op on squash merges, which are the
  population the current reading was written for.
- **Both fixtures the original plan validated against are unchanged.**
  `5d7644ec` still reads zero files, `dab631d4` still reads `PLOT-BLOCKED.md`
  alone. The fix is strictly additive.

**THE ASSUMPTION IS STATED IN THE CODE AND IS SIMPLY NARROWER THAN THE
POPULATION.** `refs-git.ts:189` reads *"the default first-parent diff is what a
squash merge needs: its one parent is the default branch before it landed"* —
true, and true for 106 of those 120 commits. Nothing declared it a precondition,
so the 14 true merges fall through silently.

**THE RULE IS CORRECT AND ITS INPUT IS NOT.** `emptySlices`
(`workflows/deliver.ts:113`) filters on `carriedWork === false` and is silent on
`'unknown'` by design. Nothing in the domain changes. This is an adapter defect,
and the fix stays at `refs-git.ts`.

**AN EMPTY FIRST-PARENT DIFF STAYS `false`, NOT `unknown`**, and `851727039` is
why. It is a two-parent merge whose first-parent diff is genuinely empty — a
delivery booking commit, `plot/deliver-one-cap-holds-across-boards`. Its
merge-base diff reports two plan files while `--first-parent` reports none,
because main already held those edits by the time it landed. The two readings
answer different questions and both are right; for *did this slice carry
implementation*, what main GAINED is the one that matters. So the check keeps
reporting it, and the one true finding in the window survives the fix.

**THE BLIND SPOT WAS THE CORPUS, NOT THE REASONING.**
[`a-merged-pr-carried-work`](2026-09-08-a-merged-pr-carried-work.md) validated
against `5d7644ec` and `dab631d4`, both squash merges, and added a third,
`682349a6`, also single-parent. Every fixture shared the merge style whose
behaviour was under test. A fourth row is the regression lock, and it goes in
the table that already exists rather than in a new file:
`packages/domain/test/ports-real-state.test.ts:192`.

**THE FIXTURE IS `900285499`** — three files, no generated artifact, no
changeset churn — and its comment names the property under test, because four
shas with no stated reason for the fourth is a row a later reader deletes as
redundant. `109cce0ac` is named in the plan as the discovery case and is not a
fixture: it carries `board-server.mjs`, a generated artifact under `-merge`.

**THE REAL-GIT TEST SKIPS WHERE THE COMMIT IS ABSENT**, the convention the three
rows above it already follow — a shallow clone or a fork has none of these shas,
and a test that failed there would assert which checkout it ran in.

## Slices

### A merge commit carried work (Branch: bug/a-merge-commit-carried-work)

- `bug/a-merge-commit-carried-work` — add `-m --first-parent` to `commitFiles` in `packages/domain/src/adapters/refs/refs-git.ts`, amend its comment to state the merge-commit case rather than only the squash one, and add the two-parent row to the `it.each` table in `packages/domain/test/ports-real-state.test.ts`

**Done when** `commitFiles` reports 5 files for `109cce0ac` and 3 for
`900285499`; the three existing fixture rows are unchanged; `/plot-deliver` on a
plan whose PR landed as a merge commit prints no *carried no implementation*
note; `851727039` still reads empty, so the one true finding in the measured
window survives; and `pnpm run test:contracts` and the domain suite pass.

## Notes

**Found while delivering `a-claimed-slice-does-not-say-nobody-took-it`**
(2026-09-13). The delivery printed *"this plan's merged PR carried no
implementation"* for PR #907, which carried 410 insertions across 5 files. The
note reports and never refuses, so the delivery completed correctly and the
plan is `Delivered` — the defect costs a reader's trust in the finding rather
than a blocked delivery.

**That wording is what makes this a bug and not an outage.** `a-merged-pr-carried-work`
chose a question over a verdict because seven of sixty merged PRs carried no
work and only two were the defect. The same choice contains this one: a gate
refusing on `carriedWork === false` would have blocked 13 correct deliveries in
the measured window.

**The check still earns its place.** `851727039` is a real finding the current
reading also catches, and the fix keeps it.
