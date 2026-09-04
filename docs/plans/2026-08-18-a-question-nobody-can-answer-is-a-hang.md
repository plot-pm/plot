# A question nobody can answer is a hang

> Fifteen skills tell an agent to ask the user. Under `claude -p` there is no user, so the run waits for an answer that will never arrive — until the workflow's timeout kills it, with no output saying what it was waiting for.

## Status

- **Phase:** Released
- **Type:** bug
- **Story:** plot-gates
- **Sprint:** the-board-tells-the-truth
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-18, jwloka, in-session
- **Started:** 2026-08-18, Jan Wloka, `feature/skills-know-when-nobody-is-there`
- **Delivered:** 2026-08-19, jwloka, PRs #230, #250
- **Released:** 2026-08-22, v2.7.0
- **Started:** 2026-08-19, Jan Wloka, `feature/the-worker-command-says-nobody-is-watching`

## Changelog

- Plot skills detect that no human is present and take a documented path instead of asking, so an unattended run ends with a decision or a refusal rather than a timeout.

## Motivation

Found 2026-08-18 while designing a sprint gate, and it is older and wider than
the gate that surfaced it.

Every Plot skill carries the same instruction:

> **User interaction:** Use `AskUserQuestion` (Claude Code) / `ask_question`
> (Cursor) for all questions, proposals, and confirmations.

Fifteen skills repeat it — every spoke, the hub, and the companions. It is the
right instruction when a person is there.

### Where the hang comes from

**No Plot script reads from a keyboard.** Verified across
`skills/plot/scripts/*.sh`: every `read` is a pipe loop (`while read -r br`),
never a prompt. So the hang is not a shell waiting on stdin — the shells are
fine.

The question is asked by the **agent**, through a tool. Under `claude -p` — the
form this repo's own `Worker command` uses, and the form a CI release would use
— that tool call has no one to answer it. The run does not fail; it waits.
The workflow's timeout eventually kills it, and the log ends mid-question with
no statement of what was being asked or what would have happened either way.

**A timeout is the worst available failure here**, because it destroys the
information: an agent that refused would have said why, and an agent that
proceeded would have said what it assumed. A killed process says neither.

### Why this has not bitten yet, and why that is luck

This session dispatched five workers through `claude -p` and none hung. The
reason is in the briefs, not in the skills: every brief said *"decide, and say
which way you went and why"* rather than *"ask"*. That phrasing was chosen to
keep workers autonomous, and it happened to route around a defect nobody had
named.

That is not a safeguard. It is one author's habit, applied by hand, per brief.
The next brief that says "ask the user" produces a worker that waits until the
harness kills it.

### Why it will bite

`docs/plans/2026-08-18-a-sprint-names-what-it-ships.md` adds a confirmation
prompt to `/plot-release` for unfinished Should Haves. A release cut from CI is
exactly the case that plan flags and cannot answer. The same is true of
`/plot-dispatch` (two `AskUserQuestion` sites) and `ralph-plot-sprint`, whose
entire purpose is unattended operation.

## Design

### Approach

**Skills detect that no human is present, and take a documented path instead of
asking.**

`PLOT_UNATTENDED=1` states it explicitly. Nothing is inferred from a missing
TTY: an agent under `claude -p` may well have a TTY attached, and a human in a
piped shell may not, so the absence of a terminal answers a different question
than the one being asked. The variable says *there is nobody to answer*, which
is the only thing that matters here.

**Every question site declares its unattended behaviour.** Three shapes, and
which one applies is a decision the skill author makes per question, not a
global default:

| Shape | When | Example |
|---|---|---|
| **Proceed with the documented default** | the question is a confirmation of something already decided | unfinished Should Haves — warn, cut the release |
| **Refuse and say what was needed** | proceeding would commit something a person owns | release sign-off, approving a plan |
| **Report and stop cleanly** | the question is a choice with no safe default | which MoSCoW tier an item belongs in |

The third shape is not the same as hanging: it exits, names the question it
could not ask, and leaves the state untouched.

**Whatever the shape, the output says a question was skipped and what it was.**
An unattended run that silently took a default is the same defect this repo has
removed nine times — an unobserved thing reported as an observed one. The
release notes must be able to say *"cut with 3 Should Haves open; nobody was
asked"*.

### The refusals stay refusals

`PLOT_UNATTENDED=1` never converts a gate into a pass. A Must-Have gate, an
unapproved plan, an unmerged branch — those refuse in both modes. The variable
answers *may I ask?*, never *may I proceed?*, and a skill that used it to skip
a check would be using it for the opposite of its purpose.

This matters because the variable will be set in exactly the environment with
the least supervision. Its power must be strictly smaller than the operator's.

### Where it is set

The `Worker command` in a repo's Plot Config is the natural home — this repo's
already launches `claude -p`, so it becomes:

```
Worker command: PLOT_UNATTENDED=1 claude -p "..."
```

`ralph-plot-sprint` sets it for its own loop, and a CI release workflow sets it
in the job. None of that is Plot enforcing configuration (Principle 4): a repo
that never runs Plot unattended never sets it and sees no change at all.

### Alternatives considered

**Infer from `[ -t 0 ]`.** Rejected: it tests for a terminal, and the question
is whether a *person* is reachable. Both false positives (an agent with a TTY)
and false negatives (a human behind a pipe) are ordinary.

**A timeout on the question.** Rejected: it turns a hang into a slower hang,
and the default it eventually takes is the one nobody chose. A documented
default taken immediately is strictly better than the same default taken after
ten minutes of waiting.

**Forbid questions in skills entirely.** Rejected: it would make Plot worse for
the case it is mostly used in. A person at a terminal *should* be asked.

### Open Points

- [ ] Does `AskUserQuestion` itself return something when nobody answers, or
      does it block indefinitely? The behaviour was inferred from the shape of
      the harness, not measured — and if it already errors or times out, the
      fix is smaller than this plan assumes. **Measure before building.**
- [ ] Should the hub warn when it sees `PLOT_UNATTENDED` set in an interactive
      session? It means a worker command leaked into a human's shell, and every
      subsequent question would silently take its default.
- [ ] Fifteen skills carry the interaction line. Does each need its own
      unattended clause, or does one shared reference file cover them with the
      per-question shape declared inline?

## Slices

- `feature/skills-know-when-nobody-is-there` — `PLOT_UNATTENDED` documented once and referenced by the skills that ask, with each question site declaring its shape (default / refuse / stop). Tests: a skill under `PLOT_UNATTENDED=1` takes its documented path without calling the question tool; the same skill unset still asks; a gate refuses in both modes; the output names every question that was skipped. — PR #230

- `feature/the-worker-command-says-nobody-is-watching` — this repo's own `Worker command` and `ralph-plot-sprint`'s loop set the variable, so dispatched workers stop depending on brief wording to avoid the hang. Tests: a dispatched worker runs with the variable set; a brief that says "ask the user" produces a decision or a clean stop rather than a wait. — PR #250

## Notes

Surfaced by an operator asking *how does the hang actually happen* about an
open point that had been recorded without an explanation. The answer changed
the plan's scope: the sprint gate is one instance of a defect that fifteen
skills share, and the fix belongs where the instruction lives rather than in
the newest command to inherit it.

Measured while writing: five workers ran through `claude -p` this session and
none hung, because every brief said "decide and report" rather than "ask". The
absence of the failure was a property of the briefs, not of Plot.
