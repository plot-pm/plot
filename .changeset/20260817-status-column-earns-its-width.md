---
"@plot-pm/board": minor
---

The Agents tab's status column now has room for what it holds, and a row marks itself for about three seconds when its PR status changes.

**The space was not missing; it was misallocated.** `ROW_TRACKS` gave the branch `1fr` and the status `9rem` — and `1fr` does not mean *take what you need*, it means take everything left over. So on a wide window every spare pixel collected between the branch name and the status cell as a gap that belongs to the branch column and draws nothing, while `⑂116 no checks` was the widest thing 144px could render. The status track is now a fixed `14rem` and the branch keeps `1fr`: 80px comes back from a gap that displayed nothing, and every column edge stays where it was.

Two wider-looking shapes were rejected for the same reason. `minmax(9rem, auto)` on the status sizes it to content, so its edge wanders between rows; `max-content` on the branch sizes it to the longest name *in that section*, so two groups disagree about where the branch starts. Either gives back at one column what fixed tracks establish at all of them. The honest cost is that a narrow-but-not-mobile window elides the branch sooner — middle elision keeps both ends and `title` keeps the whole name. Below 640px nothing changes; the row is a stacked card there and tracks do not apply.

**And a status could say what is true, but not what just changed.** `⑂57 conflicts 22d` and `⑂177 conflicts 5m` are the same status meaning opposite things — a standing decision nobody has taken versus something that broke minutes ago — and Age does not separate them in general, because it is the *PR's* age and not the *state's*. A three-week-old PR that broke this morning still reads `22d`.

So a row whose watched value changes now tints itself for ~3s. The watched value is `pr?.state ?? null`: **seven possibilities, not six**, because `pr` is nullable and most rows carry none. `null → pending` (a PR opening, often the most interesting transition a branch has) marks, and so does `pending → null`.

**Three seconds, and the measurement decides it.** `pr.state` comes from the 60s PR refresh, not the 4s fleet pulse — and 120s under rate-limit backoff. A transition is a *rare* event, so a 300ms flash calibrated for something frequent would be missed nearly every time.

The memory distinguishes a **missing key** from a stored **`null`**: *never observed* and *observed with no PR* look alike in JavaScript and mean opposite things, and collapsing them passes the first-pulse assertion while silencing every branch's first PR forever. The first pulse after a load or restart therefore marks nothing, and a row returning after absence starts silent.

A changed row marks itself **wherever it now sits, including a new section** — `pr.state` helps decide the group, so the changes worth marking are frequently the ones that move the row. A second change while lit **restarts** the timer rather than letting the first expire and imply nothing further happened. Ten rows changing means ten marks: no threshold, no suppression.

Under `motion-reduce` the mark **stays** and only the animation stops; it is `aria-hidden` with no live region, because the cell's text already changed and a reader reaches it by reading the row. The `LiveDot` on WORKING rows is untouched — *something is alive, end unknown* and *this just changed* are two meanings that keep two marks.

**The memory is per client and one value deep.** Nothing is persisted, no contract field is added, and neither clock moves: a reload starts silent, two tabs mark independently, and a backgrounded tab accumulates nothing. The marker is not a log.

<!--
bumps:
  skills: {}
-->
