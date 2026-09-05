---
'@plot-pm/board': patch
---

`EndingReasonSchema` gains a fifth reason, `unstarted`: a prompt whose command exited without running, which none of `bound`, `quiet`, `unreadable` or `spent` could say. It is the only reason no watcher produced — the agent's own process ran the command and received the refusal.

`EndingActorSchema` carries `agent` again, for that reason and no other. #711 removed it on a measurement — nothing wrote it — and on the reading that an agent does not decide to stop; that reading holds for every ending a watcher produced, and this is not one. `endingIsAttributable` now reads the pair, so `agent` with any other reason is still refused as self-attributed, and so is an ending naming no reason at all.

`AgentEntry.attempts` documents the counter the worker loop now raises. It said *supervisor* and stated that nothing in Plot raised it; the line the field draws is automatic versus a person's, and a loop retry is automatic by every property that distinction was made for.
