## Implementation brief — a-continuation-resumes-the-asking-agent (Resume)

- **Plan (canonical):** `docs/plans/2026-11-21-a-continuation-resumes-the-asking-agent.md` on main
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3605 merged
- **Branch:** `bug/a-continuation-resumes-the-asking-agent` (base: `main`)
- **Ends as:** one PR to main, closing #3604
- **Review of the code:** `Review: pr` — per the plan

One slice, no wave ordering: nothing waits on this branch and it waits on none.

### What to build

On 2026-11-21 `plot-continue-command.mjs bug/fleetd-counts-in-the-bb-ledger "<answer>"` resumed the unblocker's transcript on desk `desk-033f539d`. The resumed run read itself as the read-only answer agent, wrote nothing and exited after 26 s with `ESCALATE`. The head stayed `2f8bd0157` and `PLOT-BLOCKED.md` stayed in the desk. A second `continue` takes the same path, and `restart` refuses the desk for its marker, so no controller route moves the slice. Your fix is the fix only if that desk's next `continue` reaches an agent that can write.

Two defects combine, and the slice closes both:

1. **A blocked ending records no session.** In `packages/domain/src/workflows/agent-loop.ts`, ROW 10 (the agent wrote `PLOT-BLOCKED.md`), ROW 10a (the agent handed back `blocked`) and ROW 9c (`spend-limit`) call `end(...)` without the trailing `readings.resumeId` argument. ROW 15 and the conflict row above it pass it. Pass `readings.resumeId` on those three rows. Line numbers in the plan have drifted by a few lines since it was written; search for the row comments.
2. **The fallback picks the newest transcript in the desk.** `resumeIdFromTranscript` (`packages/fleet/src/shared/continuation.ts`, near line 565) takes the newest non-`agent-*` `.jsonl` by mtime. The unblocker runs with the desk as its working directory (`packages/fleet/src/server/entry/registryd-main.ts`, the `run:` block near line 1580, `role: 'unblocker'`, `resumeId: ''`), so its transcript lands in the same directory and is the newest after a pass that leaves the question to a person. Make the fallback skip every transcript a role run wrote. Where none remains, it answers `''` and the existing `|| randomUUID()` in `continueDesk` starts a fresh conversation with the continuation prompt, which already says "you are a NEW run, not a reply to it".

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

- **Both fixes, not one.** Recording the session alone leaves the fallback wrong for every desk whose ending predates the fix and for the endings that still record none (ROW 9b `turn-limit`, see Scope guard). Excluding role transcripts alone resumes an older, possibly stale transcript instead of the asking one. The operator chose both on 2026-11-21 (plan, Open Questions).
- **A fresh start is the fallback, never a role session.** The measured failure is a resume into the wrong role. A new run with the answer in the continuation prompt is correct where no asking session can be named.
- **The mechanism for excluding role runs is yours to choose, and the PR names it.** Two candidates: the role run records the session ids it starts, or the role run uses its own transcript directory so `transcriptDirFor(worktree)` never contains it. Pick the one that needs no change to the transcript naming the runtime owns. Measure before you commit to either: read how `agentRunCommand` names the session and where the runtime writes it.
- **No change to the continuation prompt, `plot-continue-command.mjs`, `POST /api/continue` or their refusals.** The controller refuses what it refused; this slice changes which session a permitted continuation resumes.
- **Rules carried over from related work:** absent is not false — a desk with no recorded `resumeId` and no usable transcript is `''`, a fresh run, never a refusal. Read the recorded value before any transcript scan: the `recorded` path in `continueDesk` stays first. A refusal ends the action; do not route around the controller to repair `desk-033f539d` by hand (the plan's Notes leave that desk unrepaired).

### Done when

The plan's `## Design › Tests` list is the specification:

- `agent-loop` unit cells: ROW 10, ROW 10a and the spend-limit row each produce a `loop-end` write whose `resumeId` equals `readings.resumeId`. A cell with `readings.resumeId` set to a non-empty id catches an `end` call that still drops it; one with an empty id proves nothing.
- `continuation.test.ts`: a desk whose ending records a `resumeId` resumes that id, whatever transcript is newest. Make a role transcript the newest by mtime, or the test passes on the old code too.
- `continuation.test.ts`: a desk whose ending records none and whose newest transcript is a role run's resumes no role session. It resumes the newest non-role transcript, or a new id where none exists. Cover both outcomes.

Name the local checks command and run it before each push: `node skills/plot/scripts/board/plot-local-checks.mjs`, and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. List no full suite.

The slice touches no `.sh` file. If that changes, `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base, and growth is paid for in the same change. Add a changeset for `@plot-pm/board` or `plot` as the changed package requires, description first and the `bumps:` block last. New functions are arrows, and a TSDoc block states what an export does, not the history of the decision.

### Bookkeeping

- Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Never `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.
- Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/workflows/agent-loop.ts`, `packages/fleet/src/shared/continuation.ts`, the unblocker run in `packages/fleet/src/server/entry/registryd-main.ts`, their tests, and a changeset.

ROW 9b (`turn-limit`) writes a blocked declaration with no `resumeId` exactly as ROW 9c does, and the plan names only 9c. The same defect, the same one-argument fix: pass `readings.resumeId` there too and say so in the PR, or leave it and report it. Do not widen past that.

No other plan branch is in flight on these files that this brief could verify at dispatch time; check `git log origin/main -- <file>` before you start and rebase on a moved file rather than guess.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
