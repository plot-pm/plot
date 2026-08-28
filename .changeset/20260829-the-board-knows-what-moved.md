---
'@plot-pm/board': patch
---

Three signals that say whether an expensive answer can still be trusted.

A `--json --offline` scan spawns **127 git processes** (re-traced 2026-08-28)
and the board runs one every 5 seconds — roughly 45,000 launches an hour. The
shape is `branches + plans + worktrees + ~30`: three per-item loops over the
three things that grow, and only the constant term is bounded.

These are the cheap facts that establish *cannot have changed*: all ref SHAs,
all plan mtimes, the worktree list. **Two processes and a directory read for the
whole set** — 275 refs in 0.007 s, measured.

Nothing consumes them yet; the monitors that do are the next wave. Nothing is
written to disk either, so a restarted board re-derives everything on its first
pulse — the rule `PLOT_TERMINAL_CACHE` already follows: *a cache checked against
a cheap fact every pass is a derivation; one that is trusted is a record.*

**The ref signal reads `refs/remotes` as well as `refs/heads`**, and that is
load-bearing rather than thorough: the counts it guards read
`refs/remotes/origin/<main>..refs/heads/<branch>`, and the scan fetches every
pulse — so a heads-only signal would report *unchanged* while every ahead-count
in the estate had silently gone stale.
