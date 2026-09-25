# A merged PR is not asked for its checks

> One `pr-list` asks GitHub for `statusCheckRollup` on 957 pull requests. 954 of them are merged or closed, and a merged PR's checks cannot change. Measured 2026-09-25: **20.8 s with the rollup, 0.6 s asking only the 3 open ones** — a third of a 54-second scan spent re-fetching CI results that were settled weeks ago.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Sprint:** plot-works-in-the-repos-that-adopt-it
- **Rounds:** 1

## Changelog

- The fleet scan asks the host for check state on **open** pull requests only. A merged or closed PR's rollup is not requested, because it cannot change. Measured on this estate: one `pr-list` fell from 20.8 s to 0.6 s, and the whole scan from ~54 s to ~33 s.

Board impact: **yes, and it is the reason.** The board re-runs this scan on a 4-second fleet cadence against a call that takes 20 s, so polls overlap and queue. Two boards wedged on 2026-09-25 under exactly that backlog — `/` answered in 3 ms while `/api/board` timed out, with 48 children and 20 git subprocesses piled behind one node.

## Motivation

**The scan pays full price to re-derive terminal state.** Measured 2026-09-25 on this estate:

```
gh pr list --state all --limit 1000 --json …,statusCheckRollup   20.8 s
gh pr list --state all --limit 1000 --json … (no rollup)          5.1 s
gh pr list --state open --limit 100  --json …,statusCheckRollup   0.6 s
```

The population explains it:

| state | count | can its checks change? |
|---|---|---|
| MERGED | 920 | no |
| CLOSED | 34 | no |
| **OPEN** | **3** | **yes** |

**957 PRs are asked; 3 have an answer that is not already final.**

**This is not a cache and needs no invalidation.** A merged PR is terminal by the host's own model, the way a Released plan is terminal by Plot's. Nothing has to notice a change, because there is no change to notice.

### Where the time goes, measured rather than assumed

A sampling profile of one scan, 60 samples at 0.7 s:

| component | cost | share |
|---|---|---|
| `pr-list` with `statusCheckRollup` | **20.8 s** | 38% |
| plan parsing, 333 files × 44 ms | 13.3 s | 25% |
| `pr-list` without the rollup | 5.1 s | 9% |
| git — **81 invocations** × ~30 ms | **2.4 s** | **5%** |
| unattributed | ~12 s | 22% |

**Git is 5%, and that is the finding this plan exists to protect.** 23 git subprocesses are visible in `ps` during a scan and the rollup is not, so the obvious optimisation is the wrong one. `plot-fleet-scan.sh` already records the precedent: pruning 70% of worktrees changed nothing, because the cost was never there. Fork overhead here is **5 ms** and the heaviest single git call is **32 ms**.

## Design

### The change

`plot-fleet-scan.sh:747` asks for `--state all … --rich`. `--rich` is what adds `checks` to the response (`:716`). The rollup is requested for every state because the flag is per-call, not per-row.

**Split the call by what the answer can still be:**

- `--state open --rich` — the 3 PRs whose checks are live
- `--state all` without `--rich` — everything else, for `number`, `headRefName`, `state`, `mergedAt`

Both are already `plot-host.sh pr-list` invocations with existing flags. **No new host operation, no schema change, no adapter work.**

### What must not change

- **`--limit` stays 1000 on the `all` call.** `plot-fleet-scan.sh:615` records why: without it the host returns 30, and a truncated list reads as *branch has no PR*.
- **A merged PR still reports `mergedAt`.** That is the one answer delivery depends on and it comes from the non-rich call.
- **`pr_reliable` still gates.** Two calls mean two failure modes; a partial answer must degrade the verdict exactly as one call does today, and the `exit 7` partial path (`plot-host.sh:1003`) already carries that vocabulary.
- **The empty-`TRACKED_BRANCHES` rule holds.** `:743` — an empty set passes nothing and lists as before.

### What this does NOT do

- It does not cache anything, index anything, or add a queue.
- It does not touch plan parsing — that is the second finding and its own slice.
- It does not reduce git subprocesses, because git is 5% and the measurement says leave it alone.
- It does not change what the board renders.

### Open questions

- [ ] **What is the unattributed ~12 s?** Sampling put 240 of 60×N samples in `bash` itself. Worth profiling before anyone proposes a third optimisation.

## Done when

- The scan requests `statusCheckRollup` for open pull requests only, and a merged PR's row still carries `mergedAt`, `state` and `headRefName`.
- One scan on this estate is measured **before and after**, and the `pr-list` component falls from ~20 s to ~1 s.
- A contract test asserts the `all` call does not request the rollup, and the `open` call does.
- **A STATE-AWARE stub**, returning rich rows only for `--state open` and plain rows only for `--state all`. Today's shims ignore `--state` entirely (`test/reconcile/fleet.test.mjs:4350,4620`), so they answer rich rows to both calls and would certify a build that had lost every rollup. Without this clause the acceptance criterion is satisfiable by a broken implementation.
- **An open PR still carries its rollup after the merge** — asserted on the parsed cache line, not on the call shape. This is the failure the dedup produces and no existing test can see.
- `HOST_VERDICT` is the worse of the two results, with a test per arm. **Exit 7 is not the path to guard on GitHub** — `pr_list_states` is reached only from the Bitbucket arm (`plot-host.sh:3766`), and `:611` says GitHub *"can never reach this shape"*; what must compose is the ordinary non-zero case across two calls.
- **No behaviour change in what the scan reports** — the same branches, the same verdicts, the same footer counts.

## Slices

### The rollup is asked of open PRs only (Branch: bug/the-rollup-is-asked-of-open-prs-only)

- `bug/the-rollup-is-asked-of-open-prs-only` — split `plot-fleet-scan.sh:747` into a `--state open --rich` call and a `--state all` call without `--rich`. **Exclude OPEN rows from the plain payload before concatenating**, so each branch contributes exactly one row and the rank-and-dedup at `:877-917` is a no-op rather than a coin flip — the plain row's `-` sentinel otherwise wins at equal rank and deletes every rollup. Keep `--limit` and the `--branch` arguments on the `all` call. `HOST_VERDICT` is **the worse of the two** results, not the last one. Contract tests driven by a **state-aware** stub: rich rows for `--state open`, plain rows for `--state all`, as GitHub answers

## Notes

- **Panelled 2026-09-25: `amend` (design lens, `Evidence: executed`).** The premise verified LARGER than drafted — the juror measured **31.7 s** for the rich call against the plan's 20.8 s, 6.8 s plain, 2.5 s open-rich — and it traced every reader of `checks` and `draft` to confirm no consumer reads a rollup on a non-open PR. Three amendments, two blocking, all folded in above: the dedup at `:877-917` ranks OPEN-rich and OPEN-plain identically, so `sort` falls back to a whole-line compare and the plain row's `-` wins deterministically in **both** concatenation orders, degrading `--loose` to strict for 100% of open PRs; the contract stubs are state-blind and would pass against exactly that build; and the `exit 7` safeguard guards a Bitbucket-only path on the host the measurement came from. Verdict file: `.plot/panels/a-merged-pr-is-not-asked-for-its-checks/design.md`.
- **`packages/board/src/server/fleet.ts:2830` is deliberately out of scope.** The board makes its own `pr-list --rich --state all` call and its PR index stores `checks` for every state on purpose (`:2534`, `:2886`) — *"a merged PR is stored exactly as an open one is"*. Narrowing that call would break the store. A later reader optimising "the same call" must not touch it.

- Found while diagnosing two board outages on 2026-09-25. Both were self-starvation rather than crashes: the fleet cadence is 4 s (`App.tsx:30`) and the scan is 54 s, so polls overlap and each forks its own git pile. The board recovered on its own once the machine went quiet, which is the evidence that it was contention rather than a fault.
- **The operator's first instinct was to reduce git subprocesses, and the measurement refused it.** 81 invocations at 5 ms fork overhead is 2.4 s of 54. The same conversation proposed reading local refs instead of `origin/*` — which saves nothing and breaks correctness, since the scan derives from `origin/<branch>` precisely so an agent's pushed work on another machine is visible.
- **The plan-parsing finding is real and separate**: 333 plans, of which 296 Released, 13 Rejected, 8 Superseded, 12 Delivered and **3 Approved**. 95% are terminal. It needs its own plan, and the partition is on the `State:` line rather than on a checksum, because a terminal plan needs no change detection at all.
