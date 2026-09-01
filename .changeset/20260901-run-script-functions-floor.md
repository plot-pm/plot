---
'@plot-pm/domain': patch
---

The `run-script.ts` coverage floor matches the platform that enforces it.

`runBytes` attaches an EPIPE handler whose execution depends on whether a write
loses a race against a process exit, and the pipe buffer differs by platform:
macOS measures 100% functions, the Linux runner 94.44%. The per-file floor was
set from the macOS reading and so was never reachable in CI, failing main on
commits that changed only markdown. It now records the reading CI actually takes.
