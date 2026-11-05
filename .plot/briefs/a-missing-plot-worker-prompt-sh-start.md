## Implementation brief — a-missing-plot-worker-prompt-sh (wave 1: Refuse at start)

- **Plan (canonical):** docs/plans/2026-11-04-a-missing-plot-worker-prompt-sh.md on main
- **Approved:** 2026-11-05, Jan Wloka, plan-PR #3131 merged
- **Branch:** `feature/a-missing-plot-worker-prompt-sh-start` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `Review: pr` — Plot's review app and CI, per the repo's convention

Wave 2 (`feature/a-missing-plot-worker-prompt-sh-line`) waits on this branch. It touches the worker loop and `agent-loop.ts`, not the files below.

### What to build

A repository with `Worker command` set and no `.plot/worker-prompt.sh` failed both approved slices on issue #2529 with `the command exited 1 without the agent doing any work`, three attempts each, and left each slice claimed with no agent. `/plot-fleet --start` passed beforehand, because nothing in the start path asks whether the prompt file exists. The fix is a refusal at start, before any desk is cut and before any agent can take a claim.

`startCommand` (`packages/domain/src/rules/start-command.ts:54`) takes a required fourth parameter, a prompt reading passed as a value: `{ runner: 'command' | 'sdk'; resolution: PromptResolution; present: boolean }`. The rule answers `refused` for a command that runs the loop on the `command` runner when `resolution.resolve === 'refused'` or `present` is false. The `sdk` runner answers `run` whatever `present` says. The entry `packages/board/src/server/entry/start-command.ts` (shipped as `plot-start-command.mjs`) builds the reading: it takes the repo root and the `Agent runner` value as two more arguments, reads `PLOT_AGENT` from its environment, and uses `readCharter`/`charterPath`, `resolvePrompt`, `runnerChoice` and `existsSync`. `ask_start_command` in `plot-dispatch.sh` (`:1010-1033`) passes the two new arguments on its existing lines. The plan's *Approach* item 1 holds the rule's full order and the exact why and repair texts; the plan is canonical, this is orientation.

### Settled decisions — do not re-derive

- **Do not read `plot-install-prompt.sh --check`.** Its exit 3 covers `absent`, `stale`, `present` and `settings-unread` alike (`plot-install-prompt.sh:62-66`, `:93-94`, `:103-109`), and `present` is not a fault. Read the file `resolvePrompt` names, never a fixed path: a declared charter has its own prompt.
- **The domain reads no file.** The reading is a value; the entry does the `existsSync`. The layering rule in CLAUDE.md applies.
- **Refuse, not warn.** The agent cannot run at all, and a warning gives a gate nothing to hold.
- **The `sdk` runner is not refused.** `runnerDeps` falls back to `templates/worker-prompt.md` for `sdk` only (`worker-loop.ts:2181-2190`); the `command` runner sources the resolved file (`:1545-1547`). Map a `refused` runner to `command` as `runnerDeps` does (`:2176`).
- **The root is the main checkout** (`$repo_root`, the root `plot-dispatch.sh` already passes to `plot-prompt.mjs --launch`, `:934`).
- **Leave the footer and hint alone.** The footer word stays `worker=no-loop` and the `--restart` hint at `:2333` stays, because the performer matches the word (`performer-shell.ts:103`). #3141 tracks both.
- **`plot-fleetctl.sh` does not change.** Plans #3113 and #3128 change it. `--restart` and slug dispatch need no change in this wave.
- **A stale file is a present file.** The rule reads existence only.

### Done when

The plan's `## Tests` section, *Slice 1 tests*, is the specification, and `## Changelog` bullet 1 is the behaviour. Assertions that exist because a naive implementation would pass without them:

- The dispatch test asserts no worktree under the desk root and no `refs/plot/` claim ref on the sandbox origin. A rule test alone passes even when the refusal runs after the desk is cut.
- The `sdk`-runner case with `present: false` answers `run`. It catches an implementation that refuses on `present` alone.
- The existing `startCommand` cases pass a present `command` reading and keep their answers. It catches a changed default.
- The entry test is new, because no test imports `entry/start-command.ts` today. It covers exit 3 with two lines on an absent file, `run\t…` on a present file, and `run\t…` with `Agent runner` `sdk`.

Plus: the entry is a shipped bundle, so run `./scripts/check-entry-exit.sh` and `./scripts/check-bundle-resolution.sh`, and do not commit a rebuilt generated bundle. Add a changeset with the description first and the `bumps:` block last, naming `plot-dispatch` (and `plot-fleet` if its text changes). For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice edits `plot-dispatch.sh`: the plan adds the two arguments to existing lines for zero net lines. Joining statements with `;` or `&&` is not a payment. The gate stores no number and has no override. Run `./scripts/check-shell-lines.sh pr`.

New functions are arrows (`export const f = (…) => …`). TSDoc states what an export does, its parameters, its return and its failure, with no history.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Do not run `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/start-command.ts`, its test, `packages/board/src/server/entry/start-command.ts`, the new entry test, `skills/plot/scripts/plot-dispatch.sh` (`ask_start_command` only), `test/reconcile/dispatch.test.mjs`, and the changeset. The sibling branch `feature/a-missing-plot-worker-prompt-sh-line` owns `worker-loop.ts`, `prompt-exit.ts` and `agent-loop.ts`. Plans #3113 and #3128 change `plot-fleetctl.sh`; stay out of it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
