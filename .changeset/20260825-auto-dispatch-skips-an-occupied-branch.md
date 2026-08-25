---
'@plot-pm/board': patch
---

Auto-dispatch stops spending its budget on a branch a dispatch cannot claim

Reported 2026-08-25: auto-dispatch was on, the wave was eligible, a slot was
free, and nothing started. The budget went, every pulse, to an already-claimed
`wip` branch of an earlier plan — `plot-dispatch.sh` refused the claim (its ref
already exists, so the push is non-fast-forward), so the dispatch changed no
state and the cycle repeated forever. Because plans iterate in filename (date)
order, the oldest stale claim won the budget every pulse.

`planAutoDispatch` and `startableBranches` now count a `wip` branch as startable
only when a dispatch could actually claim it. A pulse reports `wip` only for a
branch whose `origin` ref exists (the scan walks its commits to derive the
state), and that ref is exactly what the claim push collides with — so a `wip`
branch is work but not a dispatch a script would honour. `isStartable`'s
state-only rule is unchanged, keeping resumable waves resumable at the row
level; the ref guard lives beside it as `refBlocksClaim`/`dispatchable`.

`maybeAutoDispatch` names the branch(es) it skipped, once per pulse, so a
withheld budget is a visible decision rather than a silent no-op. No host call
is added — the claim signal comes from refs the scan already read.
