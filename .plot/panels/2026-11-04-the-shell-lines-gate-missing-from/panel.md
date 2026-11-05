# Panel moderation: the-shell-lines-gate-missing-from

Positions: layering amend, safety amend, seams amend, testability amend. Unanimous amend. Moderated 2026-11-04 against `origin/main` at `fbf670eaf`; the amendment is round 1.

## Agreements

- All four confirm the defect: the `**` entry of `Local checks` lists 15 `scripts/check-*.sh` gates and omits `check-shell-lines.sh`. Re-measured by the moderator: CI runs 20 distinct gates.
- Layering and testability count five absent gates, not three: `check-shell-lines.sh`, `check-plan-routes.sh`, `check-sprint-members.sh`, `check-helper-table.sh`, `check-no-bundle-diff.sh`. Re-measured: true.
- Safety and seams find the plan's central claim false: `plot-local-checks.mjs` prints, but the fleet worker loop runs every printed command itself, with no fetch (`worker-loop.ts:1415`, `localChecksRunner`; `agent-run-sdk.ts:70`). Re-read: true.
- Layering and testability both propose a parity test with a declared exception list, citing `check-host-cli-callers.sh` as the shape.
- Every juror leaves the plan's two Open Questions to a person.

## Disagreements

- **The line numbers.** Layering says the plan's `ci.yml` 1060 and 1681 are correct. Safety and testability say they are swapped. Re-read: `ci.yml:1060` runs `check-sprint-members.sh` and `:1681` runs `check-plan-routes.sh`; the plan's sentence paired them in the reverse order. Layering read the numbers and not the pairing. Safety and testability are right.
- **The stale-ref case.** Seams says a stale `origin/main` gives "an older but valid base, so no false refusal follows". Safety says it can charge the branch with growth `main` gained after the stale ref, and an unattended agent may then delete shell it did not write. The moderator sides with safety on the mechanism and with seams on the likelihood: pull requests cannot grow the count, so only a direct push to `main` that grew shell, or an exact revert, puts growth in that range. The plan handles it by refusal text (Design step 3), not by declaring it impossible.
- **Whether the drift test belongs here.** Layering and testability want it in this plan or a named follow-up. Seams argues for a separate plan, because intent is not greppable. The caller settled it: in scope. The declared `CI_ONLY` map answers the seams objection, because the map records intent and the test only checks it is recorded.
- **Which gates join.** Testability names `check-no-bundle-diff.sh` as a CI-only candidate. Safety asks for a read-only and named-refusal check per gate before any joins. The caller settled it: all five join. The moderator ran all five in the worktree; each exits 0, writes nothing and reaches no host. `check-sprint-members.sh` fails closed with git's own error, not a named refusal, when `origin/main` is absent: filed as #3143.

## Shared blind spots

- No juror named the attended path's commit-first gap together with the fleet path's existing commit-first contract. Testability found that `pr` mode measures `HEAD`; none noted that `HAND_BACK_PROTOCOL` already defines `next: checks` as "you committed work", so only the attended `CLAUDE.md` sentence needs the change.
- No juror checked the remaining four gates for the same base dependency. `check-no-bundle-diff.sh` and `check-sprint-members.sh` also read `origin/main` through a merge base.
- No juror asked whether the gate order matters for cost. The chain stops at the first failure, so the 20 s gate goes last.
- Seams found the `Sprint:` field without a sprint line (seams finding 7); no other juror checked it. It is not fixed in this commit, which carries only the plan and the panel directory.

## Ran versus read

| Juror | Ran | Read only |
|---|---|---|
| layering | `git fetch`, `git show`/`git grep` over `origin/main`, gate-set counts by grep, `gh issue view 3120` | the plan, the brief |
| safety | `git fetch`, `git show`/`git grep` over the gate, `ci.yml`, `CLAUDE.md`, `worker-loop.ts`, `local-checks-run.ts`; `gh issue view`, `gh pr view` | the gate and the worker loop, never executed |
| seams | `git fetch`, `gh pr list`, `gh pr diff --name-only` over 14 open PRs, a remote-branch diff loop, `./scripts/check-shell-lines.sh pr` once (24.0 s wall) | `check-shell-lines.sh`, `ci.yml`, `local-checks.ts`, `worker-loop.ts`, `verify.ts`, two sibling plans |
| testability | `git fetch`, `git show` reads, gate-set count by `grep -o`, `git grep` for tests pinning `Local checks` | the plan, the brief |
| moderator | `git fetch`, `grep` of `ci.yml` run lines, the five absent gates in the worktree (all exit 0; shell-lines 18.8 s wall), `gh issue view 3120`, `gh pr view 3130` | `worker-loop.ts`, `agent-run-sdk.ts`, `check-shell-lines.sh`, `check-sprint-members.sh`, `check-no-bundle-diff.sh` |

## Decisions

| Decision | By |
|---|---|
| All five absent gates join the `**` entry; the CI-only list starts empty | caller |
| The drift test `test/reconcile/local-checks-coverage-gate.test.mjs` is in this slice | caller |
| Correct the fleet-path claim, state the measured cost, fix the swapped line numbers | caller |
| The stale-ref case gets a line in the shell-lines refusal, not a fetch in `localChecksRunner`: smaller, no network call per pass | caller offered both; moderator chose |
| Commit-first sentence in the `CLAUDE.md` Testing paragraph; CI `select` unchanged | caller |
| Gate order: cheapest first, `check-shell-lines.sh pr` last | moderator; reversible |
| The drift test also fails on a stale `CI_ONLY` entry | moderator; keeps the map from going stale |
| No changeset: no skill or package bumps | moderator; reversible |
| `check-sprint-members.sh` named refusal out of scope, filed as #3143 | moderator |
| Sprint line for `follow-ups-2-30-1` left to the sprint owner on `main` | moderator; this commit carries only the plan and the panel |
