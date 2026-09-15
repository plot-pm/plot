# The skills say Slices

> Nine skills teach `## Branches` eighteen times, one teaches `## Slices` once, and the parser's own comment settles which is accurate.

## Status

- **State:** Draft
- **Type:** docs
- **Issue:** #914
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** the-domain-knows-what-plot-knows
- **Review:** in-session
- **Impl:** own branches

## Changelog

- The skills teach `## Slices`, the name the parser calls accurate. They taught `## Branches` eighteen times against one correct use, so every plan written from a skill carried the legacy word.

<!-- Board impact: none. Skill prose only; the parser already reads all three
     spellings and this changes no plan file. -->

## Design

**`plot-plan-meta.sh` settles the question in its own comment:**

> *"A Slice holds one branch and belongs to one plan; a Wave is the fleet cohort
> that spans plans. The section here was always the former, so `## Slices` is the
> accurate name and `## Waves` is the one 132 delivered plans already carry."*

**So of the three spellings the parser reads, one is accurate, one is a legacy
shape, and one names a different concept.** The skills teach the legacy one.

### The count, measured 2026-09-15

| Skill | `## Branches` | `## Slices` |
|---|---:|---:|
| `plot-reslice` | 7 | 0 |
| `plot-implement` | 3 | 0 |
| `plot-deliver` | 3 | 0 |
| `plot-approve` | 1 | 0 |
| `plot-pulse` | 1 | 0 |
| `plot-reconcile` | 1 | 0 |
| `plot` | 1 | 0 |
| `ralph-plot-sprint` | 1 | 0 |
| **`plot-idea`** | 0 | **1** |

**Verified in this repository**: `plot-reslice` 7/0, `plot-implement` 3/0,
`plot-deliver` 3/0, `plot-idea` 0/1.

**`plot-idea` is the one skill that writes a plan from scratch, and it is already
correct.** Every other skill *reads* or *amends* a plan — so the accurate word is
taught exactly where a new plan is born, and the legacy word everywhere a reader
learns what to look for.

### Why this is more than a rename

**`Wave` names a different concept, and a reader taught `Branches` has no way to
learn the difference.** `DESIGN-slice.md` is explicit: a Slice holds one branch
and belongs to one plan; a Wave is the fleet's cohort and spans plans. A skill
saying `## Branches` teaches neither, so the distinction survives only in the
parser and in `CLAUDE.md`.

**And the estate is mid-migration in code already.** `CLAUDE.md` records it:
*"The code still says `Wave` where it means `Slice` — that is a known defect with
its own plan, and no new code may add to it."* **The skills are the same defect
in prose**, and they are what a person reads first.

### The parser is not touched

**All three spellings keep parsing.** 132 delivered plans carry `## Waves` and
they must keep working — this plan changes what the skills *teach*, never what
the parser *accepts*. A docs change that broke a delivered plan would be a far
worse defect than the one it fixes.

### What this does not do

**It does not rewrite existing plans.** 132 carry `## Waves` and more carry
`## Branches`; rewriting them is a migration with its own blast radius, and the
parser reads them correctly today.

**It does not touch the code's `Wave`-for-`Slice` naming.** That is the known
defect `CLAUDE.md` names, with its own plan.

## Slices

### The skills say Slices (Branch: docs/the-skills-say-slices)

- `docs/the-skills-say-slices` — replace `## Branches` with `## Slices` across the nine skills that teach it, and say once where a reader can learn why a Slice is not a Wave

**Done when** `grep -c '## Branches'` across `skills/` returns **0**, asserted by
a test rather than by a reviewer counting; **the parser still reads all three
spellings**, pinned by parsing one plan of each shape and asserting identical
output — a docs change that broke `## Waves` would strand 132 delivered plans;
**every delivered plan parses byte-identically to today**, checked by diffing the
parser's full output before and after across the whole estate; the distinction
between a Slice and a Wave is stated **once**, where a reader meets it, rather
than repeated in nine skills; and `pnpm test` passes.

## Notes

**Filed as #914 with the counts**, verified here before drafting.

**`plot-idea` needs no change** — the one skill that writes a plan already says
`## Slices`, which is why new plans on this estate are correct and every skill
that reads one teaches otherwise.
