# A heading names a branch or says it could not

> `(Branch: \`bug/x\`)` opens a wave and extracts nothing, so a plan with slices parses as a plan with none. The parser's design already refuses this — it emits an empty wave rather than an absence — and no consumer reads the difference.

## Status

- **State:** Released
- **Approved:** 2026-09-28, jwloka, in-session after panel (round 1)
- **Started:** 2026-09-28, jwloka, `bug/a-heading-names-a-branch-or-says-it-could-not`
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1031
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 1
- **Delivered:** 2026-09-28
- **Released:** 2026-10-01, v2.22.0

## Changelog

- A backticked branch name in a wave heading is read. A heading whose branch cannot be read is reported rather than passing as a wave with no work.

Board impact: plans that parsed as branch-less start rendering their rows.

## Motivation

### Measured 2026-09-27

Four plans written that day used `(Branch: \`bug/x\`)` and all four parsed to `branches: []`. Fixed by hand before anything dispatched. Two further plans on the estate carry it, both `Rejected`.

Reproduced 2026-09-28 in a scratch file:

```
### A wave (Branch: `bug/backticked`)
  → branches: []   waves: [{"name":"A wave","branches":[]}]
```

### The extraction, not the classification

The heading IS recognised as the new shape — `slice_shape` tests `index($0, "(Branch:")` (`plot-plan-meta.sh:927`) and a backticked heading contains it. What fails is one regex below:

```awk
if (match(hmeta, "Branch:[ \t]*(" PREFIXES ")/[^ \t,)]+")) {
```

It anchors on the prefix immediately after optional whitespace. A backtick sits between, so nothing matches.

### The parser already refuses this, and the comment says so

Three lines above that regex:

> A heading with no readable branch still opened a wave above — so a `## Waves` section is never silently empty, which is the failure this plan refuses: **a consumer sees a wave it could not extract a branch from, not an absence.**

That is intact and it is why `waves` carries `{"name":"A wave","branches":[]}`. **The design held; nothing downstream reads it.** `branches[]` is what every consumer takes, and an empty one is indistinguishable from a plan with no slices — the fleet never dispatches, and `plot-deliver.sh`'s branch gate finds nothing unmerged.

### Why an empty wave alone cannot be the gate

Measured across all 357 plans: **12 carry a wave with zero branches, 30 such waves.** A gate on emptiness fires on all of them.

**But 12 is not the control group, and an earlier draft of this plan said it was.** Two of the twelve — `a-parsed-plan-joins-the-index` and `the-board-updates-an-index`, 3 empty waves each — **are the defect**, and they are the two Rejected plans this plan's own Motivation names. Re-counted after applying the wave-1 fix: **10 plans, 24 waves.** The control group had the bug in it.

So the number to assert against is **10, measured after wave 1**, or the implementer writes a test against a population that stops existing the moment they fix the regex.

### A second defect hides inside the same symptom

**Four of `the-pulse-is-an-entity`'s seven empty waves carry a well-formed, UNBACKTICKED `(Branch: …)` heading and still extract nothing.** So does one of `opus5-longhorizon-hardening`'s. Five slices across two plans, invisible for the same reason and by a different mechanism.

`slice_shape` latches on the section's **first** `###` heading (`plot-plan-meta.sh:926-928`) and is then fixed for the section. `the-pulse-is-an-entity`'s Slices section opens with a narrative heading carrying no `(Branch:`, so the whole section routes to the **list** consumer, which never reads headings for branches.

Reproduced 2026-09-28 with a minimal pair — identical content, reordered:

```
### A narrative heading with no branch     ← first
### Real work (Branch: bug/real-work)
  → branches: []

### Real work (Branch: bug/real-work)      ← first
### A narrative heading with no branch
  → branches: ["bug/real-work"]
```

**Wave 1 does not touch this.** The backtick fix leaves both answers unchanged.

**It is in scope for the REPORT and out of scope for the fix.** The discriminator this plan proposes — a heading carrying `Branch:` that yields no branch — describes these five exactly, so the scan finds them the day it ships. Repairing the latch is a change to how a whole section is classified, with 357 plans downstream of it, and that is its own plan — filed as [#1042](https://github.com/plot-pm/plot/issues/1042).

**This is why the Done-when below does not ask for silence against a named plan.** An earlier draft did, and `the-pulse-is-an-entity` was the obvious candidate — which would have pinned the second defect shut in a test.

## Design

### Two halves, and only the second is new

**Read the backticked form.** Allow optional backticks around the value in the one regex. A backticked branch name is unambiguous, and a reader writing one is not wrong — the unbackticked form is a convention, not something the format needs.

**Report a heading that names a branch the parser did not take.** This is the gate half. The discriminator is not *is the wave empty* but *does this heading contain a `Branch:` the extractor did not produce* — which the 12 legitimate empty waves do not, because they carry no `Branch:` at all.

### Where the report goes

`plot-reconcile-scan.sh`, as a **non-blocking** section below the marker. It reports and never refuses: a plan is not broken by a heading nobody can read, it is merely invisible, and the repair is one edit.

**Not a `PreToolUse` gate.** A plan file is edited by people and agents constantly, and a gate on every write would fire mid-sentence. The scan runs over finished files.

### What the slice must decide

**Whether the parser reports the unreadable heading itself.** It could emit the heading text in a field beside `waves`, which would let the scan read one value rather than re-parsing. That is the cleaner shape and it widens the plan-format contract — the slice argues it either way and says which it chose.

### What this does NOT do

- **It does not change the template.** The unbackticked form stays what `/plot-idea` writes.
- **It does not make an unreadable heading an error.** Exit codes are unchanged; the scan gains a count.
- **It does not touch `slice_shape`.** Classification already works.
- **It does not fix the 12 legitimate empty waves.** They are not defects.

## Done when

- `(Branch: \`bug/x\`)` parses to `["bug/x"]`, asserted for both forms in the same test.
- A heading carrying `Branch:` that yields no branch is counted by the scan, with the plan and the heading named.
- **A wave that is empty and carries no `Branch:` is NOT reported** — asserted against a real plan whose emptiness is narrative, chosen from the 10 that remain after wave 1 and NOT from the 5 slices lost to the latching defect. The count is 10, not 12: two of the original twelve are this plan's own defect.
- **The five latched slices ARE reported**, named, and their finding says the repair is a separate plan. A test asserts they appear — the scan's value here is that it finds a defect this plan does not fix.
- The scan's new counter sits below `== blocking sections end ==` and gates nothing.
- `plot-plan-meta.sh`'s existing tests still pass unchanged; this widens what is accepted and narrows nothing.

## Slices

### A heading names a branch or says it could not (Branch: bug/a-heading-names-a-branch-or-says-it-could-not, PR: #1044)

Widen the extraction regex, add the scan's advisory section, and prove the legitimate empty waves stay silent.

## Notes

**The parser's design anticipated this exactly and no consumer honoured it.** The comment at the extraction site names the failure — *"a consumer sees a wave it could not extract a branch from, not an absence"* — and the parser delivers precisely that. Every consumer then reads `branches[]` and sees an absence.

That is the shape worth recording: a design property that holds in the producer and is dropped by every reader is indistinguishable from one that was never built.

**Round 1 (2026-09-28): the fix was verified on the whole estate and the control group was wrong.** The evidence juror committed `amend` having executed, reproduced both halves of the defect, and confirmed every `file:line` citation — it went looking for a cited line with no caller, this author's measured habit, and found none.

It then ran the proposed regex over **all 357 plans and diffed the output: 4 diff lines, 2 changed records, 355 byte-identical.** The two that move are the two defective plans. So *"widens what is accepted and narrows nothing"* is measured rather than asserted, and `parser.test.mjs` stays 106/106 under the patch.

Two findings changed the plan. **The control group contained the bug** — 2 of the 12 are the Rejected plans the Motivation names, so the residual is 10 and must be counted after wave 1. And **a second defect hides inside the remainder**: `slice_shape` latching on a narrative first heading loses 5 slices across 2 plans, which wave 1 does not touch and which this plan's own discriminator catches. The Done-when asked the implementer to assert silence against one of the 12; had they picked `the-pulse-is-an-entity`, they would have pinned that defect shut.

The juror also caught its own near-miss worth recording: `cp` is aliased to `cp -i` on this machine and silently refused its first patch attempt, which would have produced a false green. It verified the patch was present with `git diff --stat` before trusting the run.

Verdict and full reading: `.plot/panels/2026-09-28-a-heading-names-a-branch-or-says-it-could-not/evidence.md`.
