# Brief: feature/a-sprint-names-its-release

Implement wave 1 of `docs/plans/2026-08-18-a-sprint-names-what-it-ships.md`.

Read it first. Four design questions were settled with the operator; they are
in the plan and are **not open**.

## The bug

A sprint carries `Phase`, `Start`, `End` and a narrative goal — but no version.
The release connection exists as prose in both directions and as a fact in
neither:

```
plot-release/SKILL.md:97   "Sprint completion is informational —
                            it does not block the release."
plot-sprint/SKILL.md       "If all planned work is delivered: /plot-release"
```

Both commands mention the other and neither can check. Exactly the rule/gate
distinction CLAUDE.md asks about: a release cuts whether or not the Must Haves
landed, and nobody finds out until the sprint closes with unfinished ones.

## What to build

**`Release:` as an optional field** in the sprint format and its parser:

```markdown
## Status
- **Phase:** Active
- **Start:** 2026-08-18
- **End:** 2026-08-22
- **Release:** 2.5.2
```

A sprint with no `Release:` behaves exactly as today.

**Two tiers, two treatments** — this is the settled decision, not a choice:

- **Must Haves refuse.** `/plot-release` will not cut past an unfinished one,
  and `--ignore-sprint` is the named escape (in the tradition of
  `--allow-local`, `--during-release`).
- **Should Haves prompt.** Named, answered yes or no in the moment, **no flag**
  — the confirmation *is* the record that a person looked. A hard gate on
  stretch goals is one operators learn to force past; silence makes a release
  cut with three Should Haves open a decision nobody made.
- **Could Haves neither block nor prompt.**

**The override writes itself into the sprint's Notes:**

```markdown
## Notes

- 2.5.2 cut 2026-08-18 with `--ignore-sprint`; 1 Must Have open:
  [one-place-for-what-a-row-can-do]
```

This couples the release command to a sprint file deliberately: the retro asks
what the timebox changed, and that is exactly the fact it cannot reconstruct
from a shell history. Same reason `Approved:` and `Delivered:` are records in
the plan rather than notes in a log.

**`/plot-sprint close` reports the release state and never refuses.** Closing a
sprint whose release slipped is legitimate; a command that would not let a
timebox end lies about what a timebox is.

## Do not

- **Do not validate the version string.** `Release: 2.5.2` is named before it
  is cut. The gate validates the sprint's **Must Haves**, never the version — a
  typo is caught by the release command failing on its own terms.
- **Do not make `--ignore-sprint` skip anything else.** It clears the sprint
  gate and nothing more.

## The open point you must answer

What happens when the release is cut from CI rather than a terminal? A prompt
nobody can answer is a hang — see
`docs/plans/2026-08-18-a-question-nobody-can-answer-is-a-hang.md`, whose
`PLOT_UNATTENDED=1` is the intended answer (prompt becomes a warning, the
Must-Have gate still refuses). If that branch has not landed, implement the
degradation here and say so.

## Definition of Done

- A sprint with unfinished Must Haves refuses the release and names them
- `--ignore-sprint` proceeds **and writes** the version, date and open items
  into the sprint's Notes
- Finished Must Haves with open Should Haves prompt and name them; answering
  no cuts nothing
- Could items never block or prompt
- A sprint with no `Release:` behaves exactly as today
- Closing a sprint whose release was not cut succeeds, with a report
- `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:e2e`,
  `pnpm run test:board` pass — run the suites **one at a time**
- A changeset with a `bumps:` block

## Context you will want

`docs/sprints/2026-W34-the-board-tells-the-truth.md` is this repo's **first
sprint**, created 2026-08-18 — six months after sprint support shipped, with
0 of 53 plans carrying a `Sprint:` field in between. It has Must, Should and
Could tiers and no `Release:` field, which is what this branch adds.

## Platform note

CI runs Linux; you are probably on macOS. Faults caught this way: `stat -f`
does not fail cleanly on GNU, and `/usr/bin:/bin` is not an isolated PATH
because CI ships a real `gh` there.

If you find something the plan did not anticipate, implement what you can and
**report the discovery** rather than improvising.
