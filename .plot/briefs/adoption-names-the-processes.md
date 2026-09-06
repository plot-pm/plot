## Implementation brief — adoption-names-the-processes (slice: Saying so where a user looks)

- **Plan (canonical):** `docs/plans/2026-09-05-a-process-is-started-by-its-own-command.md` on `main`
- **Story:** `the-master-agent-holds-the-fleet`
- **Branch:** `docs/adoption-names-the-processes` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

**The last slice of five, and the one the plan exists for.** Slices 1–4 merged as #708, #712, #722 and #741. **This unblocks the plan's delivery** — `/plot-deliver` refuses today naming this branch alone.

## What this delivers

`/plot-init` and `/plot-board-setup` name both runtime commands in their closing summary, and the root README's skills table carries all three.

**THE SUPERVISOR WAS INVISIBLE, and a door nobody is told about is the same as no door.** Verified 2026-09-06: `skills/plot-init/SKILL.md` names `plot-fleet` and `plot-board` **zero times**. The plan built the doors; nothing tells a reader they exist.

## Name them with their prerequisite, not only when runnable

`/plot-init` runs in repositories with no board artifact and no built daemon. **Offering only what works there would say nothing at all — which is exactly how the supervisor came to be invisible.**

```
Next:
  /plot-board --start   — needs @plot-pm/board (pnpm build:board, or install it)
  /plot-fleet --start   — same package; supervises the agents you dispatch
```

**A MISSING PREREQUISITE IS A FACT, NOT A REASON FOR SILENCE.** A reader told a command exists and what it wants can go and get it; a reader told nothing cannot learn the thing exists at all.

**The probe still runs** — it is what fills in *which* prerequisite is missing. **Its answer changes the SENTENCE, never whether there is one.**

## The three files

| file | what changes |
|---|---|
| `skills/plot-init/SKILL.md` | closing summary names both commands — it has a `Next:` block already |
| `skills/plot-board-setup/SKILL.md` | same, and it already mentions the board 19 times, so this is the fleet's line |
| `README.md` | the skills table carries all three; `plot-board-setup` is at `:164`, `plot-board --start` is described at `:57` |

## Done when

- a reader who has just run `/plot-init` in a fresh repository is told, **in that command's own output**, that `/plot-board --start` and `/plot-fleet --start` exist, what each does, and what each needs before it will run
- `/plot-board-setup` does the same
- the README's skills table carries all three
- the sentence appears whether or not the prerequisite is present
- `pnpm test` passes (it validates every skill parses)

## Do not

- **Do not gate the sentence on the prerequisite.** Silence when the artifact is missing is the defect, not the fix.
- **Do not add flags to the read path.** The plan settles this in its Notes: `/plot-pulse` derives and does not spawn.
- **Do not rename or re-scope either command.** They shipped in #712 and #722.
- **Do not rewrite the surrounding adoption prose.** The unit is the closing summary and the table row.
- **Do not run `pnpm run test:e2e`.** CI is its gate.
