# A record is written where it can be read

> `plot-approve` writes the `Approved:` record inside the template's HTML comment, where `plot-plan-meta.sh` cannot see it. Reproduced 2026-09-25 against the shipped template: the record lands between `<!-- Transition records` and `-->`, and the parser answers `approved_raw: ""`. The plan is approved, says so nowhere a reader can find, and renders without its record on GitHub.

## Status

- **State:** Approved
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #981
- **Sprint:** a-refusal-names-what-it-cannot-see
- **Rounds:** 1
- **Approved:** 2026-09-25, Jan Wloka, in-session after panel
- **Started:** 2026-09-25, Jan Wloka, `bug/an-insertion-point-is-not-inside-a-comment`

## Changelog

- The `Approved:` record is written outside the template's comment block, so `plot-plan-meta.sh` reads it and the plan renders with it. An adopting repository using the shipped template gets a readable record on its first approval.

Board impact: **yes.** The board reads `approved_raw` through `plot-plan-meta.sh`; a record it cannot see is an approval the board cannot show.

## Motivation

**Reproduced from the shipped template, 2026-09-25:**

```
$ append_approved_line <template> <out> "2026-09-25, Probe, plan-PR #1"
  [comment opens]
  INSIDE COMMENT -> - **Approved:** 2026-09-25, Probe, plan-PR #1
  [comment closes]

$ plot-plan-meta.sh <out>
  approved_raw: ""
```

The writer puts the record in; the reader cannot see it. Both are behaving as written.

### Why the insertion lands there

`plot-approve.sh:412-425` scans the `## Status` section for where to insert, and tracks the last list item:

```awk
if (lines[i] ~ /^[ \t]*[-*][ \t]/) insert = i
```

The template's comment block (`templates/plan.md:15-18`) contains two lines that match that pattern exactly:

```markdown
<!-- Transition records — written by the workflow commands, not by hand:
- **Approved:** <date>, <who>, <channel>
- **Started:** <date>, <who>, <branch>   (one line per started branch)
-->
```

**The awk has no notion of `<!--`.** It sees list items, takes the last one, and writes after it — inside the comment. The placeholder is doing exactly what a placeholder should, and the writer cannot tell it from a live line.

### This estate saw it 38 times

An earlier draft of this plan claimed the defect had never fired here, on a sweep of
`docs/plans/2026-09-2*.md`. **The window was the error.** Swept over `docs/plans/*.md`:

```
swallowed records: 38 across 10 plans
```

All 38 are `Started:` lines, and all were written by `append_started_line` in the dispatch
script (`:3026-3078`) — **the copy this plan did not mention**, and the source of every
measured loss.

### The guard already exists, and two writers missed it

`plot-deliver.sh:329-331` ships exactly the fix, in one line:

```awk
# An HTML comment ends the writable region. Checked BEFORE the
# placeholder arms so a commented-out `- **Delivered:**` template line
# is never mistaken for the slot to fill.
if (lines[i] ~ /<!--/) break
```

It landed in `19b60430a` (#597, 2026-09-01) with `test/reconcile/deliver-record-outside-comments.test.mjs`.
**So the slice is not *invent a guard* — it is *apply the shipped one to the two writers that
missed it*.** Three copies exist: `plot-deliver.sh` (fixed), `plot-approve.sh`
(`append_approved_line`), and `plot-dispatch.sh` (`append_started_line`, all 38 records).


## Design

### Two fixes exist and they are not equivalent

**A. Teach the writer about comment blocks.** Track `<!--` / `-->` in the awk and refuse to set `insert` inside one.

**B. Move the placeholders out of the comment.** Leave the explanation commented and the two lines bare.

**A is the one to build, and B is a trap.** The placeholders are `- **Approved:** <date>, <who>, <channel>` — a *bare* placeholder outside the comment is a line `plot-plan-meta.sh` will parse as a real record with the literal text `<date>, <who>, <channel>`. The parser's own empty-slot rule (`plot-approve.sh:422`) matches only `**Approved:**` followed by nothing, so a placeholder with text in it is not an empty slot either. B trades an invisible record for a false one.

**A also fixes every other writer of that shape.** `plot-deliver.sh` and `/plot-release` insert into the same section by the same reasoning; if the comment can swallow one record it can swallow theirs.

### The rule, and it is already written

**An HTML comment ends the writable region** — `break`, not depth-tracking. That is what
`plot-deliver.sh:330` does and the two other writers copy it verbatim. Depth-tracking would
place a record *after* a comment that sits before the live items, which 12 plans on this estate
have; `break` stops at the first comment and keeps the record above it. **Consistency with the
shipped fix decides this**: three copies of one guard must not differ, and converging on the
one that already has a test is the cheaper direction.

### What this does NOT do

- It does not change the template. The comment is good documentation and the placeholders belong in it.
- It does not change what the record says or where in `## Status` it goes for a plan with no comment — that path stays byte-identical.
- It does not touch `plot-plan-meta.sh`, which is right to ignore commented content.

### Open questions

- [ ] **Do `plot-deliver.sh` and `/plot-release` share the function or duplicate the logic?** If duplicated, the fix needs applying per copy and the duplication is its own finding.

## Done when

- Approving a plan written from the shipped template puts the record **outside** the comment, and `plot-plan-meta.sh` reports a non-empty `approved_raw`.
- A plan with no comment block is unchanged, asserted byte-for-byte.
- A plan whose `## Status` contains a comment block **after** the live list items still gets its record in the right place.
- **`Delivered:` needs nothing** — `plot-deliver.sh:329-331` already has the guard. **`Released:` is out of scope**: `skills/plot-release/SKILL.md:393-396` writes the record by hand with no awk, so there is no insertion point to guard.
- A test driving the shipped template end to end: approve, parse, assert the record is read.

## Slices

### An insertion point is not inside a comment (Branch: bug/an-insertion-point-is-not-inside-a-comment)

- `bug/an-insertion-point-is-not-inside-a-comment` — copy `plot-deliver.sh:330`'s `if (lines[i] ~ /<!--/) break` into `append_approved_line` (`plot-approve.sh`) and `append_started_line` (`plot-dispatch.sh:3026-3078`), which is where all 38 measured losses came from; a test per writer modelled on `deliver-record-outside-comments.test.mjs`; the shipped template exercised end to end — approve, parse, assert the record reads back

## Notes

- **Panelled 2026-09-25: `amend`, `Evidence: executed`.** The reproduction held, and the juror found the plan both **understated and over-scoped**. Understated: this estate has **38 swallowed records across 10 plans**, not zero — the draft swept `2026-09-2*.md` and the narrow window produced the wrong conclusion. Over-scoped: the guard already shipped in `plot-deliver.sh:329-331` (`19b60430a`, #597, 2026-09-01) with a test, so the slice is to apply it to the two writers that missed it rather than to design one. The primary target is `append_started_line` in the dispatch script, which the draft never mentioned and which wrote every one of the 38. Verified independently before amending. Verdict file: `.plot/panels/a-record-is-written-where-it-can-be-read/juror.md`.

- Reported against Plot 2.20.0 as a plugin install, and reproduced here directly against `templates/plan.md` rather than taken on trust.
- **The failure is silent in both directions.** The writer reports success, the phase flips correctly, and only a later reader — the board, the release gate, `/plot-deliver` — finds the record missing. Nothing at approval time says anything is wrong.
