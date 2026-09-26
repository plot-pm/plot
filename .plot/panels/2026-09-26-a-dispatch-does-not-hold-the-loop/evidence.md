# Evidence lens — a dispatch does not hold the loop

Position: amend
Evidence: executed

## 1. Is the defect real? Proven on the request path.

Yes. Traced end to end:

- `index.ts:173` — `{ path: '/api/dispatch', verb: 'dispatching', handle: handleDispatch }` sits in `WRITE_ROUTES`.
- `index.ts:311-317` — `WRITE_ROUTES.find(...)` then `void writeRoute.handle(req, res, ...)`. The handler runs on the request.
- `dispatch.ts:267` — `export async function handleDispatch(...)`.
- `dispatch.ts:356` — `const implResult = spawnSync(...)`, reached with **no `await` above it** on that path. The only `await` in the prefix is `readJsonBody` at :301; everything from :308 to :356 is synchronous.

So the call IS on the request's own stack. `spawnSync` cannot yield, so the loop is held. 0.0% CPU with the port held is the correct signature of a blocked loop, not a busy one. The defect is real and the diagnosis is right.

## 2. Does the fix work? No — `implResult` MUST be consulted, and the plan's own fix is wrong.

The plan's headline fix is *"`dispatch.ts:356` becomes an async `spawn`, matching `deliver.ts:529`."* Executed against the file, that cannot be done.

`dispatch.ts:379-398` reads the result and **the route's whole semantics hang off it**:

```
if (implResult.status !== 0) {
  ... json(409, { ok: false, slug, reason: 'implement-failed', detail: message, log: implLog });
  return;
}
```

This is **the brief gate**, documented at `dispatch.ts:313-325` in the file's own words: *"THE BRIEF GATE: call /plot-implement first and wait for it. … A worker without a brief spends its first hour re-deriving what the plan already says."* And at :337: *"Run the implement command SYNCHRONOUSLY and wait for it to complete. This is the brief gate: the dispatch proceeds only if the implement succeeds."*

The plan's Design section says *"The endpoint already returns before the agent finishes — its answer carries the log path, not the result — so nothing downstream waits on the child's exit code."* **That sentence is false.** It describes the SECOND spawn (`scriptsFor(opts).start(DISPATCH_SCRIPT, ...)` at :437, already detached and already async). The `spawnSync` at :356 is a different child running a different command (`Implement command`, not `plot-dispatch.sh`), and its exit code gates whether the second one happens at all.

The plan hedges this — §"What the sync call is currently used for" says establishing it *"is the one thing the slice must establish"* — but it hedges after having already named the fix, and the two are inconsistent. Executing the check the plan defers answers it: the result must be awaited, so the plan's own escape hatch fires: *"If the result genuinely must be awaited, the fix is different."* The plan therefore names the wrong fix as its primary one and the right one as a contingency. That inversion is what must be corrected before anyone builds it.

## 3. The claim a measurement contradicts: "same shape as deliver.ts and approve.ts".

The plan's central argument is the three-line table:

```
deliver.ts:529    const child = spawn(      ← async, detached
approve.ts:295    const child = spawn(      ← async
dispatch.ts:356   spawnSync(                ← blocks
```
followed by *"Same directory, same kind of work … **This is a lone inconsistency, not a design**."*

Measured, they are **not** the same shape:

- `deliver.ts` — `grep -n "spawnSync|execFileSync|await |child"` returns `399: await readJsonBody`, `529: const child = spawn(`, and two listeners. **Nothing is gated on a child's exit before the spawn.** It spawns once and answers.
- `approve.ts` — same: `295: const child = spawn(`, listeners at :300-301. One spawn, no gate.
- `dispatch.ts` — **two** children in sequence, and the first one's exit code decides whether the second runs.

deliver and approve have one spawn each and nothing to wait for. Dispatch has a precondition step. The plan asserts a symmetry that the files do not have, and "lone inconsistency, not a design" is contradicted by 13 lines of comment at `dispatch.ts:313-325` arguing for exactly this design. One may disagree with that design — but the plan has to argue against it, not claim it does not exist.

The plan also says the endpoint's *"answer carries the log path, not the result"*. Only on the success path: the refusal path at :392 returns a 409 carrying `reason: 'implement-failed'` and the last five log lines. That refusal is the product of the sync wait.

## 4. What the plan must say before someone builds it.

a. **`implResult.status` gates the second spawn.** State it, and name the brief gate at `dispatch.ts:313-325` as the design being changed. Delete or rewrite the claim that nothing downstream waits on the exit code.

b. **Drop or qualify the deliver/approve symmetry.** Neither has a precondition child. The plan's "the target shape is already written and shipped" is not true for this route.

c. **Name the actual design.** The plan's own contingency is the fix: respond `202 started`, run the implement detached, and have the dispatch follow on the child's `exit` listener — or split into `POST` + a status endpoint on `ideaStatus`'s shape (`idea.ts:369`). Either way the plan must say what happens to the **409 refusal** the operator currently gets synchronously. That refusal is the brief gate's whole value; moving it behind a status poll changes the board's contract, and the plan must say how the row reports "implement failed, no worker started". The plan currently says *"It does not add a status endpoint"* — after its own analysis implies it must.

d. **Cite the existing gate and say why it does not already cover this.** `packages/board/test/gate/no-sync-spawn.ts` plus `test/unit/a-read-route-spawns-nothing.test.ts` are a static call-graph gate against exactly this defect class, with `SPAWNS_BEHIND_AN_AWAIT = 0` as a declared ratchet. It walks from three **read** entry points and explicitly excludes write routes — `a-read-route-spawns-nothing.test.ts:47-52`:

> **The write routes are NOT in the population, and that is a decision rather than an omission.** `idea.ts` (7 spawns), `deliver.ts` (3), `dispatch.ts` (3), `reslice.ts` (3), `continue.ts` (3), `transition.ts` (2), `approve.ts` (2), `commission.ts` (1) belong to `production-calls-the-domain-one-rule-at-a-time`. A write route blocking for two seconds is a button that feels slow to one person; a read-path spawn blocked every request in flight.

The plan is **overturning a recorded decision** and does not know it. That is its strongest available argument — the deferral priced a write route at "two seconds" and this one is priced at five minutes (`dispatch.ts:375`, `timeout: 5 * 60 * 1000`), so the measurement that licensed the deferral is wrong by two orders of magnitude for this call. The plan should make that argument explicitly and say whether the fix belongs to this plan or to `production-calls-the-domain-one-rule-at-a-time`, which already owns `dispatch.ts`.

e. **The concurrency test already has a shape to follow, and the plan should name it.** `test/integration/serves-while-it-reads.test.ts` is the runtime half: both read routes in flight, unawaited, `/` requested in the same tick, `SERVED_WHILE_BUSY_MS = 250` chosen to sit in the gap between *served* and *blocked* rather than at the edge of *fast*. The plan's `Done when` item 4 ("a test drives a dispatch against a slow child and asserts a concurrent request is served") should reuse that harness and threshold rather than inventing one. That file also documents why not to use a tight timing threshold on a loaded runner.

f. **Correct the spawn count.** The plan says *"Six synchronous spawns exist under `packages/board/src/server/`"*. Measured: `grep -nE '(spawnSync|execFileSync|execSync)\s*\(' packages/board/src/server/*.ts` returns **seven** — `dispatch.ts:356`, `continue.ts:179`, `idea.ts:657, :670, :683, :691, :696`. The plan lists five bounded git commands and misses `idea.ts:696` (`git worktree add`). Its classification of the others is correct: `continue.ts:179` is a bounded `git log --max-count`, verified by reading it. The miss does not change the argument, but the plan presents the number as a measurement and it is off by one. `idea.ts:696` is also the least obviously bounded of the five — `git worktree add` does I/O and can hit a lock — so it is the one the plan's own "the distinction is the child's bound" test would most want examined.

## 5. Through the evidence lens: what executing revealed.

Reading the plan, its argument is persuasive and its three-line table looks decisive. Executing broke it in two places, and both were one file open away:

- **The symptom is right and the mechanism is wrong.** The plan measures 0.0% CPU, port held, requests timing out — all correct, all consistent with a blocked loop. Then it asserts a *fix* whose precondition it never checked, and states as fact (*"nothing downstream waits on the child's exit code"*) something the 40 lines directly below the cited line contradict. The plan even contains the check that would have caught it, marked as the slice's job. Deferring a check that invalidates your own fix is the defect: the fix should not have been named before the check ran.

- **The estate had already decided this, with a number.** Nothing in the plan cites `gate/no-sync-spawn.ts`, whose comment names `dispatch.ts (3)` in a list of write routes deliberately left alone, at a stated price of "two seconds". The plan's measurement is the refutation of that price. But a plan that unknowingly reverses a recorded decision reads, to whoever reviews it, as a plan that did not look — and the reviewer who spots the gate will reject the plan rather than the deferral.

The defect is real, it is on the request path, and it is worth fixing. `amend`, not `reject`: the motivation and the measurement survive intact, and the plan's own contingency paragraph already contains the right design. What must change is that the contingency becomes the plan, the false symmetry claim goes, and the existing gate and its recorded deferral are named and argued against.
