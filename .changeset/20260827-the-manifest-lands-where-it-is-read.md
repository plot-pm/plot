---
'plot': patch
---

<!--
bumps:
  skills:
    plot: patch
-->

A dispatched worker's manifest is written where the board reads it.

`readAgentRegistry` has honoured the `Agent registry` config key since #420. The
two writers did not: `plot-dispatch.sh`'s `start_worker` used
`$repo_root/.plot/agents`, where `repo_root` is `git rev-parse --show-toplevel`
from the DISPATCHER's own cwd, and `manifest-stamp.ts` joined `repoRoot` with a
hardcoded `.plot/agents`.

Auto-dispatch runs from the board's checkout (`dispatch.ts` passes
`cwd: repoRoot`), so its manifests landed in a directory nothing reads. Measured
2026-08-27: five live workers, five manifests written, and the board reporting
`2 manifests, 9 synthesized` — every agent HAD a manifest, two were reachable.
The three unreachable ones rendered as branch names in the agent slot, because
the board synthesizes a row for any dispatch worktree it cannot find one for.

Both writers now resolve through the same key the reader uses. The shell copies
`resolve_wt_root`'s conventions — absolute taken as given, relative joined onto
the repo root, trailing slash trimmed — and `manifestForWorktree` routes through
`resolveManifestDir`, the resolver `drop.ts` already uses. A project declaring no
key keeps `.plot/agents` under its own root, unchanged.

After the fix, five dispatched workers read `5 manifests`.
