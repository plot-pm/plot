## Implementation brief — a-throttled-host-is-not-a-missing-pr (the-approval-reads-why-the-host-said-nothing)

- **Plan (canonical):** `docs/plans/2026-09-25-a-throttled-host-is-not-a-missing-pr.md` on `main` — **read it in full before starting**
- **Approved:** 2026-09-25, in-session after panel
- **Branch:** `bug/the-approval-reads-why-the-host-said-nothing` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Issue:** #985

### The problem

`plot-approve` reports *"no PR found"* about a pull request that is open, and prescribes pushing a branch the operator already pushed. Measured 2026-09-25 on Bitbucket, `bb` 1.9.0: PR 3636 was OPEN and readable by number, while `bb pr list` answered HTTP 429. The listing was refused; the PR was never absent.

### What to build

`plot-approve.sh:230` captures the exit code and stderr rather than discarding both; exits 5 and 4 stop with the host's own reason and no push prescription; a genuine absence is unchanged; a stub-driven test for each of the four arms, and one asserting the phase is untouched on every stop

**The plan is the specification.** It was panelled and amended, and its Design section records what an earlier draft got wrong and why — read those corrections before writing code, because each one is a mistake somebody already made on this slice.

### Done when

See the plan's `## Done when`. Every bullet is required; none is optional.

### Repo gates

- `nvm use` first — Node 24. `pnpm` crashes on 26.
- `pnpm test`, `pnpm run test:contracts`.
- `pnpm run build:board` before committing if any board source changed — CI has a no-diff gate on the artifact.
- **Do not run `pnpm run test:e2e`** — that is CI's gate, not a local one.
- A changeset naming `plot`, description first and the `bumps:` block last.
