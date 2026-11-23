## Implementation brief — a-continuation-never-resumes-a-role-session (wave 1: Continuation)

- **Plan (canonical):** `docs/plans/2026-11-21-a-continuation-never-resumes-a-role-session.md` on `main`
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3644 merged
- **Branch:** `bug/a-continuation-checks-every-resume-handle` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Wave 2, `bug/a-loop-run-never-uses-a-role-handle`, waits on this branch. It adds a `resumeHandleReadings` port to the worker loop and calls the rule this branch creates. Export `resumeHandleUsable` from the domain with the signature below, because wave 2 imports it unchanged.

### What to build

A continuation resumes the wrong session. Measured 2026-11-21 on desk `desk-033f539d` (`bug/fleetd-counts-in-the-bb-ledger`): `.plot-worker.ending.json` recorded `resumeId` `f5e4b3c3-…`, which is the unblocker's read-only session (first transcript line `{"type":"agent-setting","agentSetting":"unblocker",…}`). The continuations at 05:04Z and 12:01Z both resumed it, and the second answered `ESCALATE` and exited 0. The implementer's session `72aebb9c-…` was never resumed. `continueOnDesk` (`packages/fleet/src/shared/continuation.ts`, `const resumeId = recorded !== '' ? …` at about `:1242`) takes the ending's handle with no check, the stamp path keeps the manifest's `resumeId` with no check, and `resumeIdFromTranscript` (`:650`) filters only handles listed in `plot-role-sessions`, which only an unblocker run after #3619 writes.

Build, in this order:

1. `packages/domain/src/rules/resume-handle.ts` — `resumeHandleUsable({ handle, branch, roleSessions, head })` answers `{ usable: true }` or `{ usable: false, why }` with `why` one of `empty`, `role-listed`, `role-transcript`, `other-branch`. An arrow function with a factual TSDoc block. No I/O.
2. `transcriptHead(dir, handle)` in `packages/fleet/src/shared/transcript.ts`, built on `transcriptFile`. It reads at most the first 64 KiB of `<handle>.jsonl` and answers `{ firstLine, gitBranch }` (the first `gitBranch` value found, `''` where none) or `null` where no transcript exists.
3. New leaf `packages/fleet/src/shared/role-sessions.ts`: move `roleSessionsFile`, `roleSessions` and `recordRoleSessions` out of `continuation.ts`. `continuation.ts` and `registryd-main.ts` import it. `continuation.ts` exports none of them.
4. `continueOnDesk` builds a candidate list per path and takes the first handle the rule accepts. Stamp path (continue and restart): the manifest's own `resumeId`, then the transcript scan newest first by mtime, then `randomUUID()`. Write path: the ending's `resumeId`, then the scan, then `randomUUID()`. `resumeIdFromTranscript` stops filtering and returns its handles in order. A rejected stamped handle is replaced through `writeResumeId` (`manifest-stamp.ts`), and a failed write refuses the start the way the `fresh` path does. `input.fresh` still replaces the choice with `randomUUID()`.
5. The `started` answer of `DeskContinuation` gets `session`: `{ resumed: <handle> }` or `{ fresh: <handle>, rejected: [{ handle, why }] }`. `continue-command.ts` prints `resumes <handle>` or `fresh session <handle> (<handle>: <why>, …)`. `POST /api/continue` returns the same field.

### Settled decisions — do not re-derive them

**Reject only declared roles.** The rule rejects a first line only where `type` is `agent-setting` and `agentSetting` is in `ROLE_NAMES` (`packages/domain/src/rules/role-command.ts:15`). Alternative killed: reject any `agent-setting` line. Every role run passes `--agent <role>` (`role-command.ts:80`, `review-verdict.ts:246`) and no worker start on origin/main passes `--agent`, so the broad rule would also reject a future worker started with `--agent`. Decided in panel round 1.

**A handle with no transcript stays usable.** `head: null` does not reject, because the loop starts a new session under that id with `--session-id` (`worker-loop.ts:1676-1680`). Rejecting it would discard every freshly minted handle.

**An unparseable first line, another `type`, and an absent `gitBranch` do not reject.** In the measured desk the first `gitBranch` is on line 3 or 4, never line 1, and the implementer's transcripts open with `queue-operation`. Reading only line 1 for the branch would find nothing. Read the first `gitBranch` anywhere in the 64 KiB bound.

**The branch check exists because a desk is reused across branches.** `6b1c76a1-…` on the same desk records `gitBranch` `feature/the-fixer-scope-reads-every-open-pr`. Newest-by-mtime alone would pick it.

**Do not rewrite the live ending.** `continuation.ts:1231` is the only reader of the ending's `resumeId` for a resume decision, and this branch checks that handle on every continuation. The `loop-end` applier (`loop-writes.ts:211-220`) stays the only writer of `.plot-worker.ending.json`. Alternative killed: a repair write on the desk's ending — a second writer for a field no reader trusts unchecked.

**The readers live in leaf modules.** `worker-loop.ts` imports only `continuation-name.ts` from the continuation code so that the loop bundle does not pull in `continuation.ts`'s dependencies (`continuation-name.ts:1-6`). Put `transcriptHead` and the role-session readers in leaves for wave 2, which wires them into the loop's ports. Do not import `continuation.ts` from them.

**Carried-over invariants.** Absent is not false: a missing transcript, an unparseable line and a missing `plot-role-sessions` file are each "cannot tell", and the rule answers `usable` for them. Read the exit code of the manifest write, not the emptiness of a handle. No change to the controller's refusals or to the continuation prompt (`continuation.ts:300-302`).

### Done when

The plan's `## Design › Tests` list is the specification. Assertions that exist because a naive implementation would pass without them:

- **`it.each(ROLE_NAMES)` builds the `agentSetting` value from the `--agent` argument `roleCommand` produces for that role.** A hand-typed `'unblocker'` string passes while a rename on the launch side silently breaks the rule.
- **The measured case:** the ending records F, F's transcript opens with the unblocker line, no `plot-role-sessions` file exists, and an older implementer transcript I for the same branch exists. The manifest's `resumeId` is I. A fix that only reads `plot-role-sessions` passes every other test and fails this one.
- **The other-branch case:** the ending records F, the newest non-role transcript O records another branch, an older I records this branch. The manifest's `resumeId` is I, not O.
- **Stamp path, continue and restart:** a role handle in the stamped manifest is replaced, the implementer's handle is kept, and a usable manifest handle beats a different usable ending handle. The restart case runs with `restart: async () => ({ ok: true })` as the `freshDesk` cases do (`continuation.test.ts:285-286`).
- **`transcriptHead`:** a `gitBranch` that appears on line 3 is found; a missing file answers `null`; no `gitBranch` within the bound answers `''`.
- The existing case "resumes the session the ending recorded, although a role transcript is newest" (`continuation.test.ts:798`) still passes.
- `continue-command.test.ts`: the output carries `resumes <handle>` or `fresh session <handle> (<rejected>: <why>)`.
- **SDK check, stated in the PR:** read the first line of one SDK role transcript (`agent-run-sdk.ts:335` passes `agent: role.name`) and say whether it carries the same `agent-setting` line. For reviewer, fixer and main-repair this line is the only protection.

Plus: add a changeset (package `plot`, description first and the `bumps:` block last, `./scripts/check-changeset-packages.sh` to check). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file; if it does, pay for the growth in the same change.

New domain code is arrows (`export const f = (…) => …`), with factual TSDoc and no history narrated in comments. Put the reasoning in the commit message.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. Before a hand fix of a PR, read `inFlight` in `.plot/state/fixer-attempts/<pr>.json`.

### Scope guard

This branch owns: `packages/domain/src/rules/resume-handle.ts` and its test, `packages/fleet/src/shared/{transcript,role-sessions,continuation}.ts`, `packages/fleet/src/server/entry/{continue-command,registryd-main}.ts` (import change only in `registryd-main.ts`), the `POST /api/continue` body, the matching tests, and a changeset.

Not this branch: `worker-loop.ts`, `agent-loop.ts`, `loop-writes.ts` and `ending.ts` belong to `bug/a-loop-run-never-uses-a-role-handle`. `supervisor.ts:258-260` and `packages/board/src/server/resume.ts:47-57` read the manifest's `resumeId` and stay unchanged.

Expect rebase conflicts only, no logic overlap, from two Approved plans: `fleet-state-is-read-whole-and-from-one-home` moves `ContinueRefusal` out of `continuation.ts:102`, and `a-refused-start-is-retried-and-named` edits `runPrompt`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
