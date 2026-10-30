## Implementation brief — a-high-finding-is-fixed-before (wave 1: Fixer attempts record)

- **Plan (canonical):** docs/plans/2026-10-29-a-high-finding-is-fixed-before.md on main
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2912 merged
- **Branch:** `feature/the-fixer-attempts-record` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** `plot/review` on the PR, per the plan's `Review: pr`

This wave blocks the other two. `feature/fleetd-starts-the-fixer` writes and reads this record before it starts a fixer, and `feature/an-unfixed-high-is-ticketed` reads the attempt count to gate the accepted `success`. It waits on nothing. The files that wave 2 depends on (`rules/slice-pr-next.ts`, `rules/desk-dead.ts`) do not exist on main yet and this slice does not need them.

### What to build

A per-PR record of fixer attempts under `.plot/state/` in the common git dir. Each attempt holds the head SHA it was started for, the finding it answered (a hash of the HIGH findings, or `ci` with the run id), and an in-flight mark with pid and start time. The domain owns the decode and the port; one adapter writes the file.

The failure it prevents: nothing writes a fixer attempt today, and a fixer runs in its own worktree, so `deskLoopAlive` (`packages/domain/src/rules/desk-loop-alive.ts:77`) answers `none` for the desk while the fixer runs. With no record written before the start, the next tick or a restarted fleetd starts a second fixer on the same PR.

The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

- **The attempt and its in-flight mark are written BEFORE the start.** The caller (wave 2) refuses the start when the write does not land. A crash between the write and the start spends an attempt and adds no writer. Reversing the order (start, then record) is the alternative this rejects: a crash after the start leaves a running fixer and no record, so a restart starts a second one.
- **A fixer that ends without a push spends its attempt.** Do not model "attempt refunded".
- **Missing or unreadable record reads as zero attempts. An unreadable in-flight mark HOLDS.** These are different answers on purpose: zero attempts is the safe direction for the budget, but reading an unreadable mark as "no fixer in flight" starts a second fixer. The repo's invariant applies: absent is not false.
- **Keyed per PR, not per head.** The budget is two attempts per PR across all heads. A per-head key would grant a fresh budget on every push.
- **Layering.** Controller, then domain, then port, then adapter. The domain owns the port as an `interface` with no runtime code and imports no adapter; the adapter is the only place that touches the file. `packages/domain/src/adapters/fleet-state/fleet-state-file.ts` and `adapters/reader-lock/reader-lock-file.ts` are the precedent shapes. The domain takes readings as values, not ports, in its rules (`reap(readings, input)`).
- **Arrow functions** for everything you write in `packages/domain/**`. TSDoc states what the export does, its parameters, what it returns and how it fails — no decision history. Reasoning goes in the commit message.
- **Vocabulary.** Agent is the actor; "worker" is only the process. Use Slice, never new `Wave` names, in new code.
- **One writer.** The record has exactly one writing place, and a test holds that (see `one-issue-index-writer.test.ts` for the shape).
- **Answers, never verdicts.** The record holds what happened (SHA, finding hash, pid, start time). It holds no derived state such as "attempts spent" or "fixer in flight"; those are derived fresh from it.

### Done when

The plan's slice line for this wave is the specification. Lift these assertions, each of which a naive implementation passes without:

- A missing file and a corrupt file both read zero attempts (catches a decode that throws or returns `null` and blocks the start forever).
- An unreadable in-flight mark answers hold, distinct from "none in flight" (catches collapsing the two).
- The write returns a failure the caller can refuse on when the file cannot land (catches a swallowed write error that lets a fixer start unrecorded).
- Two attempts on different heads of one PR count as two (catches a per-head key).
- A wrong-version record reads as unreadable, not as an empty one.

Plus: add a changeset (description first, `bumps:` block last; `./scripts/check-changeset-packages.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. This slice touches no `.sh` file; if it does, `scripts/check-shell-lines.sh` refuses growth, so remove shell elsewhere or write the rule in the domain. Do not commit a rebuilt `board-server.mjs`.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the attempts-record port, its decode and its file adapter under `packages/domain/`. It owns nothing in `packages/fleet` or `packages/board`: the arms and tick belong to `feature/fleetd-starts-the-fixer`, and the ticket record, `reviewStatus` and the tracker export belong to `feature/an-unfixed-high-is-ticketed`. Do not touch `review.ts`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
