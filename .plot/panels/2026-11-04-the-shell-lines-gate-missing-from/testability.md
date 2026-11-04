# Testability juror: the-shell-lines-gate-missing-from

Position: amend

Lens: is every behaviour asserted on a domain property or a script contract without a browser, does each named test fail before the change and pass after, and can the test run without touching the operator's real fleet, launchd or port 7777?

## Findings

1. **The plan names no test at all.** The Slices section and the Design section give one edit and one regeneration command. No test fails before the change and passes after it. The only signal is CI's refusal on a future pull request that grows the shell, which is the round trip the plan exists to remove. Under this lens that is the main gap.

2. **The drift the plan fixes is wider than the plan says, and a test would have shown it.** `.github/workflows/ci.yml` on `origin/main` (`fbf670eaf`) runs 20 distinct `scripts/check-*.sh` gates. The `**` entry of `Local checks` in `CLAUDE.md` lists 15. Five are absent, not three: `check-helper-table.sh`, `check-no-bundle-diff.sh`, `check-plan-routes.sh`, `check-shell-lines.sh`, `check-sprint-members.sh`. The plan's Open Question names only plan-routes and sprint-members.

3. **The plan's CI line numbers are swapped.** `ci.yml:1060` runs `check-sprint-members.sh` and `ci.yml:1681` runs `check-plan-routes.sh`. The plan states the reverse (plan line 36).

4. **The measurement commit is stale.** The plan measures at `e54e53815`; `origin/main` reads `fbf670eaf` now. The 15-gate count still holds there.

5. **Open Question 2 has a testable answer, and it is cheap.** The objection "a grep cannot tell a CI-only gate by intent from an omission" holds only for a grep with no declared list. `scripts/check-host-cli-callers.sh` already solves the same shape: an exception list where each entry carries its reason. A parity test with a declared CI-only list makes intent explicit and makes an undeclared omission fail.

6. **Such a test is a pure file read.** It reads `.github/workflows/ci.yml` and the `CLAUDE.md` `## Plot Config` text from the working tree, or parses `Local checks` through `parseLocalChecks` in `packages/domain/src/rules/local-checks.ts`. It spawns no worker, calls no host, touches no launchd job and binds no port. Named `test/reconcile/<name>-gate.test.mjs`, it matches the existing `** = node --test test/reconcile/*gate*.test.mjs` entry, so `plot-local-checks.mjs` prints it for every change, and CI's reconcile glob runs it.

7. **`check-shell-lines.sh pr` itself is safe to run locally.** It reads git trees through `git merge-base HEAD origin/<default>` and awk (`scripts/check-shell-lines.sh:27`, `:85-159`); it writes nothing and reaches no host. Its contract is already covered by `test/reconcile/shell-lines.test.mjs`. `check-decision-count.sh pr` already sits in the same chain with the same `origin/<default>` dependency, so the precedent exists.

8. **One behaviour the plan leaves unstated.** `pr` mode compares `HEAD`, not the working tree. An agent that runs the chain before it commits gets a pass on uncommitted shell growth. The plan states "the agent fetches first" but not "commits first".

9. **The mirror is self-testing.** `check-agents-md.sh` sits in the same `**` chain, so a branch that edits `CLAUDE.md` and skips `--write` fails its own local run. That part needs no new test.

## Amendments required

A1. Add one slice deliverable: a parity test, for example `test/reconcile/local-checks-parity-gate.test.mjs`. It collects every `scripts/check-*.sh` named in `.github/workflows/ci.yml`, collects every command in the `**` entries of `Local checks` in `CLAUDE.md`, and asserts that each CI gate appears locally or in a CI-only list inside the test, where each entry names its reason. It fails on `origin/main` today (shell-lines absent and undeclared) and passes after the change. It runs with no fleet, no launchd and no port.

A2. Correct the Motivation and the Open Question: five gates are absent, list all five, and fix the swapped line numbers (sprint-members `ci.yml:1060`, plan-routes `ci.yml:1681`). Re-measure at the current `origin/main`.

A3. Name the verification in the plan: on the branch, `node skills/plot/scripts/board/plot-local-checks.mjs` prints `./scripts/check-shell-lines.sh pr`, and `./scripts/check-shell-lines.sh pr` and `./scripts/check-agents-md.sh` both exit 0.

A4. State in the Approach that `check-shell-lines.sh pr` measures `HEAD`, so the agent commits before it runs the printed chain.

## Decisions that need a person

- Which of the other four absent gates join `Local checks` and which go on the parity test's CI-only list. Candidates for CI-only: `check-no-bundle-diff.sh` (the bundle is built on main after merge). This is a judgement about cost and intent, and the test only records it. The agent must not choose it alone; the plan must list the answer before approval, or default every one to CI-only with the reason "not yet decided, see #3120".

## What I ran versus what I only read

Ran: `git fetch origin main`; `git show origin/main:` reads of `.github/workflows/ci.yml`, `CLAUDE.md`, `scripts/check-shell-lines.sh`, `packages/domain/test/ci-selection.test.ts`, `test/reconcile/ci-suite-gate.test.mjs`; a `grep -o` over `ci.yml` and the `Local checks` line to count gates (20 against 15); `git grep` for tests that pin `Local checks` or name `check-shell-lines.sh`; `gh issue view 3120`.

Only read: the plan and the juror brief. I ran no test suite and no gate script.
