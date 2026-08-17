## Implementation brief — acting-buttons-show-they-act, wave 3 (Feedback)

- **Plan (canonical):** `docs/plans/2026-08-17-acting-buttons-show-they-act.md` on `main`
- **Approved:** 2026-08-17, jwloka, plan-PR #171 merged (two interrogation rounds)
- **Branch:** `feature/acting-buttons-spin-while-acting` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

### What to build

The in-flight button carries a **spinner**: it keeps the label change and
`aria-busy` it already has, and gains a visible marker plus dimming, so a click
that is being acted on looks different from one that was never received.

This is the last of three waves and the order was deliberate. Wave 1 (#173)
proved the double-click guard was really broken and latched it with a ref. Wave
2 (#174) fixed **what the button watches for success** — until that landed, a
spinner would have been, in the plan's words, *"a livelier lie"*: motion over an
outcome the button was reading wrong. The button now reports the right thing.
This wave decorates it.

### The measurement

Reported live: *"Click on actions like 'Start work' or 'Approve' don't have an
activity indicator AND they can be clicked multiple times. User does not see
that. Action is going to be executed."*

Two defects in one sentence. The clicking half is fixed. The **seeing** half is
this wave: today the only in-flight signal is the text swapping to `starting…` /
`approving…`, which is easy to miss on a control the reader is not looking
directly at, and indistinguishable at a glance from a button that did nothing.

### Six decisions the plan settles — do not re-derive them

**A SPINNER, not the rows' pulsing dot.** `AgentList.tsx:322` has a `LiveDot`
— `animate-pulse`, emerald, `aria-hidden` — shown when `isLive(row)`. Do **not**
reuse it and do **not** unify the two. They mean different things:

| Indicator | Meaning |
|---|---|
| `LiveDot` on a row | *something is alive, end unknown* — a row can pulse for hours |
| Spinner on a button | *an answer is coming*, within a few pulses |

One indicator for both would make every WORKING row promise a completion
nothing measures. Assert the two are distinguishable.

**`motion-reduce` stops the animation and KEEPS the marker.** Both halves. The
rule `working-rows-show-motion` settled this: removing the element under
`motion-reduce` would take the marker away with the motion, leaving a reader who
prefers reduced motion with *less* information rather than the same information
held still. `LiveDot` already models the pattern —
`animate-pulse … motion-reduce:animate-none`.

**The spinner is `aria-hidden`.** The state is already announced twice — the
label (`starting…` / `approving…`) and `aria-busy`, both landed in earlier
waves. A third announcement from the marker is noise. Assert a screen reader
hears it once.

**The label still changes.** Motion must never be the only carrier. Keep
`starting…` and `approving…` exactly as they are; the spinner is added beside
the word, never instead of it. Same rule as the repo's *symbol AND word*
convention in the PR cell.

**The button dims while in flight** and returns to full contrast when the pulse
resolves it — tied to the same state that drives the label, not to a separate
timer.

**An idle button carries no spinner.** Trivial by construction, asserted so
nobody later renders it unconditionally.

### Done when

- **An in-flight button carries a spinner, and it is distinguishable from
  `LiveDot`.** Assert both — a change that unifies them passes any
  "is there a marker" test.
- **`motion-reduce` stops the animation and KEEPS the marker.** Assert both
  halves; a fix that hides the element under `motion-reduce` passes a
  motion-only assertion.
- **The spinner is `aria-hidden`** — the state is announced once, not three
  times.
- **The label still changes** — `starting…` / `approving…` survive.
- **The button dims in flight and returns to full contrast** when resolved.
- **An idle button carries no spinner.**
- **The WORKING rows still pulse.** The regression that matters: a change that
  unifies the two indicators passes every button assertion above and quietly
  makes every row claim a progress nothing is measuring. Assert `LiveDot` is
  untouched.
- **The ref latch from #173 and the count-watching from #174 still work.**
  Assert two clicks in one tick still produce one request, and that a dispatch
  on an already-started plan still reads as success — this wave edits the same
  two files and must not disturb either.

Plus: `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`,
`pnpm run validate` all pass; `pnpm build:board` run **in your own worktree**
and the artifact committed (CI gates on no-diff); a changeset is present with
its `bumps:` block. **Do not edit versions by hand.**

### Three things wave 2 discovered — they change how you work

**There is no component-test seat.** Vitest runs with `environment: 'node'` — no
jsdom, no React Testing Library — and the browser path cannot produce a fleet
pulse because the fixture garden is not a git repo. Wave 2 therefore put its
decisions in **exported pure functions** and asserted those, using browser tests
only for what genuinely needs a page. Follow the same split: the
`motion-reduce`, `aria-hidden` and dimming assertions want a real page; anything
that reduces to a predicate should be a pure function.

**Rebase surface, named by the author of wave 2:** new exports sit above
`PULSES_BEFORE_GIVING_UP`, and the `startedRef` effect body was replaced. The one
place your work meets theirs is `blocked`, now
`starting || refusal !== undefined`, with a companion `refusal` string that both
`title` and an `sr-only` span read from.

**Read `refusal`, do not re-derive it.** The dimming must key off that same
`refusal` value rather than re-consulting `dispatch.available` — two derivations
of one fact are how the two gates start disagreeing.

**The Agents tab inherits the refusals consistently:** `RowActions` gates on
`isStartable(row) && dispatch.available`, and a row is only startable when its
wave is eligible, so the two gates cannot disagree today. You edit that file's
neighbours — keep it that way.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's
`## Branches` section on `main`. **Push your first real commit as soon as it
exists.**

### Scope guard

`packages/board/src/app/components/StartWorkButton.tsx`,
`packages/board/src/app/components/ApproveButton.tsx`, and their tests. A shared
spinner component is fine if both buttons use it.

**Do NOT touch `AgentList.tsx`'s `LiveDot`** — it is the thing you must not
disturb, not a thing to extend.

**Do NOT change the ref latch (#173) or what the button watches for success
(#174).** Both landed in these exact files; you are adding a visual layer over
logic that is settled.

**Note on `ApproveButton`:** it uses `aria-disabled` rather than the native
`disabled` attribute, deliberately and with the reason in a comment (a natively
disabled button leaves the tab order). Keep that as it is.

**One other branch may be in flight:** `feature/card-shows-interrogation-rounds`
(`schema.ts`, `PlanCard.tsx`) — no overlap with you except the artifact.

`.gitattributes` marks `skills/plot/scripts/board/board-server.mjs` as `-merge`:
on a conflict there, take **either** side, run `pnpm build:board`, `git add` it,
continue. **Do not read that diff** — the rebuild overwrites whichever side you
took, so the choice genuinely cannot matter.

**Note on test fixtures:** on 2026-08-17 a branch failed CI because a sibling
had added one contract field and a whole-object `toEqual` against a hand-written
fixture did not know about it — `merge-tree` compares lines, not expectations.
Prefer asserting the fields you care about over the whole object.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
