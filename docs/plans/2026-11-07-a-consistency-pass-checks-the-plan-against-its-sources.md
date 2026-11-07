# A consistency pass checks the plan against its sources

> An optional step before `/plot-approve`: one agent checks every claim the plan takes from a source against that source at the approval commit, and writes each contradiction into the plan.

## Status

- **State:** Approved
- **Type:** feature
- **Approved:** 2026-11-07, Jan Wloka, plan-PR #3220 merged
- **Started:** 2026-11-07, Jan Wloka, `feature/a-consistency-pass-trial`
- **Sprint:** <!-- optional, filled when plan is added to a sprint -->
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** pr
- **Impl:** own branches

## Changelog

- An optional consistency pass before approval: one agent lists the claims a plan takes from outside itself (specs, existing code or config, other plans, the environment), checks each against its source, and records every contradiction in the plan's Open Questions with the quoted source line and a severity.

<!-- Board impact: none expected. The pass writes into the existing `### Open Questions` section and adds no field, so the plan format, the template and the board's parser are untouched. If the open question about recording the run as a `Consistency:` status line resolves to yes, that line is a new plan field and the board impact has to be re-read. -->

## Motivation

**Plan review reads the plan against itself. Nothing reads it against what it quotes.**

`/challenge-the-plan` interrogates a plan through questions, and `/plot-panel` puts several lenses on it. Both take the plan's claims about the world as given: that a spec id exists and says what the plan says, that a function takes the arguments the plan passes, that a config key is spelled as written, that another plan has not already moved the thing this plan builds on, that a tick runs every five minutes. Each of those claims can be checked with a read of the source, and a wrong one costs a slice or a rebuild, not a sentence.

**One replay, measured on the build's own record.** A consistency pass was run once, as a trial, on a 30-file tracer plan from a private workspace, after the plan had already been through its own review and had been built. The run took 17.5 minutes of wall time and 101 tool calls and raised 24 flags. The yardstick is the build's own record, which is not a complete list of what was wrong:

- Of the 8 surprises the build's progress notes recorded, the pass found 2 clearly and 1 partly. The ones it missed all came from what the live system does: host reach, tooling on the build machine, a missing binary, a metric nobody built.
- Of the 24 flags, **5 were confirmed by the build**. Three of them (a monitoring threshold that assumed a 5-minute tick when the tick was 30 minutes, an auth client missing two attributes, a variable never passed into a container) were defects the plan's earlier review had left in and the build fixed later.
- **3 were refuted** by a later read-only check: one flagged a mechanism that did not break (the flag was right about the list and wrong about the consequence), one flagged a size cap that the route in question never applies, one assumed a permission the role turned out to have.
- **16 were not tested** by the record: not wrong, neither confirmed nor refuted.

**What the evidence does not show.** One plan, one run, one replay. The second replay was not made because the first was not mixed. The yardstick is the build's own notes, which count what hurt rather than everything that was wrong, so 16 untested flags are not 16 false ones and not 16 true ones. Of the 8 flags that were resolved either way, 3 were refuted, which is a small sample and not a false-positive rate. Nobody has run the pass on a plan whose build is still ahead, and that is the only test of whether it saves anything.

**It cannot find behaviour that only the running system shows.** A document pass reads documents and code. A plan's live checks stay.

## Design

### Approach

One step, optional, placed after the plan is written and reviewed and before `/plot-approve` records the approval. One agent run, about 15 to 20 minutes.

1. **List the claims.** The agent walks the plan and lists every claim it takes from a source outside the plan: spec or design ids, existing code and config (names, signatures, paths, defaults), other plans (what they build, what state they are in), and the environment (versions, intervals, limits).
2. **Check each against its source at the approval commit.** The source is read with `git show <approval-commit>:<path>`, so the answer is a function of recorded state and not of a working tree that has moved. A claim about the environment that only a live system can answer is marked `live check` and is never run by this pass.
3. **Write each contradiction into the plan's `### Open Questions`.** Each entry quotes the source line it contradicts, names the plan line that makes the claim, and carries a severity.
4. **List the claims found fine.** The pass also records which claims it checked and found consistent, so that a reader can see the false-positive rate by dividing and can see what the pass did not look at.

The pass changes no claim in the plan. It writes questions, and the author answers them, like any other open question. It reads sources and runs nothing, so it has no side effect beyond the plan file.

### Where it sits

| Step | Reads | Asks |
|---|---|---|
| `/challenge-the-plan` | the plan | is this the right plan, and is it complete |
| `/plot-panel` | the plan, through N lenses | do several readers commit to a position |
| **consistency pass** | the plan **and what it quotes** | are the plan's claims true of their sources |
| `/plot-approve` | | records the approval |

It complements the other two and replaces neither. It is the only one of the three that opens a file the plan does not contain.

### Cost

One agent run of about 15 to 20 minutes (17.5 measured once). No cost to a plan that does not opt in.

### What it will not do

- Run anything. It reads sources and marks what needs a live system.
- Find behaviour that only the running system shows. The plan's own live checks stay.
- Judge the design. A claim can be consistent with its source and still be a bad idea.
- Decide anything. A contradiction is an Open Question until a person answers it.

### Open Questions

- [ ] **Which skill runs it?** Options: a new `plot-consistency` spoke, a mode of `/challenge-the-plan`, or a lens run through `/plot-panel` that is given file access. It differs from a panel lens in that it varies the source, not the persona, and from `/challenge-the-plan` in that it asks no questions of a person. Recommendation to test: a mode of `/challenge-the-plan`, because it is also a design-phase step and needs no new spoke. Decide at design time, with the manifesto's 9-question checklist.
- [ ] **How does the severity scale read?** A first proposal: `blocks` (a slice cannot be built as written), `misleads` (the plan is wrong but the build would notice), `cosmetic` (a name or path that differs). The scale should be small enough that a person can sort the list in one read, and its words should say what happens if the flag is ignored.
- [ ] **Opt-in per plan, or per repo?** A per-plan opt-in keeps the cost off small plans. A per-repo config key (default off) would let a repo whose plans quote a lot of code turn it on everywhere. Both can exist, as with the ceremony keys.
- [ ] **Does the approval record that the pass ran?** A `Consistency:` status line would let `/plot-approve` and a reader tell a plan that was checked from one that was not, but it adds a plan field and touches the board. Without it, the only trace is the Open Questions the pass wrote.
- [ ] **What is the approval commit when the plan rides a PR?** `git show` at the approval commit needs one; for `Review: pr` it is the head of the plan PR at the time of the run. A run on a head that later moves is stale, and the pass should record the commit it read.
- [ ] **What proves it earns its cost?** The one replay is not enough. Proposal: run it on the next few plans before approval, compare its flags with what the build records, and keep, change or drop the step on the result. The first slice is that trial and nothing more.

## Slices

### Trial

- `feature/a-consistency-pass-trial` — the pass as a documented step, run by hand on the next plans before approval, with a record of each run's flags and what the build later confirmed or refuted. Writes nothing into the plan format. → #3228

### Implementation

- `feature/a-consistency-pass-in-the-skill` — the chosen skill gains the pass, with its Model Guidance row, its README and the severity scale. Waits on the trial's result. <!-- waits: feature/a-consistency-pass-trial -->

## Notes

- The text comes from a trial run in a private workspace on 2026-11-05, followed by two read-only checks on 2026-11-07. No private paths or names are carried here.
- Deliverable search for "consistency pass" over the estate on 2026-11-07 found nothing by that name.
- Ceremony: `Review: pr` because the repo declares `Plan PRs: required`.
