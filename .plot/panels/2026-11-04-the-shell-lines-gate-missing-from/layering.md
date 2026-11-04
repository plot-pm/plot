# Layering juror — the-shell-lines-gate-missing-from

Position: amend

## Lens result

The change is layering-clean. It edits one `## Plot Config` value in `CLAUDE.md` and regenerates `AGENTS.md`. It adds no shell under `skills/`, so the shell-lines ratchet does not move. The rule that decides which checks apply stays in the domain (`packages/domain/src/rules/local-checks.ts`, `parseLocalChecks` and the glob match); `packages/board/src/server/entry/local-checks.ts:211` only reads the key through `scripts.config`. No controller, port or index read changes. No lifecycle action is involved.

## Findings

1. The defect is real and the plan fixes it. On `origin/main` at `fbf670eaf` the `**` entry still lists 15 gates and no `check-shell-lines.sh`; `ci.yml:1506-1511` runs `./scripts/check-shell-lines.sh pr` on a pull request. A reader verifies the fix by running `node skills/plot/scripts/board/plot-local-checks.mjs` on a branch with any change and seeing `./scripts/check-shell-lines.sh pr` in the printed `**` command.
2. The plan's count of the drift is incomplete. CI runs 20 distinct `scripts/check-*.sh` gates. `Local checks` lists 15. Five are absent, not three: `check-shell-lines.sh`, `check-plan-routes.sh` (`ci.yml:1681`), `check-sprint-members.sh` (`ci.yml:1060`), `check-helper-table.sh` (`ci.yml:1696`) and `check-no-bundle-diff.sh` (`ci.yml:1041`). The Open Question names only the first two of the other four.
3. The line numbers the plan cites (`ci.yml` 1060 and 1681) are correct.
4. The fetch claim is true and ends in a named refusal: `check-shell-lines.sh:137` fails with "<ref> is absent ... Run: git fetch --no-tags origin main:refs/remotes/origin/main" when the default ref is missing. A stale `origin/main` gives an older merge base and a larger range, which errs toward refusal, not toward a silent pass.
5. Open Question 2 is the layering point that matters. The plan leaves the list as a rule ("a grep cannot tell a CI-only gate by intent from an omission"). That is the same shape `check-host-cli-callers.sh` already solved: a gate with a declared exception list where each entry names its reason. A gate that compares the `check-*.sh` set in `ci.yml` with the set in `Local checks`, minus a declared CI-only list, holds the drift. Without it this plan repairs one instance and the next new gate repeats #3120.
6. The slice carries no test. That is acceptable for a config-only change only if finding 5 is answered; otherwise nothing fails before the change and passes after.

## Amendments required

- A. Close Open Question 1 before approval, and name all four other absent gates (`check-plan-routes.sh`, `check-sprint-members.sh`, `check-helper-table.sh`, `check-no-bundle-diff.sh`). For each, either add it to the `**` entry or state why it is CI-only.
- B. Close Open Question 2 with a decision. Recommended: add a slice (or a follow-up issue named in Notes) for a `scripts/check-local-checks-coverage.sh` gate that diffs the `ci.yml` gate set against `Local checks` with a declared exception list, plus a contract test that fails on today's `origin/main` and passes after slice 1.
- C. State the verification command (finding 1) in the plan, so the unattended agent proves the printed output rather than only the edit.

## Decisions that need a person

- Whether `check-no-bundle-diff.sh` and `check-sprint-members.sh` are CI-only by intent. An unattended agent cannot infer intent from `ci.yml`.
- Whether the coverage gate in amendment B joins this plan or becomes its own plan.

## What I ran versus read

Ran (read-only): `git fetch origin main`, `git rev-parse origin/main`, `git show`/`git grep` over `origin/main` for `ci.yml`, `CLAUDE.md`, `scripts/check-shell-lines.sh`, `packages/domain/src/rules/local-checks.ts`, `packages/board/src/server/entry/local-checks.ts`; `gh issue view 3120`. Counted the gate sets with grep. Read only: the plan file and the juror brief. Ran no test suite, no gate script, no host write.
