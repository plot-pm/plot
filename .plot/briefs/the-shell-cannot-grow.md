## Implementation brief — the-shell-shrinks-into-the-domain (wave 1: The shell cannot grow)

- **Plan (canonical):** `docs/plans/2026-10-03-the-shell-shrinks-into-the-domain.md` on `main` (round 3)
- **Approved:** 2026-10-03, jwloka, in-session
- **Branch:** `infra/the-shell-cannot-grow` (base: `main`)
- **Ends as:** one PR to the base, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is wave 1 of 4 and the other three wait on it. Wave 2 (`infra/the-shell-is-inventoried`) prints its table from `check-shell-lines.sh --per-file`, so that flag is part of this slice's interface.

### Stop first: four open PRs grow the shell

Round 3 of the plan lists four waits, and all four are open on 2026-10-03: #1257 `bug/a-pr-carries-no-bundle` (+118 shell lines), #1251 `bug/a-refused-slice-is-held` (+20), #1256 `bug/a-continued-loop-carries-its-manifest` (+17) and #1252 `bug/a-hand-over-is-checked-before-it-is-made` (+5). The ratchet would refuse each of them in flight, so it merges after them. **Before the first commit, run `gh pr view <n> --json state` for all four.** If any is still `OPEN`, write `PLOT-BLOCKED.md` naming it and stop. Until `a-slice-waits-on-every-branch-it-names` lands, the parser keeps only the last `waits:` on a line, so no gate does this check for you.

### What to build

`scripts/check-shell-lines.sh <mode>` counts the non-comment, non-blank lines of every tracked `.sh` file under `skills/`, and fails when the count after the change is higher than the count before it. It stores no number. Measured on `main` on 2026-10-03: 61 files, **15,499** lines, in 0.044 s. The count is `git ls-files 'skills/*.sh' | xargs cat | grep -vE '^\s*(#|$)' | wc -l`; use the same definition, because slice 2 and the inventory quote it.

The failure it exists for: shell grew from 6,904 lines in `skills/plot/scripts/` (`91a89d95b`, before 2026-09-01) to 11,896 (`6fdc73b36`, before 2026-09-15), and 76 of the 85 commits on `main` that touched shipped shell in the 14 days to 2026-10-03 made it longer. Nothing counted it.

"Before" per mode, which is the whole decision and lives in the script so a fixture test can run it:

| Mode | "Before" is |
|---|---|
| `pr` (a `pull_request`, or a `workflow_dispatch` run on a branch) | `git merge-base HEAD origin/<default>` |
| `push` to `main` | the CI event's `before` SHA, passed as an argument, so a push of several commits is one range |
| a revert, in either mode | the parent of the commit it reverts |

Wire it into `.github/workflows/ci.yml` beside `check-script-names.sh` (`:607`), choosing the mode from `github.event_name` the way the *Board build + artifact freshness* step does (`:1098`). The `validate` job already checks out with `fetch-depth: 0`; it still needs `git fetch --no-tags origin <default>:refs/remotes/origin/<default>`, which the `corpus` job runs at `:86-90` for the same reason. `ci.yml` has no `workflow_dispatch` trigger today (`on:` lists `pull_request` and `push` only). Add the trigger only if the plan's text needs it to hold; if you add it, say so in the PR.

`--per-file` prints each file's count, largest first, and `--per-file` also prints the size of `scripts/*.sh` (CI and local tooling, 1,449 lines on 2026-10-03) on a separate line, so the plan's second Open Question has a number.

The slice also tells the work already approved. Add one Notes line, naming the gate and the offset rule, to **every Approved plan whose slices write shell**. Compute that list on the day you start: `grep -l 'State:\*\* Approved' docs/plans/*.md`, then read each plan's slices. On 2026-10-03 the candidates were `every-desk-state-has-an-exit`, `a-desk-and-its-manifest-name-each-other`, `the-queue-reads-the-order-the-scan-reads`, `a-slice-waits-on-every-branch-it-names`, `an-assignment-is-read-where-it-is-recorded` and `a-draft-slice-waits-on-its-approval`; round 3 counts six, and `a-branch-carries-no-built-bundle` is in flight as #1257. Add one paragraph to the `/plot-implement` brief template (`skills/plot-implement/SKILL.md`, step 4, under the repo gates) so every brief after this one names the gate, and update that skill's `README.md` and Model Guidance table if the step changes.

### The decisions the plan settles — do not re-derive them

**The gate stores no number.** A stored baseline drifts, makes two PRs that each shrink the shell conflict on one line, and invites an environment variable that turns it off. Room freed by a merged change is gone for the next change, because that change's base already holds the lower count. There is no override, no allowance literal and no `PLOT_*` switch. A ratchet with slack is a budget; `test/reconcile/script-name-gate.test.mjs` is the precedent for a test that fails when slack appears.

**A push to `main` is reported, not refused.** The ruleset lets the Repository admin push past the pull-request rule, and a pushed commit cannot be refused after it lands. `push` mode fails that run and names the commit and the lines; the next push measures only its own range and passes. A merge-base comparison on `main` compares `HEAD` with itself and always passes, which is why `push` has its own "before".

**A revert is recognised by its tree, not its subject.** The change's net diff is the exact inverse of one commit on `main`. A subject match would let a hand-written "Revert" through, and refuse a revert that was reworded. Under the ruleset a revert reaches `main` as a pull request, so the rule lives in `pr` mode. A rollback of slice 4 depends on it.

**An unreadable base fails; it never passes.** When `origin/<default>` is absent or the merge base cannot be computed, exit non-zero and say which. A count compared with nothing is not a pass. Measured 2026-08-27 on this estate: an empty result read as "no PRs" refused four fully merged plans, and the same shape of mistake runs the other way here — an empty "before" reads as a count of zero and refuses everything.

**The failure message states the offset rule.** An agent reads the CI failure before it reads a plan. It names the lines over, the "before" it compared with, and the two ways to pay: remove lines elsewhere in the same change, or write the rule in the domain and ask it through a bundle.

**The count measures size, not where decisions live.** A rule moved into a `node -e` heredoc lowers nothing, and a decision kept in a shorter function passes. Do not add heuristics to catch that. Slice 2's *kind* column records where decisions sit, and a reviewer reads it.

**Do not widen anything to make this pass.** The operator's direction was "instead of widen the gates". If the gate fails on your own change, offset the lines; do not touch `check-script-names.sh`'s allowance, the spawn ratchet's `allowed=28`, or any gate's literal.

### Done when

The plan's `## Slices` line for this branch is the specification: CI refuses a pull request above its merge base and reports a push range above its start; the Approved siblings that write shell and the brief template name the gate.

The assertions that exist because a naive implementation passes without them:

- **A fixture test for each row**, in `test/reconcile/` (a `*.test.mjs`, so the `test/reconcile/*.test.mjs` local-check glob finds it): growth fails; a net-zero change passes; a shrinking change passes; a growing push range fails; a revert passes. Build the fixtures as real throwaway git repositories, the way `test/reconcile/main-bundles.test.mjs` does with a bare remote. A mocked count would pass with the merge-base logic deleted.
- **A growing push range that ends below its start passes only when the range total is not higher.** Test a range of two commits where the first grows and the second shrinks by more: the range passes, per the plan's "measured as one range". A per-commit check would refuse it.
- **A revert of a commit that grew the shell passes, and a hand-written inverse with the wrong tree fails.** This catches a subject-based match.
- **An unreadable base fails with a message naming it.** Run the script in a clone with no `origin/<default>`.
- **The gate passes on this repository** at the commit you push, and says its count. This catches a definition of "code line" that disagrees with the 15,499 above.
- **No environment variable changes the result.** Run once with `CI=`, `PLOT_UNATTENDED=1` and a deliberately odd `HOME` set, and assert the same answer.

Plus the repo gates: the new script needs the `check-*` precedent for repo tooling (a row is not needed in `skills/plot/scripts/README.md`, since `scripts/` is not the shipped helper estate; confirm `./scripts/check-helper-table.sh` is green). Add a changeset in the format of `.changeset/a-ci-suite-is-refused-at-a-desk.md` — the description first, the `plan:` and `bumps:` block last — with `'plot': patch` and a `bumps:` entry for `plot-implement` (its SKILL.md changes; the bump is declared there, never edited by hand). Run `./scripts/check-changeset-packages.sh`. If your change touches a file `CLAUDE.md` mirrors, run `./scripts/check-agents-md.sh --write`.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `pnpm run test:e2e` locally. Use Node 24 (`nvm use`); `pnpm` crashes on Node 26. Never `git stash` in a shared worktree.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line under `## Slices` in the plan. Push the first real commit as soon as it exists. The slice starts after the four waits above have merged; say in the PR body which of them you rechecked and when.

### Scope guard

This branch owns: `scripts/check-shell-lines.sh`, its test under `test/reconcile/`, the one `ci.yml` step (and the fetch step it needs), the Notes lines in the Approved plans that write shell, the paragraph in `skills/plot-implement/SKILL.md` (with its README), and one changeset.

Out of scope, and held by sibling branches: the README script table's new columns and the changes to `docs/shell-and-domain.md` and `CLAUDE.md` (wave 2, `infra/the-shell-is-inventoried`); `controllerInvocation` and any edit to `plot-controller-gate.sh` (wave 3); moving any script into a JS entry (wave 4). Do not edit any `.sh` file under `skills/` — a growing line there is what this gate refuses, and a shrinking edit belongs to a plan of its own. Siblings in flight that edit shell today: #1257, #1251, #1256 and #1252, above. Verify with `gh pr list --state open` on the day you start; this list ages.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
