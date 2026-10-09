## Implementation brief — the-shell-sheds-its-decisions (wave 2: The gate counts every script)

- **Plan (canonical):** `docs/plans/2026-10-09-the-shell-sheds-its-decisions.md` on main
- **Approved:** 2026-10-09, jwloka, in-session
- **Branch:** `feature/the-gate-counts-every-script` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** per repo convention
- **Ordering:** this slice follows `feature/the-gate-counts-decisions` (#1405, merged as `03d0f9e26`). `feature/the-reaper-becomes-a-command` and `feature/approval-becomes-a-command` wait on it, because the wider count is what makes their conversions to *launcher* lower a number.

### What to build

Widen the count in `scripts/check-decision-count.sh` from "rows whose Kind is none of *launcher*, *readings*, *paired*" to "rows whose Kind is not *launcher*". The gate then fails when a change raises the number of scripts that are not launchers, and the target is 0.

The failure it closes: the #1405 gate counts a label, and a label can be moved out of the count. Measured on `main` at `a8901c764` (2026-10-09), `./scripts/check-decision-count.sh pr` prints `20 scripts still decide or orchestrate`, while the table holds 56 `.sh` rows: 2 *launcher*, 33 *readings*, 1 *paired*, 15 *decision*, 5 *orchestration*. The 34 rows of *readings* and *paired* are outside the count. `plot-approve.sh` is one of them: it merges a plan PR, flips the phase and pushes `main`, and its row reads *readings*. Converting it to a launcher lowers nothing today, so slice 4 of the plan would show no change on the gate. Under the wider count the same conversion lowers 54 to 53.

On `main` the wider count is 54 (20 + 33 + 1). The PR output must print the count at `HEAD` and at the base, as the shipped gate does.

The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

**The count is "not *launcher*", and *paired* is inside it (plan, `## Slices`).** A declared duplicate still carries a rule in shell. The reason *paired* was uncounted in #1405 was that the floor had to be reachable while `plot-worker-state.sh` and `rules/agent-state.ts` answer the same question by design. The plan now sets the target to 0 for every script, and a corpus pair keeps a duplicate honest without making it free. Do not add a fifth kind and do not exempt *paired* by name.

**The gate still reads the README and not the scripts.** Same reason as in #1405: a grep over a script body cannot tell a declared duplicate from a forgotten one (`CLAUDE.md`, *A Shell Script Asks The Domain*). Do not make the gate open a `.sh` file.

**The gate keeps the contract of #1405 unchanged.** Modes `pr` and `push <before>`, the base read from git, no override, no allowance literal, no environment variable, and no stored number. An unreadable base, a missing `origin/main`, a table with no *Kind* header and a README absent at the base each fail. The *Kind* cell is read from the end of the row. Absent is not zero. `has_evidence`, `named_paths_exist` and `rows` already do this; do not rewrite them.

**What changes about the evidence rule is a decision for you. Record the choice in the PR.** The rule exists because a flip to an uncounted kind lowered the count without moving a rule. After this slice only *launcher* is uncounted, so only a move to *launcher* lowers the count. The options:

- **Recommended:** require evidence for *launcher* only (the `.mjs` bundle in *Replaced by*, present in the HEAD tree), and keep the two-name evidence for *paired* because the evidence is the definition of the kind (a rule export and a corpus test that holds the pair). Drop the bundle requirement for *readings*, which no longer buys anything.
- Keep all three as shipped. Cheaper to change, but it leaves a rule that guards nothing.

Whichever you choose, the tests for the kinds you keep must stay, and the tests for a requirement you drop must be deleted with it, not left asserting a refusal that no longer exists.

**The README text and the `plot-worker-loop.sh` convention move with the gate.** Line 5 of `skills/plot/scripts/README.md` says *"`scripts/check-decision-count.sh` counts the rows of those two kinds"*. After this slice it counts every row that is not *launcher*. Correct that sentence, and correct the gate's header comment and the CI step name `The shell that decides does not grow` if it no longer describes the count (`ci.yml:766`). A header that still says "none of launcher, readings or paired" is a gate whose documentation lies.

### Done when

The plan's `## Slices` entry is the specification: the decision gate counts every README row whose kind is not *launcher*, *paired* included, so its target is 0 and a reading script counts like a deciding one. Assertions that exist because a naive implementation would pass without them:

- **A new row of kind *readings* fails.** Catches a gate that still treats *readings* as free. The #1405 test `a new row that starts as readings without a bundle fails` passes for the wrong reason after the change (it fails on evidence, not on count); make a test that fails on the count with the evidence present.
- **A new row of kind *paired*, naming both its rule and its corpus test, fails.** Catches a gate that counts *paired* only when the evidence is missing.
- **A flip from *decision* to *readings* no longer lowers the count and no longer passes as a conversion.** With one such flip and one new *decision* row, `HEAD` is one higher than the base and the gate fails. Catches a count still computed on the old set.
- **Converting one row to *launcher* with its bundle, while adding one new *readings* row, passes** (count equal). Catches `>` versus `>=` on the widened set.
- **The gate prints 54 on `main` unchanged, with the base count beside it.** The number in the output is what lets a reader tell a working gate from a skipped one. A passing exit code alone cannot prove it ran.
- **The #1405 fixture tests that survive keep passing**: a purpose cell containing `|`, a missing `origin/main`, a base with no README, a gap inside the table, a first cell with no backticked script.
- **Mutation-test it before trusting the tests:** commit first, break one arm of the count (restore `readings` to the free set), confirm the new-*readings* test fails, restore from git, not from your own copy.

Plus:

- **Fixture test:** extend `test/reconcile/decision-count.test.mjs` in its throwaway git repo with a bare remote, so the merge-base logic stays the thing under test. Its fixture table holds the rows the old count was written against; recount them for the new set rather than patching expectations until they pass.
- **CI step** at `.github/workflows/ci.yml:766`: no new step. The command line is unchanged; only the name may change.
- **Plot Config.** `scripts/check-decision-count.sh pr` is already on the `**` local-checks line in `CLAUDE.md`. If you edit `CLAUDE.md` for any reason, run `./scripts/check-agents-md.sh --write`, because CI refuses an `AGENTS.md` mirror that differs.
- **README.** Update the Kind paragraph (line 5). Do not edit any row's Kind in this slice: no script is converted here, and a row edit would move the count the gate is about to measure.
- **Changeset** per `CLAUDE.md` *Versioning*: description first, `bumps:` block last, package `plot`, and a `plan:` line after the description. Do not edit versions by hand.
- **Checks.** Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite. Do not run `pnpm run test:e2e` locally.
- **Shell gate.** `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice edits `scripts/check-decision-count.sh`, which is outside `skills/`, so the gate has nothing to count. If you touch a `.sh` file under `skills/`, growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.
- **Style.** Any function you write in `.mjs` or `.ts` is an arrow. Prose in markdown is one paragraph per line.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never run `gh pr create`: three slice PRs opened that way on 2026-09-08 each took the last commit subject as their title. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns:

- `scripts/check-decision-count.sh` and its fixture test `test/reconcile/decision-count.test.mjs`;
- the Kind paragraph at the top of `skills/plot/scripts/README.md`;
- the CI step name at `.github/workflows/ci.yml:766`, if it no longer describes the count;
- one changeset.

Do not convert any script to a launcher and do not change a row's Kind. Do not edit `plot-reap.sh` or `plot-approve.sh`: `feature/the-reaper-becomes-a-command` and `feature/approval-becomes-a-command` own those, and neither is started (no remote ref on origin at dispatch, 2026-10-09). Do not edit generated bundles under `skills/plot/scripts/board/` (`scripts/check-no-bundle-diff.sh` refuses them). Other plans' branches in flight may touch `skills/plot/scripts/README.md` rows; this slice edits only the paragraph above the table, so a rebase conflict there is unlikely.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
