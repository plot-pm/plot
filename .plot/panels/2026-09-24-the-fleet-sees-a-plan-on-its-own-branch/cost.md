# Cost lens — the fleet sees a plan on its own branch

Position: amend

The fix is cheap. The plan's cost section is not honest about it — every number in it is wrong in the direction that makes the fix sound expensive, and the narrowing it offers as the fallback is the wrong lever. Amend the cost section to the measured numbers and name the batched shape; do not amend the fix itself.

## 1. The scan is not 18.3 s. It is 50 s.

Two runs, `time skills/plot/scripts/plot-fleet-scan.sh --json > /dev/null`, this machine, 2026-09-24:

| run | wall | user | sys | CPU |
|---|---|---|---|---|
| 1 | **50.92 s** | 5.00 s | 4.45 s | 18% |
| 2 | **49.98 s** | 4.94 s | 4.38 s | 18% |

The plan's 18.3 s is stale by a factor of **2.7**. It is a quoted figure from the script's own `--stream` rationale, not a measurement the plan took.

This cuts against the plan, not for it: the scan is already three times worse than the plan believes, so "do not make it worse" carries more weight — and that makes getting the added cost right *more* important, not less.

## 2. The 18% CPU figure says the cost is not git.

Wall 50 s, CPU 9.4 s total (user+sys), **18% utilisation**. Roughly **41 s of the 50 is the process waiting**, not computing. `plot-host.sh pr-list` alone measures **1.33 s**, so the host round trip is not the whole of it either. The plan's claim that "git alone is 12.7 s" is a quote from an older estate and is not reproduced here.

The plan's own framing — *"adding a `ls-tree` per branch multiplies the git work by the branch count"* — is therefore misdirected. Git work is a minority of a scan that is 82% idle.

## 3. The branch count is 15, not 54. The candidate population is 3.

```
git branch -r | wc -l        →  15    (includes 10 `fork/*` refs and 2 HEADs)
git for-each-ref refs/remotes/origin, minus main and HEAD  →  3
```

The three candidates:
- `bug/the-index-is-read-once`
- `feature/one-monitor-watches-the-slice`
- `feature/the-domain-knows-a-round`

The plan says "54 here". That was true of an older estate. **The fix walks 3 branches on this repository today.**

Plan files on the default branch: **729** paths under `docs/plans/` (`git ls-tree -r origin/main docs/plans/`), 333 at the top level.

## 4. The added work, measured directly.

`git ls-tree -r --name-only <ref> docs/plans/` over every remote ref, five alternating trials:

| trial | 15× separate `ls-tree` | 1× batched `cat-file --batch-check` |
|---|---|---|
| 1 | 518 ms (cold) | 25 ms |
| 2 | 104 ms | 25 ms |
| 3 | 108 ms | 26 ms |
| 4 | 101 ms | 25 ms |
| 5 | 101 ms | 26 ms |

Warm median: **~102 ms for 15 refs the naive way, ~25 ms batched.**

Scaled to the plan's own worst case, 54 branches: `for i in $(seq 54); do git ls-tree -r origin/main docs/plans/; done` → **0.271 s**.

Cost of one `git show` of a plan blob: **~5 ms** (20 iterations in 0.103 s).

Novel plan files per ref (what would actually be `git show`n after the `onDefault` dedup): 0–3 per branch, **0 for all three `origin/*` candidates** on this estate.

**So: worst realistic added cost is 0.27 s on a 50 s scan — 0.5%. Real cost here is ~0.1 s, or 0.2%.** It is trivial. It is below the run-to-run variance of the scan itself (50.92 vs 49.98 = 0.94 s of noise, nine times the added cost).

## 5. The board pays this already, and its own comment prices it.

`board.ts:834` states the price the board accepted:

> *"Each `git` invocation costs ~55 ms of process spawn regardless of how little work it does, so reading eight branches' trees is ~0.5 s — on a path the client polls every few seconds."*

The board pays it and mitigates with a tip-SHA cache (`branchPlanCache`, `board.ts:846`), keyed on `branch@sha` so an unmoved fleet costs exactly one `for-each-ref`. **That cache is the precedent the plan should be copying alongside the dedup, and it does not mention it.** The scan already has `REMOTE_REFS` from a single `for-each-ref` carrying `%(objectname)` — the cache key is already in hand, free.

I could not measure `/api/board` against `/api/fleet` directly: no board is listening for this checkout (probed 3000/4000/4173/4317/5173/8080 and the `lsof` node listeners; none answers `/api/board`). The board's own committed measurement stands in for it, and it is the plan's own cited source.

## 6. The offered narrowing is the wrong lever.

The plan's fallback is *"narrow to branches with no PR"*. Measured on the scan output: 22 branches named by plans, states `{open: 17, deferred: 2, merged: 3}`. The narrowing would drop at most 5 of 22 — **a 23% reduction on a cost that is already 0.2% of the scan.** It buys nothing, and it costs correctness: a same-branch plan whose branch later gets a PR would flicker out of the fleet view.

Worse, it is offered as insurance against a cost the plan never measured. An unmeasured fallback against an unmeasured cost is two guesses stacked.

## 7. The cheaper shape the plan misses — and the estate already uses it.

The plan proposes "an `ls-tree` per branch", copying the board's per-branch loop. The scan does **not** work that way for the equivalent question it already answers. `plot-fleet-scan.sh:2496-2510` documents the exact optimisation, in its own words:

> *"`ref_plan_file` asked `git ls-tree` once per plan for a single field: the file MODE … Profiled 2026-08-20 that was 69 spawns of the scan's 459 … `ls-tree -r` over the plan directories answers for every path at once: 134 entries in 512 ms here, against 69 separate spawns at 31-56 ms of launch overhead EACH."*

And `plot-commit-record.sh:93` is the `cat-file --batch-check` precedent the brief names.

I verified the batched shape works for this question:

```sh
while IFS= read -r r; do printf '%s:docs/plans\n' "$r"; done < refs \
  | git cat-file --batch-check
```

→ **25 ms for all 15 refs, one process**, against 102 ms for 15 spawns. A `git cat-file --batch` over the same input returns 111,687 bytes of tree content in **58 ms**, so both the path listing and the blob read are reachable in one process each.

**The scan's own file argues against the shape the plan proposes, four hundred lines above where the change lands.** A slice that copies the board's per-branch loop into this script re-introduces the spawn pattern the script already removed once and wrote a paragraph about.

## 8. What to amend

1. **Replace the cost paragraph with measured numbers**: scan 50 s (not 18.3 s), 18% CPU, 15 remote refs / 3 candidates (not 54), added cost 0.1–0.27 s = 0.2–0.5%.
2. **Name the batched shape as the implementation**, not the per-branch loop — `cat-file --batch-check` over `<ref>:<planDir>`, one process, per `plot-fleet-scan.sh:2496` and `plot-commit-record.sh:93`. The plan says *"what transfers is the rule, not the call"*; the batched shape is precisely that distinction honoured.
3. **Copy the tip-SHA cache alongside the `onDefault`/`seen` dedup.** `REMOTE_REFS` already carries `%(objectname)`; the key is free.
4. **Drop the PR-less narrowing.** It removes 5 of 22 branches from a 0.2% cost and introduces a correctness flicker. Delete the fallback rather than leaving an unmeasured escape hatch in an approved plan.
5. **Keep "measure before and after in the commit message."** That instruction is right and is the one part of the cost section that survives. Keep it and add: measure at least twice, because run-to-run variance here is 0.94 s — nine times the change being measured, so a single before/after pair cannot see this fix at all.

## The honest summary

The fix is essentially free. The plan's handling of the cost is **not** honest — not because it hides a cost, but because it invents one: three stale figures (18.3 s, 12.7 s, 54 branches) presented as measurements, a fallback sized against them, and no mention of the batched shape the same file already documents. Proceed with the fix, amend the argument.
