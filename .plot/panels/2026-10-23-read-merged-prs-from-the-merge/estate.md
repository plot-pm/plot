# Juror: estate lens

Subject: `docs/plans/2026-10-23-read-merged-prs-from-the-merge.md` at worktree HEAD `2dc47dcb2`. All evidence below is from reading files at that HEAD with `sed`/`grep`. No test or bundle was run, and no host was asked. "Read" marks a claim checked only by reading code.

## 1. Approach against the code

- **Merge-log walk: already in the estate, and it is not reused.** `plot-fleet-scan.sh:478` runs `git log origin/$MAIN --merges --max-count=2000 --pretty='%H %s'` once per scan, and reports saturation (`:479-483`). The walk is local, but it feeds only the wave gate for refless branches. Nothing writes it to the PR index (read).
- **"Parse with the existing merge-subject rule" is wrong as stated.** `mergedBySubject` (`rules/merge-subject.ts:88`) needs the caller to pass in `branches` and returns only `{sha, branch}`. `<number>` compiles to a non-capturing `\d+` (`:160-163`). The rule cannot list every merged PR, and it never yields a PR number. A reader that produces index rows needs a new extraction rule: given subjects, return (branch, number, sha) tuples. The plan must name that rule as new work (read).
- **"The store already holds merged rows… a merged row is written once and never re-asked": half true.** `pendingOpenPrNumbers` (`rules/pr-index.ts:295`) and `withHeldVerdicts` (`:243`) skip terminal rows. But a `whole` fold starts empty (`rules/pr-index.ts:149-152`), and `PR_FULL_READ_MS` (`pr-refresh.ts:334`) sets one full read every 24 h. Every terminal row is therefore re-listed daily, and any row the host omits is dropped. A subject-derived row survives only if the one writer re-derives it on every fold (read).
- **The Bitbucket store already claims a wholeness it does not have.** The truncation report is a stderr notice only. `pr_list_report_truncation` prints *possibly truncated* and returns (`plot-host.sh:3049`), and `pr-list` exits 0 when every state answered (`plot-host.sh:1437`). `pr-refresh.ts` has no truncation handling (grep: no match outside comments). `answerKind` returns `whole` (`rules/pr-index.ts:90-95`), so `complete: true` is written over at most 3×50 rows. The Motivation's *state unknown* symptom follows from this. The plan does not mention this pre-existing false `complete`, and it is the defect closest to the reported symptom (read; a live store on ewz-kus-portal would confirm it).
- **Step 3 "ask the host only for what can change" partly exists.** On a delta, `bb_window_listing` (`plot-host.sh:1201`) asks `updated_on>=<watermark>` and walks every `next` page. It refuses a window that falls short of `size` (`:1185-1195`) (read).

## 2. Open Questions, as the estate answers them

1. **One index or two.** The estate answers it: one writer only. `foldPrIndex` is called only from `pr-refresh.ts`, and CLAUDE.md says a second writer races. So the merge log must become an input to `refreshPrs`, not a second writer. The schema is `.strict()` (`entities/pr-index.ts:88,148`), so any new field means `PR_INDEX_VERSION` 5→6, and every reader falls back to `ask` until a rewrite. An operator decision is still needed on whether to pay that version bump.
2. **Subject or host.** The estate answers this one in a way that blocks the plan. `isTerminalRow` (`rules/merged-row.ts:17-18`) checks only `state === MERGED && !draft`. `pr-index-lookup-answer.ts:61-70` answers MERGED from any such row, and `/plot-deliver` reads it through `plot-impl-status.sh` (`skills/plot-deliver/SKILL.md:130`). A subject-derived row stored as `state: MERGED` would let a subject start a delivery. `docs/domain/merge-subject.md:59` forbids that (`allSlicesConfirmed` reads subject-only as `unknown`). Either the row carries a source that `isTerminalRow` rejects, or the plan amends *One Answer*. That choice is the operator's.
3. **Source marker.** This is required, not optional (see 2). No field exists today (`entities/pr-index.ts:30-88`). `mergedAt` must stay absent on such rows, because `plot-pr-merged.sh`'s destructive readers key on it.
4. **Overlap with #2400.** #2400 makes the full read follow `next`, which removes the 50-row cut and makes `complete` honest. After #2400 the merge log no longer fixes correctness. It only saves the daily full walk's merged pages. The saving has not been measured, and CLAUDE.md memory says to measure a Plot optimisation before building it. Operator decision: is the plan still worth a slice after #2400?
5. **Overlap with #2386.** #2386 is still undesigned (`one-pr-reader-per-machine-and.md` Open Questions 2-3). The merge log is local git and has no rate limit, so it needs no single reader. Only its delta-discovery half does.
6. **Squash/rebase.** `MERGE_SUBJECT_FORMS` (`merge-subjects.ts:20-23`) already states that a squash merge falls through to the host. The lookup's `ask` path (`pr-index-lookup-answer.ts:18-27`) never says `none`, so this holds if rows come only from matches (read).
7. **Reused branch names.** The age rule does **not** carry over. It asks whether the merge is contained in the commit that added *the plan's* file (`plot-fleet-scan.sh:473-476`, `merge-subject.md`), and the rule is keyed by plan. An index row keyed by PR number has no plan. The number from the subject is the actual disambiguator, but only once the extraction rule from §1 exists. This needs a design answer, not a "confirm".

## 3. Addendum points

| Addendum point | In the plan? | In the estate? |
|---|---|---|
| List and single-PR GET throttled separately | no | not modelled. `PR_REQUESTS_PER_REFRESH` (`pr-refresh.ts:205-250`) has one bucket per backend |
| Seed once with a full paged walk | no (left to #2400) | no. The full read is one page per state (`plot-host.sh:1296`). Only the delta pages |
| Terminal rows written once | yes (step 2) | partly. Verdicts are held, but rows are re-listed every 24 h (§1) |
| Open PRs as a watch list via single-PR GET | **no** | the GET exists: `pr-state <number>` → `bb pr view <n> --json` (`plot-host.sh:3822-3826`). The refresh's re-ask uses the **list** instead (`pr-refresh.ts:1602`, `pr-list --rich --state open`), and only for pending or failing checks |
| Delta `sort=-updated_on`, `q=updated_on > last seen` | no | mostly. `bb_window_listing` uses `updated_on>=` and is paged (`plot-host.sh:1065,1201`). It runs on every timer tick, not only after a fetch brings a new ref |
| Delta asked only when a fetch brought a new branch ref | no | no. That is #2386's proposal 3, which is undesigned |
| Pair with #2386's single reader | named as an OQ only | no |

The plan covers 1 of the 7 addendum points. The addendum's key measurement is that the single-PR GET had quota while the list answered 429. That measurement points at the watch list, which the plan leaves out entirely.

## 4. Consistency with CLAUDE.md

- *One writer*: consistent only if the merge log becomes an input to `pr-refresh.ts`. The slice text ("fold them into the PR index") does not name the writer.
- *Only terminal answers read*: holds.
- *Index never says no*: holds if a subject miss stays `ask`.
- *One Answer To "Did This Land"*: **violated as written.** §2.2 shows that a subject-derived `state: MERGED` reaches `/plot-deliver` through `isTerminalRow`.

## 5. Changes required before approval

1. State that `refreshPrs` is the only writer. The merge log is read inside that function and folded through `foldPrIndex`, and the plan must say how a `whole` fold keeps subject rows.
2. Add a row source field, which means a `PR_INDEX_VERSION` bump. `isTerminalRow`, or the `plot-impl-status` lookup, must answer `ask` for a subject-only row. Otherwise the plan must state that it amends *One Answer*, with `merge-subject.md:55-62` updated.
3. Name the new extraction rule. `mergedBySubject` cannot list PR numbers. Say how OQ7's age rule is replaced, using the number itself rather than plan ancestry.
4. Name the existing false `complete: true` on a truncated Bitbucket full read (`plot-host.sh:3049`, `rules/pr-index.ts:90`). Either fix it here (a truncated page → `partial`) or point to #2400, because it causes the symptom in the Motivation.
5. Add the addendum's watch list: refresh open rows through `pr-state <n>`. That path already exists, and the change replaces the list call at `pr-refresh.ts:1602`. Either add it or state that it is out of scope and name where it goes. Record the separate per-resource throttling.
6. Re-scope against #2400. Measure what the merge log saves once the paged full read ships, before building the slice.

Position: amend
