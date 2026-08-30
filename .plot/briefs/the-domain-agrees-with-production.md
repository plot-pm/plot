## Implementation brief — the-domain-runs-the-workflows-in-a-sandbox (slice 2: Agreeing)

- **Plan (canonical):** `docs/plans/2026-08-28-the-domain-runs-the-workflows-in-a-sandbox.md` on `main`
- **Branch:** `feature/the-domain-agrees-with-production` (base: `main`)
- **Ends as:** one PR to `main`

Needs `feature/the-ports-have-adapters` merged. Runs in parallel with Deciding
and Dispatching — different files, and neither reads this slice's output.

### What to build

The corpus test tier: prove the adapters feed the domain the same readings
production reads, against this repository's real estate.

- `PlanStore` adapter vs `plot-plan-meta.sh` over every plan, field by field
- `Refs` adapter vs `plot-fleet-scan.sh`'s pulse, asserting identical `Pulse`

### The decisions the plan settles — do not re-derive them

**This compares READINGS, not verdicts, and that changed when plan 1 became a
move.** There is no second implementation of the rules to compare against — the
board imports the domain's. A rule with one implementation cannot disagree with
itself. An adapter that drops a field, or reads `state` where production reads
`mergedAt`, absolutely can — and would otherwise surface as a domain that is
correct about the wrong facts.

**It runs as its OWN CI job, parallel to the board suite, per PR.** One
`plot-plan-meta.sh` process per plan against the adapter is ~340 spawns at 170
plans, and the board integration suite already ran 12.5 minutes on 2026-08-29
and has timed out at 15. Sharing that job would make a suite at its budget fail
for reasons unrelated to the code under test. Per PR rather than nightly,
because "a disagreement fails CI" is only a gate if the failure lands on the
change that caused it.

**On a disagreement: write `PLOT-BLOCKED` and STOP.** Name the field, the plan,
and both readings. Which side is wrong is judgement — the adapter may be wrong,
or you may have found a production bug that gets its own plan. **Never adjust
the adapter to match production.** The failure that matters is the permissive
one: an agent facing red CI with no instruction adjusts the adapter and cements
a real production bug behind a passing test.

**Adapter coverage is deliberately not 100%.** An adapter's uncovered branches
are the ones needing a host to fail, a disk to be full, or a process to die at
the wrong moment — a threshold forcing those to be faked teaches people to fake
them. The gate that applies here is the purity-except-adapters grep, which
keeps the untestable code confined to one directory.

**The plan quotes 158 plans; measured 2026-08-30 it is 170.** Use the real
count at implementation time — the number is a measurement, not a constant.

### Done when

Plan's Agreeing `Done when`, plus: the corpus job is a separate CI job, and
every disagreement is either fixed or filed as a production bug with its plan.

Repo gates: `pnpm test`, `pnpm run typecheck`, changeset. Node 24, `corepack pnpm`.
Run e2e with `env -u PLOT_UNATTENDED` — the worker env trips the control tests.

### Scope guard

Owns the corpus test tier and its CI job. Does NOT change adapters to make a
comparison pass — that is the one move this slice forbids.
