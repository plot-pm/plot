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
- **Rounds:** 4

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

**`plot-idea`'s PROSE is correct and the artefact it ships is not.** Measured
2026-09-15: `skills/plot/templates/plan.md:40` still says `## Branches`, while
this repository's own `.plot/templates/plan.md:60` says `## Slices`.

**So every adopting project receives a template teaching the legacy word while we
fixed ours.** That is the highest-value target in this change and an earlier
draft of this plan did not name it.

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

### The parser is not touched, and the risk was overstated

**All three spellings keep parsing.** This plan changes what the skills *teach*,
never what the parser *accepts*.

**An earlier draft claimed 132 delivered plans carry `## Waves` and would be
stranded. Measured on main: ZERO do.** The number was inherited from
`plot-plan-meta.sh`'s own comment, true when written and stale now, and four
passages of this plan rested on it. **The migration risk it describes does not
exist**, which makes this change safer than it was argued to be, not more urgent.

### The word lives in four tiers, and only one is a target

**Measured on `origin/main` 2026-09-15** — an earlier draft's numbers were wrong
and its framing worse, so these are stated as they were derived:

```
git grep -c '## Branches' origin/main                       → 632 total
git grep -c '## Branches' origin/main -- 'skills/*/SKILL.md' →  18
git grep -c '## Branches' origin/main -- 'skills/'           →  61
```

**61 sit under `skills/` and they CONTAIN the 18** — an earlier draft wrote
*"62 occurrences outside the nine skills"*, which is both the wrong number and
additive where the real relation is inclusive. **The remaining 571 are elsewhere
in the repository**, overwhelmingly test fixtures and the parser's own comments.

| Tier | Where | Target? |
|---|---|---|
| Skill prose | 9 `SKILL.md` files | **yes**, 18 |
| The shipped template | `skills/plot/templates/plan.md:40` | **yes** |
| The second copy-me example | `skills/plot/intro-to-using-plot.md:88` | **yes** |
| README instruction lines | `tracer-bullets`, `plot-pulse`, `plot-reslice` | **yes**, by sentence |
| Everything else | parser comments, changelog history, **26 in `packages/*/test/`**, all other fixtures | **no** |

**The exemption gate therefore counts what it excludes rather than asserting a
literal total**, because a total is a number that goes stale between drafting and
dispatch — and did.

**A blanket `grep → 0` gate would falsify the parser's own measurements.**
`plot-plan-meta.sh:778` records *"renaming its `## Branches` to `## Slices` took
it from 6 branches to 0"* — a sentence that must keep the word to stay true — and
the same gate would rewrite historical changelog entries. **Fixtures must keep
the legacy word**, since they exist to prove the parser still reads it.

### What this does not do

**It does not rewrite existing plans.** 132 carry `## Waves` and more carry
`## Branches`; rewriting them is a migration with its own blast radius, and the
parser reads them correctly today.

**It does not touch the code's `Wave`-for-`Slice` naming.** That is the known
defect `CLAUDE.md` names, with its own plan.

## Slices

### The skills say Slices (Branch: docs/the-skills-say-slices)

- `docs/the-skills-say-slices` — replace `## Branches` with `## Slices` across the nine skills that teach it, and say once where a reader can learn why a Slice is not a Wave

**Done when** the nine `SKILL.md` files, **the shipped template
`skills/plot/templates/plan.md:40`**, **`skills/plot/intro-to-using-plot.md:88`**
— the second copy-me example — and the instruction lines in
`tracer-bullets/README.md:28`, `plot-pulse/README.md:56` and
`plot-reslice/README.md` teach `## Slices`, pinned by a test naming each file
explicitly rather than by a repository-wide grep; **`plot-reslice/README.md:57`
keeps BOTH words**, pinned by name, since it states what the parser accepts and a
file-level rule would break it; **`plot-deliver/SKILL.md:113` and
`ralph-plot-sprint/SKILL.md:117` stay TOLERANT** — gaining `## Slices` alongside
what they already match rather than replacing it — pinned explicitly, because a
literal replacement narrows them to strict and passes a naive gate silently; **script
comments, `MANIFESTO.md`, `changelog.md`, the READMEs' non-instruction lines,
**and every occurrence under `packages/board/test/` and `packages/domain/test/`
— measured at 26, including the `tiny-garden` fixture plan — are UNCHANGED**,
pinned by asserting those paths are untouched by the diff rather than by
asserting a count — a blanket gate would falsify `plot-plan-meta.sh:778`'s own measurement
and rewrite shipped history; **the parser still reads all three spellings**,
pinned by parsing one plan of each shape and asserting identical output; **every
plan in `docs/plans/` parses byte-identically to today**, checked by diffing the
parser's full output before and after; the Slice/Wave distinction is stated
**once**, where a reader meets it; and `pnpm test` passes.

## Notes

**Filed as #914 with the counts**, verified here before drafting.

**Amended four times. Round 4 found the round-3 fix incomplete**: the tier table
and its paragraph were corrected and **the `Done when` was left untouched**, so
the plan's prose and its gate disagreed — and when they disagree the implementer
picks, which is the judgement a gate exists to remove. The exemption now asserts
**paths untouched by the diff** rather than a count, because a count is what went
stale twice. It also found `packages/board/test/` and `packages/domain/test/` in
**no list at all** — 26 occurrences including the `tiny-garden` fixture plan,
which this estate has been burned by writes to before.

**Amended three times. Round 3 blocked on the exemption gate's numbers**: the
four-tier table pinned counts that are false — 632 occurrences repo-wide against
a table implying 62 — and framed 61 under `skills/` as additive to the 18 they
contain. It also found a gate that could not fail. Both are fixed by counting
what is excluded rather than asserting a total.

**Amended twice. Round 2 found the boundary still wrong in two ways**: six files
under `skills/` sat in neither list, including `intro-to-using-plot.md`'s
copy-me example, and the exemption unit was the FILE where the real unit is the
SENTENCE. It also found the literal-execution hazard — two tolerant instructions
that a find-and-replace would silently narrow to strict while passing the gate.

**Amended 2026-09-15 after a two-lens panel**
(`.plot/panels/2026-09-15-the-skills-say-slices/`), unanimous `amend`. The
per-skill counts held. Two claims did not: **zero delivered plans carry
`## Waves`**, against the 132 this plan inherited from a stale comment, and
**`plot-idea` ships a template that still says `## Branches`** — the one target
worth most, unnamed in the first draft. The `grep → 0` gate is replaced by a
named-file gate, because the blanket form would have rewritten the parser's own
measurements, shipped changelog entries and the fixtures whose whole purpose is
to carry the legacy word.
