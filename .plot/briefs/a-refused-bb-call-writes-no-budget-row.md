## Implementation brief — a-refused-bb-call-writes-no-budget-row

- **Plan (canonical):** `docs/plans/2026-11-23-a-refused-bb-call-writes-no-budget-row.md` on `main`
- **Approved:** 2026-11-24, jwloka, plan-PR #3699 merged
- **Branch:** `bug/a-refused-bb-call-writes-no-budget-row` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

The plan has one slice and nothing waits on it or blocks it.

### What to build

The `bb()` wrapper in `skills/plot/scripts/plot-host.sh` (near `:3754`) records one `budget.tsv` row for every `bb` call. `host_cli_call` (near `:3741`) runs the command and then calls `budget_record_call` with no condition. `bb` exits 75 for three causes: a 429 after a request went out, and two refusals that send nothing — the hourly ceiling and the pause after an earlier 429. The two refusals print fixed phrases on stderr (`bb paused until <time> after Bitbucket refused a request`; `<n> requests in the last hour from this machine; next request at <time>`). Plot counts those unsent calls as Bitbucket requests, so during a pause the board reaches the `predicted` limit sooner and `limitWaitMs` waits `MAX_LIMIT_WAIT_MS`, one hour, for requests nobody sent.

The change, in three parts:

1. `bb()` keeps a copy of `bb`'s stderr in a per-run file made by `plot_tmpfile`, declared beside `BB_RC` (`plot-host.sh:640-641`; add it to the `plot_tmpfile ... && plot_tmpfile ... ||` chain). The caller must still receive `bb`'s stderr unchanged.
2. `host_cli_call` gains the spend as an argument. `bb()` passes `0` when `bb` exited 75 and the stderr copy holds the ceiling or the pause phrase, and `1` otherwise. `budget_record_call` already records nothing for a spend of 0 (`:3501-3505`). `gh()` and `jen()` keep their behaviour.
3. A corpus test in `packages/domain/corpus/` feeds the same stderr texts to the shell match and to `bbThrottleCause` (`packages/domain/src/rules/bb-ledger.ts:489`) and fails on a disagreement.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The exit code cannot tell the causes apart, and #3688 did not change that.** Since #3688 the wrapper writes `bb`'s code to `BB_RC` and `failed_code` maps 75 to exit 5. All three causes still exit 75, and the row is written before `failed_code` runs, inside `host_cli_call`. Only the stderr phrase separates a refusal from a 429. Do not branch on exit 75 alone: a 429 after a sent request must still record one row.

**The shell match is a declared duplicate of `bbThrottleCause`, not a call to a bundle.** `bb()` runs once per host call. A bundle costs 39 ms per call and `node -e ''` 34 ms (`docs/shell-and-domain.md`), so a per-call bundle is the rejected alternative. The corpus test is what makes the duplicate safe. **On a disagreement the branch stops** — write `PLOT-BLOCKED` naming both answers and the phrase; never adjust one side to make the comparison pass. Report a disagreement as `<phrase> :: cause :: rule="ceiling" shell="record"`, using `describingAs({ left: 'rule', right: 'shell' })` from `corpus/compare.ts`, as `bb-ledger.corpus.test.ts` does.

**Do not add a machine marker or a new exit code in `bb`.** `cli/bb` in agent-skills already treats these phrases as its contract with Plot (its comment at `bb_check_status` says the words avoid the number 429 because Plot reads them). A new exit code breaks the 75-to-5 mapping #3688 shipped. This plan changes nothing in agent-skills.

**A partly sent paginated listing records no row** (the plan's recommended answer to `question-a-partly-sent-listing`). `bb_paginate` can send pages and then meet the ceiling on a later page, so its stderr holds the refusal phrase although requests went out. The wrapper already records one row per call however many pages it sends, and `bb`'s own ledger still counts every page. Do not try to count pages.

**A stub `bb` stands in for the real one; no `bb` needs to be installed.** Two unrelated tools are named `bb` (a Homebrew binary can shadow the local one), so the test puts its own stub first on `PATH`.

Rules carried over, unchanged:

- Absent is not false. A missing, empty or unreadable stderr copy means "not a refusal" and records the row as today; only a positive match on a phrase skips it.
- Read the exit code, not the emptiness of a variable. Save `$?` right after the call, before any other command can overwrite it.
- `bb()` also runs `bb_identity_check` while `BB_RC` is empty. Keep that order.
- The construct that copies stderr must pass `scripts/check-bash32-syntax.sh` (macOS bash 3.2): no `|&`, no `${var,,}`, no `mapfile`, and no process substitution that depends on a newer bash.
- `packages/domain/**` is arrow functions and factual TSDoc. The corpus test is new code in this repo: write its helpers as arrows.
- Nothing in a test may leave an entry in `TMPDIR` or write the operator's `~/.plot/state/budget.tsv`. `test/reconcile/budget.test.mjs` and `host.test.mjs` show the sandbox the suites use (`PLOT_BUDGET_HOME`).

### Done when

The plan's `## Slices` tests line is the specification:

- A stub `bb` that exits 75 with the pause phrase writes no row.
- A stub `bb` that exits 75 with the ceiling phrase writes no row.
- A stub `bb` that exits 75 after a 429 (stderr without either phrase) writes one row.
- A stub `bb` that exits 0 writes one row.
- The caller still reads `bb`'s stderr (assert the text reaches the wrapper's own stderr, byte for byte). This catches an implementation that redirects stderr into the temp file and forgets to pass it on.
- A corpus test agrees with `bbThrottleCause` on every phrase: both phrases with varied times, a 429 text, an empty string, and a refusal phrase embedded in other output. It catches the shell regex drifting from the TypeScript one.

Assertions a naive implementation passes without — add them:

- A `gh` call and a `jen` call still record one row each. This catches a `host_cli_call` signature change that shifts `gh`'s and `jen`'s positional arguments.
- A refused call leaves `BB_RC` at 75, so `failed_code` still answers 5. This catches a skip that returns before `BB_RC` is written.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. It reads the change against the branch's base and prints the tests that name `plot-host.sh`, the corpus project's related tests and the `scripts/check-*.sh` gates. Do not run `test:e2e` locally. Do not run `test:board` while the board is open. Add a changeset (package `plot`, description first, `bumps:` block last, `plan:` line inside it) naming `plot-host`'s skill bump per the repo's changeset rule; run `./scripts/check-changeset-packages.sh`.

`scripts/check-shell-lines.sh pr` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches `plot-host.sh`, so the growth is paid for in the same change: remove at least as many shell commands elsewhere in `skills/` as the wrapper adds. Joining statements with `;` or `&&`, or folding `fi` or `done` onto the line before, is not a payment. The gate stores no number and has no override. Find the payment before the first push — run `scripts/check-shell-lines.sh pr` locally. If no honest removal exists inside this slice's files, report it rather than inventing one.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`.

### Scope guard

This branch owns `skills/plot/scripts/plot-host.sh`, the new corpus test under `packages/domain/corpus/`, a test under `test/reconcile/` for the wrapper, the changeset, and any shell removed to pay the line ratchet. It does not touch `packages/domain/src/rules/bb-ledger.ts` (the rule is the reference, not the target), `cli/bb` in agent-skills, or any committed board bundle (`scripts/check-no-bundle-diff.sh`).

Other Bitbucket slices in flight on the same area — `the-bitbucket-client-sends-an-access-token` and `plot-init-checks-for-the-bb-cli` were approved just before this one — may touch `plot-host.sh` or the bb adapter. Run `git log origin/main -- skills/plot/scripts/plot-host.sh` before the first commit and rebase if it moved. If you find something the plan did not anticipate, report it rather than improvising outside scope.
