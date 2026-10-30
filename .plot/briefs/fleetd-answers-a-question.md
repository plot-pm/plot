## Implementation brief — the-fleet-answers-plot-blocked-questions (wave: Question answering)

- **Plan (canonical):** docs/plans/2026-10-29-the-fleet-answers-plot-blocked-questions.md on main
- **Approved:** 2026-10-30, Jan Wloka, plan-PR #2913 merged
- **Branch:** `feature/fleetd-answers-a-question` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per `plot/review` (required on main since 2026-10-15)

This is the plan's second and last slice. `feature/the-answer-record` (#2940) is
already merged — read its output, build nothing that duplicates it.

### What to build

The tick's escalation pass writes only `notify` (`registryd.ts`'s
`escalationWrites`, ~line 441-467) when a desk carries a `PLOT-BLOCKED` marker.
This slice adds the missing branch: before escalating, decide whether the
fleet itself should answer the question by starting the `unblocker` role,
handing its answer to `continueOnDesk`, and recording the outcome. Four
pieces, in dependency order:

1. **`unblockerDue`** — a new pure rule in `packages/domain/src/rules/`
   (no file yet; `git grep unblockerDue` returns nothing on `main`). Signature
   per the plan: takes the marker (with its author tag — see point 3), the
   `deskDead` answer, the live-fixer-run answer, and the recorded outcome for
   `(worktree, askedAt)` as **readings**, per this repo's readings-as-values
   shape (CLAUDE.md "A note on shape"). Answers `start` only when
   `deskDead` reads `{dead: false, why: 'waiting'}`, the marker carries no
   fleet/loop author tag, no fixer is live, and no record exists for that key.
2. **Marker authorship — the one piece with no existing precedent.**
   `Desk.writeBlockedMarker(worktree: string, text: string)`
   (`packages/domain/src/ports/desk.ts:82`) carries no author parameter, and
   neither call site distinguishes itself: `registryd.ts:1319`'s `askAPerson`
   (fleetd's own `needs-a-person` marker) and `agent-loop.ts`'s six
   `blocked-marker` writes (lines ~507, 551, 793, 809, 909, 964 — corrections
   spent, merge-conflict spent, etc., all written by the **loop**, not the
   agent) both call the same port the same way an agent's own
   `PLOT-BLOCKED: <question>` write does. There is no #2903-fixer precedent to
   copy — checked, none exists. You are building the tag from nothing: the
   plan's own framing ("the loop and fleetd mark the markers they write with a
   recognisable author") describes the goal, not a mechanism. The simplest
   shape is a second line or a prefix the port appends only when the caller
   names itself (e.g. `text` carrying `<!-- author: fleetd -->` or similar) —
   decide the exact marker format and keep `writeBlockedMarker`'s no-overwrite
   contract (desk.ts:82's doc) intact for both tagged and untagged callers.
3. **The tick write and applier wiring.** The tick returns an `unblock` write
   beside `notify` (new write kind) and spawns nothing itself — same shape as
   the fresh-agent step's `beforeStart` (`registryd.ts:1146-1160`, referenced
   by the plan). The applier writes the `started` row via the answer-record
   port (`packages/domain/src/ports/answer-record.ts`, `answerRecordFile()` in
   `packages/domain/src/adapters/answer-record/answer-record-file.ts`) before
   starting the role, then starts the `unblocker` role **detached** through
   the connector `feature/role-agents-start-detached` already built:
   `AgentRun.run(request: AgentRunRequest)`
   (`packages/domain/src/ports/agent-run.ts:21`), passing
   `request.roleAgent` (`RoleAgentRef`, same file ~line 50-54).
   `'unblocker'` is already a declared role name
   (`packages/domain/src/rules/role-command.ts:12`,
   `ROLE_NAMES = ['reviewer', 'fixer', 'unblocker', 'main-repair']`) and
   `.claude/agents/unblocker.md` already exists as a thin stub (read-only
   tools, `maxTurns: 20`, isolation `worktree`) — this slice **enriches that
   file's prompt text**, it does not create it.
4. **Applying the answer.** `continueOnDesk`
   (`packages/fleet/src/shared/continuation.ts:848`) already does almost
   everything the plan describes as future work for D1 — **this is drift from
   the plan, in your favor**: `ContinueRefusal` already has `'unattended'`
   (line 164-165, refuses before any read) and `'question-moved'` (line
   167-182, pinned via `expectedAskedAt`); `Caller` is
   `'person' | 'unattended' | 'fleetd'`
   (`packages/domain/src/workflows/decision.ts:23`); `continueOnDesk` already
   writes the `answered` row to the answer record on success (lines
   1522-1536, `author: input.author ?? 'unblocker'`). Call it with
   `caller: 'fleetd'`, `expectedAskedAt` pinned to the marker's own
   modification time, and `author: 'unblocker'`. A `question-moved` or other
   refusal is already recorded by `continueOnDesk` itself — do not add a
   second write for it.

### What is already built — do not rebuild it

Checked against `main` directly (the plan's Motivation section lists this as
future #2898 work; it has since merged):

- `unattended` and `question-moved` refusals, the `Caller`/`author`/
  `expectedAskedAt` plumbing, and the answer-record `answered`-row write
  inside `continueOnDesk` — all merged via #2937 and #2940.
- The answer-record port, file adapter (`.plot/state/answers.tsv`, append-only
  TSV keyed `(worktree, askedAt)`), and the `started`/`answered`/`refused`/
  `failed` outcome vocabulary — merged via #2940. Use `answerRecordFile()`;
  do not write a second TSV reader/writer.
- The `unblocker` role's declaration, its detached-start connector
  (`AgentRun.run` / `RoleAgentRef`), and the stub `.claude/agents/unblocker.md`
  — merged via #2956.
- `deskDead` itself (`packages/domain/src/rules/desk-dead.ts`) — merged via
  #2958, matching the plan's assumed shape exactly:
  `DeskDeadAnswer = { dead: true } | { dead: false; why: DeskLife }`,
  `DeskLife = 'live' | 'waiting' | 'elsewhere' | 'unread'`.

**Not built, and still this slice's job:** `unblockerDue` itself; the marker
author tag (point 2 above — genuinely from scratch); the `unblock` tick write
and its applier wiring to the role-start connector;
`questionEscalation`'s in-flight silence (point 5 below); the slice-PR-body
answer write; the `guessed` mark on an answer resting on no estate evidence;
enriching `unblocker.md`'s prompt text with the fixer's hard rules ("never
edit a gate or the CI ratchet, no bypass of `plot/review`, no release"; most
reversible answer; never "wait for a person").

5. **The ladder's in-flight silence.** `questionEscalation`
   (`packages/domain/src/rules/question-escalation.ts:42`) is currently a pure
   function of `marker`, `ageMs`, `ages`, `recordedRungs` only — it reads
   nothing from the answer record today. Add the record's outcome for
   `(worktree, askedAt)` as a new reading: while it reads `started`, return no
   new rung; once it reads `answered`, the marker itself is gone so the
   existing no-marker path already silences it; `refused`/`failed` fall
   through to today's notify-as-usual path. This is a signature change to an
   existing pure rule — update its call site in `registryd.ts`'s escalation
   pass (~line 459) to pass the new reading.

### Done when

The plan's `## Done when`-equivalent is its Acceptance list — treat each
bullet as a required test, not a suggestion:

- `packages/domain` unit tests for `unblockerDue`: no marker, a merged desk, a
  `deskDead` answer of `live`/`elsewhere`/`unread`, a live fixer run, and a
  **loop- or fleetd-authored marker** each start nothing — the last of these
  is the one that exercises point 2's new tag end-to-end, so write the
  fixture with a tagged marker, not just an absent one. `waiting` with no
  record starts one run; a `started` or `refused` record for the key starts
  nothing; a new `askedAt` (i.e. the desk got re-blocked after an earlier
  answer) starts one run again.
- `packages/fleet` unit test: a mismatched question key refuses
  `question-moved` and writes nothing on the desk (this path already exists
  in `continueOnDesk` — the new test is that your applier surfaces it
  correctly, not that the refusal itself needs building).
- `registryd-tick.test.ts`: a marker yields one `unblock` write and the tick
  spawns nothing directly (the applier spawns, the tick decides); a second
  tick reading the `started` row yields none.
- `question-escalation.test.ts`: a `started` record yields no new rung.
- Each answer the desk acted on is written into its slice PR's body, beside
  the diff it caused — find wherever the slice PR body is composed today
  (likely near `plot-open-pr.sh` / `plot-slice-pr.mjs`'s domain-side caller)
  and add the answer text there, bounded by `ANSWER_MAX` / `BODY_LIMIT`
  already defined in `continuation.ts:86,97`.

Plus the repo's standing gates: no `spawn`/`execFile` outside
`packages/*/src/adapters/` (CI's ratchet, currently `allowed=28`); the domain
package's arrow-function rule for any new function you write in
`packages/domain/src/`; a TSDoc comment on every new export that states
behavior, not history. Run
`node skills/plot/scripts/board/plot-local-checks.mjs` before each push and
run what it prints — it maps your changed files to the right suites and
gates. Do not run `test:e2e` locally; it is CI's gate only (CLAUDE.md
"Testing").

Name the shell gate explicitly: `scripts/check-shell-lines.sh` refuses a PR
whose shell under `skills/` grew past its merge base. This slice is expected
to touch **no** `.sh` file — everything above is TypeScript in
`packages/domain` and `packages/fleet` plus one markdown prompt file
(`unblocker.md`). If you find yourself editing a `.sh` file, that is a signal
you have drifted from the plan's own layering (CLAUDE.md "The Layering
Rule") — stop and report it rather than paying the shell-lines cost.

### Bookkeeping

Push the first real commit as soon as it exists — a claimed branch with no
commits for a long stretch reads as a stalled desk. When the PR exists, open
it through the controller, never `gh pr create`:

```bash
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Then append `→ #<number>` to this branch's line in the plan's `## Slices`
section (`feature/fleetd-answers-a-question`'s line, "Question answering"
subheading).

### Scope guard

This branch owns: `packages/domain/src/rules/unblocker-due.ts` (new),
`packages/domain/src/rules/question-escalation.ts` (signature change),
`packages/fleet/src/server/entry/registryd.ts` /`registryd-tick.ts` (the new
`unblock` write and its applier), `packages/domain/src/ports/desk.ts` /
`desk-fs.ts` / `desk-fixture.ts` (the author-tag parameter on
`writeBlockedMarker`, and every existing call site that must now pass or omit
it — `registryd.ts:1319`'s `askAPerson` and `agent-loop.ts`'s six
`blocked-marker` writes both need an author passed through), and
`.claude/agents/unblocker.md` (prompt enrichment only).

It does **not** own: the answer-record port/adapter or `continueOnDesk`'s
refusal plumbing (`feature/the-answer-record`, already merged — read-only);
`deskDead` itself (`feature/fleetd-reviews-slice-prs`, already merged,
read-only); the role-start connector or role declaration
(`feature/role-agents-start-detached`, already merged, read-only). Touching
any of those three is out of scope — if one looks wrong, report it rather
than fixing it here.

No other branch is in flight on this plan concurrently: `feature/the-answer-
record` is the plan's only other slice and it is already merged (PR #2940),
so there is no sibling to collide with.

If you find something the plan did not anticipate — and several things here
already diverged from what it assumed, all in the direction of less work
left to do — report it rather than improvising outside scope.
