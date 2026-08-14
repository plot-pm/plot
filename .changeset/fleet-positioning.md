---
"plot": patch
---

Sharpen the fleet's positioning, and make clean pulses the default.

Re-checking the README against the two designs that shaped the fleet surfaced one real behavioural gap and two weak arguments.

**Clean pulses are now the norm.** The Lloyd pattern names "silent agent death" as a failure it prevents by logging every heartbeat, including the quiet ones. Plot had the capability behind `--log-pulse` and defaulted it *off*, so an idle fleet and a dead fleet still looked identical. `/plot-fleet` now passes the flag on every run.

The *script* still defaults to writing nothing, and that tension is worth naming: `/plot-implement` and `/plot-dispatch` call it internally to ask what to work on, and claiming a branch must never amend a plan as a side effect. So the default lives in the human-facing command rather than the script — both invariants hold, and a test now pins the script's silence.

**Two arguments were being undersold.** That every step is doable by hand — claiming is `git push`, isolating is `git worktree add` — is Plot's strongest distinction from tools that need an app or a database running, and it was only in the manifesto. And "no database" read as a missing feature rather than the point: an orchestrator needs one when its tickets have no home, whereas Plot's plans *are* the work table and its branches *are* the claims.

**New: a short comparison section**, naming Scape and the Lloyd pattern, what was taken from each, and what was deliberately left out (autonomous merging, agent-to-agent messaging, a general automation layer). Being explicit about the boundary is more useful than implying Plot competes on scale — it competes on how many agents can safely work one reviewed plan.
