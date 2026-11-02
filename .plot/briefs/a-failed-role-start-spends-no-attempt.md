## Implementation brief — fleetd-s-fixer-and-main-repair (wave: Failed start)

- **Plan (canonical):** docs/plans/2026-11-01-fleetd-s-fixer-and-main-repair.md on main
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #3029 merged
- **Branch:** `bug/a-failed-role-start-spends-no-attempt` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** standard PR review (`plot-review` GitHub App required on main)

This branch waits on `bug/fleetd-s-fixer-runs-bounded` (slice "Fixer bounds",
merged as PR #3031) and shares `auto-fixer.ts` with it, but shares no file
with `bug/the-role-command-passes-agents-json` (slice "Role command", merged
as PR #3037), so it can merge before or after that one — both prerequisite
slices are already on `main`.

### What to build

Before #3037 merges, every fixer and main-repair start fails immediately with
`--agent '<role>' not found. Available agents: claude, ...` — the CLI exits
non-zero before any agent runs. Right now that failure is invisible to both
roles' bookkeeping: the fixer's tick settles it as `moved` (as if the fixer
ran and ended cleanly) and spends one of the PR's two budgeted attempts;
main-repair's `startRole` resolves `'started'` on spawn regardless, so a dead
CLI spends the episode's one repair attempt with no log line naming why.

This slice makes a failed start a distinct, recorded outcome that spends
nothing — for both roles — using the refusal line already sitting in each
run's own log/output as the signal.

### Decisions the plan settles — do not re-derive them

**The refusal line is harness data, not a magic string inline in the rule.**
Hold `--agent '<role>' not found. Available agents: claude, ...` (or a pattern
over it) beside `HARNESS_LIMIT_LINES` in
`packages/domain/src/adapters/harness/limit-lines.ts`, or a sibling data file
under `adapters/harness/`. That file is **data only** by design (see its own
header comment) — it exports a constant, imports nothing, and holds no
function, so every match stays in a `rules/` file subject to the domain's
100% branch-coverage gate (`packages/domain/vitest.config.ts:71` covers
`src/!(adapters)/**`). Follow the same split here: the fixture is the real
tail of `.plot/state/fixer/3023.log` (one of the 19 logs measured
2026-11-01), the match lives in a rule.

**One pure rule answers "was this a failed start", and it must not catch a
normal non-zero exit.** `promptExit` (`packages/domain/src/rules/prompt-exit.ts:388`)
already answers `{ answer: 'unstarted' }` for *any* non-zero exit with no
limit line — a fixer that ran 60 turns and then crashed included. A
failed-start rule that fired on every `unstarted` would misclassify that case
as "spent nothing", which is wrong — a fixer that genuinely ran has spent its
attempt regardless of how it ended. The rule this slice adds must require
**both**: non-zero exit **and** the refusal line present in the output this
run appended. Build it as its own function in `rules/`, not as a new branch
inside `promptExt` itself — the two questions ("is this a usage-limit exit"
vs. "is this a CLI-argument-shape failure") are unrelated and the plan treats
them as separate rules over the same harness-data pattern, not one combined
rule.

**The fixer records the outcome at reap time, not at launch time.** The tick
already has a settlement point: `settleEnded` in
`packages/fleet/src/shared/auto-fixer.ts` (around `:226-264`), called from
`fixerTick` once `endedFixerAttempts` finds a dead pid. That is where to read
the attempt's log tail and the new rule's answer, and where to write
`start: 'failed'` onto the attempt plus log `fixer-end failed-start: <line>`
instead of the current unconditional `moved` (the existing `problems`
array/`outcome` string construction at `:258-264` is the place to add a third
branch — today it only distinguishes `moved` from `failed: <problems>` for
`worktree-not-removed`/`mark-not-cleared`/bound-hit; a failed start is a
**different** `failed:` cause, read from the log rather than from
`problems`). The plan allows writing the same record from `launchFixer`'s
`.then` instead (`auto-fixer.ts:513` region) as long as whichever runs first
produces the identical record — do not build two different shapes for the
two races. The mutation-test note in the plan ("write the record only from
the `.then`, and the reap-order row fails") means the test must prove both
orders converge; do not special-case "reap ran first" vs. "`.then` ran
first".

**The attempts schema gains one optional field, no version bump.**
`FixerAttemptSchema` (`packages/domain/src/entities/fixer-attempts.ts:47-58`)
is `.strict()` and has three fields today (`headSha`, `finding`, `inFlight`).
Add `start: z.literal('failed').optional()`. `FIXER_ATTEMPTS_VERSION` stays
`1` — old records with no `start` field decode fine with it absent, which is
exactly what the "old records decode" Done-when row tests. The header comment
on `FixerAttemptSchema` currently says the attempt is "WRITTEN ONCE, BEFORE
THE FIXER STARTS, AND NEVER MUTATED AFTER THE FIXER ENDS" — this slice's
settlement write of `start: 'failed'` is a deliberate, narrow exception to
that sentence (the plan calls it out explicitly: "the tick that settles the
attempt writes `start` once, as part of that settlement"), so update that
TSDoc to say so rather than leaving it to contradict the new code silently.

**The budget functions skip failed-start attempts — read the count, don't
re-derive it.** `fixerAttemptsSpent` and `fixerAttemptsExhausted`
(`packages/domain/src/rules/fixer-attempts.ts:22-32`) currently count
`record.attempts.length` unconditionally. Change the count to attempts whose
`start !== 'failed'`. `fixerInFlight` (same file, `:46-55`) is unaffected —
a failed start never carries an `inFlight` mark by the time this matters
(it only gets written once the process has already ended), so leave that
function untouched; do not add a `start` check there defensively.
`auto-ticket.ts` (`:241`, `:248`) already calls `fixerAttemptsExhausted` and
`fixerInFlight` and needs no change itself — fixing the two rule functions is
what fixes the ticket arm's behaviour, per the plan's "the fixer and the
ticket arm read the same budget" framing. Resist the temptation to patch
`auto-ticket.ts` directly; that would be the second implementation of a
decision the rule already owns.

**A failed start holds its head once, and a new head clears the hold.** After
settlement writes `start: 'failed'` for a head, the *next* tick's admission
check (`slicePrNext`, read through `fixerTick`'s existing flow) must refuse to
start a second fixer on that same head, logging the hold once with reason
`fixer-start-failed` (parallel to the existing `fixer-busy` hold from slice 1
— same shape, different reason string, via the same `logStart`/`logged` set
dedup keyed by `${pr}:${head}:${why}` that slice 1 already built at
`auto-fixer.ts` `logStart`). A push that changes the head clears the hold
automatically, because the hold is keyed by head, not by PR — no separate
"clear" logic is needed; a fresh head simply fails to match any existing
`start: 'failed'` attempt's `headSha`.

**Main-repair reads `end`, not `result.ok`.** `agentRunOf` in
`packages/fleet/src/shared/repair-role.ts` (`:162-190`) currently returns only
`result.ok`, and `AgentRunResult.end` (`packages/domain/src/ports/agent-run.ts:168`,
`:172`) already carries `{ answer: 'unstarted'; detail: string }` for exactly
this case — the `command` adapter's `detail` is the process's captured
output, which is where the refusal line lives for this runner. Change
`agentRunOf` to inspect `result.value.end` (not just `.ok`) and apply the same
domain rule used by the fixer against `end.detail` when `end.answer ===
'unstarted'`. On a match, `startRole` must: write `outcome: 'start-failed'`
(a new, distinct value — check how the main-repair record/outcome type is
currently shaped in this file and in whatever reads `run.json`/the episode
record, and add the variant there rather than overloading an existing one),
log a warning that names the refusal line (replacing today's generic "ended
without a result" for this specific cause — that message stays for the
genuine no-result case, i.e. where `result.ok` is false but `end` is NOT a
failed-start match), and leave the episode's one-attempt budget unspent. A
**second** failed start in the same episode holds the episode (parallel to
the fixer's head-hold) and logs the hold once — read how the episode's
attempt-spent state is tracked today (likely alongside `redMainStep` in
`packages/domain/src/rules/repair.ts`) before adding a second "attempts
spent" concept; reuse whatever the episode record already calls it rather
than inventing a parallel counter.

**Existing records are not touched by code.** The plan is explicit: do not
write a migration or a one-time rewrite for the 19 live
`.plot/state/fixer-attempts/*.json` records — they have no `start` field and
this slice's code cannot tell a pre-fix "moved" (actually a failed start,
misrecorded) from a genuine `moved`. That cleanup is a person's job, by hand,
after this slice merges: move `.plot/state/fixer-attempts/<pr>.json` to the
Trash (never delete outright — see this repo's `trash`-not-`rm` convention)
for each still-open PR with a spent budget. On 2026-11-01 that was #3012,
#3021 and #3022 — check whether those PRs are still open before touching
their records; a closed PR's record stays untouched regardless.

### Done when

The plan's `## Done when` table, slice 3 rows (lines tagged `| 3 |`) is the
specification — copied here for the branch:

- The refusal line is a failed start: run it against the 19 live log tails
  (fixtures) plus one non-zero tail that does **not** carry the line —
  failed-start for each of the 19, not a failed start for the other.
- The reap records the same failed start in either race order: a stub run
  that calls `onStarted` then resolves later on a test-held promise carrying
  the refusal line; running the reap tick both before and after that promise
  resolves must produce the identical attempt record (`start: 'failed'`) and
  exactly one `fixer-end failed-start` log line either way. No clock in this
  test — control ordering with the held promise, not with time.
- A failed start spends no attempt: a record with two failed-start attempts
  reads `fixerAttemptsSpent` as `0` and `fixerAttemptsExhausted` as `false`.
- The ticket arm does not accept on failed starts: a PR with a HIGH finding
  and a record holding only two failed-start attempts must trigger neither
  `putOnTicket` nor `writeAccepted`.
- A failed start holds its head: a failed start on head A, then a next pass
  on A, starts nothing and logs the hold once; the same PR on a new head B
  starts normally.
- Main-repair names a failed start: a stub run resolving with the refusal
  line writes `outcome: 'start-failed'`, logs a warning naming the line, and
  leaves the episode's attempt unspent; a second failed start in the same
  episode holds the episode.
- Old records decode: the 19 live records (as fixtures) decode with `start`
  absent, and `FIXER_ATTEMPTS_VERSION` stays `1`.

**Mutation checks the plan names explicitly** (apply these yourself before
calling the slice done, per this repo's mutation-testing norm — see memory
`mutation-test-a-gate-before-believing-its-tests`): count failed starts in
`fixerAttemptsSpent` (i.e. revert the skip) and the budget/ticket rows must
fail; write the attempt record only from the `.then` path and the reap-order
row must fail (proving the test actually exercises both race orders, not
just one).

Plus the repo's standing gates: new/changed functions are arrows (per
`CLAUDE.md`'s domain-package rule — this touches `packages/domain/src/rules/`
and `packages/domain/src/entities/`), TSDoc states behaviour not history, a
changeset naming package `plot`, and no committed `board-server.mjs` diff.
Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push
and run what it prints — it maps changed paths
(`packages/domain/**`, `packages/fleet/**`) to the right suites and gate
tests. The `CI suites` config key's suites run in CI; a failure there comes
back as a correction. List no full suite here.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grew
past its merge base — this slice is pure TypeScript (domain + fleet), so it
should not touch `.sh` files at all; if it turns out to need to, that growth
must be paid for in the same change.

### Bookkeeping

Open the PR through the controller once there is a real commit:

```bash
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

Never `gh pr create` directly. Once the PR exists, append `→ #<number>` to
this branch's line in the plan's `## Slices` section (the "Failed start"
heading, `docs/plans/2026-11-01-fleetd-s-fixer-and-main-repair.md:147`).

Push the first real commit as soon as it exists, so the branch is visible to
`/plot-pulse` and the board.

### Scope guard

This branch owns:

- `packages/domain/src/adapters/harness/limit-lines.ts` (or a new sibling
  data file in that directory) — the refusal-line fixture/pattern.
- A new rule function in `packages/domain/src/rules/` — the failed-start
  decision (new file, or added to an existing rule file if one clearly owns
  "harness start outcomes"; use judgement, but do not fold it into
  `prompt-exit.ts`'s existing function per the decision above).
- `packages/domain/src/entities/fixer-attempts.ts` — the `start` field.
- `packages/domain/src/rules/fixer-attempts.ts` — `fixerAttemptsSpent`/
  `fixerAttemptsExhausted` skip logic.
- `packages/fleet/src/shared/auto-fixer.ts` — `settleEnded` (and/or
  `launchFixer`'s `.then`), the head-hold log line.
- `packages/fleet/src/shared/repair-role.ts` — `agentRunOf`/`startRole`'s
  `end`-reading and the episode hold.
- Corresponding test files: `role-start` rule test (new), `auto-fixer.test.ts`,
  `fixer-attempts.test.ts`, `auto-ticket.test.ts`, `repair-role.test.ts`.

Other branches already merged from this plan (`bug/fleetd-s-fixer-runs-bounded`,
`bug/the-role-command-passes-agents-json`) touched the same two shared files
(`auto-fixer.ts`, `role-gate.ts`, `role-command.ts`) but are already on
`main` — rebase onto current `main` rather than guessing at conflicts; there
is no other branch concurrently in flight on this plan as of this writing.

If something is found that the plan did not anticipate, report it rather
than improvising outside scope.
