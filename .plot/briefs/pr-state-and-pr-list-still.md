## Implementation brief — pr-state-and-pr-list-still (wave 1: Merge-tree reading)

- **Plan (canonical):** `docs/plans/2026-10-20-pr-state-and-pr-list-still.md` on `main`
- **Approved:** 2026-10-20, Jan Wloka, plan-PR #2196 merged
- **Branch:** `bug/pr-state-and-pr-list-still` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

One wave, one branch. Release 2.28.0 waits on it (Plot must work on Bitbucket + Jenkins + Jira before it publishes). A sibling slice, `bug/pr-state-and-pr-merged-miss`, rewrites the Bitbucket branch arm of `pr-state` in the same file (see Scope guard).

### What to build

On Bitbucket, `plot-host.sh pr-state` and `pr-list --rich` print `mergeable: "unknown"` for every PR, so the board and the merge queue never show a conflict. Measured 2026-10-20 on ewz-kus-portal, read-only: all 10 open PRs read `unknown`, while `git merge-tree --write-tree origin/develop origin/<branch>` reports #3702 and #3701 clean and #3210 and #3094 conflicting. Bitbucket's REST API has no conflict field, so the host cannot answer; git can.

Fold `mergeable` in the Bitbucket arms after the host response, from `git merge-tree --write-tree <base> <head>`: exit 0 → `mergeable`, exit 1 → `conflicting`, anything else → `unknown` with a named reason. The arms to change, at main `171e127a6` (grep, do not trust the numbers): the `pr-state` Bitbucket arms (number and branch, `plot-host.sh` near `:3668`-`:3760` region and `bb_state_row` at `:1822`), and the two Bitbucket `pr-list --rich` row programs that hardcode `mergeable:"unknown"` (near `:4468` with Jenkins, `:4479` without). The usage-block comments at `:36-41` and `:204-212` say "always unknown there" and must change with the behaviour.

Inputs per PR: head SHA (`source.commit.hash`, already read as `headSha`) and base branch (`destination.branch.name`, not yet carried by the Bitbucket rows; add it, GitHub already carries `base`). Run against `origin/<base>` and the head SHA after a fetch. Plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The host stays unasked.** No request is charged: `merge-tree --write-tree` reads the object database only and writes neither index nor worktree. The fold sits after the host response, inside `plot-host.sh`, the one place that reaches the host CLI. `git` here is a local read, not a host call.

**`unknown` is not `conflicting`, and the exit code decides.** `plot-merge-queue.sh`'s `would_conflict` (`:128`) is `! git merge-tree … >/dev/null 2>&1`, which maps every failure to a conflict. That is right for a queue prediction and wrong here: a missing head SHA or a failing git would show a false conflict on the board. Only exit 1 is `conflicting`. `trees-git.ts:400` (`mergeConflict`, in `packages/domain/src/adapters/trees/`) already draws the line this way: 0 → mergeable, 1 → conflicting, else `unknown`. The plan names `trees-git.ts` without the directory.

**Git older than 2.38 answers `unknown`, never clean.** Older git has a different `merge-tree` that succeeds while answering another question (`plot-merge-queue.sh:49-62` explains and carries the gate). Reuse that version check; do not copy its failure path (it exits), because here the answer degrades to `unknown`.

**A head or base not in the local clone, or a failed fetch, answers `unknown` and names which.** Absent is not false: never print `mergeable` for a pair git could not read.

**The desk path stays.** `worker-loop.ts:957` keeps `pr.mergeable === 'unknown' ? trees.mergeConflict(worktree)`; its guard stops firing on Bitbucket once the host answers. Do not touch it, `trees-git.ts` or the domain.

**Declared duplicate.** The shell fold and `trees-git.ts` answer one question twice. `plot-host.sh` runs once per host read, not once per agent per pass, which favours a bundle over a new duplicate (*A Shell Script Asks The Domain*). Decide by measurement and say which in the PR body. If you duplicate, add a corpus test under `packages/domain/corpus/` that names both answers on disagreement; adjusting either side to pass is forbidden. `scripts/check-shell-lines.sh` charges a new duplicate in lines.

**The plan's four open questions are yours to answer, and the PR states the answers:**

1. *Reason format.* A `mergeableReason` field (additive, absent on GitHub) or stderr only. Check what the board's row fold accepts before adding a field to the row schema; the board reads `mergeable` from the pulse as before, and the plan says no board change is expected.
2. *Cost on a long list.* N merge-tree calls plus one fetch for `pr-list --rich`. Measure on ewz-kus-portal (10 open PRs, read-only) before choosing `--rich` only, a cap, or a cache keyed on `headSha` + base SHA.
3. *Stale base.* Fetch the base each time, or accept a bounded-age local ref. Measure the fetch cost.
4. *Declared duplicate.* Above.

**Rules carried over unchanged.** Absent is not false. Read the exit code, not the emptiness. GitHub arms are unchanged and their tests stay green unchanged. No `gh` or `bb` call outside `plot-host.sh`. Merged and closed Bitbucket rows keep `mergeable:"unknown"`: a PR that is no longer open has no conflict to show.

### Done when

The plan has no `## Done when` list; the slice line is the specification: Bitbucket `pr-state` and `pr-list --rich` fold `mergeable` from merge-tree and name the reason for an `unknown`, with contract tests under `test/reconcile/` on a sandbox repo holding one clean and one conflicting branch. Assertions a naive implementation would pass without:

- **Disagreeing fixtures:** one branch that merges clean and one that conflicts, in the same sandbox repo, so a fold that returns one value for every PR fails. Read both through `pr-state <number>`, `pr-state <branch>` and `pr-list --rich`.
- **Failure is `unknown`:** an unreachable head SHA, a missing base ref and a failed fetch each answer `unknown` with the reason, never `conflicting`. A fold that copies `would_conflict` passes the conflict case and fails these.
- **Old git:** a `git` stub reporting a version below 2.38 answers `unknown`, not `mergeable`.
- **Read-only:** the sandbox's index and worktree are byte-identical before and after (`merge-tree --write-tree` must not touch them).
- **Closed rows:** MERGED and CLOSED rows keep `unknown` and run no merge-tree.
- **No host charge:** the stub `bb` call count equals the count before the change.
- **GitHub unchanged:** existing GitHub `pr-state`/`pr-list` assertions pass without edits.

Verification target after the tests pass, read-only on ewz-kus-portal: `pr-state` and `pr-list --state open --rich` read `conflicting` for #3210 and #3094 and `mergeable` for #3702 and #3701. Writes against that project need Jan's go.

Plus: one `.changeset/*.md` (description first, `bumps:` block last; package `plot`, skill `plot` patch). No board artifact changes. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run the whole `test/reconcile/*.test.mjs` glob rather than the files you suspect, with `unset PLOT_REPO_ROOT PLOT_UNATTENDED` first (`host.test.mjs` can stall under load; run the test names you touched alongside it).

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice edits `plot-host.sh`: growth is paid for in the same change, so remove shell elsewhere or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override. Update the `plot-host.sh` usage-block entries and the `skills/plot/scripts/README.md` row if behaviour described there changes.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`.

### Scope guard

This branch owns the Bitbucket arms' `mergeable` value in `skills/plot/scripts/plot-host.sh`, its usage-block comments, the new `test/reconcile/` test, and a changeset. It does not touch `worker-loop.ts`, `trees-git.ts`, the GitHub arms or the board.

In flight and overlapping: `bug/pr-state-and-pr-merged-miss` replaces the listing inside the Bitbucket `pr-state` branch arm (`for _s in $bb_all_states`, near `:3733`) and in `pr-merged`, `pr-merge-commit` and `pr-merged-heads`. Both slices edit the `pr-state` Bitbucket region, so expect a rebase conflict there. Keep the fold as a separate helper called after the row is built, so the other slice's listing change and this one's `mergeable` change touch different lines. `bug/pr-merged-sh-asks-gh` (#2186) routes `plot-pr-merged.sh` through `plot-host.sh` and does not touch these arms.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
