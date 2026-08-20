---
"plot": minor
---

plot-sprint: sprint creation proposes the plans that serve the goal

Sprint creation asked "Found N active plans. Add any to this sprint?" and listed
them unordered. The list was identical for every goal — a sprint about the board
and a sprint about the release process were offered the same wall of slugs — so
the operator did the matching in their head, which is the work the sprint was
supposed to help with. That cost lands before any payoff, and it is a candidate
explanation for six months of sprints going unused.

Step 4 now reads the goal against each unfinished plan's title, story and
changelog and proposes the ones that serve it, ranked, with `--all` for the full
estate. It proposes only: the operator selects, and nothing reaches the sprint's
tiers without an explicit selection, because which MoSCoW tier a plan belongs to
is a statement about what the team is committing to.

**Every proposed row carries the sentence that earned it a place.** The proposal
will be wrong sometimes, and a ranked list whose mistakes are invisible is worse
than an unranked one — it hides them behind an order. With the reason visible, a
wrong match reads as a wrong match.

**The Model Guidance table now names the step Frontier, and the blanket "No
Frontier needed" sentence is gone.** That sentence was true before this step and
false after it, and a table that under-states its own requirement sends a small
model into a judgement it will answer confidently and wrongly. This is also the
one step in the skill where a smaller model cannot degrade into asking the human
— handing the operator every open plan is precisely the behaviour being replaced
— so it degrades into the previous behaviour and **says so**: listing everything
grouped by story without announcing it leaves a reader trusting an ordering that
is alphabetical.

`plot-sprint-candidates.sh` supplies the facts and ranks nothing, which is the
design rather than a division of labour: the case this feature exists for is the
goal *"the board tells the truth"* against the plan *"none printed before the
first fetch"* — the same subject, sharing no word. Any score a shell script could
compute ranks that plan last, so a `score` field in the helper would be a wrong
answer wearing a helper's clothes. A contract test forbids one.

Candidacy is read from the phase, not from `docs/plans/active/`: that index is a
symlink view that drifts, and a plan missing from it is still unfinished work. A
file with no phase at all is skipped — `docs/plans/` also holds decision logs and
blocked-worker reports, and one of them says in its own header that it is not a
plan.

The helper assembles its JSON through `node` rather than `sed`. This is not a
style preference: a `"title":"[^"]*"` extraction truncates at the first escaped
quote, and this repo titles plans things like `... is not "no commits yet"`. One
such title turns the output into unparseable JSON, silently, for the one caller
that most needs to read it.

`PLOT_UNATTENDED=1` still creates the sprint with empty tiers and stops.

<!--
bumps:
  skills:
    plot-sprint: minor
    plot: patch
-->
