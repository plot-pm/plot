# Juror: cost

Lens: the person who pays the host bill. Subject: `docs/plans/2026-10-26-the-fleet-scan-re-reads-all.md` at `8b7d08131`. Code cited from `p2721-main` at `c1d02f4fa`.

Position: amend

## Summary

The problem is real and is the largest idle GraphQL spender in requests. The slice as written saves close to nothing on GitHub, for three reasons the plan does not name. First, the `--state all` listing does more than report MERGED rows: it is the only evidence that licenses `NONE` (`.list-complete`) for unstarted branches and the only source of CLOSED, and on today's estate 12 of 97 plan branches need one of those two answers. Second, on GitHub `pr-list` cannot narrow to several branches, so "ask the host about the rest" is either the same 18-page listing or one `pr-state` call per branch, the N+1 that #216 and #1017 removed. Third, the live store is `v: 4` against `PR_INDEX_VERSION` 5, so the index answers `ask` for every branch until fleetd restarts. The plan names a better shape in its first Open Question (a `--since` delta) but builds the other one. It also misses two cheaper levers: `scanListingCost` prices a GitHub listing at 1 request when it costs about 19, and on Bitbucket the `all` sweep re-asks the `open` state that the scan throws away.

## 1. The problem

**The call and its parameters match the plan.** *Read:* `plot-fleet-scan.sh:1047` asks `pr-list --state open --limit "$PR_LIST_LIMIT" --rich`, and `:1063` asks `pr-list --state all --limit "$PR_LIST_LIMIT"`. `PR_LIST_LIMIT` defaults to 3000 (`:691`). On GitHub, `plot-host.sh` passes the call to `gh pr list`, which pages internally at 100 rows (`plot-host.sh:4524`, *read*). With 1,767 PRs (the plan's count, from the #2716 cost juror) one call is about 18 GraphQL pages, plus 1 page for the open call.

**The record cannot show the per-call cost, and the plan says so correctly.** *Ran:* `~/.plot/state/budget.tsv` and `.1` carry no operation field. Columns 7-10 are `- - - unknown` for 19,219 GraphQL lines; only 11 lines are `actual` limit readings. *Ran:* each `actual` reading against the record lines in the same rate-limit window gives 1.4 to 2.9 points per line, typically 2.2 to 2.8 (for example 10-26 20:00: 1,277 points against 460 lines in 43 minutes). *Ran:* one `gh api rate_limit` at 20:32 showed 44 points used against 24 record lines in the 133 s since the window reset, a ratio of 1.8. So the account spends about 1,200 to 1,800 GraphQL points per hour while the record shows 450 to 650 lines per hour. That gap is consistent with paged listings recorded as one line each (#2717).

**The cadence is set by scan duration, not by `listingSpend`.** *Read:* fleetd runs `fleet-scan` every 5 s beat (`fleet-clock.ts:29`, guarded against overlap at `:90-97`). `scanOnce` asks `listingSpend` with `costPerListing: scanListingCost(backend, …)` (`fleet-scan.ts:379-381`), and `scanListingCost` returns **1 for GitHub** (`fleet-scan.ts:113-114`). So the base interval is 5 s and the maximum stretch (8, `cadence.ts:32`) gives 40 s. The scan takes longer than that, so a listing runs on almost every scan. The #2715 `ps` sample (*read*, `graphql-2715.md`) observed a pair about every 2 minutes, with the `all` call taking about 12 s. I accept the plan's ~25 listings per hour and ~450 requests per hour as a derived figure of the right size. It is not measured per call.

**What the scan uses the `all` listing for, field by field.** *Read:* `prefill_pr_states` keeps only `state` and `head` from it (the plain-row `sed` arm of the pipeline after `:1089`). It drops the listing's OPEN rows (`:1089`) because the open call already answered them. Three uses remain:

| Use | What decides on it | Can the PR index answer it under the current rule? |
|---|---|---|
| MERGED for a branch | `host_pr_state` → merged-by-host, wave gate, `--next` (`:1524`, `:4471`) | Yes. MERGED is terminal. |
| CLOSED for a branch | the branch's PR state | No. CLOSED rows go to the host. |
| Completeness → `.list-complete` (`:1269-1273`) | `host_pr_state --ask` derives `NONE` without a host call (`:1345-1351`), which is what makes an unstarted branch `open` and claimable | No. The index never says `none`. |

The plan's Approach names only the first use. The third use is the one the scan was built around (#216, #1017), and it decides cost.

## 2. The approach against the code

**The estate today, by answer needed.** *Ran:* `last-pulse.json` names 97 plan branches. Joined against the live index (`.git/.plot/state/index/github.json`, 1,003 rows, PR numbers 776 to 2721): 85 are `merged` and all 85 have a MERGED row; 1 has an OPEN row (answered by the open call); 1 has a CLOSED row; 10 have no row (7 unstarted, plus 1 claimed, 1 waiting, 1 wip). So 11 branches need CLOSED or NONE, and NONE needs a complete host listing. *Ran:* of the 11 remote refs (the `TRACKED_BRANCHES` set, `:766`), only 1 has a MERGED row; 4 OPEN, 3 CLOSED, 3 no row, `main` among them.

**The index cannot answer even the MERGED rows on this machine today.** *Ran:* the store reads `"v":4`; main has `PR_INDEX_VERSION = 5` (`entities/pr-index.ts:12`). Running `plot-pr-index-lookup.mjs github` with two branches that have MERGED rows answered `-	ask	-	-	-` for both. fleetd (pid 8692) started on 2026-10-17. The saving is 0 until fleetd restarts on current code and writes a v5 store. #2716's acceptance names the same condition; this plan does not.

**The index window is the newest ~1000 PRs, not the repository.** *Read:* `PR_LIMIT = 1000` (`pr-refresh.ts:303`). *Ran:* the lowest row is #776 while the store says `complete: true`. All 85 merged plan branches fall inside the window today. A plan branch merged before the window has no row and costs a host answer. That is safe, but the saving shrinks as the repository grows.

**What "asks the host about the rest" costs on GitHub.** *Read:* the scan passes every tracked branch as `--branch` (`:1036-1037`), and the GitHub arm uses it only when exactly one branch is named (`plot-host.sh:4488`, `head_args`). So the residual cannot be one narrowed GitHub listing. Per listing, with R branches left over:

| Shape | GraphQL requests per listing | Per hour at ~25 listings | Note |
|---|---|---|---|
| Today | 1 open + ~18 all = ~19 | ~475 | |
| Slice as written, residual asked by the same `--state all` | ~19 | ~475 | saving 0 |
| Slice, residual asked per branch (`pr-state`), R = 11 today | 1 + 11 = 12 | ~300 | saves ~175/h; adds ~42 s of scan time at the 3.8 s per call measured at `:1246`; break-even at R = 18 |
| Open Question 1, `--state all --since <host watermark>` over the carried listing | 1 + 1 = 2, plus one full read per period | ~50 + ~18/day | saves ~425/h; keeps completeness from host answers |
| Index read of MERGED rows with no residual call, and `.list-complete` written anyway | 1 | ~25 | **forbidden**: derives `NONE` from the index |

The `--since` shape is cheapest and needs no rule exception, because the completeness claim stays on the scan's own host answers. The carried listing exists already (`PLOT_PR_LISTING`, `:873-922`; `report_listing`, `:938-972`; `fleet-scan.ts:414-427`). It needs a watermark line taken from the host's `updatedAt` (the plain GitHub rows carry it, `plot-host.sh:4572-4573`) and a full-read period, like `PR_FULL_READ_MS` (`pr-refresh.ts:331`). `updated:>` is exclusive (`plot-host.sh:4475-4486`), so it needs the same overlap #2716 uses.

**Bitbucket.** *Read:* `bb_states_for all` is `open merged declined` (`plot-host.sh:2538`), and with `--branch` each state sweeps one REST request per tracked branch (`plot-host.sh:1440-1486`). So one scan listing costs B for the open call plus 3B for the `all` call, 4B in total. `scanListingCost` models 3B (`fleet-scan.ts:115`). The `all` sweep's `open` state costs B requests per listing, and the scan drops those rows (`:1089`). Removing it saves 25 % of every Bitbucket listing with no index read and no rule question. Index MERGED rows can also shrink the sweep: each tracked ref with a MERGED row saves 2 to 3 requests, and the sweep's completeness claim stays exact over the branches it asked. I did not measure ewz-kus-portal's ref count, so I give no hourly figure. The plan's Bitbucket Open Question should carry both levers.

**Agreement with #2716.** No conflict. #2716 changes fleetd's tick merged read (`registryd-main.ts:791`) and licenses that one consumer to read index plus delta. A scan read of MERGED rows needs no licence, because MERGED is the terminal answer the current rule already allows. If the plan derives NONE or CLOSED from anything but a host answer, it needs its own paragraph, as #2716's text says. The two plans should share one watermark rule (`rules/known-pr.ts` in #2716) rather than write two.

## 3. Safety

The costliest failure is not a GraphQL bill. If an implementation keeps writing `.list-complete` after it drops the `all` call, `host_pr_state --ask` (`:1345-1351`) reads every no-row branch as `NONE`. A merged branch older than #776 with its ref deleted then reads as unstarted, `--next` offers it, and fleetd dispatches a worker to redo merged work. One worker session costs more than a day of this listing. The plan's constraint list says "the index never answers `pr: 'none'`", but the slice line does not say where `.list-complete` comes from after the change. The slice must state that `.list-complete` is written only from host answers that cover every branch the index did not answer, and a test must cover a no-row, no-ref branch with no residual host answer reading `-`, not `NONE`.

A stale or missing index otherwise falls through to the host. *Ran:* the v4 store does exactly that today. So the fallback costs money but no correctness.

## 4. Slices against Changelog and acceptance

- The Changelog line says the scan "asks the host for the open ones". The scan already does that with the open call. The line must say how CLOSED and NONE are answered, because that decides the saving.
- The acceptance, "an idle scan over a fully merged store makes no `--state all` call", does not describe this estate. Today 11 of 97 plan branches and 10 of 11 remote refs have no MERGED row. A fixture where every branch is merged proves the fast path and measures nothing.
- The record cannot measure it either: it has no operation field (*ran*). Use what #2715 and #2716 use: a 200 s `ps` sample that counts `pr-list --state all` calls per scan, and the `actual` limit readings or `gh api rate_limit` points per hour before and after. State R, the residual branch count, on the day of measurement, and state that fleetd must run on code that writes a v5 store.

## 5. New defects and missed levers

- **The cost model is wrong by a factor of ~19.** `scanListingCost('github', …)` returns 1 (`fleet-scan.ts:113-114`). So `listingSpend` can stretch the GitHub listing only to 40 s, below the scan's own period, and the stretch never acts. Pricing the listing in pages (one call plus `ceil(rows / 100)`) lets the existing controller slow the listing on a busy account with a one-function domain change and no shell lines. The rate it reads is also in record lines (#2717), so both sides under-count; the plan should name this, or say why it leaves it.
- **Shell lines.** A bundle call, a residual-branch list and a fallback in `plot-fleet-scan.sh` grow shipped shell. `scripts/check-shell-lines.sh` refuses that without an equal removal. The plan budgets no lines. Building the scan's carried listing in fleetd (TypeScript) and handing it in through `PLOT_PR_LISTING` adds no shell and keeps one reader of the store.
- **Per-pass bundle call.** The scan runs on every fleetd beat. *A Shell Script Asks The Domain* reserves a domain call for scripts that run once per operator command; a per-pass script duplicates the rule instead. The plan does not say which side of that line the scan is on.
- **`check-host-cli-callers.sh`.** Not affected if the scan keeps calling `plot-host.sh` only. A per-branch residual ask must go through `plot-host.sh pr-state`, not `gh`.
- **Scan speed moves the open call's rate.** Dropping the ~12 s `all` call shortens the scan, so scans and open `--rich` calls run more often while `listingSpend` sees cost 1. The plan should state the open call's rate after the change.

## Required changes

1. Name the three uses of the `all` listing (MERGED, CLOSED, completeness for NONE) and state how each is answered after the change. State that `.list-complete` comes only from host answers, and add the no-row, no-ref test from section 3.
2. Choose the shape by cost before approval, not in the slice. On GitHub, a residual asked with the same listing saves 0 and a per-branch residual saves ~175/h at R = 11 with ~42 s more scan time. The `--since` delta over the carried listing saves ~425/h. Prefer the delta, or justify the other.
3. Add the Bitbucket lever that needs no index: drop the `open` state from the `all` sweep (B requests per listing, 25 %).
4. Fix or name `scanListingCost('github') = 1`.
5. Replace the acceptance with a `ps` sample and limit-reading points per hour, with R and the store version stated, and name the v4 store and fleetd restart as a precondition.
6. Budget the shell lines, or put the read in fleetd's TypeScript and hand it in through `PLOT_PR_LISTING`.
