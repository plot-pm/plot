# Scope lens, round 2 — the-skills-say-slices (#914)

Read on `origin/main` @ `af09f8dcb`. Every count below re-derived with `git grep` against `origin/main`. My question is one thing only: **is the boundary between "change this" and "leave this" drawn in the right place, and stated precisely enough that an implementer cannot get it wrong?**

**Answer: the boundary moved to roughly the right place, and it is still not stated precisely enough. Six files under `skills/` carrying the word sit in NEITHER list.**

## What I read

`docs/plans/2026-09-15-the-skills-say-slices.md` (amended); `.plot/panels/2026-09-15-the-skills-say-slices/premise.md` and `blast-radius.md`; `skills/plot/templates/plan.md`; `.plot/templates/plan.md`; `scripts/check-plan-headings.sh`; `skills/plot-deliver/SKILL.md`; `skills/ralph-plot-sprint/SKILL.md`; `skills/plot-reslice/README.md`; `skills/plot-pulse/README.md`; `skills/tracer-bullets/README.md`; `skills/plot/MANIFESTO.md`; `skills/plot/intro-to-using-plot.md`.

## 1. Are the amendment's new claims TRUE?

### TRUE — zero plans carry `## Waves`

```
git grep -l '^## Waves'    origin/main -- 'docs/plans/*.md'  →   0
git grep -l '^## Branches' origin/main -- 'docs/plans/*.md'  →   0
git grep -l '^## Slices'   origin/main -- 'docs/plans/*.md'  → 285
```

The amendment states this correctly and says so in bold. **Sound.**

### TRUE — the template disagreement

```
origin/main:.plot/templates/plan.md:60:## Slices
origin/main:skills/plot/templates/plan.md:40:## Branches
```

Both line numbers are exact. **Sound, and it is the change's real subject.**

### The four-tier table: three rows TRUE, two rows WRONG

| Plan's row | Plan says | I measured | |
|---|---|---|---|
| Skill prose | 9 files, 18× | 18 across 8 SKILL.md (`plot-idea` has 0) | **OK** |
| Shipped template | `plan.md:40` | 1 | **OK** |
| Script comments | 33 in `.sh`/`.mjs`, **19** in `plot-plan-meta.sh` | 33 total; `plot-plan-meta.sh` = **20 occurrences on 19 lines** | **off by one** |
| Docs and history | MANIFESTO, changelog, READMEs | correct as a list, **but see §2 — it is a target list masquerading as an exemption list** | partial |
| Test fixtures | **205** across **45** contract tests | **207** across **46** files (`test/` only); +24 in `packages/board/test/`, +2 in `packages/domain/test/` = **233 test occurrences repo-wide** | **WRONG** |

**The header sentence is also wrong.** The plan says `## Branches` appears *"62 times **outside** the nine skills"*. Measured: **62 is the total under `skills/`, and it INCLUDES the 18.** Outside the SKILL.md files it is **44**. Repo-wide the word appears **627 times**.

This matters for scope, not pedantry: the gate says *"assert their count is exactly what it is today"*. **An implementer who writes the assertion from the plan's numbers writes `205` and `45`, and the test fails on a clean checkout.** They will then either hunt a phantom regression or "fix" the number — and a count gate whose baseline was guessed once teaches that adjusting it is normal.

### Unverified by the plan, and load-bearing

**The plan never mentions `scripts/check-plan-headings.sh`.** It exists, it runs in CI (`ci.yml:501`), its header reads *"THE GATE THAT KEEPS THE WORD. A plan's branch section is `## Slices`"*, and — measured — **it reads `docs/plans/*.md` and nothing else.** So the template defect is genuinely unguarded, which strengthens the plan's case; but a plan proposing to fix the vocabulary that does not name the gate already enforcing it leaves the implementer to rediscover it.

## 2. Is the named-file gate correct? NO — six files are in neither list

This is my lens's core finding. The gate has a **change list** (nine SKILL.md + the template) and an **exempt list** (script comments, MANIFESTO.md, changelog.md, "the READMEs", fixtures). Between them:

| File | occ | In change list? | In exempt list? | What it actually is |
|---|---:|---|---|---|
| `skills/plot-reslice/README.md` | 4 | no | "the READMEs" | **mixed** — `:17,37,50` are instructions, `:57` names both spellings and is TRUE as written |
| `skills/plot-pulse/README.md` | 2 | no | "the READMEs" | `:56` *"A wave is a `### ` subheading under `## Branches`"* — **teaching text** |
| `skills/tracer-bullets/README.md` | 1 | no | "the READMEs" | `:28` *"Add `### Tracer` subsection to plan's `## Branches`"* — **a direct instruction to write** |
| `skills/plot/intro-to-using-plot.md` | 1 | no | no | `:89` inside a ```markdown fence — **a worked example a reader copies** |
| `skills/plot/MANIFESTO.md` | 1 | no | yes | `:35` — design authority |
| `skills/plot/changelog.md` | 1 | no | yes | history |

**`intro-to-using-plot.md` is named in neither sentence at all.** And it is the worst case for the plan's own goal: `:88-95` is a fenced `markdown` block headed `## Branches` that the surrounding prose introduces with *"Group your branches under `### ` subheadings:"*. That is a copy-me example. A reader following the intro writes a plan that **CI then refuses** — the identical defect the plan calls "the highest-value target" in the template. The plan fixes one copy-me source and leaves the other unnamed.

**"the READMEs" is an exemption the plan cannot mean.** `tracer-bullets/README.md:28` and `plot-pulse/README.md:56` are instructions, indistinguishable in kind from the SKILL.md lines being changed. Exempting them by file-type says: the same sentence is drift in `SKILL.md` and correct in `README.md`. Meanwhile `plot-reslice/README.md:57` — *"the same `## Branches` / `## Waves` shapes `plot-plan-meta.sh` already parses"* — **must keep both words to stay true**, and sits in the same file as three that should change. **The plan's exemption unit is the FILE; the real unit is the SENTENCE.**

### The boundary the plan needed and did not draw

Round 1 (blast-radius §4) found it and the amendment did not adopt it: **does the sentence tell a reader what to WRITE, or describe what the parser ACCEPTS?** Write-instructions change; accept-descriptions keep every spelling. That rule sorts all 62 correctly, including the three mixed files. The plan's file-list gate cannot express it, so it hands the implementer a list where `plot-reslice/SKILL.md`'s 7 occurrences are all "change" — and I measured that at least one sibling sentence in that skill's README is a true statement about tolerance.

### Two files the change list names that would be actively damaged

`skills/plot-deliver/SKILL.md:113` and `skills/ralph-plot-sprint/SKILL.md:117` are in the nine. Both read *"any heading containing the word 'Branches'"* / *"matches `## Branches`, `## Implementation Branches`, `### Implementation Branches`"*. The plan's slice line says **"replace `## Branches` with `## Slices`"** with no qualification. Executed literally, these become *"any heading containing the word 'Slices'"* — which **passes the named-file gate** and silently narrows an agent instruction from tolerant to strict, against an estate the plan elsewhere swears keeps reading all three. R1 flagged both; **the amendment mentions neither.** They are simultaneously the change's best justification (they match nothing on today's 285-plan estate) and its biggest literal-execution hazard, and the plan names them nowhere.

## 3. Must all 205 fixtures keep the legacy word? Mostly yes — but the number is wrong and the scope is under-drawn

**The principle is right.** `test/reconcile/fixtures/plans/canonical-waves.md`, `canonical-branches-in-prose.md`, `canonical-waves-heading-twin.md`, `canonical-approved-branches.md` and `packages/board/test/fixtures/tiny-garden/docs/plans/2026-03-01-plant-tomatoes.md` exist to prove the parser still reads the old word. Rewriting any of them deletes the evidence for the one property the plan promises to preserve. **I found none that should change.**

**But the count and the boundary are both off.** Measured: `test/` = **207 across 46 files**, not 205/45. And the plan's exemption says *"all 205 test-fixture occurrences"* — scoped, by that number, to `test/`. It therefore says nothing about **`packages/board/test/` (24) or `packages/domain/test/` (2)**, including the tracked `tiny-garden` fixture plan. Those are in neither list either. An implementer running a repo-wide sweep has no written instruction to leave them alone.

## 4. What `Done when` still fails to pin

1. **A count assertion with a wrong baseline.** `205`/`45` are stated as the values to pin; the true values are `207`/`46`. The gate fails on a clean tree.
2. **No sentence-level rule.** Write-instruction vs accept-description is the boundary that actually separates the 62, and the plan encodes a file list instead. Every mixed file (`plot-reslice/README.md`, and `plot-deliver`/`ralph` inside the change list) is mis-sorted by it.
3. **`intro-to-using-plot.md:89` is named nowhere** — a fenced copy-me example that reproduces the exact defect the template fix exists to remove.
4. **"Stated once, where a reader meets it" still names no file.** Unchanged from R1. And `MANIFESTO.md:35` currently states the conflated version — *"A wave is a `### ` subheading of `## Branches`"* — so "once" is ambiguous between amending the design authority (which the plan exempts) and adding a line somewhere. **The plan exempts the one file where the distinction is currently stated wrongly.**
5. **"Every plan in `docs/plans/` parses byte-identically" cannot fail.** The change touches no plan file and 0 plans carry the old spelling. R1 said this; the amendment kept it. It reads as verification and pins nothing.
6. **"The parser still reads all three spellings" duplicates 46 existing test files.** The plan does not say which is insufficient.
7. **No changeset named**, though `skills/**` is in `plot-reconcile-scan.sh` §22's `no_changeset=` scope.

### The way to satisfy every gate and still be wrong

Replace all 18 SKILL.md occurrences mechanically — including turning `plot-deliver:113` and `ralph:117` into *"any heading containing the word 'Slices'"* — fix the template, touch nothing else. **Every named-file assertion passes. The count assertions pass** (nothing outside `skills/*/SKILL.md` moved). The parser tests pass, the byte-identical diff passes, `pnpm test` passes.

Shipped: two agent instructions that no longer match `## Branches` or `## Waves` on any plan a year older than today; `intro-to-using-plot.md` still teaching `## Branches` in a fence; `tracer-bullets/README.md` still instructing a reader to write it. **The plan's stated purpose — that a reader is taught the accurate word — is unmet in two of the four places a reader is taught it, and every gate is green.**

## 5. Strongest argument AGAINST doing this at all

**The scope is smaller than a plan and the plan's own framing is what inflates it.**

Measured: 285 of 285 plans say `## Slices`; zero say otherwise; `scripts/check-plan-headings.sh` has refused regressions in CI since 2026-09-05. The only unguarded thing that can still produce a wrong plan is **`skills/plot/templates/plan.md:40`**, one line, plus **`intro-to-using-plot.md:89`**, a second. Two lines, one commit, and CI already proves the outcome.

Everything else in the change is prose consistency across 62 occurrences whose correct sorting requires a sentence-by-sentence judgement the plan has twice declined to write down — and where the literal instruction ("replace `## Branches` with `## Slices`") damages at least two files it names. **The plan's risk is now concentrated in the files it lists as targets, not in the ones it exempts.** That is an improvement over R1, and it is still backwards: a change whose value is two lines should not carry a 62-site blast radius held back only by a file list with six gaps in it.

## Did the amendment fix it?

**Partly, and honestly.** It deleted the false 132, named the template, and replaced a gate that would have falsified the parser's own measurements. Those were R1's three worst findings and all three are addressed. The amendment also says plainly that the risk *"does not exist, which makes this change safer than it was argued to be, not more urgent"* — that is the right correction, made in the right direction.

What it did not do is draw the boundary at the sentence. It moved from a grep that was 3.4× too wide to a file list that is six files short and mis-sorts three more, and it left the two broken matchers — R1's highest-value finding — unmentioned in a change list that instructs an unqualified find-and-replace over them.

## What a further amendment must add

1. **Fix the counts**: 207 across 46 (`test/`), plus 24 in `packages/board/test/` and 2 in `packages/domain/test/`; `plot-plan-meta.sh` = 20 on 19 lines; 62 is the total under `skills/` including the 18, and 44 is the figure outside them.
2. **State the boundary as a sentence rule**, not a file list: *a sentence telling a reader what to WRITE changes; a sentence describing what the parser ACCEPTS keeps all three spellings.* Then name the mixed files — `plot-reslice/README.md:17,37,50` change, `:57` does not.
3. **Add `skills/plot/intro-to-using-plot.md:89`** to the change list. It is the second copy-me source and the one the CI gate cannot see.
4. **Name `plot-deliver/SKILL.md:113` and `ralph-plot-sprint/SKILL.md:117` explicitly** as tolerant matchers that must keep naming `Slices`, `Waves` AND `Branches`, with a gate asserting each contains all three. Without this the plan's own slice line breaks them.
5. **Decide `MANIFESTO.md:35`** — it is where the Wave/Slice conflation is currently stated, and exempting it while promising the distinction is "stated once" is a contradiction.
6. **Extend the exemption** to `packages/board/test/` and `packages/domain/test/` by name.
7. **Name `scripts/check-plan-headings.sh`** and say this change aligns prose to an existing gate.
8. Drop the byte-identical-parse clause; justify any new parser test against the 46 existing files.

Verdict: amend
