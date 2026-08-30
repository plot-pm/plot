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

### Measured 2026-08-30: the path hypothesis does not survive a control

The plan above was written from a trace, not from an experiment. Run as an
experiment, it fails to reproduce.

```
two checkouts of da770281, differing only in path length, full build:
  …/artifact-ab/a                    d8ca6bf755743c5a   1,105,070 bytes
  …/artifact-ab/bbbbbbbbbbbbbbbbbbbb d8ca6bf755743c5a   1,105,070 bytes

a real worktree — its OWN node_modules, a DIFFERENT commit (5efc508c),
built through the official `pnpm run build`:
                                     d8ca6bf755743c5a
```

**The control is what makes this a measurement.** Two earlier attempts at this
same A/B came back "identical" and meant nothing:

1. The first suppressed `node build.mjs`'s output, so a build that never ran
   read as a build that produced the same bytes.
2. The second used `const x = "probe"; void x;` as its mutant — which is
   precisely what a minifier deletes. `grep` found it in the source and not in
   the artifact.

The third used `console.log("AB_PROBE_CANNOT_BE_ELIDED")`, which reached the
artifact and moved the hash to `97926ad4b025bdfe`; removing it returned
`d8ca6bf7`. **Only then does "the long path also gives d8ca6bf7" carry
information.**

### Measured 2026-08-30: the gate fired twice, on two branches, tiny

83 CI runs on 2026-08-29, 21 failures. Two of them — and only two — are this
gate:

```
15:57  534d97a8  feature/a-transition-is-one-value
       board-server.mjs | 4 ++--    1 file changed, 2 insertions(+), 2 deletions(-)

13:21  f5682a28  bug/main-typechecks-again
       board-server.mjs | 2 +-      1 file changed, 1 insertion(+), 1 deletion(-)
```

**Two lines, and one line.** Not the whole-file churn the plan's opening
section describes, and both on feature branches rather than on `main`.

**A methodological note, because it nearly became a finding.** A first pass
reported *six* runs, by grepping `--log-failed` for `is stale`. GitHub echoes
the entire `run:` block of the failing step before executing it, so that string
appears in every failure of this step regardless of what actually broke — four
of the six failed at other gates entirely (`Wave` misuse, arrow functions, the
Agent/Worker rule). Real output is separable: the echo carries the `36;1m`
colour code and the executed line does not. Grepping the log for a gate's
message finds the gate's *source*, not its verdict.

**What the platform hypothesis costs.** It was worth asking — this repo's
artifacts are all built on macOS and verified on Linux — and 40 runs on
2026-08-30 answered it: not one staleness failure. A systematic macOS/Linux
divergence would fail *every* PR, since every committed artifact came from a
Mac. It fails almost none.

### Measured 2026-08-30, evening: two identifiers, one path, and a live gate failure

CI's freshness gate rejected #540. Rebuilding in that worktree changed the
artifact by **two minifier identifiers and nothing else**, across 265 identical
lines:

```
line 125, col 47015   …"unmeasured"]);var oj=d.enum(["created",…
                      …"unmeasured"]);var lj=d.enum(["created",…
line 239, col  8650   …xh.parse(n)}var Q4=td.options;function Qg…
                      …xh.parse(n)}var tN=td.options;function Qg…
```

**This is a THIRD candidate the plan does not list**, and it narrows the other
two. The committed bytes came from a worker in **that same worktree**, and
rebuilding there three times gave one hash every time:

```
90301d9ea079   90301d9ea079   90301d9ea079
```

So the build is stable at this path — which rules out *the same tree building
differently on successive runs*, and leaves the question of what the worker's
build had that this one does not. **A different `node_modules` state is the
obvious suspect** and is untested: the morning's A/B symlinked one tree's
modules into both, deliberately removing that variable.

**What it costs, concretely:** the gate rejected an otherwise-green PR, and the
fix was a rebuild committed by hand. That is the second time in two days the
same two-identifier shape has cost a round trip.

**Candidate 1 gains a rival, and candidate 2 is now unlikely.** The client is
rebuilt by `pnpm build:board` in both cases, so a stale `dist/client/` cannot
explain a diff this small — 582 KB of embedded HTML would not survive as two
short names.

### What this leaves

The `Measured 2026-08-29` block above reports two artifact hashes under the
heading *the same commit*, and does not record the commit. `7f54add7` and
`d68e4c42` are not objects in this repository — they are outputs, so the
table shows two results and no inputs. The claim the entire diagnosis rests on
is the one thing in it that was not measured.

That does not mean the drift was imagined: something rejected a green slice on
2026-08-29, and the artifact was hand-rebuilt to get past it. It means the
cause is still unknown, and **`build.mjs` is no longer the leading suspect.**
The Measuring slice below is therefore the whole plan for now — with a
different first question:

> Both build stages are path-independent under control. So what differed
> between the two directories on 2026-08-29 — the source they were built from,
> the client input, or the moment they were built?

The Fixing slice stays unwritten until that is answered. A remedy chosen now
would be a fix for a mechanism this experiment could not find.

The 2026-08-29 trace's only differences are **esbuild's generated short names**. Within one
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

### Find what actually varies

The path hypothesis was the plan's whole design until 2026-08-30, when it was
run as an experiment and did not reproduce. Both build stages — `vite build`
for the client, `node build.mjs` for the server — return identical bytes across
directories, across `node_modules` trees, and across two commits.

So the remaining candidates are the ones a hash comparison cannot separate on
its own, and each is answerable:

1. **The two directories were not on the same source.** The cheapest to check
   and the likeliest: the 2026-08-29 trace records no commit, and a worktree
   one commit behind is indistinguishable from a non-deterministic build if you
   only compare outputs. **The two real failures support this**: a 1-line and a
   2-line diff is what a near-identical input produces, not what an unstable
   minifier does.
2. **The client input differed.** `build.mjs` does not build the client — it
   embeds an existing `dist/client/index.html`, 582 KB of the artifact's 1.1 MB.
   A stale `dist/client/` produces a new server around an old client, and
   `pnpm run build:server` alone does exactly that. The full `pnpm run build`
   runs both stages, so this only bites someone invoking the inner script.
3. **Something time- or environment-dependent reaches the bundle.** A date, a
   version string, a path baked in at build time. Falsifiable by building the
   same tree twice with a delay between the runs.

**Do not choose a remedy before one of these is confirmed.** The previous
version of this section chose two, and the measurement it was waiting for
refuted the premise both shared.

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

Work the three candidates above in order, cheapest first, and stop at the one
that reproduces. The 2026-08-30 run already closes the path question; what
remains is to find the variable it did not vary.

**Every negative result is a finding and gets written down.** The reason this
plan spent a day pointing at `build.mjs` is that the 2026-08-29 trace recorded
what differed and not what was held constant.

Tests: a written finding that either names the varying input — with the two
values it took — or states that no reproduction was found and the drift is not
currently observable. **Both are valid outcomes.** A slice that cannot find the
bug has finished honestly; one that invents a cause to have something to fix
has not.

Every command in the finding must carry its control: a mutation that moves the
hash, so a reader can tell a real comparison from two builds that never ran.

### Fixing — not yet cut

There is no branch here on purpose. A remedy needs a mechanism, and the
Measuring slice may well conclude there is nothing to fix. Cutting the branch
now would be the same mistake in a second iteration: work sized against a
hypothesis instead of a measurement.

## Done when

1. **The finding names what varied, or states that nothing did.** Both close
   this plan; only an unmeasured cause leaves it open.
2. **Every comparison in the finding carries a control** — a named mutation and
   the hash it produced. Three A/B runs on 2026-08-30 returned "identical" and
   two of them were measuring nothing; the control is the difference.
3. **The gate is unchanged.** Whatever this turns out to be, it is not the
   check's fault.
4. **If a remedy is found and applied:** `build.mjs` records the cause and the
   remedy, and any size change is stated with its number, since the artifact
   ships in the npm package.
5. `pnpm test`, `pnpm run test:board` green.

## Notes

Found when CI rejected a slice that was green in every other respect. The
symptom looks like carelessness — *someone forgot to rebuild* — and is not: the
worker rebuilt, compared, reported the difference, and correctly declined to
commit a change its branch did not cause.
