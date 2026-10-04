## Implementation brief — a-brief-the-fleet-writes-shows-as-asked

- **Plan (canonical):** docs/plans/2026-10-04-a-brief-the-fleet-writes-shows-as-asked.md on main
- **Approved:** 2026-10-04, jwloka, in-session
- **Branch:** `bug/a-brief-the-fleet-writes-shows-as-asked` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention; the PR is reviewed as code

This is the only slice of the plan. No other branch in flight touches `packages/board`: `infra/the-shell-loop-holds-unlanded-work` holds `packages/domain` ending rules and `plot-worker-loop.sh`, and `infra/the-loop-has-a-workflow` carries no diff against main (both checked 2026-10-04).

### What to build

A slice whose brief a dispatch is writing reads "approved — nobody has taken it" on the board. Since `aa1f36296` (2026-09-29) the dispatch controller writes the brief through the implement route with `--brief-only`, and that run logs to `.worktrees/plot-implement-<plan-slug>.log`. `briefAskLogPaths` in `packages/board/src/server/brief-ask-log.ts` names two askers only: `.plot/brief-<branch-slug>.log` (the dispatch shell script, line 805) and `.plot-brief-<plan-slug>.log` (`askForBrief` in `brief-ask.ts`). Measured 2026-10-04: the logs of `the-shell-loop-holds-unlanded-work` and `the-worker-loop-runs-in-js` existed under `.worktrees/` and no `.plot/brief-*.log` newer than 2026-09-30 existed.

Build three things on top of what exists:

1. **One list of askers in `brief-ask-log.ts`.** Each asker's path comes from the function that writes it: `implementLogPath(repoRoot, planSlug)` from `implement.ts` for the implement route, and the path `askForBrief` writes. Today `brief-ask.ts` builds its path inline and the dispatch script builds its own in shell, so extract a path function for `brief-ask.ts` and keep the dispatch path as one declared constant that a test pins to the script's line. `briefAskedAt` takes the plan slug beside the branch and still reports the earliest mtime.
2. **`briefFailed` on the fleet row.** It holds the implement log's path when `implementStatus(opts, planSlug)` reads `failed` and the recorded exit came after the ask, and null otherwise. `fleet.ts` computes it next to `briefAskedAt` (around line 7303); the PR-map row (around lines 7608 and 7890) sets it null.
3. **The words.** `row-identity.ts` decides the sentence from `briefAskedAt` and `briefFailed`. A failed writer reads "the brief writer failed" and links the log; a running writer keeps `briefAskedNote`; a succeeded run wrote the brief, so `brief` reads present and the row leaves the waiting note.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

- **A failed writer is read from the recorded exit code, not from a process.** `#905` decided against judging liveness: its author saw a 0-byte log with no visible process and concluded the writer had died, and it had not (the log reached 2553 bytes and the brief landed). An exit code in `implementStatePath` is a recorded fact. Do not add a liveness probe, a size check or a timeout; an empty log is still an ask.
- **A running run keeps saying the age of the ask.** `implementStatus` reads `running` for a log with no state file. Do not turn that into `failed` on age.
- **The plan slug is passed beside the branch slug.** The implement route is keyed on the plan slug, and the branch slug equals it only by naming convention. Derive the plan slug from the plan file's basename without its date prefix and `.md`, in `fleet.ts`, where `plan.file` is in hand. Do not reuse the branch's last segment for the implement path.
- **The decision stays in the payload; the row reads it.** Do not compute a sentence in `rows.tsx`. Every sentence is a `row-identity.ts` function a unit test asserts without a browser (the repo's rule: every rendered state is a domain property).
- **Per machine, as before.** No log here means "nobody asked here"; do not infer an ask from absence.
- **A `done` implement run is not an ask.** The plan does not say this; read it here. The implement log is per PLAN and stays after its run. A plan with several slices gets one `--brief-only` run for its eligible wave, so if a `done` log counted as an ask, every later slice of that plan would read "brief asked N days ago" forever. Count `running` (log, no state file) as an ask, feed `failed` to `briefFailed`, and count `done` (state `0`) as neither. If you disagree, say so in the PR body rather than choosing silently. Assert it in a unit test.
- **The controller gate refuses a Bash line that names the dispatch script.** `plot-controller-gate.sh` matches the script name anywhere in the command, a `grep` included. Reach the file through a glob such as `skills/plot/scripts/*-dispatch.sh` when you inspect it.
- **No re-ask.** Whether a failed writer is re-asked belongs to `auto-dispatch-asks-for-the-brief`. This slice only makes the failure visible.
- **Style:** a function you write is an arrow. `fleet.ts`, `implement.ts` and `rows.tsx` are mostly declarations; leave those alone and write only your own as arrows.
- **Board schema:** a new `AgentRow` field needs `AgentRowSchema` in `packages/board/src/contract/schema.ts` and a default of `null`, because the client casts the fleet and never parses it, so a missing field is `undefined` in the renderer. Check the six places `briefAskedAt` already appears.

### Done when

The plan's `## Design` tests are the specification:

- `briefAskedAt` returns the implement log's mtime when it is the only ask.
- Several asks report the earliest.
- `briefFailed` holds the log path for a non-zero recorded exit, and is null for a running run, exit 0 and no run.
- The asker-list test covers every asker.
- `row-identity.ts` gives the failed sentence.
- One browser test shows the note for an implement-route ask.

The assertions that exist because a naive implementation would pass without them:

- **The asker-list test runs each asker's own path function** (`implementLogPath`, the `askForBrief` path function) and asserts the result is in the list `briefAskedAt` reads. A test that lists the three strings itself passes when a fourth asker logs elsewhere; this one fails.
- **A pin from the dispatch script's log line to the constant**, since a shell string cannot be imported. Read the script's text in the test and assert the constant matches it, so a changed shell path fails the test rather than the operator's board.
- **`briefFailed` is null for an exit recorded before the ask.** An old failed run followed by a new ask reads as asked, not failed. Fixture: a state file older than the log's first ask.
- **The browser test's only ask is an implement-route log.** With a `.plot/` or `.plot-brief-` log present it would pass on the old code.

Plus: bump the board package through a changeset in `.changeset/` using `'@plot-pm/board': patch` frontmatter, with no `bumps:` block (a `packages/board` change); copy the format from git history, and touch no sibling's changeset. The board artifact is generated: commit no bundle (`scripts/check-no-bundle-diff.sh`). Run `pnpm build` in `packages/board` before the browser test so it loads a fresh artifact. Under Node 24 (`nvm use`).

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.

This slice should touch no `.sh` file. If it does, `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base; pay for growth in the same change by removing shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line under `## Slices` in the plan.

### Scope guard

This branch owns:

- `packages/board/src/server/brief-ask-log.ts`
- `packages/board/src/server/brief-ask.ts` (path function only)
- `packages/board/src/server/fleet.ts` (the `briefAskedAt` call site, the new `briefFailed` field, and the two null rows)
- `packages/board/src/contract/schema.ts` (`briefFailed`)
- `packages/board/src/app/lib/agent-rows/row-identity.ts` and `rows.tsx` (the failed note)
- new tests under `packages/board/test/`
- one changeset

It does not touch `implement.ts` beyond importing from it, the dispatch shell script, `packages/domain`, or `plot-worker-loop.sh`. If you find something the plan did not anticipate, report it rather than improvising outside scope.
