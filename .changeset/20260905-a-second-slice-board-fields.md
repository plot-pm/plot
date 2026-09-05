---
'@plot-pm/board': patch
---

`EndingReasonSchema` gains a fifth reason, `unstarted`: a prompt whose command exited without running, which none of `bound`, `quiet`, `unreadable` or `spent` could say. It is the only reason no watcher produced — the agent's own process ran the command and received the refusal — so it gives `EndingActorSchema`'s `agent` its first writer.

`AgentEntry.attempts` documents the counter the worker loop now raises. It said *supervisor* and stated that nothing in Plot raised it; the line the field draws is automatic versus a person's, and a loop retry is automatic by every property that distinction was made for.
