## Implementation brief — fleet-supervisor-holds-scale-slots-too (wave 1: Liveness)

- **Plan (canonical):** `docs/plans/2026-10-24-fleet-supervisor-holds-scale-slots-too.md` on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2536 merged
- **Branch:** `bug/fleet-supervisor-liveness-bounds` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** plot-review on the PR, per the repo convention

The Label and Log-and-wording waves are independent branches; none waits on this one. This branch edits the shared comment in `.changeset/first-tick-after-start-counts-agents.md`, so leave the plist, `plot-config.sh` and `plot-fleet/SKILL.md` wording to `bug/fleet-review-followups-wording`.

### What to build

Two bounds on what `scaleUp` counts as a running agent, both in the fleet package's queue reading:

- A launch with a manifest but no recorded pid holds a scale-up slot for `Worker bound` (28800 s, 8 h). `registryd-main.ts:828` wires `launchedBoundMs` to `boundSecondsOf(...) * 1000`, and `launchedUnregisteredCount` (`packages/fleet/src/shared/queue-reading.ts`, near line 650) counts the entry while `now - startedAt < boundMs`. A scale-up whose agent never starts therefore blocks the next scale-up for a working day. Replace that bound with a short grace.
- A manifest that does record a pid counts as running whenever `alive(pid)` answers true, with no limit on age. A reused pid inflates the running count and holds slots. Give the stamped-pid count a time bound.
- `readQueue` takes liveness (`alive`) as a reading, so tests pin it. Today `launchedUnregisteredCount` defaults `alive` to the real `pidAlive`, and tests read the real process table.

Reword `.changeset/first-tick-after-start-counts-agents.md`, which says "bounded by `Worker bound` or the recorded pid's own liveness". The plan is canonical; this brief is orientation.

### Decisions the plan settles — do not re-derive them

- **Readings as values, not ports.** `CLAUDE.md` (*The Domain Package*): rules stay synchronous and take readings as values. `alive` and `now` enter as parameters. A rule that spawns or awaits is the rejected alternative.
- **A bound is a reading, not a verdict.** Nothing here persists a verdict (*Answers, never verdicts*). The bound is computed from `startedAt` and `now` on each tick.
- **Absent is not false.** An unparseable `startedAt` today counts as not launching (`Number.isFinite` guard). Keep the missing-reading arms explicit and tested rather than collapsing them.
- **Arrow functions.** Any function you write or rewrite is an arrow. Do not convert neighbours.
- **No new `Wave` vocabulary.** Say `Slice` where you mean a slice. A worker is a process, an Agent is the actor.

### Open questions the plan leaves to this branch — measure first

The plan lists three and answers none. Answer them in the PR with a measurement, not a preference (`measure-before-implementing-a-plot-optimisation`):

1. **Grace period.** Measure start-to-stamped-pid for healthy launches (the wrapper writes the pid; read `.plot/logs/` and manifests' `startedAt` against the stamp) before choosing a number. Too short and `--start 3` followed by a tick again brings the fleet to five (#2409). Too long and the 8 h problem returns in smaller form.
2. **Stamped-pid bound.** Decide whether it reuses `Worker bound` or gets a separate key. A new key means `plot-config.sh` and the README table in `skills/plot/scripts/` change, and the Label/wording wave documents `plot-config.sh`'s header, so name any new key in the PR for that branch.
3. **Where the rule lives.** One rule in `packages/domain` for both bounds, or the fleet package owns both. The layering rule says a decision belongs in the domain; the existing `launchedUnregisteredCount` lives in the fleet package. If you move it, `corpus/` or domain tests must cover it.

### Done when

The plan has no `## Done when` list; its `## Changelog` is the specification:

- The supervisor frees the scale-up slot of a launch that never gets a pid after a short grace, not after `Worker bound`.
- A stamped pid in an old manifest counts as running only within a time bound.

Assertions a naive implementation passes without:

- A launch **inside** the grace still counts (catches a bound of zero, which regresses #2409).
- A launch **past** the grace with no pid stops counting (catches leaving `Worker bound` in place).
- A stamped pid that `alive` reports true, with `startedAt` past the bound, does not count (catches a bound applied only to the pid-less arm).
- A stamped pid that `alive` reports false does not count at any age.
- The same entry is not counted twice when `stateOf` already counts it (the `states[at] !== 'none'` guard).
- Tests pass `alive` and `now`; none reads the real process table.

Plus: a changeset with the description first and the `bumps:` block last (`./scripts/check-changeset-packages.sh`). Before each push run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` config key run in CI. A `.sh` change must pay for its lines (`scripts/check-shell-lines.sh`); this slice should touch none.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

Owned: `packages/fleet/src/server/entry/registryd-main.ts` (the `launchedBoundMs` wiring), `packages/fleet/src/shared/queue-reading.ts` and its tests, `.changeset/first-tick-after-start-counts-agents.md`, and any new changeset. Not owned: `plot-fleetctl.sh` and `test/reconcile/fleetctl.test.mjs` (Label branch); `default-branch-refresh.ts`, the plist, `plot-config.sh` header, `plot-fleet/SKILL.md`, `packages/domain/test/queue.test.ts` and the comment at `registryd-main.ts:2641` (wording branch). If the stamped-pid bound needs a config key, report it rather than editing those files.
