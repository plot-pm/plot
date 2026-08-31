---
'plot': patch
---

The worker's hop asks the scan offline, so an unreachable host cannot silently end a long-running agent.

This branch makes a **failed** host mark every unmerged branch `unknown` rather
than `open`, and `--next` deliberately does not hand out an `unknown` branch —
*"nobody has started this"* is exactly the claim that went unverified. That rule
is right and is unchanged.

But `plot-worker-loop.sh` asked `--next` **without** `--offline`. So wherever
`gh` exists and cannot answer — an unauthenticated CI runner, a rate limit, a
token that expires mid-run — every branch read `unknown`, the hop found nothing
claimable, and the worker stopped after one slice **without saying why**.

Measured 2026-08-31 with a stub `gh` that exits 3: `worker-hops.test.mjs` failed
2 of 3 on this branch and passed 3/3 on `main`. With `--offline`, 3/3 both with
a working host and without one.

**The trade is real and is accepted deliberately.** The hop now claims on git
alone, which is the inference this scan tightened, applied one level down. Two
things bound it: `--offline` means *the question was never put* rather than *the
answer was refused* — the distinction this branch itself draws — and the claim
is still settled by the ref push, which is rejected if the branch already
exists. A silently stalled agent is the worse failure, because nothing reports
it.

<!--
bumps:
  skills:
    plot: patch
-->
