# Estate juror — the-fleet-scan-re-reads-all (#2721)

Lens: maintainer of `plot-fleet-scan.sh` and the code around it. Code read at `origin/main` `c1d02f4fa` in `p2721-main`. Plan read at `8b7d08131`.

Position: amend

## Summary

The cost is real and the cited lines are right. The one slice, as written, fires on no idle scan of a live estate, and its natural implementation is either a cost regression (per-branch `pr-state`) or a safety defect (a completeness claim derived from the index re-opens merged work for dispatch). #2716 already measured and dropped this exact shape ("skip only when every branch has a MERGED row", the #1022 precedent) for its own merged listing. The plan must pick a design that keeps `.list-complete` earned by a whole host answer, and must name the gates and the cost model it changes.

## 1. The problem

- **The call exists as cited.** `plot-fleet-scan.sh:1063` runs `plot-host.sh pr-list --state all --limit "$PR_LIST_LIMIT"` with the tracked branches; `:1047` runs the `--state open --rich` call first; `PR_LIST_LIMIT` defaults to 3000 (`:691`). *Read.*
- **The rate is not measurable from the record.** Every line of `~/.plot/state/budget.tsv` I sampled has 10 fields and ends `- - - unknown`: no operation, no pages (#2717). The "about 25 scans per hour" rests on the `ps` sample in `graphql-2715.md`, and the 18 pages rest on a `totalCount` I did not re-run. *Read and ran (`awk` over the last 2,000 lines).*
- **The cadence model under-counts the call.** `scanListingCost` (`packages/fleet/src/shared/fleet-scan.ts:113-117`) answers `1` request for any non-Bitbucket backend. `listingSpend` stretches the listing interval by that cost. A GitHub listing is 1 open page plus about 18 `all` pages, so the cadence stretches for 1 request while the scan spends about 19. The plan does not mention this. Any change to the listing's cost must update `scanListingCost`, or the cadence keeps lying in one direction or the other. *Read.*
- **What the `all` payload is used for, field by field** (`:1088-1275`). *Read.*
  1. `state` + `head` of every non-OPEN PR (MERGED, CLOSED). OPEN rows are dropped (`:1089`, the `grep -v '"state":"OPEN"'`); the open call supplies those with `checks`/`draft`.
  2. The row count `_pr_rows` (`:1087`), the fallback evidence for `.list-complete` (`:1271-1273`).
  3. The adapter's stderr sentence (`pr-list state=… page complete` or `sweep complete`), the primary evidence for `.list-complete` (`:1263-1270`).
  4. Its verdict (`_v_all`) folds into `HOST_VERDICT` (`:1065-1069`), which becomes every reading's `hostReach`.
  5. Indirectly, `.list-arrived` (`:1179`) and `report_listing` (`:1276`), which feed fleetd's carried listing (`PLOT_PR_LISTING`, `fleet-scan.ts:415`).
- **The consumers of those fields.** `host_pr_state` (`:1316`) answers from the per-branch cache file. Without `--ask` (`:2146` `worker_of`, `:4128` branch readings) a cache miss reads `NONE` when `.list-arrived` exists. With `--ask` (`:1524` `merged_by_host`, `:4471` `waits:` prerequisites) a miss reads `NONE` when `.list-complete` exists, and costs one `pr-state` otherwise. *Read.*

## 2. The approach against the code

- **Cited facts that hold.** `:1063` and `:1047` (read). `plot-pr-index-lookup.mjs` answers MERGED non-draft rows only and `ask` otherwise (`pr-index-lookup-answer.ts:72-74`, `merged-row.ts:17-18`) (read). The two shell consumers are `plot-impl-status.sh:195` and `plot-reconcile-scan.sh:714` (read). The scan does not read the index today (grep, ran).
- **Which uses the index can serve under the existing rule.** Only use 1, and only its MERGED half. CLOSED is not terminal for the index (`isTerminalRow`). Uses 2 and 3 (completeness) can never come from the index: "the index never says no", and a `complete: true` store is complete for its own window, not for the repository. *Read.*
- **The index does not hold the repository.** The live store has 1,003 rows (974 MERGED, 25 CLOSED, 4 OPEN), `complete: true`, against the plan's 1,767 PRs. `PR_LIMIT` is 1000 (`pr-refresh.ts:303`). *Ran (node over `.git/.plot/state/index/github.json`) and read.*
- **The index is unreadable today.** The live store is `v: 4`; `PR_INDEX_VERSION` is 5 (`entities/pr-index.ts:12`) and `decodePrIndex` requires `z.literal(PR_INDEX_VERSION)` (`:123`). So every lookup answers `ask` until fleetd restarts on current code. #2716 states this in its acceptance; this plan does not. *Ran and read.*
- **The slice's trigger almost never holds.** Of the 11 remote refs on this machine, 1 has only a MERGED row; 3 have no row, 3 only CLOSED, 3 OPEN/draft, 1 mixed. *Ran.* #2716 measured that 28 of 35 non-deferred branches of active plans have no MERGED row. Unstarted plan-named branches (the scan walks `active/`, `:317`) answer `NONE`, and only a whole host listing can say that. So "an idle scan over a fully merged store" is a fixture state, not an estate state. #2716's Notes record dropping exactly this precedent for the tick's merged listing because it "would skip on no tick while any Approved work is unmerged".
- **"Asks the host about the rest" has two readings, and both fail.**
  - Per-branch `pr-state` for every branch without a MERGED row: up to ~28 calls per scan (one per active-plan branch the index lacks; the run cache does not span scans, and `terminal_learn` keeps only MERGED/CLOSED, `:1474`) against ~19 requests now. That is the N+1 that #216/#232 removed (`:1322-1338`). *Inferred from the counts above.*
  - Keep a cheaper second listing. On GitHub `--branch` is ignored unless exactly one is given (`plot-host.sh` pr-list arm, `head_args` at about `:4488`), so "limited to the branches the index lacks" is per-branch on GitHub. *Read.*
- **The shape that works already exists twice.** `pr-list` takes `--since` on both hosts (`plot-host.sh:4438-4486`), and fleetd already carries the previous listing to the scan (`PLOT_PR_LISTING`, `:885`, `fleet-scan.ts:415`). A carried whole listing plus `pr-list --state all --since <host stamp − overlap>` is still a whole listing, so it can keep earning `.list-complete`. That is #2716's store-plus-delta shape applied to the carried listing, not to the index. It needs the "A CARRIED LISTING IS A FULL ANSWER" comment (`:879-884`) and the fleetd merge in `scanOnce` changed, and zero new shell if the merge lives in `fleet-scan.ts`.
- **Against #2716.** No code conflict: #2716 changes `registryd-main.ts` `mergedBranches`, this plan changes the scan. Both, and #2386, edit CLAUDE.md *A Decision Reads The Index*. #2716's paragraph ends "another consumer needs its own paragraph here". A MERGED-only read needs none (the #1022 precedent); a delta read does. The plan's fourth open question can be answered now: separate code, one shared CLAUDE.md section, rebase the text onto whichever lands first.

## 3. Safety

- **The dangerous path is a completeness claim without the `all` call.** `ownState` (`packages/domain/src/rules/branch-state.ts:238-273`): a no-ref branch with no merge subject, `pr` `none` and `hostReach` `ok` answers `open`, and `--next` hands `open` out. A squash merge leaves no `Merge pull request` subject. So if a slice writes `.list-complete` from the open call plus index rows, every merged branch whose row is missing (outside the 1,000-row window, or any branch while the store is `v: 4`) reads `open` and is dispatched again. The same flag turns `none`/`CLOSED` into `open` for a ref behind main (`:333`). *Read.*
- **`.list-arrived` without the `all` call is the softer variant.** A ref-held branch with a CLOSED PR or an un-indexed MERGED PR reads `NONE` at `:4128`. `ownState` moves only toward `merged` on MERGED, so that loses a `merged` (holds work) rather than inventing one; `worker_of` (`:2146`) loses `pr` for a MERGED branch and can show `stalled`. Not destructive, but wrong. *Read.*
- **Branch-name reuse is not new.** The current `all` payload already carries an old MERGED row for a reused name; `ownState` checks the ref first (`:227-237`). An index row behaves the same. *Read.*
- **The plan must say it:** without a whole host listing in this run (fetched or carried), the scan writes neither `.list-complete` nor `.list-arrived`, and the index only adds MERGED answers to the cache. It names none of the three markers today.

## 4. Slices against Changelog and acceptance

- The Changelog says an idle scan "no longer lists every merged PR". The slice's test proves it only for a fully merged store, which the estate does not reach (section 2). On today's estate the change ships no observable saving.
- No before/after figure is measurable with the record as it is: the record carries no operation and no page count (#2717). The acceptance needs a `ps` sample shape like #2716's ("one `pr-list --state all --since …` per listing, no `--state all --limit 3000` without `--since`"), stated per listing, and must name that the store must decode at version 5 first.
- No test is named for the safety property in section 3. A required test: the open call answers, the index holds MERGED rows for some branches, the `all` call is not made, and a no-ref branch outside the index reads `unknown` or is asked, never `open`.

## 5. New defects and gates

- **`check-shell-lines.sh` (CI `ci.yml:1312-1325`).** It counts commands in non-comment lines of every `.sh` under `skills/` against the merge base, with no allowance. An index read in the scan, modelled on `plot-reconcile-scan.sh:713-730`, is roughly 15–20 commands, so the slice must delete as many elsewhere in the same change. The plan does not mention it. Placing the merge in `fleet-scan.ts` (TypeScript, carried listing) adds no shell. *Read.*
- **`check-decision-count.sh` (`ci.yml:1331-1333`).** If the scan's README row kind changes, the gate reads it. A pure read does not change the kind. *Read.*
- **`check-bundle-resolution.sh` (`ci.yml:1426`).** A bundle path in the scan must be anchored on `$script_dir`, as `plot-reconcile-scan.sh:714` is. *Read.*
- **`check-host-cli-callers.sh` (`ci.yml:1398`).** Unaffected as long as the scan keeps calling `plot-host.sh` and the bundle; a direct `gh pr list --search` would fail it. *Read.*
- **bash 3.2 (`check-bash32-syntax.sh`, `ci.yml:1410`).** A per-branch join from bundle output invites `declare -A` or `mapfile`; neither exists in `/bin/bash` 3.2. The scan's existing idiom is per-branch cache files under `HOST_STATE_CACHE` (`:1162`); an index answer should write the same files. *Read.*
- **Carried listing ordering.** `prefill_pr_states` returns at `carried_listing` (`:982`) before any host call. An index read placed after it must not overwrite carried rows, and `report_listing` must not report index-derived rows as a fetched listing, or fleetd carries index answers as host answers (`fleet-scan.ts:438-442`). *Read.*
- **Bitbucket.** `--state all` on Bitbucket sweeps the tracked branches per state (`scanListingCost` = branches × 3), so its cost scales with tracked refs, not with repository size. The 18-page problem is GitHub-only; the plan's second open question should say the Bitbucket arm is already bounded and needs no change, or measure it. *Read.*
- **Layering.** The decision whether a listing is whole is shell today. A new rule ("index plus delta is whole") belongs in the domain beside `listingSpend` / `indexMergedHeads`, per *The Layering Rule* and *A Shell Script Asks The Domain*; the plan places it in `plot-fleet-scan.sh`.

## Named changes for approval

1. Replace the slice's trigger with a design that fires on today's estate, and state which: the recommended one is a carried whole listing plus `pr-list --state all --since <host stamp − overlap>`, merged in `fleet-scan.ts`, with a CLAUDE.md paragraph if it reads the index.
2. State that `.list-complete` and `.list-arrived` come only from a whole host listing in this run (fetched or carried), never from index rows, and add the no-ref-branch-outside-the-index test from section 4.
3. Update `scanListingCost` so the cadence models the listing's real request count before and after.
4. State the acceptance as a `ps` sample per listing, and name the `v: 4` → `v: 5` precondition.
5. Name `check-shell-lines.sh` and the lines the slice removes, or move the change out of shell.
6. Answer open questions 2 and 4 with the facts above (Bitbucket already bounded; separate code from #2716, shared CLAUDE.md section).
