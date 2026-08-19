# Brief: feature/a-sprint-proposes-its-work

Implement the second branch of wave *The proposal* in
`docs/plans/2026-08-18-a-sprint-names-what-it-ships.md`.
Read the plan first. Wave 1 (`a-sprint-names-its-release`, #229) is merged.

## What it does today, and what is missing

`skills/plot-sprint/SKILL.md:148` — sprint creation asks:

> *"Found N active plans. Add any to this sprint?"* — lists them and lets the
> user select.

An unordered list of everything active. With 16 unfinished plans in this repo
that is a wall of slugs, and the sprint's own goal — the sentence the operator
just wrote — plays no part in it.

## What to build

**Sprint creation proposes the plans that serve the stated goal**, ranked by
reading the goal against each plan's **title, story and changelog**, with each
row carrying the sentence that earned it a place. `--all` lists everything.

**Proposes only; never adds.** Which MoSCoW tier a plan belongs to is a
statement about what the team is committing to. The skill already says so at
`:148` and its unattended path stops rather than guessing — keep that intact.

**Every proposed row shows its reason.** A ranking without one is an oracle: the
operator cannot tell a good match from a coincidence, and cannot correct it.

**A plan from another story can still be proposed.** Story is a signal, not a
filter — a board plan can serve a sprint about releases.

## The Model Guidance table contradicts this branch, and you must fix it

`skills/plot-sprint/SKILL.md:75` reads:

> *"All sprint operations are structural (Small or Mid). No Frontier needed."*

That was true before this branch and is false after it. The plan names this step
**Frontier**, with a documented fallback for smaller models: **list everything
grouped by story, and say that is what happened.** Add the row and remove the
blanket sentence — a Model Guidance table that under-states its own requirement
sends a small model into a judgement call it will answer confidently and wrongly.

**The fallback must announce itself.** A smaller model that lists everything
grouped by story has not ranked anything, and a reader who believes it did will
trust an ordering that is alphabetical.

## The measured case the ranking must pass

The plan names it, and it is the reason a model reads this rather than a keyword
match:

| | |
|---|---|
| goal | *"the board tells the truth"* |
| plan | *"none printed before the first fetch"* |
| shared words | **none** |

That plan must rank highly. Any implementation that scores on word overlap fails
this case, and it is the case the feature exists for.

## Definition of Done

- A goal about the board ranks board plans above unrelated ones
- The measured semantic case above ranks highly — assert it by name
- Every proposed row shows the reason it was proposed
- A plan from another story can still be proposed
- `--all` lists everything
- Nothing is written to the sprint without a selection
- The Model Guidance table names this step Frontier and its fallback, and the
  blanket "No Frontier needed" sentence is gone
- The fallback path says it is the fallback
- `PLOT_UNATTENDED=1` still stops without assigning tiers, as `:150` documents
- `pnpm test` and `pnpm run test:reconcile` pass — one at a time
- A changeset with a `bumps:` block

## Do not

- Do not write to the sprint file without an explicit selection
- Do not filter by story
- Do not implement the changelog field — that is
  `feature/the-plan-meta-reports-a-changelog`, running beside you. **It may not
  have landed yet.** If `plot-plan-meta.sh` reports no `changelog`, rank on
  title and story and say in your report that the third signal was unavailable;
  do not add the field yourself.
- Do not touch `plot-fleet-scan.sh` or the board

## Platform notes

CI runs Linux; you are probably on macOS. Run the suites **one at a time** —
concurrent runs produce false timeout failures that do not reproduce serially.

**Line numbers here may drift** — a sibling agent found one off by 280 lines
today. Follow the rule, not the number.

If you find something the plan did not anticipate, implement what you can and
report the discovery rather than improvising.
