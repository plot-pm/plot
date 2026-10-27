# Panel round 1 — moderation

Subject: `docs/plans/2026-10-27-bundle-entries-exit-before-stdout-drains.md` (plan PR #2748, issue #2747), head `f37a92b36`.

Gate: `plot-panel.mjs check Position proceed,amend,reject` committed all four files. Reconcile: `unanimous amend runtime,estate,gates,tests`.

## What each juror looked at

- **runtime** ran: 1 MB pipe writes on macOS and in `node:24` and `node:22` containers; `plot-ask.mjs board` and `fleet` through a pipe; a metered `plot-fleet-scan.sh --offline` (187 bundle runs); a preload that turns `process.exit` into `exitCode` and logs live handles.
- **estate** read and counted: 62 bundles, 66 `process.exit(` lines in 59 entry files, each classified; the shell and TS callers of every bundle. It ran `plot-ask.mjs board` and `fleet` to a file and through a pipe.
- **gates** read the existing gates, `check-shell-lines.sh`, `check-bash32-syntax.sh` and the CI wiring, and ran the drain-then-exit ending against a live `setInterval`.
- **tests** ran the reference test from `da194bcaf` against an old and a new bundle on macOS and Linux, 30-run truncation rates at three sizes, and a `node --import` probe.

## Agreed by all four

1. **The Motivation is wrong about Linux.** Linux truncates too: 65,536 bytes in `node:24` and `node:22` (runtime, tests, ran). At 200 KB it is a race (19 to 25 of 30 runs cut); at 1 MB it cuts 30 of 30 (tests, ran). A macOS CI job exists (`ci.yml:243-244`). Drop "on macOS" from the title and the Changelog.
2. **`plot-ask.mjs` is the main victim, and the plan does not name it.** `entry/main.ts:249` ends with `.then((code) => process.exit(code))`. `board` writes 595,679 bytes to a file and 65,536 through a pipe; `fleet` writes about 150 KB and `jq` fails on the cut (runtime, estate, ran). The master agent reads both through a pipe today.
3. **"Set `process.exitCode` and return" is wrong at four control-flow exits.** `transition.ts:352` falls through into `run(...)` at `:368` and writes a second answer; `local-checks.ts:217` falls through to the usage error at `:221-222` and changes exit 0 into `EXIT.usage`; also `local-checks.ts:214,219`. The early refusals `plan-for-branch.ts:47`, `transition.ts:364` and `review-bypass.ts:148` need the same care.
4. **The gate's "follows a stdout write" cannot be decided by text.** Most entries write inside `run` through a callback, so every tail exit textually follows a write.
5. **Slice 2 does not stand alone.** It cannot land before the conversion (66 sites fail it), and without it slice 1's claim has no check. Fold it into slice 1.
6. **Census:** 66 lines, 59 files; the plan's "19 + 7 = 26 entries" is wrong (estate: 4 refusals, 4 control-flow, 35 sync and 23 awaited endings).

## Disagreements

**A. The ending: drain-then-exit helper, or bare `exitCode`.** runtime and gates want one shared helper, `process.stdout.write('', () => process.exit(code))`, that also drains stderr. estate counts `exitCode` as sufficient because `plot-ask.mjs` ended on its own (15 to 18 s). The two readings use the same measurement: runtime shows the answer is complete at 2.3 s for `fleet` and the process then lives to 17.6 s and starts 41 more child processes, including paid host calls (`plot-host.sh runs`, `issue-list`, `spend-rate`). estate's 15 to 18 s is that same tail. runtime also shows bare `exitCode` turns an early-closing reader into exit 1 with an `EPIPE` stack trace, where the helper keeps the code. The disagreement is not about the facts; estate did not weigh the tail. The helper is the safer ending, and it removes the plan's undecidable "three or more" condition.

**B. The gate: a static token ban, or a runtime probe.** runtime, estate and gates want "no `process.exit` token in non-comment lines under `packages/*/src/server/entry/`", exact once every entry uses a helper that lives outside `entry/`. gates names the form (`scripts/check-entry-exit.sh` plus `test/reconcile/entry-exit-gate.test.mjs`, 0 shipped shell lines, comment lines skipped, mutation-tested). tests wants a `node --import` probe over every built bundle with a fixture per entry, and no grep. The probe sees an exit inside a called helper and an injected `proc.exit`, which a token ban does not; the cost is a fixture for each of 59 entries. The two do not exclude each other: the token ban is the cheap exact gate, and the probe can ride the 20 test files that already spawn entries through `NODE_OPTIONS`. Note: once the helper exists, a probe that flags "`process.exit` after a write" flags the helper itself; it must test that stdout drained (`writableLength === 0`) instead.

**C. The behavioural proof.** runtime: a plain pipe test fails on Linux too. tests: at 200 KB it is flaky on Linux, so use at least 1 MB. estate: an asynchronous-write preload with output to a file fails deterministically everywhere. A 1 MB real pipe is deterministic on both platforms (tests, ran 30 of 30) and tests the real symptom.

## Shared blind spots

- **The tail work in `plot-ask.mjs`.** Only runtime saw that `plot-ask.mjs fleet` starts paid host calls after its answer, which `process.exit` cuts off today. No juror asked whether that background refresh should run in a read-only ask at all. With the helper it stays cut off; a later change to the ending could start it spending budget on every ask.
- **Decisions already made on cut answers.** Every juror measured the cut, and none asked what read it. The master agent's `plot-ask.mjs board` and `fleet` answers have been cut at 64 KB; a decision that parsed a cut answer, or failed to parse one and fell back, is not visible from the entries.
- **Injected exits.** Only gates named `registryd-main.ts:2060,2917` and `worker-loop.ts:2003`, which exit through an injected process object and pass any token gate. They are signal and start-failure paths; the plan must name them as a limit.

## Named amendments for the plan

1. Correct the Motivation and title: Linux truncates too; name the macOS CI job.
2. Name `plot-ask.mjs` (`entry/main.ts:249`) as in scope and measured, and make it an acceptance subject.
3. One shared drain-then-exit helper outside `entry/`, used by every entry, draining stdout and stderr and keeping the exit code on `EPIPE`. Remove "three or more".
4. Rewrite the four control-flow exits and three early refusals as `if/else`, each branch's exit code and stdout asserted by a test.
5. One slice. Its gate is a token ban on `process.exit` in non-comment lines under `entry/` (`scripts/check-entry-exit.sh` plus a `*gate*.test.mjs` contract test, mutation-tested), wired into `Local checks` and `ci.yml`. Name the injected-exit limit.
6. Acceptance: a 1 MB real-pipe test through a built bundle, a `plot-ask.mjs fleet` piped run that parses as JSON, and a wall-clock bound after the answer.
7. Replace the census with the measured one (66 lines, 59 files, classified).
