## Implementation brief — a-draft-plan-claims-no-approvals (wave: Derived)

- **Plan (canonical):** `docs/plans/2026-08-23-a-draft-plan-claims-no-approvals.md` on `main`
- **Approved:** 2026-08-23, Jan Wloka, in-session
- **Branch:** `bug/a-wave-head-says-what-its-verdict-says` (base: `main`)
- **Ends as:** one PR to `main`

Independent — nothing blocks you and you block nothing.

### What to build

**A folded wave head says what its verdict says, instead of asserting that work
landed.**

`groupedNote`'s fallback (`AgentList.tsx:753`) returns a claim:

```ts
default: return 'work landed — waiting to be merged';   // any unrecognised word
```

And the call site short-circuits before the verdict can correct it:

```ts
soleRow ? soleNote
  : groupedCount !== undefined ? groupedNote(groupedWord)   ← taken for ANY multi-branch wave
  : group.verdict === 'eligible' ? 'approved — nobody has taken it'
  : group.verdict === 'blocked'  ? 'an earlier wave has to land first'   ← unreachable
```

`groupedCount` is defined for every grouped head, so **the two verdict arms are
dead for every wave with more than one branch.**

### The whole live population — five waves, all `blocked`

Measured 2026-08-23. This is the entire set that reproduces it today:

```
a-dispatch-hands-over-a-brief     Handed over      2 branches
a-folded-row-still-says-...       Folded           3 branches
the-budget-is-spent-where-...     Spent well       2 branches
the-wave-is-a-thing-the-board...  Consumed         4 branches
opus5-longhorizon-hardening       Implementation   5 branches
```

**Every one has `verdict: blocked`**, so every one should read *an earlier wave
has to land first* — and every one currently claims work landed.

**The claim is false, not merely unhelpful.** Traced on
`a-dispatch-hands-over-a-brief`: no PR was ever opened on any of its three
branches, no ref was ever pushed, nobody merged anything.

**And the row below contradicts the head.** Those branches carry
`note: "plan not approved yet — still in review"` — the truth, two lines under a
head saying the opposite in bold amber.

### The decisions the plan settles — do not re-derive them

**A note is DERIVED, never defaulted into.** `groupedNote` answers only for words
it knows (`delivered`, `stalled`) and returns `''` otherwise, letting the call
site fall through to the verdict — which is the value that actually describes the
wave.

**Do NOT special-case the draft phase.** Checking `phase === 'Discovery'` before
printing would silence today's instance and leave the fallback wrong for every
other unrecognised word. **The defect is a fallback that asserts**, not drafts
specifically.

**Absent is not false, and here it was worse than false:** absent became a
positive claim about work that does not exist.

### Done when

The plan's `## Done when` is the specification. Beyond it:

- **All five live cases render their verdict** — each reads *an earlier wave has
  to land first*. That is the whole population, so a fix verified on one is
  verified on the shape.
- `groupedNote` returns `''` for an unknown word — asserted **directly**. An
  implementation that keeps the sentence and adds a phase check passes every
  other test here and leaves the defect.
- The two known words still answer as they do today (`delivered`, `stalled`).
- **A multi-branch wave can reach the verdict arms at all**, asserted for both
  `eligible` and `blocked`. That path is dead today, and a test using only
  single-branch waves cannot detect it.

Plus the repo's gates: `nvm use` (Node 24), `pnpm run test:board` green,
`pnpm build:board` with the artifact committed, a changeset, `trash` not `rm`.

### Bookkeeping

Append `→ #<number>` to this branch's line on `main` when the PR exists.
**Push your first real commit as soon as it exists, and run every test in the
FOREGROUND** — several workers stalled today by ending a turn awaiting a
notification a `-p` run never receives.

### Scope guard

You own `groupedNote` and the `waveNote` ternary. **Not** the row's status word —
that is `bug/the-row-says-whether-you-can-start-it`, a separate plan, and the two
are the same finding at two levels: **that one owns the status, this one owns the
note.**

`AgentList.tsx` is held by several in-flight branches including the sprint's
pivot. **Keep the diff minimal** — this should be a small change to one function
and one ternary.

**Do not commit `packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json`.**
Never `git add -A` in this worktree.

One open question the plan records rather than answers: **`2 to approve` sits
beside the false sentence** and was not separately traced. Confirm it falls out
of this fix rather than assuming it does.
