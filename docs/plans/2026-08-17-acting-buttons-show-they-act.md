# A button that starts an agent should look like it did

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:**
- **Started:**
- **Delivered:**

## Problem

Reported on 2026-08-17: *clicking `Start work` or `Approve` shows no activity
indicator, and they can be clicked several times. The user does not see that the
action is going to be executed.*

Both halves are real, and the measurement makes them narrower and sharper than
the report suggests.

### The feedback exists and is nearly invisible

Both buttons **do** hold a pending state. `StartWorkButton` swaps its label to
`starting…` and sets `aria-busy`; `ApproveButton` does the same with `running`.
So the claim *"no indicator"* is not literally true — what is true is that the
indicator is a **word change in a small text button**, with no colour, no
motion, and no weight.

That is thin feedback for an action that **starts a detached agent** or
**merges a pull request**. And this board already has a vocabulary for *work is
happening here*: `working-rows-show-motion` put a pulsing dot on WORKING rows
for exactly this reason, and settled the accessibility question with it —
`motion-reduce` stops the animation and **keeps the dot**, because removing the
element would take the marker along with the motion.

`aria-busy` is set on both buttons and is not a counter-argument: it is an
attribute for assistive technology, invisible to everyone else.

### The double-click guard reads a value that has not moved yet

`StartWorkButton` states the intent in a comment — *"Disabled until the next
pulse confirms, so a double click or a second tab does not fire two runs"* — and
implements it as:

```tsx
const blocked = starting || !dispatch.available;
// …
onClick={() => { if (blocked) return; void start(); }}
```

`blocked` derives from `state`, and `setState` does not take effect until the
next render. **Two clicks inside one tick both read `idle` and both call
`fetch`.** The same shape sits in `ApproveButton`.

**Measured: there is not a single test for it**, on either button — no
`grep` hit for a double-click, rapid-click or two-request assertion anywhere in
the board's suites. So the comment asserts a protection nobody has checked, and
this plan does not get to claim the defect is real either. **The first thing to
write is the test**, not the fix.

The blast radius is bounded but not zero. The comment is right that *"git holds
the lock, and the claim race is the real safety net"* — a second dispatch of the
same branch loses the claim race. But `Approve` merges a PR, and a second run
lands on an already-merged PR, so the protection there is the host's idempotence
rather than anything the board arranges. **The user-facing defect is the same
either way: the page does not say it is working.**

### And on an already-started plan, the button appears to do nothing at all

Reported minutes later, on the same board: *`Start work` on
`feature/agent-rows-line-up` doesn't do anything.*

Measured, and it is a third defect rather than a symptom of the first two:

| Signal | Value |
|---|---|
| `dispatch.available` | `true` — the route is ready |
| Fleet scan | `Presentation — eligible`, one branch to take |
| `plot-dispatch --dry-run` | `would dispatch feature/agent-rows-line-up` |
| **The card** | **`started: true`** |

So the click works and the dispatch would succeed. What fails is the
**feedback**, because of what the button watches:

```tsx
const startedRef = useRef(card.started);
// …
if (card.started !== startedRef.current) { setState({ kind: 'idle' }); return; }
if (pulse - state.since >= PULSES_BEFORE_GIVING_UP) {
  setState({ kind: 'no-change', log: state.log });
}
```

**`card.started` describes the PLAN; the action starts a BRANCH.** A plan with
three waves is `started: true` for ever after its first branch is dispatched, so
the flag the button waits on can never change again. Three pulses later it
reports *"no change — see log"* — about a dispatch that in fact prepared a
worktree and pushed a claim.

The button's own comment is the reason it is written this way, and the principle
in it is right: *"Feedback is DERIVED, never asserted: the button does not move
the row … An optimistic update would be faster and would make the board display
something it does not know."* Deriving is correct. **The derivation just reads
the wrong fact** — a plan-level flag standing in for a branch-level event.

The card already carries what would answer it: `waveSummary` reports
`{claimed, eligible}` per plan, and this card read `claimed: 0, eligible: 1`
before the click. A dispatch moves exactly that pair.

## Design

### The acting buttons borrow the pulse the rows already use

While a click is in flight, the button carries the **same pulsing dot** the
WORKING rows carry:

```
idle       [Start work]
in flight  [● starting…]
```

Not a new spinner and not a new colour — the board already means *something is
happening here* with that dot, and a second symbol for the same statement is a
second thing to learn. `motion-reduce` stops the animation and keeps the dot,
which is the rule `working-rows-show-motion` settled and this inherits rather
than re-decides.

The label keeps changing as it does today. The dot is added because the word
alone is too quiet for a control that writes; the word stays because motion
must never be the only carrier of a fact — the same rule, applied here.

**The button also dims itself while in flight.** It is genuinely unavailable in
that moment, and dimming is what this board already uses to say so. Together the
three signals — dot, word, dimming — say it once each in a different channel:
motion, text, contrast.

### A ref makes the guard true

`useRef` changes synchronously, so a second click in the same tick sees the flag
already set:

```tsx
const inFlight = useRef(false);
// onClick
if (inFlight.current || blocked) return;
inFlight.current = true;
void start();
```

`blocked` stays: it carries the *other* refusals (no dispatch binding, a
non-localhost host) and those still belong on the control. The ref answers one
question only — *is one of mine already running?*

**The ref is cleared where the state is cleared**, not in a `finally` beside the
`fetch`. The button stays in flight until the pulse confirms or gives up, and a
ref released at the end of the request would re-arm the button while it still
reads `starting…`.

**Local, not server-side.** A second browser tab is a different question with a
different answer — git holds the claim, and the host refuses a second merge —
and putting an in-flight registry in the server would add state the board does
not otherwise keep. This fixes the case that produced the report: one person,
one tab, two clicks.

### The button watches the fact its own action changes

`card.started` goes, and `waveSummary.claimed` takes its place. A dispatch
claims a branch, so the count it moves is the count the button should watch —
and unlike `started`, it moves again on every wave.

**Still derived, never asserted.** The change is which fact is read, not
whether the board waits for git to confirm it. The button's own comment stays
true: an optimistic update would make the board display something it does not
know, and this keeps the pulse as the source.

**`no change — see log` keeps its meaning and gets it back.** Today it fires
whenever a plan was already started, which is most of the time, so a message
meant for *the dispatcher declined and here is why* has been reporting a
successful dispatch instead. Watching the right count makes it rare again — and
rare is what lets it be believed.

**A plan whose waves are all claimed still says something honest.** With
`eligible: 0` there is nothing to dispatch, and the button should say so before
the click rather than after three pulses of silence. That is the same rule the
row action menu already follows: refuse with the reason, rather than accept and
disappoint.

### The test comes first, and decides whether the ref is needed

There is no double-click test today, so **the plan's own claim is unverified**.
The first branch writes the test — two clicks inside one tick, asserting exactly
one POST — and it either fails, confirming the defect, or passes, which would
mean React's batching already covers it and the ref is stock against a problem
that does not exist.

Writing the fix first would make that impossible to tell apart: a passing test
after a fix proves nothing about whether the fix was needed.

## Branches

### Proof

- `bug/acting-buttons-pin-the-double-click` — a browser test that clicks each
  acting button twice inside one tick and asserts a single request; the fix
  (a `useRef` latch) lands only if the test fails first

### Truth

- `bug/start-work-watches-the-right-count` — the button derives its outcome from
  `waveSummary.claimed` rather than the plan-level `card.started`, so a dispatch
  on an already-started plan reads as success instead of *no change*; a plan
  with nothing eligible refuses before the click

### Feedback

- `feature/acting-buttons-pulse-while-acting` — the in-flight button carries the
  WORKING dot, keeps its label change, and dims; `motion-reduce` keeps the dot
  and stops the animation

Three waves, sequential, and the order is deliberate. **Proof** settles whether
the guard is broken at all — writing a fix first would make a passing test
unreadable. **Truth** comes next because it is the defect that makes the button
look dead, and because a pulsing dot over a wrong outcome would be a livelier
lie. **Feedback** last, once the button reports the right thing to decorate.

All three edit `StartWorkButton.tsx`, and two of them `ApproveButton.tsx` — the
second reason not to run them together. This session paid four manual conflict
resolutions in one hour for two branches meeting in the same objects, every one
of them a union with no real disagreement.

## Done when

- **Two clicks inside one tick produce exactly one request.** Assert per button.
  This is the whole of the first wave, and it must be written before the fix so
  that a red test is what justifies the fix.
- **A slow single click still works.** The pairing that matters: a latch that
  never releases passes the assertion above and breaks the button.
- **The latch releases when the pending state does**, not when the request
  returns. Assert the button is still refusing while it still reads `starting…`
  — a `finally` beside the `fetch` re-arms it too early.
- **`blocked` still refuses for its own reasons.** Assert an unavailable
  dispatch binding and a non-localhost host still refuse: the ref answers *is
  mine already running*, not *may this act at all*.
- **An in-flight button carries the WORKING dot.** Assert it is the same
  indicator the rows use, not a second one.
- **`motion-reduce` stops the animation and KEEPS the dot.** Both halves —
  removing the element would take the marker with the motion, which is the rule
  `working-rows-show-motion` settled.
- **The label still changes.** Assert `starting…` / the approve equivalent
  survive: motion must never be the only carrier, and a screen reader gets the
  word rather than the dot.
- **The button dims while in flight**, and returns to full contrast when the
  pulse resolves it.
- **An idle button carries no dot.** Trivial by construction and asserted so
  nobody later renders it unconditionally.
- **A dispatch on an ALREADY-STARTED plan reads as success.** Assert the live
  shape from 2026-08-17: `started: true`, `claimed: 0`, `eligible: 1` — the
  exact card whose button appeared to do nothing.
- **`no change — see log` still fires when the dispatcher really declines.**
  The pairing: a fix that simply stops showing the message passes the assertion
  above and removes a true signal.
- **A plan with `eligible: 0` refuses before the click**, naming the reason,
  rather than accepting and reporting nothing three pulses later.
- **The outcome is still DERIVED from the pulse.** Assert the button does not
  move the row itself — an optimistic update would make the board display
  something it does not know, and this changes which fact is read, not whether
  git confirms it.
- `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`, `pnpm run validate`
  all pass.
- `pnpm build:board` run in the implementing worktree and the artifact
  committed — CI gates on no-diff.
- A changeset is present, with its `bumps:` block.

## Notes

The report said *no activity indicator*. Measured, there is one — a label swap
and `aria-busy` — and it is too quiet rather than absent. Recording that
distinction because the fix is *make the existing feedback loud*, not *add
feedback*, and a reader who believes the stronger claim would look for the wrong
thing in the code.

Deliberately out of scope: a second browser tab, and two people on two machines.
Git holds the claim for dispatch and the host refuses a second merge, so the
damage is already bounded; what is missing is the page saying so, and that is a
per-tab question.

Also out of scope: an in-flight registry on the server. It would be state the
board does not otherwise keep, for a case the git layer already settles.
