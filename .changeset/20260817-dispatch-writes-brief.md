---
"plot": minor
---

`/plot-dispatch` now writes a hand-off brief per branch it fans out, by
invoking `/plot-implement` — the step it has always skipped.

Dispatch created a worktree, pushed a claim and booked a `Started:` record,
then stopped. Writing the brief was left to a person, and on 2026-08-17 a
person supplied it every time: three rows sat in WORKING with a pulsing green
dot while nobody was working on any of them. The claim was real; the hand-off
was never made.

**The caller is the SKILL, not the script.** No script in this repo invokes a
skill, and bash cannot reach one at all — skills exist inside an agent session.
That is the Manifesto's direction rather than an omission (*skills interpret and
adapt; scripts collect and report*), and a brief is interpretation: what it adds
over the plan is the alternatives already rejected and the measurements that
killed them. `skills/plot-dispatch/SKILL.md` is the session-level layer that
already drives the script through its phases, so the brief step lives there.
`plot-dispatch.sh` keeps doing exactly what it did.

**One definition of what an implementer needs to know.** A template string in
the dispatcher would be a second one, and it would drift from the first the way
every duplicated rule here has.

`plot-implement`'s brief template grew from 8 lines — a shape nobody had ever
used — to the shape the briefs written by hand actually take: a *what to build*
narrative, the settled decisions each with the measurement that killed the
obvious alternative, the assertions a naive implementation would pass without, a
bookkeeping duty and a scope guard naming the branches in flight. Real briefs
run 111–127 lines, and the difference is not padding. The brief lands at
`.plot/briefs/<branch>.md`, committed to the default branch, so a resumed or
replaced agent can read it without the dispatching session.

The brief step is Frontier tier in both skills' Model Guidance: naming which
alternatives a plan rejected is judgment, not template filling.

**A direct script call reports the gap rather than refusing.** The summary gains
a constant `brief=missing` field — the script cannot write a brief and never
will, so it says what it left undone instead of leaving a claimed worktree
looking handed over. It does not refuse: `--dry-run` and `--status` are the
normal way to look before leaping, and a gate that blocks looking is a gate in
the wrong place. `--no-start` suppresses workers, not briefs.

<!--
bumps:
  skills:
    plot-dispatch: minor
    plot-implement: minor
-->
