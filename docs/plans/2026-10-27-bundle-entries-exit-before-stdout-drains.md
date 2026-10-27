# Bundle entries exit before stdout drains

> Entries under `packages/*/src/server/entry/` call `process.exit()` after they write to stdout, which cuts any answer over 64 KB on a pipe on macOS and on Linux; every entry must end through one shared drain-then-exit helper, and a gate must refuse `process.exit` in an entry file.

## Status

- **State:** Delivered
- **Type:** feature
- **Sprint:**
- **Issue:** #2747
- **Rounds:** 1
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-27, Jan Wloka, plan-PR #2748 merged
- **Started:** 2026-10-27, Jan Wloka, `feature/bundle-entries-end-through-a-drain`
- **Delivered:** 2026-10-27

## Changelog

- Bundle entries deliver their whole stdout and stderr to a pipe reader. An answer over 64 KB was cut at 65,536 bytes, including `plot-ask.mjs board` and `plot-ask.mjs fleet`.

<!-- Board impact: none. The plan format, template, helper scripts and docs/plans layout do not change. The entries are board- and fleet-package code, and main rebuilds the shipped bundles after merge. The slice rebuilds bundles locally only (pnpm build:board) and commits no generated bundle. -->

## Motivation

### The defect

`process.exit()` does not wait for pending writes to a pipe. Node queues a large pipe write on macOS and on Linux. Measured 2026-10-27: `node -e "process.stdout.write('x'.repeat(1e6)); process.exit(10)" | wc -c` prints `65536` on macOS (Node v24.21.0) and in `node:24` (v24.21.0) and `node:22-bookworm` (v22.23.2) containers. stderr truncates the same way. The cut length varies with the reader: 65,536, 69,632 and 131,072 bytes on macOS for one 1 MB write, and 146,176 bytes under `spawnSync` on Linux. On Linux the cut is a race at 200 KB (19 to 25 of 30 runs cut) and certain at 1 MB (30 of 30). Linux CI can therefore see the defect, and the repository also runs a macOS job (`macos-shell-contract`, `ci.yml:243-244`).

### The measured victim

`plot-ask.mjs` (`packages/board/src/server/entry/main.ts:249`) ends with `.then((code) => process.exit(code))`. Measured 2026-10-27 in the main checkout:

| Ask | To a file | Through a pipe | Effect |
|---|---|---|---|
| `plot-ask.mjs board` | 595,679 bytes | 65,536 bytes, exit 0 | 89 % of the answer lost |
| `plot-ask.mjs fleet` | 149,909 to 153,558 bytes | 65,536 bytes | `jq -e .` fails: `Unfinished JSON term at EOF at line 1, column 65536` |

The master agent reads both answers through a pipe: the Claude Code Bash tool returned 64.1 KB for one `plot-ask.mjs board` call. The other shell-read entries wrote under 64 KB in a metered `plot-fleet-scan.sh --offline --json` run (187 bundle runs). The largest was `plot-merge-subject.mjs pairs` at 35,821 bytes, and its output grows with the merge walk.

### The census

`origin/main` holds 66 `process.exit(` lines in 59 files under `packages/*/src/server/entry/`: 60 lines in 53 board files and 6 lines in 6 fleet files.

| Class | Count | Sites |
|---|---|---|
| Early refusal, usage text on stderr, nothing on stdout | 4 | `plan-for-branch.ts:47`, `transition.ts:364`, `review-bypass.ts:148`, `local-checks.ts:222` |
| After the answer, not the last statement (control flow) | 4 | `transition.ts:352`, `local-checks.ts:214`, `:217`, `:219` |
| Last statement, synchronous `run` | 35 | `standing:115`, `issue-source:118`, `sprint-score:140`, `reconcile:435`, `panel:259`, `start-command:76`, `prompt-exit:161`, `branch-state:326`, `propose-stack:98`, `agent-state:179`, `delta:287`, `slice-chain:92`, `verdicts:239`, `plan-undeliver:190`, `release-gate:364`, `landed:124`, `bitbucket-mergeable:71`, `slice-pr:226`, `claim-answer:73`, `checkout-yield:98`, `adopt:215`, `old-label:78`, `transition:368`, `bitbucket-slug:32`, `movable:114`, `merge-subject:396`, `jenkins-pr-checks:135`, `desk-root:72`, `sprint-transition:320`, `empty-claim:87`, `agent-settings:93`, `task:110`; fleet `fleet-size:147`, `prompt:240`, `desk-loop:86` |
| Last statement, awaited `run` or `.then` | 23 | `issue-status:203`, `main:249`, `deliver:981`, `sprint-release-gate:405`, `pr-index-lookup:158`, `verify:932`, `pr-state:59`, `release-chain:205`, `gate:794`, `plan-for-branch:50`, `review:682`, `needs-design:548`, `reap:1178`, `plan-state:212`, `design:339`, `brief-book:249`, `slice-spend:187`, `review-bypass:152`, `approve:1314`, `record-pr:200`; fleet `dispatch-command:225`, `continue-command:116`, `worker-loop:2598` |

Two entry bundles already end without `process.exit`: `listing-walk.ts:79` (`da194bcaf`, from the #2731 review) and `registryd-main.ts:2914` (`settleOnce`, which sets `exitCode` on success). Outside `entry/`, `process.exit(` appears only on server lifetime and signal paths: `board/src/server/index.ts:1020`, `lifetime.ts:104,201`, `fleet/src/shared/board-run.ts:72`, `domain/src/adapters/agent-run/agent-run-sdk.ts:318` and `bounded-run/bounded-run-process.ts:82`. None of them sits on an entry's answer path.

### Why a bare `exitCode` is not the fix

- `plot-ask.mjs fleet` completes its answer at 2.3 s and, with `exitCode` in place of `process.exit`, lives until 17.6 s. It starts 41 more child processes after the answer, including paid host calls (`plot-host.sh runs`, `issue-list`, `spend-rate`, `account`). `plot-ask.mjs board` lives from 10.2 s to 18.1 s and starts 23 more. The board controller's background work owns these handles, so the entry cannot close them.
- An entry that sets `exitCode = 4` and writes 1 MB to `head -c 10` exits 1 with an unhandled `EPIPE` stack trace on stderr. `process.exit(4)` exits 4.
- At the four control-flow exits, an assignment falls through to the next top-level statement. `transition.ts:352` falls into `run(...)` at `:368` and writes a second answer. `local-checks.ts:217` falls into the usage error at `:221-222` and turns exit 0 into `EXIT.usage`.

`process.stdout.write('', () => process.exit(code))` delivered 1,000,000 bytes to `wc -c` and to a slow reader, exited 4 at once with a live `setInterval`, and kept status 4 with `head -c 10`.

## Design

### Approach

One slice, three parts.

1. **The helper.** `packages/domain/src/adapters/entry-exit.ts` exports one arrow, `endEntry(code)`. It writes an empty chunk to stdout with a callback, then an empty chunk to stderr with a callback, then calls `process.exit(code)`. It handles `EPIPE` on either stream by calling `process.exit(code)`, so an early-closing reader does not change the code. It returns a promise that never settles, so `await endEntry(code)` stops an async flow, and the caller's code after it never runs. The helper lives in the domain's `adapters/` because it reaches the process, and the layering rule puts that in an adapter. Board and fleet entries both already import `@plot-pm/domain/adapters/*` (`dispatch-command.ts`, `continue-command.ts`, `registryd-main.ts`), so one module serves both packages, and the `EPIPE` rule exists once. The purity gate allows it because it sits under `adapters/`.
2. **The entries.** Every one of the 66 sites ends through `endEntry`. The 58 last-statement endings become `endEntry(run(...))` or `.then(endEntry)`. The four control-flow exits (`transition.ts:352`, `local-checks.ts:214,217,219`) and the three early refusals (`plan-for-branch.ts:47`, `transition.ts:364`, `review-bypass.ts:148`) become `if/else` chains in which exactly one branch reaches `endEntry`, with `local-checks.ts:222` as the final `else`. Each branch keeps today's exit code and stdout. `listing-walk.ts:79` and `registryd-main.ts:2914` also end through `endEntry`.
3. **The gate.** `scripts/check-entry-exit.sh` refuses any `process.exit` token in a non-comment line of a file under `packages/*/src/server/entry/`. It allows zero sites and has no allow-list and no ratchet: the helper is the only sanctioned exit, and it lives outside `entry/`. It skips comment lines, because `listing-walk.ts:77` and `registryd-main.ts:2894` mention `process.exit` in comments. It uses `grep -a` (the NUL-byte precedent, `ci.yml:1710`) and holds to bash 3.2 (`check-bash32-syntax.sh` scans `scripts/`). Its contract test `test/reconcile/entry-exit-gate.test.mjs` matches the existing `*gate*` glob. The slice adds `&& ./scripts/check-entry-exit.sh` to the `Local checks` `**` line in `CLAUDE.md`, runs `./scripts/check-agents-md.sh --write`, and adds one step to `ci.yml`. The gate adds 0 shipped shell lines: `check-shell-lines.sh` counts only `skills/`, and `check-decision-count.sh` counts only README rows under `skills/plot/scripts/`.

### Gate limit

The gate reads the token `process.exit`. It does not see an exit through an injected process object: `registryd-main.ts:2060` (`proc.exit(SIGNAL_EXIT[signal])`), `registryd-main.ts:2917` (`proc.exit(1)` on start failure) and `worker-loop.ts:2003` (`target.exit(...)` in a signal handler). These are signal and start-failure paths that write no answer, so the slice leaves them unchanged. The gate also does not see an exit inside a module that an entry imports; on `origin/main` no such module exits after a write.

### Tests

- **Helper unit:** with a stubbed asynchronous stdout, `endEntry(4)` calls `process.exit` only after the stdout and stderr callbacks fire, and with code 4. With an `EPIPE` error on stdout it calls `process.exit(4)`. Code after `await endEntry(...)` does not run.
- **Control flow:** each branch of `transition.ts` (`--check-slices`, a bad `--slices`, the normal run), `local-checks.ts` (no arguments, `--files`, an unknown argument), `plan-for-branch.ts` and `review-bypass.ts` (usage refusal and answer) asserts its exit code and its exact stdout. `local-checks` with no arguments exits with its run's code and prints no usage line.
- **Gate contract:** `entry-exit-gate.test.mjs` refuses a tail `process.exit(run(...))`, refuses `.then((c) => process.exit(c))`, ignores a comment line, ignores a file outside `entry/`, and passes on the repository tree. A mutation run removes the comment filter and widens the path, and the test fails each time.

### Acceptance

Each item fails on `origin/main` today, on macOS and on Linux CI.

- A test builds one entry bundle, pipes at least 1 MB through a real pipe, and asserts the full byte count and the exit code. 1 MB cuts in 30 of 30 runs on both platforms; 200 KB is a race on Linux.
- `plot-ask.mjs fleet` piped into a parser returns valid JSON with the full byte count and its exit code. Today it returns 65,536 bytes and `jq` fails.
- The `plot-ask.mjs fleet` process ends within a stated bound after the last byte of its answer. This fails a bare-`exitCode` ending (2.3 s answer, 17.6 s exit) and passes the helper.
- `./scripts/check-entry-exit.sh` passes on the slice and fails on `origin/main` with 66 sites named.
- `./scripts/check-shell-lines.sh` and `./scripts/check-agents-md.sh` pass.

### Changesets

The slice adds one changeset for package `plot`, with the Changelog line as its description.

### Open Questions

- [x] Does a static gate on `process.exit(` text in `entry/` hold, or does it need the call graph? — It holds as a token ban. "Follows a stdout write" cannot be decided by text, because most entries write inside `run` through a callback. With every entry ending through a helper outside `entry/`, zero tokens is exact. Operator decision, panel round 1.
- [x] Which of the 7 `await run(...)` entries can write over 64 KB? — The census holds 23 awaited endings, not 7. `plot-ask.mjs board` and `fleet` are measured over 64 KB. The helper is the same for all 66 sites, so the trace no longer changes the change.
- [x] Can a test fail on Linux? — Yes. A real pipe of at least 1 MB cuts in 30 of 30 runs on Linux and macOS.
- [x] Do `packages/board/src/server/index.ts`, `lifetime.ts` and `packages/fleet/src/shared/board-run.ts` belong to the gate's scope? — No. They are server lifetime and signal paths, not entries.
- [ ] Should `plot-ask.mjs` start background work at all? `plot-ask.mjs fleet` starts paid host calls after its answer, and `process.exit` cuts them off today. The helper keeps them cut off. A later change to the ending could let them run on every ask. This plan does not change the background work.

## Slices

### Entries

- `feature/bundle-entries-end-through-a-drain` — `endEntry` in `packages/domain/src/adapters/entry-exit.ts`, every entry under `packages/*/src/server/entry/` ending through it, the four control-flow exits and three early refusals rewritten as `if/else`, `scripts/check-entry-exit.sh` with its contract test, wired into `Local checks` and `ci.yml` <!-- builds: entry exit helper and check-entry-exit.sh, one drain-then-exit ending for every bundle entry and a gate that refuses process.exit in entry files --> → #2769

## Notes

- Created by `/plot-idea` from tracker issue #2747. The plan stops at Draft.
- This plan's panel, round 1: `.plot/panels/2026-10-27-bundle-entries-exit-before-stdout-drains/` (runtime, estate, gates, tests; unanimous amend). The operator chose the shared helper over a bare `exitCode`, and the token ban over a runtime probe.
- Not in scope: decisions already made on cut answers. The master agent has read `plot-ask.mjs board` and `fleet` answers cut at 64 KB; a decision that parsed a cut answer, or failed to parse one and fell back, is not visible from the entries.
- A runtime probe (`node --import` over every built bundle, flagging an exit with `writableLength > 0`) sees an exit inside a called helper and an injected exit, which the token ban does not. It needs a fixture for each of 59 entries, so it is not in this plan.
- Deliverable search (`plot-deliverable-search.sh`, "process.exit after stdout write gate in entry") found no existing gate.
- Reference fix: `da194bcaf` (`plot-listing-walk`).
- Definition of Done: `docs/definition-of-done.md`.
