---
'plot': patch
---

Hold the e2e agent past its push, so the AgentMonitor samples a desk in the state under test rather than one it is passing through. The monitor's first pass runs before any sleep and dispatch starts it immediately before the agent, so no interval value keeps the first sample off a mid-edit tree — and because the monitor publishes on change, that first reading is the only one the test ever sees.
