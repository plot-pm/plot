# Juror: runtime

Position: amend

The defect is real and larger than the plan says. Two premises are wrong, and the prescribed fix ("set `process.exitCode` and return") is wrong for the entry with the largest real output. A shared drain-then-exit helper fixes every case I measured; bare `exitCode` does not.

Node v24.21.0 on darwin unless stated. Code citations are from `p2748-main` at `32f0c8cd6`. Scratch scripts are in `/private/tmp/claude-501/-Users-jwloka-Quatico-Agentic-Tools-plot/ca0ab00d-98d3-4ca8-8a1b-8a43a4eda657/scratchpad/rt/`.

## 1. The problem

**The truncation also happens on Linux (ran).** In `docker run node:24` (v24.21.0, kernel 6.12 linuxkit), `node -e "process.stdout.write('x'.repeat(1e6)); process.exit(10)" | wc -c` prints `65536`. A slow reader also gets 65,536. stderr also gets 65,536. A Node parent that uses `spawnSync` gets 146,176 of 1,000,000. In `node:22-bookworm` (v22.23.2), three runs of a 200 KB write plus `exit(0)` each print `65536`, and `exitCode = 0` prints `200000`. The plan's Motivation says "Node writes to a pipe asynchronously on macOS and synchronously on Linux" and "CI runs on Linux, … so no test sees the truncation". Both statements are false on the Node versions this repo runs.

**The cut length varies (ran).** On macOS I measured 65,536, 69,632 and 131,072 bytes for the same 1 MB write, depending on the reader. A test must assert the full byte count, not a cut at 65,536.

**Two real entries cut their answer today (ran, in the main checkout, read-only questions):**

| Entry | To a file | To a pipe | Effect |
|---|---|---|---|
| `plot-ask.mjs board` (`entry/main.ts:249`) | 595,679 bytes | 65,536 bytes, exit 0 | — |
| `plot-ask.mjs fleet` (`entry/main.ts:249`) | 153,558 bytes | 65,536 bytes | `\| jq -e .` fails with `parse error: Unfinished JSON term at EOF at line 1, column 65536`, rc 5 |

The master agent reads `plot-ask.mjs` through a pipe, as the entry's own header says (`main.ts` doc block: "a caller can pipe stdout into a parser"). The issue's list of 26 entries does **not** name `main.ts`, because its ending is `.then((code) => process.exit(code))` and not `process.exit(run(...))`. The plan's slice text ("every `process.exit(` under `packages/*/src/server/entry/`") covers it only by accident. The plan must name `main.ts` as the first entry to fix, because its answers are the only ones I measured over 64 KB.

**The shell-read entries are under 64 KB on this estate today (ran).** I put a metering `node` shim on `PATH` and ran `plot-fleet-scan.sh --offline --json` (39 s). It logged 187 bundle runs. The largest stdout was `plot-merge-subject.mjs pairs` at 35,821 bytes, then `proven` at 19,487. Every other run wrote under 2 KB (`branch-state`, `verdicts`, `task`, `empty-claim`, `pr-index-lookup`, `slice-chain`, `sprint-score`). `pendingAtExit` was 0 for all 187, so none was cut. `merge-subject` grows with the merge walk ("up to 2000 merges", README row) and is the next candidate. I stopped `plot-reconcile-scan.sh` after 15 minutes. It had logged no bundle output over 2 KB by then.

**Counts (ran grep):** 60 `process.exit(` lines in 53 files under `packages/board/src/server/entry/`, and 6 under `packages/fleet/src/server/entry/`. The plan's numbers match.

**Entries that keep the event loop alive, so bare `exitCode` does not end them promptly (ran).** I preloaded a module that replaces `process.exit` with "set `exitCode` and return" and logs `process.getActiveResourcesInfo()`:

- `plot-ask.mjs board`: the answer is complete at 10,175 ms. The process then lives until 18,097 ms with `ProcessWrap`, `PipeWrap` and `Timeout` handles, and starts 23 more child processes after the answer.
- `plot-ask.mjs fleet`: the answer is complete at 2,258 ms. The process lives until 17,565 ms (7.8 times longer) and starts 41 more child processes after the answer. These include **paid host calls**: `plot-host.sh runs <branch>` (twice), `issue-list --state closed`, `issue-list --paged`, `spend-rate --connector github`, `account`. Today `process.exit` cuts that background refresh off. Bare `exitCode` lets it run on every ask and spends host budget for an answer nobody reads.

The entry does not own these handles. They come from the board controller's background work, so "the entry closes it before the assignment" (Approach, step 1) is not available to the implementer.

Other candidates I read and cleared:
- `dispatch-command.ts:225` (`runDetached`) launches a child through `detachedNode()`, which spawns with `detached: true` and calls `child.unref()` (read, `packages/domain/src/adapters/detached/detached-node.ts:14-19`). It does not hold the loop.
- The signal handlers in `agent-run-sdk.ts:458/511` and `bounded-run-process.ts:137/144` are removed after their run (read). They do not hold the loop.
- `worker-loop.ts:2598` is a long-running loop whose stdout goes to a log file. File writes are synchronous (ran: a 1 MB write plus `exit` to a file delivers 1,000,000 bytes). It has no truncation to fix, and only the helper below changes it safely.
- `registryd-main.ts:2910-2918` (`settleOnce`) already sets `exitCode` on success (read). This is precedent in the fleet package, and the plan does not cite it.

## 2. The approach against the code

"Set `process.exitCode` and return" is wrong in three named ways.

1. **It hangs or delays where a handle lives:** `main.ts`, measured above.
2. **It changes control flow at mid-flow exits.** These exits are top-level module code, where no `return` exists, so assigning `exitCode` falls through to the next statement (read):
   - `transition.ts:352` (`--check-slices`) falls through into the `--slices` parse and then into `run(...)` at `:368`.
   - `transition.ts:364` falls through to `slices = parsed` with `parsed === null`.
   - `local-checks.ts:214`, `:217` and `:219`. With no arguments, `:217` runs the checks and then reaches `:221`, which prints `plot-local-checks: unknown argument undefined` and sets `EXIT.usage`. That **changes the exit code a caller reads.**
   - `plan-for-branch.ts:47` and `review-bypass.ts:148`.
3. **It changes the exit code when the reader closes early (ran).** For `process.stdout.write(1 MB); process.exitCode = 4` piped to `head -c 10`, status is **1**, and Node prints an unhandled `EPIPE` stack trace on stderr. With `process.exit(4)`, status is 4.

**A drain-then-exit ending passes every case I ran:** `process.stdout.write('', () => process.exit(code))`.

| Case | Result |
|---|---|
| 1 MB write, `\| wc -c` | 1,000,000 |
| Slow reader (`sleep 1; wc -c`) | 1,000,000 |
| A live `setInterval` | 1,000,000, exits 4 at once (does not hang) |
| `\| head -c 10` | status 4 (keeps the code) |

The helper must also drain stderr, because stderr truncates too (ran: 65,536 of 1,000,000 on macOS and Linux). It must also stop the code that follows it at a mid-flow exit. Either it returns `never` (a promise that never settles, after it arms the exit), or the callers restructure to `if/else`.

**The "shared ending if three or more need it" condition is moot.** All 66 sites need the same ending. One exported arrow helper, shared by board and fleet, replaces every `process.exit(` in `entry/`. The condition stays undefined, because "the close-then-set shape" names a shape that no entry can build (see the `main.ts` handles above).

## 3. Safety

As written, the change has three failure paths. Each one is named in section 2:

- `plot-ask.mjs` lives 8–15 s longer and makes host calls after its answer: `main.ts:249`.
- Fall-through changes behaviour and exit codes: `local-checks.ts:217`, `transition.ts:352/364`, `plan-for-branch.ts:47`, `review-bypass.ts:148`.
- An early-closing reader turns any entry's code into 1, with a stack trace.

I found no shell caller today that closes a bundle's stdout early (ran grep for `.mjs … | head` or `| grep -q` under `skills/` and `scripts/`, 0 hits). An agent's ad hoc `plot-ask.mjs board | head` is still exposed.

The drain-then-exit helper avoids all three, and it changes no signal handler.

## 4. The gate

**A grep cannot decide "follows a stdout write" (read):**

- `standing.ts:115` holds no write text at all. `run` writes through a parameter.
- `transition.ts` writes at `:368`, after its exits at `:352/:364`.

Textual order therefore gives both false negatives and false positives.

**A decidable gate bans the token.** It allows no `process.exit(` in `packages/*/src/server/entry/**`, and every entry ends through the helper. The helper's own file is the one allowed site. That needs no allow-list and no ratchet once slice 1 lands. The gate can be a vitest or `node --test` case beside `bundle-attribute-gate.test.mjs`, because the repo has no ESLint config (ran: no `eslint.config.*`). A `scripts/check-*.sh` also works and is bash 3.2-safe as a plain `grep -rn`. `check-shell-lines.sh` counts only shell under `skills/` (read, `:2`), so a gate under `scripts/` does not need to pay lines.

**Slice 2 is small enough to fold into slice 1.** Banning the token is one assertion, and slice 1 already removes every site. Two branches add a wave and a merge for about ten lines.

## 5. Slices against Changelog and acceptance

- **Linux CI can see the bug.** Because Linux truncates too (ran), a plain test fails on today's code on both macOS and Linux: bundle an entry, pipe at least 200 KB through a real pipe, and assert the full byte count and the exit code. Open Question 3 is answered, and the asynchronous-stub test it proposes is unnecessary. The reference test in `da194bcaf` is of that shape.
- **The acceptance needs these named cases**, each failing on today's code:
  - `plot-ask.mjs fleet` piped, with full byte count and valid JSON (ran: today 65,536 and a `jq` failure).
  - One stdin entry with output over 64 KB (for example `merge-subject pairs` fed a large walk).
  - A wall-clock bound on `plot-ask.mjs fleet` that fails if the process outlives its answer by seconds. This catches a bare-`exitCode` implementation (ran: 2.3 s versus 17.6 s).
  - `local-checks` with no arguments still exits with the code of its run and prints no usage line.
- **The Changelog line is observable** ("deliver their whole stdout to a pipe reader"). It must drop "on macOS", which is false.

## Named amendments

1. Correct the Motivation: Linux pipes also truncate (`node:24` and `node:22` containers, 65,536 bytes). Drop "on macOS" from the title and the Changelog, or say "on every platform".
2. Name `entry/main.ts:249` (`plot-ask.mjs`) as in scope and first. It is the only entry measured over 64 KB: 595,679 and 153,558 bytes.
3. Replace "set `process.exitCode` and return" with one shared drain-then-exit helper that flushes stdout and stderr, keeps the exit code on `EPIPE`, and stops execution at mid-flow exits. Remove the "three or more" condition.
4. Add the mid-flow exits to the brief as behaviour-preserving cases: `transition.ts:352/364`, `local-checks.ts:214/217/219/222`, `plan-for-branch.ts:47`, `review-bypass.ts:148`.
5. Make the gate a token ban on `process.exit(` in `entry/` (helper file excepted), preferably as a test. Fold it into slice 1, or keep slice 2 as a one-assertion test.
6. Make the acceptance tests: pipe at least 200 KB through a built bundle on Linux CI, assert the full count, and bound `plot-ask.mjs`'s wall clock after its answer.
