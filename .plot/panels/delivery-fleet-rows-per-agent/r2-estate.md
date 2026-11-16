# Round 2, Estate lens

Position: amend

Looked at (grep and read, no suites run): the plan, its five Delivery siblings, delivery-placement.ts, delivery-row-form.ts, board agent-rows/delivery-readings.ts, contract/schema.ts AgentEntrySchema, fleet.ts, entities/slice-spend.ts, auto-review.ts, fixer-attempts.ts, AgentList.tsx.

Verified true: AgentRole has six roles (delivery-placement.ts:92); `agent.role ?? 'loop'` (delivery-readings.ts:302) and `blockedOn` is only `person` (:303); FIXER_BOUND_SECONDS and FIXER_ATTEMPTS_BUDGET (fixer-attempts.ts:5,8); REVIEW_BOUND_MS 3_600_000 (fleet/shared/auto-review.ts:64); Worker bound read gated by anyFreeWaitEnded (fleet.ts:8619); "no manifest names this desk" at desk-manifest.ts:261 and desk-lifecycle.ts:211; the test an-unnamed-desk-says-so.browser.test.ts exists; AgentList.tsx has the switch strip, `#fleet-controls` and the "Tickets and plan runs" block; no plan sibling builds the role chip or a second Fleet header.

Concrete problems:

1. The plan says `AgentRowFacts` and "agent rows get a column set of their own" as if no agent-row form exists. It does: `agentRowCells` (delivery-row-form.ts:312) already returns a seven-cell `RowCells` for an agent, with `kind: link(placement.role)` as the role cell. The slice must extend or replace that function, and the role chip must replace that `kind` cell; the plan names neither and does not say `RowCells`/`RowColumn` stay the shared type. Fix: name `agentRowCells` as the function the agent-rows slice replaces and say what happens to `RowColumn`.

2. Existing readings the plan does not cite. `AgentEntry` already carries `startedAt` (schema.ts:4000) and `lastActivity` (:4057). The plan states the time-left bar "needs the run's start time" and names a gap only for design and verify; for a loop agent it never says `startedAt` is the start. `lastActivity` is a candidate for Doing now and goes unmentioned. Fix: name `startedAt` as the loop/fixer start reading and decide whether `lastActivity` is the Doing-now fallback.

3. `DeliveryGate` (delivery-placement.ts:27) already holds `ci`, `review`, `machine`, `rate-limit`, `person`, and `agentRowCells` already maps `blockedOn === 'ci'` to a "CI" state cell. The plan's "the agent-rows slice adds `ci` and `rate-limit`" is a reading addition to `delivery-readings.ts`, not a new gate. The board already folds `ciChecks` to pending/running in `ciOf` (delivery-readings.ts:99-110); the new `ci` reading should reuse it, since plan 3 (work-items-show-gates) reads the same `ciChecks` for its gate marks. Fix: say Waits on `ci` reuses `ciOf` and does not fold `ciChecks` a second time.

4. Stale citation: Open Points cites `slice-spend.ts:57-60` for the "up to 7.7 MiB, 90 to 250 ms" transcript fold. Lines 57-60 of entities/slice-spend.ts are a models comment. The 7.7 MiB figure is at packages/board/src/server/entry/slice-spend.ts:23. Fix: correct the path.

5. `brief-ask.ts:105-107` is packages/fleet/src/shared/brief-ask.ts, a second brief-ask.ts exists under packages/board/src/server/. Name the package. `auto-review.ts:63` is in packages/fleet, which the domain cannot import; the reviewer bound constant must be passed in as a value or redeclared in the domain, and the plan does not say which.

Not found: no existing role chip, per-agent time-left reading, or per-run output-token reading in the estate; the plan's claim of gaps holds for those.
