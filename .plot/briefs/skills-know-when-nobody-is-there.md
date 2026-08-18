# Brief: feature/skills-know-when-nobody-is-there

Implement wave 1 of
`docs/plans/2026-08-18-a-question-nobody-can-answer-is-a-hang.md`.

Read it first, **including its first open point** — one fact this plan rests on
was inferred rather than measured, and measuring it may make your work smaller.

## Measure this before building anything

The plan assumes `AskUserQuestion` **blocks indefinitely** when nobody can
answer. That was inferred from the shape of the harness, not observed. If the
tool already errors or times out under `claude -p`, the fix is far smaller than
the plan describes.

**Establish it first and report what you found**, whichever way it goes.

## The bug

Fifteen skills carry the same line:

> **User interaction:** Use `AskUserQuestion` (Claude Code) / `ask_question`
> (Cursor) for all questions, proposals, and confirmations.

Under `claude -p` — the form this repo's `Worker command` uses, and the form a
CI release would use — there is nobody to answer. The run does not fail; it
waits until the workflow's timeout kills it, and the log ends mid-question with
no statement of what was asked or what would have happened either way.

**No Plot script reads a keyboard.** Verified across `skills/plot/scripts/*.sh`:
every `read` is a pipe loop. The wait is the agent's tool call, not a shell.

It has not bitten because five workers this session ran on briefs that said
*"decide and report"* rather than *"ask"*. That is one author's habit applied
per brief, not a safeguard.

## What to build

`PLOT_UNATTENDED=1` — stated explicitly, **never inferred from a missing TTY**:
an agent under `claude -p` may well have one, and a human behind a pipe may
not, so the terminal answers a different question.

Each question site declares its unattended behaviour. Three shapes, chosen per
question by the skill author, not globally:

| Shape | When | Example |
|---|---|---|
| **Proceed with the documented default** | a confirmation of something already decided | unfinished Should Haves — warn, cut the release |
| **Refuse and say what was needed** | proceeding would commit something a person owns | release sign-off, approving a plan |
| **Report and stop cleanly** | a choice with no safe default | which MoSCoW tier an item belongs in |

The third is **not** the same as hanging: it exits, names the question it could
not ask, and leaves the state untouched.

**Whatever the shape, the output says a question was skipped and what it was.**
An unattended run that silently took a default is the same defect this repo has
removed nine times — an unobserved thing reported as observed.

## The one rule that must not bend

`PLOT_UNATTENDED=1` **never converts a gate into a pass.** A Must-Have gate, an
unapproved plan, an unmerged branch — those refuse in both modes. The variable
answers *may I ask?*, never *may I proceed?*

This matters because it will be set in exactly the environment with the least
supervision. Its power must stay strictly smaller than the operator's.

## Do not

- **Do not add a timeout to the question.** That turns a hang into a slower
  hang, and the default it eventually takes is the one nobody chose.
- **Do not forbid questions in skills.** A person at a terminal *should* be
  asked; this is about the case where there is none.

## An open point you must answer

Fifteen skills carry the interaction line. Does each need its own unattended
clause, or does one shared reference file cover them with the per-question
shape declared inline? Decide and **say why**.

## Definition of Done

- **The blocking behaviour is measured and reported**, before the design is
  committed to
- A skill under `PLOT_UNATTENDED=1` takes its documented path without calling
  the question tool; the same skill unset still asks
- A gate refuses in **both** modes
- The output names every question that was skipped
- `pnpm test` (skill parsing) passes, plus `pnpm run test:reconcile`,
  `pnpm run test:e2e`, `pnpm run test:board` — run the suites **one at a time**
- A changeset with a `bumps:` block naming every skill you touch

## Platform note

CI runs Linux; you are probably on macOS. Faults caught this way: `stat -f`
does not fail cleanly on GNU, and `/usr/bin:/bin` is not an isolated PATH
because CI ships a real `gh` there.

If you find something the plan did not anticipate, implement what you can and
**report the discovery** rather than improvising.
