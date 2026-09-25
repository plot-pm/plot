# A record is written where it can be read

> `plot-approve` writes the `Approved:` record inside the template's HTML comment, where `plot-plan-meta.sh` cannot see it. Reproduced 2026-09-25 against the shipped template: the record lands between `<!-- Transition records` and `-->`, and the parser answers `approved_raw: ""`. The plan is approved, says so nowhere a reader can find, and renders without its record on GitHub.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #981
- **Sprint:** a-refusal-names-what-it-cannot-see

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

### Why this estate never saw it

This repository's own plans do not carry the comment block — they were written before it, or by hand. A sweep of `docs/plans/2026-09-2*.md` finds **no commented record**. The defect needs the shipped template, which is what an adopting repository starts from. **So it fires on a first approval in a new repository and nowhere else**, which is the worst place for it to hide.

## Design

### Two fixes exist and they are not equivalent

**A. Teach the writer about comment blocks.** Track `<!--` / `-->` in the awk and refuse to set `insert` inside one.

**B. Move the placeholders out of the comment.** Leave the explanation commented and the two lines bare.

**A is the one to build, and B is a trap.** The placeholders are `- **Approved:** <date>, <who>, <channel>` — a *bare* placeholder outside the comment is a line `plot-plan-meta.sh` will parse as a real record with the literal text `<date>, <who>, <channel>`. The parser's own empty-slot rule (`plot-approve.sh:422`) matches only `**Approved:**` followed by nothing, so a placeholder with text in it is not an empty slot either. B trades an invisible record for a false one.

**A also fixes every other writer of that shape.** `plot-deliver.sh` and `/plot-release` insert into the same section by the same reasoning; if the comment can swallow one record it can swallow theirs.

### The rule

**A line inside an HTML comment is not an insertion point.** The awk tracks comment depth and skips those lines when choosing `insert` and when matching the empty slot.

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
- The same protection covers `Delivered:` and `Released:`, or the plan says why it does not.
- A test driving the shipped template end to end: approve, parse, assert the record is read.

## Slices

### An insertion point is not inside a comment (Branch: bug/an-insertion-point-is-not-inside-a-comment)

- `bug/an-insertion-point-is-not-inside-a-comment` — `append_approved_line`'s awk tracks `<!--`/`-->` depth and never chooses an insertion point or an empty slot inside one; the same guard applied to every writer that inserts into `## Status`; tests for the shipped template, for a plan with no comment, and for a comment sitting after the live items

## Notes

- Reported against Plot 2.20.0 as a plugin install, and reproduced here directly against `templates/plan.md` rather than taken on trust.
- **The failure is silent in both directions.** The writer reports success, the phase flips correctly, and only a later reader — the board, the release gate, `/plot-deliver` — finds the record missing. Nothing at approval time says anything is wrong.
