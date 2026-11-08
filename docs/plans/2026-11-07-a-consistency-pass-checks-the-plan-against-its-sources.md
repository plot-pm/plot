# A consistency pass checks the plan against its sources

> An optional step before `/plot-approve`: one agent checks every claim the plan takes from a source against that source at the approval commit, and writes each contradiction into the plan.

## Status

- **State:** Approved
- **Type:** feature
- **Approved:** 2026-11-07, Jan Wloka, plan-PR #3220 merged
- **Started:** 2026-11-07, Jan Wloka, `feature/a-consistency-pass-trial`
- **Started:** 2026-11-08, Jan Wloka, `feature/a-consistency-pass-in-the-skill`
- **Sprint:** <!-- optional, filled when plan is added to a sprint -->
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** pr
- **Impl:** own branches

## Changelog

- An optional consistency pass before approval: one agent lists the claims a plan takes from outside itself (specs, existing code or config, other plans, the environment), checks each against its source, and records every contradiction in the plan's Open Questions with the quoted source line and a severity.

<!-- Board impact: none expected. The pass writes into the existing `### Open Questions

- [x] **Which skill runs it?** A mode of `/challenge-the-plan`. It is a design-phase step and needs no new spoke, README row or helper script. The skill had no `## Model Guidance` table; this slice adds one. Settled by Jan Wloka on 2026-11-08.
- [x] **How does the severity scale read?** `blocks`, `misleads`, `cosmetic`, as proposed. The trial recorded no run, so no note on fit exists; the skill says the scale is a working draft. Settled by Jan Wloka on 2026-11-08.
- [x] **Opt-in per plan, or per repo?** Per invocation, as `/challenge-the-plan consistency <plan>`. No `## Plot Config` key. Settled by Jan Wloka on 2026-11-08.
- [ ] **Does the approval record that the pass ran?** A `Consistency:` status line would let `/plot-approve` and a reader tell a plan that was checked from one that was not, but it adds a plan field and touches the board. This slice adds none; the only trace is the Open Questions the pass wrote.
- [x] **What is the approval commit when the plan rides a PR?** For `Review: pr`, the head of the plan PR at the run. The pass records the commit it read in a closing line of the Open Questions section; a run on a head that later moved is stale. Settled by Jan Wloka on 2026-11-08.
- [ ] **What proves it earns its cost?** The trial recorded no run, and this slice was built on the one replay by Jan Wloka's decision on 2026-11-08. Running the pass on the next plans before approval and comparing its flags with the build is still open.

## Slices

### Trial

- `feature/a-consistency-pass-trial` — the pass as a documented step, run by hand on the next plans before approval, with a record of each run's flags and what the build later confirmed or refuted. Writes nothing into the plan format. → #3228

### Implementation

- `feature/a-consistency-pass-in-the-skill` — the chosen skill gains the pass, with its Model Guidance row, its README and the severity scale. Waits on the trial's result. <!-- waits: feature/a-consistency-pass-trial -->

## Notes

- The text comes from a trial run in a private workspace on 2026-11-05, followed by two read-only checks on 2026-11-07. No private paths or names are carried here.
- Deliverable search for "consistency pass" over the estate on 2026-11-07 found nothing by that name.
- Ceremony: `Review: pr` because the repo declares `Plan PRs: required`.
