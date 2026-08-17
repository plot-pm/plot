---
"@plot-pm/board": patch
---

`Start work` now watches the count its own click moves, so a dispatch on an already-started plan reads as success instead of *no change — see log*.

**The click always worked; the report on it did not.** A user said *"Start work on `feature/agent-rows-line-up` doesn't do anything"*, and every signal said otherwise: `dispatch.available` was `true`, the fleet scan said the wave was *eligible*, and `plot-dispatch --dry-run` said *would dispatch*. What failed was the success check. The button watched `card.started` — and **that flag describes the PLAN while the action starts a BRANCH**. A three-wave plan is `started: true` for ever after its first dispatch, so the flag the button was waiting on could never change again; three pulses later it reported *no change — see log* about a dispatch that had prepared a worktree and pushed a claim.

**The button is on that card deliberately, which is why the defect was permanent rather than occasional.** `isReadyToStart` demands Design-and-unstarted, but a second condition admits started Development cards: the button exists to start the **next** wave as well as the first. Two jobs, and a success check that served only the first — so every plan with more than one wave broke from the second click onward.

**It now watches `waveSummary.claimed`.** Claiming a branch is exactly what a dispatch does, and unlike `started` the count moves on every wave. The comparison is `>`, not `!==`: claims are reaped when a branch merges, so a falling count is normal operation and not a success.

**Still DERIVED, never asserted.** What changed is *which fact is read*, not whether git confirms it. The pulse still re-reads the refs and the row still travels on its own — an optimistic update would make the board display something it does not know.

**`no change — see log` gets its meaning back.** It used to fire whenever a plan was already started, which was most of the time, so a message meant for *the dispatcher declined and here is why* had been reporting successful dispatches instead. It is rare again, and rare is what lets it be believed — asserted in both directions, because a fix that simply stopped showing the message would pass every success test and delete a true signal.

**A plan with `eligible: 0` refuses before the click**, naming the reason, rather than accepting and going quiet for three pulses. Same rule the row action menu already follows.

**Without a pulse the button refuses rather than guesses.** Both counts are `.optional()` in the contract — *"Absent when there is no pulse"* — so swapping `started` for `claimed` trades an always-present fact for a sometimes-present one, and the gap falls exactly where someone opens a freshly restarted board. It dims and says it is waiting for the first fleet scan: without a scan the board does not know which wave is eligible, so a dispatch would be a click into the dark that it could not report on afterwards either. Absent is treated as **unknown, never zero** — a first scan arriving with `claimed: 5` is the board learning what was already true, not five branches claimed by one click.

**It deliberately does NOT fall back to `card.started` when the counts are missing.** That was the tempting fix and the worse one: it keeps the defect alive in precisely the window where it is most likely, hidden behind an apparently-working button. Asserted as its own test, because a fallback passes every other assertion here.

A plan with no waves at all still lets the click through — no `waveSummary` is a pre-wave plan rather than a missing pulse, and `plot-dispatch.sh` is the authority there, refusing in its own words rather than having the board keep a copy of its preconditions.

The `useRef` latch that pins the double click is untouched: it answers *is one of mine already running*, a different question with a different answer.

<!--
bumps:
  skills: {}
-->
