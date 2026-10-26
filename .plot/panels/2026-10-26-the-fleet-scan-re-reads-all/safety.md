# Juror verdict: safety

Plan: `docs/plans/2026-10-26-the-fleet-scan-re-reads-all.md` (head `8b7d08131`). Code: `p2721-main` at `c1d02f4fa`. Lens: can the scan settle a slice, start a delivery, release a claim or hide work on a stale, partial or missing answer after the change.

Position: amend

## Summary

The plan names the right constraint ("the index never says no"), but it does not carry that constraint to the two markers the `all` call exists to earn: `.list-arrived` and `.list-complete`. Each marker turns a cache miss into `NONE`. Both markers also travel to later pulses through the carried listing. With the `all` call replaced by index rows, a miss can mean "the store has no row". It no longer means "the host has no PR". The plan's single acceptance test ("an idle scan over a fully merged store makes no `--state all` call") checks only cost. It has no test that a missing, old-version or partial store still gives the safe answer. The live store on this machine cannot give the saving at all: it reads `v: 4` against `PR_INDEX_VERSION` 5 and holds 1,003 of about 1,767 PRs (ran). Amend before approval: name the markers, the skip predicate, the merge order and the negative tests.

## 1. The problem

- The call exists as described: `plot-fleet-scan.sh:1063-1065`, `pr-list --state all --limit "$PR_LIST_LIMIT"` with `PR_LIST_LIMIT` defaulting to 3000 (`:691`). Read.
- The page and per-hour figures (18 pages, about 25 scans per hour) come from the cost juror and `graphql-2715.md`. I did not re-measure them. Read, not ran.
- What the scan uses the `all` payload for, field by field (read, `:1080-1167`, `:1179-1274`):
  - `state` + `head` of every non-OPEN row: written to `$HOST_STATE_CACHE/<key>` as `MERGED` or `CLOSED`. The OPEN rows of `all` are dropped (`:1088`). The `open --rich` call answers those.
  - The row count `_pr_rows` (`:1086`) and the adapter's stderr claim `host_err` (`:1267`) decide `.list-complete`.
  - Its arrival writes `.list-arrived` (`:1178`).
  - `report_listing` (`:956-987`) emits every cache line and both markers on stderr. `fleet-scan.ts:415` passes them back as `PLOT_PR_LISTING`, and `carried_listing` (`:891-937`) rewrites both markers on the next pulse without asking the host.

## 2. The approach against the code

Every consumer of the cache, and what each needs (read):

| Consumer | Line | Question | Index can answer? |
|---|---|---|---|
| `branch_readings`, ref'd arm, field 6 | `:4128` (`host_pr_state "$br"`, no `--ask`) | MERGED, OPEN, CLOSED or none for a branch with a ref | MERGED only. A miss falls through to `.list-arrived` → `NONE` (`:1371-1375`) |
| `worker_of` PR fact | `:2146` (no `--ask`) | OPEN or MERGED → `pr` | MERGED only, same fall-through |
| `merged_by_host`, refless arm | `:1524` (`--ask`) | MERGED for a branch whose ref is gone | MERGED only. A miss falls to `.list-complete` → `NONE` (`:1346-1352`), else one `pr-state` per branch |
| Prerequisite `waits:` | `:4471` (`--ask`) | MERGED clears; `NONE` + not a named slice → `blocked` | MERGED only, same `.list-complete` arm |
| `list_complete`, field 11 | `:4388-4389` | `NONE` on a ref behind main reads `open` only when true (`branch-state.ts:323-325`) | Never. The index cannot license completeness |

So MERGED rows are safe to read for every consumer. Every other answer the `all` call gives (CLOSED, and the absence that `NONE` stands for) needs the host. The plan says "only MERGED rows come from the index" and "a missing row means ask the host". It does not say what happens to `.list-arrived` and `.list-complete` when no host was asked. That is the gap.

#2716 adds a CLAUDE.md paragraph that licenses "this one consumer" and says "another consumer needs its own paragraph here" (sibling plan, line 121). This plan is a second consumer. Unlike #2716's merged set, the scan's output decides claimability (`open` is what `--next` hands out), wave settlement (`pulse.ts:67`), `isFree` (`auto-dispatch.ts:143`) and auto-delivery (`auto-deliver.ts:215`). The plan adds no paragraph and does not state its blast radius. Read.

## 3. Safety: the paths

Each path below is a way the slice, as described, can be built so that it passes its one acceptance test.

**P1: a fabricated `.list-complete` opens a merged slice for re-dispatch.** The natural implementation writes index rows into `host_list_out` so the existing parser at `:1112-1167` reuses them. Then `_pr_rows` counts index rows. `0 < _pr_rows < 3000` holds, and the fallback arm at `:1271-1274` writes `.list-complete`. A refless branch whose PR merged and whose store row is absent then reads `NONE` at `:1346-1352`. The rule makes that `open` (`branch-state.ts:262`), and `--next` offers finished work. A row is absent when (a) the PR is older than the store's window: the store holds 1,003 rows, 974 MERGED, against 1,711 merged PRs (ran, `.git/.plot/state/index/github.json`); (b) it merged after the store's `at`, for example while fleetd is stopped; (c) the store decodes at another version, which is the case on this machine now. The carried listing then repeats the false marker on every deferred pulse. **Required:** a scan that skipped the `all` call never writes `.list-complete`. Also state that the row-count fallback must not count index rows.

**P2: a fabricated `.list-arrived` hides finished work as `wip`.** The open call alone reaches `:1178`, so `.list-arrived` is written whether or not `all` ran. With `all` skipped, `host_pr_state` without `--ask` answers `NONE` for every branch that the open listing and the index both miss (`:1371-1375`). A resurrected ref of a squash-merged branch (the #356 shape, `:4060-4072`) then reads `wip` and not `merged` when its PR is absent from the store. Its wave never completes, its desk reads occupied, and `isFree` stays false. Today the 3000-row `all` call covers that PR. After the change, a PR outside the store's 1,003-row window stays `wip` permanently. This is the safe direction for settlement but it hides finished work. **Required:** either skip `all` only when every tracked ref is answered (see P3), or make the non-`--ask` arm answer `-` and not `NONE` when the `all` call was skipped.

**P3: the skip predicate is not stated.** "A fully merged store" can mean `complete: true`, "every tracked branch has a MERGED row", or "every plan branch has one". Only one reading is safe without a host delta: skip `all` only when every name in `TRACKED_BRANCHES` (`:766`) is answered by an OPEN row from this pulse's open call or a MERGED row from the index. Under that predicate no ref'd branch reaches the `NONE` fall-through. An empty `TRACKED_BRANCHES` must not satisfy the predicate vacuously: `:743-765` already records that a completeness claim over an empty set licenses `NONE` for branches nobody asked about. **Required:** state the predicate in the plan, including the empty-set case.

**P4: index MERGED must not overwrite a fresh OPEN.** `mergedRowByHead` answers by head branch (`pr-index-lookup-answer.ts`). A reused branch name with a new open PR has both an old MERGED row and a new OPEN one. Today the rank sort at `:1165-1166` keeps OPEN. If the slice writes index answers into the cache after the loop, MERGED overwrites OPEN. The branch reads `merged`, its wave settles on work in review, and `allSlicesMerged` can start an unattended delivery. **Required:** index rows only fill keys the open listing left empty, or they enter the same rank sort. `plot-reconcile-scan.sh` (#1022) puts the host's lines first for the same reason.

**P5: withholding the markers moves the cost and can kill the scan.** If the slice withholds `.list-complete` correctly, every refless plan-named branch takes one `pr-state` call per scan through `--ask` (`:1354-1368`). `NONE` is never put in the terminal cache (`terminal_learn`, `:1474-1475`). The code records 28 of 29 host calls of one scan as exactly these branches (`:1325-1331`), at 3.8 s each (`:1243-1247`). #2716 counts 28 of 35 live non-deferred branches without a MERGED row. That can cost more GraphQL requests than the 18 pages it saves. It can also push the scan past its timeout, where `fleet.ts` kills it with SIGKILL and the pulse carries no listing. This is not a wrong answer, but the plan must measure it before it chooses a shape. It is a third shape for Open Question 1.

**Claims.** No path here releases a claim directly. Claim release and reaping read `plot-pr-merged.sh` and `prMerged`, not the scan (`ending-action.ts:337-343`, `release-claim-reader.ts:77-81`; read). The scan's `merged` does feed `isFree` and auto-delivery, so P4 reaches delivery and P1 reaches dispatch.

## 4. Slices against Changelog and acceptance

- The Changelog says the scan "reads merged PRs from the PR index and asks the host for the open ones". That is wrong as a description of safe behaviour: merged PRs the store lacks, CLOSED PRs, and branches with no PR still need the host. Reword it to say the scan skips the full listing when every tracked branch is answered.
- The acceptance is cost-only. It must add negative tests that a reviewer can run: (a) an old-version store or no store → the `all` call is made; (b) a skipped `all` call → `report_listing` emits no `.list-complete`; (c) a refless merged branch absent from the store reads `unknown` or is asked, never `open`; (d) a reused branch with an OPEN row and an index MERGED row reads `wip`; (e) a tracked ref with no PR → the `all` call is made; (f) an empty `TRACKED_BRANCHES` → the `all` call is made.
- On this machine the slice changes nothing until fleetd runs code that writes v5: every lookup answers `ask` (ran: store `v 4`). The acceptance must name where it is measured. Per #2717 the spend record counts one line per process, so the observable result is "no `pr-list --state all` line in `budget.tsv` over N scans". The GraphQL request count is not observable there.

## 5. New defects and gaps

- CLAUDE.md *A Decision Reads The Index*: the scan becomes a third shell consumer whose answers decide claimability. Following #2716's own wording, it needs its own paragraph in the same slice, plus `./scripts/check-agents-md.sh --write`. The paragraph must state that a skipped listing writes neither `.list-complete` nor a `NONE` the host did not give.
- Bitbucket: the `all` call there sweeps per tracked branch per state and states `sweep complete` (`:1209-1228`). `.list-complete` requires both calls' claims (`:1267`). The plan must keep the open call's claim alone from licensing the marker.
- The carried listing (`:866-937`) is a second path for every marker. The tests must cover a carried listing from a skipped-`all` scan, not only a fresh one.
- `check-shell-lines.sh`: a per-branch index lookup in shell adds lines, so the slice must remove an equal number. I did not count them. bash 3.2 and `check-host-cli-callers.sh` are not affected by the lookup bundle as far as I read (the bundle is called from `plot-impl-status.sh:195` and `plot-reconcile-scan.sh:714` the same way). Read.

## Named amendments

1. State the skip predicate: every name in a non-empty `TRACKED_BRANCHES` has an OPEN row from this pulse's open call or an index MERGED row; otherwise make the `all` call as today.
2. A scan that skipped the `all` call writes no `.list-complete`, does not count index rows toward `_pr_rows`, and makes the non-`--ask` miss answer `-` or provably never occur.
3. Index rows fill only cache keys the open listing left empty.
4. Measure the refless `--ask` cost (P5) against the 18 pages before choosing, as part of Open Question 1.
5. Add the CLAUDE.md consumer paragraph in the same slice.
6. Add the negative tests (a)-(f), including one over a carried listing, and correct the Changelog sentence.
