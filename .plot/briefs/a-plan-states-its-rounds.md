## Implementation brief — the-plan-file-states-what-the-board-shows (wave Stated)

- **Plan (canonical):** `docs/plans/2026-08-26-the-plan-file-states-what-the-board-shows.md` on main
- **Approved:** 2026-08-26, Jan Wloka, in-session (2 rounds)
- **Branch:** `infra/a-plan-states-its-rounds` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

Wave 1 of 2. `Written` teaches the skill to WRITE the field; this wave teaches
the parser to READ it. They are independent — this one can land alone and is the
prerequisite for the other being useful.

### What to build

`plot-plan-meta.sh` resolves `rounds` from `## Status` `Rounds:` first, YAML
front matter `rounds:` second, and the `CHALLENGE-THE-PLAN-METADATA` block last.
The template declares the field.

### The decisions the plan settles — do not re-derive them

**The block keeps being read. Permanently.** 40 plans on main carry only the
comment; a parser that stopped reading it would blank their rounds on the board
the day this lands. This is a preference order, not a migration window.

**Follow the shape that already exists.** `Sprint:`, `Story:` and `Assignee:`
each resolve from `## Status` **or** front matter, and each treats an
HTML-comment placeholder as absent rather than as a value. Read how they are
coded and match it — `- **Rounds:** <!-- optional -->` must report nothing. Do
not invent a fourth spelling of *absent*.

**Absent is not zero, and the distinction is load-bearing.** `""` means *no
readable round*; `0` would mean *interrogated and found nothing*. The parser
already protects this and so does `roundsBadgeText` in the board. A change that
collapses them breaks a rule two components depend on.

**The field wins a disagreement.** During the transition a plan may carry both
and they may differ. A reader trusts what the file says.

### Done when

The plan's `## Done when` items 1, 2, 3, 4 and 7 are this wave's specification
(5 belongs to `Written`, 6 spans both).

Four cases, and item 2 is the one a naive implementation fails:

- **Item 1** — `Rounds: 3` in `## Status`, no block at all → `rounds=3`
- **Item 2** — block only, no field → unchanged, asserted against one of the 40
  REAL plans. A fix that REPLACES the source passes item 1 and silently blanks
  40 plans.
- **Item 3** — both present and disagreeing → the field wins
- **Item 4** — neither → absent, **not** zero

Plus item 7: **the 645 contract tests stay green** with your four new cases
added. This file is the plan-format contract and every Plot script is downstream
of it.

### Blast radius

`plot-plan-meta.sh` is read by `plot-fleet-scan.sh`, `plot-reconcile-scan.sh`,
`plot-approve.sh`, `plot-impl-status.sh`, `plot-sprint-release.sh` and the
board's `board.ts`. A parse regression does not fail loudly — it makes a plan
report the wrong thing, which is how 40 plans could lose their rounds without
any test noticing. That is why item 2 asserts against a real plan and not only a
fixture.

**A test parsing the whole live estate was considered and REJECTED** in the
plan: it couples the suite to the repo's contents rather than to the format.
Do not add one.

### A trap this repo has already paid for

`plot-plan-meta.sh`'s awk region is inside a single-quoted shell string. **Never
put an apostrophe in an awk comment there** — `awk's` closes the quote early and
produces syntax errors that read as something else entirely.

### Bookkeeping

When the PR exists, annotate the wave heading on main — `## Waves` plan, so the
PR goes **inside** the heading:

```
### Stated (Branch: infra/a-plan-states-its-rounds, PR: #N)
```

A trailing `→ #N` parses as `prs=[]`. Check `git branch --show-current` is main
before that edit. Push your first real commit as soon as it exists, and run
every test in the FOREGROUND — a `-p` run receives no notification.

### Scope guard

This branch owns `skills/plot/scripts/plot-plan-meta.sh`, `.plot/templates/plan.md`
and the reconcile contract tests.

**Do not touch** `skills/challenge-the-plan/` — that is wave `Written`.
**Do not migrate any plan** under `docs/plans/`: Done-when 6 asserts the diff
contains none, and the fallback is what makes migration unnecessary.

`packages/board/plot-plan-meta.sh` is a VENDORED copy produced by
`pnpm build:board`. Do not hand-edit it; rebuild if the build touches it.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
