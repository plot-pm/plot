# Juror: contradiction

Lens: statements that disagree with each other, with the code, with CLAUDE.md, with the evidence, or with #2716, #2419 and #2386. Subject: `docs/plans/2026-10-26-the-fleet-scan-re-reads-all.md` at `8b7d08131`. Code cited from `p2721-main` at `c1d02f4fa`. Sibling #2716 read at `origin/idea/an-idle-board-and-fleetd-spend` `7962320ad`.

Position: amend

## Summary

The cost the plan names is real and matches the evidence. The plan contradicts itself on what the slice removes (shrink the `--state all` call, remove it, or keep only the open call). It contradicts the code on three facts it builds on: a scan does not list on each pass, the scan already hands its tracked branches to `pr-list`, and the Bitbucket arm does not page 50 per state for this call. The slice acceptance (no `--state all` call over a fully merged store) contradicts CLAUDE.md *The index never says no*, because the `all` call is what licenses `NONE` for every tracked branch with no PR. The plan grows shipped shell without naming the ratchet. The plan's own Approach sentence (ask only what changed since the last read) is a delta read, which #2716's new CLAUDE.md paragraph reserves for one consumer.

## 1. The problem

**The figures agree with the evidence.** *Read:* plan line 23 says 1,767 PRs, 18 pages per call, about 25 per hour, about 450 requests per hour. The cost juror's table (`cost.md`, #2716 panel) says: "scan `pr-list --state all --limit 3000` (`plot-fleet-scan.sh:1063`), ~25 per hour | ~25 | ~450". `graphql-2715.md` says "~50 (the `all` call pages ≥10 times, recorded once)" for the pair, which is 25 `all` lines per hour. No contradiction in the numbers. *Read:* `plot-fleet-scan.sh:1063` is the `--state all` call; `:691` sets `PR_LIST_LIMIT` to 3000.

**Contradiction 1.1: "on each scan" against the code.**

- Plan, line 23: "`plot-fleet-scan.sh:1063` runs `pr-list --state all --limit 3000` on each scan." Line 23 again: "With about 25 scans per hour". Changelog: "no longer lists every merged PR of the repository on each pass".
- Code, `packages/fleet/src/shared/fleet-scan.ts:14`: "`REFRESH_MS = 5_000` … The scan takes every beat." So a scan runs about 720 times per hour. `fleet-scan.ts:373-395` asks `listingSpend` whether the listing is due, and `:415` passes `PLOT_PR_LISTING: reusing ? state.listing : ''`. `plot-fleet-scan.sh:879`: "A CARRIED LISTING IS A FULL ANSWER OR IT IS NOT USED", and `prefill_pr_states` returns at `carried_listing && return 0` before any host call.

So 25 per hour is the number of listings `listingSpend` permits, not the number of scans. *Read.* The difference matters for the design: a lever already exists and the plan does not name it.

**Contradiction 1.2: the price the code puts on the listing.**

- Plan, line 23: one call "is about 18 GraphQL pages".
- Code, `fleet-scan.ts:113-114`: `scanListingCost` — `if (backend !== 'bitbucket') return 1;`. `listingSpend` then sets the listing interval from a cost of 1 request per GitHub listing.

The domain prices the listing at 1 request while the plan and evidence price it at about 19 (18 + the open page). *Read.* Correcting that price stretches the interval with no new read path and no shell growth. The plan names neither the rule nor the alternative.

**Field by field, what the `all` call feeds** (*read*, `plot-fleet-scan.sh`):

- the `STATE` of every PR that is not open: MERGED and CLOSED rows into the per-branch cache (`:1110-1145`), read by `host_pr_state` (`:1309`);
- `.list-arrived` (`:1185`), which makes an unjoined branch read `NONE` instead of `-` (`:1370-1374`);
- `.list-complete` (`:1270`, `:1273`), which licenses `NONE` for a no-ref branch without a `pr-state` call (`:1321-1351`), and which the scan reports as the eleventh field, `list_complete` (`:4385-4389`): "The rule reads a `NONE` for a ref behind main as `open` only when it is true".
- The `checks` and `draft` fields come from the open call only.

## 2. The approach against the code and the siblings

**Contradiction 2.1: what the slice removes, three ways.**

- Design, line 44: "The second call (`--state all`) is the one this plan **shrinks**."
- Slice, line 57: "a test shows an idle scan over a fully merged store makes **no `--state all` call**."
- Changelog, line 17: "it reads merged PRs from the PR index and asks the host for **the open ones**."

The Changelog leaves only the open call. The Design keeps a smaller `all` call. The slice removes it in one case. These are three different designs. *Read.*

**Contradiction 2.2: the Changelog against the plan's own constraint.**

- Changelog: "asks the host for the open ones".
- Constraint, line 42: "Only MERGED rows come from the index. OPEN, **CLOSED** and draft rows go to the host."

The open call returns no CLOSED rows. If only the open call remains, nothing asks the host for CLOSED. *Read.*

**Contradiction 2.3: the slice acceptance against *The index never says no*.**

- Slice: an idle scan over a fully merged store makes no `--state all` call.
- Plan, line 43: "The index never answers `pr: 'none'`." CLAUDE.md line 511: "the index can supply `pr: 'MERGED'` but not `pr: 'none'`… a `complete: true` store knows nothing opened after its `at`."
- Code: `.list-complete` comes only from the host pages (`plot-fleet-scan.sh:1249-1273`, "BOTH PAGES MUST CLAIM IT"), and `host_pr_state` derives `NONE` from it (`:1346-1351`).

`TRACKED_BRANCHES` is every remote ref (`:766`), and the no-ref `--ask` arm covers plan-named branches with no ref. A branch with no PR has no MERGED row, so "a fully merged store" cannot answer it. Without the `all` call either the scan withholds `.list-complete` and pays one `pr-state` per such branch, or it writes the marker from the index and breaks the rule. The code records the cost of the first choice at `:1327-1332`: "28 of 29 host calls in a scan were for branches with no ref and no PR … One board spent ~3,600 calls/hour". The plan names neither outcome. *Read.*

`.list-arrived` has the same problem in a weaker form: if the open call alone sets it, an unjoined branch whose PR is CLOSED, or MERGED outside the index, reads `NONE` at `:1370-1374` (used without `--ask` at `:2146` and `:4128`). *Read.*

**Contradiction 2.4: Open Question 1, shape one, already exists.**

- Plan, line 48: "a second call limited to the branches the scan tracks and the index lacks".
- Code, `plot-fleet-scan.sh:1027-1034` and `:1064`: both calls already pass `--branch` for every tracked branch. "The adapter uses them only where it can — the Bitbucket arm sweeps its REST endpoint once per branch per state — and ignores them everywhere else, so the GitHub arm makes the single call it always made." `plot-host.sh:4487-4488`: on GitHub one branch maps to `--head`; several branches keep the listing.

On GitHub, "limited to the branches" with more than one branch is the same 18-page listing unless the adapter changes. The plan does not say it changes `plot-host.sh`. *Read.*

**Contradiction 2.5: Open Question 2 against the code and #2419.**

- Plan, line 49: "Bitbucket pages 50 PRs per state."
- Code, `plot-fleet-scan.sh:1028-1029`: with tracked branches, the Bitbucket arm sweeps per branch per state, not a 50-row page.
- #2419 (Approved, in progress), cost table: "`plot-fleet-scan.sh:1063` | 3000, `--state all` | only with no tracked branch (`:766`, every remote ref) | 3 | 1 + 60 + 3 = 64". #2419's Changelog: Bitbucket `pr-list` "follows `next` up to the caller's `--limit` instead of reading one page of 50 PRs per state".

So on Bitbucket this call is a branch sweep today, and #2419 changes the no-branch case from 50 rows to up to 3,000. The plan's Bitbucket fact is wrong now and wrong after #2419. *Read.*

**Contradiction 2.6: the plan's Approach against #2716's CLAUDE.md paragraph.**

- Plan, line 33: "an idle scan asks the host only for what can have changed since its last read, or reads terminal answers (MERGED rows) from the PR index". Open Question 1, shape two: "a call that lists only PRs updated since the last read".
- #2716, proposed CLAUDE.md paragraph: "**One consumer reads a complete store plus a host delta as its merged listing.** … This licence is for this one consumer; another consumer needs its own paragraph here."

Shape two is a store-plus-delta read. Under #2716's text, the scan would need its own paragraph, which the plan does not plan. Shape one (MERGED rows plus the host for the rest) stays inside the existing rule. The plan should choose, and if it chooses the delta, add the paragraph to the slice as #2716 does. *Read.*

**Contradiction 2.7: Open Question 4 against #2716's scope.** The plan asks whether "the two touch separate code". #2716 touches `registryd-main.ts` `mergedBranches`, `rules/known-pr.ts`, `host-shell.ts` `prList` (`since`) and CLAUDE.md. #2716's Notes: "Out of scope: the scan's `pr-list --state all --limit 3000` (`plot-fleet-scan.sh:1063`) … See #2720." So code is separate unless this plan takes shape two, which would reuse #2716's rule and CLAUDE.md section. The question has an answer in #2716 that the plan does not use. *Read.*

**Consistent with the code** (*read*): `plot-pr-index-lookup.mjs` reads MERGED rows through `decodePrIndex` and answers `ask` otherwise (`packages/board/src/server/entry/pr-index-lookup.ts`); `plot-impl-status.sh:195` and `plot-reconcile-scan.sh:714` call it; `pr-refresh.ts:1333` is the one `foldPrIndex` caller. The plan's Notes omit two callers (`plot-board-probe.sh`, `plot-ask.mjs` also name the bundle), which changes nothing.

## 3. Safety

The plan states MERGED-only and never-none (lines 42-43), which is safe. Its slice and Changelog contradict those lines (2.2, 2.3). The unsafe path is the one the Changelog describes: if the scan keeps only the open call and still writes `.list-arrived` or `.list-complete`, then a no-ref branch whose PR merged outside the index's window reads `NONE`, and `list_complete=true` makes the domain read a `NONE` ref behind main as `open` (`:4385-4388`). The index window is bounded: #2419 line 52 says "On GitHub the index holds the 1000 most recent PRs across all states" (`pr-refresh.ts:303` `PR_LIMIT = 1000`), against 1,711 merged PRs. I found no path that releases a claim or deletes a ref from the scan's listing; the risk is a wrong `open`/`NONE` reading. *Read; the trace is a reading of the code, not a run.*

## 4. Slices against Changelog and acceptance

- The Changelog promises a live change ("An idle fleet scan no longer lists every merged PR"). The slice's acceptance is a unit test only. #2716 measured that the live store is `v: 4` against `PR_INDEX_VERSION` 5 (`entities/pr-index.ts:12`), so every lookup answers `ask` until fleetd restarts on current code. The plan's Open Question 3 names the fallback, but the acceptance does not say how the operator sees the saving in `budget.tsv`, which counts one line per `gh` process (#2717) and so cannot show pages saved.
- The test "fully merged store" cannot exist on a real estate with a branch that has no PR yet (2.3). The acceptance needs a fixture that says what happens to such a branch, with a count of `pr-state` calls.

## 5. New defects

- **Shell ratchet.** CLAUDE.md line 489: "`scripts/check-shell-lines.sh` ratchets the shipped shell's line count … a change that adds … must remove an equal number of lines elsewhere." The slice's `builds:` comment is "a PR-index read in plot-fleet-scan.sh, through board/plot-pr-index-lookup.mjs". The plan names no offsetting removal. *Read.* A read in `fleet-scan.ts`, which already carries `PLOT_PR_LISTING` and `PLOT_TERMINAL_CACHE` into the scan, keeps the shell flat and follows *The Layering Rule* (a TypeScript caller reads the store through the adapter).
- **Existing reuse mechanisms are not named.** Plan line 35: "Two existing mechanisms bear on the design", naming the lookup bundle and `pr-refresh.ts`. Line 62: "It found no existing scan read that answers from the index." Both are true as written, but the scan already reuses host answers in two ways: the carried listing (`plot-fleet-scan.sh:866-925`) and the terminal cache (`:1433-1480`), which CLAUDE.md line 509 names as the licence the index readers "adopted whole". The plan should say why neither is the place for this change.
- **Board impact.** The comment says the board payload does not change. The eleventh field `list_complete` is part of the scan reading; if the slice changes when `.list-complete` is written, the reading changes. The comment should say what happens to that field.

## Required changes

1. Choose one design and state it the same way in Changelog, Design and Slice: shrink the `all` call, remove it, or keep only the open call (2.1, 2.2).
2. State how the scan answers a tracked or plan-named branch with no PR and a branch with a CLOSED PR without the `all` call, and how many `pr-state` calls that costs per scan, or keep a call that licenses `.list-complete` (2.3).
3. Correct the motivation: a scan runs every 5 s, and `listingSpend` decides the ~25 listings per hour. Name `scanListingCost` (`fleet-scan.ts:113-114`), which prices a GitHub listing at 1 request, and say whether pricing it at its page count is the cheaper fix (1.1, 1.2).
4. Correct Open Questions 1 and 2: the scan already passes tracked branches; GitHub ignores more than one; Bitbucket sweeps per branch, and #2419 changes the no-branch case (2.4, 2.5).
5. If the design reads a delta since the last read, add its own paragraph to CLAUDE.md *A Decision Reads The Index*, as #2716's paragraph requires (2.6).
6. Name the shell-lines ratchet and the offset, or move the index read into `fleet-scan.ts` (5).
7. Give an acceptance the operator can check on the live estate, including the `v: 4` store case (4).
