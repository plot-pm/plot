# A plan has one phase

> Three scripts write the phase into the `## Status` block and the parser reads front matter whenever it exists, so on a plan carrying both the delivery reports success and the parser keeps answering `approved`.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #924
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** the-domain-knows-what-plot-knows
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A plan carrying both front matter and a `## Status` block no longer reports a phase nobody wrote. The writers set the Status block, the parser preferred front matter, and a delivery silently left the plan reading `approved`.

<!-- Board impact: the parser's contract gains a reported disagreement. Every
     plan in this repository carries one format, so nothing here changes. -->

## Design

**Filed as #924 from a real delivery in a project repo**, verified here line by
line 2026-09-16.

### The writers and the reader disagree about which field is the truth

**Three scripts write the Status block**, each guarded on `section == "status"`:
`plot-deliver.sh`, `plot-approve.sh`, and `plot-undeliver.sh` (three occurrences).
**They agree with each other.**

**The parser prefers front matter whenever it exists** (`plot-plan-meta.sh:443-446`):

```awk
if (fm_status != "" || fm_phase != "") {
    fmt = "frontmatter"
    praw = (fm_status != "") ? fm_status : fm_phase
```

The Status block is read only in the `else if` at `:448` — **only when no front
matter exists.**

**So on a plan carrying both, a delivery writes `Delivered` into a block nobody
reads and the parser goes on answering `approved`.** The reported summary is
`phase=flipped`, which is true of the write and false of the outcome.

### A second run cannot repair it

`plot-deliver.sh` is idempotent by design — *"If a run dies halfway, run it
again"* — and every step tests the source it would have written. Here that
property inverts: the second run finds its own `Delivered` line, reports
`phase=already`, and changes nothing. **The repair path is the failure path.**

### The mechanism to fix it already exists, one level down

**The parser ALREADY reports a disagreement — between two fields of one format.**
`:448-451`, in its own words:

> *"`State:` is primary and `Phase:` the alternate, exactly as front matter reads
> `status:` over `phase:`. **A file carrying both reports the disagreement rather
> than hiding it.**"*

That is `phase_alt_raw` / `phase_alt`, already in the contract (`:98-101`) and
already emitted (`:550`).

**A plan carrying front matter AND a Status block is the same defect one level
up, and there the parser chooses silently instead of reporting.** So this plan
extends an existing rule to the pair it does not cover rather than inventing one.

### The precedence is not the question — the silence is

**Front matter winning may well be right**, and this plan does not change it. A
repository that maintains front matter by hand and reads it deliberately is
served correctly today.

**What must not happen is a phase reported with no disagreement recorded**, when
two formats hold two different answers. A caller that wants to refuse on
ambiguity can then do so; today it cannot, because nothing tells it there is any.

### Why it has never surfaced here

Measured 2026-09-16:

| repository | front matter | `## Status` block |
|---|---:|---:|
| **plot** | **0** | **285** |
| the project repo where this occurred | 74 carry both | 1 |

**Every plan in this repository uses one format**, so the split cannot manifest —
which is exactly why it reached a released version. **A repository whose plans
carry front matter hits it on every delivery.**

### What this does not do

**It does not change which format wins.** Front matter keeps precedence; the
change is that a cross-format disagreement is reported rather than resolved in
silence.

**It does not rewrite any plan.** 285 plans here carry the Status block alone and
parse unchanged.

**It does not make the writers write both.** Three scripts writing two formats is
two records of one fact, and this estate's own reconcile scan counts that as
drift. **The Status block stays the single write target.**

## Open Questions

- [ ] **Should `/plot-deliver` refuse on a reported disagreement, or warn?**
  Refusing is safer and stops a delivery a person may need; warning ships the
  same silent failure with a line of text. **Does not block:** the parser
  reporting it is the prerequisite for either, and this plan builds that.

## Slices

### A plan has one phase (Branch: bug/a-plan-has-one-phase)

- `bug/a-plan-has-one-phase` — report a cross-format phase disagreement through the existing `phase_alt` fields, the way the parser already reports a within-format one

**Done when** a plan carrying front matter `status: Approved` and a Status block
`State: Delivered` reports **both** — the winning phase and the losing one in
`phase_alt_raw` / `phase_alt` — pinned by a fixture, since today the second value
is dropped; a plan carrying **one** format reports `phase_alt` as `NONE`
exactly as today, pinned across both formats separately; **all 285 plans in
`docs/plans/` parse byte-identically**, checked by diffing the parser's full
output before and after — this repository carries no plan with both, so any
difference is a regression rather than the fix; **which format wins is
unchanged**, pinned by a fixture asserting front matter still sets `phase`; the
existing **within-format** disagreement still reports exactly as it does now,
pinned, because that is the rule being extended and not replaced; and
`pnpm run test:contracts` passes.

**Not in this slice:** what `/plot-deliver` does with the report. That is the
Open Question above, and a refusal added in the same branch would ship a
behaviour change riding on a contract change.

## Notes

**The defect is invisible where it is worst.** The delivery prints
`phase=flipped` — true of the write, false of the outcome — so the one moment a
person would check is the moment the failure hides.

**It also costs the `Delivered:` record**, which `plot-fleet-scan.sh` reads for
its rolling window: a plan whose phase never flipped drops out of the scan that
would have shown the drift.

**Three writers, one reader, and the writers agree.** That is what makes this a
contract question rather than a missing line in one script — and why the fix is
in the parser rather than in `plot-deliver.sh`.
