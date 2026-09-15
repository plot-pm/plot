# Premise lens — the-skills-say-slices (#914)

Read on `origin/main` @ `af09f8dcb`. Every count below is re-derived with `git grep` against `origin/main`, not against the working tree.

## 1. Are the factual claims true?

### The per-skill table is TRUE — for `SKILL.md` files only

`git grep -c '## Branches' origin/main -- 'skills/*/SKILL.md'` reproduces the plan's table exactly:

| Skill | plan says | I measured |
|---|---:|---:|
| `plot-reslice` | 7 | 7 |
| `plot-implement` | 3 | 3 |
| `plot-deliver` | 3 | 3 |
| `plot-approve` | 1 | 1 |
| `plot-pulse` | 1 | 1 |
| `plot-reconcile` | 1 | 1 |
| `plot` | 1 | 1 |
| `ralph-plot-sprint` | 1 | 1 |
| `plot-idea` (`## Slices`) | 0 / 1 | 0 / 1 |

Total 18 across 8 skills, plus `plot-idea`'s 1 — the headline "eighteen times … one teaches `## Slices` once" is exact. `plot-idea`'s single use is `skills/plot-idea/SKILL.md:270`.

### The quoted parser comment is VERBATIM and correctly attributed

`skills/plot/scripts/plot-plan-meta.sh:59-64` reads word-for-word as quoted, including "`## Slices` is the accurate name". **Sound.**

### The "132 delivered plans carry `## Waves`" claim is FALSE ON MAIN

This is the plan's load-bearing safety premise, and it does not hold:

```
git grep -l '^## Waves'    origin/main -- 'docs/plans/*.md'  →   0
git grep -l '^## Branches' origin/main -- 'docs/plans/*.md'  →   0
git grep -l '^## Slices'   origin/main -- 'docs/plans/*.md'  → 285
```

**Zero plan files carry `## Waves`. Zero carry `## Branches`. The plan-file estate has already migrated to `## Slices`.** Walking back: `origin/main~600` (2026-09-07) already reads Waves=0, Branches=0, Slices=219. The migration is at least a week old.

The plan did not measure this — it inherited "132" from the `plot-plan-meta.sh` comment, which was true when that comment was written and is stale now. Three separate passages rest on it: the Design section, "The parser is not touched" (*"132 delivered plans carry `## Waves` and they must keep working"*), "What this does not do" (*"It does not rewrite existing plans. 132 carry `## Waves`"*), and the `Done when` gate (*"a docs change that broke `## Waves` would strand 132 delivered plans"*). All four describe a risk that does not exist.

This is the same error class as `the-tight-band-remembers-what-it-started`: a number lifted from a source that was accurate at its own writing, restated as a present-tense measurement.

### The scope claim and the `Done when` gate DISAGREE

The narrative says "nine skills … eighteen times". The gate says `grep -c '## Branches'` across `skills/` returns **0**. Those are different populations:

```
git grep -o '## Branches' origin/main -- skills/            →  62
git grep -o '## Branches' origin/main -- 'skills/*/SKILL.md' →  18
```

Of the 62: **33 are inside `.sh`/`.mjs`** — `plot-plan-meta.sh` alone holds 19, and they are the parser's own explanatory comments about the legacy shape, several of which *must* keep the word to stay true (`plot-plan-meta.sh:778`: *"renaming its `## Branches` to `## Slices` took it from 6 branches to 0"*). 29 are in `.md`, including `MANIFESTO.md`, `changelog.md`, `intro-to-using-plot.md`, `tracer-bullets/README.md`, and `plot-reslice/README.md` (4). An implementation obeying the gate literally rewrites historical changelog entries and falsifies the parser's own measurements.

### Unverified / unstated by the plan

- **`skills/plot/templates/plan.md:40` still says `## Branches`** — and this is the template an adopting project receives. The repo's own `.plot/templates/plan.md:60` says `## Slices`. So the plan's claim that *"`plot-idea` is the one skill that writes a plan from scratch, and it is already correct"* is only half true: the skill prose is correct, the artefact it ships writes the legacy word. The table omits the template entirely. This is the single highest-value target in the change and the plan does not name it.
- No TS reader is affected: `git grep '## Branches' origin/main -- 'packages/*/src'` → 0 hits.

## 2. Does the parser read all three spellings?

**Yes — proven by running it, on both layouts.**

`plot-plan-meta.sh:787` is one arm: `else if ($0 ~ /^## Branches/ || $0 ~ /^## Waves/ || $0 ~ /^## Slices/)`. Line 768-770 states the mechanism — the heading word no longer selects the layout; the first `### ` heading does.

**New (heading-carried) shape** — took `docs/plans/2026-02-11-plot-sprint-support.md`, made three copies differing only in the heading word, parsed each: output identical except the `file` field (the copies' own paths). `branches` = `["feature/plot-sprint-support"]` in all three.

**Old (list-item) shape** — hand-built a plan carrying `- \`feature/alpha\` … → #101`, same three spellings:

```
old-slices     {"branches":["feature/alpha","feature/beta"],"prs":[101,102],…}
old-waves      {"branches":["feature/alpha","feature/beta"],"prs":[101,102],…}
old-branches   {"branches":["feature/alpha","feature/beta"],"prs":[101,102],…}
```

Byte-identical. The parser claim is **sound**, and it is the strongest verified part of the plan. Note the corollary: since no plan file on main says `## Waves` or `## Branches`, the `Done when` clause pinning "every delivered plan parses byte-identically" is testing a property nothing on the estate currently exercises.

## 3. Rename with no consequence, or worth doing?

**The plan's stated argument fails; a different, real argument survives.**

The plan claims *"a reader taught `Branches` has no way to learn the difference"* between a Slice and a Wave. Reading all 18 uses, this is not what the skills say. `plot-pulse/SKILL.md:99` defines: *"**wave** | Branches under one `### ` subheading of `## Branches`, runnable concurrently"*. `plot-implement/SKILL.md:124` says *"grouped into waves (`### ` subheadings under `## Branches`)"*. These teach a **containment** relation — waves are subheadings inside the section. That is the board/parser sense of "wave", and swapping the section word to `## Slices` leaves those sentences teaching exactly the same containment, now as "waves are subheadings under `## Slices`". **The rename does not by itself convey `DESIGN-slice.md`'s distinction** (a Wave spans plans, a Slice belongs to one). The plan's own `Done when` concedes this by requiring the distinction be "stated **once**, where a reader meets it" — that sentence, not the rename, does the teaching.

What is genuinely worth doing, and the plan gets there by a wrong road:

- **`skills/plot/templates/plan.md:40`** ships `## Branches` to every adopting project, so every plan created outside this repo is born with the legacy word. Real, mechanical, unarguable.
- **`plot-deliver/SKILL.md:113` and `ralph-plot-sprint/SKILL.md:117` are defects, not wording.** Both instruct the agent to find the section by *"any heading containing the word 'Branches'"*. Against this repo's 285 plans — every one of which says `## Slices` — **those instructions match nothing today.** That is a live bug the plan would incidentally fix while describing itself as a rename. It is worth more than everything else in the change and appears nowhere in the plan.

## 4. What the `Done when` fails to pin

**An implementation can satisfy every gate and still be wrong.** Concretely:

1. **`grep -c '## Branches'` across `skills/` returning 0 forces damage.** The honest scope is 18 prose uses; the gate names 62. To reach 0, an implementer must edit `plot-plan-meta.sh`'s 19 comment occurrences — including `:778`, a dated measurement that is only true *because* it says `## Branches`. Rewriting it to `## Slices` makes the sentence self-contradictory ("renaming its `## Slices` to `## Slices` took it from 6 branches to 0"). The gate passes; the repo now lies about its own history. `MANIFESTO.md` and `changelog.md` are the same hazard.
2. **The two broken matchers can be "fixed" into still being broken.** A literal find-and-replace turns *"any heading containing the word 'Branches'"* into *"any heading containing the word 'Slices'"* — which passes the grep gate and silently drops support for the `## Branches`/`## Waves` spellings the plan swears elsewhere it preserves. The gate on the *parser* proves nothing about these, because they are agent prose, not parser code. **Nothing in `Done when` tests skill instructions at all.**
3. **The template can be missed.** `skills/plot/templates/plan.md` is not a `SKILL.md`; nothing in the narrative points at it. An implementer working the table gets 9 skills and ships the adopting-project defect untouched. (The `skills/` grep would catch it — but only if the implementer reads the gate rather than the table, and the two disagree.)
4. **"Stated once, where a reader meets it" pins no location and no assertion.** There is no test for it, no named file. It is satisfiable by one sentence anywhere.
5. **The parser gates test the wrong risk.** "Every delivered plan parses byte-identically" and "parse one plan of each shape" both guard the parser, which the plan explicitly does not touch. Zero plan files use the legacy spellings. The gates are cheap and will pass; they protect nothing at risk and give false assurance that the change was verified.

## 5. Strongest argument against doing this at all

**The premise that motivates it is stale, and the thing actually worth fixing is described nowhere in the plan.**

The plan frames itself as the prose half of a live migration — *"the estate is mid-migration in code already … the skills are the same defect in prose"*. But the plan-file estate is **not** mid-migration: it finished, at least a week ago, 285 files to 0. The word the skills teach has already stopped producing wrong plans here, because `.plot/templates/plan.md` writes `## Slices` and the parser is shape-driven. So the harm the plan describes — *"every plan written from a skill carried the legacy word"* (Changelog) — is not occurring on this estate.

What that leaves is a prose-consistency change whose own gate is mis-scoped by 3.4× into territory where compliance destroys true statements, and whose narrative argument (a reader cannot learn Slice-vs-Wave) does not survive reading the sentences it indicts.

The counter — and it is why this is `amend` rather than `reject` — is that two skills currently carry instructions that match nothing on this estate, and the shipped template still ships the legacy word to adopters. Those are real defects with real consequences. They deserve a plan that names them as the subject, with a gate that tests *agent instructions and the template*, not one that counts a string across 62 sites including the parser's own history.

## What I recommend the amendment change

1. **Drop every "132 delivered plans carry `## Waves`" sentence.** Replace with the measured fact: 0 plan files carry `## Waves` or `## Branches`; 285 carry `## Slices`. Re-derive the safety argument from that, or admit the parser risk is nil.
2. **Re-scope the gate** from `grep -c '## Branches' skills/ == 0` to the prose population the plan actually measured — the 18 `SKILL.md` uses plus `skills/plot/templates/plan.md` — and **explicitly exempt** `plot-plan-meta.sh`, `MANIFESTO.md`, `changelog.md`, and other historical text, naming why (they describe the legacy shape truthfully).
3. **Promote the two broken matchers to the plan's subject.** `plot-deliver/SKILL.md:113` and `ralph-plot-sprint/SKILL.md:117` must match all three spellings, not one; add a gate asserting each names `Slices`, `Waves` and `Branches`.
4. **Name `skills/plot/templates/plan.md:40`** in the table and in `Done when`.
5. **Replace the parser gates** with one that tests what changes: that the skills' section-finding instructions still cover every spelling the parser accepts.

Verdict: amend
