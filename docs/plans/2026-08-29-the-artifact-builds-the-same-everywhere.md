# The artifact builds the same everywhere

## Status

- **Phase:** Draft
- **Type:** infra
- **Sprint:** the-domain-is-one-implementation
- **Issue:** <!-- optional -->
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** <!-- YYYY-MM-DD, who, channel -->
- **Started:** <!-- YYYY-MM-DD, who, branch -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Approval

- **Assignee:** Jan Wloka

## Changelog

`pnpm build:board` produces the same bytes from the same sources whatever
directory it runs in, so the freshness gate stops firing on work that changed no
board source.

## Motivation

### Measured 2026-08-29: the same commit, two directories, two artifacts

```
main checkout      7f54add7…    …stories…}),Dj=…  Lj=…
a worktree         d68e4c42…    …stories…}),Mj=…  Gj=…

size    1,097,615 bytes — identical
lines   263 — identical
```

The only differences are **esbuild's generated short names**. Within one
directory the build is byte-stable: two consecutive runs give the same hash. So
the build is deterministic **per path** and not **across paths**.

### It is circular, and that is the real cost

`main` now carries the worktree's artifact, because that is the one #524
committed to get past the gate. A fresh build in the main checkout produces the
*other* hash — so the next PR raised from there is stale by the gate's reading,
commits its own variant, and the PR after it from a worktree flips it back.

**This repository has 22 worktrees.** Every one is a directory the build can
disagree from, and the fleet raises PRs from all of them.

### What it costs in practice

`the-domain-moves-out-of-the-board` slice 4 was verified green locally — 221
tests, 100% coverage, no writes, correct scope — and CI refused it on the
artifact alone. The worker had *seen* the drift, reported it precisely, and
deliberately not committed it:

> *A rebuilt board artifact drifts from main's committed one by 2 lines of
> minified whitespace, independent of this branch. I did not commit it: my
> branch changes no board source.*

That was the right call — a foreign artifact inside a domain PR makes the diff
unreviewable — and the gate rejected it anyway. **A gate that punishes the
correct judgement is one people learn to route around**, which here means
committing artifact churn nobody reads.

### The gate itself is right and must stay

The artifact is what a published board actually runs; a stale one shipped a
board that could not spawn for nine releases. **The defect is not the gate — it
is that the build cannot satisfy it.**

## Design

### Make the build path-independent

The likely cause is a minifier assigning short names in module-resolution order,
which varies with absolute paths. Two candidates, in order of preference:

1. **Pin the resolution order.** If esbuild's `absWorkingDir` or an explicit
   entry ordering removes the variance, the build becomes byte-deterministic
   with no loss.
2. **Disable name mangling** (`minifyIdentifiers: false`). Larger artifact,
   fully deterministic. Measure the size cost before choosing: the artifact is
   1.1 MB and ships in the npm package.

**Measure first.** The trace above says *what* differs, not *why*; a fix chosen
before the cause is known is a guess that happens to work.

### Not chosen: compare semantically instead of by bytes

Teaching the gate to ignore identifier names would need it to parse and
normalize 1.1 MB of minified JavaScript — a second implementation of a
minifier's naming, which is exactly the kind of duplicate rule
[stage 2 §5](../stories/the-master-agent-holds-the-fleet/DESIGN-review-workflows.md#5-the-distinction-that-decides-it)
forbids. **Fix the build, not the ruler.**

### Not chosen: build only in CI

It would end the churn and remove the local check that catches a forgotten
rebuild before it costs a CI round trip.

## Waves

### Measuring (Branch: infra/the-artifact-drift-has-a-cause)

Establish *why* the names differ: build the same commit in two directories with
`--metafile`, diff the module order, and confirm or refute the path hypothesis.

Tests: a written finding naming the cause, reproducible by the commands in it.

### Fixing (Branch: infra/the-artifact-is-path-independent)

Apply whichever remedy the measurement selects, and record in `build.mjs` which
one and why.

Tests: the same commit built in the main checkout and in a worktree produces
**identical bytes**; the artifact's size change, if any, is stated.

## Done when

1. **Two directories, one commit, identical bytes.** Asserted by building in
   both and comparing hashes — the exact procedure that produced this plan.
2. **The gate is unchanged.** This fixes the build, not the check.
3. **Any size increase is stated with its number**, since the artifact ships in
   the npm package.
4. **`build.mjs` records the cause and the remedy**, so the next reader does not
   re-derive it.
5. `pnpm test`, `pnpm run test:board` green.

## Notes

Found when CI rejected a slice that was green in every other respect. The
symptom looks like carelessness — *someone forgot to rebuild* — and is not: the
worker rebuilt, compared, reported the difference, and correctly declined to
commit a change its branch did not cause.
