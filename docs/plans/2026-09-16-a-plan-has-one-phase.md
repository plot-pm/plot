# A delivery proves its own write

> A delivery writes the phase, reports `phase=flipped`, and never reads the file back — so where the parser disagrees with the writer it claims a success it did not achieve, and a second run reports `already`.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #924
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** the-domain-knows-what-plot-knows
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 2

## Changelog

- `/plot-deliver` verifies its own write by re-reading the plan through the parser, and refuses rather than reporting a success it did not achieve. A delivery on a plan carrying two formats reported `phase=flipped` while the parser kept answering `approved`.

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

### Reporting the disagreement was the first draft, and it fails on the reported case

**An earlier draft proposed extending `phase_alt` to carry a cross-format
disagreement.** Reproduced 2026-09-16 against the reporter's exact shape — both
`status:` and `phase:` in front matter, plus a Status block:

```
phase: approved | phase_alt_raw: "Approved" | format: frontmatter
```

**The slot is already OCCUPIED**, by the within-format pair, and the two reported
values **agree** — so a consumer testing `alt != phase` sees nothing wrong, and
the Status block's `Delivered` appears nowhere in the output. A one-slot
`phase_alt` cannot carry both disagreements.

**And nobody reads it.** Measured: zero references to `phase_alt` across twelve
consuming scripts and the whole board. `DESIGN-plan.md:261` calls it *"a conflict
nobody has hit"*. **That draft was inert — it would have satisfied its own gates
while the reporter's delivery failed exactly as before.**

### The fix is a gate on the writer, not a report from the reader

**The script parses TWICE — `:98` and `:384` inside `decide_transition` — and
neither happens after the write.** The second is the parse that decides the
transition, called with the file's own parse because *"on the booking-worktree
flow those are different files"*. So the script reports `phase=flipped` on the
strength of having performed a write, not on the strength of the write having
taken effect.

**This estate's own test settles it** — *"Can you answer 'did I complete this?'
without actually doing the work? If yes, it's a rule."* A delivery that prints
`phase=flipped` without re-reading answers exactly that way.

### The check runs BEFORE the irreversible step, and that is what makes it safe

**A gate after the push would be the wrong shape twice over.**

**The exit contract says so.** `plot-deliver.sh:9-11` documents exit 0 as *"the
plan is Delivered on the default branch"* — and after a successful push that is
exactly what a gate-tripping run has achieved. **A refusal there would exit 1 on
a run where the documented exit-0 condition holds**, which is a contract
amendment rather than a bug fix.

**And the caller that matters is automatic.** `runAutoDeliver` is wired live at
`fleet.ts:2986`, spawned **detached with nobody watching**, and its `onExit`
treats any non-zero as *log a line and do not reap*. A refusal after a successful
push would leave the plan delivered on main, the desk unreaped, and no person
reading the line.

**So the check is a DRY RUN of the write, before anything is committed.** The
script already knows the phase it is about to write; it asks the parser what the
file would then report, and refuses **before** the commit and the push where the
two disagree. Nothing is written, so the refusal costs nothing and the existing
exit-0 contract is untouched.

**Three properties follow, and none needs a format decision:**

- **It is format-agnostic.** It catches any writer/reader split, not this one
  instance — including one nobody has hit yet.
- **It stops the half-write.** An earlier draft claimed a second run reports
  `already`; **measured, it reports `write`** — `decide_transition` asks whether
  the file carries the phase AND the record, and the reporter's file carries a
  `Delivered` Status block with no complete record, so it writes again. The
  defect is not that a re-run refuses to act; it is that acting never takes
  effect. **The gate stops the first run instead of letting every run write into
  a field nobody reads.**
- **It changes nothing where the formats agree** — every plan in this repository,
  and every correct delivery anywhere.

### Why it has never surfaced here### Why it has never surfaced here

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
two records of one fact, and the reconcile scan counts that as drift. **The
Status block stays the single write target** — and a refusal tells the person
their file holds two, which writing both would hide.

**It does not change the parser.** The disagreement is detected by re-reading,
so no contract field moves and no consumer changes.

**It does not fix `/plot-approve` or `/plot-undeliver`.** Both carry the same
shape and the same gate would serve them; this slice proves it on the path where
the defect was filed, and the other two follow once it holds.

## Slices

### A plan has one phase (Branch: bug/a-plan-has-one-phase)

- `bug/a-plan-has-one-phase` — report a cross-format phase disagreement through the existing `phase_alt` fields, the way the parser already reports a within-format one

**Done when** `plot-deliver.sh` **re-parses the plan after writing** and asserts
the phase the parser reports, pinned by a fixture carrying front matter
`status: Approved` and a Status block the script flips to `Delivered` — the
reporter's exact shape, reproduced 2026-09-16 as `phase: approved`; **the refusal
names BOTH values and the file**, pinned by asserting the message contains the
written phase and the parsed one, since a refusal saying only *"delivery failed"*
throws away the half a person acts on; **nothing is written, committed or pushed when the gate fires**, pinned by
asserting the file is byte-identical after a refused run — the check is a dry run
before the irreversible step, and a refusal after the push would exit 1 on a run
meeting the documented exit-0 condition (`:9-11`) while `runAutoDeliver`
(`fleet.ts:2986`) logs it to nobody; **a second run on an unrepaired file refuses
the same way**, pinned explicitly, since `decide_transition` answers `write`
rather than `already` on that file — measured, correcting an earlier draft; **a delivery
where writer and parser agree is byte-identical to today**, pinned across both
formats separately, covering every plan in this repository; **no parser field
changes**, asserted by diffing `plot-plan-meta.sh`'s full output over all 289
plans before and after; and `pnpm run test:contracts` passes.

**Not in this slice:** the same gate on `/plot-approve` and `/plot-undeliver`.
Both share the shape and both deserve it; proving it once on the path where the
defect was filed is the smaller change, and the other two are a follow-up whose
argument this slice supplies.

## Notes

**The defect is invisible where it is worst.** The delivery prints
`phase=flipped` — true of the write, false of the outcome — so the one moment a
person would check is the moment the failure hides.

**It also costs the `Delivered:` record**, which `plot-fleet-scan.sh` reads for
its rolling window: a plan whose phase never flipped drops out of the scan that
would have shown the drift.

**Round 2 corrected two claims and moved the gate.** The script parses **twice**,
not once, and the true statement is that neither parse follows the write. A
second run answers **`write`**, not `already` — measured by a juror running it —
so the idempotence complaint is real and the mechanism I described was not. And
the check moved **before** the irreversible step: the documented exit-0 contract
is *"the plan is Delivered on the default branch"*, which a post-push refusal
would contradict, while `runAutoDeliver` runs detached and would log that
refusal to nobody.

**Rewritten 2026-09-16 after a three-lens panel**
(`.plot/panels/2026-09-16-a-plan-has-one-phase/`). The first draft proposed
reporting the disagreement through `phase_alt` and was inert twice over: the slot
is **already occupied** by the within-format pair on the reporter's exact file —
reproduced, `phase_alt_raw: "Approved"`, the two values agreeing — and **nobody
reads the field**, zero references across twelve scripts and the board.

**The remedy lens named two alternatives the draft never considered**, and the
stronger one is now the plan: a delivery that verifies its own write. It is a
**gate** where the draft was a **rule**, it is format-agnostic, and it restores
the idempotence the ticket's second complaint is about.

**Three writers, one reader, and the writers agree.** That is what makes this a
contract question rather than a missing line in one script — and why the fix is
in the parser rather than in `plot-deliver.sh`.
