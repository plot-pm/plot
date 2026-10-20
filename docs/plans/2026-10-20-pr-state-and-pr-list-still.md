# Bitbucket pr-state and pr-list answer mergeable from a local merge-tree

> On Bitbucket, `plot-host.sh pr-state` and `pr-list --rich` read `mergeable: unknown` on every PR, so the board, the merge queue and `pr-list` show no conflict; both ask `git merge-tree --write-tree` instead, or answer `unknown` with a named reason.

## Status

- **State:** Delivered
- **Type:** bug
- **Sprint:**
- **Issue:** #2188
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-20, Jan Wloka, plan-PR #2196 merged
- **Started:** 2026-10-20, Jan Wloka, `bug/pr-state-and-pr-list-still`
- **Delivered:** 2026-10-20

## Changelog

- On Bitbucket, `plot-host.sh pr-state` and `pr-list --rich` report `mergeable` or `conflicting` from a local `git merge-tree` check, so the board and the merge queue show a Bitbucket PR that conflicts with its base.

<!-- Board impact: none expected. No plan-format, template or docs/plans layout change; the board reads `mergeable` from the pulse as before, and only the value on Bitbucket changes. Rebuild of the board artifact is not needed. -->

## Motivation

Plan `pr-state-and-pr-list-never` (#2156, Delivered) assumed the Bitbucket API reports merge-conflict status. It does not: `bb pr view <id> --json` carries no conflict field, and `plot-host.sh` lines 38-41 and 206-212 record that `mergeable` is always `unknown` there. Commit 057db660d (#2176) fixed the desk only: `worker-loop.ts` (line 957) runs `trees.mergeConflict`, a local `git merge-tree` check on the desk's worktree.

The host readings stay at `unknown`. Measured 2026-10-20 on ewz-kus-portal at main `1c347d610`, read-only: `pr-state` and `pr-list --state open --rich` gave `mergeable: "unknown"` on all 10 open PRs. `git merge-tree --write-tree origin/develop origin/<branch>` reports #3702 and #3701 clean, and #3210 and #3094 conflicting.

Three consumers read the host answer, not the desk's: the board, the merge queue and `pr-list`. On Bitbucket none of them shows a conflict. Release 2.28.0 waits on this: Plot must work on a Bitbucket + Jenkins + Jira project before it ships.

## Design

### Approach

The Bitbucket arms of `pr-state` and `pr-list --rich` in `skills/plot/scripts/plot-host.sh` derive `mergeable` from the same check the desk uses: `git merge-tree --write-tree <base> <head>`. Exit 0 maps to `mergeable`, exit 1 to `conflicting`. Any other outcome maps to `unknown` with a named reason. `merge-tree --write-tree` works in the object database only, so it writes neither the index nor a worktree.

Inputs per PR: the head SHA (`source.commit.hash`, already read for `headSha`) and the destination branch (`destination.branch.name`, which `pr-state` and the list rows do not yet carry for Bitbucket). The check runs against `origin/<base>` and the head SHA after a fetch of both. A head or base that is not in the local clone, a git older than 2.38 (the gate `plot-merge-queue.sh` already carries at line 49), or a failed fetch gives `unknown` and says which of these it was.

Layering: `plot-host.sh` is the one place that talks to the host CLI, and the `host` connector shells to it. The merge-tree call is a local git read, not a host call, so the fold sits in the Bitbucket arm after the host response and charges no request. The desk path stays as it is; its `pr.mergeable === 'unknown'` guard simply stops firing on Bitbucket once the host answers.

Deliverable check (`plot-deliverable-search.sh`): `trees-git.ts` `mergeConflict` answers the same question for one worktree's `HEAD`, and `plot-merge-queue.sh` line 130 predicts conflicts between branches. Neither answers it per host PR. The slice reuses the git invocation and does not replace either. Whether the shell side duplicates the rule in `trees-git.ts` is a declared-duplicate question under *A Shell Script Asks The Domain*; see Open Questions.

### Open Questions

- [ ] **Reason format.** The issue asks for "a named unknown with its reason". The `mergeable` enum has three values and consumers branch on them. Options: a new `mergeableReason` field on the row (additive, absent on GitHub), or the reason on stderr only. Which one does the board need to render?
- [ ] **Cost on a long list.** `pr-list --rich` over N open PRs runs N merge-tree calls plus a fetch. Measure on ewz-kus-portal (10 open PRs) before deciding whether `--rich` only, a cap, or a cache keyed on `headSha` and the base SHA is needed.
- [ ] **Stale base.** A local `origin/<base>` can lag the host. Does the check fetch the base each time, or is a bounded-age local ref acceptable?
- [ ] **Declared duplicate.** `trees-git.ts` `mergeConflict` and the shell fold answer one question twice. Join the corpus tier (`packages/domain/corpus/`), or have the shell call a bundle? `plot-host.sh` runs once per host read, not once per agent per pass, which favours a bundle.

## Slices

### Merge-tree reading

- `bug/pr-state-and-pr-list-still` — Bitbucket `pr-state` and `pr-list --rich` fold `mergeable` from `git merge-tree --write-tree` and name the reason for an `unknown`; contract tests under `test/reconcile/` with a sandbox repo holding one clean and one conflicting branch <!-- builds: bitbucketMergeable, a merge-tree fold in plot-host.sh --> → #2207

## Notes

- Follows #2156 (`pr-state-and-pr-list-never`) and #2176. Source issue: #2188.
- Verification target: ewz-kus-portal, read-only. `pr-state` and `pr-list --state open --rich` must read `conflicting` for #3210 and #3094 and `mergeable` for #3702 and #3701. Writes against that project need Jan's go.
