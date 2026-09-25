## Implementation brief — a-plugin-install-finds-its-own-scripts (the-installer-writes-a-path-that-runs)

- **Plan (canonical):** `docs/plans/2026-09-25-a-plugin-install-finds-its-own-scripts.md` on `main` — **read it in full before starting**
- **Approved:** 2026-09-25, in-session after panel
- **Branch:** `bug/the-installer-writes-a-path-that-runs` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Issue:** #980

### The problem

Several scripts assume Plot is vendored at `<repo>/skills/plot/`. With Plot installed as a Claude Code plugin — the documented install — that directory does not exist. Measured 2026-09-25 on Plot 2.20.0 as a plugin: the installed gates point at a path that is not there, and every refusal text prescribes a command the operator cannot run.

### What to build

`--verify` tests the path the installer WROTE rather than the script beside itself (`gate_path()`, `:191-195`), so an entry pointing at a missing script reports **unverified**; where the written path is absent the installer names both readings rather than choosing one. **No plugin detection** — the signal is absent and a wrong guess leaves a vendored repository ungated. Tests: the vendored arm unchanged, and a settings entry at a missing path reporting unverified, which all five existing `--verify` tests miss because `repoWithGates()` always copies the gates into place

**The plan is the specification.** It was panelled and amended, and its Design section records what an earlier draft got wrong and why — read those corrections before writing code, because each one is a mistake somebody already made on this slice.

### Done when

See the plan's `## Done when`. Every bullet is required; none is optional.

### Repo gates

- `nvm use` first — Node 24. `pnpm` crashes on 26.
- `pnpm test`, `pnpm run test:contracts`.
- `pnpm run build:board` before committing if any board source changed — CI has a no-diff gate on the artifact.
- **Do not run `pnpm run test:e2e`** — that is CI's gate, not a local one.
- A changeset naming `plot`, description first and the `bumps:` block last.
