# Round 2, lens COST

Position: amend

## Looked at (ran grep/sed against the code)

- `fleet.ts:8612-8619` (Worker bound cost comment, 0.12-0.94 s, 4 s poll): TRUE. `FLEET_POLL_MS = 4_000` in `packages/board/src/app/App.tsx:54`.
- `FIXER_BOUND_SECONDS = 3600`, `FIXER_ATTEMPTS_BUDGET = 2` (`rules/fixer-attempts.ts:5,8`): TRUE.
- `auto-review.ts:63` 3600 s: TRUE (file is `packages/fleet/src/shared/auto-review.ts`).
- Transcript 7.7 MiB: TRUE, but the cite is wrong. It sits at `packages/domain/src/workflows/slice-spend.ts:58`, not `slice-spend.ts:57-60`; no path is given. The "90 to 250 ms" figure was not found in the file.
- `delivery-readings.ts:302` role defaults to `loop`: TRUE. `blockedOn` is at `:304`, not `:303` (off by one).
- `AgentRole` holds six roles (`delivery-placement.ts:92`): TRUE.
- `board.ts:459` cites the spend read: it is `:460`, and the uncached-read comment is at `board.ts:2887-2900`.

## Findings

1. The Tokens read has no cost bound, and the code says it is expensive. Plan: "the seal and run lines in `.plot/state/slice-spend.jsonl` ... a daily figure takes each line's difference against the session's previous line". Evidence: `board.ts:2887-2900` states `sliceSpendFile` caches only the directory, so `lines()` opens and parses the record on every call, and the board hoists it to once per refresh to avoid per-plan reads. The plan adds a per-agent "last finished run" lookup and a per-session diff for the header, and says nothing about the size of the file or the per-poll cost. The plan is rigorous about `Worker bound` (0.12-0.94 s) but gives no equivalent figure for the new spend fold on the same 4 s `/api/fleet` poll. Fix: add a Done When line that the spend lines are read at most once per `/api/fleet` build (reusing the `board.ts` hoisted read, never per agent), and record the measured file size and fold time in the plan or the slice's commit. `slice-spend.jsonl` is not present in this worktree, so I could not measure it.

2. The "once per board process, and again only when the config file changes" mechanism has no named change signal. `workerBoundSeconds` (`fleet.ts:8428`) calls `readConfigAsync`, an uncached subprocess. The plan does not say how a config change is detected (mtime stat, watcher), and a stat per poll is itself a cost. Fix: name the signal and its cost (one `stat` per poll is acceptable; say so).

3. New reads per poll are listed in prose but not totalled. Pulse git reading for commit count and subject, `fixer-attempts` records, connector limit reading (`entities/limit.ts`), `ciChecks`: each is called "local", but the plan does not say which are already folded into the payload (`fixer-attempts` is: `fleet.ts:6614` reads it for PR rows only) and which add a new subprocess. Fix: one sentence per reading, "already in the payload" or "new, cost X", so the builder cannot add a per-agent spawn. Note the layering rule and the CI spawn ratchet (`allowed=28`): a new `spawn` in TS fails the gate.

4. Blast radius on browser tests is named but not sized. Plan: "Left to the Builder: Which browser tests select the current Fleet columns". Evidence: `fleet-settings.browser.test.ts`, `tuple-row.browser.test.ts`, `stubbed-tests-start-no-board.test.ts`, `needs-real-board.test.ts`, `write-gate.test.mjs` and `fleet-settings.test.mjs` all reference `fleet-controls`/the strip; `an-unnamed-desk-says-so.browser.test.ts` is named. A browser test starts a full board server (CLAUDE.md: 42 of 43). Fix: list these files in the slice's brief, and state that the `#fleet-controls` anchor keeps them green unchanged while the tuple-row test moves.

5. The open question about a live token figure (Open Points, unchecked) is the one real cost decision. The plan rightly refuses a per-agent transcript fold on the poll. Keep that refusal as a Done When line ("no transcript read on `/api/fleet`") so a builder who accepts the question later cannot add it silently.

## Not a problem

The plan is honest about the gaps (running-agent tokens, no start time for design/verify) and does not claim a measured saving. Board bundle: no committed artifact, correct per `check-no-bundle-diff.sh`. No finding against the three-slice CI cost.
