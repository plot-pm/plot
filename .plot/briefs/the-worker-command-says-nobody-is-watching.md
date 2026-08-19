# Brief: feature/the-worker-command-says-nobody-is-watching

Implement wave 2 of
`docs/plans/2026-08-18-a-question-nobody-can-answer-is-a-hang.md`.
Read the plan first. Wave 1 (#230) is merged.

## What wave 1 shipped, and what is still missing

`PLOT_UNATTENDED` exists and the skills honour it. Verified 2026-08-19:
`skills/plot-sprint/SKILL.md:79` declares the rule, and its question sites each
say what to do instead (`:150` creates with empty tiers, `:420` refuses exactly
as it would with a person present). `skills/plot/docs/unattended.md` is the one
place it is documented.

**Nothing sets it.** This repo's own `Worker command` (`CLAUDE.md:19`) does not,
and neither does `skills/ralph-plot-sprint/ralph-sprint.sh`. So every dispatched
worker runs as if a person were watching, and the hang the plan is named for is
avoided today only by brief wording — *"if you must stop and ask, write
PLOT-BLOCKED"* — which is a rule an agent can rationalise around rather than a
condition it cannot meet.

## What to build

**The two places that launch unattended agents declare that nobody is there.**

1. `CLAUDE.md`'s `Worker command` — a dispatched worker has no terminal
2. `skills/ralph-plot-sprint/ralph-sprint.sh` — its loop invokes `claude -p`

**Setting the variable is the whole change on the launch side.** Do not add a
second mechanism, do not teach the skills anything new: wave 1 already built the
behaviour and this wave supplies the signal.

**`PLOT_UNATTENDED=1` never converts a gate into a pass.** The plan is explicit
and `plot-sprint/SKILL.md:420` already demonstrates it: a refusal stays a
refusal. If you find a question site where the unattended path is *more*
permissive than the attended one, report it — that is a defect in wave 1, not
something to replicate here.

**The output names every question that was skipped.** That is wave 1's rule and
this wave must not weaken it: a run that silently took defaults is
indistinguishable from one that had nothing to decide.

## Definition of Done

- A dispatched worker runs with `PLOT_UNATTENDED=1` set — assert it from the
  launch path, not by reading the prose
- `ralph-sprint.sh`'s loop sets it too
- A brief that says "ask the user" produces a decision or a clean stop rather
  than a wait
- The variable never converts a refusal into a pass — assert a gate refusing in
  both modes
- `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:e2e` pass — one at a time
- A changeset with a `bumps:` block

## Do not

- Do not change what the skills do when the variable is set; wave 1 owns that
- Do not remove the `PLOT-BLOCKED` marker instruction from the `Worker command`.
  The two answer different situations: `PLOT_UNATTENDED` says *nobody can
  answer, take your documented path*, and the marker says *I stopped anyway and
  here is why*. A worker that hits something genuinely undecidable still needs
  the marker, and `plot-worker-state.sh` reads it to report `waiting`.
- Do not set the variable in the operator's interactive shell or in any path a
  person actually watches

## Platform notes

CI runs Linux; you are probably on macOS. Run the suites **one at a time** —
concurrent runs produce false timeout failures that do not reproduce serially.

**Line numbers here may drift** — a sibling agent found one off by 280 lines
today. Follow the rule, not the number.

If you find something the plan did not anticipate, implement what you can and
report the discovery rather than improvising.
