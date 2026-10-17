# Flaky process-timing tests

> Five tests that race a child process against a timer or a pid file wait on the process itself, so a loaded machine no longer turns main red.

## Status

- **State:** Approved
- **Type:** infra
- **Issue:** #1850
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1981 merged

## Changelog

- Tests: the process-timing tests named in #1850 wait on the event they depend on (pid line written, signal delivered, first poll) instead of a fixed margin, and fail on a real defect only.

<!-- Board impact: none. Test files only; no plan-format, template, helper-script or board change. -->

## Motivation

Issue #1850 collects five open flaky-test reports, triaged against `main` at c40ac9e96 on 2026-10-16. Each races a child process against a timer or a file write:

- **#1544** — the temp-path kill test keeps a 2 s margin under its grace period (`test/reconcile/temp-paths-gate.test.mjs`, `packages/domain/test/run-script.test.ts`). Both findings in the issue stay open.
- **#1594** — the KILL-after-TERM test waits for TERM to arrive. Findings L1 (bound the loop or race it with a timer) and L2 (optional).
- **#1676** — the process-group stop test reads `child.pid` before the pid is written. The fix: wait for the whole pid line, and write the pid through a temporary file then `mv`.
- **#1678** — the old-label migration test (`packages/domain/test/old-label-migration.test.ts`) times out its 1 s unload bound and turns main red. The fix: raise the bound, or make the stub answer "gone" on the first poll.
- **#1704** — `packages/board/test/unit/continue-route.test.ts`, "increments relaunches across TWO relaunches", fails on a docs-only commit under load. The cause is not known. It is also not verified whether #1802 (`maintenance.auto=false`) already removed it.

A later green run is no evidence for any of these, so each fix needs a cause and a test that fails without the fix.

## Design

### Approach

Group the five by mechanism, not by issue:

1. **Wait on the event.** Replace a fixed margin or bound with a wait on the thing the test needs: the whole pid line (#1676), the delivered signal (#1594), the first poll (#1678). Write pid files through a temporary name and `mv` so a reader never sees a partial line.
2. **Bound every loop.** A loop that waits for a child gets an upper bound or races a timer (#1594 L1), so a hung child fails the test and does not stall the suite.
3. **Find the cause of #1704 first.** Reproduce under load (a Linux container with `--cpus=4`, per the repo's CI-only reproduction note), and check whether #1802 removed the failure before changing the test.

No domain or board source changes are planned. If #1544 shows the grace period itself is too tight in production code, that finding becomes its own plan.

### Open Questions

- [ ] Does #1704 still fail on `main` after #1802, or is it already fixed?
- [ ] Does the temp-path kill test (#1544) need a different grace value, or a wait on the kill?
- [ ] Do the five fixes ship as one branch or as one branch per mechanism?

## Slices

### Implementation

- `infra/flaky-process-timing-tests` — fix the five tests named in #1850, one commit per issue, each with a stress run that fails without the fix

## Notes

- Draft created from issue #1850 by `/plot-idea`. Tracker untouched; the `Issue:` field is the only link.
- Definition of Done: docs/definition-of-done.md
