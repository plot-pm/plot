## Implementation brief — a-lifecycle-field-has-one-writer (slice: A master agent cannot write a lifecycle field by hand)

- **Plan (canonical):** `docs/plans/2026-09-08-the-master-agent-uses-the-controllers.md` on `main`
- **Branch:** carries this slice; base `main`
- **Ends as:** one PR to `main`
- **Review of the code:** PR
- **Waits on:** `feature/a-sprint-transition-is-performed` — do not start before it lands. A gate refusing the only available method stops work rather than routing it.

**AND READ WHAT YOU WAIT ON.** Its PR is the input to yours.
- **Sprint:** `the-jenkins-team-sees-its-builds`

**READ THE PLAN AND ITS ROUNDS FIRST.** All four plans were interrogated across five to seven rounds, and most changed shape: a field form was reversed, a dependency inverted, a measurement found impossible. The Notes record what was cut and why. A slice re-adding it wastes the round.

## What this delivers

The plan's slice section states the constraints and the done-when. **This brief adds only what a plan cannot: the repo's gates and the traps measured this week.**

## Repo gates

```bash
nvm use              # Node 24 — pnpm crashes on 26
pnpm install
pnpm test
pnpm run test:reconcile
pnpm run typecheck
pnpm run test:board
```

**Do NOT run `pnpm run test:e2e`.** CI's gate, not a local one — two agents running it once produced 53 concurrent `node --test` processes at load 8.69.

## Traps measured this week

- **The scan reads plans from `origin/main`, never the working tree.** An annotation is invisible to the fleet until pushed.
- **A merged PR that carries no work still reads as delivered.** Two slices shipped that way last sprint. If your branch ends up carrying only a marker, say so in the PR rather than letting it merge quietly.
- **`test:board` dirties a fixture** — `tiny-garden/.plot/state/last-pulse.json`. Revert before staging.
- **On a board bundle conflict, do not read the diff.** Marked `-merge`; take either side, `pnpm build:board`, commit the rebuild.
- **The domain demands 100% branch coverage.** Narrow the type rather than testing dead code.
- **Arrow functions** in `packages/domain` and in anything newly written.
- **A test failing differently each run is machine load.** Check `uptime` first.
- **This is the slice that answers the incident.** Every other refusal fires when something is invoked; a `sed` over a markdown line invokes nothing, so no routing reaches it.
- **`plot-phase-gate.sh` is the precedent** — it blocks a commit and names the approval that would let it through. Block the edit and name the command that owns that write.

## Done when

The plan's done-when holds, verbatim. If a clause cannot be met, say which and why in the PR rather than restating it as met.
