## Implementation brief — a-published-board-brings-its-scripts (wave 1: Shipping)

- **Plan (canonical):** `docs/plans/2026-08-28-a-published-board-brings-its-scripts.md` on main
- **Approved:** 2026-08-28, Jan Wloka, in-session
- **Branch:** `bug/the-package-carries-its-scripts` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** per repo convention

**Wave 1 of 3.** `Streaming` (the empty-estate pulse) and `Gated` (the packaging
gate) both wait on this. **This wave alone does NOT make the published board
work** — see *Done when*.

### What to build

The npm package ships 4 files, two of which are helper scripts. The server
spawns **11**. A board installed from npm answers `bash exited 127` and never
becomes ready.

Add the nine missing scripts to `packages/board/package.json`'s `files` array,
and vendor them beside the artifact in `build.mjs` — the same mechanism
`plot-config.sh` and `plot-plan-meta.sh` already use. `scriptsDir` resolves to
`path.resolve(here, '..')`, so they must land at the package root.

**The nine:** `plot-fleet-scan.sh`, `plot-host.sh`, `plot-worker-state.sh`,
`plot-dispatch.sh`, `plot-approve.sh`, `plot-deliver.sh`, `plot-reap.sh`,
`plot-release-refs.sh`, `plot-resolve-artifact.sh`.

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**Do not rewrite the scripts in TypeScript.** The board spawns them because they
are the contract — `plot-plan-meta.sh` IS the plan format. A port would be the
duplication the design forbids.

**Do not compute the list at runtime.** `files` is an npm manifest field, read
by `npm pack` before any code runs. It has to be literal.

**Do not add a `postinstall` that copies from `skills/`.** The published package
does not contain `skills/` — that is the whole defect.

**The scripts source each other**, and only each other:
`plot-fleet-scan.sh` and `plot-host.sh` reach for `plot-config.sh`,
`plot-plan-meta.sh`, `plot-host.sh`, `plot-worker-state.sh` — all inside the
same set of 11. **Verified: nothing reaches outside it**, so shipping the 11 is
closed under its own dependencies.

**Shipping them is NOT sufficient, and that is deliberate.** Measured
2026-08-28 with all 11 staged: the error becomes *"fleet scan ended without a
terminal pulse line"* and the board is still dead, because a repo with **no
plans** exits the scan before its terminal line. **That is wave 2's job, not
yours.** Do not fix it here — the waves are separate so each is revertible.

### Done when

The plan's `## Done when` for this wave is the specification:

- `npm pack` produces a tarball containing **all 11** scripts
- a board started from that tarball, **in a repo that has at least one plan**,
  reaches `ready: true`

**The "at least one plan" clause is load-bearing.** An empty repo still fails
after this wave, by design. A Done-when that asserted the empty case would fail
here and mislead whoever ran it.

**How to check, end to end:**

```bash
cd packages/board && npm pack
tar tzf plot-pm-board-*.tgz | grep -c '\.sh$'     # expect 11
```

Then unpack to a temp dir, `git init` a scratch repo, add one plan with a
`## Waves` section, and run the board from the unpacked artifact with
`PLOT_SCRIPTS_DIR` unset — it must resolve them itself.

Plus: `pnpm run typecheck`, `pnpm run test:board`, and a changeset
(`'@plot-pm/board': patch`).

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's
`## Waves` section. Push the first real commit as soon as it exists.

### Scope guard

**This branch owns:** `packages/board/package.json` (`files`),
`packages/board/build.mjs`.

**It does not own:** `plot-fleet-scan.sh` (wave 2), `scripts/release-smoke.sh`
(wave 3), or any board source.

**Other branches in flight:** none on this plan. Two sibling plans in the same
sprint (`a-board-that-never-scanned-says-so`, `a-board-names-the-repo-it-serves`)
are approved and unclaimed; both are client-side and touch nothing here.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
