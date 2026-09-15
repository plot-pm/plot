# Readiness lens, round 3 — the-skills-say-slices (#914)

Read on `origin/main` @ `af09f8dcb`. Every count re-derived with `git grep` against `origin/main`. My question is narrow: **would I hand this to an agent tomorrow and expect the right diff back?**

**Answer: not yet, and the blocker is one sentence.** The amendment closed R2's boundary gap — I re-derived the file list and **nothing sits in neither list any more**. But the `Done when` asks the implementer to pin exemptions "by asserting their count is exactly what it is today" and hands them a number that is **wrong in three places**. An agent writing the assertion from the plan writes a test that fails on a clean checkout.

## 1. The amendment's new claims, verified

### The boundary is now closed at file level — TRUE, and this was R2's core finding

I re-derived it rather than trusting either side. All 29 `## Branches` occurrences in `.md` files under `skills/`, by file, against the plan's two lists:

```
git grep -l '## Branches' origin/main -- 'skills/**/*.md'   →  15 files
comm against {named in Done when} ∪ {exempted}              →  EMPTY
```

**Nothing is in neither list.** R2's six orphans are all placed:

| File | occ | Where the amendment puts it | Right? |
|---|---:|---|---|
| `skills/plot/intro-to-using-plot.md` | 1 | named, `:88` | **yes** — `:89` is a fenced `markdown` block headed `## Branches`, introduced by *"Group your branches under `### ` subheadings"*. Verified: a copy-me example |
| `skills/tracer-bullets/README.md` | 1 | named, `:28` | **yes** — *"Add `### Tracer` subsection to plan's `## Branches`"* is a write-instruction |
| `skills/plot-pulse/README.md` | 2 | named, `:56` | **partly** — see §2 |
| `skills/plot-reslice/README.md` | 4 | named, with `:57` pinned to keep both | **yes** — `:17,37,50` instruct, `:57` describes tolerance. Read all four; the split is exact |
| `skills/plot/MANIFESTO.md` | 1 | exempt | **yes for the change**, but see §3 |
| `skills/plot/changelog.md` | 1 | exempt | **yes** — `:58` is a dated history entry |

The sentence-level rule the plan now states — *tells a reader what to write → change; states what the parser accepts or records history → keep* — sorts all 29 correctly when applied by hand. I applied it to every occurrence and found no misclassification.

### The two tolerant instructions — CORRECTLY handled

`plot-deliver/SKILL.md:113` and `ralph-plot-sprint/SKILL.md:117`, read in full on main, are the tolerant matchers R1 and R2 both flagged. The amendment pins them to **gain** `## Slices` rather than replace, *"because a literal replacement narrows them to strict and passes a naive gate silently"*. That is the right instruction, stated in the right place, and it names the failure mode. **This was R2's highest-value unaddressed finding and it is now addressed.**

### The template and `intro` — TRUE and exact

```
origin/main:skills/plot/templates/plan.md:40:## Branches
origin/main:.plot/templates/plan.md:60:## Slices
origin/main:skills/plot/intro-to-using-plot.md:89:## Branches
```

Line numbers check out (the plan cites `:88`, the fence opens at `:88` and the heading is `:89` — that is the block, not an error).

## 2. THE BLOCKER — the exemption gate is pinned to numbers that are false

The `Done when` says exemptions are *"pinned by asserting their count is exactly what it is today"*. The counts the plan supplies:

| Plan says | I measured | |
|---|---|---|
| *"205 occurrences across 45 contract tests"* | **207 across 46** in `test/` | **WRONG** |
| *"19 in `plot-plan-meta.sh` alone"* | **20 occurrences on 19 lines** | **off by one** |
| *"`## Branches` appears 62 times **outside** the nine skills"* | 62 is the total **under** `skills/` and **includes** the 18; outside them it is **44** | **WRONG** |
| *"33 in `.sh`/`.mjs`"* | 33 | OK |

R2 reported all three. **None was corrected.** The amendment changed the prose around the table and left the table's numbers as they were.

**Why this is a blocker and not pedantry — it is the one clause an implementer must execute mechanically.** Every other `Done when` clause names a file and an action; this one names a *number* and says assert it. An agent that trusts the plan writes `assert(count === 205)`, runs it on a clean tree, and gets 207. From there the two available moves are both bad: hunt a phantom regression, or "correct" the baseline — and a count gate whose baseline was guessed once teaches that adjusting it is normal, which is exactly the property that makes a count gate worth having.

**And the 205 figure carries a scope error on top of the arithmetic.** It is scoped by that number to `test/`. It therefore says nothing about **`packages/board/test/` (24 occurrences, including the tracked `tiny-garden` fixture plan) or `packages/domain/test/` (2)**. Those are outside `skills/`, so the file-list boundary does not reach them either. An implementer sweeping the repo has **no written instruction to leave them alone**, and the `tiny-garden` fixture is one this estate has been burned by before.

This is one edit — replace three numbers and add two directory names. It is not a design question and it does not need a fourth panel round. But it must happen before dispatch, because it is the clause the implementer cannot resolve by judgement: the plan states a fact, the fact is wrong, and the gate's whole value is that the number was measured.

## 3. Walking `Done when` as the implementer — what else needs a call I would have to make myself

Executing the rest is mostly unambiguous. Three places still hand me a judgement the plan did not make. **None blocks on its own**; I list them so the amendment can take them in the same pass.

**a. `plot-pulse/README.md` has two occurrences and the plan names one.** `:56` is named. `:98` — *"Not every prefixed token in a `## Branches` section is implementation work"* — is a write/read instruction under the sentence rule, so it should change, and the gate names only `:56`. I can derive the answer from the rule; the gate will not catch me if I get it wrong. Same shape in `plot-reslice/README.md`, where the plan names `:57` to keep and leaves `:17,37,50` to the rule.

**b. *"the Slice/Wave distinction is stated once, where a reader meets it"* still names no file and no assertion.** R1 and R2 both said so. And the file where the distinction is currently stated *wrongly* — `MANIFESTO.md:35`, *"A wave is a `### ` subheading of `## Branches`"* — is on the exempt list. So "once" is ambiguous between amending the design authority (which the plan exempts) and adding a sentence somewhere unspecified. I would pick a file and no gate would disagree with me.

**c. *"every plan in `docs/plans/` parses byte-identically"* cannot fail.** The change touches no plan file and 0 of 285 carry the legacy spelling. It reads as verification and pins nothing. Cheap, so not worth blocking on — but it gives false assurance that the change was verified, which is the property the plan is otherwise careful about.

**d. No changeset named.** `skills/**` is in `plot-reconcile-scan.sh` §22's `no_changeset=` scope.

## 4. Is anything in the plan FALSE, or merely imprecise?

**False:** the three counts in §2, and the *"outside the nine skills"* framing that makes 62 read as additive to 18 when it contains them.

**Imprecise but not false:** *"the nine `SKILL.md` files"* — `plot-idea/SKILL.md` carries **zero** `## Branches` and one `## Slices` at `:270`. It is correctly in the nine as a file that must *end up* teaching `## Slices`, which it already does. Harmless; an implementer finds nothing to change there and moves on.

**Sound and re-verified by me:** the per-skill table (18 across 8, `plot-idea` 0/1); the parser comment quoted verbatim at `plot-plan-meta.sh:59-64`; zero plans carrying `## Waves` or `## Branches` against 285 carrying `## Slices`; the template disagreement; both tolerant-matcher line numbers; `plot-plan-meta.sh:778` as a sentence that must keep the word.

## 5. Would I dispatch it tomorrow?

**Not as written — for one clause, with a one-edit fix.** Everything a fourth round would normally be for is done: the boundary is closed, the sentence rule is stated, the hazard R2 called the worst is named with its failure mode, and the false 132 is gone with the correction made in the honest direction. The plan is one number-fix from dispatchable, and I would not hold it for §3 alone.

What I checked, so a reader can weigh this: I re-derived the full 62-occurrence list under `skills/` and diffed it programmatically against both of the plan's lists (result: empty); read every `.md` occurrence in context and applied the plan's own sentence rule to each; read both tolerant matchers in full; re-measured the four exemption counts, the `test/` and `packages/*/test/` populations, and the plan-file estate; and confirmed the two template line numbers and the intro fence.

**The single defect that blocks it:** the exemption gate instructs the implementer to pin a count and supplies **205/45** where the tree holds **207/46**, with `packages/board/test/` (24) and `packages/domain/test/` (2) in no list at all. Fix those numbers, name those two directories, and I would hand this to an agent without reservation.

Verdict: amend
