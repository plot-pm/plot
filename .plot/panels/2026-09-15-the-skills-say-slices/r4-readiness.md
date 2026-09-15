# Readiness lens, round 4 — the-skills-say-slices (#914)

Read on `origin/main` @ `0f20d2ce9` (main has moved 15 commits since R3 read `af09f8dcb`). Every count re-derived. One question: **would I hand this to an agent tomorrow?**

**Answer: not yet, and it is R3's blocker, unmoved.** The amendment fixed the Design section and did not touch the `Done when` clause R3 named. The plan now argues one rule in prose and instructs the opposite in the gate.

## 1. Re-deriving the three counts

| Plan (`:89-91`) | I measured @ `0f20d2ce9` | @ `af09f8dcb` (R3's read) | Verdict |
|---|---:|---:|---|
| `632` repo-wide | **642** lines / 653 occ | 567 / 570 | **stale, and structurally so** |
| `18` in `skills/*/SKILL.md` | **18** | 18 | correct |
| `61` under `skills/` | **61** | 61 | correct |

**632 was true, at `509752c56` — three commits of main ago.** I walked the last 30 commits: the repo-wide total reads 559 → 567 → 584 → 615 → 618 → **632** → 642 across them. It moved four times in fifteen commits.

**The containment relation is now stated correctly.** `:94` — *"61 sit under `skills/` and they CONTAIN the 18"* — and I verified it mechanically rather than by reading: `comm -23` of the 8 `SKILL.md` files against the 24 files under `skills/` is empty. R3's "additive where the real relation is inclusive" finding is closed.

**The two numbers that gate anything are stable.** 18 and 61 held identical across all five sample commits spanning the 30. The one that drifts is the one nothing depends on — and the plan already says so at `:107-109`: *"counts what it excludes rather than asserting a literal total, because a total is a number that goes stale between drafting and dispatch — and did."* **The Design section diagnosed its own defect correctly.** 632 remains as an illustrative reading with its command shown; it misleads nobody who runs the command. I would not block on it.

## 2. Is the file list complete?

**Yes.** I re-derived it rather than trusting R3:

```
git grep -l '## Branches' origin/main -- 'skills/**/*.md'   →  15 files
comm -23 against {14 named in Done when} ∪ {MANIFESTO, changelog}  →  EMPTY
```

Nothing sits in neither list. The 9 script files under `skills/` (32 occurrences, 19 of them `plot-plan-meta.sh`) are covered by *"script comments … UNCHANGED"*.

**Every pinned line number is still accurate on current main**, fifteen commits after they were written — I checked all seven by `git show | sed -n`:

- `templates/plan.md:40` → `## Branches` ✓
- `intro-to-using-plot.md:88` → ` ```markdown ` (the fence; heading at `:89`) ✓
- `tracer-bullets/README.md:28` → the write-instruction ✓
- `plot-pulse/README.md:56`, `plot-reslice/README.md:57` ✓
- `plot-deliver/SKILL.md:113`, `ralph-plot-sprint/SKILL.md:117` → both still the tolerant matchers ✓

## 3. THE BLOCKER — the Design section's rule and the `Done when` clause contradict each other

`:107` states the rule:

> **The exemption gate therefore counts what it excludes rather than asserting a literal total**, because a total is a number that goes stale between drafting and dispatch — and did.

`:142-145`, the clause the implementer executes, does the opposite:

> **script comments, `MANIFESTO.md`, `changelog.md`, the READMEs and all **205** test-fixture occurrences are UNCHANGED**, pinned by asserting their count is **exactly what it is today**

**This is R3's blocker verbatim.** The amendment rewrote the tier table and the paragraph beneath it and left the `Done when` untouched. `205` still stands at `:105` and `:143`.

**The number is wrong, and wrong by more than one.** Measured @ `0f20d2ce9`:

| Scope | lines | occurrences |
|---|---:|---:|
| `test/` | **206** | **207** |
| `packages/board/test/` | 24 | 24 |
| `packages/domain/test/` | 2 | 2 |
| all three combined | **232** | — |

**205 is reachable by no scoping I can construct** — not `test/`, not `packages/`, not `docs/`, not the repo. An agent that writes the assertion from the plan writes a test that fails on a clean checkout, and its two moves are both bad: hunt a phantom regression, or edit the baseline — which teaches that a count gate's number is adjustable, the one property that makes such a gate worthless.

**And `packages/board/test/` and `packages/domain/test/` are still in no list.** They are outside `skills/`, so the file-list boundary does not reach them, and the `205` figure scopes the exemption to `test/`. The `tiny-garden` fixture plan lives there and this estate has been burned by writes to it before. An implementer sweeping the repo has no written instruction to leave those 26 occurrences alone.

**Why this blocks rather than being absorbed as judgement.** Every other `Done when` clause names a file and an action; an implementer executes it or derives it from the sentence rule. This one names a **number** and says *assert it*. There is no rule to derive it from, the stated fact is false, and the clause's entire value is that the number was measured. **It is also the one clause the plan's own Design section already tells the implementer to ignore** — and when a plan's prose and its gate disagree, the implementer picks, which is precisely the judgement a `Done when` exists to remove.

**The fix is one edit**, and it is the edit the Design section already specifies: make the clause count what it excludes rather than assert a total. Something of the shape *"no file outside the named list gains or loses an occurrence"* — a per-file diff, which discriminates, cannot go stale, and reaches `packages/*/test/` without naming a number at all.

## 4. Walking the rest of `Done when` as the implementer

**`a. The parse gate now discriminates.`** R3 found *"every plan in `docs/plans/` parses byte-identically"* unfailable. The amendment replaced it with *"parsing one plan of each shape and asserting identical output"* — three fixtures, one per spelling. That **can** fail: it fails if the implementer narrows a tolerant matcher. Re-measured: 0 plans carry `## Waves`, 0 carry `## Branches`, 285 carry `## Slices`, so the fixtures must be written rather than found — which the clause says. **R3's finding is closed.** The byte-identical clause survives at `:147-149` as belt-and-braces; it still cannot fail, but it now sits beside a gate that can, so it is redundant rather than false assurance.

**`b. The two remaining judgement calls are real and I would not block on either.`**

- `plot-pulse/README.md:98` (*"Not every prefixed token in a `## Branches` section…"*) and `plot-reslice/README.md:17,37,50` are unnamed, left to the sentence rule. I applied the rule to all four and it sorts them unambiguously: all are write/read instructions, all change. The gate names fewer files than the rule reaches — a gate that under-pins, not one that misdirects.
- *"the Slice/Wave distinction is stated once, where a reader meets it"* still names no file. `MANIFESTO.md:35` states it **wrongly** (*"A wave is a `### ` subheading of `## Branches`"*) and is on the exempt list, so "once" remains ambiguous between amending the design authority and adding a sentence somewhere. I would pick a file and no gate would disagree. **This is the third round it has been raised and it is genuinely minor** — worth folding into the same pass, not worth a fifth round.

**`c. No changeset named.`** `skills/**` is in `plot-reconcile-scan.sh` §22's scope. Third mention; still absent.

## 5. Would I dispatch it tomorrow?

**No — for exactly one clause, and it is the same clause as last round.**

I want to be explicit that I looked for reasons to say yes. R1's, R2's and R3's findings are all closed except one: the boundary is complete and I re-derived it programmatically; the containment relation is right; the sentence rule sorts every occurrence I tested; the tolerant matchers are pinned to gain rather than replace, with the failure mode named; the unfailable gate was replaced with one that discriminates; every pinned line number survived fifteen commits of main. **This is a good plan.** Three rounds of work are visible in it.

What stops it is not a new finding and not a fourth defect. **It is that the amendment fixed the argument and not the instruction.** The Design section now says, correctly and in its own words, that asserting a literal total is the wrong gate — and the `Done when` still asserts one, using a number (`205`) that matches nothing in the tree and that scopes the exemption to a directory that excludes 26 occurrences including a fixture this repo has damaged before.

**One edit, in the clause at `:142-145`, and I would hand this to an agent without reservation.**

What I checked: re-derived all three counts at current main and at R3's sha, and walked the repo-wide total across 30 commits to establish it is structurally unstable while 18 and 61 are not; verified containment by `comm` rather than by reading; re-derived the 15-file `.md` list under `skills/` and diffed it against both of the plan's lists; read all four `plot-reslice/README.md` and both `plot-pulse/README.md` occurrences and applied the plan's sentence rule to each; confirmed all seven pinned line numbers by `git show` on current main; measured `test/`, `packages/board/test/`, `packages/domain/test/` and searched for any scoping yielding 205; counted plans by spelling (0/0/285) to test whether the replacement parse gate can fail.

Verdict: amend
