## Implementation brief — a-high-finding-is-fixed-before (wave 2: Fixer start)

- **Plan (canonical):** docs/plans/2026-10-29-a-high-finding-is-fixed-before.md on main
- **Approved:** 2026-10-29
- **Branch:** `feature/fleetd-starts-the-fixer` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot/review`, same as every PR here

This is the second of three waves. Wave 1, `feature/the-fixer-attempts-record`,
merged as PR #2930 and gives you the whole attempts-record API already built
(entity, rule, port, file adapter — see below). Both of this wave's `waits:`
annotations have also merged: `feature/role-agents-start-detached` (PR #2956,
gives you `roleCommand`/`RoleAgentRef`) and `feature/fleetd-reviews-slice-prs`
(gives you the index row fields this wave reads). Nothing blocks this wave from
starting. Wave 3, `feature/an-unfixed-high-is-ticketed`, waits on you — it
reads the attempts-spent state you write.

### What to build

Two stubs in `packages/domain/src/rules/slice-pr-next.ts` currently answer
`none`:

```ts
export const highArm = (readings: SlicePrNextReadings): SlicePrStep =>
  readings.ticket?.read === 'unread' ? hold('unread') : none('high-not-built');

export const ciRedArm = (_readings: SlicePrNextReadings): SlicePrStep => none('ci-red-not-built');
```

Replace both with the real arms (plan Design, "The arms", items 1–3 and 7 are
yours; items 4–6 are wave 3's `ticket`/`write-status` steps — leave those
`none` here). The composition order in `slicePrNext` already has them wired at
the right position (`fixerInFlightArm` ahead of `highArm` ahead of `ciRedArm`)
— you are filling in exported functions, not touching the array.

**`highArm`**: HIGH on this head (`row.plotReview === 'failure'` with
`row.plotReviewSha === row.headSha`), no fixer in flight, attempts budget not
spent → `{ step: 'fixer', head: row.headSha, evidence: 'high' }`.

**`ciRedArm`**: CI red on this head (`row.ciChecks === 'failing'` with
`row.checksSha === row.headSha`), desk dead *or* corrections-spent per the
distinction below, no fixer in flight, attempts budget not spent → `{ step:
'fixer', head: row.headSha, evidence: 'ci-red' }`. CI red with attempts spent →
`{ step: 'hold', reason: 'ci-red-attempts-spent' }` (plan item 7).

Then build the fleet-side tick that turns a `fixer` step into a running
process: write the attempt, take the continue lock, re-ask the host, start the
role. There is no existing fixer-tick file to extend — `packages/fleet/src`
has no caller of `deskDead`, `roleCommand`, or the fixer-attempts port yet.
`packages/fleet/src/shared/auto-review.ts`'s `reviewTick` is the shape to
follow (one function, one pass over open rows, reads fresh state per row,
calls `slicePrNext`, acts on the one step it owns) — it is not your dependency,
just your template.

### Settled decisions — do not re-derive them

- **"HIGH, desk alive" was considered and dropped (D2).** The obvious design —
  write a correction while the agent that produced the HIGH is still on the
  desk — cannot work: `agent-loop.ts:461-477` seals the desk and releases the
  branch on green CI *before any review exists*. By the time a review can
  answer HIGH, the desk that owned that head is already gone. Every HIGH goes
  to the fixer; there is no "alive" branch to build.

- **Desk-dead reading is arm-specific, not uniform.** The CI-red arm's "desk
  dead" condition is `deskDead` (`rules/desk-dead.ts`) answering `{ dead: true
  }` — `live`, `elsewhere` and `waiting` are not dead, `unread` holds. But a
  desk that ended with `corrections-spent` is *not* read through `deskDead`
  for that case: `ending-action.ts`'s `FRESH_SESSION_ENDINGS` gives
  `corrections-spent` one fresh session first (`start-fresh`), and that fresh
  session, on reaching `needs-a-person`, writes the loop's own `PLOT-BLOCKED`
  marker (ROW 15, `agent-loop.ts:503-509`) — which makes `deskDead` read the
  desk as `waiting`, never `dead`. Reading `deskDead` alone for corrections-spent
  would permanently refuse the fixer on exactly the desks this arm exists to
  catch. So: read the ending record directly for `corrections-spent` (has the
  fresh session also ended?), and read `deskDead` for everything else. This
  plan's territory is a desk dead *with a PR*; a dead desk with no PR is
  #2906's (`unreadable` ending → one fresh session, then a person — not yours).

- **Attempt write precedes the start, unconditionally, per the plan and per
  `ports/fixer-attempts.ts`'s own doc comment.** `FixerAttemptsStore.append` is
  called before the fixer process starts, and the start is refused if `append`
  does not return success — not logged-and-continued, refused. The ordering is
  deliberate and asymmetric: a crash between the write and the start spends an
  attempt and starts nothing (costs one budget slot, safe); reversing the
  order would let a crash *after* the start leave a running fixer with no
  record, so a restart of this tick starts a second one beside it. `pr` keys
  the record, not `head` — the budget is two attempts total across every head
  the PR carries, never refreshed by a push. You call `append`, you don't
  design its shape; it's already built and tested (wave 1).

- **In-flight and budget reads use opposite defaults on purpose — read
  `rules/fixer-attempts.ts`'s own comments before touching either.**
  `fixerAttemptsSpent` treats a missing or unreadable record as zero (safe
  direction for a budget: never refuses a fixer forever on a filesystem
  hiccup). `fixerInFlight` treats an *unreadable* record as in-flight/held
  (safe direction for "no second fixer": a corrupt in-flight mark must not
  read as "nothing running"), while a *missing* record (`'none'`) still reads
  as not-in-flight. These two functions are deliberately not unified — don't
  "simplify" them to share one default.

- **The continue lock is per-desk (per-worktree), not per-PR.** Use
  `packages/fleet/src/shared/continue-lock.ts`'s `takeContinueLock(worktree)` —
  already built, already used by `continueOnDesk` for the same race. Taking it
  before the fixer starts means a person's `/plot-continue` or the unblocker
  refuses while the fixer runs on that branch; you are the second caller of an
  existing lock, not building a new one.

- **The role mechanism is `roleCommand`/`RoleAgentRef`
  (`packages/domain/src/rules/role-command.ts`), already built in wave
  `feature/role-agents-start-detached` — there is no fleet-side caller of it
  yet, you are the first.** Build `RoleAgentRef` for `name: 'fixer'` with
  `agentsFile`/`settingsFile` as absolute paths read from the default branch's
  copy (not from inside the worktree you are about to create — the role-gate
  hook in `.claude/settings/fixer.json` requires `PLOT_ROLE_GATE` to name a
  path *outside* the role's own tree, and `role-gate.ts`'s `gateInsideTree`
  refuses every call otherwise). `roleCommand(ref, maxTurns)` builds the shell
  fragment; `.claude/agents/fixer.md` already declares `maxTurns: 80` and
  `isolation: worktree` in its frontmatter, but `maxTurns` inside `--agents`
  JSON does **not** bound a top-level `--agent`-selected run (measured
  2026-10-29 in wave 1's own probe: `maxTurns: 1` ran 4–6 turns) — pass the
  bound as `roleCommand`'s own `maxTurns` argument (the CLI `--max-turns`
  flag), reading it from the frontmatter yourself rather than trusting the
  JSON translation to enforce it.

- **fleetd creates the fixer's worktree itself — `isolation: worktree` in the
  role file is a declaration for a human reading it, not a mechanism anything
  reads yet.** No code in `packages/fleet/src` currently inspects that field.
  Follow the existing desk-worktree creation shape in
  `packages/fleet/src/shared/auto-deliver.ts` / `registryd-main.ts` (`git
  worktree add` on the PR's own branch) rather than inventing a second one —
  the fixer checks out the PR's branch, same as a normal desk, so the fixer
  can push to it directly.

- **The re-ask-before-start is a fresh host call, not a stale index read.**
  Before starting, re-ask the host for the PR's current state and head SHA and
  refuse by name — `pr-not-open` if the PR closed/merged since the row was
  read, `head-moved` if the head SHA changed. This is the same "Answers, never
  verdicts" / host-is-authority discipline the rest of this estate already
  uses for merges; it is not optional because the index row you read `fixer`
  from could be arbitrarily stale by tick time.

- **The fixer pushes without force.** It got the head SHA it started on; if
  that head has moved by the time it pushes, the push fails rather than
  overwriting someone else's commit. This is the fixer role's own behaviour
  (nothing here enforces it structurally) — it is stated in the plan so you
  don't add a force-push "to be safe."

- **Not yours: the `ticket` and `write-status` steps (plan items 4–6), the
  merge arm, the run log, the idle-slice notification, a HIGH on #2904's
  repair PR.** `highArm` and `ciRedArm` answer `none`/`hold` for every
  condition outside items 1–3 and 7 — do not pre-build wave 3's ticket logic
  "while you're in the file." A row with no `plotReview`/`ciChecks` field at
  all (not asked) answers `none`, same as an absent field anywhere else in
  this estate.

### Done when

The plan's slice line is the spec: *"the HIGH and CI-red arms of
`rules/slice-pr-next.ts`; fleetd owns every fixer start on a desk that has a PR:
HIGH on this head, and CI red with the desk dead or corrections spent; writes
the attempt first, takes the per-desk continue lock, re-asks the host before
the start, logs each step."*

Assertions a naive implementation would pass without:

- A HIGH on a head that is *not* the row's current `headSha` (a stale review
  on an old push) does **not** trigger `highArm` — only `plotReviewSha ===
  headSha` counts as "on this head."
- A CI-red row whose desk answers `deskDead` `{ dead: false, why: 'waiting' }`
  because of a `PLOT-BLOCKED` marker from a *spent* `corrections-spent`
  fresh session still starts the fixer — this is the case `deskDead` alone
  gets wrong, and the whole reason the ending is read directly for that one
  ending reason.
- A CI-red row whose desk is `waiting` for any *other* reason (an
  in-progress, non-exhausted fresh session, or a live desk mid-turn) does
  **not** start the fixer — only the exhausted-corrections-spent case
  overrides `deskDead`.
- An `'unreadable'` fixer-attempts record holds (`fixerInFlight` → true) and
  starts no second fixer, while a missing one (`'none'`) does not block a
  first attempt.
- A budget-exhausted PR (`fixerAttemptsSpent >= FIXER_ATTEMPTS_BUDGET`) on a
  fresh HIGH does not start a third fixer — `ciRedArm`/`highArm` both answer
  `none` (HIGH) or the item-7 hold (CI-red), never `fixer`.
- `append`'s failure refuses the start outright — assert no process spawn
  happens when the attempts-store write fails, not a "log and continue."
- The fixer's `RoleAgentRef` paths resolve outside the worktree being created
  — assert the gate would not refuse `gateInsideTree` for the paths you build.

Plus the repo's gates: a changeset under `.changeset/` naming `plot` (patch or
minor per your judgement of scope), and the shell-lines ratchet
(`scripts/check-shell-lines.sh`) if you touch any `.sh` file (you likely won't
— this is domain + fleet TypeScript). Run
`node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run
what it prints — `packages/domain/**` and `packages/fleet/**` both carry
`vitest related` + `tsc --noEmit` entries in the `## Plot Config` `Local
checks` key. List no full suite; do not run `test:e2e` locally (CI's job).

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create` —
it takes its title from the slice line rather than the last commit subject.
Once it has a number, append `→ #<number>` to this wave's slice line in the
plan. Push your first real commit as soon as you have one landing, not at the
end — a claimed branch with no commits for a long stretch reads as a stalled
desk to the fleet's own pulse.

### Scope guard

You own: `highArm`, `ciRedArm` in `slice-pr-next.ts`, and the new fleet-side
fixer tick (wherever you place it under `packages/fleet/src` — there is no
existing file to extend, name it for what it does). You consume, unchanged:
`FixerAttemptsStore`/`fixerAttemptsSpent`/`fixerInFlight` (wave 1),
`roleCommand`/`RoleAgentRef`/`roleRunAlive` (role-agents-start-detached),
`deskDead`, `endingAction`/`FRESH_SESSION_ENDINGS`, `takeContinueLock`. You do
not touch: the `ticket`/`write-status` arms, the merge arm, `.claude/agents/
fixer.md` or `.claude/settings/fixer.json` (both already declared), the
review arm or its index reading. If something here looks wrong or missing —
the continue-lock shape doesn't fit, the worktree-creation site you'd reuse
assumes something that doesn't hold for a fixer, the host re-ask has no clean
adapter call to make — report it rather than improvising a new mechanism to
route around it.
