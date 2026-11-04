# Safety juror: the-shell-lines-gate-missing-from

Lens: what can this change stop, delete, merge, overwrite or misreport, on this checkout, another checkout or the host, and does every uncertain case end in a named refusal rather than a guess?

Position: amend

## Findings

1. The plan misstates who runs the command. Plan line 32 says "`plot-local-checks.mjs` prints the command and runs nothing; the agent running it fetches first, as CI does". On `origin/main` (`fbf670eaf`) the fleet worker loop runs every printed command itself, unattended, with no fetch: `packages/fleet/src/server/entry/worker-loop.ts:1415` (`localChecksRunner`) runs `plot-local-checks.mjs`, then `bash -c <command>` for each printed line, in the desk worktree, bounded by `boundSeconds`. `packages/domain/src/adapters/agent-run/agent-run-sdk.ts:70` tells the agent "do not run them yourself". So the actor that meets the new gate first is the loop, not an agent that fetches. The "fetch first" sentence is a rule nobody in the fleet path follows.

2. The missing fetch does not make the change unsafe, and the plan should say why instead of relying on a fetch. `scripts/check-shell-lines.sh` (pr mode, lines 135-144 on origin/main) reads only: `git rev-parse`, `git merge-base`, `git show`, `git ls-tree`, `git diff`, `git rev-list -n 300`. It writes no file, no ref and nothing on the host. An absent `origin/main` ends in a named refusal: "`$ref` is absent, so there is no base to compare with. Run: git fetch --no-tags origin main:refs/remotes/origin/main". A missing merge base ends in "no merge base between HEAD and `$ref`". `check-decision-count.sh pr`, already in the same `**` chain, has the same base dependency (`scripts/check-decision-count.sh:209-211`) and the loop already runs it, so the new entry adds no new failure class. Desk worktrees share refs with the main checkout, so a desk's fork point is reachable from the local `origin/main`.

3. One uncertain case does not end in a named refusal: a stale local `origin/main` whose merge base with HEAD predates shell growth that landed on `main` by a direct push (push mode reports and does not refuse, `check-shell-lines.sh` header). The gate then charges that growth to the branch and tells the agent to "remove at least N lines of shell elsewhere in this same change". An unattended Sonnet agent can act on that message by deleting shell it did not write. The likelihood is low (a direct push that grew shell, plus a branch whose fork point is newer than the local ref), and CI with a fresh fetch would not refuse. The refusal names the merge-base sha, so a reader can tell; the agent may not. This is the one overwrite risk the change introduces, and it is bounded by review of the resulting PR.

4. No host write, merge, stop or delete is reachable from this change. The edit touches one `CLAUDE.md` config line and its `AGENTS.md` mirror. CI selection (`ci.yml:69-71`, `plot-local-checks.mjs --ci`) reads the same key; an extra `**` gate command does not change the job map, which reads only the selected non-`always` checks, and `check-decision-count.sh pr` is the precedent of a `**` gate with an argument. No test reads this repo's literal `Local checks` value (`git grep` over `test`, `packages`, `scripts` finds `check-entry-exit.sh` only in its own contract test, which names the script by path).

5. Claims checked. The `**` entry holds 15 `scripts/check-*.sh` gates and no `check-shell-lines.sh`: true on `fbf670eaf` as on `e54e53815`. CI runs `./scripts/check-shell-lines.sh pr` after "Fetch the default branch the shell count reads" (`ci.yml:1503-1511`): true. The open question swaps two line numbers: `ci.yml:1060` runs `check-sprint-members.sh` and `ci.yml:1681` runs `check-plan-routes.sh`, not the reverse.

## Amendments required

- Replace the sentence at plan line 32 with the fact: the fleet worker loop (`worker-loop.ts:1415`, `localChecksRunner`) runs the printed command in the desk worktree with no fetch; the gate reads the shared local `origin/main`, refuses by name when it is absent, and has the same base dependency as `check-decision-count.sh pr`, which the loop already runs.
- Name the stale-ref case (finding 3) under Design and state its handling: a refusal from a local run whose merge base predates the branch's fork point is a stale ref, and the agent fetches and reruns rather than removing shell to pay. Put that instruction where the loop's agent reads a failed check (the hand-back), or accept it as a known residual and say so in the plan.
- Fix the swapped line numbers in the first open question.

## Decisions for a person

- Whether the two other CI-only gates (`check-plan-routes.sh`, `check-sprint-members.sh`) join the entry. Each one that joins runs unattended in every desk via the loop, so each needs the same read-only and named-refusal check this verdict made for `check-shell-lines.sh`.

## Ran versus read

Ran (read-only): `git fetch -q origin main`; `git show`/`git grep` over `origin/main` for `scripts/check-shell-lines.sh`, `scripts/check-decision-count.sh`, `scripts/check-agents-md.sh`, `.github/workflows/ci.yml`, `CLAUDE.md`, `packages/fleet/src/server/entry/worker-loop.ts`, `packages/domain/src/rules/local-checks-run.ts`; `gh issue view 3120`; `gh pr view 3130`. Read only, not executed: the gate itself and the worker loop. No test suite, fleet, board or host write was run.
