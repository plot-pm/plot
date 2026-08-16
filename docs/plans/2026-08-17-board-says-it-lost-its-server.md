# A frozen board that still looks operable

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:**
- **Started:**
- **Delivered:**

## Problem

`board-tells-the-truth` taught the board to admit it had stopped hearing from
its server: a rose banner reading *"Not reaching the board server — last heard
42s ago. The numbers below are frozen at that moment and are no longer being
checked."*, `(frozen)` appended in the footer, and the clocks stopped.

That fixed the lie. It did not finish the job. **The page still invites
operation.** Rows keep their full contrast, links keep their affordance, and —
since the row actions land — a three-dot menu keeps offering `Start work` on
data that is minutes old. A reader who scrolls past a single banner is looking
at a control surface that behaves exactly as it does when everything is fine.

The distinction is between **information** and **posture**. The banner says
*these numbers are old*. What is missing is *do not operate this right now*.

## Design

### Dimming comes later than the banner, and says so

**The banner stays first, alone, for the first stretch of silence.** A single
missed poll is routine here: `pnpm board` runs under `node --watch`, so an
ordinary edit to a board source file restarts the server, and the tab loses
contact for a second or two several times an hour. Dimming the whole page for
that would be a strobe, and it would teach the reader to ignore the dimming —
the exact failure this repo has already argued against for greyed-out buttons.

**After a sustained silence, the page dims.** The threshold is the difference
between *a poll went missing* and *the server is gone*.

**The number is measured by whoever builds this, and justified in the PR** —
not written here. A `node --watch` restart takes as long as it takes on the
machine in question, and a figure guessed in a plan file carries the authority
of a decision without the measurement behind it. Set it comfortably beyond a
real restart, so the case that happens several times an hour never triggers the
case that means something. This plan's sibling made the same call for the
column-overflow threshold.

Two states, escalating, and the second only after the first has failed to
resolve itself.

**Returning to a backgrounded tab re-checks rather than counts.** Browsers
throttle timers in hidden tabs, so a minimised window would otherwise come back
holding a silence figure assembled from however often it was allowed to wake.
`App.tsx` already warns about exactly this: *"a board that has heard nothing
for an hour has to say an hour, not 'as many seconds as the browser felt like
waking me'."* So visibility returning triggers a poll: it either succeeds and
the overlay goes, or it fails and the overlay is honest. Nobody should stare at
a dim page for a server that came back two minutes ago.

### Both tabs, which means unifying two error models

The plan's first draft said the overlay belongs in `App.tsx` *"where both tabs
can inherit it"*, and checking the code showed that is not free. **Silence is
measured for the Agents tab only** — `if (tab !== 'agents' || !fleetUnreachable
|| fleetHeardAt === null) setFleetStaleSeconds(null)` — because only that tab
polls the fleet.

Worse, the two tabs answer the same outage in opposite ways. The Agents tab sets
`fleetUnreachable` and **keeps its rows**. The Board tab sets an `error` string
and **replaces its cards** with a red message (`App.tsx:383`), discarding a last
payload it still holds.

Covering both tabs therefore means giving the Board tab the newer treatment:
reachability measured as a duration rather than recorded as a message, and the
last board kept rather than thrown away. That is the same *degrade, do not hide*
rule, applied where it has not reached yet — and it is the reason this wave is
larger than an overlay.

The alternative — Agents tab only — was rejected on a plain reading: a reader
who leaves the Board tab open overnight and returns to a dead server gets a red
error where the board used to be, with no indication whether it is stale or
gone. One outage should not produce two different stories depending on which tab
is in front.

### Dimmed and readable, never hidden

`board-tells-the-truth` already settled this and the rule carries: **degrade,
do not hide.** The last payload stays on screen because it remains the best
information available — a reader mid-triage still wants to see which branch was
where, even knowing the figures are three minutes old.

So the overlay reduces contrast; it does not obscure. Reading needs no clicks,
so reading never stops: scrolling, selecting, copying a branch name all keep
working.

**What it blocks is interaction with the board itself** — clicking cards,
filtering, triggering actions, operating columns. That is the surface whose data
is stale, and it is the surface an overlay is *for*. `Start work` and `Approve`
post to a server that is not answering; the click would fail. A control that
cannot work should not look like one that can — the same argument that keeps the
Start button off rows `plot-dispatch` would refuse.

**What it does not block is the way out.** The overlay's own message, its restart
command, its selectable text: those are the one thing on screen that still
works, and blocking them would be a dead end with a lock on it.

**A plan modal that is already open stays usable.** It is a layer above the
board rather than part of it, and its content route may well fail — the modal
already has an error path for that (*"Failed to load plan"*), which explains
itself and confirms what the overlay says. Opening a *new* one is board
interaction and stops with everything else.

**Blocked actions stay visible and disabled, with the reason.** The same pattern
the row action menu settles in
[`working-rows-show-motion`](2026-08-16-working-rows-show-motion.md):
`aria-disabled` plus a `title` naming the cause. Buttons that vanish make the
layout jump — once when contact is lost and again when it returns, and a page
that rearranges itself while frozen is worse than one that simply admits it is.

### The message names the state and the way out

*"No contact with the board server for 2 minutes"* — plus the command that
starts it (`pnpm board`) and the address it serves.

Naming the command matters more than it looks. This board is left running for
hours and reloaded rarely; whoever finds it frozen at midday may not remember
how it was started, and a message that only describes the problem is a dead
end. It is also the one moment the page has the reader's full attention.

**What this cannot fix, and should not pretend to.** On 2026-08-16 the board
appeared unreachable while the server was running perfectly: it listened on
`[::1]:7777` and Chrome resolved `localhost` to `127.0.0.1`, where nothing
answered. Measured — `curl http://[::1]:7777/` returned 200 while
`curl http://127.0.0.1:7777/` returned nothing at all.

No overlay helps there, because the document never loads; the reader gets
Chrome's own error page. That is a real defect and a **separate one** — the
server binds one address family and the client picks the other — recorded in
[`plot-board`](../stories/plot-board/STORY-plot-board.md) rather than smuggled
in here. This plan covers the server that *goes away*, not the one that was
never reached.

## Branches

### Posture

- `feature/board-dims-when-lost` — after a sustained silence the app dims and
  blocks interaction, over the existing banner; message names the state, the
  restart command and the address

One branch: one state, one overlay, one threshold — in `App.tsx`, where both
tabs can inherit it.

## Done when

- **A short silence dims nothing.** Assert that one failed poll leaves the page
  fully operable with only the banner — a threshold-free implementation passes
  every test written against the long case.
- **A sustained silence dims and blocks.** Assert both halves: the visual state
  *and* that an action control cannot be activated.
- **The rows stay readable underneath.** Assert the text is still present and
  legible — hiding the payload would break `degrade, do not hide`.
- **The overlay's own controls stay usable** while the board's do not. Assert
  the restart command is selectable: an overlay that blocks the way out is a
  dead end with a lock on it.
- **Blocked actions stay visible and `aria-disabled`, with a reason** — not
  removed. Assert the layout does not shift between reachable and unreachable.
- **Both tabs dim.** Assert the Board tab reaches the state at all: today it
  only ever sets an `error` string, so an Agents-only implementation passes
  every other test here.
- **The Board tab keeps its last cards** rather than replacing them with a red
  message. The half of this wave that is a behaviour change, not an addition.
- **Returning to a hidden tab re-checks instead of counting.** Assert a poll is
  issued on visibility change: a timer-only implementation shows an overlay for
  a server that recovered while the tab was in the background.
- **Recovery clears it without a reload.** Assert the page returns to normal on
  the next successful poll; a dimming that needs dismissing is a dimming that
  outlives its cause.
- **The message names the restart command.** Assert the text, not just the
  presence of an overlay: a message without a way out is the failure this is
  meant to remove.
- **The overlay is announced, not merely drawn.** A visual dim tells a screen
  reader nothing; assert the state reaches assistive technology.
- `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`, `pnpm run validate`
  all pass.
- `pnpm build:board` run in the implementing worktree and the artifact
  committed — CI gates on no-diff.
- A changeset is present.

## Notes

Asked directly on 2026-08-17, after the board sat unreachable in a browser tab:
*can the UI show when the server is no longer running — an overlay with a hint
and an opaque background?*

The honest answer was that half of it shipped hours earlier and the other half
is a different question. Recording both halves is the point: the banner made
the board stop lying, and this makes it stop inviting.

Ordering: `App.tsx` is also touched by
[`board-becomes-operable`](2026-08-16-board-becomes-operable.md)'s story
overlay wave, in flight now. Whichever lands first, the other rebases.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {"q": "Silence is measured only for the Agents tab (`if (tab !== 'agents') setFleetStaleSeconds(null)`), but the plan says both tabs inherit the overlay.", "a": "Both tabs — which means giving the Board tab the same measurement. It currently sets an error STRING and replaces its cards, while the Agents tab keeps its rows. One outage must not produce two stories", "category": "technical-architecture"},
    {"q": "Is the Board tab's replace-on-error a finding in its own right?", "a": "Yes, and it is folded into this wave rather than noted separately, since covering both tabs requires fixing it", "category": "ux-errors"},
    {"q": "Who picks the dimming threshold?", "a": "The implementer, measured against a real node --watch restart and justified in the PR. A number guessed in a plan file carries the authority of a decision without the measurement", "category": "technical-implementation"},
    {"q": "What happens when a backgrounded tab returns after minutes?", "a": "Re-check rather than count up. Browsers throttle hidden timers, and App.tsx already warns that an hour of silence must say an hour, not however often the browser woke", "category": "ux-edgeCases"},
    {"q": "Block all interaction, or only actions? Navigation and reading need no server.", "a": "Interaction with the BOARD — cards, filters, actions, columns. Reading never stops (it needs no clicks), the overlay's own controls stay usable, and an already-open plan modal keeps its own error path", "category": "ux-happyPath"},
    {"q": "Should blocked actions vanish or stay disabled?", "a": "Visible, aria-disabled, with the reason — the same pattern the row action menu settles. Vanishing buttons make the layout jump twice: on loss and on recovery", "category": "ux-accessibility"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": false, "architecture": true, "implementation": true},
    "domain": {"rules": true, "workflows": false, "data": false},
    "ux": {"happyPath": true, "edgeCases": true, "errors": true, "accessibility": true},
    "nonFunctional": {"security": false, "performance": false, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
