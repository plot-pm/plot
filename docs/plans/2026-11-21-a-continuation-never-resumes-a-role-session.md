# A continuation never resumes a role session

> Every resume handle a continuation or a loop run uses passes one domain predicate, which rejects a role run's session and a session of another branch, so a person's answer reaches the implementing agent or a fresh session and never the unblocker.

## Status

- **State:** Approved
- **Type:** bug
- **Issue:** #3643
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3644 merged

## Changelog

- A continuation never resumes a role run's session (for example the unblocker's read-only answer session) or a session that another branch's agent ran on the same desk, whether the handle comes from the desk's ending, from a stamped manifest or from the transcript scan. Where no usable handle remains, the continuation starts a fresh session with the answer.
- `plot-continue-command.mjs` names the session the continuation resumes, or says that it starts a fresh session and why.
- The worker loop never launches a prompt in a role run's session: it replaces such a manifest handle with a new one before the run, and a loop ending never records a role handle as its `resumeId`.

<!-- Board impact: none. No plan format, template, helper script or docs/plans layout changes. -->

## Motivation

#3619 (`c77e9cf7c`, plan `2026-11-21-a-continuation-resumes-the-asking-agent`) added a role filter to one of the three sources of a continuation's resume handle. The other two sources bypass it, the filter depends on a record that older desks do not have, and the loop resumes whatever handle its manifest holds.

1. **The recorded handle is never checked.** `continueOnDesk` (`packages/fleet/src/shared/continuation.ts:903`) takes `const resumeId = recorded !== '' ? recorded : resumeIdFromTranscript(worktree) || randomUUID();` (`:1242`, `recorded` read at `:1231` from the desk's `.plot-worker.ending.json`). A role handle in the ending wins over every other candidate.
2. **A stamped manifest's handle is never checked.** Where the target is `manifest: 'stamp'` (`continuation.ts:1228-1229`), the continuation keeps the manifest's own `resumeId`. Only `input.fresh` replaces it (`:1275`). `restartTarget` (`:876-877`), which `continueOnDesk` takes when `input.restart` is set (`:997`), answers `stamp` for a named manifest, so `plot-restart-command.mjs` takes the same path.
3. **The transcript scan knows only recorded role runs, and no branch.** `resumeIdFromTranscript` (`continuation.ts:650-660`) skips the handles that the desk's `plot-role-sessions` file lists (`:555-582`). Only an unblocker run after `c77e9cf7c` writes that file (`packages/fleet/src/server/entry/registryd-main.ts:1604`, `:1622`); reviewer, fixer and main-repair runs write none. The scan reads no branch (`deskTranscripts`, `:585-604`), and a desk is reused across branches.
4. **The loop resumes the manifest's handle, and writes it forward.** `runPrompt` re-reads the manifest and sets `handle = manifest.resumeId !== '' ? manifest.resumeId : deps.sessionId` (`packages/fleet/src/server/entry/worker-loop.ts:1661-1669`). The command runner gets `PLOT_SESSION_FLAG=--resume` and `PLOT_SESSION_ID=handle` wherever that transcript was spoken (`:1676-1679`). The SDK request falls back to `spoken ? handle : ''` (`:1723-1728`). Separately, `readPass` passes `manifest.resumeId` to the domain as `readings.resumeId` (`:917`), every `end(...)` in `packages/domain/src/workflows/agent-loop.ts` (`:526`, `:570`, `:865`, `:872`, `:883`, `:893`) carries it on the `loop-end` write, and `packages/fleet/src/server/entry/loop-writes.ts:218` writes it into the ending. Once a role handle reaches a manifest, the loop runs in the role session, and every later continuation reads that handle as `recorded`.

Measured 2026-11-21 on desk `desk-033f539d` (`bug/fleetd-counts-in-the-bb-ledger`), re-checked for this plan:

- The desk's transcript directory holds three transcripts. `72aebb9c-09e4-4d6f-a6ab-e52846c8963c` (the implementing session, last written 01:26 local, `"gitBranch":"bug/fleetd-counts-in-the-bb-ledger"`) and `6b1c76a1-3632-4404-a013-e0c30a69b16d` (last written 2026-11-20 22:05 local, `"gitBranch":"feature/the-fixer-scope-reads-every-open-pr"`) open with a `queue-operation` line. `f5e4b3c3-e7f8-4f15-a052-f7b6e1ec51a8` (last written 13:02 local) opens with `{"type":"agent-setting","agentSetting":"unblocker","sessionId":"f5e4b3c3-…"}`. In each file the first `gitBranch` field is on line 3 or 4, not on line 1.
- `.plot-worker.ending.json` records `"reason":"blocked"` and `"resumeId":"f5e4b3c3-e7f8-4f15-a052-f7b6e1ec51a8"`.
- The desk's gitdir holds no `plot-role-sessions` file.
- The continuations at 05:04Z and 12:01Z both resumed `f5e4b3c3`. The second one answered `ESCALATE` and exited 0. The success line (`packages/fleet/src/server/entry/continue-command.ts:133`) names a pid and a log and no session, so only the transcripts showed which session ran. A third `plot-continue-command.mjs` resumes `f5e4b3c3` again, because `plot-continue-command.mjs` passes no `fresh` option.

## Design

### Approach

**One domain rule decides whether a handle is usable.** A new rule `packages/domain/src/rules/resume-handle.ts` exports `resumeHandleUsable`, an arrow function with a factual TSDoc block. It takes readings as values and does no I/O:

```ts
resumeHandleUsable({ handle, branch, roleSessions, head }) =>
  | { usable: true }
  | { usable: false; why: 'empty' | 'role-listed' | 'role-transcript' | 'other-branch' }
```

- `handle` is the candidate; `''` answers `empty`.
- `branch` is the branch the continuation or the loop runs for.
- `roleSessions` is the desk's `plot-role-sessions` record as a `ReadonlySet<string>`. A handle in it answers `role-listed`.
- `head` is `{ firstLine, gitBranch }` read from the handle's transcript, or `null` where no transcript exists. A `firstLine` that parses as JSON with `type: 'agent-setting'` and an `agentSetting` that `ROLE_NAMES` (`packages/domain/src/rules/role-command.ts:15`) contains answers `role-transcript`. A `gitBranch` that is not `''` and differs from `branch` answers `other-branch`. An unparseable line, another `type`, an absent `gitBranch` and `null` do not reject. A handle with no transcript stays usable, because the loop then starts a new session under that id with `--session-id` (`worker-loop.ts:1676-1680`).

**Only declared roles are rejected.** Decided in panel round 1: the rule rejects an `agentSetting` only where `ROLE_NAMES` names it. Every role run passes `--agent <role>` (`role-command.ts:80`, `review-verdict.ts:246`), and no worker start on origin/main passes `--agent`. A fifth role added to `ROLE_NAMES` is covered with no second edit, and a future worker started with `--agent` stays resumable.

**The live ending is not rewritten.** Decided in panel round 1: `continuation.ts:1231` is the only reader of the ending's `resumeId` for a resume decision, and slice 1 checks that handle on every continuation. The only writer of `.plot-worker.ending.json` stays the `loop-end` applier (`loop-writes.ts:211-220`), and the next loop ending on the desk overwrites the field with the manifest's handle. Until then `desk-033f539d`'s ending still names `f5e4b3c3`, which no reader acts on.

**The continuation runs every candidate through the rule, in an order that depends on the target.** `continueOnDesk` builds the candidate list and takes the first usable one:

- **Stamp path** (`manifest: 'stamp'`, continue and restart): the manifest's own `resumeId`, then the transcript scan's handles newest first by mtime, then `randomUUID()`. The stamp path does not read the ending's handle, as today.
- **Write path** (`manifest: 'write'`): the ending's recorded `resumeId`, then the transcript scan's handles newest first, then `randomUUID()`.

`input.fresh` still replaces the chosen handle with `randomUUID()` (`continuation.ts:1275`). On the stamp path a rejected manifest handle is replaced with `writeResumeId` (`packages/fleet/src/shared/manifest-stamp.ts:340`), and a failed write refuses the start as the `fresh` path does (`continuation.ts:1275-1278`). `resumeIdFromTranscript` stops filtering by itself and returns the scan's handles in order; the rule makes the decision.

**The continuation says which session it resumes.** The `started` answer of `DeskContinuation` (`continuation.ts:407-409`, built at `:1450`) gets a `session` field: `{ resumed: <handle> }`, or `{ fresh: <handle>, rejected: [{ handle, why }] }`. `continue-command.ts:133` adds one line to its output: `resumes <handle>`, or `fresh session <handle> (<handle>: <why>, …)`. `POST /api/continue` returns the same field in its body.

**The readers live in leaf modules.** `worker-loop.ts` imports only `continuation-name.ts` from the continuation code, so that the loop bundle does not pull in `continuation.ts`'s dependencies (`packages/fleet/src/shared/continuation-name.ts:1-6`). So:

- `transcriptHead(dir, handle)` goes in `packages/fleet/src/shared/transcript.ts`, beside `transcriptFile` (`:98`), and is built on it. It reads at most the first 64 KiB of `<handle>.jsonl` and answers the first line and the first `gitBranch` value it finds, or `null` where no transcript exists.
- `roleSessionsFile`, `roleSessions` (`continuation.ts:562-582`) and `recordRoleSessions` (`:626`) move to a new leaf `packages/fleet/src/shared/role-sessions.ts`. `continuation.ts` and `registryd-main.ts` import it. `continuation.ts` exports none of them.

**The loop checks the handle where it launches, through its ports.** Slice 2 adds one reading to `WorkerLoopPorts` (`worker-loop.ts:187`): `resumeHandleReadings(worktree, handle) => { roleSessions, head }`, wired in `workerLoopPorts` (`:230`) to the two leaf readers. `runPrompt` asks `resumeHandleUsable` for `manifest.resumeId` after the hop mint (`:1662-1667`) and before it computes `handle` (`:1669`). Where the rule rejects the handle, `runPrompt` mints a handle with `deps.mintHandle ?? randomUUID`, writes it with `writeResumeId`, and uses it for the run, so `spoken` answers `false` and the run starts with `--session-id` on the new handle. A failed write ends the run `unstarted`, as a failed `raiseSliceRuns` does (`:1672-1674`). `readPass` asks the same rule for `manifest.resumeId` at `:917` and passes `''` as `readings.resumeId` where the rule rejects it, so a pass that ends before any run records no role handle.

**An ending never records an empty handle.** `end` in `agent-loop.ts` (`:334-362`) spreads `resumeId` only where it is defined and not `''`. Today `readings.resumeId: ''` produces `"resumeId":""` in the ending, which the ending schema reads as absent (`packages/domain/src/entities/ending.ts:254`).

**No change to the controller's refusals or the continuation prompt.** `plot-continue-command.mjs` and `POST /api/continue` refuse as today. The blocked-question prompt still says "you are a NEW run, not a reply to it" (`continuation.ts:300-302`).

### Tests

Slice 1, rule (`packages/domain/test/rules-resume-handle.test.ts`):

- An empty handle answers `empty`. A handle in `roleSessions` answers `role-listed`.
- `it.each(ROLE_NAMES)`: a first line `{"type":"agent-setting","agentSetting":"<role>","sessionId":"…"}` answers `role-transcript`. The case builds the `agentSetting` value from the `--agent` argument that `roleCommand` produces for that role, so a rename on the launch side fails this test.
- A first line with an `agentSetting` that `ROLE_NAMES` does not contain answers `usable`. A `queue-operation` line, an unparseable line and a `null` head each answer `usable`.
- A head whose `gitBranch` differs from `branch` answers `other-branch`; an equal `gitBranch` and an absent one answer `usable`.

Slice 1, transcript reader (`packages/fleet/test/unit/transcript.test.ts`): `transcriptHead` answers the first line and a `gitBranch` that appears on line 3; `null` for a missing file; an empty `gitBranch` where no line within the bound carries one.

Slice 1, continuation (`packages/fleet/test/unit/continuation.test.ts`, with the `blockedDesk`, `transcript` and `roleRun` helpers at `:745-779`; `transcript()` gets a first-line and `gitBranch` option):

- The measured case: the ending records handle F, F's transcript opens with the unblocker `agent-setting` line, no `plot-role-sessions` file exists, and an older implementer transcript I for the same branch exists. The written manifest's `resumeId` is I.
- The ending records F and F is the only transcript: the manifest's `resumeId` is a new id that is not F.
- The ending records F and `plot-role-sessions` lists F: the manifest's `resumeId` is not F.
- The ending records F, the newest non-role transcript O records another branch, and an older I records this branch: the manifest's `resumeId` is I, not O.
- Stamp path, continue: a stamped manifest whose `resumeId` is a role handle gets the next usable candidate written into it; a stamped manifest whose `resumeId` is the implementer's keeps it; a stamped manifest with a usable handle keeps it while the ending records a different usable handle.
- Stamp path, restart: a desk whose registry manifest names it, run with `restart: async () => ({ ok: true })` as the `freshDesk` cases do (`continuation.test.ts:285-286`). A role handle in the manifest is replaced; an implementer handle is kept.
- The existing case "resumes the session the ending recorded, although a role transcript is newest" (`continuation.test.ts:798`) still passes.
- The `started` answer's `session` names the resumed handle, or the fresh handle and each rejected handle with its `why`.

Slice 1, command (`packages/fleet/test/unit/continue-command.test.ts`): the success output carries `resumes <handle>` for a resumed session and `fresh session <handle> (<rejected>: <why>)` for a fresh one.

Slice 2, loop launch (`packages/fleet/test/unit/worker-loop-run.test.ts`, with the `rig` harness that asserts the manifest's `resumeId` after a hop at `:763-804`): a manifest whose `resumeId` the fake `resumeHandleReadings` reports as a role transcript runs with a `PLOT_SESSION_ID` that is not that handle and with `PLOT_SESSION_FLAG: '--session-id'`, and the manifest afterwards names the new handle. A manifest naming the implementer's spoken handle runs `--resume` on it. A failed `writeResumeId` ends the run `unstarted`.

Slice 2, loop readings (`packages/fleet/test/unit/worker-loop.test.ts`, with the fake `ports()` at `:26-37`): `readPass` with a role handle in the manifest answers `resumeId: ''`; with the implementer's handle it keeps it.

Slice 2, ending (`packages/domain/test/workflows-agent-loop.test.ts`): a row 10 blocked pass with `resumeId: ''` produces a `loop-end` write with no `resumeId` key. This test fails on origin/main, where the write carries `resumeId: ''`.

### Open Questions

- [x] `[decision-declared-roles-only]` The rule rejects only `agentSetting` names in `ROLE_NAMES`. Decided in panel round 1; see Approach.
- [x] `[decision-ending-not-rewritten]` The live ending is not rewritten. Decided in panel round 1; see Approach.

## Slices

### Continuation

- `bug/a-continuation-checks-every-resume-handle` — `resumeHandleUsable` in the domain, `transcriptHead` in `shared/transcript.ts`, the role-session leaf `shared/role-sessions.ts`, `continueOnDesk` running each path's candidates through the rule, and the continue command naming the session <!-- builds: resumeHandleUsable, a domain rule that rejects a role run's or another branch's resume handle -->

### Loop

- `bug/a-loop-run-never-uses-a-role-handle` — a `resumeHandleReadings` port reading, `runPrompt` replacing a rejected manifest handle before the launch, `readPass` passing `''` for one, and `end` omitting an empty handle <!-- builds: role-handle check at the worker loop's launch and readings --> <!-- waits: bug/a-continuation-checks-every-resume-handle -->

## Notes

- Deliverable search (`plot-deliverable-search.sh`) for "resume handle usable role session", "role agent-setting transcript first line" and "ending resumeId role handle" found no existing rule: the matches were board copy about resuming a stalled agent, `plot-agent-manifest.sh:111` (the manifest's resume handle, read only), and role run plumbing (`plot-detached-run.mjs`). `git grep 'agent-setting\|agentSetting' origin/main -- packages` finds no code that reads a transcript's `agent-setting` line.
- Already fixed and left out: the blocked endings that recorded no `resumeId` (rows 10 and 10a and the spend-limit row, `agent-loop.ts:870-893`) and the role-session record written by the unblocker run (`registryd-main.ts:1604-1622`), both in `c77e9cf7c` (#3619).
- The measured `agent-setting` first line comes from a `claude -p --agent unblocker` run (`role-command.ts:80-81`). The SDK role path passes `agent: role.name` (`packages/domain/src/adapters/agent-run/agent-run-sdk.ts:335`). The slice 1 builder reads the first line of one SDK role transcript and states in the PR whether it carries the same `agent-setting` line. For reviewer, fixer and main-repair the first-line check is the only protection, because only the unblocker writes `plot-role-sessions`.
- Two other readers use the manifest's `resumeId`: the supervisor's correction resume (`packages/fleet/src/shared/supervisor.ts:258-260`) and the board's resume availability (`packages/board/src/server/resume.ts:47-57`). Neither slice changes them. After both slices, no continuation and no loop run leaves a role handle in a manifest, so both read a checked handle.
- The blocked-question prompt says "there is no conversation to resume" (`continuation.ts:300-302`), which is false where the continuation resumes the asking session. That wording has held since #1788 and is outside this plan.
- Two Approved plans edit the same files without touching resume-handle logic: `2026-11-21-fleet-state-is-read-whole-and-from-one-home` moves `ContinueRefusal` out of `continuation.ts:102`, and `2026-11-21-a-refused-start-is-retried-and-named` edits `runPrompt` at `worker-loop.ts:1636-1654`. Expect rebase conflicts only.
- After delivery, re-run the measured case: `plot-continue-command.mjs bug/fleetd-counts-in-the-bb-ledger -` on desk `desk-033f539d`. The expected output names `resumes 72aebb9c-09e4-4d6f-a6ab-e52846c8963c`. This is a check, not a slice.
