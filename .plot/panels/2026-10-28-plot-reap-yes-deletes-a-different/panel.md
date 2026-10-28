# Panel moderation: plot-reap-yes-deletes-a-different, round 1

**Reconciliation:** unanimous `amend` (connectors, operator, safety, testability). Every verdict passed `plot-panel.mjs check` on the first send.

## What each juror looked at

| Juror | Ran |
|---|---|
| connectors | a node probe of `firstBranchRefusal`; a scratch repo with an own-commit-less branch, a squash-merged branch, and one with a commit after the merge; `check-ancestry-decisions.sh`; read-only git in ewz-kus-portal |
| operator | the shipped `plot-reap.mjs` against a sandbox, `--dry-run` then `--yes`; `git update-ref -d` versus `git branch -D` on a checked-out branch |
| safety | a scratch repo with a stubbed `gh` against the shipped `plot-reap.sh`, `--dry-run` then `--yes` |
| testability | the shipped bundle against a sandbox with a `gh` stub whose answers change between runs; `git diff v2.29.0 HEAD` on `reap.ts`/`sweepable.ts` (empty) |

All four executed against the shipped code, and three reproduced divergences independently.

## Where the jurors agree

1. **Slice 3 guards a direction that does not occur.** `merged` needs a successful host answer with a merged row (`plot-host.sh:4238-4259`); a 429 or failure gives `unknown`/`not-merged` (`:658`, `host-shell.ts:308-316`), and the reaper keeps the branch. The defect is the reason text: `unknown` prints as "unlanded work — no merged PR" (`reap.ts:1022`; `firstBranchRefusal` takes a boolean, `sweepable.ts:67-99`). The issue's `migration-abw` dry-run "keep" was a degraded answer and the `--yes` "merged" the true one.
2. **A cause the plan does not name, with no host involved: the worktree-then-branch cascade.** `runReap` runs the worktree kind first (`reap.ts:1268-1269`); under `--yes` it removes a landed desk and keeps its branch, then the branch kind re-lists checkouts (`:988-991`), finds it free and deletes it. The dry run shows `keep — checked out`. Reproduced by operator, safety and connectors; it matches the issue's `feature/EWZREL-9391` row.
3. **A second host-free cause: the fetch between runs.** Each run fetches the default branch (`reap.ts:1244-1245`), so `origin/<default>` can move and `refs.contains` turn `yes`.
4. **The counter claim is wrong.** `branches_deleted` equals the `deleted` rows by construction. The mismatch comes from a FAILED row counting in both `branches=` and `branches_kept=` (`reap.ts:1042,1054`) and from the worktree kind deleting branches at `:911` outside `branches_deleted`.
5. **A data-loss path the dry run shows as safe.** The branch kind deletes on "a PR on this branch name merged" without comparing the local tip with the merged head; a commit added after the merge is lost (safety, connectors via `git cherry`). The worktree kind already guards this with `prMergedHeads` and `unpushedPatches` (`reap.ts:435-462`).
6. **Recoverability ships first.** Deleted tips go to `refs/plot/reaped/<branch>` (kept through `git gc`), covering all three delete sites (`reap.ts:911,1048,1171`), with a printed restore command per row.
7. **The record must be checked against a fresh local reading.** `--yes` acts only on what the recorded dry run AND a run-time check both allow (tip unchanged, not checked out, not the default branch), so a host flip or an edited record can only remove deletions.

## Added by single jurors

- connectors: an ancestry "yes" has one false case — a branch with no commits of its own reads contained and is deleted as "merged into develop" (scratch repo: `is-ancestor` exit 0). The `refs-git.ts:762` marker licenses a caller that sends a "yes" to the host, but reap decides deletion at `:784,1001`; `check-ancestry-decisions.sh` cannot see `Refs.contains` consumers. Split `hasMergedPr` into a host answer and a containment answer, and name the local-ref exception in CLAUDE.md.
- connectors: read `MERGED` rows from the PR index first (*A Decision Reads The Index*); the two runs agree on indexed branches and the 56 per-branch host calls drop.
- operator: `git update-ref -d <ref> <old>` deletes a branch checked out in a worktree (exit 0); keep the checked-out refusal. fleetd runs `--sweep-temp --yes` hourly, so any "`--yes` needs a record" rule leaves `--sweep-temp` alone. `skills/plot/scripts/README.md:49` ("Branches and refs are untouched") is false. No per-branch `--only` flag: removing rows from the record narrows a run.
- safety: the record carries the repository identity, the default branch SHA and a timestamp, and covers worktrees, branches and claims.

## Shared blind spot

All four reproduced on single-user sandboxes. None considered a second reaper — fleetd's hourly `--sweep-temp --yes`, or another operator — running between the dry run and `--yes`.

## Amendments the panel asks for

- Rewrite the causes: the cascade, the fetch drift, the reason text for `unknown`, the tip-after-merge loss; drop the rate-limit-makes-merged theory and the counter theory.
- Slices, recoverability first: reaped refs and restore commands at all three sites; `unknown`/`throttled` as its own reading and reason; the tip-versus-merged-head guard on the branch kind; `--yes` on a recorded plan intersected with a fresh local check, with the cascade shown in the dry run; optionally the PR-index read and the ancestry split.
