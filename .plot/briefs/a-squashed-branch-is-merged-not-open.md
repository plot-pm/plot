# Brief: bug/a-squashed-branch-is-merged-not-open

Implement `docs/plans/2026-08-18-a-squashed-branch-is-merged-not-open.md`.

Read it first. The diagnosis is measured: **do not re-derive it, do not widen
the scope.**

## The bug

Squash-merge a branch and delete it, and the fleet reports it as `open` — the
same word it uses for a branch nobody has started.

Two reasonable facts combine into a wrong answer:

1. **A branch's state comes from its ref**, and `--delete-branch` removes it.
   The script says so at line 558: *"an `open` branch has no ref"*.
2. **`pr-merge` detection walks merge commits, and a squash merge is not one.**
   Measured on the merge of PR #209:

   ```
   $ git log -1 --format="%h parents=%p %s" a263711
   a263711 parents=c3b2dda plot: board verification ... (#209)
   ```

   One parent — an ordinary commit. It names `#209`, not the branch. The
   exhaustive merge-commit walk has nothing to match.

The data is not missing. The host answers immediately:

```
$ plot-host.sh pr-state feature/plot-board-verify
{"number":209,"state":"MERGED","mergeCommit":"a263711..."}
```

## It is live right now, in two shapes

**A wave that never completes.** `2026-08-18-plot-board-setup` had both wave-1
branches merged (#208, #209) and still read `Scripts — eligible`, with `Skill`
blocked forever. A wave that cannot complete blocks its successor permanently —
the fan-out `/plot-dispatch` exists to perform cannot get past wave 1 under this
repo's own merge convention.

**Delivered work advertised as available.** The board shows
`bb-state-vocabulary` under NOT STARTED, `eligible — nobody has taken it`, while
its plan reads `Phase: Delivered`, PR #210 is `MERGED`, and the remote branch is
gone. "No ref" defaults to *start this* rather than *cannot tell* — the
reassuring direction.

That second one stops at the display: `plot-dispatch` refuses the same plan with
*"already delivered — its work is done"*. But only because a second, independent
check happens to cover it. The branch-state answer is wrong on its own terms.

## What to build

**When a branch has no ref, ask the host.** That is exactly the case where
`pr-state` is cheap and decisive: nothing local is left to read, and it costs one
call per absent branch — not per branch.

| `pr-state` says | Branch reads |
|---|---|
| `MERGED` | `merged` — the wave can complete |
| `OPEN` / `CLOSED` | its existing meaning |
| `NONE`, or the call fails | `open`, exactly as today |

**The last row is load-bearing.** `plot-host.sh` already distinguishes a lookup
miss from a transport failure. An unreachable host must never become a
fabricated `merged` — when the host cannot answer, the scan says what it says
today.

## Coordination — read this

`bug/pulse-names-the-ref-it-read` is in flight **right now** on the same file,
`plot-fleet-scan.sh`. It touches the banner and the `--json` ref fields around
lines 943 and 970. **Your change is merge detection, around lines 558 and 621** —
disjoint functions in the same file.

If it lands first you will need a rebase; that is expected and small. Do not
touch the banner or the `read_ref`/`local_head` fields.

## Definition of Done

- A sandbox test where a branch is squash-merged and its ref deleted must report
  `merged` and let its wave complete
- A sandbox test with an unreachable host must still report `open` — prove the
  failure direction, not just the happy path
- Consider caching the host answer within a single scan run: a plan whose
  branches were all squash-merged would otherwise make one call per branch on
  every run, and the board polls this every 5 s. The plan's Open Points raise
  this; if you solve it, say how.
- `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:e2e` pass — run the
  suites **one at a time**; concurrent runs were measured producing false
  timeout failures that do not reproduce serially
- A changeset with a `bumps:` block

## Out of scope

- The banner and JSON ref fields (sibling branch owns them)
- `packages/board/` — this is a scan fix; the board consumes what the scan says
- `/plot-deliver`'s landed check, which the plan's Open Points flag as possibly
  sharing this blindness. If you can answer that cheaply, **report it** rather
  than fixing it here.

## Platform note

CI runs Linux; you are probably on macOS. Two faults were caught this way today:
`stat -f` does not fail cleanly on GNU (it prints to stdout and *then* exits 1),
and `/usr/bin:/bin` is not an isolated PATH because CI ships a real `gh` there.

If you find something the plan did not anticipate, implement what you can and
**report the discovery** rather than improvising.
