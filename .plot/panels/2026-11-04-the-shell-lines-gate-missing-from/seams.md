# Seams juror: the-shell-lines-gate-missing-from

Position: amend

## Summary

The edit is one token in one config line, and no open PR or branch touches that line. The plan misses its largest seam: the fleet worker loop runs every printed command itself, with no fetch, so the change alters what every fleet agent's `checks` hand-back runs. The plan says the opposite ("prints the command and runs nothing; the agent running it fetches first").

## Findings

1. **The fleet runs the list, not only an agent.** `packages/fleet/src/server/entry/worker-loop.ts:1415-1441` (`localChecksRunner`) runs `plot-local-checks.mjs` in the desk worktree and then runs each printed command through `boundedRun`, in order, until one fails. `packages/domain/src/adapters/agent-run/agent-run-sdk.ts:70` tells the SDK agent "do not run them yourself". No step in that path fetches `origin/main` (`worker-loop.ts` fetches only the branch's own remote head, `:1142`). The plan's Approach paragraph is therefore false for the main consumer, and the sprint goal (zero interventions) runs through this consumer.
   - Effect when `refs/remotes/origin/main` is present but stale: the gate compares against an older merge base. That is correct for a branch cut from that ref, so no false refusal follows.
   - Effect when the ref is absent: `check-shell-lines.sh` refuses by name (`... is absent, so there is no base to compare with. Run: git fetch ...`, `scripts/check-shell-lines.sh:139`). This is a named refusal, not a silent pass.
   - Cost: measured here, `./scripts/check-shell-lines.sh pr` took 24.0 s wall, 1.7 s CPU, over 63 `.sh` files under `skills/`. Each `checks` pass of each agent pays it, inside the `**` `&&` chain.
2. **CI reads the same key, and its job map is unchanged.** `ci.yml:69-71` and `:166` run `plot-local-checks.mjs --ci`, which calls `ciSelection` (`packages/domain/src/rules/local-checks.ts:450`). A check with no placeholder is `always`, and the job map drops `always` checks (`ci.yml`, `select(.always | not)`). So the edit selects no new CI job and CI does not run the gate twice. The plan's board-impact comment does not say this; one sentence closes it.
3. **The pinned verifier reads the key too.** `packages/board/src/server/entry/verify.ts:357` needs `plot-local-checks.mjs` in the tools tree at `origin/<main>`. In a pinned tree whose HEAD is an ancestor of `origin/main`, `pr` mode compares HEAD with itself and passes (`check-shell-lines.sh:140-146`). Harmless; `Auto-verify` is false. The same holds on `main` for a docs-only direct push: the local `pr` run passes trivially and CI's `push` mode is the real check.
4. **No conflicting PR or branch.** `gh pr list` (15 open PRs, 2026-11-04): none changes `CLAUDE.md`, `AGENTS.md`, `ci.yml`, `check-shell-lines.sh` or `plot-local-checks`. No remote branch within 40 commits of its merge base changes `CLAUDE.md` or `AGENTS.md`. No ordering constraint follows. The `AGENTS.md` regeneration (`check-agents-md.sh --write`) can conflict only with a later CLAUDE.md edit, which a rebase plus re-run resolves.
5. **Sibling plan overlap, no conflict.** `docs/plans/2026-11-04-plot-fleetctl-stop-ignores-dry-run.md:113` (Approved) lists `./scripts/check-shell-lines.sh pr` by hand and cites #3120. After this plan lands, that line duplicates the list; a double run costs time only. `the-pulse-s-tracer-flag-means.md:94` reads "the `scripts/check-*.sh` list from the `Local checks` key" and touches no shell, so it gains a passing gate.
6. **No declared duplicate, no corpus seam.** The change touches no rule, no shell script and no corpus file. `rules/local-checks.ts` is unchanged, so no bundle rebuild and no `check-no-bundle-diff.sh` concern. No test asserts the exact `**` list (`git grep` of `check-entry-exit.sh` in test/: only `entry-exit-gate.test.mjs`, which tests that gate alone).
7. **Sprint seam.** The plan sets `Sprint: follow-ups-2-30-1`, but `docs/sprints/2026-W45-follow-ups-2-30-1.md` on `origin/main` (fbf670eaf) does not name this plan or #3120, and PR #3130 changes only the plan and its active symlink. The field and the sprint line belong in one commit.
8. **The two other omitted gates.** `ci.yml:1060` runs `check-sprint-members.sh` and `ci.yml:1681` runs `check-plan-routes.sh` on every PR; neither is in `Local checks`. They are the same defect class. Left open, a Sonnet agent cannot decide the Open Questions and will either widen scope or leave them.

## Amendments required

1. Replace the Approach sentence "prints the command and runs nothing; the agent running it fetches first" with the fleet path: `localChecksRunner` runs the list in the desk worktree with no fetch; a stale `origin/main` gives an older but valid base; an absent one ends in the gate's named refusal. State the per-pass cost (about 24 s wall here under load) and that the plan accepts it.
2. Add one sentence: CI's `select` job reads the key, the entry is `always`, and the job map ignores `always` checks, so CI selection does not change.
3. Add the plan to `docs/sprints/2026-W45-follow-ups-2-30-1.md` in the same commit as the `Sprint:` field, or drop the field.
4. Close both Open Questions before approval (see below), so the slice carries no decision.
5. Verification line: after the change, `node skills/plot/scripts/board/plot-local-checks.mjs` prints a `**` command that ends in `./scripts/check-shell-lines.sh pr`, and `./scripts/check-agents-md.sh` passes.

## Decisions that need a person

- Whether `check-plan-routes.sh` and `check-sprint-members.sh` join this slice. My reading: they share the defect and the line, so one slice is cheaper than a second plan editing the same line; but each adds run time to every fleet `checks` pass, which is a person's trade.
- Whether the drift test (Open Question 2) is in scope. It would be a gate over a rule; the plan's own note that intent is not greppable argues for a separate plan.

## Ran versus read

Ran: `git fetch`, `gh issue view 3120`, `gh pr list`, `gh pr diff --name-only` over 14 open PRs, a loop over remote branches diffing `CLAUDE.md`/`AGENTS.md` against their merge base, `git grep` over `ci.yml`, tests, plans and sprints, and `./scripts/check-shell-lines.sh pr` once in the main checkout (timed, read-only).
Read: `scripts/check-shell-lines.sh`, `ci.yml:60-200`, `rules/local-checks.ts:425-480`, `rules/local-checks-run.ts`, `worker-loop.ts:1390-1441`, `verify.ts` (grep), the two sibling plans, the sprint file head.
