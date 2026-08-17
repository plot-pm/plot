---
"plot": minor
---

An acting button on the board now carries a spinner while it acts.

The seeing half of a report from 2026-08-17: *"Click on actions like 'Start
work' or 'Approve' don't have an activity indicator … User does not see that.
Action is going to be executed."* Measured, an indicator did exist — the label
swaps to `starting…` / `approving…` and `aria-busy` is set — and it is a word
change in a small text button, easy to miss on a control the reader is not
looking directly at, and indistinguishable at a glance from a button that did
nothing. The fix is to make the existing feedback loud, not to add feedback.

**A spinner, deliberately not the WORKING rows' pulsing dot.** The two claims
differ by lifetime: a row's `isLive` is `group === 'working'`, so it can pulse
for hours with no known end, and rotation there would promise a progress
nothing measures — the reason `working-rows-show-motion` chose a pulse. A click
resolves in seconds and there is never more than one in flight, so neither
reason survives the move onto a button. Unifying the two was rejected in both
directions, and the regression is asserted: the row's dot must stay a dot.

**`motion-reduce` stops the rotation and keeps the marker** — inherited from
`working-rows-show-motion` rather than re-decided, because removing the element
would take the marker away with the motion and leave a reader who prefers
reduced motion with less information rather than the same information held
still.

**The marker is `aria-hidden`** — the state is announced twice already, by the
label and by `aria-busy`. **The label still changes**, beside the marker rather
than instead of it: motion is never the only carrier of a fact. **The button
dims** on the same state that drives the label, never on a timer of its own, so
three channels — motion, text, contrast — each say it once.

Last of three waves. The order was deliberate: the double-click guard was
pinned and latched first, then what the button watches for success was
corrected — until that landed, a spinner would have been motion over an outcome
the button was reading wrong.

<!--
bumps:
  skills: {}
-->

