## Implementation brief — a-merged-pr-is-not-asked-for-its-checks (The rollup is asked of open PRs only)

- **Plan (canonical):** `docs/plans/2026-09-25-a-merged-pr-is-not-asked-for-its-checks.md` on `main`
- **Approved:** 2026-09-25, in-session after two panel rounds
- **Branch:** `bug/the-rollup-is-asked-of-open-prs-only` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Issue:** none — found by profiling, not reported

**This is the plan's only slice. Nothing waits on it and it waits on nothing.**

### What to build

One `pr-list` asks GitHub for `statusCheckRollup` on **957** pull requests. **920 are merged, 34 closed, 3 open** — and a merged PR's checks cannot change. Measured through `plot-host.sh` as the scan actually calls it: **~37 s of a ~55 s scan**, about 70%.

The call is `plot-fleet-scan.sh:747`:

```bash
host_err=$("$script_dir/plot-host.sh" pr-list --state all --limit "$PR_LIST_LIMIT" --rich \
       ${_branch_args[@]+"${_branch_args[@]}"} \
       </dev/null 2>&1 >"$host_list_out"); rc=$?
```

Split it in two: **`--state open --rich`** for the PRs whose checks can still move, and **`--state all` without `--rich`** for everything else. Both are existing `plot-host.sh pr-list` invocations with existing flags — **no new host operation, no schema change, no adapter work.**

### THE TRAP, and it is the whole reason this brief is long

**Merging the two payloads naively deletes every rollup.** A panel juror measured it against the live data, in both concatenation orders.

The cache is built by a rank-and-dedup at `:877-917`: rank `1` for OPEN, `2` for MERGED, `3` otherwise, then `sort -t$'\t' -k5,5 -k1,1` by branch then rank, and the loop keeps the **first** row per branch.

Under a naive split an open PR appears twice — once rich from the `open` call, once plain from the `all` call. **Both are `state=OPEN`, so both rank 1.** The sort key is exhausted, `sort` falls back to a whole-line compare, and the plain row's `-` sentinel (0x2D) sorts before any letter:

```
$ printf '1\tOPEN\t-\t-\tX\n1\tOPEN\tpending\tfalse\tX\n' | sort -t$'\t' -k5,5 -k1,1
1   OPEN   -         -       X      ← kept
1   OPEN   pending   false   X      ← discarded
```

Deterministic, order-independent, always wrong. `:885` then stores an empty rollup, `pr_ready` (`:2148`) reads it as *could not be established*, sets `_pr_ready_degraded` and **refuses** — so `--loose` degrades to strict for **100% of open PRs**, which is the N+1-era behaviour `:2098` says is *"finally gone WITHOUT A QUALIFIER"*.

**So: exclude OPEN rows from the plain payload before concatenating.** Each branch then contributes exactly one row and the dedup is a no-op rather than a coin flip. The `all` call's OPEN rows are unused, which is fine and worth a comment.

### What must not change

- **`--limit` stays on the `all` call.** `:615` records why: without it the host returns 30, and a truncated list reads as *branch has no PR*.
- **The `--branch` arguments stay on the `all` call** (`:745-746`). `:743` — an empty set passes nothing and lists as before.
- **A merged PR still reports `mergedAt`.** Delivery depends on it and it comes from the non-rich call.
- **`HOST_VERDICT` is the WORSE of the two results**, not the last one. Two calls mean two `rc` values and two `host_err` strings where `:747-836` handles one. A rich call throttled while the plain one succeeds must not report `ok` — `checks` would be absent for every open PR and `--loose` would degrade with no banner saying why.
- **`exit 7` is NOT the path to guard on GitHub.** `pr_list_states` is reached only from the Bitbucket arm (`plot-host.sh:3766`), and `:611` says GitHub *"can never reach this shape"*. What must compose is the ordinary non-zero case across two calls.

### Delete one comment

`plot-fleet-scan.sh:716` justifies requesting the rollup unconditionally because *"the cost is zero on GitHub (same GraphQL call)"*. **Three independent measurements refute it.** That sentence is what let this ship; remove it and put the measurement in its place.

### Out of scope

- **`packages/board/src/server/fleet.ts:2830` is deliberately untouched.** The board makes its own `pr-list --rich --state all` call and its PR index stores `checks` for every state on purpose (`:2534`, `:2886`) — *"a merged PR is stored exactly as an open one is"*. Narrowing it would break the store.
- Plan parsing. The scan has batched since #486 and it costs ~0.5 s.
- Git subprocesses. ~63 calls, ~1.7 s, **3%** of the scan. The measurement says leave them alone.

### Done when

- The scan requests `statusCheckRollup` for open PRs only, and a merged PR's row still carries `mergedAt`, `state` and `headRefName`.
- **An open PR still carries its rollup after the merge** — asserted on the parsed cache line, not on the call shape. This is the failure the dedup produces and no existing test can see it.
- **Tests use a STATE-AWARE stub**: rich rows only for `--state open`, plain rows only for `--state all`, as GitHub answers. Today's shims (`test/reconcile/fleet.test.mjs:4350,4620`) ignore `--state` entirely and would certify a build that had lost every rollup.
- A contract test asserts the `all` call does not request the rollup and the `open` call does.
- `HOST_VERDICT` degrades on a failure of either call, with a test per arm.
- One scan measured **before and after**; the `pr-list` component falls from ~37 s to ~9 s.
- No behaviour change in what the scan reports — same branches, same verdicts, same footer counts.

### Repo gates

- `nvm use` first — Node 24. `pnpm` crashes on 26.
- `pnpm test`, `pnpm run test:contracts`.
- **Do not run `pnpm run test:e2e`** — that is CI's gate, not a local one.
- A changeset naming `plot`, description first and the `bumps:` block last.
