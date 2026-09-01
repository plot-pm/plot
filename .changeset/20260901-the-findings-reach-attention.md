---
'@plot-pm/board': patch
---

A monitor's finding reaches the row and becomes an attention entry.

`AgentRow` gains `findings` — what the WorkerMonitor, AgentMonitor and
BuildMonitor currently find about the branch, forwarded onto the row unchanged,
the rule `worker` and `worker_activity` already follow. `/api/attention` derives
entries from them beside the nine it already reads off row fields.

`owes a review` is the finding that earns the field. Its row reads `finished` or
`none` on `worker` and carries no PR — the shape of a branch nobody has started
— so the scan alone could not report it, and finished work sat on a branch with
no PR twice in one session with nothing noticing.

An entry names the monitor that found it. A WorkerMonitor `idle` is a process to
look at and an AgentMonitor finding is a debt to discharge, so `monitor` carries
the value a caller branches on and `subject` the phrase it shows a person.

Clearing is a derivation. A monitor publishes `clear` when a debt stops holding,
`currentFindings` drops the finding it retracts, and the entry disappears by not
being derived again — nothing marks it done and no state goes stale.
