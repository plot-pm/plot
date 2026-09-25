## Implementation brief — one-word-answers-two-questions-about-a-wave (a-wave-says-which-question-it-answered)

- **Plan (canonical):** `docs/plans/2026-09-25-one-word-answers-two-questions-about-a-wave.md` on `main` — **read it in full before starting**
- **Approved:** 2026-09-25, in-session after panel
- **Branch:** `bug/a-wave-says-which-question-it-answered` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Issue:** #994

### The problem

`plot-fleet-scan.sh` prints a wave as **eligible** and, in the same run, reports `eligible=0` in its footer while `--list-eligible` and `--next` answer nothing at exit 0. Reproduced on this estate 2026-09-25: two waves printed `eligible`, the footer read `eligible=0`, and both offer paths were silent. The word means *this wave's prerequisites are met*; the counter means *a branch here can be claimed now*.

### What to build

rename the footer's branch-counting key to `claimable=`, keeping `eligible=` beside it; the body's wave line agrees with its branch lines using `StartabilityVerdictSchema`'s words as a prose suffix, with claimed and in-progress counting as taken and `unknown` excluded; `--list-eligible` names a claimed-out candidate set on **stderr** so stdout stays a bare branch list; `--next` untouched; tests for a claimed-out wave, an empty estate, and a wave with one free branch

**The plan is the specification.** It was panelled and amended, and its Design section records what an earlier draft got wrong and why — read those corrections before writing code, because each one is a mistake somebody already made on this slice.

### Done when

See the plan's `## Done when`. Every bullet is required; none is optional.

### Repo gates

- `nvm use` first — Node 24. `pnpm` crashes on 26.
- `pnpm test`, `pnpm run test:contracts`.
- `pnpm run build:board` before committing if any board source changed — CI has a no-diff gate on the artifact.
- **Do not run `pnpm run test:e2e`** — that is CI's gate, not a local one.
- A changeset naming `plot`, description first and the `bumps:` block last.
