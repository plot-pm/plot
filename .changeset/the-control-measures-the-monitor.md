---
'plot': patch
---

Count only the host calls a monitor made, not dispatch's. `plot-dispatch.sh` asks `plot-host.sh pr-state` during its eligibility check, so six `gh pr list` calls reach the stub before the AgentMonitor samples once — and both e2e assertions about the monitor asking the host were satisfied by those. The control test now polls and asserts over the calls logged after dispatch returned.
