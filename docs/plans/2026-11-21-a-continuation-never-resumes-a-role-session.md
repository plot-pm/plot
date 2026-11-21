# A continuation never resumes a role session

> Every resume handle a continuation or a loop ending carries passes one domain predicate, which rejects a role run's session, so a person's answer reaches the implementing agent or a fresh session and never the unblocker.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #3643
- **Review:** pr
- **Impl:** own branches

## Changelog

- A continuation never resumes a role run's session (for example the unblocker's read-only answer session), whether the handle comes from the desk's ending, from a stamped manifest or from the transcript scan. Where no usable handle remains, the continuation starts a fresh session with the answer.
- A loop ending never records a role run's session as its `resumeId`, so a later continuation cannot take it as the recorded handle.

<!-- Board impact: none. No plan format, template, helper script or docs/plans layout changes. -->

## Motivation

#3619 (`c77e9cf7c`, plan `2026-11-21-a-continuation-resumes-the-asking-agent`) added a role filter to one of the three sources of a continuation's resume handle. The other two sources bypass it, and the filter itself depends on a record that older desks do not have.

1. **The recorded handle is never checked.** `continueDesk` takes `const resumeId = recorded !== '' ? recorded : resumeIdFromTranscript(worktree) || randomUUID();` (`packages/fleet/src/shared/continuation.ts:1242`, `recorded` read at `:1231` from the desk's `.plot-worker.ending.json`). A role handle in the ending wins over every other candidate.
2. **A stamped manifest's handle is never checked.** Where `continueTarget` answers `manifest: 'stamp'` (`continuation.ts:1228-1229`), the continuation keeps the manifest's own `resumeId`. Only `input.fresh` replaces it (`:1275`).
3. **The transcript scan knows only recorded role runs.** `resumeIdFromTranscript` (`continuation.ts:650-660`) skips the handles that the desk's `plot-role-sessions` file lists (`:555-582`). Only an unblocker run after `c77e9cf7c` writes that file (`packages/fleet/src/server/entry/registryd-main.ts:1604`, `:1622`). A desk whose unblocker ran earlier has no record.
4. **The loop writes the role handle forward.** `worker-loop.ts:917` passes `manifest.resumeId` to the domain as `readings.resumeId`, every `end(...)` in `packages/domain/src/workflows/agent-loop.ts` (`:526`, `:570`, `:865`, `:872`, `:883`, `:893`) carries it on the `loop-end` write, and `packages/fleet/src/server/entry/loop-writes.ts:218` writes it into the ending. Once a continuation resumes a role session, every later continuation reads that handle as `recorded`.

Measured 2026-11-21 on desk `desk-033f539d` (`bug/fleetd-counts-in-the-bb-ledger`), re-checked for this plan:

- The desk's transcript directory holds three transcripts. `72aebb9c-09e4-4d6f-a6ab-e52846c8963c` (the implementing session, last written 00:26Z) and `6b1c76a1-…` open with a `queue-operation` line. `f5e4b3c3-e7f8-4f15-a052-f7b6e1ec51a8` (last written 12:02Z) opens with `{"type":"agent-setting","agentSetting":"unblocker","sessionId":"f5e4b3c3-…"}`.
- `.plot-worker.ending.json` records `"reason":"blocked"` and `"resumeId":"f5e4b3c3-e7f8-4f15-a052-f7b6e1ec51a8"`.
- The desk's gitdir holds no `plot-role-sessions` file.
- The continuations at 05:04Z and 12:01Z both resumed `f5e4b3c3`. The second one answered `ESCALATE` and exited 0. A third `plot-continue-command.mjs` resumes it again, because `plot-continue-command.mjs` passes no `fresh` option.

## Design

### Approach

**One domain rule decides whether a handle is usable.** A new rule `packages/domain/src/rules/resume-handle.ts` exports `resumeHandleUsable`, an arrow function with a factual TSDoc block. It takes readings as values and does no I/O:

```ts
resumeHandleUsable({ handle, roleSessions, firstLine }) =>
  | { usable: true }
  | { usable: false; why: 'empty' | 'role-listed' | 'role-transcript' }
```

- `handle` is the candidate; `''` answers `empty`.
- `roleSessions` is the desk's `plot-role-sessions` record as a `ReadonlySet<string>`. A handle in it answers `role-listed`.
- `firstLine` is the first line of the handle's transcript, or `null` where no transcript exists. A line that parses as JSON with `type: 'agent-setting'` and an `agentSetting` that `ROLE_NAMES` (`packages/domain/src/rules/role-command.ts:15`) contains answers `role-transcript`. An unparseable line, another `type`, or `null` does not reject. A handle with no transcript stays usable, because the loop then starts a new session under that id, as `resumeAvailability` (`rules/resume.ts:78`) already describes.

**The continuation runs every candidate through it, in order.** `continueDesk` in `continuation.ts` builds the candidate list and takes the first usable one:

1. the ending's recorded `resumeId` (`:1231`);
2. for `manifest: 'stamp'`, the stamped manifest's own `resumeId`;
3. the transcript scan's handles, newest first by mtime.

Where no candidate is usable, the continuation uses `randomUUID()`. On the stamp path a rejected manifest handle is replaced with `writeResumeId` (`packages/fleet/src/shared/manifest-stamp.ts:340`), and a failed write refuses the start as the `fresh` path already does (`continuation.ts:1275-1278`). `resumeIdFromTranscript` stops filtering by itself and returns the scan's handles in order; the rule makes the decision.

**Reading the readings stays in the fleet's transcript reader.** `continuation.ts` already reads the desk's transcripts (`deskTranscripts`, `:585`) and its role record (`roleSessions`, `:574`). The slice adds `transcriptFirstLine(worktree, handle)` beside them, which reads only the first line of `<transcriptDirFor(worktree, home)>/<handle>.jsonl`, and exports it and `roleSessions` for the second slice. The rule never reads a file.

**The loop ending uses the same predicate at read time.** The ending write is not a separate check in `loop-writes.ts`: the applier writes what the decision carries. Instead, `worker-loop.ts` reads the role record and the first transcript line for `manifest.resumeId` where it builds the readings (`:917`), and passes `''` as `readings.resumeId` where `resumeHandleUsable` rejects it. Every `end(...)` then carries no role handle, and `loop-writes.ts:218` writes none. The same `''` reaches the correction resume (`agent-loop.ts:1015`), which then starts a fresh worker instead of correcting inside a role session (`AgentLoopReadings.resumeId`, `agent-loop.ts:272-273`: "`''` to start a fresh worker").

**No change to the controller, its refusals or the continuation prompt.** `plot-continue-command.mjs` and `POST /api/continue` stay as they are. The fresh-start prompt already says "You are a NEW run, starting fresh" (`continuation.ts:317`).

### Tests

Slice 1, rule:

- `packages/domain/test/rules-resume-handle.test.ts`: an empty handle answers `empty`; a handle in `roleSessions` answers `role-listed`; a first line `{"type":"agent-setting","agentSetting":"unblocker","sessionId":"…"}` answers `role-transcript`, and so does each of `reviewer`, `fixer` and `main-repair`; a first line with an `agentSetting` that is not a declared role, a `queue-operation` line, an unparseable line and `null` each answer `usable`.

Slice 1, continuation (`packages/fleet/test/unit/continuation.test.ts`):

- The measured case: the ending records handle F, F's transcript opens with the unblocker `agent-setting` line, no `plot-role-sessions` file exists, and an older implementer transcript I exists. The written manifest's `resumeId` is I.
- The ending records F and F is the only transcript: the manifest's `resumeId` is a new id that is not F.
- The ending records F and `plot-role-sessions` lists F: the manifest's `resumeId` is not F.
- A stamped manifest whose `resumeId` is a role handle gets the next usable candidate written into it; a stamped manifest whose `resumeId` is the implementer's keeps it.
- The existing case "resumes the session the ending recorded, although a role transcript is newest" (`continuation.test.ts:798`) still passes: a recorded non-role handle wins over a newer role transcript.

Slice 2, loop ending:

- `packages/fleet/test/unit/worker-loop.test.ts`: a manifest whose `resumeId` transcript opens with a role `agent-setting` line produces readings with `resumeId: ''`; a manifest naming the implementer's handle keeps it.
- `packages/fleet/test/unit/loop-writes.test.ts`: a `loop-end` write with no `resumeId` produces an ending with no `resumeId` field (the applier writes what the decision carries).

### Open Questions

- [ ] `[question-any-agent-setting]` Must the rule reject a transcript that opens with any `agent-setting` line, or only one whose `agentSetting` is a declared role in `ROLE_NAMES`? This plan rejects declared roles only, so that a future worker run with `--agent` stays resumable.
- [ ] `[question-repair-the-live-ending]` Must the first slice also rewrite an ending that already records a role handle (as `desk-033f539d`'s does), or is it enough that the continuation ignores it? This plan only ignores it: the next loop ending on that desk replaces it.

## Slices

### Continuation

- `bug/a-continuation-checks-every-resume-handle` — `resumeHandleUsable` in the domain, the first-line transcript reader, and `continueDesk` running the recorded, stamped and scanned handles through it <!-- builds: resumeHandleUsable, a domain rule that rejects a role run's resume handle -->

### Ending

- `bug/a-loop-ending-records-no-role-handle` — `worker-loop.ts` passes `''` as `readings.resumeId` where `resumeHandleUsable` rejects the manifest's handle, so no ending records a role handle <!-- builds: role-handle check on the loop's resumeId reading --> <!-- waits: bug/a-continuation-checks-every-resume-handle -->

## Notes

- Deliverable search (`plot-deliverable-search.sh`) for "resume handle usable role session", "role agent-setting transcript first line" and "ending resumeId role handle" found no existing rule: the matches were board copy about resuming a stalled agent, `plot-agent-manifest.sh:111` (the manifest's resume handle, read only), and role run plumbing (`plot-detached-run.mjs`). No code on origin/main reads a transcript's `agent-setting` line.
- Already fixed and left out: the blocked endings that recorded no `resumeId` (rows 10 and 10a and the spend-limit row, `agent-loop.ts:870-893`) and the role-session record written by the unblocker run (`registryd-main.ts:1604-1622`), both in `c77e9cf7c` (#3619).
- The second slice waits on the first only for `resumeHandleUsable` and the exported readers. Without the first slice, the loop has no rule to ask.
- After delivery, re-run the measured case: `plot-continue-command.mjs bug/fleetd-counts-in-the-bb-ledger -` on desk `desk-033f539d`. The expected result is a run that resumes `72aebb9c-09e4-4d6f-a6ab-e52846c8963c`. This is a check, not a slice.
