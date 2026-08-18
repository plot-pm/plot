# Brief: feature/plot-board-probe

Implement **Tasks 1–3** of
`docs/superpowers/plans/2026-08-18-plot-board-setup.md`.

Read that plan first. It contains the complete code for every step, the exact
tests, and the commands with their expected output. Its decisions were settled
during design and interrogation: **do not re-derive them, do not widen the
scope.**

## What you are building

`skills/plot/scripts/plot-board-probe.sh` — a strictly read-only bash probe
that emits one JSON object describing whether the Plot board can run in the
current repository, plus its contract tests in
`test/reconcile/boardprobe.test.mjs`.

The probe **decides nothing**. Every field is a fact; which artifact to
recommend and what an empty board means are the skill's judgment, not the
script's (Manifesto Principle 3).

## Your three tasks

| Task | Adds |
|---|---|
| 1 | Probe skeleton: JSON shape, node version check, repo shape, config presence, plan count, CI signals. Read-only guarantee. |
| 2 | Artifact resolution: `plugin` → `npm` → `checkout` precedence. |
| 3 | Three-state CLI auth for `gh`, `bb`, `jen`. |

Follow the TDD steps in order: write the failing test, run it and see it fail,
implement, run it and see it pass, commit. Each task is one commit.

## The three things most likely to go wrong

These were found by *executing* the logic during plan interrogation, not by
reading it. Each looked correct on the page.

1. **Do not select the artifact with `find … | sort | tail -1`.** It picks the
   lexically-last *path*, not the newest build. A real machine carried three
   artifacts including one two weeks stale; with `2.5.0` and `2.10.0` present
   it selects the **stale 2.5.0**, because version strings sort lexically. Use
   the marketplaces-first, newest-mtime-fallback code given in Task 2.

2. **Do not use `stat -f` unguarded.** It is BSD/macOS only. Plot's CI runs on
   Linux, where `-f` is a *different flag* rather than an error, so the BSD
   form must be tried first and its failure used as the signal. The plan's
   `mtime()` helper does this.

3. **`auth` is a three-state enum (`ok`/`failed`/`unknown`), never a boolean.**
   An unrecognised output must read as *cannot verify*, never as
   *authenticated*. Measured 2026-08-18: `jen -I <slug> auth status` exits 0
   and prints `Keycloak: signed in` for a slug that does not exist, because the
   slug expands into a URL pattern without ever being reached. Only the
   `Jenkins auth:` line answers — and `NOT reachable` must be tested **before**
   `reachable`, since it contains it.

## Definition of Done

- `node --test test/reconcile/boardprobe.test.mjs` passes (22 tests)
- `pnpm run test:reconcile` passes — no regressions
- `pnpm test` passes
- `bash skills/plot/scripts/plot-board-probe.sh | python3 -m json.tool` emits
  valid JSON in this repo
- `git status --porcelain` is unchanged by running the probe (it is read-only)
- A changeset with a `bumps:` block naming `plot: patch`

## Out of scope

Do not create `plot-board-verify.sh` (that is `feature/plot-board-verify`, in
flight beside you) and do not create the `plot-board-setup` skill or touch any
documentation index (that is `feature/plot-board-setup-skill`, wave 2). Do not
touch anything under `packages/board/`.

If you find something the plan did not anticipate, implement what you can and
**report the discovery** rather than improvising.
