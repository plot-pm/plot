## Implementation brief — one-rule-reads-the-caller (wave 2: One caller rule)

- **Plan (canonical):** docs/plans/2026-11-03-who-may-approve-a-release-and.md on main
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3078 merged
- **Branch:** `feature/one-rule-reads-the-caller` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review (plan's `Review: pr`)

This branch's prior wave, "Agent tool calls" (`feature/the-gate-refuses-release-approve`),
merged as PR #3083. Two waves wait on this one: "Passkey release approval"
(`feature/a-release-is-approved-with-a-passkey`) and, transitively through it,
nothing else — the reviewer-role wave waits on a different branch
(`feature/one-loader-reads-a-role-file`), not on this one.

### What to build

A pure domain function, `callerOf({ unattended })`, that maps one boolean
reading to the existing `Caller` union (`packages/domain/src/workflows/decision.ts:23`,
`'person' | 'unattended' | 'fleetd'`) — `'unattended'` when true, `'person'`
otherwise — and nothing else. Every one of the eight entrances below stops
computing its own `Caller` inline and calls `callerOf` instead, passing in
whatever it already reads. No answer changes: this is a dedup, not a
behavior change, and the plan is explicit about that ("no answer changes").

The eight entrances, each confirmed against `origin/main` just now and each
computing the caller inline today:

1. `packages/board/src/server/entry/deliver.ts:757`
   `const caller: Caller = process.env.PLOT_UNATTENDED === '1' ? 'unattended' : 'person';`
2. `packages/board/src/server/entry/main.ts:156` (merge and release-approve path)
   `caller: process.env.PLOT_UNATTENDED === '1' ? 'unattended' : 'person',`
3. `packages/board/src/server/entry/main.ts:261` (repair-pr path)
   `caller: process.env.PLOT_UNATTENDED === '1' ? 'unattended' : 'person',`
4. `packages/board/src/server/restart.ts:70`
   `caller: process.env.PLOT_UNATTENDED === '1' ? 'unattended' : 'person',`
5. `packages/fleet/src/server/entry/continue-command.ts:103`
   `caller: deps.caller ?? (process.env.PLOT_UNATTENDED === '1' ? 'unattended' : 'person'),`
6. `packages/fleet/src/server/entry/restart-command.ts:91`
   `caller: deps.caller ?? (process.env.PLOT_UNATTENDED === '1' ? 'unattended' : 'person'),`
7. `packages/fleet/src/server/entry/restart-stopped-command.ts:105`
   `const caller = deps ? deps.caller : (process.env.PLOT_UNATTENDED === '1' ? 'unattended' : 'person');`
8. `packages/board/src/server/entry/release-gate.ts:191` — the one entrance with
   the OTHER spelling, a `--unattended` flag instead of the env var:
   `caller: argv.includes('--unattended') ? 'unattended' : 'person',`

Each entrance keeps reading its own source (`process.env.PLOT_UNATTENDED`,
`argv.includes('--unattended')`, or `deps.caller`) — `callerOf` takes the
already-read boolean and returns the `Caller`. Do not make `callerOf` read
`process.env` or `argv` itself: the plan states "It reads no `process.env`
itself; each entrance passes the values in," matching the repo-wide rule in
`CLAUDE.md` that a pure domain rule takes readings as values, never reaches
the environment on its own.

### What NOT to touch — explicitly unchanged, per the plan

- **`plot-ask.mjs merge`** keeps today's caller rule unchanged in behavior:
  it still reads `callerOf` (now through the shared function) with no
  passkey proof attached. Nothing about `merge`'s decision changes.
- **`packages/board/src/server/continue.ts:184`** keeps its hardcoded
  `caller: 'person'` literal. Do NOT route it through `callerOf` or change
  it to read `PLOT_UNATTENDED` — the plan is explicit: "answering a desk's
  question is not a release, so the passkey proof does not apply," and this
  exact line is already claimed by a separate, unrelated issue (#3067,
  `bug/an-answer-records-its-true-author`). Touching it here creates a
  rebase collision with that branch for no reason this slice needs.
- **The passkey mechanism** (next wave) is out of scope entirely. This slice
  only unifies how the boolean becomes a `Caller` — it adds no new reading,
  no `personProof`, no `release-approve` gate changes.

### Where `callerOf` lives

Put it in `packages/domain/src/workflows/decision.ts` beside the `Caller`
type it returns (`:23`), or a new sibling rules file if `decision.ts` is
meant to stay type-only in this codebase's convention — check how
`packages/domain/src/rules/` vs `workflows/` is split for other pure
mappings before picking. Either way it is domain-package code: arrow
function, not a declaration (`export const callerOf = (...) => ...`), per
`CLAUDE.md`'s arrow-function rule for `packages/domain/**`.

### Done when

The plan's `## Done when` is implicit in its Tests section for this slice:

> `packages/domain/test/caller.test.ts` — `callerOf` for `PLOT_UNATTENDED`
> unset, `0`, `1`, and the `--unattended` flag. `packages/fleet/test/unit/continue-command.test.ts:71`
> and `packages/board/test/unit/release-caller-gate.test.ts:47` stay green
> unchanged.

Write `packages/domain/test/caller.test.ts` covering all four input shapes
named above. The two existing tests named must NOT change their assertions
— they exist today and pass against the current inline expressions; after
this slice they must still pass unchanged, proving the refactor is answer-
preserving. Run them explicitly, not just "the suite," because they're the
regression proof this slice exists to not break.

Plus the repo's gates: no changeset is needed for a pure-refactor domain
change unless `check-changeset-packages.sh` disagrees — check its skill row.
Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push
and run what it prints; the suites in `CLAUDE.md`'s `CI suites` key run in
CI, and a failure there comes back as a correction. Do not run the full
local suite list by hand — let `plot-local-checks.mjs` tell you what's
touched.

`scripts/check-shell-lines.sh` only matters if this slice touches a `.sh`
file under `skills/` — it shouldn't; this is a TypeScript-only domain change
and fleet/board call-site edits.

### Bookkeeping

Open the PR through the controller once the first real commit exists:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Do not run `gh pr create` — `plot-open-pr.sh` reads the plan, names the wave
heading as the title, and refuses a branch no plan names. When the PR is
created, append `→ #<number>` to this branch's line in the plan's
`## Slices` section, under the "One caller rule" heading.

### Scope guard

This branch owns: `packages/domain/src/workflows/decision.ts` (or wherever
`callerOf` lands), `packages/domain/test/caller.test.ts` (new), and the
eight call sites listed above across `packages/board/src/server/entry/`,
`packages/board/src/server/restart.ts`, and
`packages/fleet/src/server/entry/`.

It does NOT own: `continue.ts:184` (reserved for #3067), the passkey/
`personProof`/`release-approve` gate work (next wave,
`feature/a-release-is-approved-with-a-passkey`, which waits on this branch
merging first), or `releaseFinish` scope changes (separate wave, waits on
two different #3071 branches, unrelated to this one).

Other branches from this plan currently in flight: `feature/the-gate-refuses-release-approve`
already merged (#3083). The remaining four waves
(`feature/a-release-is-approved-with-a-passkey`, `feature/release-finish-names-unbooked-plans`,
`feature/one-loader-reads-a-role-file`, `feature/the-reviewer-loads-its-role-file`)
are not yet claimed; none of them touch the eight call sites this slice
changes, except the passkey wave, which waits on this one landing first
specifically so it doesn't collide with this refactor.

If you find a ninth entrance computing the caller inline that this brief
missed, report it rather than silently expanding scope — the plan commits to
exactly eight, each verified by line and content above.
