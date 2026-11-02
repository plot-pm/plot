# Panel — the reporter SIGTERM test fails on

Subject: `docs/plans/2026-11-02-the-reporter-sigterm-test-fails-on.md` (`5646adf60`, plan PR #3039, issue #3033)
Convened: 2026-11-02, round 1, against `origin/main` at `8a767598b`
Lenses: layering, safety, testability, seams — four jurors, one rubric, persona varied only.

## Outcome: UNANIMOUS — 4 amend

| Lens | Position | Evidence |
|---|---|---|
| layering | **amend** | executed (macOS `/bin/sh`) |
| safety | **amend** | executed (`/bin/dash` under load, macOS `/bin/sh`) |
| testability | **amend** | executed (macOS `/bin/sh`) |
| seams | **amend** | executed (macOS `/bin/sh`) |

All four gated with a committed position. No hedges. Reconcile: `unanimous amend layering,safety,testability,seams`.

## Where all four agree

**1. The cause is a race in production code.** `reporterShell` (`packages/fleet/src/shared/continuation.ts:855-883`) forks the reporter as `( trap '' TERM; … ) &`, so the reporter ignores `SIGTERM` only once it runs its first command. The test's `ready` file comes from the agent subshell and proves nothing about the reporter. A group `SIGTERM` in the fork window ends the reporter with no finding.

**2. Each juror reproduced it independently, outside vitest, and each fixed it with the same one-line change.** Every miss left exit `143`, no finding, the FIFO on disk and an empty group.

| Juror | Shell | Before | After |
|---|---|---|---|
| layering | macOS `/bin/sh` | 34/600 | 0/600 |
| safety | `/bin/dash`, 24 busy processes | 13/150 | 0/150 |
| testability | macOS `/bin/sh` | 7/300 | 0/300 |
| seams | macOS `/bin/sh` | 5/200 | 0/200 |

**3. The fix is `trap '' TERM;` in the outer shell after `agent=$!` and before the reporter's `(`.** The ignore is inherited at `fork`. `plot-dispatch.sh:1450-1455` and `:1507` already follow this rule.

**4. The 5 s bound is refuted as a cause.** The failing test took 5709 ms and 5854 ms against 912 ms for a passing run of 20 iterations. A dead reporter writes nothing at any bound.

**5. Factual corrections.** Both CI logs name `continuation.test.ts:736:75` (runs 41361916665 on `main` `4d33c00dd` and 41376720118 on PR #3036 `609cc0c34`); the test holds one `toBe(true)`; #3028 is an issue, not a PR; the change is a bug and takes a `bug/` branch.

**6. Keep the 20-run test unchanged, and keep 20 iterations.** All four answer both Open Questions the same way: the miss reproduces locally at normal load, and 20 iterations cost under 1 s once the window is closed.

**7. An agent-side early-`SIGTERM` window exists outside this slice.** Three jurors measured it with no `ready` wait (safety 2/60 under `dash`; testability 3/200; seams 2/200 survivors and 1/200 `137`). Layering saw 1/200 and did not diagnose it. None asks this slice to fix it.

## Where they differ

These are differences in what each juror required, not in fact. The moderator records them and does not average them.

- **The placement constraint.** Only the safety juror names the failure of the wrong placement: an ignore before `agent=$!` makes `cmd` inherit it, so a group stop ends nothing. Layering states the placement in its structural test (no `trap '' TERM` before `agent=$!`); testability and seams state the placement without the reason. The amended plan carries it as a constraint.
- **The agent-dies test.** Only safety requires a behavioural test that the agent's command still dies on `SIGTERM` (A4). The others rely on the structural test alone. The amended plan requires it, because a string-order test cannot prove the process behaviour that the placement protects.
- **The Linux `dash` A/B.** Testability (A5, N ≥ 300) and seams (A3) require it; layering lists it as optional (O3); safety already ran it and asks the slice to repeat a loaded loop. The amended plan requires both shells at N ≥ 300.
- **The iteration count of the A/B.** Testability sets N ≥ 300; layering asks for "a stated N"; safety measured 150 and seams 200. The amended plan takes the strictest, N ≥ 300.
- **The reporter's inner `trap '' TERM`.** Seams (O3) and safety (A2) keep it; testability (A2) allows its removal or keeping it as a no-op. The amended plan keeps it.
- **The #3028 sentence.** Layering and testability ask for "until #3028 is fixed"; seams measured that `fleetd-s-fixer-and-main-repair` is delivered on `main` at `8a767598b` while the issue is still open. The amended plan states both facts.
- **A no-`ready` stress case.** Testability (O1) and seams (O1) offer it as optional, with the warning that it must not assert the exit code. The amended plan records it as optional.

## What the lenses shared, and could have missed together

- **All four measured outside vitest.** Each harness copied the test's sequence into a scratch script. No juror ran the real test file in a loop under vitest's worker pool, so a vitest-specific timing effect is not measured. The A/B in the PR measures the same way and does not close this gap.
- **Only one juror measured `dash`, the CI shell.** Three of four counts come from macOS `/bin/sh` (bash 3.2). The safety juror's 13/150 under `dash` ran on macOS, not on a Linux kernel. No juror ran on `ubuntu-latest` or in a Linux container.
- **All four ran on one machine at one load.** Load about 5 on 16 cores is the common condition. The CI runner's core count and load are not reproduced.
- **All four read the same `origin/main` string.** No juror checked whether another start path (`plot-dispatch.sh`'s own wrapper, or a future copy of the reporter shape) carries the same window.
- **All four accepted the structural test as deterministic proof.** A string-order test proves the order of the text. It does not prove the shell's inheritance of an ignored disposition; that rests on POSIX `fork` semantics and on the A/B counts.

## Disposition

Amend. The plan is amended in round 1: the cause is stated as measured, the fix is moved into `reporterShell`, the refuted causes are recorded as refuted, the proof is named, the Open Questions are decided, `Type` is bug and the slice branch is `bug/the-reporter-sigterm-test-fails-on`. The agent-side window is recorded in *Notes* as a follow-up outside the slice.
