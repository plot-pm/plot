# Panel moderation: the-delivery-loop-keeps-a-run

Reconcile: **unanimous amend** (layering, safety, testability, seams). Every juror ran `question-escalation.test.ts` (18/18); testability also ran the fresh-agent-record and escalations tests and `check-state-declarations.sh`. No juror could run the plan's own code, which does not exist yet.

## Agreed by all four

1. **Stall arm 2 leaves this plan.** "Both fixer attempts spent on one finding" reads #2903's attempts file, and #2903 depends on this plan through #2900. It moves to #2903 (or a slice that waits on it). Open Question 3's run-log reading of the finding is dropped: it would be a second attempts store, which #2903 and #2906 refuse.
2. **One notification per stall needs a record.** The rule's readings carry the stalls already notified; every send is recorded with its outcome (`sent`, `unaskable`, `failed`). This repo declares no `Notify command`, so every send here answers `unaskable` and must still be recorded.
3. **Slice 1 instruments today's steps** (dispatch, correction, fresh agent, deliver), so the port ships with callers before #2900–#2903 exist.
4. **The run log is an action record, not an index.** Drop the *A Decision Reads The Index* framing. No rule reads a host fact from it. Safety adds: only the stall notification reads it; no merge, fixer, restart, revert or attempts decision does.
5. **A step is an action or a change of answer, never a per-tick evaluation.** Otherwise a slice waiting on CI writes a line every tick and never stalls, and the log grows by about 1,440 lines per slice per day.

## Disagreement, settled as a moderator's call

- **Where the notify record lives.** Layering and seams point at the `questionEscalation` + `escalations.tsv` pattern; testability refuses to mix stall rows into the question-escalation file. Both hold if the pattern is copied, not the file: a `notified` line in the run log keyed on slice and episode start, written through a `Decision` write (a new kind beside `NotifyWrite`), and read back by the rule. One input, one domain unit test.

## Points one juror raised that the amendment takes

- The subject set comes from the open slice PRs in the PR index; a slice with no line counts from the PR's `createdAt` or claim time, never from before fleetd's start (safety).
- Only the looping daemon writes the log and sends; `--once` writes nothing (safety, `registryd-main.ts:2543`).
- A failed or partial host answer does not reset the clock (safety).
- A `RunLog` port and file adapter in `packages/domain`, after `fresh-agent-record`, under the common git dir's `.plot/state/`, with each writer process and the append atomicity named (layering, safety, testability).
- `stalled` is already an Agent state (`rules/task.ts:14`); the new concept needs another word (layering).
- A config key with the `Question escalation` duration grammar and a default above the one-merge-in-flight wait (testability, layering).
- How the stall rule relates to the question ladder and to #2901's "third question" notification, so a blocked desk gets one message, not two (seams).
- Notes list #2902, #2903, #2904, #2906, #2907 as expected writers; those plans name #2899 as a need (seams).

## Shared blind spot

All four read the plan as infrastructure for later plans. None asked whether a person reading the log needs a view of it on the board; the design leaves that to the builder, so the plan should say "no board view in this plan" explicitly.

## For the person

- Whether a `hold` (queued behind one merge in flight, or main red) counts as a step. The moderator's call: it does not, and the stall bound's default sits above the expected merge-queue wait.
