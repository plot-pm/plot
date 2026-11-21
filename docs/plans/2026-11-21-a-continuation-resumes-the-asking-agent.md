# A continuation resumes the asking agent

> A person's answer to a blocked agent reaches an agent that can act on it, never the read-only unblocker's session.

## Status

- **State:** Approved
- **Type:** bug
- **Issue:** #3604
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3605 merged
- **Started:** 2026-11-21, Jan Wloka, `bug/a-continuation-resumes-the-asking-agent`

## Changelog

- A continuation answer resumes the session of the agent that asked the question. Where no such session is recorded, the run starts fresh with the answer and never resumes a role agent's session.

<!-- Board impact: none. No plan format, template, helper script or docs/plans layout changes. -->

## Motivation

On 2026-11-21 `plot-continue-command.mjs bug/fleetd-counts-in-the-bb-ledger "<answer>"` resumed the unblocker's transcript on desk `desk-033f539d`. The resumed run read itself as the read-only answer agent, wrote nothing, and exited after 26 s with `ESCALATE`. The branch head stayed `2f8bd0157` and `PLOT-BLOCKED.md` stayed in the desk. A second `continue` takes the same path, and `restart` refuses the desk for its marker, so no controller route moves the slice (#3604).

Two defects combine:

1. **A blocked ending records no session.** `agentLoop` writes the `blocked` ending for row 10 (the agent wrote `PLOT-BLOCKED.md`, `packages/domain/src/workflows/agent-loop.ts:880-884`) and row 10a (the agent handed back `blocked`, `:890-894`) without a `resumeId`. Rows that do pass one, for example `:526` and `:570`, pass `readings.resumeId`. The spend-limit ending at `:870` writes a blocked declaration and also passes none.
2. **The fallback picks the newest transcript in the desk.** With no recorded `resumeId`, `continueDesk` takes `resumeIdFromTranscript(worktree)` (`packages/fleet/src/shared/continuation.ts:1171`), the newest non-`agent-*` transcript by mtime (`:565`). The unblocker role runs with the desk as its working directory (`packages/fleet/src/server/entry/registryd-main.ts:1580-1600`), so after an unblocker pass that leaves the question to a person, that newest transcript is the unblocker's.

## Design

### Approach

- **Every ending that writes a blocked declaration records the asking session.** Rows 10 and 10a and the spend-limit row pass `readings.resumeId` to `end`, as rows 526 and 570 do. The handle is the session that asked, so `continueDesk` resumes it through the existing `recorded` path.
- **The transcript fallback never resumes a role agent's session.** A role run in a desk records the session ids it starts, or runs with its own transcript directory, so that `resumeIdFromTranscript` can exclude them. The builder chooses the mechanism and names it in the PR. Where the fallback finds no transcript that is not a role's, it answers `''`, and the existing `|| randomUUID()` starts a fresh conversation with the continuation prompt. That prompt already says "you are a NEW run, not a reply to it" (`continuation.ts:302`).
- **No change to the continuation prompt, the controller or its refusals.** `plot-continue-command.mjs` and `POST /api/continue` stay as they are.

### Tests

- `agent-loop` unit cells: rows 10 and 10a and the spend-limit row each produce a `loop-end` write whose `resumeId` equals `readings.resumeId`.
- `continuation.test.ts`: a desk whose ending records a `resumeId` resumes that id, whatever transcript is newest.
- `continuation.test.ts`: a desk whose ending records none, and whose newest transcript is a role run's, resumes no role session. It resumes the newest non-role transcript, or a new id where there is none.

### Open Questions

- [x] Which fix from #3604: the first two (record the session; exclude role transcripts), with a fresh start as the existing fallback. Operator decision, 2026-11-21.

## Slices

### Resume

- `bug/a-continuation-resumes-the-asking-agent` — blocked endings record the asking session, and the transcript fallback skips role runs <!-- builds: resumeId on blocked endings, role-run exclusion in resumeIdFromTranscript --> → #3619

## Notes

- The stuck desk `desk-033f539d` (`bug/fleetd-counts-in-the-bb-ledger`) is not repaired by this plan. Once it merges, a new `continue` on that branch resumes correctly only if the asking session can be named; otherwise it starts fresh with the answer.
