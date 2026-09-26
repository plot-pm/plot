PLOT-BLOCKED: Wave 1 (`infra/the-index-has-its-first-consumer`) has shipped nothing — no PR, no commits, no bundle. Wave 2's choice of consumer is specified to depend on wave 1's findings, which do not exist yet. Should I wait for wave 1, or do you want me to proceed on the brief's provisional recommendation and build the reader seam myself?

## What I verified (2026-09-26)

Every measured fact in my brief checks out. The blocker is only the dependency.

**Wave 1 is claimed and empty:**

```
git ls-remote origin refs/heads/infra/the-index-has-its-first-consumer
  c44ad03169a70852d679304ce0058409af6c8245     (claim ref only)
git log origin/main..origin/infra/the-index-has-its-first-consumer   → no commits
gh pr list --head infra/the-index-has-its-first-consumer --state all → no PR
```

- No bundle entry reads the store: `packages/board/src/server/entry/` holds `estate-fingerprint, prompt, propose-stack, slice-pr, sprint-score, sprint-transition` and nothing for the index.
- `plot-impl-status.sh` (wave 1's target) has **0** references to `pr-index` / `PLOT_PR_INDEX_HOME`.
- No shell script on main references the store at all.

**The domain half exists** — `packages/domain/src/{entities,rules,ports,adapters/pr-index}` with `decodePrIndex`, `foldPrIndex`, `PR_INDEX_VERSION = 2` — but nothing exposes it to a shell caller.

**The live store, re-measured, matches the brief exactly:** `v: 2`, 968 rows (932 `MERGED`, 34 `CLOSED`, 2 `OPEN`), `complete: false`, row keys `author, checks, draft, failing_checks, head, mergeable, number, review, state, updatedAt, url` — no `mergeCommit`, no `mergedAt`.

**The candidates' host sites are where the brief says:** reconcile `:473` (`pr-list --state open`), `:503` (`pr-list --state merged --limit 500`), `:3001` (`pr-state` per delivered plan, reads `.mergeCommit`), `:2860` (`issue-list`, out of scope).

**The brief's ratchet correction is right.** `plot-reconcile-scan.sh` appears in `scripts/check-script-names.sh` only in a comment (`:54`), not in the counted list; `plot-fleet-scan.sh` is counted at `:103` and already marked as having a port. `ALLOWED=9` and `allowed=28` are unaffected by either candidate, so the plan's ratchet Done-when line is unreachable from this slice.

## Why I am not proceeding on my own judgement

The plan defines this slice as *"The second consumer, **chosen after the first has shipped**... with the first slice's experience in hand."* My brief repeats the dependency three times: read wave 1's merged PR body first; *"this slice's choice of consumer depends on it"*; and its own recommendation is *"**subject to wave 1's findings**"*.

Two specific inputs are missing, and both change what I would build:

1. **Wave 1 was to answer whether a shell script can read the store without a running board** — the plan calls this the *"probably"* wave 1 replaces. If it cannot, the whole approach changes rather than the consumer choice.
2. **Whether wave 1 shipped a bundle that reads the store.** My brief says to call it if so, and my scope guard admits a new bundle *"only if wave 1 did not ship one that answers"*. Building one now risks a second, divergent seam that wave 1 then duplicates or contradicts — and wave 3 writes the rule from both consumers.

Two further open questions were handed to this slice expressly to be answered *with wave 1's evidence*: whether a falling-back script should **write** back into the store (the lost-update race), and whether to add `mergeCommit` to the row schema with a `PR_INDEX_VERSION` bump. Deciding either without wave 1 would settle for wave 1 the things wave 1 exists to measure.

Proceeding would mean inventing the evidence my choice is supposed to rest on, which is the failure this plan's own Notes warn about (the rejected predecessor, whose *"cost claims were wrong in every row"*).

## The options, as I see them

- **(a) Wait for wave 1.** Ordinary sequencing; costs a dispatch cycle. My preference.
- **(b) I build wave 1's seam as part of this branch** — the bundle entry plus `plot-impl-status.sh` — and then the second consumer. This widens scope into wave 1's files, which my scope guard names as *"Not this branch"*, so I will not do it unattended.
- **(c) I proceed on the provisional recommendation** (`plot-reconcile-scan.sh`, merged list first) and build the reader seam myself, recording that wave 1's findings were unavailable and that wave 1 must adopt this seam rather than add its own. Deliverable, but it decides wave 1's question by default.

Answer with (a), (b) or (c) — or name a different consumer — and delete this file. Nothing has been changed in the worktree; the branch holds only its claim commit.
