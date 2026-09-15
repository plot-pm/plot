# The deploy job shows on main

> A team whose CI is a multibranch job and whose CD is a separate job sees only half its pipeline, because Plot models one job per repository.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** the-board-is-blank-where-it-matters
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A repository can declare a deploy job beside its CI job, and the board shows that job's state on the default branch. Plot modelled one job per repository, so a separate CD pipeline was invisible.

<!-- Board impact: a new optional config key and one extra reading on the
     default branch's row. No plan format, no template. -->

## Design

**Plot models exactly one Jenkins job, and it is the multibranch one.**
`plot-host.sh:539` is explicit: *"build status (`checks`) is resolved through
`jen` — a multibranch job's branches in one call, joined locally to the PR list
the host provides."* Measured 2026-09-15, nothing in that file carries a notion
of a second job.

That is right for CI and blind to CD. A team running a multibranch job for
branches **and** a separate integration job for `main`/`develop` sees the first
and never the second — the deploy that decides whether the merge actually
shipped.

### The entity already distinguishes them

`BuildRun` (`entities/build.ts`) carries a **`pipeline`** field beside `head`,
`state`, `startedAt`, `durationMs` and `url`. So a run already says which
pipeline produced it, and two runs on one branch are expressible today without a
schema change.

**What is missing is a second thing to ask**, not somewhere to put the answer.

### One extra call per refresh, on one branch

**The deploy job is asked only for the default branch.** A CD pipeline builds
what was integrated; asking it per branch would multiply the cost of the
scarcest connector on the estate — Jenkins declares `limit: 60` at
`plot-host.sh:3760`, the tightest of the three — for rows that can never have a
deploy run.

So the cost is **+1 call per refresh**, fixed, regardless of how many branches
the board shows. That property is what makes this affordable, and it is the one
to pin.

### Declared, never inferred

**A naming convention was rejected.** Matching `*-deploy` or similar against
`jen job list` needs no config and fails **silently** on any team whose naming
differs — showing nothing, exactly as today, with no signal that a convention
was missed. A declared key is absent or wrong loudly.

**The key names the job, not the branch.** Which branch a deploy job builds is
the job's own business; Plot asks for the default branch's state and renders
what comes back.

### What this does not do

**It does not change the CI half.** The multibranch resolution, its colour table
(`blue`→passing, `yellow`→**failing** deliberately, `*_anime`→pending) and the
URL-encoded branch names stay exactly as they are.

**It does not generalise to N jobs.** Two is the shape a team has: one job that
builds branches, one that deploys the integrated result. A list of jobs would be
inventing a structure nobody has asked for, and the cost argument above holds
only because the count is fixed.

**It does not gate anything.** A red deploy is shown, not enforced. Whether a
failed CD blocks a delivery is a separate decision with its own refusals.

## Slices

### The deploy job shows on main (Branch: feature/the-deploy-job-shows-on-main)

- `feature/the-deploy-job-shows-on-main` — read an optional deploy-job key from `## Plot Config`, ask it once per refresh for the default branch, and render its state on that branch's row beside the CI state

**Done when** a repository declaring no deploy job behaves **byte-identically**
to today, pinned by a test; a declared job is asked exactly once per refresh
regardless of branch count, pinned by counting the calls; the state lands on the
default branch's row and on no other; a declared job that does not exist reports
that it was not found rather than rendering nothing; the CI half's colour
mapping is unchanged; and `pnpm run test:contracts` and the board suite pass.

**Verified separately on an instance declaring `CI: jenkins`** with both jobs: the
default branch shows CI and CD state together. That cannot be checked in this
repository, which declares `CI: github-actions`, and is not in the slice's gates.

## Notes

**Depends on
[`the-board-asks-the-build-resolver`](2026-09-15-the-board-asks-the-build-resolver.md).**
Until `buildPortFor` reaches `buildFor`, no Jenkins reading arrives at the board
at all, and a second job would be invisible for the same reason the first one is.

**Raised by the operator 2026-09-15**, naming the split directly: *"we do have
different pipelines for CI multi-branch builds and CD the main / develop branch
integration build."*
