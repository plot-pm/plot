---
"@plot-pm/board": minor
---

A group heading on the Agents tab now carries the same activity mark its rows carry, so a **collapsed** section says whether anything inside it is moving instead of only how many rows are in there.

**A folded group reported its stock, not its motion.** The heading renders `(4)`, and the comment above it says why that number exists at all: *"a folded header with no number reads as nothing here"* — it was introduced to separate **absent** from **empty**, not to report change. It is the same shape as the live dot: a count reporting membership where the reader is looking for activity. And this is not hypothetical. **QUIET and DONE start collapsed** by default and the choice is persisted in `localStorage`, so they stay folded across sessions — while QUIET's own comment names its purpose exactly: *"go check whether this died"*. A group whose entire job is to surface possible deaths was folded shut showing a stock count. The rows are **removed from the tree** when folded, not merely hidden, so the heading is the only thing on the page that can say anything about them.

**Binary, and no second number.** At least one row is active, or none is. `(4, 2 active)` was the alternative and is rejected: `(4)` exists to separate absent from empty, a distinction this board paid for, and a second figure beside it dilutes the one job that number has. The reader opening a group does not need to know whether it is one row or three — they need to know whether opening it is worth it.

**The strongest pace its rows state, never stronger.** A group holding one written-to row among three merely-claimed ones travels **fast**; a group holding only claimed rows travels **slow** — the same *unknown, never nobody* ordering every mark on this board keeps. **The pairing that matters:** an implementation returning the weakest pace, or keeping the last row's answer, passes every assertion that only checks *the heading has a mark* and lets one measured write hide behind three unobserved claims — when that measured row is precisely the reason to open the group. The test puts the written-to row **last**, so an implementation stopping at the first live row it meets fails rather than passing by luck.

**It reads both entry paths, because a row has two.** `active` is the fleet's answer for the whole list at once — `isActive` in this pulse, or a lock still echoing from a recent one — and `isLive` adds the rows the fleet places in WORKING while observing nothing local. A heading computed from `isActive` alone would go dark for a group whose rows still carry marks, which is the heading disagreeing with the rows beneath it.

**It cannot disagree with its rows, and that is structural rather than tested.** The heading is `groupPace(rows, active)` computed at render, from the same set the rows are rendered from. No new field, no stored count, nothing to drift — the way a separately-maintained figure would. It reads only the rows it was given: `active` answers for the whole fleet, so a heading asking *is anything in the fleet active* would light every section on the board from one busy row in one of them.

**The heading keeps the mark when expanded.** Hiding it on expand was considered — the rows show it themselves, so the heading repeats them — and rejected because the marker would then vanish at the moment of opening, which reads as *it stopped*. A marker that disappears when you look closer is worse than one that repeats itself.

**The mark gained a placement, not a second design.** Everything it *is* — the track, the travelling dot, the glow, the two paces, the titles, `aria-hidden` — is shared with the row, because a group heading says what its rows say and must say it in the same marks. Only where it hangs differs, and that difference is load-bearing: the row's placement is `sm:absolute`, which positions against the nearest positioned ancestor, and an `<h2>` **has none**. Reusing the row's class list would not have sat the mark slightly wrong — it would have hung it off whatever ancestor happened to be `relative` and landed it elsewhere on the page, a failure no class-name assertion can see. The two placements are a named table, the row's pinned whole so a shared component gaining a second caller cannot quietly change the first caller's geometry.

**`aria-hidden` earns its keep twice here.** The mark renders *inside* the collapse toggle, so without it the button's accessible name would become "quiet (2) a write is in progress in this checkout". The heading's words and the row's note still carry the fact.

**`(4)` still means what it meant**, and the heading does not grow a second line: asserted against an unmarked section's heading height.

<!--
bumps:
  skills: {}
-->
