## Implementation brief — a-refused-start-is-retried-and-named (wave 4: Probe and loop)

- **Plan (canonical):** `docs/plans/2026-11-21-a-refused-start-is-retried-and-named.md` on `main`
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3614 merged
- **Branch:** `bug/the-probe-and-the-loop-name-the-charter-prompt` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** PR review per repo convention
- **Issue:** #3141 (part b)

Wave 3 (`bug/a-start-refusal-names-its-defect`) merged as #3663 and added `StartCommand.defect`. Wave 5 (`bug/a-red-pr-is-re-run-once-per-head`) waits on this branch only by plan order; it touches other files.

### What to build

A charter can declare its own prompt file. `--start` resolves that file, but the write probe still reads only `FALLBACK_PROMPT` (`packages/domain/src/adapters/write-probe/write-probe-shell.ts:86`). A probe therefore answers `ok` for an agent whose declared prompt is absent or stale, and the worker loop then refuses at its first pass with a text that does not name the charter. Two readers of one prompt, two answers.

The change has four parts, all in the existing code:

1. **`promptAbsentRepair(resolution)`** in `packages/domain/src/rules/start-command.ts`. For a `declared` resolution it answers `write <file>, which charter '<name>' names`. For a `fallback` one it answers `run plot-install-prompt.sh to write .plot/worker-prompt.sh from the template`. `missingPrompt` (now `:111`) and the loop's absent-file refusal (`packages/fleet/src/server/entry/worker-loop.ts`, the `the prompt file ${file} is absent` text near `:1719`) both call it. One unit test then holds both texts.
2. **`WriteProbe.check` takes the prompts to probe**: `{ file: string; charter: string | null }[]`, or a refusal reason. It probes each distinct file in place of `FALLBACK_PROMPT`, answers `unaskable` with the charter's reason for a refused charter, and names the probed file in every `unaskable` reason.
3. **The fleetd caller** (`probeBeforeStarting`, `packages/fleet/src/server/entry/registryd-main.ts:1969`) resolves one prompt per `worker-start` write. A write that names a branch resolves that slice's own `agent:` charter through `sliceAgentOf` (`worker-loop.ts:2487`), the reading the loop uses on a fresh take-up. A free agent's write names no branch (`packages/domain/src/workflows/assign.ts`), so it resolves the fallback prompt. Resolve through `answer` in `packages/fleet/src/server/entry/prompt.ts`, which the loop calls. Where the main checkout holds no file and the write's desk holds one, probe the desk's copy, as the loop does.
4. **The board caller** (`packages/board/src/server/entry/write-probe.ts`, run by `plot-fleetctl.sh --start` before any slice exists) probes the fallback prompt and the prompt of the charter that `PLOT_AGENT` names in its environment, and names both in its answer.

The plan is canonical; this is orientation. Its line numbers date from `b21961602`, and several have moved. Find each site by symbol.

### Settled decisions — do not re-derive them

**The probe resolves as the loop does, with the loop's resolver.** A second resolver in the probe is a second rule free to drift. `answer` in `prompt.ts` is what the loop calls, so the probe calls it too. The plan's panel caught that the fleetd caller first read only the fallback, which probes the wrong file for every chartered slice.

**Each distinct file is probed once.** Probing per write repeats the same read for every free agent. Dedupe on `file`.

**A refused charter answers `unaskable`, not `ok` and not `failed`.** Absent is not false: the probe cannot tell whether the loop would run, so it must not report that it would.

**The retry rule is not touched, and the tests pin it.** `worker-loop-run.test.ts` (the charter-refusal case, now around `:435`, `maxStartRetries: 1`) asserts `r.calls.attempts` equals `[]`. The sdk rig has no `calls.attempts`: it writes attempts through `raiseAttempts` into its state (`worker-loop-sdk.test.ts`). Add a recorder there, and assert it holds no raise in the sdk charter-refusal test. **Both tests must fail when a retry is restored.** Check that by temporarily restoring one, then remove it.

**The `sdk` runner is never refused for an absent file.** Wave 3 settled that, and `missingPrompt` keeps the charter refusal first. Do not move the runner gate.

**The `defect` word from wave 3 stays as it is.** `promptAbsentRepair` supplies the repair text only. Do not change `StartCommand`'s arms or the entry's first answer line.

### Done when

The plan's `## Slices` entry for this branch and its Design section "Probe and loop" are the specification. Tests it names:

- `packages/domain/test/start-command.test.ts`: both `promptAbsentRepair` texts.
- `packages/domain/test/write-probe-shell.test.ts`: a declared charter's prompt is probed and `FALLBACK_PROMPT` is not read; a refused charter answers `unaskable` with its reason; an absent declared file names that file. **Make the first one fail against current `main` before you fix it**: today's probe reads the fallback whatever the charter says, so a test that only checks `ok` passes without the fix.
- `packages/fleet/test/unit/registryd-main.test.ts` (`probeBeforeStarting`): a `worker-start` for a slice whose plan line names a chartered agent probes the charter's declared file and never `FALLBACK_PROMPT`; a desk that holds the prompt the main checkout lacks is probed there.
- `worker-loop-run.test.ts`: a declared charter with an absent prompt logs the `write <file>, which charter '<name>' names` repair.
- A board-entry test for `PLOT_AGENT` naming both files.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. Add a changeset: package `'plot': patch`, the description first and a `bumps:` block last, with `plan: docs/plans/2026-11-21-a-refused-start-is-retried-and-named.md`. Run `./scripts/check-changeset-packages.sh`. Use arrow functions for every function you write. Domain TSDoc states what an export does and returns, with no history.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches no `.sh` file. If you find you need one, pay for the growth in the same change.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line under `### Probe and loop` in the plan's `## Slices`.
- Reference `#3141` in the PR body.

### Scope guard

This branch owns:

- `packages/domain/src/rules/start-command.ts`
- `packages/domain/src/adapters/write-probe/write-probe-shell.ts` and the `WriteProbe` port it implements
- `packages/fleet/src/server/entry/registryd-main.ts` (`probeBeforeStarting` only)
- `packages/fleet/src/server/entry/worker-loop.ts` (the absent-prompt refusal only)
- `packages/board/src/server/entry/write-probe.ts`
- the tests named above

Other branches in flight: `bug/a-red-pr-is-re-run-once-per-head` is not started and owns `slice-pr-next.ts`, `auto-fixer.ts` and the fixer-attempts files, so no collision. `bug/a-refused-brief-is-asked-again` (#3649) edits `auto-dispatch.ts`, `brief-ask.ts` and `brief-budget.ts`, none of which this branch touches. `registryd-main.ts` is large and busy: keep the edit to `probeBeforeStarting`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
