## Implementation brief — the-bb-pause-rule-follows-bb-1-15-2 (wave 1: Port)

- **Plan (canonical):** `docs/plans/2026-11-24-the-bb-pause-rule-follows-bb-1-15-2.md` on `main`
- **Approved:** 2026-11-25, jwloka, plan-PR #3716 merged
- **Branch:** `bug/the-bb-pause-rule-follows-bb-1-15-2` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is the plan's only slice. Nothing waits on it and it waits on nothing.

### What to build

Re-record the bb-ledger corpus with `bb` 1.15.2 and make Plot agree with it. Measured 2026-11-24: an uncommitted re-record passes 17 of 18 corpus tests, and "writes the pause and its words after a 429 as bb_pause_after_429 does" fails with 13 mismatches, for example `null|900 :: file :: rule="1788001023 900\n" shell="1788000423 300\n"`. Four changes fix it:

1. `packages/domain/src/rules/bb-ledger.ts`: add `export const BB_RETRY_AFTER_MAX_S = 86400`. `bbRetryAfter` answers it for a value of more than 9 digits (leading zeros not counted) and for any value above it. Update the doc header to `cli/bb` 1.15.2 (agent-skills `83d16f25c`). `bbPauseTail` keeps printing the raw header, as `bb` does.
2. `packages/domain/corpus/record-bb-ledger.mjs`: `constants()` lifts `BB_RETRY_AFTER_MAX` with the three it lifts now. Add a check that refuses to record when a lifted function names a `BB_[A-Z_]+` constant the prelude does not define and that is not on a named list of per-process or environment variables.
3. The recorder's `VERSION` (`:38`) and the corpus test's `VERSION` (`bb-ledger.corpus.test.ts:43`) go to 1.15.2. Re-record `fixtures/bb-ledger/{bb-outputs,functions,interop}.json`.
4. `bb-ledger.corpus.test.ts`: replace the declared UTF-8 divergence (`:164`) with a whole assertion in both locales, and assert that at least one recorded 429 case carries `asked to wait`.

Add a changeset (`'plot'` package, description first, `bumps:` block last). The changelog line is in the plan's `## Changelog`.

### Settled decisions — do not re-derive them

**The 13 mismatches are a recorder defect, not a rule change and not a `bb` defect.** `bb_pause_after_429` 1.15.2 clamps with `[[ "${#ra}" -gt 9 || "$ra" -gt "$BB_RETRY_AFTER_MAX" ]]`. The recorder never lifts `BB_RETRY_AFTER_MAX`, so `[[ 900 -gt "" ]]` compares against 0, `ra` becomes empty, and the function takes the no-`Retry-After` path (300 s, the doubled 600 s, no "asked to wait" words). Do not "fix" this by changing the rule to match the 300 s; that is the one move "A Shell Script Asks The Domain" forbids. The real `bb` defines the constant at `cli/bb:228` and answers 900.

**One rule change since 1.15.0 reaches the pause.** `bb_pause_write` is unchanged. `bb_pause_after_429` changes only the clamp (`b6c8e4b29`, `BB_RETRY_AFTER_MAX=86400`). Five earlier commits (`9cd41c87b`, `158957e10`, `b9c8cc21b`, `2dcf44658`, `19b673f18`) precede 1.15.0, and `bbPauseAfter429`, `bbPauseMerge` and `BB_PAUSE_SKEW_S` already port them. Do not touch those.

**Lifted with the constant, 1.15.2 agrees with the rule on 14 of 15 cases.** The one difference is `null|1234567890`: `bb` writes `1788086523 86400`, `bbRetryAfter` gives 999,999,999 s today. That case must read `1788086523 86400\n` afterwards.

**One slice, not two.** The rule change cannot be compared without the re-recorded corpus, and the re-recorded corpus fails without the rule change.

**Carried-over rules:** absent is not false; read the exit code, not the emptiness; on a corpus disagreement the branch stops and neither side is adjusted to pass.

### Version drift — read before you re-record

`bb --version` on this machine reports **1.15.3** (measured 2026-11-25), and the recorder refuses any version except its gate. The plan names 1.15.2 (`83d16f25c`). You need `bb` 1.15.2 to record. Check out `cli/bb` at `83d16f25c` from agent-skills (`~/Quatico/Agentic-Tools/agent-skills-internal` holds no `cli/bb` at its current checkout; look in its worktrees or fetch) and point the recorder's `BB` at it, or install 1.15.2. Do not widen the gate to accept 1.15.3 without diffing `bb_pause_after_429` and `bb_pause_write` between 1.15.2 and 1.15.3: if they differ, stop and report it, because the plan and its tests name 1.15.2. The fixtures' `bb` field must start with `bb 1.15.2 `.

### Done when

The plan's `## Done when` equivalent is its slice line's `tests:` annotation:

- `bb-ledger.corpus.test.ts` passes 18 of 18 over fixtures whose `bb` field starts with `bb 1.15.2 `. The three fixture files all carry it; the existing check at `:124` asserts that for each.
- The `null|1234567890` case reads file `1788086523 86400\n`.
- At least one `pauseAfter429` tail carries `asked to wait`. This catches a lifted shell that ignores `Retry-After`, which passes every other comparison.
- A unit test in `packages/domain/test/bb-ledger.test.ts`: `bbRetryAfter("86401")` is 86400 and `bbRetryAfter("00429")` is 429. The second catches a clamp that counts leading zeros as digits.
- The recorder's constant check refuses a lifted function that names an undefined `BB_*` constant. Prove it once by removing `BB_RETRY_AFTER_MAX` from the lift list and seeing the recorder refuse.

Plus: no generated bundle in the diff, and the changeset passes `./scripts/check-changeset-packages.sh`. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `test:e2e`. The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`). When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists. Use commit prefix `plot: `.

### Scope guard

This branch owns `packages/domain/src/rules/bb-ledger.ts`, `packages/domain/test/bb-ledger.test.ts`, `packages/domain/corpus/record-bb-ledger.mjs`, `packages/domain/corpus/bb-ledger.corpus.test.ts`, `packages/domain/corpus/fixtures/bb-ledger/`, and one changeset. Do not touch `adapters/host/bb-ledger-file.ts`: it consumes `bbRetryAfter` and needs no change. Branch `bug/plot-init-reads-which-bb-answers` is in flight on the remote and concerns `plot-init`, not these files.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
