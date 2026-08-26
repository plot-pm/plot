# A reaped worktree takes its manifest

> `plot-reap.sh` removes the checkout and leaves the registry entry, so every
> reap converts a finished agent into an `unknown` row nobody can drop.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** the-board-serves-an-enterprise-stack
- **Story:** the-board-is-blank-where-it-matters
- **Review:** in-session
- **Impl:** own branches
- **Approved:** <!-- YYYY-MM-DD, who, channel -->
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

- Reaping a worktree removes its registry manifest too, so a finished agent
  leaves the board instead of becoming an unverifiable row.

## Motivation

### Measured 2026-08-26

`plot-reap.sh --yes` removed 12 finished worktrees. Immediately afterwards the
board showed **seven agents reading `unknown`**, with sessions of 1h to 6h, each
naming a directory that no longer exists:

```
AGENT  cb540f12  plot-wt-feature-jira-issues-reach-the-inbox   unknown  1h
AGENT  b833775c  plot-wt-feature-setup-proposes-what-it-found  unknown  3h
AGENT  b1fc55ac  plot-wt-feature-a-jenkins-build-has-a-status  unknown  3h
… four more
```

Every one says `merged`. Counted directly: **9 manifests, 7 of them pointing at
a worktree that is gone** — exactly the seven rows.

**`plot-reap.sh` contains zero references to the registry.** Measured:

```
$ grep -c "manifest\|\.plot/agents\|registry" skills/plot/scripts/plot-reap.sh
0
```

It removes checkouts, which is what it documents. Nothing removes what the
checkout was registered as.

### The row cannot be cleared either

The board offers *Drop this agent*, and it refuses:

> cannot drop an entry whose state could not be verified — check the worktree
> manually

That refusal is **correct in general**: dropping an entry whose state is unknown
could discard a live worker's record. It has no case for *the worktree is gone,
so it will never be verifiable again*, and the advice it gives — check the
worktree manually — names a directory that does not exist.

So the estate accumulates rows that cannot be measured and cannot be dismissed,
one per reap, permanently.

### It is the inverse of a trap this repo already knows

`readAgentRegistry` **synthesizes** an entry for every non-main worktree without
a manifest — so *deleting a manifest creates a row*. Recorded after it was
learned the hard way: thirteen manifests were trashed to clear unknown rows and
thirteen synthesized rows appeared in their place.

This is the mirror image: **a manifest outliving its worktree** produces a row
that cannot be verified. Both directions produce `unknown`; neither is fixed by
touching the registry by hand, which is why the fix belongs in the reaper.

## Design

### The reaper owns both, because it owns the removal

`plot-reap.sh` already establishes the five measurements that license a removal —
no live pid, no uncommitted changes, no `PLOT-BLOCKED*`, not on the default
branch, a merged PR. **An entry whose worktree it is about to remove is covered
by exactly those measurements.** Nothing further needs deciding, which is what
makes this the reaper's job rather than a judgement call elsewhere.

Remove the manifest in the same operation, after the worktree removal succeeds.

### Order matters: worktree first, manifest second

If the manifest goes first and the worktree removal then refuses, the estate is
left with a live worktree and no registration — which `readAgentRegistry`
answers by **synthesizing an `unknown` entry**, trading one bad row for another.

Removing the worktree first means a failure between the two steps leaves an
orphaned manifest: the state this plan already fixes, and the recoverable one.

### The seven that exist now

They are the measurement, and they should be cleared by the fix rather than by
hand — a reaper that cleans up after itself must also be able to clean up after
the version that did not. A sweep for manifests whose `worktree` path is absent
is the same predicate, applied to what is already there.

**Do not clear them by deleting files.** The registry is not a directory to tidy;
`.plot/agents` in `tiny-garden` is a tracked fixture, and hand-deletion is how
the synthesized-row trap was discovered.

### Why the guard fired when there was nothing to guard

The mechanism, at `drop.ts:110`:

```ts
function classifyState(entry, liveness) {
  if (!entry.worktree) return 'unknown';   // manifest records NO path
  if (!liveness) return 'unknown';
  try {
    const [answer] = liveness([entry.worktree]);
    if (answer === 'running' || answer === 'finished'
     || answer === 'waiting' || answer === 'stalled') return answer;
  } catch {
    // Liveness check failed — cannot verify, cannot drop.
  }
  return 'unknown';
}
```

It probes a path that no longer exists, gets an answer outside the four it
accepts, and falls through to `unknown`.

**It never asks whether the worktree exists.** There is a check for
`!entry.worktree` — the manifest recording no path at all — and none for the
path being recorded and ABSENT. `fs.existsSync(entry.worktree)` is one line, and
it is not there.

So three unlike situations collapse into one word:

| situation | means | `classifyState` |
|---|---|---|
| probe says nothing recognisable | cannot check | `unknown` |
| liveness resolver missing | cannot check | `unknown` |
| **worktree deleted** | **definitely nothing running** | `unknown` |

Only the first two mean *might be alive*. The `catch` comment states the
conflation outright — *"cannot verify, cannot drop"* — and for a deleted
worktree *cannot verify* and *might be running* are opposites.

**The information was available and unconsulted.** That is a different defect
from misjudging evidence: the guard did not weigh the worktree's absence and
decide wrongly; it never looked.

### The guard is independently wrong, and that is a SECOND fix

An earlier draft rejected touching *Drop this agent* — "fix the producer, not the
guard." That was too quick, and a reader asked the question that undoes it:
**the worktrees were already gone.**

`drop.ts:198` reasons: *I cannot determine this agent's state, so it might be
alive, so refuse.* But the reason it could not determine the state is that the
worktree **had been deleted**. A missing worktree is not ambiguity — it is the
most conclusive evidence available that nothing is running there. The guard
treated the strongest possible proof of *dead* as though it were *unmeasurable*.

It even has the precedent one step earlier. Step 1 returns `dropped: true` for
*"no manifest found — already removed or never existed"* — the route already
accepts *nothing is there* as a valid drop. It checks for a missing MANIFEST and
never for a missing WORKTREE.

Compare `plot-reap.sh`, which gets this right: it refuses on **measurements** —
a live pid, uncommitted changes, a marker file. `drop.ts` refuses on the
**absence** of a measurement, without asking why it is absent.

So there are two defects, not one, and either alone leaves a hole:

| | fix |
|---|---|
| the reaper strands manifests | remove the manifest with the worktree |
| the guard cannot clear a stranded one | a GONE worktree is droppable, not unknown |

Fixing only the reaper leaves every manifest stranded by any other means —
a hand-removed worktree, a pruned checkout, a moved root — permanently
undroppable. Fixing only the guard leaves the reaper producing rows a person
must then clear by hand.

**The refusal narrows; it does not disappear.** `unknown` with a worktree that
EXISTS still refuses, and must: that is the live-worker case the guard was
written for.

### Not chosen: have the board sweep orphans on every pulse

The scan is already the board's slowest operation. A registry sweep per pulse
adds work to the hot path to correct a state that only the reaper creates.

## Waves

### Cleared (Branch: bug/a-reaped-worktree-takes-its-manifest)

`plot-reap.sh` removes a reaped worktree's manifest after the worktree, and
clears manifests whose worktree is already absent.

## Done when

1. **Reaping a worktree removes its manifest**, and the board shows no row for
   it afterwards. Asserted end-to-end, because the defect is only visible once
   the registry is read.
2. **A manifest whose worktree is already gone is cleared** by the same run.
   The seven measured today are that population.
3. **A refused reap leaves the manifest alone.** The five refusals are unchanged,
   and a worktree that stays must keep its registration — otherwise the entry is
   synthesized back as `unknown` and the fix has produced the bug.
4. **The worktree is removed BEFORE the manifest.** Asserted by making the
   worktree removal fail: the manifest must survive. Reversing the order leaves a
   live worktree unregistered, which synthesizes an `unknown` row.
5. **A drop on an entry whose worktree is GONE succeeds.** Measured today:
   seven such rows refused, advising the reader to "check the worktree
   manually" — a directory that did not exist.
5b. **`Drop this agent` still refuses `unknown` where the worktree EXISTS.**
   That is the live-worker case the guard was written for, and this plan
   narrows the refusal rather than removing it. Asserted both ways, because a
   fix that drops every `unknown` passes item 5 and discards a running agent's
   record.
6. `pnpm run validate`, `pnpm run test:reconcile` green.

## Notes

### The reap was right; the accounting was not

Twelve worktrees were removed and all twelve were genuinely finished — merged
PRs, no live pid, no uncommitted work. **The removal is not in question**, and
the worktree count fell 48 → 36 as intended.

What the reap did not do is tell the registry, and the registry is what the
board renders. So a correct cleanup produced seven wrong rows, and the estate
looked worse immediately after being tidied.

### The scan timeout was NOT fixed by this

Worth recording so the next reader does not repeat the inference: the reap was
run to relieve a 90 s scan timeout, and **the timeout persisted at 36 worktrees
exactly as at 48**. This repo has measured that before — pruning 70% of the
worktrees changed nothing, and 81% of scan time is outside git.

Worktree count is not the scan's binding constraint. **Measured immediately
after the reap, at 36 worktrees:**

```
plot-fleet-scan.sh --json    1:59.77 total    10.64s user + 12.61s system    19% cpu
```

Two minutes of wall clock against **23 seconds of CPU** — so roughly **97
seconds were spent WAITING**, not computing. The scan is I/O-bound, and reaping
worktrees reduces the part that was never the cost.

That is a separate investigation and does not belong to this plan.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {
      "q": "Why did seven agents read unknown right after a reap?",
      "a": "Their manifests outlived their worktrees — plot-reap.sh has zero references to the registry, so it removes checkouts and strands entries",
      "category": "technical"
    },
    {
      "q": "Should the board's Drop action be widened instead?",
      "a": "No — that puts a destructive escape on the guard protecting live workers, to work around a producer that should not have left the entry",
      "category": "tradeOffs"
    },
    {
      "q": "Which order?",
      "a": "Worktree first, manifest second — the reverse leaves a live worktree unregistered, which synthesizes an unknown row",
      "category": "technical"
    }
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": { "stack": false, "architecture": true, "implementation": true },
    "domain": true,
    "ux": { "happyPath": false, "edgeCases": true, "errors": true, "accessibility": false },
    "nonFunctional": { "security": false, "performance": false, "scalability": false },
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
