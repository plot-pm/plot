---
"plot": minor
---

Close the drift loop: `/plot` hygiene line + `/plot-deliver` verification gate.

- **plot** (dispatcher) — step 1 now runs the reconcile scan and reads its one summary line; when findings exist, the Status Summary gains a single `⚠ N hygiene findings — run /plot-reconcile` line (nothing when clean). To make that ambient-cheap, `plot-plan-meta.sh` parses any number of plan files in one awk pass (measured: 3.4s → 0.6s on a 12-plan repo; the old per-file subprocess chain would have cost ~15s at 90 plans) and the scan parses each plan once, reusing the rows across sections.
- **plot-reconcile** — the report now ends with a machine-countable summary footer (`summary: drift=… merged_not_delivered=… stale=… attention=… concurrent=… pr_source=… main=…`); the dispatcher hygiene line and the Automation Output read it instead of parsing section bodies.
- **plot-deliver** — new step 7b: after the delivery push, re-run the reconcile scan and grep for the delivered plan's dated basename. A hit means the delivery half-landed (phase flipped but symlink not moved, or vice versa) — the finding and its fix surface immediately instead of weeks later. Supersedes the opt-in post-deliver nudge idea from #33: a targeted post-condition needs no config key and no prompt.

<!--
bumps:
  skills:
    plot: minor
    plot-deliver: minor
    plot-reconcile: patch
-->
