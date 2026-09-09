# A plan row shows its phase

> Two code paths render a PLAN row. One sets `status: facts.phase`; the other inherits its PR's CI state. A plan awaiting approval therefore reports `green` — a fact about a build, on a row about a decision nobody has taken.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** the-jenkins-team-sees-its-builds
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-09-09, Jan Wloka, plan-PR #866 merged

## Changelog

- A plan row reports the plan's phase whichever path renders it. A Draft awaiting approval says `Draft`, not `green` — its PR's CI state moves to where a build state is the subject.

Board impact: yes, and it is the whole change.

## Motivation

**Reported from the live board, 2026-09-09:** three Draft plans rendered as

```
PLAN  an-adopting-repo-installs-its-gates   865   green      draft   46m
PLAN  a-lifecycle-action-needs-a-controller-receipt  863   CI running  draft   14m
PLAN  the-supervisor-is-loaded-or-it-is-reported     864   green      draft    0m
```

*"I don't see the plan status and but an uninteresting CI state for a docs branch."* The reader is right on both halves: the phase is absent, and a plan-PR's CI — which lints markdown and rebuilds an artifact the plan does not touch — is the least useful fact available about a plan waiting for a human decision.

### The divergence is two arms of one projection

**`tupleFromPlan` (`tuple-row.ts:1140`) sets the phase, and states why:**

> **The phase belongs HERE**, and this is the object it describes. 71 branch rows printed their plan's phase — 36 `Development`, 26 `Testing`, 9 `Design` — a fact about the plan on a row about something else. **Slot 5 on the PLAN row is where that fact is true.**

That rule was written to move the phase OFF branch rows and ON to the plan row. It succeeded for the rows the client assembles.

**The other arm never got it.** `tuple-row.ts:628` handles *"a PLAN AWAITING APPROVAL, on its own `idea/` branch — the one plan row the SERVER emits"*, and it does not set `status`. It inherits from `base` (`:529`):

```ts
const status = row.pr ? prStatus(row.pr) : stateStatus(row);
```

An idea branch always has a PR — the arm's own comment says *"an idea branch's PR **is** the plan"* — so `row.pr` is always truthy and the row always shows CI.

**So the estate's own principle is already violated by the same shape it fixed.** A row about a plan showing a fact about a build is the branch-row defect with the objects exchanged.

### The phase is the fact a reader is missing

Three Draft plans on the board differ in exactly one way that matters: whether anyone has reviewed them. `Draft`, `Design` and `Approved` are the words that answer it. The badge already renders `draft` beside the CI state — **the PR's draft flag, not the plan's phase** — which reads as the same fact and is not: a PR marked ready still leaves a plan `Draft` until `/plot-approve` runs.

## Design

### The plan's phase wins slot 5, on both arms

`status: phase` on the idea arm, from the plan file the arm already reads — `planFile` is resolved there for the name link, so the phase needs no new reading.

**The two arms then agree**, and the rule `tupleFromPlan` states holds for every plan row rather than for most of them.

### The PR's CI state moves rather than disappearing

**It is not deleted, because for a plan PR it is occasionally the answer** — a plan PR whose CI is red cannot merge, so `/plot-approve` will refuse. What changes is its rank: a build state belongs with the artifact it describes, and the row already carries the PR as a link.

**Where it goes is the slice's measurement, not this plan's guess.** Two shapes are plausible — beside the PR link where the PR is named, or as a second element in the status cell the way `:715` already notes *"a second element in the same cell, so `tupleFromPlan`'s phase is never at"* — and which reads better on a screen holding both plan and slice rows is a rendering question. **The constraint is that the phase is first.**

### Not chosen: setting the phase only when CI is green

It would keep the current display for the case where CI matters and show the phase otherwise. Rejected because it makes one cell mean two things depending on a third — the reader cannot tell whether `Draft` means *this is a draft* or *this is a draft and CI happens to be green*, and a cell whose subject changes is the defect this plan is fixing.

### Not chosen: a separate phase column

Slot 5 exists and holds this fact on every other plan row. A second column would mean two places to look for one fact, and the tuple's six slots are a settled contract.

### Open Questions

- [ ] **Does the `draft` badge stay?** It renders the PR's draft flag beside what will now be the plan's phase, and the two read as one fact while meaning different things. A plan whose PR is ready and whose phase is still `Draft` is the case that separates them.
- [ ] **What does an idea branch with no PR show?** `Plan PRs: never` and `Review: in-session` both produce a plan with no PR at all. The arm assumes one exists; whether it renders at all today is unmeasured.

## Slices

### Showing

- `bug/a-plan-row-shows-its-phase` <!-- builds: the idea-branch plan row's status slot, which reports the plan's phase rather than its PR's CI --> — the idea arm sets `status` from the plan's phase, and the PR's CI state takes a rank below it.

  **Asserted: a Draft plan awaiting approval reports its phase, not `green`** — the three rows measured on 2026-09-09. **Asserted: both arms agree** — a plan row assembled by the client and one emitted by the server show the same fact in slot 5, which is the rule `tupleFromPlan` already states and the defect that it held for only one of the two. **Asserted: the CI state is still reachable** — a red plan PR blocks its own approval, so the fact is demoted rather than dropped. **Asserted: the phase comes from the plan file, not from the PR's draft flag** — a PR marked ready leaves the plan `Draft` until `/plot-approve` runs, and those two are the pair most easily confused.

## Notes

Written 2026-09-09 from a reading of the live board. The principle this restores is not new — `tuple-row.ts:1130` argues it at length and cites the 71 branch rows it was written to fix. **This is the same argument applied to the arm that the earlier change did not reach**, which is why the plan is one slice and its assertion is agreement between two paths rather than a new rule.

Definition of Done: docs/definition-of-done.md
