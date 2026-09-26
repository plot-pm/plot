# Evidence lens — a-corpus-test-says-what-it-verifies

Position: amend
Evidence: executed

## 1. Is the defect real? Yes — but the plan reproduced it by accident, on an arm nothing reaches.

I ran four measurements. Baseline: unit `42 passed`, corpus `5 passed / 141.66 s`.

**Mutant A — the plan's own mutant, `branch-state.ts:264` `'merged'` → `'unknown'`:**

| suite | result |
|---|---|
| `test/branch-state.test.ts` | **4 failed / 38 passed** — exactly the plan's table |
| `corpus/branch-state.corpus.test.ts` | **5 passed / 96.23 s** — bundle NOT rebuilt (md5 unchanged `5f4b9fde…`) |

The corpus passed **with the bundle stale** — the two sides did NOT hold the same code and it still passed. That falsifies the plan's stated mechanism for this mutant. I instrumented the estate to find out why: I wrote a probe replicating `readingsFor` over all 26 branches and classified which `return` each reaches.

```
noref:mergeSubject(L183)  | scan=merged   4
noref:prMERGED(L187)      | scan=merged  20
hasref:ahead=5 real=4     | scan=wip      1
hasref:ahead=6 real=5     | scan=wip      1
```

**Line 264 is reached by 0 of 26 branches.** It needs a ref, zero commits ahead, and tips differing — no branch on this estate. So mutant A survived the corpus because it was **never executed**, not because both sides agreed. The plan's headline measurement is right about the green and wrong about the cause.

**Mutant B — `:187` `'merged'` → `'wip'`, the arm 20 branches DO reach.** This separates the two explanations:

| bundle | corpus |
|---|---|
| stale (md5 `5f4b9fde…`) | **1 failed / 4 passed**, 478 s, ~20 named lines `adapter=wip production=merged` |
| rebuilt (md5 `e4a57710…`) | **5 passed / 97.84 s** |
| — | unit: **1 failed / 41 passed** |

**The tautology is real and this is the run that proves it.** One mutant, one estate, one reached arm: stale bundle names twenty branches; rebuild and the same broken rule is green. That is the defect the plan is about, demonstrated on an arm that matters.

## 2. Is the plan's distinction correct? Yes, and it is the plan's strongest part.

Verified in `corpus/production.ts`: `readRemoteRefs` runs `git for-each-ref` (`:243`), `readMergeSubjects` runs `git log --merges` (`:269`), `readPrList` runs `plot-host.sh pr-list --rich` (`:197`), `readCommitsBeyond` runs `git log --shortstat` (`:300`), `readMainBranch` reproduces the scan's three-step resolution (`:351`). **None of these touches the scan.** Only `readFleetScan` (`:78`) runs `plot-fleet-scan.sh --json`, and it supplies the production ANSWER, not the readings. The readings path is genuinely independent, exactly as claimed.

And the scan's branch-state answer has exactly one source. `ask_branch_states` (`plot-fleet-scan.sh:3619`) calls `node board/plot-branch-state.mjs`; two call sites (`:3890`, `:3930`) both route through it; the function's own comment says *"There is no shell fallback."* Grep across `skills/plot/scripts/` finds no second path. **Verified — reading drift is caught, rule drift is not, and the split is where the plan puts it.**

## 3. What a measurement contradicts

**(a) The chosen mutant is the wrong exhibit.** The plan's whole motivation section rests on `:264`, and `:264` passes for a reason that has nothing to do with the tautology. Anyone re-running the plan's measurement to check it gets green and a false explanation. Worse: **the file already documents this class of miss.** Its own docstring at `corpus/branch-state.corpus.test.ts:390-410` records a 2026-09-06 four-mutant survey — two FAIL, two "PASSES — never reached" — and attributes the passes to estate coverage. The plan's mutant is a fifth instance of that already-documented category, presented as a new discovery of a different one.

**(b) "It does not touch the other corpus files … whether they share this shape is not asked here" — and the answer changes the plan.** I checked all nine. `sprint-score.corpus.test.ts:23-27` **already says what this plan proposes to say**: *"SO WHAT THIS NOW HOLDS IS THE WIRE … A field dropped or transposed on that wire shows up as a disagreement … the two can still part, just at the seam rather than in the rule."* The estate already has the sentence, in the file the plan cites for the opposite purpose. `deliverable.corpus.test.ts:62` is NOT this shape — it calls `plot-ask.mjs deliverable`, which its docstring (`:15-24`) names as carrying *"its own arithmetic"*, a real second implementation. So this is one file out of nine, and the remedy is already written next door.

**(c) "A test that fails when the bundle is stale would make the build-freshness half explicit" — already gated, and the plan says the slice should measure it.** `ci.yml:873-883` runs `pnpm run build:board` then `git diff --quiet -- skills/plot/scripts/board/` and exits 1 naming the stale files. Both open questions are answerable now, without a slice: no second assertion is needed.

**(d) The freshness gate and the tautology are in tension, and nothing in the plan notices.** The `corpus` job (`ci.yml:60-94`) does not build the board, so it runs against the committed bundle — meaning **CI's corpus tier does catch rule drift** from a contributor who edits the rule and forgets the rebuild. The tautology bites precisely the contributor who follows the DoD and rebuilds. That inverts the intuition and belongs in the docstring, because it is the non-obvious half.

## 4. What the plan must say before someone builds it

1. **Replace the motivating mutant with mutant B, or state both.** Give the stale/rebuilt pair for a reached arm — that is the only measurement that isolates the tautology from non-coverage. Keep `:264` only as the separate finding it is: *this estate never reaches it*, which is a coverage fact and is what `a-branch-behind-main-holds-nothing` actually needs to know about its own blast radius.
2. **Name the arm coverage.** 4 at `:183`, 20 at `:187`, 2 in the has-ref arm, **0 at `:264`**. This is the fact that plan needs and this plan is the one that measured it.
3. **Close both open questions in the plan, not in the slice.** Naming: adopt `sprint-score`'s existing wording, no rename — the estate already settled it. Assertion: none, `ci.yml:877` already gates freshness; cite the line.
4. **Record the CI asymmetry** from (d): the corpus job does not rebuild, so CI catches the careless edit and the tautology hits the careful one.
5. **Drop or downgrade "It does not touch the other corpus files."** The survey the "Done when" already requires is done above: 1 of 9 shares the shape, 1 already documents it, 1 is genuinely a multi-implementation pair.

## 5. Through this lens: what executing revealed

Reading the plan, its central claim looks sound. Executing it shows the claim is true and its evidence is not — and only a second, differently-placed mutant separates the two causes of a green run. The plan's own framing invites this: it states the corpus *"does verify something real"* and is *"a tautology about the decision"*, which is correct, then proves it with a mutant that demonstrates neither.

The estate is ahead of the plan in two places — `sprint-score`'s docstring and `ci.yml`'s freshness gate — and the plan defers both to a slice as open questions. A slice that opens this file will find the sentence already written next door and the gate already green, and will have to re-derive what the plan could have stated.

**Position is `amend` rather than `reject`** because the defect is real, I reproduced it, and the reading-drift/rule-drift distinction is correct and worth writing down. What is wrong is the evidence, the scope claim, and two open questions that are already closed on disk.

**Repository left as found.** `packages/domain/src/rules/branch-state.ts` md5 `6f52f7c485e1b74c4a1d096461c2332a` = baseline; `skills/plot/scripts/board/plot-branch-state.mjs` md5 `5f4b9fdee91b9c6a5e4cc6eae3675673` = baseline; probe file deleted; `git status --short` and `git diff` both empty. HEAD advanced `606be772` → `b88f75a6` from two sibling agents' plan-rewrite commits on this shared checkout; `git diff 606be772..HEAD` over `rules/branch-state.ts`, the bundle and `corpus/` is empty, so none of my files were involved.
