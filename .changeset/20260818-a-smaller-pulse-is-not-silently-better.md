---
"@plot-pm/board": patch
---

board: a successful scan that describes less says so

Rows vanished from the Agents tab and returned seconds later — including
WORKING rows for agents that were demonstrably running — with no error and
no staleness marker.

The cache already refuses to let a FAILED refresh overwrite a good result,
and the comment says why: replacing real state with emptiness because one
scan failed is what makes a monitoring view untrustworthy. That rule
carried an unstated assumption underneath it — *any success is
authoritative* — and it is false. A scan can exit 0, emit schema-valid
JSON, and describe fewer plans than the scan before it. Measured in a
sandbox 2026-08-18: `origin/main` genuinely carried three plans, the scan
reported two, because it enumerates the working tree rather than the ref it
names. Nothing treated the smaller answer as suspicious, so it was cached,
rendered, and replaced by the next full one.

`pulseShrink` now compares each incoming pulse against the cached one
before it is accepted, and a loss rides beside the pulse as `shrink` — a
field distinct from `error`, because the two are opposites in the way that
matters: `error` means the scan failed and its result was discarded, this
means the scan SUCCEEDED and its result was kept. The tab marks the view
instead of swapping it without comment.

The smaller pulse is deliberately ACCEPTED rather than rejected. Plans
really do get delivered, and a monitoring view that cannot shrink keeps a
dead row forever — a different kind of lie. *Degrade, do not hide*, the
rule the bridge already follows for staleness.

Two details are load-bearing:

- **Identities, not counts.** "3 plans became 2" cannot tell an operator
  whether the plan that vanished is one they just delivered or one another
  agent pushed a minute ago. Counts also miss a shape the set difference
  catches: one plan arriving as another leaves nets to zero, so a count
  comparison passes it in silence while a row really did vanish.
- **Branches are compared even when their plan survives.** A plan that keeps
  its file but loses a wave's branches produces no plan-level difference at
  all — and that is precisely the reported symptom.

This is the symptom fix, and it is valuable on its own: the cause — the scan
globbing the working tree instead of the ref it claims to read — is a
separate branch against `plot-fleet-scan.sh` and is untouched here.

<!--
bumps:
  skills:
    plot: patch
-->
