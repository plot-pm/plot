---
'plot': minor
'@plot-pm/board': minor
---

The machine keeps the daemon alive. `skills/plot/units/` ships a `launchd` plist and a `systemd` service that restart `plot-registryd`, with install steps a person can follow without reading the source. The OS is the correct owner because *"is a process that should be running actually running?"* is a machine-side question, and it terminates the regress instead of adding another Plot component to babysit. Plot's own `Machine` entity gains no verb: it answers *is there room?* and initiates nothing.

A tick that cannot complete now reports what it could not do instead of ending the loop. Every reading is a call to a machine that can refuse, and any one of them used to escape the tick and stop the daemon — so an OS restart was the only recovery from a reading that would have succeeded a minute later. The reason goes to stderr, which both units log separately, the decision is empty rather than truncated, and the next tick re-reads the registry and the desks from disk.

Nothing new is persisted between ticks. There is no journal, no lock file and no resume path, because there is nothing to resume: the recovery from a failed tick and the recovery from a `kill -9` are the same code path, and a test asserts that a tick following a failure reaches the decision it would have reached had the failure never happened.

<!--
bumps:
  skills:
    plot: minor
-->
