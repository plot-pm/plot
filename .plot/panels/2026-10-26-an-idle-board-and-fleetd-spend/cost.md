# Juror: cost

Lens: the person who pays the host bill. Subject: `docs/plans/2026-10-26-an-idle-board-and-fleetd-spend.md` at `f84562650`. Code cited from `p2716-main` at `ea2aa9743`.

Position: amend

## Summary

Slice 1 is correct and cheap, and it removes the largest single idle spender counted in record lines. The plan states the spend in record lines and calls them requests. In requests, the nothing-done step is about a third of the idle spend, not "most". After slice 1, about 750 GraphQL requests per hour stay idle, mostly in two listings the plan does not name as targets. Slice 2 has no measured saving. The acceptance line about `mine=` cannot hold as written.

## 1. Root cause and share

**The record agrees with the plan's line counts.** *Ran:* awk over `budget.tsv.1` + `budget.tsv`, local hours 00–07 on 2026-10-26: graphql 601, 610, 611, 625, 617, 616, 602, 660 = 4,942; core 24. This matches the plan exactly.

**The burst shape supports about 10 leftover desks at night.** *Ran:* bursts grouped by gaps under 3 s, per UTC hour. From 23Z to 05Z, each hour has 40–45 bursts of 3 or more lines, and the most common burst sizes are 11, 12 and 13 lines. One merged-list call plus about 10 `pr-state` calls per tick fits that shape. The bursts shrink to 5–6 lines from 08Z and to 2–4 lines from 10Z, which fits leftover desks being removed during the day. So the ~430 lines per hour is plausible. I could not name the night's desks: `git worktree list` now shows only 2 plan-named desks with no manifest (*ran*), and the tick lines carry no timestamp (*read*).

**The night's desks almost certainly held endings whose verdict does not read `prOpen`.** *Ran:* `.plot/state/endings.jsonl` holds 184 endings: 65 `checks-unanswered`, 31 `unregistered`, 31 `blocked`, 24 `unreadable`, 12 `holding-work`, 12 `corrections-spent`, 5 `unstarted`, 4 `quiet`, and **0 `nothing-done`**. A desk with no ending file also reaches `return 'leave'` at `ending-action.ts:345` (*read*). So slice 1 removes nearly all of the step's calls in practice, not only the 2 measured `blocked` desks.

**Lines are not requests, and the plan's share uses lines.** `budget_record_call` (`plot-host.sh:3576`) writes one line per `gh` process (*read*). The repository holds 1,767 PRs, 1,711 merged and 3 open (*ran*: one `gh api graphql` totalCount query). So one `pr-list --state merged --limit 500` line is 5 pages and one `pr-list --state all --limit 3000` line is 18 pages (*derived* from 100 per page). A 3-minute sample of `gh api rate_limit` against the record (*ran*, 18:38–18:41 UTC, desks running) shows 48 GraphQL points used against 24 new record lines. Other unrecorded spenders were live in that window, so this ratio is an upper bound for fleetd alone, but it confirms that the record under-counts.

Re-derived idle spend per hour, in requests (*derived* from the plan's cadences, the burst count of ~43 ticks per hour, and the page counts above):

| Caller | Lines per hour | Requests per hour |
|---|---|---|
| nothing-done `pr-state` (~10 desks) | ~430 | ~430 |
| tick `mergedBranches`, `pr-list --state merged --limit 500` (`registryd-main.ts:791`) | ~43 | ~215 |
| scan `pr-list --state all --limit 3000` (`plot-fleet-scan.sh:1063`), ~25 per hour | ~25 | ~450 |
| scan `pr-list --state open --rich` (`plot-fleet-scan.sh:1047`) | ~25 | ~25 |
| pr-refresh and issue refresh (open list plus a closed `--search` list, both seen in my sample) | ≤ 90 | ≤ 150 |
| **Total** | **~618** | **~1,250** |

So the nothing-done step is about 70 % of the lines and about 35 % of the requests. The title, the summary ("spends most of them") and the Motivation table need to say which unit they count. The plan already names the under-count as #2717, but it still draws its share from the under-counted unit.

**Idle spenders the plan leaves untouched.** After both slices, about 800 requests per hour stay idle:

- The scan's `--state all --limit 3000` listing: about 450 requests per hour, the largest idle spender in requests. It re-reads 1,767 PRs every ~2 minutes while nothing changes.
- The tick's merged listing: about 215 requests per hour. Its answer is MERGED rows only. That is the one terminal answer that *A Decision Reads The Index* already allows from the PR index, which fleetd already reads through `prIndexRows` (`registryd-main.ts:843`). This change needs no new exception, unlike slice 2.
- The release path: `prReading` (`release-claim-reader.ts:72`, `:74`) makes 2 host calls per release attempt, and nothing tallies them. This runs only on a `release-claim` verdict, so it is not idle spend, but slice 1's "count every nothing-done host call" should say whether it includes these 2 calls.

The plan does not need to fix these. It needs to name them in Notes with their request rates, so the reader does not take "the nothing-done step is fixed" to mean "idle spend is fixed".

## 2. Verdict safety (cost-relevant part)

*Read:* `endingTableAnswer` (`ending-action.ts:326-349`) reads `prOpen` in exactly two places: `boundBranchHoldsWork` (`:199`), which `nothingDoneDecisions` never reaches because it filters bound endings first (`registryd.ts:1385-1388`), and `:347`, which only `nothing-done` with `commitBeyondClaim === 'no'` reaches. `endingReleaseBranch` (`:394`) does not read `prOpen`. The fresh-agent step already asks `prOpen` only for bound endings that were not asked (`registryd.ts:908`). So slice 1 changes no verdict and no release. I agree with the plan.

Slice 2 answers `true` only in the `leave` direction, and `gatherReadingsAndRelease` asks the host again before any release (*read*, `release-claim-reader.ts:72`). I found no path where it releases, deletes or hides work. Its cost case is the problem: with 0 of 184 recorded endings being `nothing-done`, slice 2 saves close to 0 requests per hour, and it adds a written exception to *A Decision Reads The Index*. A rule exception with no measured saving is a cost the plan does not justify.

## 3. The tally fix

*Read:* `minePerHour` is `boardSharePerHour(intervalMs, calls)` = `(3,600,000 / intervalMs) × calls` (`cadence.ts:72`), with `intervalMs` = 60 s. Real ticks run about 43 per hour (*ran*, burst count), because the tick itself takes 12–40 s (`cost=` in `fleetd.log`, *read*). So `mine=` scales each per-tick call by 60, while the record scales it by about 43.

Consequences:

- The acceptance line "the `mine=` field moves by the same amount as the record" fails arithmetically. With 2 desks, `mine=` drops by 120/hr and the record drops by about 86 lines per hour.
- Moving `tally.calls = 0` to after `spendForTick` is right for a completed tick. The plan does not say what happens on the two other paths. On a thrown tick (`registryd-main.ts:2393-2410`, `continue` before any reading) and on an incomplete tick (`report.incomplete !== ''`, no reading at `:2421`), the counter is not reset under the proposed move. The next reading then sums several ticks and multiplies them by 60. The plan must name where the reset goes on those paths, and a test must cover one of them.
- *Read:* `minePerHour` is read only in `registryd.ts`, `registryd-main.ts` and two test files, and nothing acts on it ("Reported, never acted on", `:2420`). The move changes no cadence or stretch decision.

## 4. Slices against Changelog and acceptance

Slice 1 ships an observable result: smaller bursts in the record and a larger `mine=`. Slice 2 ships no observable change on this estate, because no current or recorded desk has the ending it serves.

The acceptance measurement is weak with the record as it is. Hourly totals vary by 60 lines between quiet hours (601–660, *ran*), so a drop of about 86 lines per hour for the 2 current desks is close to noise. Also, the desk `desk-4606124b` wrote a new ending at 19:34 today (*ran*), so the 2 measured desks may be gone when the slice ships. The burst-size shape is a better measure: per tick, the burst drops from 1 + N lines to 1 line. I suggest acceptance in that form, with N stated on the day of measurement.

For scale: `free-b71b8ae4` has held a `blocked` ending since 2026-10-23 17:09 (*ran*, stat). At ~43 ticks per hour, that one desk spent about 3,000 requests on an answer its verdict never read (*derived*).

## 5. New defects

- The Changelog says `mine=` "counts that call". With the 60-s scale, it reports a rate about 1.4 times the record's. Either state that, or scale `mine=` by the measured tick period. The second choice is a wider change and can be a follow-up.
- `nothingDoneDecisions` also calls `commitBeyondClaim` (a git process) for every candidate (`registryd.ts:1399`). The plan reads it first, which is right. It could also skip it for endings other than `nothing-done`. That is a local cost, not a host cost, so it is optional.

## Required changes

1. State the spend in both units. Change "spends most of them" to the line share (~70 %) and the request share (~35 %), using the page counts from the PR totals.
2. Add the untouched idle spenders to Notes with request rates: the `--state all --limit 3000` scan listing (~450 per hour) and the tick's merged listing (~215 per hour, answerable from MERGED index rows under the existing rule).
3. Specify the tally reset on thrown and incomplete ticks, and test one of them.
4. Replace the `mine=` acceptance with a per-tick measure (burst size or calls per tick), or account for the 60-s scale.
5. Drop slice 2, or give it a measured saving. 0 of 184 recorded endings are `nothing-done`, so it buys a rule exception for close to 0 requests per hour.
