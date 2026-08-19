# Brief: feature/the-repair-can-be-turned-off

Implement the one live branch of
`docs/plans/2026-08-18-the-repair-exists-but-nothing-calls-it.md`.
Read the plan first — **including its Correction**.

## Read the plan's own correction before anything else

The plan was written on the premise that the repair existed and nothing called
it. **That premise was wrong**, and the plan says so at the top: detection and
repair shipped on 2026-08-17, before the plan was written. Its other two
branches are marked `deferred` with the verification inline.

So this is not "wire up the repair". It is the one thing the design called
non-optional and nobody built: **a switch.**

## What exists — verified 2026-08-19

| Piece | Where |
|---|---|
| the pulse calls the repair | `startRepair(b.branch, stuck, opts)`, `fleet.ts:1336` |
| the refusal that licenses it | `isArtifactOnly()`, `stuck.ts:115` |
| what the row says about a repair | `repairFor()`, `resolver.ts:175` |
| env convention on the board | `HOST`, `PORT`, `PLOT_REPO_ROOT`, `PLOT_SCRIPTS_DIR` |

`PLOT_BOARD_REPAIR` does not exist yet.

**The repair is gated on state alone.** An operator who wants to *see* artifact
conflicts without the board acting on them has no way to say so, and the board
writing to a branch nobody asked it to touch is the one automatic write in the
whole system.

## What to build

**`PLOT_BOARD_REPAIR` gates the pulse-side repair, defaulting to on.**

**Default on, because the current behaviour is the tested one.** A switch that
changes what happens by existing is a behaviour change wearing a flag.

**`PLOT_BOARD_REPAIR=0` detects and reports but never writes.** The row still
says an artifact conflict is there — turning the repair off must not turn off
the *seeing*. An operator who silences the write and thereby loses the report
has swapped one blindness for another.

**The variable never converts a refusal into a repair.** `isArtifactOnly()`
refuses any conflict set that is not exactly the artifact, and that refusal is
what licenses the write at all — the repair is a script rather than an agent
precisely because judgement's absence *is* the permission. `PLOT_BOARD_REPAIR=1`
on a conflict touching source must still refuse.

**Unset behaves exactly as today.** Assert it, rather than reasoning it.

## Definition of Done

- `PLOT_BOARD_REPAIR=0` detects and reports but never writes — assert both
  halves: no push, and the row still names the conflict
- Unset behaves exactly as today
- The variable never converts a refusal into a repair — assert a source-file
  conflict refused under `PLOT_BOARD_REPAIR=1`
- The per-branch lock still holds, so two repairs cannot run on one branch
- `pnpm run test:board` green, `pnpm run typecheck` green
- `pnpm build:board` run in THIS worktree and the artifact committed
- A changeset with a `bumps:` block

## Do not

- Do not implement `feature/the-pulse-repairs-the-artifact` or
  `feature/a-repaired-row-says-so`. Both are marked `deferred` in the plan with
  the code that already does them named inline. If you find either missing,
  **report it** — that contradicts a verification recorded in the plan.
- Do not widen what the repair will touch. The refusal is the licence.
- Do not make the switch a config key. It is a runtime property of one board
  process, and `plot-config.sh` describes the repo.

## Platform notes

CI runs Linux; you are probably on macOS. Run the suites **one at a time**.

**Other agents run on this machine.** If `test:board` gives connection-refused
failures, a sibling worktree's board server is the cause. Kill only servers you
started — `pkill -f board-server.mjs` matches every board including the
operator's, and it killed a live board twice today.

**Line numbers here may drift.** Follow the rule, not the number.

If you find something the plan did not anticipate, implement what you can and
report the discovery rather than improvising.
