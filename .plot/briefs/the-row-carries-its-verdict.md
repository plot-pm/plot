# Brief: feature/the-row-carries-its-verdict

Implement wave 1 of `docs/plans/2026-08-17-a-wave-says-what-it-waits-for.md`.
Read the plan first. This wave is the field its two siblings read.

## Half of this is already built — verified, so you do not repeat it

Measured 2026-08-20:

| Piece | State |
|---|---|
| `WaveVerdictSchema = z.enum(['complete','eligible','blocked'])` | **exists**, `schema.ts:465` |
| `verdict` on the **wave** | **exists**, `schema.ts:890` |
| `verdict` on **attention items** | **exists**, `schema.ts:1835` |
| `verdict` on **`AgentRowSchema`** | **MISSING — this is the wave's work** |

The vocabulary and the reasoning are also already written. `schema.ts:596`
carries the argument this branch was supposed to make:

> *"A FIELD RATHER THAN A STRING MATCH, and this is load-bearing."*

`ELIGIBLE_NOTE` (`:506`) is matched by string today, and `isStartable` keys on
that comparison. **That is what the field replaces**, and it is the reason the
field must exist before its siblings: `a-branch-row-names-its-wave` and
`a-blocked-wave-names-its-blocker` both read a row's verdict, and neither may
read it out of prose.

## What to build

**`verdict` becomes a field on `AgentRowSchema`, written by `classify()`,
additive and defaulted.**

Additive and defaulted is not a style note. A client talking to an older server
must still validate, which is the rule `issueAnswer` follows a few hundred lines
below — copy that shape rather than inventing one.

**Reuse `WaveVerdictSchema` if the three values fit a row.** Decide deliberately:
a wave is `complete | eligible | blocked`, and a row may need a fourth state or
may not. If you add one, say why; if you reuse, say that too. What must not
happen is a second three-value enum that means almost the same thing.

## The collapse, and where it actually lives

The plan says `fleet.ts:1054`. **That line has moved** — four separate changes
landed in `fleet.ts` today. The real site is **`fleet.ts:2810`**:

```ts
const blocker = plan.waves.find((w) => w.verdict !== 'complete');
```

`!== 'complete'` treats **eligible** and **blocked** as one thing. A plan whose
first incomplete wave is *eligible* — startable, nobody has taken it — reports
that wave as the blocker of everything behind it. It is not blocking; it is
waiting to be picked up.

Split it so a finished wave stops claiming to block, and so the blocker search
distinguishes *this wave is not done* from *this wave cannot start*.

**The surrounding comment is worth preserving:** the search deliberately takes
the plan's **first** incomplete wave rather than the nearest, because *"a row
three waves down is released by its predecessors in order, so the one a reader
can do something about is the one at the front of the queue."* Keep that
property.

## Definition of Done

- `verdict` is on `AgentRowSchema`, additive and defaulted; an older payload
  still validates — assert it
- `classify()` writes it, and the value agrees with the note the row already
  carries for the same case — assert the pair, since disagreement between a
  field and its prose is what this field exists to end
- The `complete`/`blocked` collapse at `fleet.ts:2810` is split: an eligible
  wave is not reported as a blocker
- The first-not-nearest blocker property still holds
- Nothing new keys on `ELIGIBLE_NOTE` by string comparison
- `pnpm run test:board` green, `pnpm run typecheck` green
- `pnpm build:board` run in THIS worktree and the artifact committed
- A changeset with a `bumps:` block

## Do not

- Do not implement the wave label or the blocker name — those are
  `a-branch-row-names-its-wave` and `a-blocked-wave-names-its-blocker`, both
  waiting on this field
- Do not remove `ELIGIBLE_NOTE`; existing consumers still read the prose, and
  retiring the string match is a separate step
- Do not touch `plot-fleet-scan.sh` — the wave verdict is computed there already
  and this wave is board-side

## Platform notes

`fleet.ts` took four changes today; **rebase before you push** and expect the
board artifact to conflict — it is `-merge` in `.gitattributes`, so take either
side, run `pnpm build:board`, commit the rebuild. Never phrase it as "take
ours": *ours* inverts between merge and rebase.

CI runs Linux; you are probably on macOS. Run the suites **one at a time**. CI
now bounds its own steps (3 min on the Playwright install, 15 on the integration
suite, 25 on the job), so a hang fails fast instead of blocking.

**Line numbers in the plan have already drifted once** — 1054 is now 2810.
Follow the rule, not the number, and report any others you find.

If you find something the plan did not anticipate, implement what you can and
report the discovery rather than improvising.
