## Implementation brief — a-record-is-written-where-it-can-be-read (an-insertion-point-is-not-inside-a-comment)

- **Plan (canonical):** `docs/plans/2026-09-25-a-record-is-written-where-it-can-be-read.md` on `main` — **read it in full before starting**
- **Approved:** 2026-09-25, in-session after panel
- **Branch:** `bug/an-insertion-point-is-not-inside-a-comment` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Issue:** #981

### The problem

`plot-approve` writes the `Approved:` record inside the template's HTML comment, where `plot-plan-meta.sh` cannot see it. Reproduced 2026-09-25 against the shipped template: the record lands between `<!-- Transition records` and `-->`, and the parser answers `approved_raw: ""`. The plan is approved, says so nowhere a reader can find, and renders without its record on GitHub.

### What to build

copy `plot-deliver.sh:330`'s `if (lines[i] ~ /<!--/) break` into `append_approved_line` (`plot-approve.sh`) and `append_started_line` (`plot-dispatch.sh:3026-3078`), which is where all 38 measured losses came from; a test per writer modelled on `deliver-record-outside-comments.test.mjs`; the shipped template exercised end to end — approve, parse, assert the record reads back

**The plan is the specification.** It was panelled and amended, and its Design section records what an earlier draft got wrong and why — read those corrections before writing code, because each one is a mistake somebody already made on this slice.

### Done when

See the plan's `## Done when`. Every bullet is required; none is optional.

### Repo gates

- `nvm use` first — Node 24. `pnpm` crashes on 26.
- `pnpm test`, `pnpm run test:contracts`.
- `pnpm run build:board` before committing if any board source changed — CI has a no-diff gate on the artifact.
- **Do not run `pnpm run test:e2e`** — that is CI's gate, not a local one.
- A changeset naming `plot`, description first and the `bumps:` block last.
