# Implementation brief — the-sprint-proves-its-own-goal (Counting)

- **Plan (canonical):** `docs/plans/2026-08-30-the-sprint-proves-its-own-goal.md` on main
- **Branch:** `infra/the-gate-counts-what-production-keeps` (base: `main`)
- **Ends as:** one PR to main
- **Independent of the other two slices.**

### What to build

A CI gate counting **domain names production still aliases** — a rule that
moved, whose old name was kept alive — ratcheting toward zero.

### The residue is a NAME, not a copy

Measured 2026-08-30 on the sprint goal's own example:

```
packages/domain/src/rules/deliverable.ts:62   export const allSlicesMerged = (
packages/board/src/server/board.ts:671        export { allSlicesMerged as allWavesMerged, … }
packages/board/src/server/deliver.ts:231      allWavesMerged(meta, …)
packages/board/src/server/auto-deliver.ts:235 allWavesMerged(joinKey(plan.file), …)
packages/board/src/server/auto-deliver.ts:269 allWavesMerged(joinKey(plan.file), …)
```

**There is no second implementation.** The rule moved; a `TEMPORARY ALIAS`
survived it. A grep for duplicated *code* finds nothing here — which is exactly
why the gate counts names.

### Count the alias, not its consequences

**The three `allWavesMerged` call sites are consequences of one
`export { … as … }`.** A gate counting call sites goes red on a refactor that
touches them without changing the seam, and green if someone adds a fourth call
to an alias that should not exist.

**So the subject is the re-export.** One alias, one count — however many callers
it has.

### Follow the vocabulary gate

`.github/workflows/ci.yml:194` is the working model: `allowed=N` with a dated
comment naming the previous value, a failure that lists what it found, and a
documented exception where one is genuinely needed.

### Done when

- the gate fails when a new alias of a domain name is added
- it passes on today's estate, with the count in its output
- `allowed` carries the date and the number it replaces
- the failure **names the aliases**, so a reader sees which seam is still open

**What counts as an alias is yours to define, and the PR must say it.**
`export { x as y }` is the clear case. An import that renames
(`import { x as y }`) and a wrapper that forwards are candidates — decide, and
write the reason, because the next person will meet a shape you did not list.

**A vacuous pass to avoid:** a pattern so narrow it matches only
`allWavesMerged`. Test it against a second alias you invent temporarily, then
remove it.

Plus: `pnpm test`, and the gate must pass on `main` unchanged.

### Scope guard

The gate. **Not removing the alias** — `board.ts:671` is `production-calls`'
Delivering slice to remove, and this gate is what will show it happen.
