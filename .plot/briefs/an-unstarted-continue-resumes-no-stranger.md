## Implementation brief — manifest-retry-and-race-findings (wave 4: Unstarted resume)

- **Plan (canonical):** [docs/plans/2026-10-17-manifest-retry-and-race-findings.md](../../docs/plans/2026-10-17-manifest-retry-and-race-findings.md) on `main`
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1968 merged
- **Branch:** `bug/an-unstarted-continue-resumes-no-stranger` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

This branch waited on `bug/a-continuation-obeys-the-limits`, which merged as #2078 — both touch `continuation.ts`. It is now the only remaining, eligible branch under this plan; all four earlier waves (`bug/the-implement-lock-covers-its-start` #1999, `bug/a-continue-starts-one-loop` #2034, `bug/a-failed-continue-leaves-its-desk-whole` #2052, `bug/a-continuation-obeys-the-limits` #2078) are merged to `main`.

### What to build

Issue #1841 names #1788 (MEDIUM) as this slice's finding, plus the untested recovery path #1373 flagged. Both are in `resumeIdFromTranscript` (`packages/fleet/src/shared/continuation.ts:462`) and its one call site at line 916.

**The bug.** `continueOnDesk` writes a *new* manifest (the `target.manifest === 'write'` branch, line 911-917) exactly when `continueTarget` falls back for an `unstarted`, `blocked`, or `holding-work` ending with no manifest naming the desk (`continue-target.ts:122-125`). For that write path, `resumeId` is sourced from `resumeIdFromTranscript(worktree)`, which lists every `.jsonl` file in the worktree's transcript directory (`transcriptDirFor`, excluding `agent-*` subagent files) and returns whichever has the newest mtime. In a worktree reused across several slices over its lifetime — the normal case, since a worktree is a desk, not a slice — the newest transcript is whichever session wrote to disk most recently, which is not necessarily the session whose prompt ended `unstarted`. A continuation meant to resume the blocked agent's own conversation instead resumes a stranger's.

**Where the correct handle already exists, and is thrown away.** `runPrompt` (`worker-loop.ts:1431`) computes `handle` *before* it knows whether the run will succeed (line 1457: `manifest.resumeId !== '' ? manifest.resumeId : deps.sessionId`), and every `unstarted` exit from that function already carries this exact handle back in its `RunOutcome.sessionId` field (lines 1446, 1462, 1531, 1601). That is the conversation the loop was about to run, or had started running, when the prompt failed to start — it is the right thing to resume, and it costs no filesystem scan to get. The problem is that this `sessionId` is not currently persisted anywhere `continueOnDesk`'s fallback can read it back from; it flows into `checksResumeId` (line 820) for an unrelated purpose and is otherwise dropped on the floor when the loop process exits.

### The decision this slice has to make, and the plan's own open question about it

The plan's Open Questions list this exactly: *"Does #1788's `unstarted` case need a second change beyond the `resumeId` source, for example a domain unit test only? Settle it when the slice re-reads `continue-target.ts`."* Re-reading it above answers the first half: yes, a second change is needed, because nothing today carries the `unstarted` exit's `handle` from the dying worker process to the next `POST /api/continue` that writes a fresh manifest for the same desk. The candidate carrier is the `Ending` record itself (`packages/domain/src/entities/ending.ts:231`) — it already names `reason: 'unstarted'` and the `branch` the worker held, but it has no field for the handle in play at the time. Confirm this against main before coding: `grep -n resumeId packages/domain/src/entities/ending.ts` returns nothing on `af94447f2` (the tip as of #2078 merging).

Two shapes to weigh, and the plan does not pre-decide between them:

1. **Add a field to `Ending`** (e.g. `resumeId: string`, defaulting to `''` the way `detail` and `refusedAssignment` already do) and have the writer that produces the `unstarted` ending record it — whichever process writes `.plot-worker.ending.json` (search `ENDING_FILENAME` writers; `worker-loop.ts` does not write it directly, so trace where the wrapper or a higher entry point turns a `RunOutcome` into the ending file). `continueOnDesk`'s fallback then reads `reading.ending.ending.resumeId` instead of scanning transcripts.
2. **Keep `Ending` closed and add a sibling file or field elsewhere** the `unstarted` exit writes beside the ending, if the writer that produces `.plot-worker.ending.json` cannot be reached cheaply, or if widening `EndingSchema` has a cost this slice's own investigation finds and this brief did not anticipate.

Prefer (1) unless investigation shows a concrete reason not to — `Ending` already exists precisely to let a later reader (`continueTarget`, `continueOnDesk`) answer questions about a worker that is no longer running, and "which conversation was it resuming" is the same kind of question `branch` and `detail` already answer. Trace the writer first; report here if it changes the approach.

**`resumeIdFromTranscript` as a fallback, not deleted outright.** Once the ending record can carry a `resumeId`, `continueOnDesk`'s write path should prefer it over the transcript scan. Whether the transcript scan is deleted, kept as a last-resort fallback for an ending with no `resumeId` recorded (e.g. one written before this change shipped, or a `blocked`/`holding-work` ending that never set it), or kept because some other caller still needs it, is this slice's call — name the choice and the reason in the PR. Do not delete it speculatively if a caller still depends on it; grep every reference first (`grep -rn resumeIdFromTranscript packages/`).

### The decisions the sibling slice already settled — do not re-derive them

**Scope boundary, stated from the other side.** `bug/a-continuation-obeys-the-limits`'s own brief drew this line explicitly: *"`resumeIdFromTranscript` and the `unstarted` continuation's resume-id source are `bug/an-unstarted-continue-resumes-no-stranger`'s territory... Do not change `resumeIdFromTranscript` or its call site at line 831 here."* That slice touched the limit checks, the idempotent correction append, and the `readContinuation` error split — all merged, all out of scope here. This slice owns exactly the `resumeId`-for-`unstarted` mechanism and nothing else in `continuation.ts` or `worker-loop.ts`. Line numbers have shifted since that brief was written (`resumeIdFromTranscript` is now at line 462, its call site at line 916, not 439/831) — the merged limit-check code shifted everything below it; re-read the current file rather than trusting either brief's line numbers.

**Absent is not false — this estate's standing rule, and it applies to the new field too.** If `Ending` gains a `resumeId` field, an `unstarted` ending written before this change shipped (or any ending whose writer did not set it) must read as "no recorded handle," never as `''` silently treated the same as a present-but-empty one if the two cases need different handling. Follow `EndingSchema`'s existing pattern for `detail`/`refusedAssignment`: `z.string().default('')`, and have the reader treat `''` as "nothing recorded, fall back" exactly as the plan's design for `readContinuation`'s error split already demonstrates the house style for "could not read" versus "read and got nothing."

**Style:** a helper you write or rewrite is an arrow (`CLAUDE.md`'s Domain Package rules apply to any new code you author). A neighbouring `function` declaration in `continuation.ts`, `worker-loop.ts`, or wherever the ending writer lives stays untouched. Comments state interface, not history.

### Done when

The plan's `## Design` → "Resume id" paragraph is the specification: *"An `unstarted` continuation does not take its `resumeId` from `resumeIdFromTranscript`. The route test sets `PLOT_TRANSCRIPT_HOME` and asserts the written manifest's `resumeId`, which also covers the untested recovery in #1373."* Concretely:

- A test reproducing #1788 on unmodified `main` first: a worktree with two transcripts (an older one matching the handle the failed prompt was using, a newer one from an unrelated session), an `unstarted` ending for the right branch and no manifest — asserts the manifest `continueOnDesk` writes carries the *newer, unrelated* transcript's id. That test must fail before the fix and pass after — the fix is proven by the same test flipping, not by a new one.
- The fixed version of that test (or a replacement) asserts the written manifest's `resumeId` matches the handle recorded at the time the prompt ended `unstarted`, not the newest file in the transcript directory.
- `packages/board/test/unit/continue-route.test.ts` gets a route-level case: set `PLOT_TRANSCRIPT_HOME` to a fixture directory, drive `/api/continue` for a desk with an `unstarted` ending and no manifest, and assert the written manifest's `resumeId` — this is the untested recovery path #1373 named and is new coverage, not a re-check of something already covered.
- Every new or changed assertion must fail on an unmodified main — mutate your fix once per test and watch it fail, per `superpowers:verification-before-completion`.
- If `EndingSchema` gains a field, `packages/domain/test/` (wherever `ending.ts` has its unit tests — confirm the path, it was not located during brief-writing) gets a case for the new field's default and for `readEnding` tolerating a record written before the field existed (an old JSON blob with the key simply absent — `safeParse` already drops/defaults unknown and missing keys per the schema's existing "unknown keys are dropped rather than refused" policy, so this should need no new parsing logic, only a test proving it).

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. This branch touches `packages/fleet/src/shared/continuation.ts`, almost certainly `packages/fleet/src/server/entry/worker-loop.ts` and/or wherever `.plot-worker.ending.json` is written (locate it — it is not `worker-loop.ts` itself; grep `ENDING_FILENAME` and follow it to a write site, likely a shell wrapper or a higher TS entry point), possibly `packages/domain/src/entities/ending.ts`, and their test files — expect the fleet vitest/typecheck entries, the domain vitest/typecheck entries if `ending.ts` changes, and `packages/board/test/unit/continue-route.test.ts`. The suites in the `CI suites` key run in CI on every PR; do not run `pnpm run test:e2e` locally — it is CI's gate, not a local one (see `CLAUDE.md` Testing). Add a changeset for `plot`, description first and `bumps:` block last — `patch`, since this is a bug fix with no new observable contract beyond "the right conversation resumes." If the ending writer lives in a `.sh` file and this slice touches it, `scripts/check-shell-lines.sh` refuses growth of shipped shell under `skills/`; remove an equal number of lines elsewhere in the same change if that happens.

### Bookkeeping

Open the PR through the controller once the branch holds a commit:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line under `### Unstarted resume` in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the `unstarted`-ending resume-id mechanism: `resumeIdFromTranscript` and its call site in `packages/fleet/src/shared/continuation.ts`, whichever file writes `.plot-worker.ending.json` and the `Ending` shape in `packages/domain/src/entities/ending.ts` if a field is added there, and the new tests named above.

Leave untouched: the limit checks, the idempotent correction append, `readContinuation`'s error split, and `CONTINUATION_NAME`'s module location — all settled by the merged `bug/a-continuation-obeys-the-limits` (#2078). The three earlier waves (implement lock #1999, start/stop #2034 and #2052) are merged and out of scope; nothing here should touch `continue-lock.ts`, `manifest-stamp.ts`, the start-lock, or the stop-sequencing code in `continueOnDesk`.

This is the last branch in the plan's `## Slices` section — once its PR merges, every slice is landed and `/plot-deliver manifest-retry-and-race-findings` can close the plan. If you find something the plan did not anticipate, report it rather than improvising outside scope.
