## Implementation brief — manifest-retry-and-race-findings (wave 3: Continuation)

- **Plan (canonical):** [docs/plans/2026-10-17-manifest-retry-and-race-findings.md](../../docs/plans/2026-10-17-manifest-retry-and-race-findings.md) on `main`
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1968 merged
- **Branch:** `bug/a-continuation-obeys-the-limits` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

This branch leads the Continuation wave — `bug/an-unstarted-continue-resumes-no-stranger` waits on it, because both will touch `continuation.ts` and its route test. Both earlier waves (`bug/the-implement-lock-covers-its-start` #1999, `bug/a-continue-starts-one-loop` #2034, `bug/a-failed-continue-leaves-its-desk-whole` #2052) are already merged; the start lock, the manifest-write-last ordering, and the stop-sequencing fixes this slice depends on are all live on `main` as of `6c708e14b`.

### What to build

Issue #1841 names #1381 and #1383 as this slice's findings, both in `continueOnDesk` (`packages/fleet/src/shared/continuation.ts:608`). Re-check each against main first; line numbers below are current as of `6c708e14b`.

1. **A continuation skips `runLimitEnding` and `spendLimitEnding` (#1381).** `continueOnDesk` never calls either — confirmed: neither name appears in `continuation.ts`. Both live in `packages/domain/src/workflows/agent-loop.ts` (`runLimitEnding` line 331, `spendLimitEnding` line 353), but they are private, operate on the heavy `AgentLoopReadings`/`Decision<AgentLoopDetail>` shapes `agentLoop` built for a full pass, and are not exported — do not import them. The plan's Open Question settled this: **the limit wins over a person's answer**, and the refusal names the limit (`Slice max runs` or `Slice max spend`). Use the exported low-level predicates instead: `runLimitRefusal(runs, limit)` (`packages/domain/src/rules/run-limit.ts`) and `sliceSpendRefusal({ costUsd }, limit)` (`packages/domain/src/rules/slice-spend-refusal.ts`) — both pure, both already used by `agentLoop` itself, so calling them from `continueOnDesk` duplicates no logic, just the call site. `runs` comes from the manifest's own `sliceRuns` record for the branch (see `worker-loop.ts:438-474`'s `sliceRunsOf`); `limit` and `sliceMaxSpendUsd` come from `readCfg(opts, 'Slice max runs', ...)` / `'Slice max spend'`, the same `readCfg` pattern this function already uses for `Worker command` (line 633). `costUsd` comes from `readSliceSpend(sliceSpendFile({ cwd: worktree }), branch)` (`@plot-pm/domain/workflows/slice-spend`). Check both limits where `continueTarget` would otherwise proceed to spawn — after the existing refusals, before the lock's writes begin — and return a `refused(409, <new reason>, <summary naming the limit>)`. `ContinueRefusal` is a closed union; add the new reason(s) there and thread them through the route's response mapping in `continue.ts` the way `loop-alive` and `no-manifest` already are.

2. **A retry after `unstarted` re-appends the same answer to `PLOT-CORRECTION.md` (#1382, #1383).** This is in `worker-loop.ts`, not `continuation.ts` — the command-runner branch at line 1489: `if (resume !== null && resume.continuation) await deps.ports.desk.appendCorrection(worktree, resume.text);` runs unconditionally every pass that reaches it. `consumeContinuation` (line 669) only removes `.plot-worker.continue.md` when the exit answer is **not** `unstarted` (confirmed at lines 1472, 1531) — by design, so a retry carries the answer forward (the plan's second Open Question, decided: yes). But that same preserved file is what line 1489 re-reads and re-appends on the next pass, with nothing keying the append so a second attempt writes nothing. Make the append idempotent: give the continuation entry its own heading (the plan says so explicitly) and check `PLOT-CORRECTION.md`'s existing text for that heading before appending — write nothing if it is already present. This also closes #1383's second half.

3. **`readContinuation` reads every error as "no continuation" (#1383).** `worker-loop.ts:650-660` catches every `readFile` failure — ENOENT, EACCES, a directory where a file was expected — and returns `null` for all of them alike. Split missing-file (the normal "no continuation waiting" case) from unreadable-but-present (a signal something is wrong that a silent `null` would hide). Follow the estate's standing rule: absent is not false, and a probe that could not ask is not the same as a probe that asked and got nothing — read the error code (`ENOENT` vs. everything else), don't collapse them.

4. **`CONTINUATION_NAME` moves to a leaf module.** It is declared in `continuation.ts:36` and imported into `worker-loop.ts:75` — but `continuation.ts` also imports `continue-lock.ts`, `manifest-stamp.js`, `registry.js`, `desk-loop.js` and more, none of which the loop bundle needs for one filename constant. Confirmed still the case on main. Move the constant (and only the constant — `CONTINUATION_ENV` and `ANSWER_MAX`/`BODY_LIMIT` stay where they are unless the PR finds a reason to move them too) to a new leaf module with no sibling imports, the way `FREE_WAIT_FILENAME` already lives in `desk-loop-alive.ts` rather than in the module that uses it most. Re-export it from `continuation.ts` for existing callers, or update both import sites — pick whichever the PR can show is smaller. Measure the loop bundle size before and after with the same method #1383 used (1,399,113 B on main against 1,456,545 B on the slice head) and report both numbers in the PR; that is the evidence this fix is worth landing, not a claim.

### The decisions the plan settles — do not re-derive them

**The limit wins, unconditionally.** Decided 2026-10-17 by Jan Wloka: a person's answer does not override `Slice max runs` or `Slice max spend` — the continuation refuses and names the limit. A person can raise the limit; a silent overrun cannot be undone. Do not add a bypass, a force flag, or a "the person already knows" exception.

**A retry carries the continuation.** Decided 2026-10-17: yes, a retry after `unstarted` reads the continuation again rather than losing the answer. This is why item 2's fix must be idempotent rather than removing the file sooner — removing it earlier would silently drop the answer on the next retry, which is the regression the decision forbids.

**Refused before any write — still true here.** `continueOnDesk`'s existing comment at line 664 states the invariant this slice's two new limit checks must also honor: a refused continuation leaves no prompt file, no appended log, no removed `.plot-worker.exit`. Place the limit checks before any of those writes, in the same position the existing `no-question`/`no-worker-command`/`loop-alive`/`no-manifest` refusals already hold — refusing after the prompt is written would leave exactly the trace a reader would mistake for a started run.

**Scope boundary with #1788.** `resumeIdFromTranscript` (`continuation.ts:439`) and the `unstarted` continuation's resume-id source are `bug/an-unstarted-continue-resumes-no-stranger`'s territory, not this slice's — it waits on this branch precisely because both touch `continuation.ts`. Do not change `resumeIdFromTranscript` or its call site at line 831 here, even though it sits a few hundred lines from this slice's changes.

**Style:** a helper you write or rewrite is an arrow (`CLAUDE.md`'s Domain Package rules apply to any new code you author, not just `packages/domain/**`). A neighbouring `function` declaration in `continuation.ts` or `worker-loop.ts` stays untouched — this is a function-level change. Comments state interface, not history.

### Done when

The plan's `## Design` → Continuation paragraph is the specification: *run and spend limits, the retry that carries the answer, the idempotent append, the read-error split and the leaf module for `CONTINUATION_NAME`.* Concretely:

- A continuation attempted at or past `Slice max runs` is refused, names the limit in its detail, and leaves no `.plot-worker.continue.md`, no appended log line, and `.plot-worker.exit` untouched — the test must fail on an unmodified main before the fix lands.
- A continuation attempted at or past `Slice max spend` is refused the same way, and a project with no `Slice max spend` key configured is never refused on spend (confirms the `null`-means-unconfigured behavior `spendLimitEnding` already protects is preserved at the new call site).
- Two consecutive passes over the same unconsumed continuation (simulating a retry after `unstarted`) append the continuation's text to `PLOT-CORRECTION.md` exactly once — a test that drives `boundedRun` twice with the same continuation file present and asserts the second pass writes nothing new.
- `readContinuation` against a present-but-unreadable file (e.g. a directory at that path, or a permission-denied fixture) returns a value distinguishable from the missing-file case — a test for each.
- The loop bundle size is measured before and after the `CONTINUATION_NAME` move and both numbers are in the PR description.
- Every new or changed assertion must fail on an unmodified main — mutate your fix once per test and watch it fail, per `superpowers:verification-before-completion`.

Gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. This branch touches `packages/fleet/src/shared/continuation.ts`, `packages/fleet/src/server/entry/worker-loop.ts`, their test files (`packages/fleet/test/unit/continuation.test.ts`, `packages/fleet/test/unit/worker-loop-run.test.ts`), and likely a new leaf module under `packages/fleet/src/shared/`, so expect the fleet vitest/typecheck entries and `packages/board/test/unit/continue-route.test.ts` if the new refusal reasons change what `/api/continue` returns. The suites in the `CI suites` key run in CI on every PR; do not run `pnpm run test:e2e` locally — it is CI's gate, not a local one (see `CLAUDE.md` Testing). Add a changeset for `plot`, description first and `bumps:` block last — `patch` unless the new refusal reasons change an observable contract the changelog should call out as more than a bug fix. `scripts/check-shell-lines.sh` refuses growth of shipped shell; this slice is expected to touch no `.sh` file, and if that changes, remove an equal number of lines elsewhere in the same change.

### Bookkeeping

Open the PR through the controller once the branch holds a commit:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line under `### Continuation` in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/fleet/src/shared/continuation.ts` (the limit-check additions only — not `resumeIdFromTranscript` or the stop/lock/manifest-ordering code the two prior waves already settled), `packages/fleet/src/server/entry/worker-loop.ts` (the `appendCorrection` idempotency and `readContinuation`'s error split), any new leaf module for `CONTINUATION_NAME`, and their tests.

`bug/an-unstarted-continue-resumes-no-stranger` waits on this branch and holds the `resumeId`/`unstarted` resume-target fix in the same file, `continuation.ts` — leave `resumeIdFromTranscript` and its call site to it; do not pre-empt its slice. The two earlier Continuation-wave siblings (implement lock, start/stop) are merged and out of scope; nothing here should touch `continue-lock.ts`, `manifest-stamp.ts`, or the stop-sequencing code in `continueOnDesk` they already fixed. If you find something the plan did not anticipate, report it rather than improvising outside scope.
