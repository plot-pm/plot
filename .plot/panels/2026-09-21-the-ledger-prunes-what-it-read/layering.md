# Layering lens — the-ledger-prunes-what-it-read

Position: amend

Lens: this repo's architecture rules — CLAUDE.md "The Layering Rule" and "A Shell Script Asks The Domain", and `docs/shell-and-domain.md`.

The defect is real and worth fixing. The placement argument is the part that does not hold: the plan's own cost rule, applied to a measurement the plan never took, points at the domain rather than at `plot-budget.sh`. Three of its five load-bearing claims are false or unverifiable as written.

## 1. Does the stated problem exist, verified in code?

**Yes, and it reproduces exactly.** Not the placement, but the cost and the dead rule both check out.

Measured on this machine, 2026-09-21:

| reading | plan says | I measured |
|---|---|---|
| `~/.plot/state/budget.tsv` | 17.6 MB, 312589 lines | 17,681,756 B, **314,002 lines** (still growing during the session) |
| `budget_rate` over that file | 516 ms | **519 ms** |
| `budget_rate` over a pruned file | 5 ms over 50 lines | **9 ms over 2609 lines** — the real survivor count |

`truncationOwed`, `PRUNE_THRESHOLD = 100`, `survivors`, `groupByBudget` (`rules/budget-record.ts`), `truncate(keep)` (`ports/budget.ts`) and its implementation (`adapters/budget/budget-file.ts:truncate`) all exist and are fully specified. Every reference to them outside the rule itself is in `packages/domain/test/`. The plan's grep result holds: **there is no production caller.** `ports/slots.ts:54` refers to `truncationOwed` in prose only.

And the growth genuinely has no ceiling. `survivors` over the live file keeps **2609 of 314041 lines — 0.83%**. The window needs under 1% of what every call parses.

## 2. Is the proposed change the smallest one that fixes it?

**No, and this is the finding.** The plan asserts the shell must own the pruning because starting `node` on the hot path is too expensive. It never measured the domain doing the job. I did.

I bundled `spendRate` + `survivors` with the repo's own esbuild and ran it against the live 314k-line ledger:

```
run1 wall=402ms  {"readMs":25,"spendRateMs":155,"survivorsMs":169,"lines":314041,"pruneOwed":true,"keep":2609}
run2 wall=406ms  {"readMs":23,"spendRateMs":156,"survivorsMs":170,"lines":314041,"pruneOwed":true,"keep":2609}
run3 wall=409ms  {"readMs":26,"spendRateMs":152,"survivorsMs":176,"lines":314042,"pruneOwed":true,"keep":2610}
```

**The domain reads the file, scores the window AND computes the survivors in ~405 ms wall, against the shell's 519 ms for the read alone.** Bare `node -e ''` is 23 ms here, consistent with `shell-and-domain.md`'s 34 ms. On the pathological file the plan is built around, the "expensive" `node` hop is *already faster than the shell it is said to be too slow for*, because the 23 ms of startup is noise beside 500 ms of awk.

The steady state is the case that actually decides it, and it is close:

| after pruning | cost |
|---|---|
| shell `budget_rate` over 2609 lines | **9 ms** |
| a domain bundle over the same | ~23 ms start + a few ms of work |

So the honest trade is **~9 ms vs ~30 ms per host call**, both negligible against `bb`'s 363–426 ms — not the 40 ms-versus-free framing `plot-budget.sh`'s header uses. The plan inherits that header's conclusion without re-testing its premise against the file the plan itself is about.

A smaller change exists and the plan does not consider it. `truncate()` is already implemented in the adapter and correct — scratch file, `rename`, the concurrent-append loss documented and accepted. `budget-file.ts:truncate` is byte-for-byte the mechanism the plan proposes to write again in bash. The nearest fix is **one caller**, not a second pruning path.

## 3. What the plan claims that I could NOT verify

**a) "the reader on this path is `plot-budget.sh`, not the domain."** This is the plan's whole placement argument and it is contradicted by the file it names. `plot-budget.sh`'s own header states the opposite as settled design:

> IT APPENDS AND READS, AND IT NEVER PRUNES. Truncation is the one write that is not an append, and it belongs to the `BudgetRecord` port's `truncate()` — **a second pruning path in shell would rewrite the file while the port's reader believed it held the lines it had just proven dead.** The shell writes the record; the domain is what cleans it.

The plan proposes exactly the thing this paragraph refuses, and never quotes it, never argues against it, and never proposes amending it. Under this repo's own convention — the `plot-host.sh` and `plot-open-pr.sh` lines in CLAUDE.md are amended in place when overturned, *"amended rather than quietly broken"* — a plan that reverses a written design decision must overturn it on the record. This one steps over it silently.

**b) "`PRUNE_THRESHOLD` stays the domain's number — read from the bundle at adoption or duplicated under the corpus tier."** Unverifiable, because the plan does not choose. "Read from the bundle at adoption" and "duplicated under the corpus tier" are different architectures with different failure modes, and the single slice names both with an "or". The one place the plan must be decisive about layering, it defers.

**c) "a corpus test pins the shell's threshold against `PRUNE_THRESHOLD`."** No budget corpus test exists. `packages/domain/corpus/` holds agent-state, branch-state, desk-reset, eligible, finished-estate, plan-store, refs and sprint-score — **no budget**. And the existing pin is weaker than advertised: `test/reconcile/budget.test.mjs:32-36` hardcodes `const MAX_LINE_BYTES = 512` with the comment *"Named here rather than imported"*. That is a third copy of a constant, not a pin. `plot-budget.sh`'s header claim that *"a test pins the two together"* is, today, not true in the sense `shell-and-domain.md` means.

## 4. What breaks if this ships as written

**The undeclared duplicate gets bigger, and it is already the forbidden kind.** This is the layering finding that matters most.

`shell-and-domain.md` is explicit: *"Duplication is allowed and undeclared duplication is not... What makes it safe is not that one side is authoritative — it is that a test says they agree."*

The budget pair is **already** duplicated and **already** undeclared. `plot-budget.sh`'s awk block reimplements `windowStart`, `withinWindow`, `readWindow`, `windowSpend` and `latest` — including the subtle passed-reset-versus-future-reset rule and the `basis != unknown` latest-reading rule, each carrying its own measured justification in both languages. No corpus test compares them. The plan adds `truncationOwed` and `survivors` to that undeclared pair and describes the corpus test as though it already existed.

Worse, the board never reads the domain rule either. `fleet.ts:1774 spendRateFor` shells out to `plot-budget.sh spend-rate` and re-parses its JSON (`fleet.ts:2467`). So the plan's claim that *"the board is the only TypeScript spender"* is true about spending and misleading about reading: **the board reads the ledger through the shell**, which is why `spendRate`'s `pruneOwed` field — computed, returned, documented — has no consumer anywhere. The rule is dead because the one TypeScript caller was routed around it, not because its callers are shell.

**Second breakage: the plan's own safety property is weaker in shell than in the adapter.** The plan promises the truncation goes "through a scratch file and one `mv`". `budget-file.ts` does this with `process.pid` in the scratch name. A bash implementation must reproduce that, plus the `groupByBudget` multi-budget rule — `survivors` recomputes the window **per budget** precisely so one reader's truncation cannot delete another connector's live lines. `budget_rate` filters to one `(connector, account)` pair and never builds the other budgets' windows. A shell pruner written from `budget_rate`'s existing awk pass **has not read the other budgets and cannot keep them.** That is not a hypothetical: my measurement shows `survivors` keeping 2609 lines across every budget, where the single-bucket read sees only its own. The plan's "What must not break" section covers lock-freeness and failure paths but never mentions the multi-budget rule — the one most likely to be lost in translation, and the one whose loss silently deletes another connector's live window.

**Third: `--rich`.** The measured 2567–7241 ms with a spread of 4674 ms on a stable 363–426 ms underlying call is consistent with several ledger reads per call, and the note confirms 7 lines written per `pr-list`. Pruning reduces each read but the plan does not say how many reads remain per call, so the claimed end-state latency is not derivable from anything in it.

## 5. An existing mechanism, or a nearer one

**Yes — `truncate()` in `adapters/budget/budget-file.ts`.** Implemented, argued, and matching the plan's proposed mechanism exactly. The plan acknowledges it exists and then proposes writing a second one in bash.

The nearer change the plan ignores, in ascending order of size:

1. **`fleet.ts:spendRateFor` calls the domain.** The board already holds the lines question; it is TypeScript; it runs on a 60 s clock, not the 5 s one (its own comment says so). This is the "once per operator command" tier by any reading, and it makes the board a real reader of `readWindow`/`truncationOwed`/`survivors`/`truncate` — closing the dead rule with zero new bash and zero new duplication. One board pruning to 2609 lines makes every one of the eleven shell spenders fast, because they share one file per computer. **The ledger is the computer's, so a single pruner fixes every reader.** The plan's per-call shell pruner is the only design where each of twelve spenders needs its own copy of the rule.
2. **A `plot-budget-prune.mjs` bundle**, the seam `shell-and-domain.md` §2 names, in the tier `plot-slice-spend.mjs` already occupies. Measured above at ~405 ms on the worst file and dropping to near-noise once pruned.
3. If and only if 1 and 2 are measured insufficient, the shell duplicate — **with** the corpus test written first, per §3.

The plan's own note ranks this correctly and the plan does not follow it: *"Measure again after 1 and 2 before designing an index."* The same discipline applies one level up. Measure the domain call before designing a shell pruner.

## What an amendment needs

1. **Measure the domain on this path before ruling it out.** The number is ~405 ms worst-case, ~30 ms steady-state, against the shell's 519 ms and 9 ms. Publish both and argue from them. If shell still wins, it wins honestly.
2. **Route `fleet.ts:spendRateFor` through the domain, or say why not.** It is the nearest caller, it is already TypeScript, and it is why `pruneOwed` is dead.
3. **Overturn `plot-budget.sh`'s header explicitly, or keep it.** Quote the "IT NEVER PRUNES" paragraph, argue it, and amend the file in the same slice — the repo's stated practice for a reversed design decision.
4. **Choose one of "read from the bundle" or "duplicate under the corpus tier".** The "or" is the layering decision.
5. **Write the budget corpus test first, and scope it to the duplicate that already exists** — `windowStart`'s passed-versus-future reset, `latest`'s `basis != unknown` rule, `readWindow`'s per-budget isolation — not only the new threshold. Today the pair is undeclared, which `shell-and-domain.md` forbids, and the plan's prose implies a pin that is not there.
6. **State the multi-budget rule in "What must not break".** `survivors` keeps every budget's window; `budget_rate` reads one. A shell pruner built on the existing awk pass deletes the others.

None of this disputes the defect. 314k lines parsed to answer a question about 2609 is a real, unbounded cost, and a finished rule with no caller is exactly the defect CLAUDE.md says to report. The fix is one caller away in the direction the layering rule already points, and the plan walks the other way on an untested premise.
