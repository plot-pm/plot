# A sprint names what it ships, and finds the work that gets it there

> A sprint can say when it ends and what it hopes for, but not what it ships. And when it asks which plans belong in it, it lists all 53 — the same answer for every goal.

## Status

- **Phase:** Draft
- **Type:** feature
- **Story:** plot-planning-model
- **Sprint:** the-board-tells-the-truth
- **Review:** in-session
- **Impl:** own branches
- **Approved:**
- **Started:**
- **Delivered:**
- **Released:**

## Changelog

- A sprint declares the release it is working toward, `/plot-release` refuses to cut past an active sprint's unfinished Must Haves, and sprint creation proposes the plans that serve the stated goal instead of listing every plan in the repo.

## Motivation

### This is not the sprint-support plan

`docs/plans/2026-02-11-plot-sprint-support.md` built sprints and is
**Delivered** — the skill, the manifesto section, nine sprint-aware spokes and
the board schema all exist and were verified against the source on 2026-08-18.
This plan adds nothing that plan promised.

It addresses two things that plan did not have, and could not have had: both
became visible only when a sprint was created for the first time, six months
after the support shipped. The February plan is the foundation; these are the
two places it stops short of the workflow it enables.

Two gaps, found while running this repo's **first ever sprint** on 2026-08-18 —
six months after sprint support shipped, with `0 of 53` plans carrying a
`Sprint:` field in between.

### A sprint cannot name its release

The format carries `Phase`, `Start`, `End` and a narrative `Sprint Goal`.
Nothing carries a version. The connection to a release exists only as prose, in
both directions and in neither as a fact:

```
plot-release/SKILL.md:97   "Sprint completion is informational —
                            it does not block the release."
plot-sprint/SKILL.md       "If all planned work is delivered: /plot-release"
```

So a sprint that exists to ship 2.5.2 cannot say so, and a release cut in the
middle of one cannot know it interrupted anything. Both commands mention the
other and neither can check.

This is exactly the rule/gate distinction CLAUDE.md asks about: *can you answer
"did I complete this?" without doing the work?* Today, yes — a release cuts
whether or not the sprint's Must Haves landed, and nobody finds out until the
sprint closes with unfinished must-haves.

### A sprint asks which plans belong, and cannot answer

`plot-sprint/SKILL.md:145` is the whole selection step:

> If plans exist, present: "Found N active plans. Add any to this sprint?"

N is 53 in this repo. The list is identical for every goal — a sprint about the
board and a sprint about the release process are offered the same 53 lines. The
operator does the matching in their head, every time, which is the work the
sprint was supposed to help with.

**This is a candidate explanation for six months of non-use.** Creating a
sprint costs a goal sentence plus a manual scan of every open plan; the payoff
is a file nothing enforces. The cost lands first.

## Design

### 1. `Release:` as a field, and a gate behind it

```markdown
## Status

- **Phase:** Active
- **Start:** 2026-08-18
- **End:** 2026-08-22
- **Release:** 2.5.2
```

Optional — a sprint with no release target behaves exactly as today. When
present, two commands read it:

**`/plot-release` refuses to cut past an active sprint's unfinished Must
Haves.** Not the Should or Could tiers: MoSCoW already says which items are the
commitment, and a gate that treated stretch goals as blocking would be one
operators learn to force past.

```
plot-release: sprint the-board-tells-the-truth targets 2.5.2 and has
              1 unfinished Must Have:
                [one-place-for-what-a-row-can-do] — Approved, not delivered
              Deliver it, move it to Deferred, or pass --ignore-sprint.
```

**`--ignore-sprint` is the named escape**, in the tradition of `--allow-local`
and `--during-release`. A gate with no exit is one people route around by not
declaring a release at all, which would cost the field its adoption.

**`/plot-sprint close` reports whether the release was cut**, and does not
refuse. Closing a sprint whose release slipped is a legitimate outcome; the
retro is where that gets discussed, and a command that would not let a timebox
end is a command that lies about what a timebox is.

### 2. Plans proposed from the goal, not listed

At sprint creation, and on demand afterwards, propose the plans that serve the
stated goal — ranked, with the reason visible:

```
/plot-sprint board-truth: the board tells the truth about what it measured

Plans that may serve this goal:
  [not-yet-asked-is-not-nothing]      story: plot-board · "none before the first fetch"
  [the-board-never-shrinks...]        story: plot-board · "a refresh that succeeds describes a smaller world"
  [finished-is-not-a-verdict]         story: plot-board · "the process exit code cannot answer the question"
  [a-stale-ref-outranks-the-host]     story: plot-board · "a stale ref disables the accurate check"

  ... 49 other plans not shown. Ask for them with --all.
```

**The reason is shown because the proposal will be wrong sometimes.** A ranked
list an operator cannot check is worse than an unranked one they can: it hides
its mistakes behind an order. Each row carries the sentence that earned it a
place, so a wrong match is visible as a wrong match.

**What the ranking reads.** Titles and stories are already parsed. The
distinguishing text is not: `plot-plan-meta.sh` reports `title`, `story`,
`phase`, `type` and no `changelog`, though every plan has one and it is a
one-line statement of what the plan changes. That is the field worth adding,
and it is additive to the plan-format contract rather than a change to it.

**A story match is strong evidence and not a rule.** 40 of 53 plans carry a
story, and a goal about the board will mostly draw from `plot-board`. But this
plan itself belongs to `plot-planning-model` and serves a board-flavoured
sprint, so story equality cannot be the filter — only a strong signal.

### What this does not do

**It does not auto-add.** The proposal is a proposal; the operator selects. An
agent that filled a sprint by itself would be committing on someone's behalf,
and MoSCoW tiers are exactly the judgement a person is being asked for.

**It does not rank by urgency, age or size.** Those are effort-tracker signals
(Manifesto — *Not an effort tracker*). The question is *does this serve the
goal*, not *is this overdue*.

**It does not require a release target.** A sprint that groups work without
shipping a version is still a sprint; the field is how one says otherwise.

### Open Points

- [ ] Does `Release:` accept a version that does not exist yet? It must —
      2.5.2 is named before it is cut. So the gate validates *the sprint's
      Must Haves*, never *the version string*, and a typo is caught by the
      release command failing on its own terms rather than by the sprint.
- [ ] What if two active sprints target the same release? Probably legitimate
      (two teams, one train) and probably should not be refused, but the
      release command then answers to both and the message must say so.
- [ ] Should the proposal run on an existing sprint too — *"which open plans
      now serve this goal?"* — or only at creation? Mid-sprint scope change is
      already a documented flow; this would give it the same help.
- [ ] Does `changelog` belong in `plot-plan-meta.sh` for this alone? It is
      also what `/plot-release` extracts by hand today, so the answer is
      probably yes on its own merits.

## Branches

### The field and its gate

- `feature/a-sprint-names-its-release` — `Release:` in the sprint format and its parser, read by `/plot-release` as a gate on an active sprint's unfinished Must Haves, with `--ignore-sprint` as the escape. `/plot-sprint close` reports the release state and never refuses. Tests: a sprint with unfinished Must Haves refuses the release and names them; `--ignore-sprint` proceeds; finished Must Haves proceed silently; unfinished Should/Could items never block; a sprint with no `Release:` behaves exactly as today; closing a sprint whose release was not cut succeeds with a report.

### The proposal

- `feature/the-plan-meta-reports-a-changelog` — `plot-plan-meta.sh` reports the plan's `## Changelog` text, the one field that says what a plan changes. Additive to the contract. Tests: a plan with a changelog reports it; one without reports an empty value rather than failing; the existing fields are byte-identical.

- `feature/a-sprint-proposes-its-work` — sprint creation proposes plans that serve the stated goal, ranked, each row carrying the sentence that earned it a place, with `--all` for the full list. Proposes only; never adds. Tests: a goal about the board ranks board plans above unrelated ones; every proposed row shows its reason; a plan from another story can still be proposed; `--all` lists everything; nothing is written to the sprint without a selection.

## Notes

Both gaps came from the same session as this repo's first sprint, and the
sprint is the evidence: `docs/sprints/2026-W34-the-board-tells-the-truth.md`
was written by hand, its items chosen by an operator reading a scan output,
and its release target stated nowhere despite being the reason it exists.

Related: `docs/plans/2026-08-18-the-repair-exists-but-nothing-calls-it.md` and
the release-window draft came out of the same run. All three are cases of Plot
holding a fact and no command asking for it.
