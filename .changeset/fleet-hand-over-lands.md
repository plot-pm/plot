---
'plot': patch
---

fleetd writes a hand-over into the manifest in the `Agent registry` directory, the one the tick reads and the agent's loop polls. It wrote to `<repo>/.plot/agents`, so in a repository whose registry is configured elsewhere every hand-over failed and every free agent stayed on `branch: ""`. A hand-over that cannot be written now names the agent and the cause in `fleetd.err`: the manifest path it did not find, or a manifest it could not read or write.

<!--
bumps:
  skills:
    plot-fleet: patch
-->
