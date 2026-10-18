## Implementation brief — desk-markers-and-the-reaper (wave: Reaper)

- **Plan (canonical):** [docs/plans/2026-10-17-desk-markers-and-the-reaper.md](../../docs/plans/2026-10-17-desk-markers-and-the-reaper.md) on `main`
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1976 merged
- **Branch:** `bug/the-reaper-reads-the-desk-loop-and-the-root-marker` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review app, required on `main`)

This is the first of four slices with no declared order between them. It goes first because it is the only one that can delete work. Fresh agent, Needs a person and Drop touch separate call sites and do not wait on it.

### What to build

The reaper removes work it should keep, in two ways, both tracked in #1843.

- **#1530:** it removes a desk whose loop is alive between two agents. `rules/desk-loop-alive.ts` already answers *does this desk hold a live loop* (`deskLoopAlive`, `:77`), and `packages/fleet/src/shared/desk-loop.ts:87` already calls it. The reaper (`packages/board/src/server/entry/reap.ts`) and `--stop` do not. Route both to it. Add no new rule.
- **#1551 and #1552:** the reaper matches `PLOT-BLOCKED` as a substring of any path. `reap.ts:626` and `:1014` filter dirty paths with `!p.includes('PLOT-BLOCKED')`, so a tracked file such as `docs/PLOT-BLOCKED-notes.md` with edits reads as "only a marker" and the desk is removed with that work. `reap.ts:617` calls `trees.markers(path, 'PLOT-BLOCKED')` with a prefix, which has the same breadth. Only the desk-root marker file (`PLOT-BLOCKED.md` at the worktree root) may match. #1552 adds that the dirty-tree kind hides a `PLOT-BLOCKED` path.
- **#1552 tests:** the temp sweep has no tests for its filter, the changeset premise, the `PLOT_BUDGET_HOME ||` fallback (`reap.ts:450` uses `??`, which keeps an empty string) and `lstat`.
- **#1300:** the monitor stop can cut a write short, and its command-line match is loose. Locate it first (`skills/plot/scripts/plot-agent-monitor.sh` is the starting point; the plan names three findings, all open on 2026-10-16). It must finish its write and match its process exactly.

The plan is canonical. This brief is orientation.

### Settled decisions — do not re-derive them

- **Reproduce first.** The plan's approach: each finding gets a failing test on main before any fix. A finding that no longer reproduces is recorded in the PR body and closed without a fix. The verdicts in the issue threads date from `c40ac9e96` (2026-10-16), so re-check, do not trust them.
- **Rules in the domain, readings through ports.** `deskLoopAlive` exists, so the slice routes callers to it. A new `spawn` or `execFile` outside `adapters/` raises the CI ratchet (`allowed=28`); the reaper gains no new `git` call.
- **The marker match is the root file, not a pattern.** A prefix or substring match cannot tell a marker from work, which is the defect. Do not widen it to cover `PLOT-BLOCKED*` variants that exist today without checking `agents-fs.ts:148` `readMarkers`, which other readers share. The same filter lives in `rules/reapable.ts:48` and `workflows/reap.ts:15,63`; keep them in agreement.
- **Absent is not false.** A loop reading that cannot be taken (no pid file, unreadable manifest) means *keep the desk*, never *remove it*. `deskLoopAlive` treats unreadable input as alive for this reason.
- **Read the exit code, not the emptiness** of a command's output.
- **Arrow functions.** Any function you write or rewrite is an arrow, in the board too.
- **TSDoc is factual.** Say what an export does, returns and how it fails. Put the reasoning in the commit message.

### Done when

The plan's slice line is the specification: the reaper and `--stop` read `deskLoopAlive`; the marker match is the desk-root file only; the dirty-tree filter and the temp sweep have their missing tests; the monitor stop finishes its write and matches its process exactly.

Assertions that exist because a naive implementation passes without them:

- A desk with a live loop and no agent running is kept by the reaper and by `--stop`. Catches: reading only the agent pid.
- A desk with uncommitted edits to a file whose path contains `PLOT-BLOCKED` (not at the root) is kept. Catches: swapping `includes` for `startsWith` on the path.
- A desk with only the root `PLOT-BLOCKED.md` untracked is still reported as waiting. Catches: over-narrowing so the marker case regresses (`reap-dirty-kind.test.ts:98` holds it).
- `PLOT_BUDGET_HOME=''` falls back to the default. Catches: `??` versus `||`.
- The temp sweep does not follow a symlink. Catches: `stat` in place of `lstat`.

Plus: add a changeset (description first, `bumps:` block last). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite locally and do not run `test:e2e`.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. If the monitor fix touches `plot-agent-monitor.sh`, pay for growth in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override. Do not commit a rebuilt board bundle (`scripts/check-no-bundle-diff.sh`).

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

Owned: `packages/board/src/server/entry/reap.ts`, `packages/board/test/unit/reap-*`, `packages/domain/src/rules/reapable.ts`, `packages/domain/src/workflows/reap.ts`, `packages/domain/src/rules/desk-loop-alive.ts` (call only), the monitor-stop code (#1300), and their tests.

Other slices of this plan: `bug/a-fresh-agent-prompt-describes-no-question` (registryd, continuation), `bug/the-ending-ask-record-stays-bounded` (needs-a-person record), `bug/drop-reads-a-merged-desk-as-finished` (drop, `mergedDeskState`). Stay out of their files. Open Questions in the plan (which findings still reproduce) are answered per finding by your failing tests.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
