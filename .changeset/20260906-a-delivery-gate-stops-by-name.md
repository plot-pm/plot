---
'plot': minor
---

`/plot-deliver`'s delivery-landed gate stops at a name rather than a line
number. It was `sed -n '/^== 7./q;p'`, whose meaning is *stop before the first
non-blocking section* and whose expression was the number 7 — an agreement held
by maintenance rather than by construction. `plot-reconcile-scan.sh` has been
renumbered twice, and each time somebody had to notice that a section inserted
below 7 would silently shrink the gate; three comment blocks in the scan and two
tests existed to make sure they did.

The scan now emits `== blocking sections end ==` between the findings that stop
a delivery and the shapes somebody fixes, and the gate reads to that.

A marker line rather than a footer key or a list of section titles. The footer
counts findings and the gate needs to know which PLAN, which a count cannot
answer. A list of titles in the skill puts the boundary in the file that does
not own it: every new blocking section would need a second edit, and a renamed
heading would shrink the gate with nothing failing. The marker sits where the
boundary is, in the one file that decides section order — so adding a section is
a question of which side of the line it goes on, which is the decision the
author is already making.

Asserted: adding a blocking section at 6 shifts every advisory section up by
one and the gate's answers are unchanged, while the old `== 7.` reads six
sections where there are now seven. The defect is demonstrated rather than
described, so the test cannot pass against a gate that never had it.

The section count in `CLAUDE.md` catches up with the scan: thirteen, not
twelve, and section 13 (`rounds_drift=`) is described. `AGENTS.md` said five.
Both named a count no reader could have checked without running the scan, which
is the drift arriving in the place a reader trusts.

<!--
bumps:
  skills:
    plot: minor
    plot-deliver: minor
-->
