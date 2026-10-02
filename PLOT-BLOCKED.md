PLOT-BLOCKED: The fix removes 100% of the named cost (26 → 0 `pr-state` calls), but the measured wall-time fall is 28.0%, not the 54-61% the plan's slice-2 Done-when requires. The cost was 30% of wall on this estate today, not 57%. Is a 28.0% fall that eliminates the whole named mechanism acceptable, or does the Done-when stand as written?

## What was built, and it works

The brief's lead was correct in every particular. Confirmed before changing anything:

- `gh pr list --state all --limit 3000` returns **1064** PRs on this repository.
- The scan asks with `PR_LIST_LIMIT=1000`, so the `all` page returns **exactly 1000** rows.
- `prefill_pr_states`' test `_pr_rows > 0 && _pr_rows < PR_LIST_LIMIT` is therefore **false**.
- `.list-complete` is never written; `.list-arrived` is.
- Every branch the join does not name falls through to `host_pr_state --ask` → one `plot-host.sh pr-state` call each.

This is the brief's **outcome 1**: the marker is absent because the page hit the limit.

The adapter already knew. `pr_list_report_truncation` printed, on every scan:

    plot-host: github pr-list state=all possibly truncated (1000 rows, requested limit 1000
    unprovable) — a join against this page may read older branches as 'no PR' (#333)

Nothing read it, because a *complete* page was silent — so a caller could not tell "this page holds every PR" from "this adapter has no opinion", and the only reading left to it was its own row count.

**The fix, in the shape `f0a18f535` ("a short Bitbucket page is complete") already established:**

1. `pr_list_report_complete` states the claim only the adapter can make — it knows the paging semantics, the caller does not. Same contract shape as `pr_sweep_report`, which the scan already reads.
2. `prefill_pr_states` reads either sentence (`sweep complete` or `page complete`) from **both** pages. The row count stays as the fallback for an adapter that states nothing.
3. `PR_LIST_LIMIT` 1000 → 3000. The number is now a **budget the scan detects the exhaustion of**, not an assumption: at 3001 PRs the page comes back capped, the adapter says `possibly truncated`, the marker is withheld, and the scan degrades to the per-branch asking it does today — slower, still correct.

## The numbers

Two completed runs (`rc=0`), same checkout, same estate, `--stream`-equivalent `--json`, `PLOT_TERMINAL_CACHE=''`, `gh` wrapped in a timing shim:

| run | scan | wall | `pr-state` calls | `gh` total | load before → after |
|---|---|---|---|---|---|
| before | `origin/main` | **311.0 s** | **26** | 28.2 s | 12.19 → 11.14 |
| after | this branch | **224.0 s** | **0** | 7.7 s | 10.45 → 17.45 |

- **Call count: 26 → 0.** The mechanism is fully removed. This is the brief's "what proves the mechanism".
- **Wall: −28.0%** (87 s of 311 s). Against the Done-when's "at least about half", this **falls short**.

**Why the share is smaller than slice 1's, and it is not the fix underperforming.** Per-call cost measured separately on this machine: `plot-host.sh pr-state` **3.80 / 3.97 / 3.85 s**, of which bare `gh pr view` is only **1.01 / 0.67 / 0.64 s** — roughly 3 s per call is `plot-host.sh`'s own start, not the network. So 26 × 3.87 s ≈ **101 s**, which is **30% of the 311 s before run**, not 57%.

Slice 1 measured **36-39** calls; today's estate has **26**. Fewer refless branches means a smaller share of a smaller wall. The fix removed all of it; the cost was simply worth 30% today rather than 57%.

A paired back-to-back run at matched load was attempted four times and could not complete: the machine ran at load 25-38 from foreign fleet activity throughout, and the baseline scan hit `rc=124` at 560 s having made 6 of its 26 calls. Slice 1 recorded the same obstacle ("a measurement cannot get a quiet machine here").

## Correctness is verified, and the fix also repaired 14 stale verdicts

The dangerous direction — a real PR reading `NONE` — does not occur. Every one of the **17** branches the complete list omits was asked of the host directly, and **all 17 genuinely have no PR** (`gh pr list --head <b> --state all` → `[]` for each). Deriving `NONE` for them is correct.

The `--json` diff shows 14 branches changing verdict, and **every move is toward the host's true answer** — `wip → merged`, `waiting → open`, `blocked → waiting`. **Not one branch moved to `none`.** Spot-checked four of them: their PRs merged at `2026-10-02T07:36:29Z`, i.e. **before both runs**, and the before run still reported them `wip` two hours later. The capped path was failing to resolve branches the complete list answers immediately.

So the brief's rule holds: no branch that read `-` or `open` reads `none`.

## Gates

`pnpm test` **pass**. `check-host-cli-callers.sh`, `check-temp-paths.sh`, `check-ancestry-decisions.sh`, `check-changeset-packages.sh` all **exit 0**. Changeset added (`'plot': patch`, description first, `bumps:` last, naming the plan).

Tests: **7 pass** in `fleet.test.mjs` (the discriminating pair is two pages AT the row limit, differing only in the stderr sentence) and the whole `pr-list`/truncation/completeness/sweep family passes in `host.test.mjs`, including every pre-existing guard. `host: a GitHub page UNDER the requested limit is silent` was **rewritten rather than left passing on a technicality** — it asserted silence as the contract, and the silence was the defect; `truncationReports` filters on `possibly truncated` and would not have matched the new line.

## Two pre-existing failures found, neither mine, neither repaired

Both verified against a pristine `origin/main` worktree (`d116e84bf`):

1. **`host.test.mjs`: 28 failures**, all Jenkins / Jira / `.env`-config. Four spot-checked on main: **fail identically**. Nothing in the set touches `pr-list`, completeness or truncation.
2. **`fleet.test.mjs`: `the host is asked once per absent branch, and never for a present ref`** fails with `ENOENT` on its own `calls.txt` — it makes **zero** `pr-state` calls on this machine, on main. This is why my two call-count tests assert on the **marker** instead: a count assertion would pin a fixture broken before this branch.

## The question

The plan's rule is "the cost decides the fix", and the cost named is gone. But the Done-when is written as a wall-time share, and 28.0% is not "at least about half".

**I have not deferred the slice and will not** — the brief reserves `deferred:` for a person. The work is committed and pushed (`b5ee10d01`), tests pass, gates are green, and it is ready to open as a PR on a word from you.

- **If the mechanism is the test:** the slice is done. 26 → 0 calls, correctness verified, 14 stale verdicts repaired as a bonus.
- **If the 54-61% wall figure stands:** the remaining cost is elsewhere and the brief already names the candidate it told me not to touch — `plan_meta_index_of` (`plot-fleet-scan.sh:2937-2938`), 294 s of ~3550 s in slice 1's traced run, the largest shell line by a wide margin. That is a second slice, not this one.

Delete this file once answered.
