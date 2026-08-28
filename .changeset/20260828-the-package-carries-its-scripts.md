---
'@plot-pm/board': patch
---

A board installed from npm can scan.

The package shipped 2 of the 11 helper scripts its server spawns, so an
installed board answered `bash exited 127` and never became ready — in every
release since v2.5.0. Verified against the published tarball on 2026-08-28:
five pulses, `ready:false` throughout.

The `files` whitelist was correct when written (2026-07-14, when the board
spawned exactly those two). Nine spawns accumulated over six weeks, each by a
change that was correct in itself and none with reason to touch a package
manifest. **No review catches a defect that is in no diff** — CI never saw it
because every CI job runs inside this repository, where all 24 scripts sit on
disk and the board finds them because they are *there*, not because they were
shipped.

The nine join `files` and `build.mjs`'s vendored list, which now carries the
comment explaining why it must not be trimmed back.

**This alone does not make the published board work.** A repo with no plans
still exits the fleet scan before its terminal pulse line, which is the next
wave — every new user has zero plans, and the packaging fix merely reveals it.
