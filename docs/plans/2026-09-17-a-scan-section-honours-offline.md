# A scan section honours offline

> `--offline` promises no git-host call and section 6 makes one per delivered plan, so a scan the operator asked to stay local times out against the network.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #931
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** plot-gates
- **Review:** in-session
- **Impl:** own branches

## Changelog

- `plot-reconcile-scan.sh --offline` no longer calls the git host. Section 6 asked for one PR state per delivered plan regardless of the flag, so a scan told to stay local spent minutes on the network and, on a repository with a long delivered backlog, never finished.

<!-- Board impact: the pulse runs this scan and reports its timeout. No plan
     format, no template, no layout. -->

## Design

**The flag is declared and one section ignores it.** The scan's own header
prints the promise:

```
PR state: skipped (--no-pr) — git merge-state only; no git-host network call.
```

Section 2 honours it and reports `pr_source=off`. **Section 6 has no guard at
all** — measured 2026-09-17, no `PR_SOURCE` test appears between the loop's
`while` at `:1137` and its `pr-state` call at `:1156`.

### The cost is the delivered backlog, not the repository's size

Reported on a repository with **109 plans, 82 of them delivered**:

| reading | value |
|---|---|
| `plot-host.sh pr-state <n>` | **8.2 s** |
| 82 delivered plans | **≈ 11 minutes** |
| the pulse's budget | **90 s** |
| measured run | `exit=124`, killed at 100 s, still inside section 6 |

**The pulse then blames the wrong things.** It reports *"2 worktrees, 10
branches"* — the two cheapest inputs in the run.

**On this estate the defect is invisible**, and that is the property worth
recording: measured here 2026-09-17, **2 delivered plans at 1.76 s each**. The
cost scales with how far the estate is from its last release, so a project that
releases often never sees it and one that does not cannot finish a scan.

### Two fixes, and they are separable

**1 — the section honours the flag.** `--offline` and `--no-pr` already set
`PR_SOURCE=off`; section 6 reads it and skips, printing what it could not
answer rather than nothing:

```
note: release state not resolved (pr_source=off) — a delivered plan cannot be
      checked against a released version without asking the host.
```

**Silence would be the worse bug.** An empty section reads as *nothing to
report*, and the whole point of section 6 is that "cannot tell" and "nothing
wrong" must not look the same — the section's own `no PR annotation` arm says
exactly that at `:1147`.

**2 — the online path asks once, not N times.** `plot-host.sh pr-list` already
bundles, and the scan already uses a bundled merged-PR list elsewhere. A
per-plan `pr-state` is the shape `plot-pr-merged.sh` was extracted to avoid.

**The first fix is this plan. The second is named and not taken**, because it
changes what the online scan costs and needs its own measurement of the bundled
call against the 8.2 s per-plan one.

### What this does not do

**It does not change what an online scan reports.** With the host reachable,
section 6 answers exactly as today — pinned, because a flag fix that quietly
narrows the online answer would trade a timeout for a wrong report.

**It does not make `--offline` mean "fast".** It means *no host call*. Section 6
still parses every plan, which is 0.117 s each and this plan's own measurement
says so.

**It does not touch `--no-fetch`.** Three flags exist and they promise different
things; only the two that set `PR_SOURCE=off` are in scope.

## Slices

### A scan section honours offline (Branch: bug/a-scan-section-honours-offline)

- `bug/a-scan-section-honours-offline` — guard section 6 on `PR_SOURCE`, print a note naming what went unresolved, and pin that an online scan's section 6 is unchanged

**Done when** `--offline` and `--no-pr` each make **zero** `pr-state` calls from
section 6, asserted by counting the calls against a stub rather than by timing;
the section prints a note naming what it could not resolve, and that note is
asserted by text so an empty section cannot pass for a clean one;
`unreleased_delivered` reports a number that a reader can tell apart from a
measured zero; an **online** scan's section 6 output is **byte-identical** to
today's over a fixture carrying a delivered plan with a merged PR; a fixture
with 3 delivered plans makes 3 calls online and 0 offline, pinning both
directions in one test; and `pnpm run test:contracts` passes.

## Notes

**Reported 2026-09-17 with the measurement already in it** — the per-call cost,
the loop size, and the killed run with its exit code. Nothing in the Design
above is inferred; the two estate readings were re-taken here.

**The gate that found it was `/plot-release`'s**, one day earlier and on the
same section: section 6's docs/infra exemption had silently stopped working
(`f5d052af`). Two defects in one loop in two days is worth saying out loud —
this section reads a row, spawns a process per plan, and had no test covering
either.
