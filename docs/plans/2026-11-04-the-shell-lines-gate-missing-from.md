# The shell-lines gate missing from the Local checks list

> CI runs 20 `scripts/check-*.sh` gates and the `**` entries of `Local checks` list 15, so an agent or fleet loop that runs what `plot-local-checks.mjs` prints meets five refusals one CI round trip later, and nothing stops the list drifting again.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** follow-ups-2-30-1
- **Issue:** #3120
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-04, Jan Wloka, plan-PR #3130 merged
- **Started:** 2026-11-04, Jan Wloka, `feature/the-shell-lines-gate-missing-from`

## Changelog

- `plot-local-checks.mjs` prints every `scripts/check-*.sh` gate CI runs, including `./scripts/check-shell-lines.sh pr`, so a local run refuses what CI refuses.
- A gate test fails when CI runs a `scripts/check-*.sh` gate that `Local checks` does not list and no declared CI-only entry names.
- The shell-lines refusal tells the reader to fetch the default branch and re-run before removing any shell.

<!-- Board impact: none. The change edits one `Local checks` value and one Testing sentence in the repo `CLAUDE.md` and its `AGENTS.md` mirror, one refusal message in `scripts/check-shell-lines.sh` (under `scripts/`, not shipped, not counted by the gate), and two tests under `test/reconcile/`. It does not touch the plan format, the template, skills/plot/scripts/, packages/ or the docs/plans layout. The board reads `Local checks` through `packages/board/src/server/entry/local-checks.ts` and prints a longer `**` command; the value's format does not change. -->

## Motivation

On `origin/main` at `fbf670eaf`, `.github/workflows/ci.yml` runs 20 distinct `scripts/check-*.sh` gates. The `**` entries of `Local checks` in `CLAUDE.md` list 15. Five are absent:

| Gate | `ci.yml` line | Runs on |
|---|---|---|
| `check-no-bundle-diff.sh` | 1041 | pull request |
| `check-sprint-members.sh` | 1060 | pull request |
| `check-shell-lines.sh pr` | 1511 (after the fetch at 1504) | pull request (`push` mode on a push to `main`) |
| `check-plan-routes.sh` | 1681 | every event |
| `check-helper-table.sh` | 1696 | every event |

`node skills/plot/scripts/board/plot-local-checks.mjs` reads that key. Two callers run what it prints: an agent before a push, as the Testing section of `CLAUDE.md` instructs, and the fleet worker loop. The loop is the main consumer: `localChecksRunner` (`packages/fleet/src/server/entry/worker-loop.ts:1415`) runs `plot-local-checks.mjs` in the desk worktree and then runs each printed command through `boundedRun`, in order, until one fails, with no fetch of `origin/<default>` (the loop fetches only the branch's own remote head, `worker-loop.ts:1142`). `HAND_BACK_PROTOCOL` (`packages/domain/src/adapters/agent-run/agent-run-sdk.ts:70`) tells the agent "do not run them yourself". So a fleet agent passes its local checks, pushes, and learns of any of the five refusals from CI. The layering juror of the panel on `plot-fleetctl-stop-ignores-dry-run` found the shell-lines omission (#3099).

## Design

### Approach

1. **The five gates join the `**` entry.** Append them to the `&&` chain of the second `**` entry of `Local checks` in `CLAUDE.md`, in this order: `./scripts/check-plan-routes.sh && ./scripts/check-helper-table.sh && ./scripts/check-no-bundle-diff.sh && ./scripts/check-sprint-members.sh && ./scripts/check-shell-lines.sh pr`. Then run `./scripts/check-agents-md.sh --write` so `AGENTS.md` matches. Each takes the arguments CI gives it on a pull request; none needs a CI-only input:
   - `check-plan-routes.sh` and `check-helper-table.sh` read the working tree only.
   - `check-no-bundle-diff.sh` diffs `HEAD` against `git merge-base HEAD origin/main` (its default `BASE_REF`).
   - `check-sprint-members.sh` runs the tracked bundle `skills/plot/scripts/board/plot-sprint-member.mjs` against `git merge-base origin/main HEAD`. The bundle is committed on `main`, so a desk worktree holds it without a build.
   - `check-shell-lines.sh pr` counts shell under `skills/` at `HEAD` and at `git merge-base HEAD origin/<default>`.
   - All five write nothing and reach no host. Measured on 2026-11-04 in a worktree at `ad4d08b62`: all five exit 0; `check-shell-lines.sh pr` took 18.8 s wall (1.2 s user), and the seams juror measured 24.0 s under load; `check-sprint-members.sh` took 4 s; the other three take 1 s or less. Every `checks` pass of every fleet agent pays about 25 s more. The plan accepts that cost: one avoided CI round trip costs more.
   - The CI-only list in the drift test (step 2) is therefore empty when this slice lands. It exists so that the next gate CI adds without a local run must be declared, with its reason.

2. **A drift test holds the list.** `test/reconcile/local-checks-coverage-gate.test.mjs` reads `.github/workflows/ci.yml` and the `Local checks` value in the repo-root `CLAUDE.md` from the working tree. It collects the basename of every `scripts/check-*.sh` that a `run:` line of `ci.yml` invokes (YAML comment lines excluded), and the basename of every `scripts/check-*.sh` named in any `Local checks` entry. It fails, naming each gate, when a CI gate is neither in `Local checks` nor in a `CI_ONLY` map declared at the top of the test, where each entry maps a basename to a non-empty reason string. It also fails when a `CI_ONLY` entry names a gate CI does not run, or a gate that `Local checks` already lists, so the map cannot go stale. It compares script names, not arguments, because `check-shell-lines.sh` and `check-decision-count.sh` take `push <sha>` on a push to `main` and `pr` locally. It is a pure file read: no spawn, no host, no fleet, no port. Its name matches `test/reconcile/*gate*.test.mjs`, so the existing first `**` entry runs it on every change, and CI's `node --test test/reconcile/*.test.mjs` suite runs it too. It fails on `origin/main` today (five gates undeclared) and passes after step 1.

3. **The shell-lines refusal names the stale-ref case.** The loop runs the gate against the desk's local `origin/<default>`, which can be stale. A stale ref gives an older merge base; the gate then charges the branch with any shell growth that reached `main` between that base and the branch's fork point. Pull requests cannot grow the count, so only a direct push to `main` that grew shell (push mode reports and does not refuse) or an exact revert can cause it. The refusal then tells the reader to "remove at least N lines of shell", and an unattended agent may delete shell it did not write. Fix: `report()` in `scripts/check-shell-lines.sh` prints one more line, before the two payment options: `  First run: git fetch --no-tags origin <default> and re-run this gate. A stale <ref> charges this change for shell that main gained after <merge base>; pay only for growth that remains.` (the message names the actual ref and merge-base sha). This is the smaller of the two changes the caller offered: it edits one message in `scripts/` (not counted by the gate, no TypeScript, no network call per pass), where a fetch in `localChecksRunner` would add a network call and a failure mode to every `checks` pass of every agent. An absent `origin/<default>` already ends in the gate's named refusal (`check-shell-lines.sh`, pr mode: "`<ref>` is absent, so there is no base to compare with. Run: git fetch --no-tags origin main:refs/remotes/origin/main"). `check-decision-count.sh pr`, already in the same chain, has the same base dependency, and the chain stops at its refusal first.

4. **Commit before the checks.** `check-shell-lines.sh pr`, `check-no-bundle-diff.sh` and `check-sprint-members.sh` measure `HEAD`, not the working tree, so uncommitted shell growth passes locally. The fleet path already commits first: `HAND_BACK_PROTOCOL` defines `next: checks` as "you committed work". For the attended path, the Testing paragraph of `CLAUDE.md` changes "Before each push, run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints" to "Before each push, commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints". `./scripts/check-agents-md.sh --write` regenerates the mirror once for both `CLAUDE.md` edits.

5. **CI selection does not change.** CI's `select` job (`ci.yml:69-71`, `:166`) runs `plot-local-checks.mjs --ci`, which calls `ciSelection` (`packages/domain/src/rules/local-checks.ts`). A check with no placeholder is `always`, and the job map drops `always` checks (`ci.yml:190`, `select(.always | not)`). The longer `**` entry therefore selects no new CI job, and CI does not run any gate twice.

No changeset: the change bumps no skill and no package. The decision is reversible by adding one.

### Decisions

- All five absent gates join the `**` entry; the `CI_ONLY` map starts empty. Decided by the caller.
- The drift test is in scope, in the same slice. Decided by the caller.
- The stale-ref case is handled by refusal text, not by a fetch in the loop. The caller offered both and asked for the smaller; the amendment author chose the refusal text (step 3, reason given there).
- Gate order in the chain: the five run after `check-entry-exit.sh`, cheapest first and `check-shell-lines.sh pr` last, so a cheap refusal stops the chain before the 20 s gate. Taken by the amendment author; reversible by reordering.
- `check-sprint-members.sh` prints git's own error, not a named refusal, when `origin/main` is absent. It fails closed, and `check-decision-count.sh pr` earlier in the chain refuses by name first. The named refusal is filed as #3143 and stays out of this slice.

## Slices

### Local checks entry

- `feature/the-shell-lines-gate-missing-from` — add the five CI gates to the `**` entry of `Local checks`, add the commit-first sentence, regenerate `AGENTS.md`, add the drift test, and add the stale-ref line to the shell-lines refusal

Files this slice touches, and no others:

- `CLAUDE.md` — the `Local checks` value (step 1) and the Testing sentence (step 4)
- `AGENTS.md` — regenerated by `./scripts/check-agents-md.sh --write`, never edited by hand
- `scripts/check-shell-lines.sh` — one added `echo` line in `report()` (step 3)
- `test/reconcile/local-checks-coverage-gate.test.mjs` — new (step 2)
- `test/reconcile/shell-lines.test.mjs` — one new test (below)

Tests that fail before the change and pass after:

- `test/reconcile/local-checks-coverage-gate.test.mjs`, test `every CI check-*.sh gate is in Local checks or declared CI-only` — fails on `fbf670eaf` naming the five gates; passes after step 1.
- `test/reconcile/local-checks-coverage-gate.test.mjs`, test `a CI_ONLY entry names a gate CI runs and Local checks omits, with a reason` — passes with the empty map; a mutation check adds a stale entry and sees it fail, then removes it.
- `test/reconcile/shell-lines.test.mjs`, test `pr: a growth refusal tells the reader to fetch the default branch and re-run first` — reuses the fixture of `pr: growth over the merge base fails and states the offset rule`, asserts stderr contains `git fetch --no-tags origin` and `re-run this gate` before `remove at least`; fails before step 3, passes after.

Gates to run before the push, in the slice worktree, after committing:

- `node skills/plot/scripts/board/plot-local-checks.mjs`, and every command it prints. Verify the printed second `**` command ends in `./scripts/check-shell-lines.sh pr` and names all five added gates.
- `node --test test/reconcile/local-checks-coverage-gate.test.mjs test/reconcile/shell-lines.test.mjs`
- `./scripts/check-agents-md.sh` exits 0.

## Notes

- Raised by issue #3120; refs #3099.
- Panel moderation: `.plot/panels/2026-11-04-the-shell-lines-gate-missing-from/panel.md`.
- Follow-up filed: #3143 (named refusal for `check-sprint-members.sh` without `origin/main`).
- `docs/plans/2026-11-04-plot-fleetctl-stop-ignores-dry-run.md:113` lists `./scripts/check-shell-lines.sh pr` by hand and cites #3120. After this plan lands, that line runs the gate a second time; the cost is time only.
- `docs/sprints/2026-W45-follow-ups-2-30-1.md` on `origin/main` at `fbf670eaf` does not name this plan, while the `Sprint:` field does. The sprint line belongs in a commit on `main` by the sprint's owner.
