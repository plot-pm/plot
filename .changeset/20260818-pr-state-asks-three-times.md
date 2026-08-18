---
"plot": patch
---

plot-host: `pr-state` stops asking once a state has answered

Resolving one branch to one PR walked all three Bitbucket states
unconditionally. The ordering already decides the winner — open outranks
merged outranks declined, and the filter takes the first match — so the
later calls could never change the answer. They were pure cost.

The cost was not small. Measured against a real Bitbucket on 2026-08-18:
one `bb pr list` call takes ~10s, so every branch lookup cost 25.7s. The
board's fleet scan calls `pr-state` once per branch and exceeded its own
timeout on a five-branch plan, rendering `Last scan failed` with no
indication that nothing was broken — it was merely slow.

Same lookup after the fix: **1.8s**. The full `--json` scan over 14
branches across 2 plans: **12s**, where it previously did not finish.

A declined-only branch, or one with no PR at all, still pays for all
three calls — those are the cases where the last call carries the answer.

<!--
bumps:
  skills:
-->

No skill version bumps: `plot-host.sh` is called by skills but documented
by none, and no skill's behaviour changed — only how long it waits.
