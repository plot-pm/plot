## Implementation brief — the-shell-sheds-its-decisions (wave 1: The gate counts decisions)

- **Plan (canonical):** `docs/plans/2026-10-09-the-shell-sheds-its-decisions.md` on main
- **Approved:** 2026-10-09, jwloka, in-session
- **Branch:** `feature/the-gate-counts-decisions` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** per repo convention
- **Ordering:** this slice goes first. `feature/the-reaper-becomes-a-command` and `feature/approval-becomes-a-command` wait on it, because the gate is what makes their README edits count.

### What to build

A CI check that counts the rows of the `skills/plot/scripts/README.md` script table whose *Kind* is none of *launcher*, *readings* or *paired*. It reads the table at the merge base and at `HEAD`, and it fails when the count at `HEAD` is higher. It stores no number.

The failure it closes: `scripts/check-shell-lines.sh` measures size, and its header says *"a rule moved into a `node -e` heredoc lowers nothing here"*. Measured on `main` at `0b749ca9e` (2026-10-09), 22 of 56 scripts still decide or orchestrate (16 *decision*, 6 *orchestration*), and `plot-reap.sh` holds four `node --input-type=module` heredocs in 489 code lines. No gate reads the *Kind* column.

The slice also:

- adds *paired* as a fourth kind;
- corrects the `plot-worker-loop.sh` row from *orchestration* to *launcher*, with `board/plot-worker-loop.mjs` in *Replaced by* (the script is 7 code lines that `exec` the bundle), which lowers the count from 22 to 21;
- moves the `plot-worker-state.sh` row from *decision* to *paired*, naming `rules/agent-state.ts` (`agentState`) and `packages/domain/corpus/agent-state.corpus.test.ts`.

The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

**The check is a label count, and the plan says so.** The gate reads what the README claims and does not read the scripts. Measured: `plot-approve.sh` merges a plan PR, flips the phase and pushes `main`, and its row reads *readings*. Changing *decision* to *readings* lowers the count without moving a rule. A grep over script bodies cannot tell a declared duplicate from a forgotten one (`CLAUDE.md`, *A Shell Script Asks The Domain*), so do not try to make the gate read bodies.

**The evidence rule is enforced, not left to the reviewer (answered 2026-10-09, jwloka).** The gate refuses a row whose kind changes to *launcher*, *readings* or *paired* between the merge base and `HEAD` unless the same row carries the evidence:

| New kind | Evidence in the row |
|---|---|
| *launcher* | a bundle path in *Replaced by* |
| *readings* | the bundle that holds the decision |
| *paired* | the domain rule export and the corpus test that holds the pair |

A row mislabelled from the start is corrected by naming the bundle that already exists. A row that is new in the change and starts as *launcher*, *readings* or *paired* needs the same evidence.

**A declared duplicate takes a kind of its own, *paired* (answered 2026-10-09, jwloka).** The alternative, counting it as *decision*, makes the floor unreachable: `plot-worker-state.sh` answers the same question as `rules/agent-state.ts` by design, and `agent-state.corpus.test.ts` compares both on every desk. *Paired* rows are not counted, so the floor is 0. The gate must not accept *paired* without both names in the row, or the kind becomes the exit the evidence rule closes.

**The check is a new sibling script, or a mode of `check-shell-lines.sh`. You decide and record the choice in the PR.** What each costs:

- A sibling `scripts/check-decision-count.sh` (name yours) keeps the line counter and the table reader apart, and `scripts/` is outside `skills/`, so the new shell does not count against `check-shell-lines.sh`.
- A mode shares `default_ref`, `fail` and the `pr` / `push <before>` plumbing, but it grows a 200-line script that already carries revert detection.

Either way, copy the contract of `check-shell-lines.sh`: modes `pr` and `push <before>`, the base read from git (`git merge-base HEAD origin/<default>` for `pr`), no override, no allowance literal, no environment variable. **An unreadable base fails and never passes**, and so does an unreadable or empty table. A count compared with nothing is not a pass. On `push` the gate reports and fails the run; it cannot refuse a landed commit.

**Parse the *Kind* cell from the end of the row.** Purpose cells hold prose with `|` characters, so counting cells from the left misreads the row. The last three cells are *Kind*, *Runs* and *Replaced by*. Test this with a row whose purpose contains a pipe. A parser that reads cell 3 from the left passes the 31-row fixture and miscounts the real table.

**Absent is not zero.** Carry this rule over from the shell-lines gate: a base commit with no README, or with a table that has no *Kind* header, is an error to name and not a count of 0 (a count of 0 at the base would refuse every change).

### Done when

The plan's `## Slices` entry is the specification: a CI check counts the README rows whose kind is neither *launcher* nor *readings* at the merge base and at `HEAD`, and fails when the count grows; the `plot-worker-loop.sh` row becomes *launcher*. The answered open questions add *paired* and the enforced evidence rule. Assertions that exist because a naive implementation would pass without them:

- **A new row of kind *decision* or *orchestration* fails.** Catches a gate that only compares existing rows.
- **A kind change from *decision* to *readings* with an empty *Replaced by* fails**, and the same change with a bundle named passes. Catches the label-flip the plan names.
- **A row changed to *paired* naming only a rule, or only a corpus test, fails.** Catches a half-evidence pass.
- **Converting one row to *launcher* with its bundle, while adding one new *decision* row, passes** (count equal). Catches an off-by-one on `>` versus `>=`.
- **An unreadable base, a missing `origin/main`, and a table with no *Kind* header each fail.** Catches the vacuous pass.
- **A purpose cell containing `|` is read correctly.**
- **The gate passes on `main` unchanged and prints the count (21 after this slice) and the count at the base.** The count in the output is what lets a reader tell a working gate from a skipped one. A passing exit code alone cannot prove the gate ran.
- **Mutation-test it before trusting the tests:** commit first, break one arm of the comparison, confirm the matching test fails, restore from git.

Plus:

- **Fixture test:** `test/reconcile/<name>.test.mjs`, in a throwaway git repo with a bare remote, as `shell-lines.test.mjs` does, so the merge-base logic is the thing under test. The reconcile glob is a CI suite, so it is covered by `node --test test/reconcile/*.test.mjs`.
- **CI step** in `.github/workflows/ci.yml`, beside *The shell does not grow* (`ci.yml:757`). It reuses the `git fetch --no-tags origin main:refs/remotes/origin/main` step above it, and takes `push "${{ github.event.before }}"` or `pr` the same way.
- **Plot Config.** Add the new script to the `**` local-checks line in `CLAUDE.md` so `plot-local-checks.mjs` prints it. Then run `./scripts/check-agents-md.sh --write`, because CI refuses an `AGENTS.md` mirror that differs.
- **README table.** Update the three rows above and add *paired* to whatever text defines the kind values. `scripts/check-helper-table.sh` demands a row for every shipped script under `skills/`. A new script under `scripts/` needs none.
- **Changeset** per `CLAUDE.md` *Versioning*: description first, `bumps:` block last, package `plot`, and a `plan:` line after the description. Do not edit versions by hand.
- **Checks.** Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `pnpm run test:e2e` locally.
- **Shell gate.** `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches no `.sh` file under `skills/`, so the gate has nothing to count. If that changes, growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.
- **Style.** Any function you write in `.mjs` or `.ts` is an arrow. Prose in markdown is one paragraph per line.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never run `gh pr create`: three slice PRs opened that way on 2026-09-08 each took the last commit subject as their title. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns:

- the new check script under `scripts/` (or its mode in `check-shell-lines.sh`) and its fixture test;
- the `ci.yml` step;
- the `CLAUDE.md` local-checks line and the regenerated `AGENTS.md`;
- the three README rows (`plot-worker-loop.sh`, `plot-worker-state.sh`, and any row the gate's first run forces to name evidence), and the text defining *paired*;
- one changeset.

Do not convert any script to a launcher, and do not edit `plot-reap.sh` or `plot-approve.sh`: `feature/the-reaper-becomes-a-command` and `feature/approval-becomes-a-command` own those, and they are not started. Do not edit generated bundles under `skills/plot/scripts/board/` (`scripts/check-no-bundle-diff.sh` refuses them). Other plans' branches in flight may touch `skills/plot/scripts/README.md` rows, so expect a rebase conflict in that table and resolve it row by row.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
