---
'plot': patch
---

<!--
bumps:
  skills:
    plot: patch
-->

`release-smoke.sh` boots the board out of the packed tarball.

Two checks, in ascending order of truth. A **derive-and-compare** greps the
server sources for spawned script names and compares them against `files` — it
is fast and names the missing file. Then **pack-and-run** does what the grep
cannot: `npm pack`, unpack, and boot the artifact with `PLOT_SCRIPTS_DIR`
deliberately unset, so it must resolve its own helpers from the package layout.

**Both repo shapes, and the empty one is the point.** A new user has zero plans,
and an earlier version of this check tested only a populated repo — it passed
while the published board hung forever on an empty one. A test that quietly
meets the precondition it should be checking is worse than no test.

**This is the check that would have caught the original drift.** Everything else
in the script tests the built artifact in the working tree, where all 24 scripts
sit on disk and the board finds them because they are *there*, not because they
were shipped. The published package was the one artifact nothing tested, and it
shipped 2 of 11 scripts for nine releases.
