# The fleet loop reads its runs right

> The JS worker loop reads a CI run that no runner took, a spend limit written in dollars, a handed slice's charter and a run that waits for approval as what they are, so it spends no correction, keeps its caps, runs the right model and shows the right finding.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** the-release-train-fixes-what-it-found
- **Issue:** #1295, #1328, #1169, #1166, #1338
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-10-07, jwloka, in-session
- **Started:** 2026-10-07, jwloka, `bug/a-run-no-runner-took-is-no-answer`
- **Started:** 2026-10-07, jwloka, `bug/a-run-no-runner-took-is-no-answer`
- **Started:** 2026-10-08, jwloka, `bug/a-spend-limit-reads-its-dollars`
- **Started:** 2026-10-08, jwloka, `bug/a-handed-slice-carries-its-charter`

## Changelog

- A CI run that no runner took (0 steps, or the "not acquired" annotation) reads as no answer yet and spends no correction.
- `Slice max spend: $20` and `Agent max spend: $5` read as 20 and 5 dollars. A value the loop cannot read is logged and refused, never read as "no limit".
- A free agent that takes up a handed slice runs it with the slice's charter, and the board's `.plot-worker.continue.md` no longer holds a merged desk from the reaper.
- The board shows "build needs approval" for a run that waits for approval, and "head moved" for a run of a commit that is not the pushed one.

<!-- Board impact: Slices 3 and 4 change board server code; main rebuilds the shipped bundles after each merge. The board shows "build needs approval" again. No change to the plan format, the plan template or the docs/plans layout. -->

## Motivation

The JS worker loop replaced the shell loop in v2.24.0 (#1337). Four readings in it are wrong, and each one changes what the loop does next:

- **A host outage spends corrections.** A run that no runner took concludes `failure` with 0 steps. `checks-verdict.ts:137`, `:186` read it as a build failure, and `worker-loop.ts:808-818` hands the agent a correction for it (#1295).
- **`$20` removes the spend limit.** `dollarsOrUnset` (`packages/board/src/server/entry/worker-loop.ts:1656-1659`) reads `Number('$20')` as `NaN` and answers no limit (#1328).
- **A handed slice runs without its charter.** The JS loop resolves the charter once from the start-time `PLOT_AGENT` (`worker-loop.ts:1762`, `:2039`) and not at hand-over (#1169). The board writes `.plot-worker.continue.md` (`continue.ts:64`), which is not in `.gitignore` and is not excused in `plot-desk-dirt.sh:102`, so a merged desk that holds it is never reaped (#1166).
- **"Build needs approval" never shows.** `buildRun` is set only when the checks settle (`worker-loop.ts:821`), so the `waiting` arm of `buildFindingFor` (`checks-verdict.ts:234`) is dead. The "head moved" finding has no test. Stale comments name removed code (`plot-agent-manifest.sh:117-123`), 9 tests in `usage-limit.test.mjs` are always skipped by `shellOnly`, and `continue.ts:534` stops only the agent monitor (#1338).

## Design

### Approach

**One slice per fix, one branch per slice.** Each slice carries its own test and changeset, and a rebuild where it touches the board. The slices run in heading order, because a slice is eligible only when every prior slice has merged (`packages/domain/src/rules/eligible.ts:131-134`). Slice 1 comes first because a host outage can spend a slice's whole correction budget; slice 4 is last because its defect only hides a finding.

**Slice 1, a run no runner took (#1295).** A rule in `checks-verdict.ts` reads a run whose failed or cancelled jobs ran 0 steps, or carry the "not acquired by Runner" annotation, as `no-answer`. `checksFromRuns` keeps waiting, and the loop hands back no correction.

**Slice 2, the spend limit (#1328).** `dollarsOrUnset` accepts a leading `$` and a trailing ` USD`. A value it still cannot read is logged with the key and the raw value, and the loop refuses to start, because a cap that disappears in silence is worse than a stopped loop.

**Slice 3, the charter at hand-over (#1169, #1166).** The JS loop resolves the slice's `agent:` charter through `rules/prompt.ts` when it takes up a slice, and runs that prompt with the charter's prompt file, harness, model and effort. A slice with no annotation keeps the start-time values. A charter the loop cannot read refuses the slice, and the slice goes back to the queue. `.plot-worker.continue.md` goes into `.gitignore`, and `plot-desk-dirt.sh` excuses a root `?? .plot-worker.continue.md` line as it excuses `PLOT-CORRECTION.md`.

**Slice 4, a waiting run (#1338).** `buildRun` carries the run whenever the wait reads one, not only when it settles, so `buildFindingFor` answers `build needs approval` for `status: waiting`. A test covers "head moved". The slice also removes the stale comments at `plot-agent-manifest.sh:117-123`, the 9 `shellOnly` tests in `usage-limit.test.mjs`, and makes `continue.ts:534` stop the build monitor as well as the agent monitor.

### Open Questions

- [ ] Slice 1: should the loop re-run the workflow once after a run no runner took, or only wait? The plan waits, because a re-run spends CI minutes during a host outage.

## Slices

### A run no runner took is no answer

- `bug/a-run-no-runner-took-is-no-answer` — a 0-step or not-acquired run reads `no-answer` and spends no correction <!-- builds: the unacquired-run reading in checks-verdict.ts --> → #1353

### A spend limit reads its dollars

- `bug/a-spend-limit-reads-its-dollars` — `dollarsOrUnset` accepts `$20` and `20 USD`; an unreadable value is logged and refused <!-- builds: a dollar parser that never drops a cap --> → #1360

### A handed slice carries its charter

- `bug/a-handed-slice-carries-its-charter` — resolve the charter at take-up; ignore and excuse `.plot-worker.continue.md` <!-- builds: the charter resolved at take-up -->

### A waiting run needs approval again

- `bug/a-waiting-run-needs-approval-again` — `buildRun` for a waiting run, the head-moved test, the stale comments and skipped tests removed, continue stops the build monitor <!-- builds: buildRun for an unsettled run -->

## Done when

Each test below fails on `origin/main` (`a778bda0d`) today:

- Slice 1: `checksFromRuns` over a failed run with 0 steps answers `no-answer`, and the loop hands back no correction for it.
- Slice 2: `dollarsOrUnset('$20')` answers 20; `dollarsOrUnset('x')` is logged and refused.
- Slice 3: a free agent handed a slice annotated with a charter that names a model runs the prompt with `--model <that model>`; a merged desk that holds only `.plot-worker.continue.md` is reaped.
- Slice 4: a run with `status: waiting` gives the finding `build needs approval`; a run of another commit gives `head moved`.
- `node skills/plot/scripts/board/plot-local-checks.mjs` and the commands it prints pass on each branch.

## Notes

- 2026-10-07, direction from jwloka: the release train's open findings split by theme into four plans that run in parallel with each other, each slice as the triage on `a778bda0d` stated it; Type bug; reviewed in-session; own branches.
- The four plans `delivery-reads-one-source`, `the-fleet-loop-reads-its-runs-right`, `a-controller-owns-what-it-starts` and `the-tests-and-sweeps-leave-no-trace` replace the Draft plan `the-release-train-fixes-what-it-found`, which was never approved. Separate plans run in parallel, and the slices inside one plan run in order.
- Deliverable search, 2026-10-07:
  - Slice 1: no existing unacquired-run reading.
  - Slice 2: `dollarsOrUnset` is the only dollar parser (`worker-loop.ts:1656`, callers `:1825`, `:2074`).
  - Slice 3: no existing take-up charter resolution; `readAgentCharter` is called once at `worker-loop.ts:1762`.
  - Slice 4: `buildFindingFor` (`checks-verdict.ts:232`) has one caller (`worker-loop.ts:1437`).
