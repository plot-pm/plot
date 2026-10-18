# Desk markers and the reaper

> The reaper, the desk-marker readers and the fresh-agent start path hold ten open defects from ten closed issues. This plan groups them into four slices and re-checks each against main before any fix.

## Status

- **State:** Approved
- **Type:** bug
- **Issue:** #1843
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1976 merged
- **Started:** 2026-10-17, Jan Wloka, `bug/the-reaper-reads-the-desk-loop-and-the-root-marker`

## Changelog

- The reaper keeps a desk whose loop is alive between agents, and it matches `PLOT-BLOCKED` only as the desk-root marker.
- A fresh agent started without a marker gets a prompt that does not describe a question.
- Drop treats a merged desk as finished, not as waiting.

Board impact: none expected. The plan format, the template and the helper scripts keep their contracts. A slice that changes a row's wording or a *Waiting on you* membership says so and rebuilds the board artifact.

## Motivation

Issue #1843 is a tracking issue from a triage of all open issues against main at `c40ac9e96` (2026-10-16). It closed ten issues in its favour. Each one still describes work open on main (or partly open):

- #1300 — the monitor stop can cut a write short, and its command-line match is loose (all three findings open).
- #1386 — held-work fresh agent: endings from before #1371, `dirtyPaths` per candidate per tick (`registryd.ts:696`, `registryd-main.ts:511`), the empty `PLOT-BLOCKED` marker case, a duplicate test, TSDoc history.
- #1389 — a fresh start without a marker: the prompt still describes a question.
- #1393 — needs-a-person follow-ups: branch check for marker and start-fresh, PR body grep report, blocked wording, per-candidate `prOpen` call.
- #1394 — ending-ask record: merged desks, uncounted host call, record growth, `at`-field key.
- #1530 — the reaper removes a desk whose loop is alive between agents; the reaper and `--stop` must read `deskLoopAlive`.
- #1551 — the reaper can delete work in a file whose path contains `PLOT-BLOCKED`; only the root marker may match.
- #1552 — the reaper's dirty-tree kind hides a `PLOT-BLOCKED` path, and its temp sweep lacks tests (filter, changeset premise, `PLOT_BUDGET_HOME ||`, `lstat`).
- #1564 — drop reads a dead merged desk as waiting; it must apply `mergedDeskState`.
- #1784 — plot-review findings on PR #1748: an ok-seal after an answered blocked slice, and a possibly weak "full path" test in `clean-wait-end.test.ts`.

Two of them destroy work or a live loop (#1530, #1551), so those lead.

## Design

### Approach

Each slice first reproduces its issues' findings on main with a failing test. A finding that no longer reproduces is recorded in the slice's notes and closed without a fix. Fixes follow the layering rule: rules in `packages/domain`, readings through ports. `deskLoopAlive` (`rules/desk-loop-alive.ts`) and `mergedDeskState` (`rules/merged-desk.ts`) already exist, so slices 1 and 4 route callers to them rather than add rules.

### Open Questions

- [ ] Which of the ten findings still reproduce on main? The verdicts in the issue threads date from `c40ac9e96`. The slice measures this and records the answer here before changing code.
- [ ] Does #1784's "full path" test assert anything the surrounding tests do not? The issue says it was not re-checked. The slice measures this and records the answer here before changing code.
- [x] #1386's endings from before #1371: does a one-time sweep justify its code, or do those desks age out first? Decided 2026-10-17 by Jan Wloka: no one-time sweep; endings from before #1371 age out under the reaper's normal rules, and the slice counts how many exist today and records the number.

## Slices

### Reaper

- `bug/the-reaper-reads-the-desk-loop-and-the-root-marker` — #1530, #1551, #1552, #1300: the reaper and `--stop` read `deskLoopAlive`; the marker match is the desk-root file only; the dirty-tree filter and the temp sweep get their missing tests; the monitor stop finishes its write and matches its process exactly. <!-- builds: reaper tests for the root-marker match and the temp sweep -->

### Fresh agent

- `bug/a-fresh-agent-prompt-describes-no-question` — #1389, #1386: the start path passes the ending reason or a marker flag; no one-time sweep for endings from before #1371, whose count today the slice records; the prompt without a marker names no question; the empty `PLOT-BLOCKED` case; `dirtyPaths` read once per tick; the duplicate test and TSDoc history.

### Needs a person

- `bug/the-ending-ask-record-stays-bounded` — #1393, #1394: branch check for marker and start-fresh; merged-desk paging; the TSV prune and a single read; the `at`-field key; every host call counted; marker wording; one `prOpen` call per candidate.

### Drop

- `bug/drop-reads-a-merged-desk-as-finished` — #1564, #1784: drop applies `mergedDeskState`; `defaultPrIndex` doc placement and `readIndex` order; the ok-seal after an answered blocked slice.

## Notes

- Source: https://github.com/plot-pm/plot/issues/1843. The plan writes nothing to the tracker.
- The four slices touch separate call sites and have no declared order. The Reaper slice goes first, because it is the only one that can delete work.
- 2026-10-17: open questions decided by Jan Wloka: #1386 gets no one-time sweep; endings from before #1371 age out.
