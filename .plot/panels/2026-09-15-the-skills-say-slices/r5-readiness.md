# Readiness lens, round 5 — the-skills-say-slices (#914)

Read on `origin/main` @ `80fc1d3dc` (main has moved again since R4 read `0f20d2ce9`). Every count re-derived from the tree rather than from R4. One question: **would I hand this to an agent tomorrow?**

**Answer: yes.** R4's blocker is closed by the edit R4 specified, and I could execute the `Done when` end to end without a judgement the plan did not make.

## 1. R4's blocker, re-tested

R4 blocked on one clause: the `Done when` asserted a literal `205` while the Design section at `:107` argued that asserting a literal total is the wrong gate.

```
grep -n '205' docs/plans/2026-09-15-the-skills-say-slices.md  →  no match
```

**Zero references remain.** The clause at `:142-147` now reads *"pinned by asserting those paths are untouched by the diff rather than by asserting a count"*, which is the shape R4 named — a per-file diff assertion. Prose and gate now say the same thing: `:107-109` says count what you exclude, and the gate excludes by path.

## 2. Every remaining number in the gate, re-derived

The `Done when` block contains nine numerals. Eight are line numbers; one is a count.

| In the plan | What it claims | I measured @ `80fc1d3dc` | Verdict |
|---|---|---|---|
| `26` (`:144`) | occurrences under `packages/board/test/` + `packages/domain/test/` | **26**, across 16 files | **correct** |
| `templates/plan.md:40` | `## Branches` | `## Branches` | ✓ |
| `intro-to-using-plot.md:88` | the copy-me example | ` ```markdown ` fence, heading at `:89` | ✓ (as R4 read it) |
| `tracer-bullets/README.md:28` | write-instruction | *"Add `### Tracer` subsection to plan's `## Branches`"* | ✓ |
| `plot-pulse/README.md:56` | instruction line | *"A wave is a `### ` subheading under `## Branches`"* | ✓ |
| `plot-reslice/README.md:57` | keeps BOTH words | *"same `## Branches` / `## Waves` shapes … already parses"* | ✓ |
| `plot-deliver/SKILL.md:113` | tolerant matcher | *"any heading containing the word Branches"* | ✓ tolerant |
| `ralph-plot-sprint/SKILL.md:117` | tolerant matcher | *"a heading containing Branches"* | ✓ tolerant |
| `plot-plan-meta.sh:778` | the sentence that must keep the word | *"`## Branches` to `## Slices` took it from **6 branches to 0**"* | ✓ |

**The one surviving count is exact and it is the one the gate uses.** The illustrative `632` at `:89` has drifted again (I measure **647** occurrences now, against R4's 642 and R3's 570) — but it sits in a fenced block beside the command that produces it, labelled as a reading, and **nothing in the gate depends on it**. The two numbers that do gate — `18` in `skills/*/SKILL.md` and `61` under `skills/` — I re-measured at **18** and **61**, unchanged across every round. The plan's own text at `:107-109` already says the repo-wide total goes stale. It does; it misleads nobody who runs the printed command.

## 3. Is the file list complete? Checked over the whole repo, not just `skills/`

Mechanically, not by reading:

```
git grep -l '## Branches' origin/main -- 'skills/**/*.md'   →  15 files
comm against {13 change-list files} ∪ {MANIFESTO.md, changelog.md}
  in tree, in NEITHER list  →  EMPTY
  named, absent from tree   →  EMPTY
```

**The boundary is exact in both directions** — no file is unaccounted for, and the plan names no file that has since disappeared.

Outside `skills/`:

- **9 script files** under `skills/plot/scripts/` (32 occurrences, 19 in `plot-plan-meta.sh`) — covered by *"script comments … UNCHANGED"*.
- **`packages/board/test/` and `packages/domain/test/`** — R4's second finding. Now named explicitly at `:144`, count verified at 26, and the `tiny-garden` fixture plan (`packages/board/test/fixtures/tiny-garden/docs/plans/2026-03-01-plant-tomatoes.md`) is called out by name in the clause. **Closed.**
- The remaining ~560 repo-wide occurrences are `docs/`, changelogs and fixtures, reached by the same path-untouched assertion.

**The per-skill table at `:36-46` is exact.** I re-derived all nine rows: `plot-reslice` 7, `plot-implement` 3, `plot-deliver` 3, and 1 each for `plot-approve`, `plot-pulse`, `plot-reconcile`, `plot`, `ralph-plot-sprint` — summing to 18 — with `plot-idea` at 0 `## Branches` / 1 `## Slices`. Nine skills, eighteen occurrences, as the headline sentence says.

## 4. Walking `Done when` as the implementer

I took each clause and asked: can I execute this without deciding something the plan left open?

- **Replace in 13 named files** — yes, each named with a path, several with a line.
- **`plot-reslice/README.md:57` keeps BOTH words** — yes, pinned by name; I read the line and a literal replace would indeed break it.
- **Two tolerant matchers GAIN rather than replace** — yes, and I verified both are genuinely tolerant today (`any heading containing the word "Branches"`). The plan states the failure mode a naive replace produces, so an implementer knows what wrong looks like.
- **Exempt paths untouched by the diff** — executable as `git diff --name-only` filtered against the exempt roots. Discriminating, cannot go stale.
- **Parser reads all three spellings** — three fixtures, one per shape, asserting identical output. I re-measured the plan estate: **0 carry `## Waves`, 0 carry `## Branches`, 285 carry `## Slices`**, so the fixtures must be authored rather than harvested — which the clause already says. This gate can fail, and it fails precisely if a tolerant matcher is narrowed.
- **`pnpm test`** — standard.

**Two residual judgement calls, and neither blocks.**

`plot-pulse/README.md:98` and `plot-reslice/README.md:17,37,50` are unnamed and left to the sentence rule. I applied the rule to all four: every one is a write- or read-instruction, so all four change. The gate pins fewer files than the rule reaches — it under-pins rather than misdirects, and an implementer following the sentence rule lands in the right place.

*"the Slice/Wave distinction is stated once, where a reader meets it"* still names no file, and `MANIFESTO.md:35` states it wrongly (*"A wave is a `### ` subheading of `## Branches`"*) while sitting on the exempt list. **This is its fourth mention and I decline to block on it.** It is one sentence in one file; any of three placements is defensible and none is wrong; no gate disagrees with any of them. Blocking a docs change on where to put one sentence is the shape of a panel that has stopped being evidence.

`skills/**` is in `plot-reconcile-scan.sh` §22's scope and no changeset is named. Third mention. That is a delivery-time mechanic the implementer will hit and fix in the same pass; it does not change what the plan instructs.

## 5. Would I dispatch it tomorrow?

**Yes, without reservation.**

R4 wrote *"one edit, in the clause at `:142-145`, and I would hand this to an agent without reservation."* That edit was made, and it was made in the shape R4 specified rather than by patching the number: the exemption now asserts **paths untouched by the diff**, which reaches `packages/*/test/` without naming a count at all, and the two test trees are additionally named in prose. I looked specifically for the R3→R4 failure mode — a fix applied to the argument and not to the instruction — and it is absent: the prose at `:107` and the gate at `:142-147` now state one rule.

Every finding from four rounds is closed. The premise is re-verified (nine skills, 18 occurrences, `plot-idea` the lone correct one, and the shipped template at `templates/plan.md:40` still teaching the legacy word — the highest-value target). The boundary is exact in both directions over the whole repository. Every pinned line number survives yet another move of main. The exemption no longer carries a number that can go stale. The parse gate discriminates.

This is a docs change whose blast radius is now mapped file by file, with the parser untouched and all three spellings still accepted. Four rounds of interrogation have produced a plan I can execute literally.

**What I checked:** grepped the plan for `205` (zero) and enumerated every numeral in the `Done when` block, classifying each as line number or count; re-derived the repo-wide, `skills/*/SKILL.md` and `skills/` totals at `80fc1d3dc` (647 / 18 / 61) and compared against R3's and R4's readings to confirm which drift and which do not; counted `packages/board/test/` + `packages/domain/test/` at 26 across 16 files and confirmed the `tiny-garden` fixture is among them; listed all 15 `.md` files under `skills/` carrying the word and `comm`-diffed them against the plan's change list and exemption list in both directions (both empty); listed the 9 non-`.md` files under `skills/` and confirmed the script-comment exemption covers them; read all seven pinned lines on current main via `git show | sed -n`; read `plot-plan-meta.sh:778` to confirm the sentence that must keep the word; re-derived the nine-row per-skill table including `plot-idea`'s 0/1; counted plans by spelling (0 / 0 / 285) to confirm the parse-gate fixtures must be authored; read `MANIFESTO.md:35` to confirm the residual ambiguity is one sentence and not a contradiction in the gate.

Verdict: proceed
