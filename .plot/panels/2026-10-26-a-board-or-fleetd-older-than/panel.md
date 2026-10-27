# Panel round 1 — moderation

Subject: `docs/plans/2026-10-26-a-board-or-fleetd-older-than.md` (#2728, plan PR #2729, Draft). Jurors: safety, estate, rootcause, contradiction. Gate: all four committed (exit 0). Reconcile: `unanimous amend`.

## Evidence basis

All four read the code on current `origin/main` and ran greps for every spawn that sets `PLOT_MAIN_CHECKOUT_WRITER`. Contradiction ran `git show a98afb890`. Safety measured content hashing of a bundle at 1–2 ms. No juror ran a test.

## Findings all four share

1. **Implement no longer uses the marker.** #2740 (`a98afb890`) removed it from `implement-run.ts`; six spawn sites remain (`deliver.ts`, `reslice.ts`, `story.ts`, `auto-deliver.ts`, `brief-ask.ts`, `plot-dispatch.sh`). The plan's lead example and role count are stale, and so are the docstrings at `main-checkout-write.ts:13-17` and `gate.ts:507-510`.
2. **Slice 1's hint fires on the normal case.** "Unattended without the marker" is the designed state of every desk worker, every continued desk and every implement run. The gate reads only its own environment and cannot tell a stale spawner from a correct one, so the text would blame a stale spawner for legitimate refusals. The fix all four converge on: a spawn-contract reading the spawner exports (for example `PLOT_SPAWN_CONTRACT`, an integer from a domain constant) that the gate compares, so a missing or older contract is a fact, not a guess. The text goes in `mainCheckoutWriteRefusal` (`main-checkout-write.ts:391`), split from the mixed-reset arm, addressed to the operator.
3. **Slice 2 compares the wrong pair.** Comparing a process's start bundle with the same path on disk fires on almost every merge here (about eight times a day) and never fires in an adopting repository whose plugin moved to a new version directory. Compare the loaded identity with the bundle resolved now, key `stale` on the contract integer, and report plain bundle drift only as evidence.
4. **Prior art is uncited.** `loop-restart.ts` already detects a newer bundle for worker loops and restarts only at an idle point; `BoardStatus` and fleetctl's `BUNDLE MISSING` arm are existing surfaces. Reuse them.

## Single-juror findings worth keeping

- **Safety:** an unattended agent can run a restart nothing gates; the refusal must name no stop or restart command and tell the agent to stop and report. `--status`'s exit code and `supervisor=` word stay unchanged; a process with no recorded identity answers `unknown`.
- **Estate and rootcause:** the reverse skew exists too: an old spawner granting a marker or `PLOT_BRIEF_ONLY` (#2646) that a newer design withdrew. Cover it or scope it out.
- **Estate:** account for `check-shell-lines.sh` and `check-decision-count.sh`; name fleetd's recorded-identity file and its one writer.

## Disagreement: report or self-restart

- **Safety** wants slice 2 report-only: no consumer of `stale` starts, stops or reloads a process, because a restart stops agents.
- **Rootcause** prefers that a stale board or fleetd restart itself at an idle point, as `loop-restart.ts` does for worker loops, because naming the failure does not remove it.
- **Estate and contradiction** do not take a side.

This is an operator decision: a self-restart removes the failure but acts on the operator's processes unattended.

## Shared blind spot

None of the jurors asked how often the skew window is open in practice. After the 2026-10-26 restart the board and fleetd run current code, and the window reopens only when a merged change alters a spawn contract. A contract integer that changes only then makes both slices fire rarely and truly, which is the point; the plan should state how a contributor knows to bump it.
