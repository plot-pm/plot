# A heading names a branch or says it could not

> `(Branch: \`bug/x\`)` opens a wave and extracts nothing, so a plan with slices parses as a plan with none. The parser's design already refuses this — it emits an empty wave rather than an absence — and no consumer reads the difference.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1031
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 0

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

Measured across the estate: **12 plans carry a wave with zero branches legitimately** — `opus5-longhorizon-hardening` has 3, `a-wave-is-a-thing-not-a-label` has 4. These are narrative waves in older plans. A gate on emptiness fires on all of them.

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
- **The 12 plans with legitimate empty waves are NOT reported** — asserted against a real one, by name, or the finding is noise on its first run.
- The scan's new counter sits below `== blocking sections end ==` and gates nothing.
- `plot-plan-meta.sh`'s existing tests still pass unchanged; this widens what is accepted and narrows nothing.

## Slices

### A heading names a branch or says it could not (Branch: bug/a-heading-names-a-branch-or-says-it-could-not)

Widen the extraction regex, add the scan's advisory section, and prove the legitimate empty waves stay silent.

## Notes

**The parser's design anticipated this exactly and no consumer honoured it.** The comment at the extraction site names the failure — *"a consumer sees a wave it could not extract a branch from, not an absence"* — and the parser delivers precisely that. Every consumer then reads `branches[]` and sees an absence.

That is the shape worth recording: a design property that holds in the producer and is dropped by every reader is indistinguishable from one that was never built.
