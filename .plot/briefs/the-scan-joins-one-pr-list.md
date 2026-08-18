# Brief: bug/the-scan-joins-one-pr-list

Implement wave 1 of
`docs/plans/2026-08-18-the-scan-asks-once-not-once-per-branch.md`.

Read it first. The measurements are settled — **do not re-derive them.**

## The bug

`plot-fleet-scan.sh` resolves PR state **per branch** (`host_pr_state()`,
line 399, called from 430, 447 and 912). Each call is one `plot-host.sh
pr-state`. Measured on this repo, on GitHub, 2026-08-18:

```
branches in the scan:   84
one pr-state lookup:    438 ms
84 x 438 ms:            ~37 s      ← observed: 34 s
one pr-list (all PRs):  1107 ms
```

The board's `run()` helper times out at **30 s** (`fleet.ts:260`), so the live
board has been serving a pulse **644 seconds old** while reporting
`Command failed`. The operator's view was stale for over ten minutes and the
reason was invisible.

On Bitbucket it is worse and was reported first (issue #228): 39 requests for
14 branches, because `bb` has no `all` state and each `pr-state` costs up to
three calls. The scan did not finish inside 110 s there.

**One list answers what 84 lookups take, and is 30x faster.**

## What to build

The scan needs `branch → state` for a **known set** of branches. That is a join
over one response, not N lookups: `plot-host.sh pr-list` already returns every
PR the repo has.

## Do not

- **Do not remove the per-branch call entirely.** PR #216's host lookup for a
  branch with **no ref** must stay: it asks about a specific branch that a
  repo-wide list may not contain. It is bounded by absent branches, not by all
  branches, and a test pins its placement in the no-ref arm.
- **Do not let an empty join read as "no PR".** A list that never arrived and a
  list with nothing in it must not render identically. `plot-host.sh` already
  separates a lookup miss (exit 0, `NONE`) from a transport failure (non-zero) —
  that distinction was added 2026-08-17 when GitHub returned 503 all afternoon
  and every branch read as having no PR. A join is the same trap in a new shape.
- **Do not change the three-way state vocabulary** each branch resolves to.

## Two open points you must answer

Both are flagged in the plan. Decide, implement or explicitly defer, and **say
which and why** in the PR:

1. Does `pr-list` return closed/declined PRs by default on both hosts? The join
   needs the same vocabulary `pr-state` produces; if the list omits a state,
   the join silently loses branches.
2. Is the repo-wide list bounded? A long-lived repo may have thousands of PRs,
   and paging turns one request back into N. **Measure before assuming.**

## Definition of Done

- A scan over N branches makes a **constant** number of host calls, asserted by
  counting invocations of a stubbed host. The measured failure is 39 calls for
  14 branches — a test that does not reproduce that against the unchanged
  script is not testing this (verify by stashing)
- A failed list still reads as failure, never as "no PR"
- The no-ref lookup from #216 still runs, and its ordering test still passes
- The scan completes **well under** the board's 30 s timeout on this repo
- `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:e2e`,
  `pnpm run test:board` pass — run the suites **one at a time**
- A changeset with a `bumps:` block

## Coordination

Three sibling branches belong to this plan and are **not yours**: caching
terminal branches, incremental rendering, and the cadence. Yours is the join in
`host_pr_state()` and its call sites.

`bug/not-started-shows-approved-plans` is in `packages/board/src/` — disjoint.

## Platform note

CI runs Linux; you are probably on macOS. Faults caught this way: `stat -f`
does not fail cleanly on GNU (it prints to stdout and *then* exits 1), and
`/usr/bin:/bin` is not an isolated PATH because CI ships a real `gh` there.

If you find something the plan did not anticipate, implement what you can and
**report the discovery** rather than improvising.
