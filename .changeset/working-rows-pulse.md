---
"@plot-pm/board": minor
---

A `working` row now shows that it is working — the board's first animation.

**The Agents tab exists to show work in flight and rendered like a table of records.** A branch an agent was editing right now looked exactly like one nobody had touched for 22 days: same weight, same stillness, different text. The reader had to *read* to find out that anything was happening. Measured before changing anything: the board contained **no animation at all** — not a transition, not a pulse, no `prefers-reduced-motion` block — so there was no existing convention to follow, and this becomes the first one.

**One animation for the whole group, never graded by confidence.** `WORKING` has three entrances of differing strength — `uncommitted work in a local worktree` (files edited on this machine, the strongest evidence there is), `last commit 3 min ago`, and `claimed, no commits yet` (an agent reading the plan, or one that never started). Grading the animation by which one applied was considered and rejected: **group membership IS the statement, and it is true for all three.** Each is a reason the fleet considers the branch live, and the note beside the row already says *which* reason — so a second vocabulary made of speeds would encode in motion what the text states plainly, while being unreadable in isolation and invisible in a screenshot, which this board takes seriously enough to have written into its rule for colour. A confidence-graded implementation passes a test that checks only one of the three notes, so all three are asserted to render *identically* — same animation, same duration, same box.

**A pulsing dot, not a spinner**, on a plain count: `WORKING` regularly holds several rows (four agents ran in parallel on 2026-08-16), and four rotating spinners in a column is flicker, not information. Rotation also implies *progress toward completion*, which nothing here measures; a pulse implies *aliveness*, which is exactly the claim being made. It sits **before** the row rather than inside the note, because the note is where the row states its facts and motion there competes with reading them — a leading dot needs no column of its own and scales from one row to eight.

**What the animation claims is narrow and true by construction:** that the row is in `WORKING`, re-derived every scan. It stops the moment the row leaves the group, which is exactly when the work stopped or moved on — asserted across a state change rather than on a static fixture, because that self-stopping is the whole honesty of it and a fixture-only test passes on an implementation that never re-evaluates. This is deliberately unlike the countdown that kept ticking after its server died (fixed in `board-tells-the-truth`): that asserted a *specific future event* that was not coming.

**Reduced motion is built in, not retrofitted, and both halves matter.** `prefers-reduced-motion: reduce` disables the animation and **leaves the dot visible** — removing the element would satisfy "no motion" and lose the marker along with it. The reason is not politeness: motion triggers nausea for some readers, and this view is meant to be left open on a second screen. Tailwind's own `animate-pulse` with `motion-reduce:animate-none` carries it — no new CSS file, no keyframe of our own, and the reduced-motion variant arrives with the utility rather than needing its own media query. Smallest possible way to introduce a first animation.

**No visibility handling.** A pure CSS animation costs effectively nothing and browsers already throttle background tabs; pausing it through the Page Visibility API would add a mechanism for a problem the platform solves — and the poll cycle, which is the expensive part, keeps running anyway.

**The dot is `aria-hidden`.** A screen reader already gets the group heading and the row's own text, so the animation is decoration on top of information and never the carrier of it — the same rule the contract sets for colour (*carried as a symbol AND a word, never as colour alone*). The row is asserted to stay fully legible with motion off: group, note and age all unchanged.

Two negatives are pinned because a naive implementation passes without them: rows in **every other group hold still** — including a `quiet` row that also carries a fresh claim, since the group is what decides and not the note or the age — and an **empty `WORKING` group animates nothing**, trivial by construction today but asserted so nobody later moves the animation to the group header, where it would run against zero rows.

<!--
bumps:
  skills: {}
-->
