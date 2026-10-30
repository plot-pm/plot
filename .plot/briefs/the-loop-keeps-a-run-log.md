## Implementation brief — the-delivery-loop-keeps-a-run (wave 1: Run log)

- **Plan (canonical):** docs/plans/2026-10-29-the-delivery-loop-keeps-a-run.md on main
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2909 merged
- **Branch:** `feature/the-loop-keeps-a-run-log` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** per repo convention (plan-review app, one full review per PR)

Wave 2 (`feature/an-idle-slice-notifies`) waits on this branch: it reads the run log this branch writes.

### What to build

fleetd writes no record of what the delivery loop did, so a slice that stops moving is silent. Build the record: a `RunLog` port (`append(line)`, `read()`) in `packages/domain/src/ports/run-log.ts`, a file adapter and a fixture adapter, a line codec and a step enum. Then make today's four loop steps append one line each: dispatch (`packages/fleet/src/shared/auto-dispatch.ts:159`), CI correction (`packages/fleet/src/server/entry/worker-loop.ts:1862`), fresh agent (`packages/fleet/src/server/entry/registryd.ts:1146-1153`) and deliver (`packages/fleet/src/shared/auto-deliver.ts:406`). The plan is canonical; this brief is orientation.

### Decisions the plan settles — do not re-derive them

- **Copy the shape of `fresh-agent-record`, not its file.** Port in the style of `ports/fresh-agent-record.ts:62-71`; adapter in `adapters/run-log/run-log-file.ts`, modelled on `adapters/fresh-agent-record/fresh-agent-record-file.ts` (the plan cites an older path). `escalations.tsv` stays the question ladder's record; do not reuse it.
- **File location:** under the common git dir's `.plot/state/`, resolved with `git rev-parse --git-common-dir`, so a worktree and the main checkout write one file. A repo-relative path would split the log per desk.
- **Reads:** a missing file reads as no lines; an unreadable file reads `failed`; a torn or unparseable line is skipped. Absent is not false.
- **Codec:** one line = subject (plan, branch), PR, head, step, outcome, time. Escape tabs and newlines: an outcome can hold a finding title, and an unescaped tab shifts every later column.
- **Enums:** `step` (`dispatch`, `correction`, `fresh-agent`, `deliver`, `notified`) and `outcome` are `z.enum`s with a `plot-state: classification` declaration for `scripts/check-state-declarations.sh`. `outcome` must separate a step that moved the slice from a failed or partial host answer, because wave 2's clock ignores the latter.
- **A step is an action, never an evaluation.** Write a line only when the loop acts. A per-tick evaluation at the 60 s tick (`registryd.ts:81`) would write about 1,440 lines a day per waiting slice and the slice would never go idle.
- **The run log is an action record, not an index.** No merge, fixer, restart, revert or attempts decision reads it. Do not read a host fact from it.
- **Writers and atomicity:** the looping fleetd daemon and the desk's worker loop append. Each append is one `O_APPEND` write of one line under `PIPE_BUF`, so two processes never interleave. `plot-fleetd.mjs --once` appends nothing.
- **No rotation.** Existing append-only records here hold 277 and 208 lines with no cap.
- **Layering:** the domain owns the port, the adapter reaches the file, the controller calls the domain. Add no `spawn` site and no `plot-*.sh` line; the spawn ratchet and `check-shell-lines.sh` must not move.
- **Vocabulary:** say "idle slice", never "stalled" (an Agent state); say Agent, not worker; new functions are arrows.

### Done when

The plan's `## Tests` list for slice 1 is the specification:

- `packages/domain/test/run-log-file.test.ts`, shaped like `fresh-agent-record-file.test.ts`: append and read back; missing file reads empty; unreadable file reads `failed`; torn line skipped; two appends keep order; a tab or newline in `outcome` round-trips; a worktree and the main checkout resolve one file. Remove the temp dir by the exact `mkdtempSync` name.
- Fleet tests: each instrumented step appends exactly one line per action against the fixture `RunLog`, and `--once` appends none. The `--once` case catches an implementation that logs from shared code the one-shot path also runs.
- Gates: `scripts/check-state-declarations.sh` with the new enums declared; `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .`.

Plus: add a changeset (description first, `bumps:` block last; run `./scripts/check-changeset-packages.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI. If the slice touches a `.sh` file, growth is paid for in the same change (`scripts/check-shell-lines.sh`).

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

Owns: `packages/domain/src/ports/run-log.ts`, `packages/domain/src/adapters/run-log/`, the run-log line and step types, `packages/domain/test/run-log-file.test.ts`, and the four instrumentation call sites above with their tests. Does not own: the idle rule, the `Slice idle after` key, the notify write kind or any board view (all wave 2). #2903 owns the fixer-attempts notification. If you find something the plan did not anticipate, report it rather than improvising outside scope.
