# Blast-radius lens — the-skills-say-slices (#914)

Lens: skills are prose an agent FOLLOWS. Changing what they teach changes what future plans contain, and changing a word that OTHER components match on changes what those components read.

## 1. Factual claims, re-derived on `origin/main` (af09f8dcb)

### The per-skill table is exactly right — for `SKILL.md` files only

Re-derived with `grep -c '## Branches' skills/<s>/SKILL.md`. All nine rows match, and the total is 18:

| Skill | plan claims | measured | |
|---|---:|---:|---|
| `plot-reslice` | 7 | 7 | OK |
| `plot-implement` | 3 | 3 | OK |
| `plot-deliver` | 3 | 3 | OK |
| `plot-approve` | 1 | 1 | OK |
| `plot-pulse` | 1 | 1 | OK |
| `plot-reconcile` | 1 | 1 | OK |
| `plot` | 1 | 1 | OK |
| `ralph-plot-sprint` | 1 | 1 | OK |
| `plot-idea` | 0 | 0 | OK |

**But the plan's own `Done when` gate does not scope to `SKILL.md`.** It says *"`grep -c '## Branches'` across `skills/` returns 0"*. Measured: `grep -rho '## Branches' skills/ | wc -l` = **62**, not 18. See §5 — this gap is the finding.

### FALSE: "132 delivered plans carry `## Waves`"

**Zero do.** Measured over all 289 files in `docs/plans/`:

- `^## Branches`: **0** plans
- `^## Waves`: **0** plans
- `^## Slices`: **285** plans (4 files carry no slice heading — decision logs, per `plot-sprint-candidates.sh`'s own rule)

Restricted to delivered/released plans: **268 such plans, 0 carrying `## Waves`.**

`eaac4a3d3` ("plot: the plan estate says Slices, and the shape decides the grammar", 2026-09-04) migrated 186 files. The estate said Slices **eleven days before this plan was drafted.**

**Where the false number came from is itself the interesting part.** The plan quotes `plot-plan-meta.sh` accurately — the comment at `skills/plot/scripts/plot-plan-meta.sh:62-63` really does read *"`## Waves` is the one 132 delivered plans already carry"*. The plan's error is not misquoting; it is **treating a code comment as a live measurement.** That comment was written before `eaac4a3d3` and was never updated by it. The plan's own Notes say *"Filed as #914 with the counts, verified here before drafting"* — the skill counts were verified; the 132 was not, and it is the load-bearing number in the "The parser is not touched" section and in the second `Done when` clause.

### The `plot-plan-meta.sh` comment: quoted faithfully, but it is not an authority

`plot-plan-meta.sh:58-64` says exactly what the plan quotes, including *"`## Slices` is the accurate name"*. So the plan's **design argument survives** — the parser's author did settle the vocabulary question this way, and `DESIGN-slice.md` backs it.

What does not survive is the framing that this is an open question needing a plan to settle. See §4.

### Unverified / unverifiable as stated

- *"more [plans] carry `## Branches`"* (What this does not do) — **false**, 0 do.
- *"every plan written from a skill carried the legacy word"* (Changelog) — **false as a present claim.** Every plan on the estate says `## Slices`. If it means *historically*, it is unfalsifiable as written and irrelevant to the fix.
- *"the legacy word everywhere a reader learns what to look for"* — true of the nine SKILL.md files, but the same word is in 31 script comments and 205 test fixtures that the plan never mentions.

## 2. Does the parser read all three spellings? Proven — and the plan understates why

**Yes, and identically, for BOTH layouts.** I ran `plot-plan-meta.sh` over six synthetic plans: one per spelling x one per layout, differing only in the heading word.

- Heading-carried layout (`### One (Branch: feature/a, PR: #1)`): `Branches` == `Waves` == `Slices`, byte-identical JSON after dropping the `file` key.
- List-item layout (`- \`feature/a\` — do a → #1`): `Branches` == `Waves` == `Slices`, byte-identical.

Both cases yield `"branches":["feature/a","feature/b"], "prs":[1]` and the same two-element `waves` array.

The mechanism is `plot-plan-meta.sh:787`: one rule, `$0 ~ /^## Branches/ || $0 ~ /^## Waves/ || $0 ~ /^## Slices/`, opening ONE section. The comment above it (`:768-783`) records why — the heading word used to select the GRAMMAR, and renaming `2026-08-14-parallel-agent-fleet.md`'s section took it **from 6 branches to 0 with no error**. Shape now decides the layout; the word is a name.

**The plan's "132 delivered plans must keep working" risk therefore does not exist in two independent ways**: the parser is spelling-blind by construction, AND no plan carries the old word.

## 3. Consumers beyond `plot-plan-meta.sh` — the blast radius proper

**The premise that only the parser reads this heading is false.** I found consumers in four separate tiers.

### Tier A — a SECOND parser, with a different rule

`skills/plot/scripts/plot-impl-status.sh:80`:

```
BRANCHES_SECTION=$(echo "$PLAN_CONTENT" | sed -nE '/^## Branches/,/^## /p')
```
`:88`:
```
WAVES_SECTION=$(echo "$PLAN_CONTENT" | sed -nE '/^## (Waves|Slices)/,/^## [A-Z]/p')
```

**Two sed ranges, deliberately not merged** — `:70-79` records the measurement: accepting every spelling in one range drops a branch, because a sed range terminates at the second heading and does not reopen. This is a declared duplicate of the parser's rule, in the `a-shell-script-asks-the-domain` sense, and it reads all three spellings — so a skill rename does not break it. **But it means "the parser" is singular only in the plan's prose.** It is also the script whose silent failure once refused delivery of four fully-merged plans (`:66-69`).

### Tier B — 31 occurrences in shell script comments and logic

`grep -rho '## Branches' skills/plot/scripts/*.sh` = **31**, across:

- `plot-plan-meta.sh` (24) — the format contract's own documentation, including the worked examples at `:50-56` that a reader learns the grammar from
- `plot-reconcile-scan.sh:2037` — `if ($0 ~ /^## Branches/ || $0 ~ /^## Waves/ || $0 ~ /^## Slices/)`, a **third** live matcher
- `plot-impl-status.sh` (6), `plot-deliver.sh:141-149`, `plot-approve.sh:74`, `plot-fleet-scan.sh:2693,3396`, `plot-release-refs.sh:199`

`plot-deliver.sh:147-149` is load-bearing history: a `## Waves` heading opening design prose above the real `## Branches` section caused it to read three branch names out of the wrong place.

### Tier C — the board, in shipped artifacts and in source

- `packages/board/src/server/reslice.ts:243-245` composes the prompt handed to a spawned `/plot-reslice` agent: *"whichever of `## Slices`, `## Waves` or `## Branches` the file itself uses; the three are one section"*. This text is **compiled into `skills/plot/scripts/board/board-server.mjs`** — I confirmed the string is present in the built artifact. So a skill-prose rename leaves a second, artifact-embedded instruction that still names all three, and any edit here requires `pnpm build:board`.
- `skills/plot/scripts/board/plot-registryd.mjs` carries the user-facing refusal *"No plan names `<branch>` in its `## Branches` section"* — **an operator-visible message using the legacy word**, in a shipped bundle, which the plan does not touch and its gate would not catch (the plan says `skills/` returns 0; this file is under `skills/`, so the gate WOULD fire on it — see §5).
- `packages/board/src/contract/schema.ts:73`, `src/server/fleet.ts:6238`, `src/app/components/AgentList.tsx:883`, `ResliceButton.tsx:13,25,130`, `row-identity.ts:54`, `controllers/deliverability.ts:43`, `App.tsx:479`, `src/server/index.ts:222` — all documentation comments naming `## Branches`.
- `packages/domain/src/rules/gates.ts` — 1 occurrence.

### Tier D — 205 test-fixture occurrences across 45 contract-test files

`grep -rho '## Branches' test/ | wc -l` = **205**, in **45** files under `test/reconcile/`. These are *fixtures*: literal plan text fed to the parser to assert the old spelling still parses. e.g. `test/reconcile/parser.test.mjs:114` — *"plan-meta: only the first `## Branches` heading contributes branches"*; `test/reconcile/deliver-headings.test.mjs:73-81` documents that a `### (Branch: …)` under `## Branches` parses to an EMPTY list.

Plus `packages/board/test/` (~20 more) and `packages/board/test/fixtures/tiny-garden/docs/plans/2026-03-01-plant-tomatoes.md` — a **tracked fixture plan** that must keep the old spelling to prove backward compatibility.

**These are the compatibility guarantee.** Rewriting any of them to `## Slices` would delete the evidence that the parser still reads the old word — which is the one property the plan says must be preserved.

### Answering the lens question directly

**Would a plan written with `## Slices` be handled identically by every consumer?** Yes — I verified three independent matchers (`plot-plan-meta.sh:787`, `plot-reconcile-scan.sh:2037`, `plot-impl-status.sh:80/88`) each accept all three, and the board's reslice prompt names all three. **The compatibility is genuinely estate-wide, not parser-only.** That is a finding in the plan's favour on safety, and against it on necessity.

## 4. The `## Branches` occurrences the plan would change — example vs prose vs doctrine vs history

The lens asks where `## Branches` sits in an EXAMPLE a reader copies versus in PROSE describing the parser. I classified all 18 SKILL.md hits plus the surrounding tree.

### Would genuinely change what a future plan contains (the plan's real target)

- **`skills/plot/templates/plan.md:40` — `## Branches` is a literal section heading in the template.** This is **the single highest-value line in the whole change, and the plan does not mention it.** `skills/plot-idea/SKILL.md:251-255` resolves `Plan template` (default `skills/plot/templates/plan.md`) and writes the new plan file **from it**. So `/plot-idea` — the one skill the plan calls "already correct" — writes `## Branches` into every new plan. Its single `## Slices` at `:270` is prose about a `builds:` annotation, not the section it emits. **The plan's central claim that `plot-idea` needs no change is false**, and it is false in the one place that actually determines what new plans contain.
- `skills/plot/SKILL.md:282` — describes a `### Tracer` subsection "in `## Branches` (see plan template)"; a reader copies the format block below it.
- `skills/tracer-bullets/README.md:28` — *"Add `### Tracer` subsection to plan's `## Branches`"*, a direct instruction. **Not in the plan's table** (the plan names nine skills; tracer-bullets is a tenth).

### Prose describing what the parser READS — changing these makes the docs LESS accurate

- `skills/plot-deliver/SKILL.md:113` — *"find the section headed with 'Branches' (matches `## Branches`, `## Implementation Branches`, ... or any heading containing the word 'Branches')"*. This documents a **tolerant match**. Rewriting it to say `## Slices` describes behaviour that does not exist and omits behaviour that does.
- `skills/ralph-plot-sprint/SKILL.md:117` — same shape, same problem.
- `skills/plot-reconcile/SKILL.md:86`, `plot-implement/SKILL.md:109,124,283`, `plot-pulse/SKILL.md:99`, `plot-approve/SKILL.md:138` — all describe reading an existing plan.
- `skills/plot-reslice/README.md:57` — *"the same `## Branches` / `## Waves` shapes `plot-plan-meta.sh` already parses"*. Naming both spellings **is the accurate statement**; replacing it with `## Slices` alone makes it wrong.

**Seven of the eighteen SKILL.md hits are reader-facing prose about what the parser accepts.** The plan's blanket "replace `## Branches` with `## Slices`" applied to these converts accurate documentation of a tolerant parser into an inaccurate claim of a strict one. That is the wrong-ones risk the lens asks about, and it is concentrated exactly where the plan's own text says the skills *"read or amend"* rather than write.

### Doctrine and history — must NOT change

- **`skills/plot/MANIFESTO.md:35`** — *"A wave is a `### ` subheading of `## Branches`"*. CLAUDE.md names MANIFESTO.md the **design authority**. Editing it is not a docs tidy; it is a design change, and the plan does not scope it. Worse, this sentence is *also* the `Wave`-vs-`Slice` conflation the plan says it is fixing — so the one file where the distinction most needs stating is the one the plan's framing ("stated once, where a reader meets it") leaves unaddressed.
- **`skills/plot/changelog.md:58`** — a dated historical entry. CLAUDE.md: *"State current behaviour. What you tried, earlier drafts, and review history belong in a log"*. `check-plan-headings.sh:15-18` applies the identical principle to plans: *"HISTORY IS NOT DRIFT ... rewriting it to match today's vocabulary destroys the record this repo keeps deliberately."* A changelog is that record.
- `skills/plot/intro-to-using-plot.md:89` — a worked example of a plan file; ambiguous (teaching material that a reader copies, arguing for change; a historical walkthrough, arguing against).

### The decisive point on necessity

**A CI gate for this already exists and already passes.** `.github/workflows/ci.yml:501-508` runs `scripts/check-plan-headings.sh`, whose header reads: *"THE GATE THAT KEEPS THE WORD. A plan's branch section is `## Slices`."* It parses every unfinished plan's phase and refuses any that says `## Branches` or `## Waves`, exempting delivered/released as history.

It was added for **the exact failure this plan describes**: `check-plan-headings.sh:9-13` records *"Measured 2026-09-05: three plans authored that day — every plan written under the story that exists to fix this vocabulary — carried `## Branches` ... Prose said Slices; the files said Branches."*

So the ONLY outcome the plan can actually produce — new plans saying `## Slices` — is already **gated**, not merely ruled. And the gate is stricter than skill prose can ever be, because it fails the build. The plan is proposing a rule where a gate already stands, which inverts CLAUDE.md's *Gates Over Rules*.

**What the gate does not cover, and where the residual value is:** the template at `plot/templates/plan.md:40`. Today a plan written from the template says `## Branches` and CI **refuses it** — a reader must hand-fix the heading the template gave them. That is a real, live papercut, it is one line, and the plan never names it.

## 5. What `Done when` fails to pin

1. **`grep -c '## Branches'` across `skills/` returning 0 is the wrong gate, and it would force exactly the wrong edits.** 62 occurrences live under `skills/`: 18 in SKILL.md, 7 in READMEs, **31 in shell-script comments**, **2 in board `.mjs` artifacts**, 1 template, 1 changelog, 1 MANIFESTO, 1 intro. Driving it to 0 requires editing `plot-plan-meta.sh`'s own format documentation — including the worked example at `:50-52` that teaches the old layout, and the comment at `:760-783` recording the measured 6-branches-to-0 failure. **The gate as written mandates deleting the evidence for why the parser is shaped the way it is.** It also requires editing two built bundles, which means a `pnpm build:board` and an artifact diff inside a "docs only" change.
2. **No scope statement separating an EXAMPLE from a DESCRIPTION.** §4 shows 7 of 18 SKILL.md hits are accurate prose about a tolerant parser. The plan has no rule telling an implementer to leave those alone, and its Slices line says "replace ... across the nine skills that teach it" without qualification.
3. **Nothing exempts history and doctrine.** `check-plan-headings.sh` already carries the exemption principle for plans; the plan borrows none of it for `changelog.md` or `MANIFESTO.md`. MANIFESTO.md is additionally the declared design authority and needs its own decision, not a grep.
4. **The template is not named.** `skills/plot/templates/plan.md:40` is the one line that changes what future plans contain — the plan's stated goal — and it appears in no slice, no table, and no `Done when` clause. A reviewer following the plan literally would edit nine skills and miss the only file that matters.
5. **"Every delivered plan parses byte-identically" is a no-op check.** The plan changes no plan file, and 0 plans carry the old spelling. This clause cannot fail. It reads as a safety gate and pins nothing.
6. **"The parser still reads all three spellings" is already pinned** by 45 contract-test files with 205 fixture occurrences. The plan proposes to add a test for a property the estate tests extensively already, without saying which existing test is insufficient.
7. **"Stated once, where a reader meets it" does not name the file.** Given MANIFESTO.md:35 currently states the conflated version, "once" is ambiguous between amending doctrine and adding a line to a SKILL.md.
8. **No mention of the second and third matchers.** `plot-impl-status.sh`'s twin sed ranges and `plot-reconcile-scan.sh:2037` are unmentioned; an implementer told "the parser is not touched" has no reason to know two other scripts match the same headings.
9. **No changeset named**, though `skills/**` changes are in the `no_changeset=` scope of `plot-reconcile-scan.sh` §22.

## 6. Strongest argument AGAINST doing this at all

**The outcome is already achieved and already gated; what remains is one line the plan does not name.**

The plan's goal is that future plans say `## Slices`. Measured today: **285 of 285 plans with a slice section say `## Slices`. Zero say `## Branches` or `## Waves`.** The migration landed 2026-09-04 (`eaac4a3d3`, 186 files), and `scripts/check-plan-headings.sh` has refused any regression in CI since 2026-09-05.

So the plan's stated benefit is unobtainable — there is no non-compliant plan for it to prevent — while its stated method carries live costs:

- a `Done when` gate that, taken literally, deletes the parser's own format documentation and the recorded measurement behind its design
- seven SKILL.md edits that turn accurate descriptions of a tolerant parser into inaccurate claims of a strict one
- edits to the design authority (MANIFESTO.md) and the historical record (changelog.md) with no decision made about either
- a rewrite to two shipped `.mjs` bundles inside a change declared "Board impact: none"

And the plan's central factual premise is inverted: it argues the skills are *"the same defect in prose"* as the code's `Wave`-for-`Slice` naming. But the code defect is live — `plot-plan-meta.sh` still emits a `"waves"` JSON key, and `packages/board` types still say `Wave`. **The skills' `## Branches` is not a live defect; it is documentation of a spelling the parser deliberately keeps reading forever.** Those are opposite situations, and the plan treats them as one.

**The honest residual is one line**: `skills/plot/templates/plan.md:40`. The template emits `## Branches`, so `/plot-idea` writes a heading CI then refuses. That is a real defect with a real user hitting it, and it is worth a commit. It is not worth a plan across nine skills with a grep-to-zero gate.

## 7. Recommendation — amend

Amend to what is true and what is needed:

1. **Correct the premise.** Replace "132 delivered plans carry `## Waves`" with the measurement: 0 plans carry `## Waves` or `## Branches`; 285 carry `## Slices`; the estate migrated in `eaac4a3d3` on 2026-09-04. Note that the 132 came from a stale comment at `plot-plan-meta.sh:62` — **and fix that comment**, since it is the source that misled this plan and will mislead the next reader.
2. **Add the template.** `skills/plot/templates/plan.md:40` `## Branches` → `## Slices`. This is the only change that alters what future plans contain, and it removes a live conflict with the CI gate. Drop the claim that `plot-idea` needs no change.
3. **Replace the grep-to-zero gate** with an explicit scope: SKILL.md and README **instructions that tell a reader what to WRITE**. Exempt by name — script comments, `.mjs` bundles, test fixtures, `changelog.md`, `MANIFESTO.md`, and every sentence describing what the parser ACCEPTS (those must keep naming all three spellings, because that is what is true).
4. **Acknowledge the existing gate.** `scripts/check-plan-headings.sh` already enforces the outcome; say so, and say the plan is aligning prose to a gate rather than establishing a rule.
5. **Decide MANIFESTO.md:35 separately.** It states the Wave/Slice conflation the plan says it is fixing, and it is the declared design authority. It deserves its own argued change, not a sed.
6. Drop the byte-identical-parse clause (no plan file changes) and justify any new parser test against the 45 existing contract-test files.

The direction is right and the change is safe for consumers — three independent matchers accept all three spellings, verified. What needs amending is the premise, the scope, and the one file the plan omits.

Verdict: amend
