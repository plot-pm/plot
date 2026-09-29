# A sprint view says what it hid

> «Sprint only» exempts every PR row that names no plan, deliberately — and the exemption is invisible. An operator reading a sprint view sees four unrelated PRs, a «6 hidden» count that does not include them, and no way to tell the exemption from a bug.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1058
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 0

## Changelog

- A sprint-filtered board says how many rows it exempted for having no plan, so an unrelated PR is not mistaken for sprint work.

Board impact: this is a board view. No payload change.

## Motivation

`AgentList.tsx:528-536`:

```tsx
: fleet.rows.filter((r) => {
    // EXEMPT: rows with no plan
    if (r.kind === 'release') return true;
    if (r.kind === 'pr' && r.plan === '') return true;
    // FILTER: rows with a plan, by membership
    return slugPassesSprintFilter(r.plan, selectedSprints, membership);
  });
```

**The exemption is deliberate and the reporter's expectation is reasonable.** With sprint `1-8-leg` selected, four rows pass that no sprint member names:

```
#1056  infra/husky-hooks-crlf-and-exec-bit
#1091  docs/EWZLEG-867-triage-handover      (plan already delivered)
#1103  infra/EWZLEG-880-upgrade-dependencies
#1104  sprint/1-8-leg                        (the sprint PR itself)
```

The header says «6 hidden by Sprint only», and those four are **not** among the six. So the count describes the filtered population and the exempt one is silent — an operator cannot tell *"this PR is exempt"* from *"this filter is broken"*.

### Why the exemption should stay

A PR with no plan is not noise by default. `#1104` is the **sprint's own PR**. `#1103` may be the dependency bump the sprint needs. Hiding them would make «Sprint only» a view that omits work an operator must act on — and this estate has the measurement for that shape: `plot-reconcile-scan.sh` reports a plan-less merged PR and explicitly does **not** count it as drift, because *"of the 18 measured, eight belonged to a sprint whose note said 'Nothing here has a plan yet'"*.

**So the defect is legibility, not membership.**

## Design

### The rule

**A filter that exempts a row says so, and counts it.**

Three candidate shapes, and the slice picks one with an argument:

1. **Count them separately** — «6 hidden · 4 shown without a plan». Smallest change, no row-level markup.
2. **Mark the row** — a «no plan» chip beside the PR. Most legible, most markup.
3. **Both.**

**None of them hides a row.** That is the boundary this plan sets and the slice may not cross it.

### What the count must not become

**`slugPassesSprintFilter` already answers membership** and the exempt rows never reach it. The count is a second tally over the same pass, not a second opinion on the predicate — a row is exempt because `r.plan === ''`, which is a fact, not a judgement.

### What this does NOT do

- **It does not hide a plan-less PR.** The sprint's own PR is the counter-example.
- **It does not change `slugPassesSprintFilter`.**
- **It does not touch the `release` exemption** on the same predicate, which has the same shape and the same answer.
- **It does not add a payload field** — `r.plan === ''` is already on the wire.

## Done when

- **A sprint-filtered view states how many rows it exempted**, asserted with a fixture carrying both a member plan row and a plan-less PR row.
- **No row is hidden that is shown today**, asserted — the regression this plan must not cause.
- The `release` exemption is counted the same way or the plan records why it differs.
- **The wording distinguishes exempt from hidden.** «6 hidden» and «4 shown without a plan» are different facts and a reader must not have to derive one from the other.

## Slices

### A sprint view says what it hid (Branch: bug/a-sprint-view-says-what-it-hid)

Count the exempt rows in the same pass that filters, and render the count beside the hidden one.

## Notes

**Reported from a Bitbucket estate running Plot 2.21.0 with `Main branch: develop`.** The filter works correctly for plan rows — the reporter confirmed the «6 hidden» count — so this is a gap in what the view says about itself, not in what it computes.
