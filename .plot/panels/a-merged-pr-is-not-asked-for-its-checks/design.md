# Design lens — a merged PR is not asked for its checks

Position: amend
Evidence: executed

## Summary

The premise is TRUE and I measured it larger than the plan claims. The direction is right: no consumer on this estate reads `checks` on a non-open PR, and the layering is untouched. But the slice as written — *"merge the two lists by PR number"* — **silently destroys the rollup for every open PR**, the existing tests cannot detect it, and the plan's own `pr_reliable` safeguard is written against a failure mode the GitHub arm does not have while missing the one it does. Three amendments below; all are small, and none changes the shape of the split.

## The premise holds, and by more than the plan says

Measured 2026-09-25 on this estate, by me, through `plot-host.sh`:

| call | rows | wall |
|---|---|---|
| `pr-list --state all --limit 1000 --rich` | 957 | **31.7 s** |
| `pr-list --state all --limit 1000` | 957 | 6.8 s |
| `pr-list --state open --limit 1000 --rich` | **3** | 2.5 s |

The plan recorded 20.8 s; I measured 31.7 s, so the saving is larger, not smaller. 3 of 957 rows carry an answer that can still move. The premise is not in dispute.

## Is a merged PR's rollup ever needed? No — verified, not assumed

I traced every reader of `checks` and `draft`.

**The scan.** `plot-fleet-scan.sh:2141` is the whole story:

```
  # Must be OPEN (not MERGED/CLOSED/NONE), green, and not a draft.
  [ "$st" = "OPEN" ] || return 1
  if [ "$chk" != "green" ]; then
```

`pr_ready` tests `st = OPEN` **before** it ever reads `chk`. A merged row's `checks` is unreachable by construction. `host_pr_state` (`:1028`) returns only the STATE field. Nothing else in the scan reads slots 2 and 3 of the cache line. So on the scan side: a merged PR losing `checks` changes **no verdict, no badge, no section, no footer count**.

**The board does not consume the scan's list at all** — and this is the finding that most reassures me. `packages/board/src/server/fleet.ts:2830` makes its **own, independent** call:

```ts
const args = ['pr-list', '--rich', '--state', 'all', '--limit', String(PR_LIMIT)];
```

That call is **out of this plan's scope and must stay so.** The board needs `checks` on merged rows — `storeRow` (`:2534`) persists `checks` for every state into the PR index, deliberately: *"the store holds what the adapter said about every PR … keyed by number so a merged PR is stored exactly as an open one is"* (`:2886`). Narrowing the board's call would break that store. The plan never proposes to, and the Done-when correctly names only `plot-fleet-scan.sh:747`. Good — but the plan should **say** that `fleet.ts:2830` is deliberately untouched, because a later reader optimising "the same call" would break the store. That is amendment 3.

I did look for a consumer reading checks on a non-open PR, since one would refute the plan outright:

- `refreshRuns` (`fleet.ts:2200`) filters `pr.checks === 'failing'` across **all** states — but it reads the board's own list, not the scan's, and `branchIsWatched` (`:2172`) drops `MERGED` immediately after. Not affected.
- `plot-impl-status.sh:170` asks `--state merged` with **no `--rich`** already. Not affected.
- `plot-open-pr.sh:138` and `plot-reconcile-scan.sh:473,503` ask without `--rich`. Not affected.
- Delivery reads `mergedAt` via `plot-pr-merged.sh`, never a rollup. Not affected.

**No refuting consumer exists.** The plan's central claim survives the search.

## AMENDMENT 1 (blocking) — "merge the two lists by PR number" loses every rollup

This is the defect, and it is not hypothetical. I ran the scan's own parse pipeline over the two real payloads.

The cache is built at `plot-fleet-scan.sh:893-917` by a rank-and-dedup: rank `1` for OPEN, `2` for MERGED, `3` otherwise; `sort -k5,5 -k1,1` by branch then rank; the loop at `:877` keeps the **first** row per branch and skips the rest.

Under the split, an open PR appears **twice** — once rich from the `open` call, once plain from the `all` call. **Both are `state=OPEN`, so both get rank 1.** The sort key is exhausted and `sort` falls back to a whole-line compare, where the plain row's `-` sentinel (0x2D) sorts before any letter. The plain row always wins:

```
$ printf '1\tOPEN\t-\t-\tX\n1\tOPEN\tpending\tfalse\tX\n' | sort -t$'\t' -k5,5 -k1,1
1	OPEN	-	-	X
1	OPEN	pending	false	X
```

Executed against the live payloads, in **both** concatenation orders:

```
=== order A: open-rich FIRST, then all ===
OPEN	-	-	bug_the-readers-agree-about-an-item      <- kept
OPEN	pending	false	bug_the-readers-agree-about-an-item      <- discarded
=== order B: all FIRST, then open-rich ===
OPEN	-	-	bug_the-readers-agree-about-an-item      <- kept
OPEN	pending	false	bug_the-readers-agree-about-an-item      <- discarded
```

It is deterministic, order-independent, and always wrong. `[ "$chk" = "-" ] && chk=""` at `:885` then stores an empty rollup, which `pr_ready` (`:2148`) reads as *could not be established*, sets `_pr_ready_degraded`, and **refuses**. The outcome: `--loose` degrades to strict for **100% of open PRs** — the exact N+1-era behaviour that `:2098` says is *"finally gone WITHOUT A QUALIFIER"*, reinstated by the one call meant to make things cheaper. It fails safe (refuses rather than opens a wave on red CI), so it will not corrupt anything — but it silently deletes the feature the `--rich` flag exists for, and the banner at `:3938` would announce the degradation on every scan.

**What must change.** The slice must not say "merge by PR number" and leave the mechanism open. It must specify one of:

- **(a)** Exclude open rows from the `all` list before concatenating — `grep -v '"state":"OPEN"'` on the plain payload, so each branch contributes exactly one row. Simplest, and it makes the dedup a no-op rather than a coin flip. Note the `all` call's OPEN rows are then unused, which is fine and worth stating.
- **(b)** Extend the rank so a rich row outranks a plain one at equal state — e.g. rank OPEN-rich `0`, OPEN-plain `1`. Keeps both payloads whole; costs one more `sed` arm.

Either is a two-line change. **What must not happen is leaving it to the implementer**, because the failure is invisible: it is not a crash, not a wrong verdict, and not caught by any test (amendment 2).

## AMENDMENT 2 (blocking) — the contract tests cannot see this, and Done-when 5 asserts the wrong thing

Every `pr-list` shim in `test/reconcile/fleet.test.mjs` is **state-blind**. `:4350` and `:4620` are `case "$1" in pr-list) echo '…' ;;` — they never inspect `--state`, so under the split they return the **same rich rows for both calls**. I ran the dedup over doubled rich rows: both survive as `green`, and the tests pass.

So `fleet: --loose makes no per-branch host call with --rich cache` (`:4575`) and the failing/pending loose tests all stay **green against a build that has lost every rollup on real GitHub**. That is the worst available outcome: a contract suite certifying the behaviour it was written to protect while the behaviour is gone.

Done-when 5 says *"No behaviour change in what the scan reports … on a fixture with merged and open PRs both present."* A fixture is not enough — the current fixtures already have both, and they are state-blind. **The Done-when must require a STATE-AWARE stub**: one that returns rich rows only for `--state open` and plain rows only for `--state all`, exactly as GitHub does. Without that clause the plan's own acceptance criterion is satisfiable by a broken implementation.

Done-when 3 (*"a contract test asserts the `all` call does not request the rollup, and the `open` call does"*) is necessary and not sufficient — it asserts the call shapes, not that the rollup survives the merge. Both are needed.

## AMENDMENT 3 (should) — `pr_reliable` is guarded against the wrong arm, and the exit-7 clause is misplaced

The plan says: *"the `exit 7` partial path (`plot-host.sh:1003`) already carries that vocabulary."* I checked how 7 is actually produced, and the plan has this backwards for the host it measured on.

`PR_LIST_PARTIAL_RC=7` is returned **only** by `pr_list_states` (`:1016`), and `pr_list_states` is reached **only from the Bitbucket arm** (`:3766`, `:3791`, `:3797`). The GitHub arm calls `pr_list_call` directly (`:3656`, `:3690`), which dies via `pr_list_failed` — codes 3/5/6, never 7. `:611` states it outright: *"GitHub takes `--state all` in a single call and can never reach this shape."* So on the host where the 31.7 s was measured, **exit 7 is unreachable**, and the plan's safeguard guards a path that does not exist there.

What actually needs composing on GitHub is the ordinary non-zero case, across two calls. The scan's handler at `:747-836` sets `HOST_VERDICT` from **one** `rc` and **one** `host_err`. With two calls there are two of each, and the plan does not say how they combine. The rules that must be written down:

- **The verdict is the worse of the two.** `failed`/`throttled`/`secondary` from either call wins over `ok`. A rich call that is throttled while the plain one succeeds must not report `ok` — `checks` would be absent for every open PR and `--loose` would degrade with no banner explaining why.
- **`partial` composes too**: if either arm returns 7, the verdict is `partial` at best.
- **The `all` call alone governs `.list-arrived` and `.list-complete`.** This is the sharpest point and the plan does not mention it. `.list-complete` licenses deriving `NONE` from a cache miss (`:1053`), and is written when `0 < _pr_rows < PR_LIST_LIMIT` (`:986`). With a naive concatenation `_pr_rows` becomes 960 rather than 957 — harmless at this scale, and **not harmless in principle**: the count must remain a statement about the *repository-wide* list, or the completeness claim stops meaning what `:930-975` says it means. If the `open` call fails entirely while `all` succeeds, `.list-complete` should still be written — the `all` list is whole and `NONE` derivation is still licensed. If the `all` call fails, neither marker may be written regardless of the `open` call. The plan's *"`pr_reliable` degrades if either fails"* is too coarse: the verdict degrades on either, the completeness markers follow the `all` call only.
- **Bitbucket keeps the sweep contract.** `pr_sweep_report` (`:958`) prints *"pr-list sweep complete"* only when every state answered, and the scan matches that string at `:983`. Under the split the Bitbucket arm runs **two** sweeps; the marker may be written only if the `all` sweep printed the line. Matching the string from either call's stderr would let an `open`-only sweep license `NONE` over merged branches — which is `#333` reproduced. Worth one sentence in the plan.

Also add one line to *What this does NOT do*: **it does not touch `fleet.ts:2830`**, whose `--rich --state all` is required by the PR store.

## Is the split the right shape? Yes — I checked the alternatives

The prompt asks whether a better option exists. I do not think so, and the reasons are measurable:

- **Ask for checks only for branches the scan reports.** That is a per-branch host call — the N+1 that `#216`/`#228` removed and that `:2098` exists to keep removed. Strictly worse.
- **Cache merged rollups.** The plan's own answer is correct and I endorse it: *"This is not a cache and needs no invalidation."* A cache adds a store, a key, an eviction rule and a staleness question, to hold values that are already terminal. Partitioning by a fact the host reports is cheaper than caching in every dimension.
- **A separate cheaper checks call.** GitHub's rollup is free *within* the PR query (`:3614`, *"same GraphQL response, same call, no extra request"*); the 25 s is the rollup being resolved for 957 rows. Any separate call is an extra round trip for the 3 rows that matter. Worse.
- **Narrow by `--since` instead of by state.** The window machinery already exists (`plot-host.sh:3467`) and the board uses it. But it answers *"what changed recently"*, not *"what can still change"* — an open PR untouched for a week would fall out of the window and lose its rollup. State is the correct partition because it is the host's own terminality model. The plan picked right.

The split is the smallest change that uses a fact the host already reports, adds no state, and needs no invalidation.

## Layering

No violation, and no domain rule is owed. The scan is shell reading through `plot-host.sh`, which is the host connector — `check-host-cli-callers.sh` stays satisfied because no new CLI caller appears. Both calls use existing flags; no new op, no schema change, no adapter work, exactly as the plan says. Per `docs/shell-and-domain.md` the cost rule points the same way: this runs once per scan and the decision is *which two calls to make*, not a rule with a second implementation. Nothing here needs a corpus entry.

One narrower note: `checks-reading.ts` exists in the domain and is the rule about interpreting a rollup, not about which rows to fetch. Unaffected.

## What I would accept

Approve once the slice line names the dedup mechanism (amendment 1), Done-when requires a **state-aware** stub (amendment 2), and the `pr_reliable` clause is rewritten to say *verdict = worse of the two; completeness markers follow the `all` call only; Bitbucket's sweep line is matched from the `all` sweep only* (amendment 3). None of these changes the design — they write down the three things that decide whether the implementation is correct or silently hollow.
