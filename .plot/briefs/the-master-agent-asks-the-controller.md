# Implementation brief — the-controller-answers-every-asker (slice 4: Asking again)

- **Plan (canonical):** `docs/plans/2026-08-30-the-controller-answers-every-asker.md` on main
- **Branch:** `feature/the-master-agent-asks-the-controller` (base: `main`)
- **Ends as:** one PR to main
- **Runs last.** Its entry point returns whatever the controller returns, so the
  controller must be settled first — including the enrichment split from slice 2.

### What to build

A `node` entry point that reaches the same controller the routes reach: one
entry, callable without HTTP, returning the same typed answer the route
serialises.

### The decisions the plan settles — do not re-derive them

**`node`, not HTTP.** The alternative was calling a live board, which is faster
when one exists — the answer is already in memory from the last pulse — and
answers nothing when one does not. **Measured while deciding: no board was
running.** Seven skills would have gained a dependency on a service that has
always been optional, and the failure would arrive as a skill that works on the
operator's machine and not in a worker's.

**The cost is stated and accepted:** the `node` path re-derives what a running
board already computed. It makes nothing slower than today — a skill pays the
same 18.3 s it pays now — but forgoes a saving that was available. **An HTTP
fast path can be added later without changing any caller**, because the entry
point is the seam. Adding it now means two paths to one answer before either is
proven.

**The precedent is settled, not proposed:** seven scripts already invoke `node`,
and `plot-sprint-candidates.sh` argues for it in its own comment.

### Done when

**Read this one carefully — the plan's original wording was withdrawn.**

The assertion is `plot-deliver`'s **delivery-landed gate**: it runs the scan,
applies a fix if the grep finds drift, then **re-runs the scan and repeats until
the grep is empty**. That second scan reads an estate the first one already
measured. It must measure **once per unchanged estate**, and the answer must be
identical to the board's.

**Why that gate and not "a skill that reads fleet state twice".** The plan said
five skills did; a recount on 2026-08-30 found four of those were prose or a
help block. Three greps for one question gave 25, 14 and 5 call sites.
`plot-reconcile`'s apparent three are **one invocation shown three ways** —
full sweep, `--no-fetch`, `--offline`.

**So the gate is the single witness, and an assertion aimed at a population that
does not exist passes vacuously.** This repo has found that defect three times;
do not add a fourth by asserting against "skills that ask twice".

**The caching question is yours.** *Once per unchanged estate* needs a notion of
unchanged. Whatever you choose, it must be a measurement rather than a timer —
an estate that changed between the two scans must produce two scans.

Plus: `pnpm test`, `pnpm run typecheck`, `pnpm test:board`, `pnpm run test:e2e`
(with `env -u PLOT_UNATTENDED`), changeset. If a skill changes, its changeset
carries a `bumps: skills:` block; if only board code changes,
`'@plot-pm/board': patch`.

### Scope guard

The entry point and the one gate that proves it. **Not** repointing the other
call sites — `production-calls-the-domain-one-rule-at-a-time` owns that, and 26
of its 51 spawn call sites sit in handlers this plan rebuilds.

Do not change what the scan measures or what the gate decides. The gate's
refusals are a delivery guard; this slice changes **how often it asks**, not
what it does with the answer.
