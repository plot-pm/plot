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
between *a poll went missing* and *the server is gone*. It is chosen against
the real restart time of `node --watch` rather than picked round: measure how
long a watch restart actually takes and set it comfortably beyond, so the case
that happens constantly never triggers the case that means something.

Two states, escalating, and the second only after the first has failed to
resolve itself.

### Dimmed and readable, never hidden

`board-tells-the-truth` already settled this and the rule carries: **degrade,
do not hide.** The last payload stays on screen because it remains the best
information available — a reader mid-triage still wants to see which branch was
where, even knowing the figures are three minutes old.

So the overlay reduces contrast and blocks interaction; it does not obscure.
What changes is **trust and reach**, not access.

Blocking clicks is not paternalism, it is honesty: `Start work` and `Approve`
post to a server that is not answering. The click would fail. A control that
cannot work should not look like one that can — the same argument that keeps
the Start button off rows where `plot-dispatch` would refuse.

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
