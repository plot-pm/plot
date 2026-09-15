# The deploy job shows on main

> A team whose CI is a multibranch job and whose CD is a separate job sees only half its pipeline, because Plot models one job per repository.

## Status

- **State:** Rejected
- **Type:** feature
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** the-board-is-blank-where-it-matters
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1
- **Rejected:** 2026-09-15, jwloka, premise disproved by measurement on a live Jenkins instance

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

## Why this was rejected

**A three-lens panel divided (amend/amend/reject), and then a live Jenkins
instance settled it.** Measured 2026-09-15 on `Quatico.Webseite/quaweb-website`
— the repository whose board prompted this plan — after the operator named it.
Every finding below is a reading, not an inference.

### The mechanism this plan names is not the defect

The plan says the gap is *"a second thing to ask, not somewhere to put the
answer."* Measured, it is **a second WAY to ask**:

```
jen job list quaweb/continuous-deploy --json   ->  null
jen job view quaweb/continuous-deploy --json   ->  color blue,
                                                   lastBuild #938 SUCCESS,
                                                   duration 453365ms
```

`job list` enumerates a folder's CHILDREN. A `WorkflowMultiBranchProject` has
one child per branch, so listing it yields the CI answer Plot renders today. A
plain `WorkflowJob` has none, so the same call yields `null`.

**`plot-host.sh` calls only `job list` (`:756`) and never `job view`** — zero
occurrences. So the CD side is unreachable through the verb Plot uses, whatever
job is declared. **A deploy-job key implemented exactly as this plan specifies
would pass every gate and still read `null`.**

### "Two is the shape a team has" is false

Under `quaweb`, measured:

```
continuous-build         WorkflowMultiBranchProject   <- the only one Plot reads
continuous-deploy        WorkflowJob
continuous-deploy-stable WorkflowJob
release                  WorkflowJob
set-image-name           WorkflowJob
```

**Five jobs, four of them CD-side.** This plan refuses to generalise on the
grounds that *"a list of jobs would be inventing a structure nobody has asked
for, and the cost argument above holds only because the count is fixed."* The
first real instance measured has four, so the fixed count — and the
`+1 call per refresh` argument resting on it — does not survive its own
motivating example.

### The entity claim was false, and it was read from the neighbour

`BuildRun` (`entities/build.ts:113-124`) carries exactly four fields:
`workflow`, `conclusion`, `startedAt`, `url`. The six this plan lists — with
`pipeline` among them — belong to `Build` at `:51-64`, a different interface in
the same file. **`Build` is returned by no port operation.** So *"the entity
already distinguishes them"* asserts a capability of a type nothing returns.

That is the sibling's error class exactly: reading a neighbouring definition and
attributing it to the one in use.

### There is no destination

`board.ts:705-707` filters the default branch out of the branch list before any
plan card is built, and `fleet.ts:1243` does it again — its comment calling such
a row *"a row named `HEAD` that no reader can act on."* `checks` is a field on
`PrRecord`, consumed per-PR; the default branch has no PR.

And `build` is a `RowKind` with **no producer**: `rowKind` returns only
`release`, `plan`, `branch`, `wave`, and `schema.ts:1275-1280` records that
`build` *"never rendered outside `mock-fleet.ts`"*. The enum keeps it so the two
`Record<RowKind, …>` tables stay a compile error — so an implementer would find
the types accept a build row and nothing appear.

### The declared dependency restated a disproved sentence

The Notes claimed *"Until `buildPortFor` reaches `buildFor`, no Jenkins reading
arrives at the board at all."* That is
[`the-board-asks-the-build-resolver`](2026-09-15-the-board-asks-the-build-resolver.md)'s
premise, rejected the same day. `buildPortFor` already reaches `buildFor` one hop
through `buildShell`. **Two plans in two days carried that sentence.**

### The gates were satisfiable by rendering nothing

*"Lands on the default branch's row AND ON NO OTHER"* is phrased as an
exclusion, so **zero rows satisfies it vacuously.** Add the key, add the call,
store the answer, render it nowhere — every gate green, both suites pass, the
operator sees exactly what they see today.

### What was right, and where it goes

**The need is confirmed.** A real team runs a separate CD pipeline and cannot
see it, and `premise`'s sequencing objection — that the config might be empty —
is disproved: `CI: jenkins` resolves, `jen auth status` reports signed in, and
the CI half works.

**The declared-key design was right**, since a naming convention would have to
guess among four CD-side jobs.

**The team had already written the diagnosis into their own repo.** That
repository's `AGENTS.md` states *"«deploy» kommt in `plot-host.sh` kein einziges
Mal vor: Plot hat fuer die CD-Seite kein Konzept"* — verified, `grep -ic deploy`
returns 0 — and records the cost of misconfiguring the key at PR #874, where
every PR read `checks: unknown`.

Superseded by
[`a-jenkins-job-is-read-by-its-shape`](2026-09-15-a-jenkins-job-is-read-by-its-shape.md),
which fixes the reader rather than the declaration.

**Nothing was implemented.** No branch, no PR, no `Started:` record.

The full panel record is at
`.plot/panels/2026-09-15-the-deploy-job-shows-on-main/`.
