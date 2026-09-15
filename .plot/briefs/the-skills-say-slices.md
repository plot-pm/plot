## Implementation brief — the-skills-say-slices (slice: The skills say Slices)

- **Plan (canonical):** `docs/plans/2026-09-15-the-skills-say-slices.md` on `main`
- **Story:** `the-domain-knows-what-plot-knows`
- **Sprint:** `a-declared-agent-costs-what-it-costs`
- **Issue:** #914
- **Approved:** 2026-09-15, jwloka, in-session — after **five** rounds
- **Branch:** `docs/the-skills-say-slices` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

The plan's only slice. Nothing waits on it and it waits on nothing.

## The measurement

**Nine skills teach `## Branches` eighteen times; one teaches `## Slices` once.** Re-measured on `origin/main` 2026-09-15, and the per-skill table holds exactly:

```
plot-reslice 7 · plot-implement 3 · plot-deliver 3 · plot-approve 1
plot-pulse 1 · plot-reconcile 1 · plot 1 · ralph-plot-sprint 1   = 18
plot-idea 0 Branches / 1 Slices
```

**`plot-plan-meta.sh` settles which word is right, in its own comment:** *"A Slice holds one branch and belongs to one plan; a Wave is the fleet cohort that spans plans. The section here was always the former, so `## Slices` is the accurate name."*

**The highest-value target is not a skill.** `skills/plot/templates/plan.md:40` — the template every adopting project receives — still says `## Branches`, while this repository's own `.plot/templates/plan.md:60` says `## Slices`. We fixed ours and ship theirs. Verified both, 2026-09-15.

## THIS IS NOT A FIND-AND-REPLACE, AND THE GATE CANNOT SEE THE DIFFERENCE

`sed -i 's/## Branches/## Slices/g'` over `skills/` passes a naive check and breaks the change in four ways. Each is pinned by name in the plan's `Done when` because each is invisible to a count.

**1. Two instructions are TOLERANT and must stay tolerant.** Both say *"any heading containing the word Branches"* — they describe what the parser accepts, and a replacement narrows them to strict:

- `skills/plot-deliver/SKILL.md:113` — *"matches `## Branches`, `## Implementation Branches`, `### Implementation Branches`, or any heading containing the word 'Branches'"*
- `skills/ralph-plot-sprint/SKILL.md:117` — *"matches `## Branches`, `## Implementation Branches`, `### Implementation Branches`"*

**These GAIN `## Slices` alongside what they already match.** They do not lose `Branches`. A skill narrowed to `Slices` alone stops reading the 600+ plans on this estate that say `Branches`, and every test still passes.

**2. One line must keep BOTH words.** `skills/plot-reslice/README.md:57` states what the parser accepts — *"the same `## Branches` / `## Waves` shapes `plot-plan-meta.sh` already parses"*. A file-level rule breaks it. The other three occurrences in that file (`:17`, `:37`, `:50`) are instructions and do change.

**3. The exemption unit is the SENTENCE, not the file.** Round 2 found this. `plot-reslice/README.md` contains both changing instruction lines and one line that must not change. A per-file allow/deny list cannot express that.

**4. A blanket `grep → 0` gate would falsify shipped history.** `plot-plan-meta.sh:778` records *"renaming its `## Branches` to `## Slices` took it from 6 branches to 0"* — a sentence that must keep the word to stay true. The same gate rewrites changelog entries and the fixtures whose whole purpose is proving the parser still reads the legacy word.

## What must not be touched, and how that is proved

**26 occurrences live under `packages/board/test/` and `packages/domain/test/`** — including the `tiny-garden` fixture plan, which this estate has been burned by writes to before. Round 4 found these in **no list at all**.

**Prove it by asserting those paths are untouched by the diff — never by asserting a count.** A count is what went stale twice in this plan's own review, and it went stale a third time between approval and this brief: the plan records `632` repo-wide occurrences; the measurement now is **656**. The gate phrased as a total would already be failing for a reason unrelated to the work. The gate phrased as *paths untouched* is immune.

Also unchanged: script comments, `MANIFESTO.md`, `changelog.md`, the READMEs' non-instruction lines, and every existing plan in `docs/plans/`.

## The full target list, each verified 2026-09-15

| File | What changes |
|---|---|
| 8 × `skills/*/SKILL.md` | the 18 instructional occurrences, minus the two tolerant lines below |
| `skills/plot-deliver/SKILL.md:113` | **add** `## Slices` to the tolerated set; keep `Branches` |
| `skills/ralph-plot-sprint/SKILL.md:117` | **add** `## Slices` to the tolerated set; keep `Branches` |
| `skills/plot/templates/plan.md:40` | `## Branches` → `## Slices` — the shipped template |
| `skills/plot/intro-to-using-plot.md:88` | the second copy-me example |
| `skills/tracer-bullets/README.md:28` | *"Add `### Tracer` subsection to plan's `## Branches`"* |
| `skills/plot-pulse/README.md:56` | *"A wave is a `### ` subheading under `## Branches`"* |
| `skills/plot-reslice/README.md` | `:17`, `:37`, `:50` change · **`:57` keeps both words** |

Plus: **state the Slice/Wave distinction once**, where a reader meets it. Once — not in all nine.

## The parser is not touched

**All three spellings keep parsing, and this changes nothing about that.** `plot-plan-meta.sh:787` is one branch — `$0 ~ /^## Branches/ || $0 ~ /^## Waves/ || $0 ~ /^## Slices/` — and the comment two lines above says *"THE HEADING WORD NO LONGER PICKS THE LAYOUT."* This slice changes what the skills **teach**, never what the parser **accepts**.

**One correction to carry forward.** The plan says *"An earlier draft claimed 132 delivered plans carry `## Waves` … Measured on main: ZERO do."* **Six plans carry `## Waves` — all six are Released**, so a search for *delivered* returned zero and the sentence generalised it. The conclusion survives untouched: all six are terminal, the parser reads them correctly, and nothing here strands them. Do not re-derive this and conclude the plan is wrong about the risk — it is right about the risk and imprecise in one sentence.

## Testing

Two gates prove opposite things and both are required.

**The named-file test** — pin each target file explicitly, never a repository-wide grep. The precedent to copy is `test/reconcile/unattended.test.mjs`: a contract test over skill prose whose header comment explains *why prose needs a structural gate*. It guards the same class of failure — drift that is silent and still goes green. New tests belong in `test/reconcile/`, run by `pnpm run test:contracts`.

**The no-regression proof** — parse one plan of each of the three shapes and assert identical output, and diff `plot-plan-meta.sh`'s full output over every plan in `docs/plans/` before and after. Byte-identical.

Repo gates: `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck`. Run `nvm use` first — **pnpm crashes on Node 26**.

**Do not run `pnpm run test:e2e`.** CI is its gate; a local run dispatches real workers into sandbox repos and takes the machine down with it.

## Done when

- the eight `SKILL.md` files, the shipped template, `intro-to-using-plot.md:88` and the three README instruction lines teach `## Slices`
- `plot-deliver:113` and `ralph-plot-sprint:117` are **tolerant** — they match `Slices` *and* `Branches`
- `plot-reslice/README.md:57` keeps **both** words
- `packages/board/test/` and `packages/domain/test/` are untouched by the diff, asserted as paths
- the parser reads all three spellings, asserted by parsing one plan of each shape
- every plan in `docs/plans/` parses byte-identically to today
- the Slice/Wave distinction is stated **once**
- the gates above pass

## Do not

- **Do not run a blanket find-and-replace.** It narrows two tolerant instructions to strict, breaks one line that must keep both words, and passes every naive gate while doing it.
- **Do not write a `grep → 0` gate.** It falsifies `plot-plan-meta.sh:778`'s own recorded measurement and rewrites shipped changelog entries.
- **Do not assert a total count.** `632` became `656` between approval and dispatch. Assert paths untouched.
- **Do not touch the fixtures.** The 26 occurrences under `packages/*/test/` exist to prove the parser still reads the legacy word.
- **Do not rewrite existing plans.** 600+ say `Branches`, six say `Waves`, and the parser reads all of them. That migration has its own blast radius.
- **Do not touch the code's `Wave`-for-`Slice` naming.** `CLAUDE.md` names it a known defect with its own plan.
- **Do not state the Slice/Wave distinction nine times.** Once, where a reader meets it.

## Bookkeeping

Open the PR through the controller — **never `gh pr create`**, which takes its title from the last commit subject:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while work is moving
```

Then append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

This is a `docs` plan touching `skills/` — **it needs a changeset** (`'plot': patch`, with the `bumps:` block **last**, after a description of 20+ characters).

## Scope guard

**This branch owns** `skills/*/SKILL.md`, `skills/plot/templates/plan.md`, `skills/plot/intro-to-using-plot.md`, the three READMEs named above, and a new test under `test/reconcile/`.

**In flight, verified at dispatch:** `bug/setup-proves-the-jenkins-job-answers` touches `skills/plot/scripts/plot-board-probe.sh` and three docs files; `infra/the-supervisor-log-has-a-ceiling` is empty against main. **No collision on any file this branch owns.**

If you find something the plan did not anticipate, report it rather than improvising outside scope.
