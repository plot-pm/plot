---
"plot": patch
---

The mechanical half of delivery moves into `plot-deliver.sh`, and `/plot-deliver`
calls it.

**Why this exists**: The board never writes a plan file. `approve.ts` writes only
state and prompt files and shells out to `plot-approve.sh`; the repo's rule is
*board writes wrap scripts, or they are licensed repairs — the board never invents
a lifecycle transition*. But `plot-deliver.sh` did not exist — the transition
lived only in `/plot-deliver`'s prose. So "the board delivers a plan" asked for a
caller with nothing safe to call, and an implementer would have rebuilt the phase
flip, the `Delivered:` record and the symlink move in TypeScript.

That is precisely the drift the `plot-approve.sh` split removed.

**This is the `plot-approve.sh` of delivery**: one implementation, two entrances.
`/plot-deliver` keeps the judgement — the completeness check, the
partial-deliverable question — and delegates the writes here. The board will call
this script directly (or via an agent when a `Deliver command` is set).

**It is idempotent**, like `plot-approve.sh`: the push is irreversible, so
re-running is the repair for an interruption, and every step tests the source it
would have written — never a progress file.

**What it refuses**:
- Phase is not `approved` — nothing to deliver
- Any non-deferred branch is unmerged — work is not done (one of Plot's four
  phase guardrails, moved from prose into an exit code)

**This wave changes NO behaviour** (`Done when` item 9 of the plan). `/plot-deliver`
delivers exactly what it delivered before, by the same rules; only the location
of the writes moves.

<!--
bumps:
  skills:
    plot-deliver: patch
    plot: patch
-->
