---
'@plot-pm/domain': patch
---

The ten entities the pulse does not carry become domain types.

PR, Build, Release, Worktree, Agent, Machine, Issue, Story, Sprint and Person —
each with the identity kind and state source its spec records — plus
`PortResult<T>` and the fleet's cross-plan cohort.

**`PortResult<T>` has three outcomes, never two.** `{ ok: true, value }`,
`{ ok: false, why: 'failed' }` and `{ ok: false, why: 'unaskable' }`: a host
that is down is not a host that cannot be asked, and the estate has paid for
the two-outcome version repeatedly — a `--no-fetch` scan reading 43 merged
branches as open, `state: CLOSED` on a merged PR. As a union rather than a
discipline, a reader that forgets the third outcome fails to compile.

**The two vocabularies are named once.** Three identity kinds, each with its own
failure — a slug collides, a natural key inherits the source's lie, a minted
identity fails by nobody minting it (0 manifests against 13 worktrees). Four
state sources, each going wrong differently: STATED is wrong, DERIVED is stale,
FOREIGN disagrees, MEASURED decays instantly.

**Constructors refuse rather than guess.** `resolvePerson` takes its directory
as an argument and leaves an undeclared spelling unresolved; `measureMachine`
derives headroom from the spawn cost, so a reading claiming `clear` at 286 ms
cannot be built; `scoreItem` lets the plan estate outrank a sprint checkbox in
one direction only; `buildConclusion` answers null while a run is in progress,
because a build that has not finished has no conclusion.

**The fleet's cohort has no constructor**, because nothing forms one: it is
assembled at dispatch and persisted nowhere. A type with no way to build one is
the honest shape for an entity with no source of truth.

Coverage is 100% of statements, branches, functions and lines across
`src/entities/`, enforced by the threshold already in the vitest config — 61
branches, where the first slice covered 8 statements and 0.
