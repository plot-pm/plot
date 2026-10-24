## Implementation brief — an-agent-refused-every-write-ends (wave 2: Blocker)

- **Plan (canonical):** `docs/plans/2026-10-24-an-agent-refused-every-write-ends.md` on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2509 merged
- **Branch:** `bug/loop-writes-blocker-for-refused-agent` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Waits on wave 1 (`bug/refused-writes-end-as-permission-denied`), **merged** as PR #2545. Its `permission-denied` `EndingReason` is on `main`: `packages/domain/src/workflows/agent-loop.ts:867` already ends a claim-only, denial-only turn with `end(worktree, branch, 'permission-denied', 'agent', 'the claim is pushed, nothing else is, every write was refused', 0)`. Wave 4 (`bug/claim-only-branch-returns-to-queue`) waits on wave 1 too, not on this branch; wave 3 (`bug/fleet-start-probes-worker-writes`) waits on neither.

### What to build

Observed 2026-10-23 in ewz-kus-portal: three agents, every Edit/Write/Bash call refused (13, 5, 4 denials), none could write `PLOT-BLOCKED.md` to report it — the blocker channel is itself a file write, and a write-refused agent cannot use it. Today the loop's own `permission-denied` ending carries a fixed, generic `detail` string and attaches no `declaration` write. A person only learns the cause later, and only generically: `registryd.ts`'s fresh-agent tick (`markerTextFor` → `needsPersonMarker`, `rules/ending-action.ts:515`) already composes a `PLOT-BLOCKED.md` body for `permission-denied` — `"The worker on `branch` was refused every write it tried (<detail>). A fresh session would meet the same refusals..."` — and writes it via `escalate`/`markerText` (`registryd.ts:940-965`, `:1211`), but only on **its own next tick**, after the desk already carries no marker, and always with that one fixed sentence. The design calls this "the loop holds the permission the agent lacks": the loop process itself (not the registry/supervisor process) must write `PLOT-BLOCKED.md` immediately, in the same pass that reaches the `permission-denied` arm, carrying the agent's own final words rather than the generic fallback.

Two things are missing, found by reading `agent-loop.ts` end-to-end on 2026-10-24:

1. **No field carries the agent's final message into this arm.** `AgentLoopReadings` has `handBackSummary` ("the hand-back's own summary") for the `blocked` hand-back row (`:813`, `blockedDeclaration(worktree, branch, readings.handBackSummary || 'the agent handed back blocked')`), but a `permission-denied` turn never reaches a hand-back — the agent was refused the write that would compose one. The port-level field that exists and is unused here is `AgentRun.finalText` (`ports/agent-run.ts:189-193`): "the run's final answer as text: the SDK result's `result` on a successful SDK run; on the `command` runner, the output the command appended to its log during this run." Thread it (or an equivalent reading) through to a new field on `AgentLoopReadings`, read only where `permissionDenials === 'yes'`.
2. **The `permission-denied` `end()` call attaches no `declaration` write.** Compare `:866-868` to every sibling ending (`:803`, `:813`, `:374`, `:397`) — each of those passes `[blockedDeclaration(worktree, branch, <summary>)]` as `end()`'s sixth argument; the `permission-denied` arm passes none. Add it, built from the new final-message reading (falling back to the existing fixed detail string only where the harness answered no final text — a denial-heavy run can still end with no readable output).

`blockedDeclaration` (`:330-336`) already builds the right `Write` shape (`{ kind: 'declaration', status: 'blocked', summary }`), and `performLoopWrites` (`packages/fleet/src/server/entry/loop-writes.ts`) already routes a `declaration` write to `ports.desk.writeBlockedMarker` — confirm this at the `declaration` arm in `loop-writes.ts`, but by the `LoopWrite` type alias (`:21-36`, includes `'declaration'`) the carrying mechanism is already built. This slice is the decision to use it here, not new plumbing to a new sink.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**This is additive to wave 1's arm, not a new classification.** Wave 1 decided *when* a turn ends `permission-denied`; this slice decides only what gets written once it does. Do not touch the `commitBeyondClaim`/`permissionDenials` guard at `:860-865` — that condition is wave 1's, tested there, and reopening it duplicates work already merged.

**The loop writes the marker, not the registry.** `registryd.ts`'s `markerTextFor`/`escalate` path is the existing fallback for every `needs-a-person` ending with no desk-side marker yet — it stays as the safety net for endings that truly cannot write their own (and for a `permission-denied` turn whose harness gave no final text at all). This slice does not touch `registryd.ts`; adding the loop-side write makes that path redundant for the common case, which is the point, not a conflict to resolve.

**Do not invent a second source for the agent's words.** The plan's Motivation is explicit that the agent "could not write `PLOT-BLOCKED.md` either" — nothing here routes around a refused write; it reads what the harness result already reports (`finalText`) rather than re-prompting the agent or re-reading the session transcript from the domain. Wave 1's brief measured that `PromptExitInput.output` (`rules/prompt-exit.ts:48`) holds only "the last lines of the prompt's output" and is a different field from `finalText`; if `finalText` turns out not to carry anything useful for the observed refused-write shape, say so in the PR rather than falling back to a transcript read from the domain layer (layering rule: controller → domain → port ← adapter — the domain takes this as a value in `readings`, the way `commitBeyondClaim` already is, never reading a file itself).

**Layering holds exactly as wave 1 left it.** The new reading is a value on `AgentLoopReadings`, filled by the caller (the fleet-side entry point building readings for `agentLoop`) from the adapter's `AgentRun` result, same as every other reading. `agent-loop.ts` does not import an adapter or read a transcript path.

### Open question this slice must answer, and say so in the PR

Is `AgentRun.finalText` actually populated for the observed refused-write shape — every tool call denied, zero worktree change? The port's doc comment describes it generically; wave 1's own open-question answer found no existing reader of `permission_denials` outside `agent-run-sdk.ts`'s `permissionDenialsOf`, so whether `finalText` and `permission_denials` arrive together on the same result message, for the same kind of run that produced the three ewz-kus-portal agents, has not been checked by either slice. Read `agent-run-sdk.ts`'s result-message handling (`:445-555`) to confirm `finalText` is set on the SAME message `seen.permissionDenials` is read from, and say what you found in the PR description. If the harness genuinely gives no final text for a fully-denied run, the marker still writes — from the existing fixed detail string — and that is a valid, smaller outcome; do not block the slice on inventing text the harness never gave.

### Done when

The plan has no `## Done when` list; its Changelog line and Motivation are the specification: *the loop writes `PLOT-BLOCKED.md` from the agent's final message when a turn ends `permission-denied`.* Assertions a naive implementation would pass without:

- A `permission-denied` ending now carries a `declaration`/`blocked-marker` write in the writes `agentLoop` returns — not just the `loop-end` write it had before. Catches a change that updates `detail` text but still attaches no marker.
- The marker's `summary` is the agent's final text where the harness supplied one, not always the fixed `"the claim is pushed, nothing else is, every write was refused"` string. Catches a fallback-only implementation that reads the new field but never threads it through.
- A `permission-denied` turn where the harness answered no final text still gets a written marker (the existing fixed string), never a dropped write. Catches an implementation that only writes when `finalText` is present.
- `loop-writes.test.ts`-style coverage: `performLoopWrites` applied to this ending's `declaration` write calls `desk.writeBlockedMarker`, through the existing fixture ports — no new `LoopWritePorts` member needed, since `declaration` is already a `LoopWrite` kind.
- The `permissionDenials === 'no'`/`'unanswerable'` arms (every other ending this function reaches) are unchanged — no new reading is read outside the `permission-denied` arm. Catches a reading that leaks into endings that never had this problem.

Plus: a changeset (`'@plot-pm/board'` and/or `plot`, description first, `bumps:` block last; `./scripts/check-changeset-packages.sh`). Domain code stays arrow functions with factual TSDoc, no decision history in comments. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction — run no full suite locally. `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base; this slice should touch no `.sh` file (the change is domain + fleet TypeScript and its tests), and if it does, remove shell elsewhere in the same change or write the rule in the domain and ask it through a bundle.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. Append `→ #<number>` to this branch's line under `### Blocker` in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the `permission-denied` arm in `packages/domain/src/workflows/agent-loop.ts` (the `end()` call at `:866-868` and the `AgentLoopReadings` field it reads), whatever reads `AgentRun.finalText` into that reading on the fleet side, and their tests.

Not this branch: the `permission-denied` classification itself (wave 1, merged in PR #2545 — do not reopen `:860-865`), the start-time write probe in `plot-fleet` (`bug/fleet-start-probes-worker-writes`), and any claim release, ref pruning or desk reaping (`bug/claim-only-branch-returns-to-queue`, which touches a destructive path and must read `mergedAt`).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
