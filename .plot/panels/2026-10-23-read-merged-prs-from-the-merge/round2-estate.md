# Juror: estate lens, round 2

Subject: `docs/plans/2026-10-23-read-merged-prs-from-the-merge.md` at `6eb7fb922`. Code is cited from the main worktree at `origin/main` `18a3456fe`. "Read" marks a claim checked by reading files with `sed`/`grep`. "Ran" marks a read-only command: `git rev-list` on ewz-kus-portal and `jq` over this checkout's live PR index. No host was asked, no test suite ran.

The lens question: does what each slice builds already exist? Two of three slices touch code that already has a sibling the plan does not name.

## 1. Round-1 findings

| Round-1 item | Status | Plan line |
|---|---|---|
| Agreement 1: a subject-derived MERGED row reaches delivery | Resolved: no subject row enters the index | *Merge-Subject Rows*, first paragraph and bullet 2 |
| Agreement 2: the daily `whole` fold erases rows | Resolved: no rows to erase, and the "written once" claim is withdrawn | *Merge-Subject Rows*, last two paragraphs |
| Agreement 3: the #2385 addendum is mostly uncovered | Scoped out with reasons, one row per point | *Scope* table |
| Three jurors: a truncated Bitbucket listing writes `complete: true` | Taken up as slice 1 | Approach 1, slice `bug/a-short-bitbucket-listing-is-partial` |
| Disagreement 1: cursor or full walk | Resolved: full walk, no field | Approach 2; Open Questions "Incremental cursor" |
| Disagreement 2: does the slice reach the board | Resolved: the board sentence left the Changelog, the July symptom is attributed to HTTP 429 | Motivation, last two paragraphs; Board-impact comment |
| Disagreement 3: where the saving is | Resolved: 0 requests saved, stated | *Cost*, first and last bullet |
| Disagreement 4: local `plot-approve` lookup | Scoped out: an `OPEN` row is not terminal | *Scope*, row "Local plot-approve lookup" |
| Disagreement 5: declined PRs | Scoped out: `CLOSED` stays re-asked | *Scope*, row "Declined PRs" |
| Blind spot 1: the 2000-merge cap | Taken up as slice 2 | Approach 2 |
| Blind spot 2: the `complete: true` evidence came from a stale store | Partly resolved: re-read on code, not measured on a store. See section 5, finding E: the defect is real on this repository's GitHub store too | Notes, revision paragraph |
| Blind spot 3: Bitbucket squash subject | Measured, walk question left open | Notes; Open Points 4 |
| My round-1 item 5.1 (one writer) | Resolved, no new writer | Scope, row "Pairing with #2386" |
| My round-1 item 5.6 (measure after #2400) | Resolved by narrowing: the plan no longer claims a saving | *Cost* |

Every round-1 item is resolved or scoped out with a reason. None is left silently open.

## 2. Approach against the code

All line citations in Approach and Slices hold on `18a3456fe` (read): `plot-host.sh:935` `PR_LIST_PARTIAL_RC=7`, `:1393` `bb_state_listing`, `:1488-1553` `pr_list_states`, `:3250` `pr_list_report_truncation`, `:4488` GitHub `--head`, `:4786` `PR_LIST_BRANCHES`; `plot-fleet-scan.sh:472`; `registryd-main.ts:599`; `scripts-shell.ts:99,111`; `rules/pr-index.ts:90-95,146-154,268-271,394`; `merged-row.ts:17-18,30-33`; `entities/pr-index.ts:12`; `pr-refresh.ts:249,331,1499`; `plot-impl-status.sh:265-277`; `branch-state.ts:238-268`; `merge-subject.md:43,53-62`.

### Slice 1: claims that are false or incomplete

- **"`scripts-shell.ts:111` already maps 7 to partial" is true, and the effect on the board is not stated.** `pr-refresh.ts:1532` takes `partialSaid` and `:1792` writes `entry.prError = partialSaid`. A Bitbucket store with more than 50 PRs in one state then carries a non-null `prError` on every refresh, and `host-notes.ts:228-231` reads a non-null `prError` as a host note. On ewz-kus-portal that is every refresh. The Board-impact comment says only the wave gate changes (read).
- **The fleet queue also changes, and Cost does not count it.** `registryd-main.ts:791` calls `host.prList('merged', 500)`. `host-shell.ts:241-257` answers exit 7 with the rows and sets a refusal, so `registryd-main.ts:806-807` reports `whole: false`. `queue-reading.ts:335-337` then runs `landedWithoutListing`, which spends up to `VIEWS_PER_PASS` per-number lookups per pass (`queue-reading.ts:594-628`). Today a Bitbucket queue never takes that path. Cost says 0 extra requests (read).
- **The survey list misses callers that cannot take exit 7.** The plan names `plot-fleet-scan.sh`, `plot-impl-status.sh`, `plot-reconcile-scan.sh`, `plot-pr-merged.sh` and "the host adapter". The code answers part of the survey already (read):
  - `plot-reconcile-scan.sh:738` wraps the merged listing in `if … out=$(…); then`. Exit 7 takes the else arm and drops all 50 rows, so section 2 reads only the index. This is a regression on Bitbucket.
  - `packages/domain/corpus/listing-page.corpus.test.ts:124` throws on any non-zero exit. That corpus pairs `pagePossiblyTruncated` (`rules/listing-page.ts:52`) with `pr_list_report_truncation`. Every "truncated" case in it would throw.
  - Unnamed shell callers: `plot-board-probe.sh`, `plot-budget.sh`, `plot-open-pr.sh`, `plot-update-board.sh`.
  - Unnamed Host-port callers: `approve.ts:341,400`, `needs-design.ts:181`, `review-bypass.ts:46`, `registryd-main.ts:791`.
  - Callers that do take it: `plot-fleet-scan.sh:785` maps 7 to `partial`; `plot-impl-status.sh:269` pipes through `jq … || true`, so exit 7 keeps its rows; `plot-pr-merged.sh:141` uses `--branch`, a sweep, which never prints a truncation report (`plot-host.sh:1524-1540`).
- **The new exit 7 overloads an existing stderr contract.** Today exit 7 means "some states failed", and `pr_list_states` prints `answered N of M states; missing: …` (`plot-host.sh:1551`). After the slice, every state can answer and the call still exits 7. The slice must name the new line's wording, and say whether `partial` in the scan footer (`plot-fleet-scan.sh:861,1062`) still means "a state failed".
- **The shell line ratchet applies to slice 1 too.** Slice 3 names `scripts/check-shell-lines.sh`. Slice 1 adds shell to `pr_list_states` and does not name the ratchet.

### Slice 2: every place that caps the same walk

The plan names two caps. There are three, and one of the two named has no saturation report (read):

1. `plot-fleet-scan.sh:472` `MERGE_SCAN_LIMIT`. It has a saturation report (`:481-483`, `:5295`).
2. `registryd-main.ts:599` `MERGE_WALK_LIMIT`, used at `:629`. **It has no saturation report.** `subjectProvenOf` caps silently. "The saturation report stays" is true for the scan only.
3. **`packages/domain/corpus/production.ts:286-289` `readMergeSubjects(estate, mainBranch, limit = 2000)`**, whose TSDoc says *"the walk's cap, matching `MERGE_SCAN_LIMIT`"* (`:283`). `branch-state.corpus.test.ts:340,392` calls it with the default. After slice 2, the corpus reads 2000 merges and the scan reads 20 000, so the shell-vs-rule comparison diverges on any estate above 2000 merges. ewz-kus-portal has 2340 (ran: `git rev-list --merges --count origin/develop`). The slice's equality test covers caps 1 and 2 only.

The two other `--merges` walks are different questions and need no change: `plot-reconcile-scan.sh:2849` `CHANGESET_MERGE_WINDOW=40` and `refs-git.ts:755`, which is the adapter behind cap 2 (read).

### Slice 3: the by-name lookup already exists in the delivery gate

- **The deliver controller already asks the host per branch.** `deliverability.ts:148-186` reads the PR index first, then calls `ports.host.prMerged(branch)` for each branch the index cannot answer. `Host.prMerged` (`host-shell.ts:387`) runs `plot-host.sh pr-merged`, whose Bitbucket arm uses `bb_branch_query` with the branch in `q=` (`plot-host.sh:4159-4172`). That query follows `next` since #2573. `plot-deliver.mjs` and `plot-ask.mjs deliverable` (`ask.ts:2,127`) both use `deliverabilityOf`. So the delivery **gate** already finds a Bitbucket PR merged before the newest 50 (read). Slice 3 fixes the `/plot-deliver` skill's step 4 reading only, and the annotation back-fill that reads it (`skills/plot-deliver/SKILL.md:124-150`).
- **The slice falls under *A Shell Script Asks The Domain*.** `plot-impl-status.sh` runs once per operator command, so CLAUDE.md says it should call the domain rather than grow its own per-branch loop. The plan does not argue for the duplicate, and the duplicate gets no corpus pairing.
- **The doc that describes the call is not in the slice.** `skills/plot-deliver/SKILL.md:139` says *"a single bundled `pr-list --state merged` for the whole plan"*. Slice 3 makes that sentence false (read).
- **`pr-list --branch` takes several branches in one call.** `plot-host.sh:4456` accumulates repeated `--branch`, and the Bitbucket arm sweeps them in one process (`bb_branch_sweep`, `:4808-4814`). Only GitHub needs one call per branch, because `--head` applies to exactly one branch (`:4488`). Per-branch calls on both hosts are a choice, and the plan should say so.
- The per-branch query itself, `PR_LIST_BRANCHES` at `:4786`, and the claim that it follows `next` since #2573 hold (read; `plot-host.sh:4170-4171` comments it).

## 3. Each slice against its Changelog line

- **Slice 1, line 1.** It ships something an observer can see: the store file's `complete` flag. The line is accurate but under-describes the change. The same slice makes the board show a host note on every refresh of a large Bitbucket estate, and makes the fleet queue read its merged listing as not whole. Both are visible, and neither is in the Changelog or the Board-impact comment.
- **Slice 2, line 2.** Visible: the scan footer stops printing *merge scan hit its limit* on ewz-kus-portal (2340 merges), and a refless branch merged before the 2000th-newest merge moves to `merged`. The line matches what the slice builds.
- **Slice 3, line 3.** It says *"so `/plot-deliver` finds an older merged PR"*. The deliver controller already finds it (section 2). What changes is the skill's step-4 helper output. The line overclaims and should name `plot-impl-status.sh`'s output only.
- **The ewz-kus-portal symptom.** The narrowed plan no longer claims to fix it. Motivation attributes *state unknown* on the three July plans to HTTP 429 through `branch-state.ts:259-267`, which I confirm (read). The Board-impact comment says that note does not change. The title, *"an old merged PR stops reading as no PR"*, is consistent with slices 2 and 3. Nothing in the plan says where the 429 symptom goes next; *Cost* points at the watch list "on #2385", which is enough.

## 4. Open points

1. **[Scope] Accept the reshaped scope.** Still an operator decision. From the estate lens, the reshape is correct: no index field, no second writer.
2. **[Technical] Can every `pr-list` caller take exit 7?** The code already answers: **no.** `plot-reconcile-scan.sh:738` drops the rows, and `listing-page.corpus.test.ts:124` throws. Section 2 lists who can and who cannot. The open point should record this answer and choose between editing those two callers and the stderr-marker fallback. That choice is technical, not the operator's.
3. **[Domain] Which merged PR for a reused name?** Partly answered by reading: the Bitbucket arm has no merge time and fills `mergedAt` from `.updated_on` (`plot-host.sh` comment above `:4760`; `bitbucket-pr-reading.ts:10`). An `updated_on` stand-in moves when anyone comments on the PR, so it cannot order attempts reliably. The per-plan age rule needs a merge commit, and the slice must measure whether the Bitbucket per-branch row carries one. Still open, and the measurement the plan names is the right one.
4. **[Technical] Drop `--merges`?** An operator decision. The numbers are in the plan.

## 5. New defects

- **A. Slice 3 duplicates the deliver gate's by-name lookup in shell** and does not say so (section 2, slice 3). Either route `plot-impl-status.sh` through the domain, or state why a shell duplicate is right here and pair it.
- **B. Slice 2 misses the third cap**, `corpus/production.ts:286-289`, and the missing saturation report in `registryd-main.ts`.
- **C. Slice 1's survey omits callers that the code shows break**: `plot-reconcile-scan.sh:738` and `listing-page.corpus.test.ts:124`, plus four shell callers and five Host-port callers.
- **D. Slice 1 has two visible effects that Board impact and Cost leave out**: a standing `prError` host note (`pr-refresh.ts:1792`) and the queue's `whole: false` path with up to `VIEWS_PER_PASS` extra lookups per pass (`registryd-main.ts:806`, `queue-reading.ts:335`).
- **E. The same false `complete: true` exists on GitHub, and on this repository.** `PR_LIMIT = 1000` (`pr-refresh.ts:303`). The GitHub arm prints *possibly truncated* when a page reaches the limit and exits 0 (`plot-host.sh:4735-4736`). This checkout's live store reads `complete: true`, 1007 rows, PR numbers 768 to 2709 (ran: `jq` over `.git/.plot/state/index/github.json`). The store is `v: 4`, so it was written by an older build, but the exit-0 path is unchanged on `origin/main` (read). Slice 1 changes only `pr_list_states`, which is Bitbucket-only, and its Changelog says "On Bitbucket". The plan must either extend slice 1 to the GitHub arm or scope GitHub out with a reason.
- **F. `skills/plot-deliver/SKILL.md:139`** becomes false after slice 3, and the slice does not edit it.

## 6. Changes required before approval

1. Slice 3: name the deliver controller's existing per-branch lookup (`deliverability.ts:182`). Narrow Changelog line 3 to the helper's output. Choose: call the domain, or keep a shell duplicate with a stated reason. Add the `SKILL.md:139` edit to the slice.
2. Slice 2: add `corpus/production.ts` `readMergeSubjects` to the raised caps and to the equality test. Say that `registryd-main.ts` has no saturation report, and either add one or drop "the saturation report stays" for that cap.
3. Slice 1: record the survey answer that the code already gives (section 4, point 2). Name the edits to `plot-reconcile-scan.sh:738` and `listing-page.corpus.test.ts`, or take the stderr-marker fallback. Name the new stderr line. Add the shell line ratchet.
4. Board impact and Cost: add the `prError` host note and the queue's `whole: false` path.
5. Decide GitHub: extend slice 1 to the GitHub arm's truncation at `PR_LIMIT`, or scope it out with a reason.

Position: amend
