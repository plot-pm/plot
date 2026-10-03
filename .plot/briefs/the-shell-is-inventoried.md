## Implementation brief — the-shell-shrinks-into-the-domain (wave 2: The shell is inventoried)

- **Plan (canonical):** `docs/plans/2026-10-03-the-shell-shrinks-into-the-domain.md` on `main` (round 3)
- **Approved:** 2026-10-03, jwloka, in-session
- **Branch:** `infra/the-shell-is-inventoried` (base: `main`)
- **Ends as:** one PR to the base, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is wave 2 of 4. Wave 1 (`infra/the-shell-cannot-grow`, #1264) is merged: `scripts/check-shell-lines.sh` and its `--per-file` flag exist on `main`. Wave 3 (`infra/a-command-names-its-action-in-the-domain`) does not wait on this slice. Wave 4 (`infra/the-first-script-becomes-a-command`) waits on it, because this slice names wave 4's script.

### What to build

A reader who wants to move a script out of shell has no list to choose from. The table in `skills/plot/scripts/README.md` has two columns (*Script*, *Purpose*) and 63 rows. `scripts/check-helper-table.sh` measured on 2026-10-03 at `7873130cf`: **31 of 94 shipped scripts have no row** (baseline 31). Of the 31, 13 are `.sh` files: `plot-agent-manifest.sh`, `plot-agent-monitor.sh`, `plot-budget.sh`, `plot-build-monitor.sh`, `plot-controller-gate.sh`, `plot-default-branch.sh`, `plot-monitor-subject.sh`, `plot-push-main.sh`, `plot-quiet-stretch.sh`, `plot-transcript-quiet.sh`, `plot-undeliver.sh`, `plot-worker-loop.sh` and `plot-write-config.sh`. The other 18 are `board/*.mjs` bundles. `plot-worker-loop.sh`, the per-pass script the cost rule names, is among the missing rows.

Do five things:

1. **Add rows for the 13 `.sh` files**, so `check-helper-table.sh`'s `BASELINE` literal falls from 31 to **18**. Lower the literal in the same change; the gate says it may fall and never rise. Writing rows for some of the 18 bundles is allowed and lowers it further, but the plan asks for the 13 and nothing else requires the bundles.
2. **Add three columns to the table: *kind*, *runs* and *replaced by*.** Fill them for all 58 tracked `.sh` files under `skills/plot/scripts/` (`git ls-files 'skills/plot/scripts/*.sh' | wc -l` gave 58 on the day this brief was written).
   - *kind* is one of *launcher*, *readings*, *decision*, *orchestration*. A collector-plus-bundle pair counts as *readings*: its decision has moved and its readings are the next step. A script that only resolves a bundle and `exec`s it is a *launcher*.
   - *runs* is *once per operator command*, *once per agent per pass* or *on every tool call* (a hook). **A script with several callers takes the most frequent caller's value**, because that caller sets its cost. `plot-fleetctl.sh` is the plan's example: it runs from `/plot-fleet` and also on every board refresh (`supervisor-reading.ts:53`), so it is *per refresh*, not *once per operator command*. Read each script's callers with `git grep -n '<name>.sh'` before you write the cell; do not infer it from the name.
   - *replaced by* is the JS entry that replaces it, or empty. No script has one yet.
   - **Do not store line counts in the table.** They go stale at the rate the shell grows. `check-shell-lines.sh --per-file` prints them.
3. **Rank the candidates and name wave 4's script.** The ranking is a command, not an opinion: scripts whose *runs* is *once per operator command*, excluding the five largest (`plot-host.sh`, `plot-dispatch.sh`, `plot-fleet-scan.sh`, `plot-reconcile-scan.sh`, `plot-worker-loop.sh`), sorted by `--per-file` lines, largest first. On 2026-10-03 the plan expected `plot-deliver.sh` (601 lines) first. `/plot-deliver`, the board's deliver endpoint and `auto-deliver.ts` call it, and `auto-deliver.ts` starts it once per plan delivered. **Confirm or replace that candidate with the command's output**, put the command and its output in the PR body, and amend the plan before wave 4 starts: the `infra/the-first-script-becomes-a-command` line under `## Slices`, and the last line of `## Changelog`.
4. **Amend `docs/shell-and-domain.md` and the `A Shell Script Asks The Domain` section of `CLAUDE.md`.** State the target: a command an agent runs is a JS entry point, a `.sh` file that remains is a launcher that resolves its bundle and `exec`s it and decides nothing. State the price: a new declared duplicate (§1's per-agent-per-pass row, §2's quoted heredoc seam) removes an equal number of lines elsewhere in the same change, and `check-shell-lines.sh` is what enforces it. In §2, drop "and the artifact is committed" from the *new bundle* bullet: `a-branch-carries-no-built-bundle` has `main` build bundles after each merge (`build-bundles.yml`), and a pull request carries none (`scripts/check-no-bundle-diff.sh`). Then run `./scripts/check-agents-md.sh --write`, because `AGENTS.md` mirrors `CLAUDE.md` and CI refuses a mirror that differs.
5. **Add one line to `skills/plot/scripts/README.md` above the table** saying how to regenerate the ranking, so the next reader gets the command and not this brief.

### The decisions the plan settles — do not re-derive them

**The inventory extends the existing table; it is not a new file.** `check-helper-table.sh` already gates the table and reads a row's first cell as the script name (`| \`plot-host.sh\` | …`, with `board/` prefixed for a bundle). A second file would be a second record of one fact, which is what that gate was written to refuse (measured 2026-10-02: an 11-row copy in `AGENTS.md` had drifted from `CLAUDE.md`). Keep the first cell exactly the script's name. A row whose first cell carries extra words does not count, and the baseline will not fall.

**No line counts in the table.** The count grew 1,737 lines in the three days to 2026-10-03. A number in a cell is wrong by the next merge, and `--per-file` prints it for free in 0.044 s.

**A collector-plus-bundle pair is *readings*, not *decision*.** 34 scripts follow *the script collects readings, a bundle decides* (`plot-release-gate.sh` → `board/plot-release-gate.mjs`). Their decision has moved; their readings are the next step. Marking them *decision* would hide the remaining work from the column whose purpose is to show where it is.

**Ranking by frequency first, size second.** The five largest are each a plan of their own and are excluded from wave 4's ranking. `plot-worker-loop.sh` is the follow-on plan's first script because it runs per agent per pass, and wave 4 does not take it. Do not name a per-pass or per-refresh script as wave 4's, whatever its size: the cost rule (`docs/shell-and-domain.md` §1) says a once-per-pass site duplicates and a once-per-command site calls the domain, and wave 4 is the second case.

**Facts that move go into the brief and the PR, not the plan.** Three panel rounds found counts, open PRs and sibling lists stale each time. Measure the counts on the day you start (`check-shell-lines.sh --per-file`), put them in the PR body, and put only the design in the plan and the docs.

**Rules carried over unchanged.** Absent is not false: a script with no caller found is an empty *runs* cell and a question in the PR, not *once per operator command*. Read the exit code and the output of a command, not its emptiness.

### Done when

The plan's `## Slices` line for this branch is the specification: the README script table lists all 58 scripts with kind, runs and replaced-by columns; `docs/shell-and-domain.md` and `CLAUDE.md` state the target; the plan names wave 4's script.

The assertions that exist because a naive implementation passes without them:

- **`./scripts/check-helper-table.sh` is green with `BASELINE` at 18, and its output says 18.** A table that gained the columns but not the 13 rows passes at 31 and would leave the baseline where it was.
- **Every one of the 58 `.sh` files has a row whose first cell is exactly its name, and a non-empty *kind* and *runs*.** Check with `git ls-files 'skills/plot/scripts/*.sh'` against the first cells; do not trust a visual read of a 70-row table. Put the check you ran in the PR body.
- **No *runs* value was inferred from a name.** For each script you mark *once per operator command*, the PR body lists its callers from `git grep`. A script with a hook, board-refresh or loop caller carries that caller's value.
- **Wave 4's script is the output of the ranking command.** The PR body shows the command and its first five lines. If the first line is not `plot-deliver.sh`, say why the plan's candidate lost and amend the plan's `## Slices` and `## Changelog` lines to the new name.
- **`./scripts/check-agents-md.sh` passes** after `--write`. An edit to `CLAUDE.md` alone fails CI.
- **The shell count did not grow.** This slice edits no `.sh` file; `scripts/check-shell-lines.sh pr` must print an unchanged count.

Plus the repo gates: add a changeset in the format of an existing one in `git log` (`.changeset/` may be empty in a fresh worktree; copy the format from history) — the description first, the `plan:` and `bumps:` block last — with `'plot': patch`. No skill's `SKILL.md` changes, so the `bumps:` block may name none; run `./scripts/check-changeset-packages.sh`. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `pnpm run test:e2e` locally. Use Node 24 (`nvm use`); `pnpm` crashes on Node 26. Never `git stash` in a shared worktree.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches no `.sh` file. If you find one that needs an edit, growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line under `## Slices` in the plan. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `skills/plot/scripts/README.md`, the `BASELINE` literal in `scripts/check-helper-table.sh`, `docs/shell-and-domain.md`, the `A Shell Script Asks The Domain` section of `CLAUDE.md` and its `AGENTS.md` mirror, the two amended lines in the plan, and one changeset.

Out of scope, and held by sibling branches: `controllerInvocation` and any edit to `plot-controller-gate.sh` (wave 3); moving any script into a JS entry (wave 4). Do not edit any `.sh` file under `skills/`.

One open PR touches a file this branch owns, verified on 2026-10-03: #1265 `bug/the-parser-reads-every-wait` edits `skills/plot/scripts/README.md`. Expect a rebase over it, and re-read the table after it merges before you add columns, because it may have added or reworded a row. Verify with `gh pr list --state open` on the day you start; this list ages.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
