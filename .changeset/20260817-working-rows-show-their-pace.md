---
"@plot-pm/board": minor
---

The activity marker on the Agents tab now aligns to the row's first line and travels: a short track with a glowing dot moving out and back, fast where a write was observed and slow where a branch is merely claimed.

**The marker was centred on the row, and the row stopped being one line tall.** It carried `sm:top-1/2 sm:-translate-y-1/2`, resting on an assumption its own comment stated: *"the row is `py-2` around one line of `text-sm`, so 20px spans nearly its full height."* Under that assumption, centring on the row and centring on the line are the same pixel. The stuck cell then landed as its own line beneath the six columns (`sm:col-start-2 sm:col-end-[-1]`), so a row carrying a status line is roughly twice as tall — and `top-1/2` put the marker **between the two lines** instead of beside the branch name it belongs to. This was the third consequence of that one change: the stuck cell also started at the wrong x, and its cue survived at a dead end, both fixed the same day.

The marker belongs to the **branch**, and the branch is on line one whatever else the row grows beneath it. So the mark is now given the first line's own box to sit in — `sm:top-2` where the first line begins, `sm:h-5` for one line box of `text-sm` — and the track centres itself inside it. Measured rather than assumed: the first line box begins **18.6 px** below the row's top edge on a real page, not the 8 px a reader would derive from the padding, so a hand-computed offset would be right today and wrong the moment the type scale moves. **The pairing that matters:** `top-1/2` looks correct on every single-line row and is wrong on exactly the rows carrying the most information, so a single-line assertion passes on the defect. The browser suite states it with a pair — one row on one line, one on two — and first proves the tall row really is taller.

**The bar became a track with a travelling dot, and the dot must never arrive.** Rotation and travel were refused twice in this repo, both times for one reason: they *"imply progress toward completion, which nothing here measures."* An agent in WORKING may finish in five minutes or five hours. A dot that goes out and comes back promises no destination — it reports a **rate**, not a distance, and that is the only reason travel is acceptable where those were not. The keyframes end where they began and the track has no far marker to reach; anything that fills, completes or arrives reintroduces exactly what was refused. Asserted on the browser's own resolved `@keyframes`, and on the absence of `width`, `scaleX` and `stroke-dash` in them.

**Two speeds, and the speed is a fact rather than a decoration.** Fast where `local_dirty` or `local_locked` — someone is writing, measured. Slow where the row is merely in WORKING with neither signal — claimed, and the board does not know whether anyone is there. Both states were live on the board the day this was asked for: `feature/not-started-counts-plans` reported `dirty=true` against `bug/green-never-outranks-unknown` with `dirty=false` and the note *claimed, no known worker*. The two are separated by a factor of three so the difference reads rather than merely computes, and each pace carries its own `title` — *a write is in progress* against *claimed, and no write observed* — so the distinction is never carried by motion alone.

**`isActive` is untouched, and the widening is visible at the render.** The predicate `activity-shows-itself` settled still means *someone is writing here* and is now the **fast** half; the slow half is WORKING membership, added where the mark is rendered rather than by loosening the predicate. That keeps the second statement legible as a second statement. The slow dot says **unknown, never nobody**: both local fields are `.default(false)`, and a scan that could not observe a worktree reports absence rather than cleanliness — which is why the slow case is bounded by WORKING rather than applied to every row.

**`motion-reduce` keeps the track, the dot and its glow, and stops only the travel.** All three halves, the fifth time this repo has written the rule: hiding the element under reduced motion passes a motion-only assertion and takes the marker along with the movement. The dot rests at the track's start rather than mid-flight, because a dot frozen halfway reads as a paused progress bar. Under reduced motion the two speeds collapse into one appearance and that is correct — *speed* is what is being removed, so it cannot be the only carrier; the row's note still says which state it is in, in words.

**`aria-hidden`, and a screen reader never hears a speed.** The note carries the fact in words, and the accessible text of the row contains neither *fast* nor *slow*.

**No third speed.** No gradient keyed to commit freshness: a scale nobody can read (*was that four minutes or forty?*) changing continuously is motion in place of information. `activityPace` reads the two local signals and nothing else, asserted by varying the age and the group and getting one answer.

**No mark is implemented by modifying another.** `[data-live-dot]` keeps its own `animate-pulse` — asserted as *not `travel`*, since *not none* would pass on a dot that had been handed this wave's animation — and `[data-change-mark]` and `[data-stuck-cue]` are untouched. The board's first hand-written keyframes arrive with this change, because no Tailwind utility travels: `pulse` changes opacity and `ping` scales, and both stay where they are.

<!--
bumps:
  skills: {}
-->
