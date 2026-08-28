---
'@plot-pm/board': patch
---

A plan whose every non-deferred wave has merged delivers itself, and its desks
are reaped behind it.

The measurement already existed and acted on nothing. `allWavesMerged` computes
the exact condition and `planStatus` renders it as `deliverable`, and both
deliberately touch nothing — which is right for a measurement. What was missing
is the wire: four plans were delivered by hand in one day, each after the same
manual check, while eleven more sat `merged_not_delivered` and twelve worktrees
sat reapable because nobody had typed the command. The estate that accumulates
is what eventually stops the board working at all — a 90 s scan could not walk
54 worktrees and 43 branches.

It rides the scan's clock inside `refresh`'s success path, never a route: there
is nothing to reach from any binding, localhost included. Delivering on a failed
scan's last good answer would act on refs that may have moved.

**The board writes no part of the transition.** `plot-deliver.sh` owns the phase
flip, the `Delivered:` record and the index symlink, and performs them in one
commit — load-bearing rather than tidy, since the fleet scan reads its rolling
window from `delivered_raw` and a flip without the record makes a plan invisible
rather than delivered. Grep `packages/board/src` for a phase write and find
nothing; that absence is asserted by a test.

Two entrances and one implementation, the shape `Approve command` established: a
`Deliver command` routes through an agent, its absence runs the script Plot
ships, and the skill calls that same script either way.

**The reap runs after the delivery, and is gated on its exit code.** Chained to
the delivery's `exit` rather than spawned beside it — both orders end with a
delivered plan and no worktree, so an end-state assertion passes either way, and
only this one never shows a desk-less `Approved` plan mid-flight. A delivery
that refused reaps nothing, because reaping after a refusal would clear the
desks of work the delivery just declined to call finished.

A plan whose remaining waves are all `deferred` is not delivered: shelved is not
finished, and that call stays with a person.
