## Implementation brief — a-rule-reaches-the-install-that-runs-it (wave: A rule reaches the install that runs it)

- **Plan (canonical):** `docs/plans/2026-09-17-a-rule-reaches-the-install-that-runs-it.md` on `main`
- **Approved:** 2026-09-17, jwloka, in-session
- **Branch:** `bug/a-rule-reaches-the-install-that-runs-it` (base: `main`)
- **Ends as:** one PR to `main`

Single-slice plan. Nothing waits on this branch and it waits on nothing.

### What to build

`plot-dispatch.sh --start` cannot ask its rule from a plugin install. Build the
answer into a tracked bundle under `skills/plot/scripts/board/`, beside the 24
that already ship, and have `--start` ask that bundle.

### The cause is the SECOND import — this took two wrong diagnoses to find

`plot-dispatch.sh:1931` imports **two** modules:

```sh
PLOT_RULE="file://$start_domain/rules/fleet-size.ts"
PLOT_MACHINE="file://$start_domain/entities/machine.ts"
```

`fleet-size.ts` imports one `import type`, erased by type stripping — **it has no
runtime dependency and imports fine.** `machine.ts` opens with
`import { z } from 'zod'`. Reproduced with no `node_modules` on the path:

```
machine.ts FAILED: Cannot find package 'zod'
fleet-size.ts: imported
```

**So the bundle carries `headroomFor` as well as `fleetSize`, with `zod` bundled
in.** A bundle of the rule alone fixes nothing. Node 24 strips types; the
TypeScript was never the problem.

### Two failures wear one message

The reporter's install (2.17.0) carries `packages/domain/src/`; this machine's
cache (2.8.0) carries none of it. **A refusal must say which** — today it names
node and readability, and both held for the reporter.

### Do not

**Do not ship `packages/*/dist`.** Measured: tracked zero times, and
`packages/board/.gitignore:2` ignores its own. The bundle route exists and works
for 24 callers.

**Do not sweep the other two source-importing scripts.** `plot-reap.sh` and
`plot-release-refs.sh` import rules that reach no `zod`, which is why they work.
Widening a narrow fix on a guess about the future is not this slice.

### The gate

`--start` must answer from a tree carrying **no** `packages/domain/` at all —
run it against a copy with that directory removed. The bundle is tracked
(`git ls-files`) and under 50 KB.

### Repo gates

`pnpm run test:contracts`, `pnpm run test:board`.
