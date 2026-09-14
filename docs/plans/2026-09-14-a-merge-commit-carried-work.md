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
     controller. No plan-format, template or layout change. CI changes: the
     `validate` job gains `fetch-depth: 0`. -->

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

**THE COUNTS ARE A DATED SNAPSHOT AND THE SHAS ARE NOT.** That window has
already moved — `851727039` fell out of the last 120 during the session that
wrote this plan — so a later reader re-measuring will get different totals and
should. What does not move is the evidence the fix rests on: every sha above is
pinned, and each still reads exactly as tabulated. The fixtures depend on the
commits, never on the window.

**THE FIX IS ONE FLAG**, and its blast radius is measured rather than argued:
`git show --name-only --format= -m --first-parent <sha>`. `-m` makes git diff a
merge against its parents at all; `--first-parent` keeps it to the one diff that
means *what main gained*.

**THE PAIR IS INSEPARABLE, AND `-m` ALONE IS WRONG RATHER THAN MERELY NOISIER.**
Measured on `109cce0ac`: `-m` without `--first-parent` returns **6 paths, not
5**. It emits one diff per parent, and the extra path is
`docs/plans/2026-09-13-a-claimed-slice-does-not-say-nobody-took-it.md` — a file
main gained from the OTHER parent, which the slice never touched. On a merge
where both parents changed one file the same path would also appear twice. A
later reader simplifying the call by dropping one flag re-breaks the reading in
a new direction, so the measurement is recorded here rather than left to be
rediscovered.

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

**THE ESTATE WILL HOLD TWO READINGS OF THIS QUESTION, AND THAT IS DECLARED
RATHER THAN ACCIDENTAL.** `plot-reconcile-scan.sh`'s section 22 asks whether a
merge shipped code and reads `git merge-base "$m^1" "$m^2"`; this adapter asks
whether a slice carried implementation and reads `-m --first-parent`. They are
not two implementations of one rule — they answer different questions:

| | reads | answers |
|---|---|---|
| scan §22 | `merge-base ^1 ^2` | did the BRANCH ship code while it was open? |
| adapter | `-m --first-parent` | what did MAIN gain when it landed? |

**Measured over the same window: they agree on 13 of 14 true merges.** The one
disagreement is `851727039`, a delivery booking commit, where merge-base reports
2 plan files and first-parent reports 0 — main already held those edits by the
time it landed. Each reading is right for its own question, so **agreement is
not the contract and no corpus test is added**; a test asserting they match
would encode a rule neither side claims and would fail on the one commit both
sides handle correctly. The pair is recorded in `CLAUDE.md` beside the existing
*One Answer To "Did This Land"* rule so the next reader finds the distinction
before re-deriving it. Booking merges are rare — 1 in the last 300 — which is
why the divergence went unnoticed and why declaring it beats gating it.

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

**AND THAT SKIP IS WHY THE TABLE ASSERTS NOTHING IN CI TODAY.** The domain suite
runs at `ci.yml:836`, inside the `validate` job, which checks out at the default
depth. Measured 2026-09-14 in a `--depth 1` clone of this repo: all three
existing fixture shas are ABSENT, `if (!isAnswered(present)) return` takes the
early exit, and the file reports **31 passed** — the identical result it reports
locally with full history. CI cannot tell a working reading from a broken one,
so the three rows are decoration and a fourth would join them.

**SO THE LOCK NEEDS ONE LINE OF CI, AND IT REPAIRS MORE THAN THIS PLAN ADDS.**
`fetch-depth: 0` on the `validate` job's checkout makes the three existing rows
assert for the first time as well as the new one. The `corpus` job already sets
it (`ci.yml:61`), so the cost is one this repository has been paying per run
since that job existed — 4065 commits, 146 MB of history.

**THE FOURTH ROW IS DISCRIMINATING ONCE HISTORY IS THERE**, which is the other
half of the same argument: `900285499` reads **0** files under the current
spelling and **3** under the fixed one, so the row fails before the fix and
passes after it. A lock that passes either way is what this plan is fixing.

## Slices

### A merge commit carried work (Branch: bug/a-merge-commit-carried-work)

- `bug/a-merge-commit-carried-work` — add `-m --first-parent` to `commitFiles` in `packages/domain/src/adapters/refs/refs-git.ts`, amend its comment to state the merge-commit case rather than only the squash one, add the two-parent row to the `it.each` table in `packages/domain/test/ports-real-state.test.ts`, set `fetch-depth: 0` on the `validate` job's checkout in `.github/workflows/ci.yml` so that table asserts at all, and record the two readings in `CLAUDE.md`

**Done when** `commitFiles` reports 5 files for `109cce0ac` and 3 for
`900285499`; the three existing fixture rows are unchanged; the new row FAILS
against the unfixed adapter and passes against the fixed one, checked by
reverting the flag once; the `validate` job checks out with `fetch-depth: 0`, so
a `--depth 1` clone no longer reports 31 passed for a table that asserted
nothing; `/plot-deliver` on a plan whose PR landed as a merge commit prints no
*carried no implementation* note; `851727039` still reads empty, so the one true
finding in the measured window survives; `CLAUDE.md` names both readings and the
question each answers; and `pnpm run test:contracts` and the domain suite pass.

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

**NOTHING REFUSES ON `carriedWork`, so a wrong fix is cheap in both
directions.** It feeds `emptySlices` alone, which feeds a printed note; no
delivery is blocked either way. Over-reporting loses a finding worth about 1 in
300 merges, under-reporting restores today's false positive, and the rollback is
reverting one flag. That is why the slice needs no staged rollout and no feature
gate — the blast radius is a sentence in delivery's output.

**Searched for a counter-example over 400 commits**: the only merge where
first-parent reports fewer files than merge-base is `851727039` itself. No
conflict-resolution merge on this estate is under-reported by the new reading.
