## Implementation brief — a-desk-s-design-question-waits (wave 1: The unblocker runs)

- **Plan (canonical):** docs/plans/2026-11-03-a-desk-s-design-question-waits.md on main
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3067 merged
- **Branch:** `feature/fleetd-starts-the-unblocker` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot/review` on the PR, per repo convention

Waves 2 (`bug/an-answer-records-its-true-author`) and 3 (`feature/an-escalated-question-reaches-the-issue`) wait on this slice; wave 3 reads the `escalated <reason>` rows this slice writes.

### What to build

The unblocker never runs in production. On 2026-11-03 the desk on `feature/the-scan-script-is-a-launcher` (PR #3048) wrote `PLOT-BLOCKED`, nobody answered, `plot-reap` copied the marker to `refusals.tsv` row 16 and reaped the desk. Measured on `origin/main`: the one tick call in `registryd-main.ts` (around line 2930) passes no `unblock`; `applyUnblockDecisions` (`registryd.ts:1575`) has no production caller; `answers.tsv` holds 1501 rows and none is `started`.

Build, on top of what exists:

1. fleetd's tick receives an `UnblockWorld`, and fleetd calls `applyUnblockDecisions` on the tick's `unblock` writes with real ports. `UnblockPorts.run` starts the `unblocker` role through `roleCommand` (`packages/domain/src/rules/role-command.ts`); `start` is `continueOnDesk`; `record` is `AnswerRecordStore.append`. The role gate (`rules/role-gate.ts`) still applies. Export the options builder `registryd-main` uses, so a test can call it.
2. `unblockOutcome` in `packages/domain/src/rules/unblock-outcome.ts`: a zod schema plus a pure mapping from run output to `answer`, `escalate` or a refusal. First line `ANSWER` (rest is the text) or `ESCALATE: <reason>`. Anything else, `ANSWER` with no text, `ESCALATE:` with no reason, empty output: refusal `unparseable-run`. Change `UnblockPorts.run` to return the raw output; the adapter reads, the domain parses.
3. Every apply ends in exactly one recorded outcome (rows through `AnswerRecordStore.append`; the `outcome` column is a free string): `ANSWER` and `continue` started gives `started` before the start; `ESCALATE: <r>` gives `escalated <r>` and no `continue`; unparseable gives `refused unparseable-run`; `continue` refused gives `refused <reason>` after `started`; run failed, spawn failed or threw gives `failed <detail>`. `started` is never the last row of a finished apply.
4. At most one unblocker run in flight across the fleet: a tick starts a run only when no `started` row is open, and takes the waiting question with the oldest marker first.
5. `unblockerDue` refuses `answer-cap` once the branch holds `Correction budget` rows with outcome `started`; the applier records `escalated answer-cap` for that question.
6. Rewrite `.claude/agents/unblocker.md`: drop "Never answer 'wait for a person'" and "still answer the question asked"; require the `ANSWER` / `ESCALATE: <reason>` first line; state the class line (answers alone when plan, brief or code decides; always escalates `scope`, `test`, `plan`, `rule`); add "never widen the scope guard" and "never tell the desk to weaken, skip or delete a test" to the hard rules.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

- **No new store and no new recipient field.** `questionEscalation` reads `escalated`, `refused` and `failed` like any outcome other than `started` (it returns no rung only while the last outcome is `started`, `question-escalation.ts:60`), so the existing ladder (`listed`, `notified-N`, `escalations.tsv`, `Notify command`) takes the question. A new store would be a second place a person must look.
- **Retries are bounded by the record, not by a counter.** `unblockerDue` already refuses `already-recorded` for any row on the question key (`unblocker-due.ts:68`). Today a failed run records nothing and retries every tick (`registryd.ts:1559-1561`); recording `failed` is the whole bound. A desk that blocks again writes a new `askedAt`, a new key; the answer cap bounds that loop.
- **The choice between answer and escalate is the model's and is not unit-tested.** Tests cover the mapping from a typed result to one recorded outcome. A mechanical check that refuses an `ANSWER` naming a path outside the scope guard is not adopted in this plan (safety juror's amendment 4); do not add it.
- **#2901's tests inject `unblock` into the tick, so they pass while production never runs the pass.** A test that injects the dependency cannot prove wiring: the first test below calls the production builder.
- **Out of scope:** the `author` default in `continuation.ts:1502` (wave 2), the issue comment and the *Waiting on you* reason (wave 3), and checking a brief's claims against the code (deferred out of this plan).
- Rules this repo keeps re-learning: absent is not false; read the exit code, not the emptiness. Domain code is arrows (`export const f = ...`), TSDoc states what an export does and how it fails, not why it was decided. Controllers call the domain; only an adapter spawns.

### Done when

The plan's `## Tests` list for Slice 1 is the specification. Each test fails on `origin/main` before this slice. The assertions that exist because a naive implementation would pass without them:

- The production-built options builder returns a defined `unblock`, and a tick with an untagged marker on a waiting desk yields one `unblock` write, one `run` call and a `started` row. Catches a wired-in-tests-only implementation.
- `applyUnblockDecisions`, one case per row of the outcome table, asserting the exact row appended and whether `start` was called. Catches a `failed` or `escalated` path that appends nothing, and a refused path that leaves `started` last.
- After a `failed` row the next tick starts no run for that key. Catches a retry loop.
- A branch with two `started` rows on earlier keys gets `answer-cap` and an `escalated answer-cap` row.
- Three waiting desks and no open run start exactly one run, on the oldest marker; a second tick while that run is open starts none.
- The #3048 fixture: commit `refusals.tsv` row 16's question text (2026-11-03T09:21:39Z, `feature/the-scan-script-is-a-launcher`, in the operator's checkout) as a test fixture. A stub run returns `ESCALATE: scope test`; tick plus applier writes `escalated scope test`, calls no `continue`, and the next tick's `questionEscalation` returns a new `notified-1` rung past the first age.
- `unblockOutcome`, one vitest case per input: `ANSWER` with text; `ESCALATE: scope adds a slice`; `ESCALATE:` with no reason; `ANSWER` with no text; free prose; empty output.

Plus: a changeset (description first, `bumps:` last, package `plot`, named by `check-changeset-packages.sh`). For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite and not `test:e2e`. `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base: if this slice touches a `.sh` file, pay for growth in the same change by removing shell elsewhere or writing the rule in the domain; the gate counts commands, not lines, and has no override. The purity gate (domain imports `zod` only outside `adapters/`) and the spawn ratchet (`allowed=28`, must not grow) apply.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/fleet/src/server/entry/registryd.ts`, `registryd-main.ts`, the unblock options builder, `packages/domain/src/rules/unblock-outcome.ts` and `unblocker-due.ts` (and their tests), `.claude/agents/unblocker.md`, and the new fixture. Not this branch: `packages/fleet/src/shared/continuation.ts` author default and the board continue route (wave 2), `Tracker.issueComment` and the *Waiting on you* row (wave 3). Another approved plan, `fleetd-merges-no-slice-pr-while`, also touches fleetd's tick; check `git diff origin/main` on `registryd-main.ts` before rebasing and report a collision rather than resolving it by guess.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
