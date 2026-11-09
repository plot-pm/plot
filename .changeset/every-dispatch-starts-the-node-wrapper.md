---
'plot': patch
---

A dispatched agent now starts under the node wrapper `plot-worker-wrapper.mjs` instead of the inline `sh -c` script in `plot-dispatch.sh`. `start_worker` calls the new `plot-worker-start.mjs`, which starts the wrapper detached as the leader of its own process group. The desk records keep their names and content, and the manifest stamp has one implementation, `writeManifestStamp`. A `node` on `PATH` of another major than `.nvmrc` pins refuses at launch, names both majors, and starts no wrapper.

<!--
plan: docs/plans/2026-11-09-node-worker-wrapper.md
bumps:
  skills:
    plot: patch
-->
