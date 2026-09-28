# Panel — a cold Bitbucket board buys the whole list (#1050)

Subject: `docs/plans/2026-09-28-a-cold-bitbucket-board-buys-the-whole-list.md`
Round 1, 2026-09-28. One juror, both commitments gated. Two read-only Bitbucket calls.

| Juror | Position | Evidence |
|---|---|---|
| evidence | amend | executed |

## The premise is true of `bb pr list` and false of Bitbucket

`bb pr list` really does take four flags and no query flag — confirmed. **But the limitation is the subcommand's, not the CLI's and not the host's**, and the plan built a design around it as though it were a boundary.

- `bb_pr_list_query` (`bin/bb:445`) **already builds a `q=` URL** whenever an author is given, putting the states inside the expression. The listing calls that function at `:829`.
- Plot **already calls `bb api` with a windowed `q=`** at `plot-host.sh:802`, and `bb api` is a documented escape hatch (`bin/bb:2299-2331`).
- `bb_branch_query` is not special: it hardcodes `source.branch.name` into the filter. Remove that clause and it is a windowed bulk listing.

So `plot-host.sh:3744-3745`'s *"the only Bitbucket path that can carry `updated_on` is `bb_branch_query`'s own REST `q=`"* is the only path **that exists**, not the only one available. **The plan inherited a stale comment as a constraint** — the identical failure its sibling #1049 records as its lesson, committed two hours earlier.

## Option 4, executed, and it dominates all three the plan offered

Against `quatico/quaweb-website` — 902 PRs, 895 MERGED, the repository the plan itself cites:

```
q=state="MERGED" AND updated_on>="2026-09-20..."   →  { "size": 9, "returned": 9 }
state=MERGED&pagelen=1                             →  { "size": 895 }
```

**One request, 9 rows of 895.** `size` is the server's match count, not a page length.

| option | calls | rows | verdict |
|---|---|---|---|
| sweep | branches × states | exact | dominated at every size |
| full listing | 1 per state | 895 | same cost, worse answer |
| `--limit` narrowing | 1 per state | 50, crowded | the hazard |
| **`q=` window** | **1 per state** | **9** | **this** |

**The pagination hazard does not arise.** The narrowing is server-side by predicate, so rows outside the window are never in the result set to crowd anything and the 50-row budget is never approached. The plan spent its `Done when` guarding an option nobody should build.

## The deferred crossover was a measurement of a dominated option

The plan deferred *"at what working-set size a sweep beats a full listing"* to the slice. Bounded by reading: a sweep costs branches × states; a full listing costs 1 per state; a windowed listing costs 1 per state **with the same narrowing**. Against option 4 **the sweep never wins at any size**.

Fourth deferral this week, and the fourth to hide something.

## The cost claim is attached to the wrong caller

The line numbers are right — `plot-fleet-scan.sh:895`, verdict `:898`, early return `:902` — but **the scan never asks for a window.** Its call carries `--limit` and branch args; `grep -n since` over that script returns prose only. The sole `--since` caller is the board (`fleet.ts:2862`).

So the fleet-stall hazard belongs to the scan's **unwindowed** call, which this plan does not change. The plan's benefit to the fleet is **indirect** — a shared budget less depleted by the board. Real, and much weaker than *narrowing the window stops the fleet stalling*.

## Amendments folded in

1. The `q=` path named, with the two places it already exists.
2. The design rewritten around the measured option, with the four-way table.
3. The pagination guard removed as unnecessary, and why.
4. The crossover answered rather than deferred.
5. The cost claim re-attributed to the board, with the scan explicitly out of scope.
6. `bb_pr_list_query`'s own warning added to `Done when`: states travel INSIDE `q=`, never alongside it, or they are silently discarded.
7. #1049 restated as a smaller question — a `q=` window already carries its states in one expression.
