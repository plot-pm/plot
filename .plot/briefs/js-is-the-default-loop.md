## Implementation brief — the-worker-loop-runs-in-js (wave 5: JS is the default loop)

- **Plan (canonical):** `docs/plans/2026-10-04-the-worker-loop-runs-in-js.md` on `main`
- **Approved:** 2026-10-04, jwloka, in-session
- **Branch:** `infra/js-is-the-default-loop` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention. The PR is reviewed as code, and CI is the authority for e2e.

Waves 1 to 4 merged (#1279, #1282, #1292, #1314, with #1325 as a follow-up). This branch waits on nothing in the plan, but its change is gated by a measurement, not by a merge: read **The gate** before writing any code. Wave 6 (`infra/the-shell-loop-goes`) waits on this branch.

### What to build

The default of the `Worker loop` key moves from `shell` to `js`. The change itself is small and mechanical. The work is proving that the flip is allowed, and recording the proof in the PR.

The sites that read the default, found with `git grep` on 2026-10-06:

- `skills/plot/scripts/plot-worker-loop.sh:82` — `cfg "Worker loop" shell`. This is the launcher. Change the fallback to `js`. The branch for `shell` must still run the body, because a repository that sets `shell` explicitly keeps it until wave 6.
- `packages/board/src/server/runner-gate.ts:18` — `read('Worker loop', 'shell') === 'js' ? 'js' : 'shell'`. The gate reads the key the way the launcher does, so it flips with it. Its doc comment says "An absent `Worker loop` reads `shell`"; rewrite it.
- `packages/domain/src/rules/runner-choice.ts` — `workerLoop` is `'js' | 'shell' | ''`. Read `''` as an absent key and decide whether `''` now means `js`. Where `runnerChoice` refuses `sdk` under `shell` (line 98), an absent key must no longer refuse. Change the rule and its unit test together, and do not leave the board gate and the domain rule disagreeing.
- `skills/plot-dispatch/SKILL.md:207` ("`Worker loop`, default `shell`") and `skills/plot/scripts/README.md:80` (the `board/plot-worker-loop.mjs` row, "the default `shell` runs no Node"). Both state the old default. Bump the skill's version by changeset, not by hand.
- `skills/plot/scripts/plot-config.sh` documents the key's neighbours; check whether it documents this one and keep it true.
- `.changeset/the-loop-runs-in-one-process.md` says "`shell` stays the default"; it is shipped history and stays. Add a new changeset.

This repository already sets `- **Worker loop:** js` in its own `## Plot Config` (commit `7c89f31be`, 2026-10-06), so flipping the default changes nothing for this repository's fleet. It changes adopting repositories, which run the shell loop today with no key set. That is why the flip is gated.

**An absent manifest `loop` field still reads as `shell`.** It describes a loop that already ran, not a default. Do not change that reading.

### The gate — do not re-derive it

Slice 5's condition, from the plan: the default flips when the fleet has run **at least 20 slices on `js`**, and both hold: the `js` loop's listed failures per slice are no more than the baseline's, and the `js` loop has none of kind 1, 4 or 5 (kind 1: a desk that ended free with unpushed or uncommitted work; kind 4: a loop process that outlives its desk; kind 5: a prompt process that outlives its loop). Kinds 2 and 3 enter the comparison only where both sides come from the same source; a kind whose two sides differ is reported per side and excluded.

**State on 2026-10-06.** The window opened today: `7c89f31be` set `Worker loop: js` here at 15:05, and the plan says slice 5's window starts at that commit. So **0 of 20** slices have run on `js` under that commit. The branch must not merge the flip before the count reaches 20. If the count is below 20 when you pick this up, do the measurement tooling (below), open the PR as a draft with the count and its date, and stop. Do not lower the threshold, do not count slices from before `7c89f31be`, and do not set the flag so the number looks reached.

**Three inputs the plan names do not exist yet.** Verified on 2026-10-06:

1. `docs/notes/the-worker-loop-runs-in-js-baseline.md` is absent. The plan makes the operator (jwloka) collect it daily. If it is absent when you start, report it and stop: the comparison has no baseline, and a baseline you write from memory is the number the gate exists to avoid. Record every kind with no source as **unmeasured**, never as zero.
2. `scripts/count-master-diagnosis.mjs` is absent. This slice writes it (pattern list below).
3. The loop that ran a slice is not recorded anywhere that survives the desk. The manifest's `loop:` line (`entry/worker-loop.ts:467`) goes with the desk when `plot-reap.sh` removes it. `slice-spend.jsonl` (172 lines in `.git/.plot/state/` today) and `endings.jsonl` (4 lines in `.plot/state/`) carry no `loop` field, so a slice cannot be told as `js` or `shell` after the fact. Do not guess from the date. Report this as a plan gap in the PR and, if the person who picks the slice agrees, add a `loop` field to the `slice-spend` and `endings.jsonl` lines through the `loop-end` and `slice-spend` writes. That is a new Write field and needs its domain tests and the 100% coverage gate. Without it, the count is the issues filed plus the daily `ps` reading, as the plan's sources say.

### The counting script

`scripts/count-master-diagnosis.mjs` is read-only and applies one pattern list identically to both windows. The plan says this brief fixes the list. A tool call counts when its input matches any of:

- `plot-worker-loop\.sh`, `plot-build-monitor\.sh`, `plot-worker-state\.sh`
- `\.plot-worker\.` (a desk's worker files)
- `\b(ps|pgrep|lsof)\b` as the command word of a Bash call
- `git worktree list`

Scope is the master sessions' transcripts in the main checkout's Claude Code project directory, **interactive sessions only** (`entrypoint: cli`; Plot's own `claude -p` runs read `sdk-cli`). Per window it reports the matching calls, the characters of their results, and a tokens estimate at 4 characters per token **labelled as an estimate**, per slice delivered in that window. A window with no master session reads as unmeasured. The figure is reported, never compared against a threshold, because what the operator asks varies between windows. Transcripts here go back to 2026-09-09.

Write it as an arrow-function module like the rest of the new code, with a test over a fixture transcript, including a `sdk-cli` session that must be excluded.

### Memory and tokens — recorded, not gating

- **Tokens:** from `slice-spend.jsonl`, report the median and the sum per slice of the four counters (input, output, cache creation, cache read) **separately**, because cache reads are about 99% of a naive total. Only a sealed slice has a record. A slice that ended by a bound, the idle watch or a `blocked` ending records nothing, so report the count of those slices beside the sums, never as zero tokens. Report slices that ran a correction apart (#1255).
- **Memory:** from the daily `ps` reading, the resident size per agent of the loop process, plus the build monitor on `shell`. The `claude` process is reported for scale. A daily reading is a sample: report the median and the largest per side.
- **Per machine:** the sum over live agents at each reading, beside `plot-registryd`'s own resident size. This is the figure the open question on one process per agent or per machine needs, and its answer is due before wave 6.

These do not gate the flip. They go in the PR so the open question has its data.

### Settled decisions — do not re-derive them

- **The baseline is not this repository's shell run.** `Worker loop` is one key per repository, so this repository runs no `shell` slices once it reads `js`. A before/after cannot be measured here; the comparison is against the operator's baseline file. A measurement taken by flipping this repository back to `shell` is the wrong experiment, and it changes the fleet's loop mid-window.
- **Counts that come from different sources are not compared.** Kind 2 on `js` is a `checks-unanswered` ending with reason `no-answer` whose commit `BuildPort` later answers conclusively. The shell loop's expired wait writes no ending, so on `shell` only the issues filed count. Report each side, and exclude the kind from the per-slice comparison.
- **Kinds 4 and 5 are a lower bound.** The daily `ps` reading misses an orphan that lives less than a day. State the bound; do not present them as exact.
- **An empty reading is not zero.** A kind with no source, a window with no master session, a missing store: each is *unmeasured*. This repository has already refused four fully-merged plans on an empty result read as "none".
- **The flip needs a named `js` count of kind 2 and a zero for kinds 1, 4 and 5.** Name the slices counted, the failures of each kind, and the baseline.

### Done when

The plan's slice 5 is the specification: the default flips to `js` when the fleet has run at least 20 slices on `js` and both conditions above hold, the PR names the slices counted, the failures of each kind and the baseline, and the manifest's `loop:` line stays the source for which loop ran a slice. The assertions that exist because a naive implementation would pass without them:

- **A test that an absent `Worker loop` key launches the JS loop, and that an explicit `shell` still runs the body.** Without the second half, the flip passes by deleting the shell branch, which is wave 6's job and would remove the adopting repositories' way back.
- **A test that the runner gate and `runnerChoice` agree on an absent key.** Without it, the launcher flips while `/api/dispatch` still refuses `sdk` under an absent key, which is the mismatch `sdk-needs-js-loop` was written to prevent.
- **A launcher test with the bundle missing and the key absent.** It must exit 2 naming the bundle. An adopting repository whose plugin predates the bundle would otherwise start `node` on nothing, or fall back silently.
- **The count script's `sdk-cli` exclusion test**, so an unattended run is never read as a master session.

Plus: the contract tests that drive the loop take their value from `PLOT_TEST_WORKER_LOOP` through `test/reconcile/loop-switch.mjs` (15 files use it). Where a fixture leaves the switch unset, the loop it drives changes with the default; find those with `git grep -l loop-switch -- test` and the files that start a loop without it, and state which ones moved. Any failure that is not a named, intended change is reported, never rewritten to pass.

Gates: add a changeset (description first, `bumps:` block last, `./scripts/check-changeset-packages.sh` to check it), run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `test:e2e` locally.

The shell gate: `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. Changing the fallback word at `plot-worker-loop.sh:82` adds no line. If anything else touches a `.sh` file, growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the count is below 20 or the work still moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to the `infra/js-is-the-default-loop` line under `## Slices` in the plan, on `main`.
- Where a board project is configured, set the PR to "Ready" once it exists, as the plan's other slices do.
- Never edit the plan's `State:` line by hand. `plot-state-gate.sh` refuses it.

### Scope guard

This branch owns: the launcher's fallback in `plot-worker-loop.sh`, `runner-gate.ts`, `runner-choice.ts` and their tests, the two doc lines named above, `scripts/count-master-diagnosis.mjs` and its test, the new changeset, and (only if agreed) the `loop` field on the `slice-spend` and `endings.jsonl` writes.

It does **not** own, and must not touch: the shell body, `plot-transcript-quiet.sh`, `plot-build-monitor.sh`, `buildMonitorPid`, `manifest_count` and its two neighbours, the findings form of `checksVerdict`, the `Worker loop` key's removal, or `PLOT_TEST_WORKER_LOOP`. All of those belong to `infra/the-shell-loop-goes`, which waits on this branch. No other `infra/` branch for this plan exists on `origin` (checked with `git ls-remote` on 2026-10-06), so no collision is known; `plot-worker-loop.sh` and `entry/worker-loop.ts` are the files other plans have touched most (#1315, #1321, #1325 landed on them in the last two days), so rebase on `origin/main` before the PR.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
