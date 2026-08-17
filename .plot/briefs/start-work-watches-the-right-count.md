## Implementation brief — acting-buttons-show-they-act, wave 2 (Truth)

- **Plan (canonical):** `docs/plans/2026-08-17-acting-buttons-show-they-act.md` on `main`
- **Approved:** 2026-08-17, jwloka, plan-PR #171 merged (two interrogation rounds)
- **Branch:** `bug/start-work-watches-the-right-count` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

### What to build

`StartWorkButton` stops watching `card.started` and watches
`waveSummary.claimed` instead, so a dispatch on an already-started plan reads as
success rather than *"no change — see log"*.

Wave 1 landed as #173 — the double-click latch, with its test red first. This is
the defect that makes the button look **dead** rather than merely quiet.

### The measurement

Reported live: *`Start work` on `feature/agent-rows-line-up` doesn't do
anything.* Everything except the feedback said otherwise:

| Signal | Value |
|---|---|
| `dispatch.available` | `true` — the route is ready |
| Fleet scan | `Presentation — eligible`, one branch to take |
| `plot-dispatch --dry-run` | `would dispatch feature/agent-rows-line-up` |
| **The card** | **`started: true`** |

The click works. The dispatch would succeed. What fails is what the button
watches:

```tsx
const startedRef = useRef(card.started);
// …
if (card.started !== startedRef.current) { setState({ kind: 'idle' }); return; }
if (pulse - state.since >= PULSES_BEFORE_GIVING_UP) {
  setState({ kind: 'no-change', log: state.log });
}
```

**`card.started` describes the PLAN; the action starts a BRANCH.**

| Click | `card.started` | Button sees |
|---|---|---|
| wave 1 | `false` → `true` | the change ✓ |
| wave 2 | `true` → `true` | **nothing** ✗ |
| wave 3 | `true` → `true` | **nothing** ✗ |

And the button is on that card **deliberately**: `isReadyToStart` demands
`phase === 'Design' && started === false`, which this card fails on both counts,
but a second condition admits started Development cards — the button exists to
start the **next wave** as well as the first. So it has two jobs and a success
check that serves only the first. **Every plan with more than one wave breaks
from the second click onward** — which is every plan written this session.

### Four decisions the plan settles — do not re-derive them

**Watch `waveSummary.claimed`.** A dispatch claims a branch, so the count it
moves is the count to watch — and unlike `started`, it moves again on every
wave. The reported card read `claimed: 0, eligible: 1` before the click.

**Still DERIVED, never asserted.** The change is *which fact is read*, not
whether the board waits for git to confirm it. The button's own comment stays
true: *"An optimistic update would be faster and would make the board display
something it does not know."* Do not move the row from the button.

**Without a pulse, refuse rather than guess.** Measured: both counts are
`.optional()` in the contract — *"Absent when there is no pulse."* `card.started`
is always present, so this swap trades an always-there fact for a
sometimes-there one, and the gap falls exactly where someone opens a freshly
restarted board.

The honest answer there is *not yet*: without a scan the board does not know
which wave is eligible, so a dispatch would be a click into the dark and
unreportable afterwards. It dims and says it is waiting for the first scan — the
posture the board already takes when it has lost contact, not a fourth
vocabulary for *I don't know*.

**Do NOT fall back to `card.started` when the counts are missing.** That was the
alternative and it is worse: it keeps the defect alive in precisely the window
where it is most likely, hidden behind an apparently-working button.

**A plan with `eligible: 0` refuses before the click**, naming the reason,
rather than accepting and reporting nothing three pulses later. Same rule the
row action menu follows: refuse with the reason rather than accept and
disappoint.

**`no change — see log` keeps its meaning and gets it back.** Today it fires
whenever a plan was already started, which is most of the time — so a message
meant for *the dispatcher declined, here is why* has been reporting successful
dispatches instead. Watching the right count makes it rare again, and rare is
what lets it be believed.

### Done when

- **A dispatch on an ALREADY-STARTED plan reads as success.** Assert the live
  shape: `started: true`, `claimed: 0`, `eligible: 1` — the exact card whose
  button appeared to do nothing.
- **The SECOND wave's dispatch reads as success.** Assert a plan where wave 1 is
  claimed and wave 2 is eligible: `card.started` cannot change there, so a fix
  tested only on a first click passes without touching the defect.
- **`no change — see log` still fires when the dispatcher really declines.** The
  pairing: a fix that simply stops showing the message passes the assertion
  above and removes a true signal.
- **With no pulse the button refuses and says it is waiting for the first
  scan.** Assert `claimed`/`eligible` absent — the contract marks both
  `.optional()` for exactly this case, and a fix that reads them unguarded
  crashes or silently treats missing as zero.
- **It does not fall back to `card.started` when the counts are missing.**
- **A plan with `eligible: 0` refuses before the click**, naming the reason.
- **The outcome is still DERIVED from the pulse.** Assert the button does not
  move the row itself.

Plus: `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`,
`pnpm run validate` all pass; `pnpm build:board` run **in your own worktree**
and the artifact committed (CI gates on no-diff); a changeset is present with
its `bumps:` block. **Do not edit versions by hand.**

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's
`## Branches` section on `main`. **Push your first real commit as soon as it
exists.**

### Scope guard

`packages/board/src/app/components/StartWorkButton.tsx` and its tests.
`PlanCard.tsx` only if the readiness rule genuinely needs it.

**Do NOT add the spinner** — that is wave 3
(`feature/acting-buttons-spin-while-acting`), which rebases onto you and edits
the same file.

**Do NOT touch the ref latch from #173.** It answers a different question — *is
one of mine already running?* — and stays exactly as it is.

**One other branch is in flight:** `feature/agent-rows-line-up` (the row grid),
editing `AgentList.tsx` and rebuilding the artifact. No overlap with
`StartWorkButton.tsx` except the artifact.

`.gitattributes` marks `skills/plot/scripts/board/board-server.mjs` as `-merge`:
on a conflict there, take **either** side, run `pnpm build:board`, `git add` it,
continue. **Do not read that diff.**

**Note on test fixtures:** on 2026-08-17 a branch failed CI because a sibling
had added one contract field and a whole-object `toEqual` against a hand-written
fixture did not know about it — `merge-tree` compares lines, not expectations.
Prefer asserting the fields you care about over the whole object.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
