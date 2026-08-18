# Board adoption spoke

> A `/plot-board-setup` command that takes a project from "has Plot" to "has a working board" — probing prerequisites, recording git-host and CI config, and proving the board serves rather than asserting it.

## Status

- **Phase:** Approved
- **Type:** feature
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-18, jwloka, in-session
- **Started:** 2026-08-18, Jan Wloka, `feature/plot-board-probe`
- **Started:** 2026-08-18, Jan Wloka, `feature/plot-board-verify`

## Changelog

- New `/plot-board-setup` command: sets the board up in a project that already has Plot, records the git-host and CI configuration, then starts the board and proves it serves.
- New `plot-board-probe.sh`: read-only board-readiness probe reporting node version, repo shape, artifact location, config presence, plan count, and `gh`/`bb`/`jen` auth as `ok`/`failed`/`unknown`.
- New `plot-board-verify.sh`: starts the board on an OS-assigned port, fetches `/api/board`, and reaps the server via `trap` on every exit path.
- `/plot-init` now offers board setup when the repo has plans, closing a gap where nothing in adoption mentioned the board.
- `/plot-board-setup --start` starts an already-configured board and prints its URL, without re-running setup.

## Motivation

The board already runs in any repository — it reads the current working
directory, not its own location. Verified 2026-08-18: the plugin-shipped
artifact, run from a throwaway repo with a `## Plot Config` and one plan,
served that plan as a card.

What is missing is everything around it. `/plot-init` never mentions the board,
though `CLAUDE.md` calls it first-class and gates it in the Definition of Done.
`pnpm board` is a script in this repo pointing at a checked-in path, so other
projects have no start route. And failures are silent: a plan in the wrong
format parses as `format: none`, and the board then boots, serves valid JSON,
and shows **zero cards** — indistinguishable at the browser from a broken
board.

Jenkins appears nowhere in Plot. `plot-host.sh` fuses PR state and CI status
into one adapter, which works on GitHub because the PR host *is* the CI host.
Jenkins splits them, so it is new surface rather than a new setting.

## Design

### Approach

Full design and the task-by-task implementation plan:

- **Spec:** `docs/superpowers/specs/2026-08-18-plot-board-setup-design.md`
- **Implementation plan:** `docs/superpowers/plans/2026-08-18-plot-board-setup.md`
  (7 tasks, TDD, complete code in every step)

Both are the specification for the branches below; they are not duplicated
here. Workers read the implementation plan for their tasks.

The split follows Manifesto Principle 3 — scripts collect and report, skills
interpret and adapt. Two new bash scripts carry the facts and the resource
guarantee; the skill carries every judgment.

**Scope:** the board does not render Jenkins status. The `CI` and
`Jenkins instance` keys are declared and verified — the skill reads them back
to check auth against the right instance — and teaching the board to display
Jenkins is separate work. Nothing under `packages/board/` is touched, so no
artifact rebuild is involved.

Three defects were found during plan interrogation by executing the logic
rather than reading it, and all three shape the branches below:

1. `find … | sort | tail -1` selects the lexically-last path, not the newest
   artifact. Demonstrated: with `2.5.0` and `2.10.0` present it picks the
   **stale** 2.5.0, since version strings sort lexically.
2. `stat -f` is BSD-only; on Linux CI `-f` is a different flag rather than an
   error.
3. `/api/board` returns the board's five-stage display pipeline
   (`Discovery/Design/Development/Endgame/Released`), not the four plan phases.
   A gate naming those strings fails on a healthy board.

### Amendment 2026-08-18: `--start`

Added after approval, while wave 1 was in flight and `feature/plot-board-setup-skill`
was still `open` and unclaimed. Recorded here rather than applied silently: a
plan is frozen on approval, so a scope change is a fact the branch's worker and
any later reader are entitled to see.

**The gap.** Setup is a once-per-repo ceremony — probe, write config, verify.
Starting the board is a daily action. Running the full probe-and-verify every
time a person wants to look at their board is exactly the ceremony that
Principle 10 says must scale with the weight of the change.

**Why not a separate `/plot-show-board` skill.** It would need to resolve the
artifact, and that is the one piece of logic with a measured defect in it —
lexical path ordering selecting a stale build. A second implementation is a
second place for that bug to live. One command knows where the artifact is, for
the same reason `plot-host.sh` is the only thing that talks to `gh` and `bb`.

**The shape**, following `/plot-dispatch`'s existing `--dry-run` / `--status`
precedent:

| Invocation | Does |
|---|---|
| `/plot-board-setup` | Full setup: probe, propose, write config, verify, summarise |
| `/plot-board-setup --start` | Resolve the artifact, start the board, print the URL, stop |

`--start` skips the config write and the auth checks entirely. It still refuses
when `artifact_source` is `none`, because there is nothing to start — and it
reports rather than repairs, since a repo that needs setup should be told to run
setup.

### Open Points

- [ ] Should the empty-board diagnosis run unconditionally rather than only
      when the board is entirely empty? Partial breakage (3 of 7 plans
      malformed) currently goes undiagnosed.
- [ ] Should `CI` + `Jenkins instance` generalise to `CI` + `CI instance`
      before a second CI system exists? Verified that `plot-config.sh` parses
      both and tolerates URL values, so this is naming, not a constraint.
- [ ] Should npm `@plot-pm/board` `latest` be promoted past 0.3.0? It lags the
      plugin build, which is why artifact precedence prefers the plugin.

## Branches

<!-- Waves: branches under one ### subheading run concurrently. Wave 2 becomes
     eligible once every branch in wave 1 has merged. -->

### Scripts

- `feature/plot-board-probe` — the read-only probe: JSON shape, artifact resolution (marketplaces-first, then newest mtime), three-state CLI auth. Tasks 1–3 of the implementation plan, with 21 contract tests in `test/reconcile/boardprobe.test.mjs` (estimated 22 here; Tasks 1–3 define 5 + 7 + 9). PR #208.
- `feature/plot-board-verify` — the trap-guarded verification script: start the board on an OS-assigned port, fetch `/api/board`, reap the server on every exit path. Task 4, with 4 contract tests in `test/reconcile/boardverify.test.mjs`. PR #209.

### Skill

- `feature/plot-board-setup-skill` — `SKILL.md` + `README.md` for the new spoke, the `--start` mode, the `plot-config.sh` key documentation, the `/plot-init` extension row, and the four documentation indexes. Tasks 5–6. Depends on both scripts existing, hence the second wave.

## Notes

The two script branches share no files and can run fully in parallel. The skill
branch calls both scripts from its steps and registers them in the docs tables,
so it waits for wave 1 rather than racing it.
