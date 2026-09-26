# A dispatch does not hold the loop

> `POST /api/dispatch` waits synchronously for `/plot-implement`, bounded at **five minutes**, and the board answers nothing for the duration. The block is deliberate — it is the brief gate — and the decision that licensed it priced a write route at *"two seconds"*. Measured 2026-09-26: the port holder sat at **0.0% CPU** while every request timed out, and the page told the operator to restart a server that was alive.

## Status

- **State:** Approved
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1012
- **Sprint:** plot-works-in-the-repos-that-adopt-it
- **Rounds:** 1
- **Approved:** 2026-09-26, Jan Wloka, in-session after panel (round 1)

## Changelog

- A dispatch stops holding the event loop while `/plot-implement` writes the brief. The board keeps answering, and the brief gate's refusal still reaches the operator.

Board impact: **entirely board**, and it changes the route's contract — see the Design section. No scan change, no domain rule.

## Motivation

### Measured 2026-09-26

While a dispatch was in flight:

```
GET /api/board     → 000 (timeout)
port 7777 holder   → pid 728
its CPU            → 0.0%
```

**0.0% CPU while holding the port.** Not busy — blocked. The browser showed *"No contact with the board server for 8 polls"*, *"Fetch is aborted"* and *"Cannot load plan"*: one cause, three symptoms.

### The block is deliberate, and it is the brief gate

`dispatch.ts:337`:

> Run the implement command **SYNCHRONOUSLY and wait for it to complete. This is the brief gate:** the dispatch proceeds only if the implement succeeds.

`dispatch.ts:382` reads `implResult.status` and answers **409 `implement-failed`** on a non-zero exit, before the dispatch spawn at `:437` ever runs. The gate's reason is stated at `:313`: *"A worker without a brief spends its first hour re-deriving what the plan already says."*

**An earlier draft of this plan proposed converting `:356` to an async `spawn` "matching `deliver.ts:529`", and that fix is wrong.** It claimed *"nothing downstream waits on the child's exit code"* — which describes the **second** spawn at `:437`, already detached. A juror executed the check this plan had deferred and the answer inverts the design: the result must be awaited, so the plan's contingency is the fix and its headline was not.

**`deliver.ts` and `approve.ts` are not the shape to copy.** Neither has a precondition child. There is no shipped target two files over.

### It overturns a recorded decision, and that is the argument

`test/unit/a-read-route-spawns-nothing.test.ts:47` is a static call-graph gate against exactly this defect class, with `SPAWNS_BEHIND_AN_AWAIT = 0`. It walks from three **read** entry points and excludes the write routes deliberately:

> **The write routes are NOT in the population, and that is a decision rather than an omission.** … A write route blocking for **two seconds** is a button that feels slow to one person; a read-path spawn blocked every request in flight.

**The price is wrong by two orders of magnitude for this call.** `dispatch.ts:375` sets `timeout: 5 * 60 * 1000` — five minutes — and its own comment concedes the block: *"a hung implement must not block the board forever."*

A write route blocking for two seconds is a slow button. A write route blocking for up to five minutes takes the board down, and the board is how the operator would diagnose it. **The deferral was reasoned and its reasoning does not survive the measurement.**

### The second harm is the false diagnosis

A board at 0% CPU answering nothing is indistinguishable from a crashed one, and the page says *"Start it again with `pnpm board`"*. The server is alive and answers when the child exits. An operator who follows that advice starts a second board, which finds the port busy — the failure `plot-boardctl.sh` already documents.

## Design

### The rule

**The brief gate keeps its refusal; the event loop does not keep waiting for it.**

The endpoint must still be able to tell an operator *the implement failed, no worker started*, because that refusal is the gate's entire value. What changes is where the operator reads it.

### Two shapes, and the slice chooses with its argument written down

**A. Respond `202 started`, run the implement detached, dispatch from the child's `exit` listener.** The route stops blocking immediately and the 409 becomes a state the row reports rather than a response the click receives.

**B. Split into `POST` plus a status endpoint**, on `ideaStatus`'s shape — `idea.ts:369`, *"Read back what an earlier POST started. Never spawns, never blocks."* Already the pattern for a long agent-backed action in this codebase.

**Both change the route's contract**, and the plan says so rather than pretending otherwise. An earlier draft claimed *"it does not add a status endpoint"* after its own analysis implied one; that line is withdrawn.

### What the row must say

The 409 carries `reason: 'implement-failed'`, a detail message and the implement log path. Wherever it moves, the operator must still learn that a dispatch was refused and why. **A dispatch that silently does nothing is worse than one that blocks**, so this is a gate on the slice, not a detail.

### Which sync spawns matter

**Seven** synchronous spawns exist under `packages/board/src/server/`, not six as an earlier draft said: `dispatch.ts:356`, `continue.ts:179`, and `idea.ts:657, :670, :683, :691, :696`.

Six are bounded git commands — `symbolic-ref`, `rev-parse`, `worktree prune`, `rev-parse --verify`, `git log --max-count`, and **`git worktree add`** at `idea.ts:696`, the one the earlier draft missed and the least obviously bounded of them, since it does I/O and can hit a lock.

**The distinction is the child's bound, not the syscall.** This plan changes one call site. `idea.ts:696` is named as worth examining and is not changed here.

### The test has a shape to follow

`test/integration/serves-while-it-reads.test.ts` is the runtime half of the existing gate: routes in flight unawaited, `/` requested in the same tick, `SERVED_WHILE_BUSY_MS = 250` chosen to sit in the gap between *served* and *blocked* rather than at the edge of *fast*. **Reuse that harness and threshold**; it also documents why a tight timing bound fails on a loaded runner.

### Whose plan is this

`dispatch.ts` is named in `production-calls-the-domain-one-rule-at-a-time`'s scope. **The slice states whether this fix belongs here or there** before building, because two plans changing one call site is the collision the estate's own merge-queue exists to predict.

### What this does NOT do

- **It does not remove the brief gate.** The precondition stays; only the waiting changes.
- **It does not touch the six bounded git spawns.**
- **It does not widen the read-route gate to cover write routes.** That is the recorded decision this plan argues is mispriced for one call, and rewriting the gate is a larger change than fixing the call.

## Done when

- A dispatch is in flight and `/api/board` answers within `SERVED_WHILE_BUSY_MS`.
- An implement that exits non-zero still reaches the operator as a refusal naming the log, and no worker starts.
- The dispatch still lands on success — desk and claim created.
- The six bounded git spawns are unchanged.
- The plan's chosen shape (A or B) is recorded with the argument, and the contract change is stated where the board's API is documented.

## Slices

### A dispatch does not hold the loop (Branch: bug/a-dispatch-does-not-hold-the-loop)

Choose A or B with the argument written down, move the wait off the loop, keep the refusal reachable, and add the concurrency test on the existing harness.

## Notes

Round 1 overturned this plan's headline fix. The first draft proposed an async `spawn` matching `deliver.ts` and asserted nothing waits on the exit code — false: `implResult.status` gates the second spawn. The plan had deferred that very question to the slice while naming the fix anyway, which is how a wrong answer got stated with the right one available. The juror executed the deferred check.
