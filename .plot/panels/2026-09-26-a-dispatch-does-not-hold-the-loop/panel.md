# Panel — a dispatch does not hold the loop

**One lens, amend, executed.** Round 1.

## The defect is real and on the request path

Confirmed. `spawnSync` at `dispatch.ts:356`, 0.0% CPU while the port is held, every request timing out.

## The plan's headline fix was wrong, and it had deferred the question that proves it

The plan proposed converting `:356` to async `spawn` "matching `deliver.ts:529`", on the claim that *"nothing downstream waits on the child's exit code."*

**False.** `dispatch.ts:382` reads `implResult.status` and answers 409 `implement-failed` before the dispatch spawn at `:437` runs. That claim describes the second spawn, which is already detached. The `spawnSync` is the **brief gate**, documented at `:313` and `:337`.

**The plan named the wrong fix as primary and the right one as a contingency** — after writing that establishing this *"is the one thing the slice must establish."* Deferring the question that determines the answer, then answering anyway.

`deliver.ts` and `approve.ts` have no precondition child, so the "shape already shipped two files over" claim does not hold either.

## It overturns a recorded decision without knowing

`a-read-route-spawns-nothing.test.ts:47` excludes write routes deliberately: *"A write route blocking for **two seconds** is a button that feels slow to one person."*

`dispatch.ts:375` is `timeout: 5 * 60 * 1000`. **The price is wrong by two orders of magnitude for this call**, and that is the plan's strongest argument — which it did not make, because it did not know the decision existed.

## Corrections carried into the rewrite

- The spawn count is **seven**, not six; `idea.ts:696` (`git worktree add`) was missed and is the least obviously bounded of them.
- `test/integration/serves-while-it-reads.test.ts` already provides the concurrency harness and its `SERVED_WHILE_BUSY_MS = 250` threshold; the plan should reuse rather than invent.
- `dispatch.ts` is in `production-calls-the-domain-one-rule-at-a-time`'s scope, so ownership must be settled before building.

## Recommendation

**Amend, and the plan has been rewritten accordingly.** The defect stands; the fix is now stated as the contract change it is, with both candidate shapes named and the refusal path made a gate on the slice.
