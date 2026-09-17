# A scan section honours offline

> `--offline` promises no git-host call and section 6 makes one per delivered plan — a flag that does not hold, and on a repository with a long delivered backlog, minutes spent on a network the operator asked it to leave alone.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #931
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** plot-gates
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 2

## Changelog

- `plot-reconcile-scan.sh --offline` no longer calls the git host. Section 6 asked for one PR state per delivered plan regardless of the flag, so a scan told to stay local reached the network anyway — and on a repository with 82 delivered plans, spent eleven minutes there against a 90 s budget.

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

**On this estate the defect is unreachable**, and that is stronger than
invisible. Measured here 2026-09-17 by replaying section 6's own filters:

```
SKIP (docs):  the-skills-say-slices
SKIP (infra): the-supervisor-log-has-a-ceiling
delivered=2  reaching_pr_state=0
```

Both delivered plans are exempted by `:1143`'s `case "$ptype" in docs|infra)`
before the call. **Zero host calls, not two.** An earlier draft of this plan
counted delivered plans and priced them at 1.76 s each — the count was right and
the calls do not happen.

**That has a consequence for the fix's own test**: no real plan on this estate
exercises the loop, so the online-direction gate needs a **synthesized** fixture
carrying a `Type:` outside `docs|infra`. The fixture is load-bearing rather than
convenient, and an implementer pointing the test at `docs/plans/` would measure
nothing.

The cost scales with how far the estate is from its last release **and with how
many of those plans ship code**, so a project that releases often never sees it
and one that does not cannot finish a scan.

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

**And what is given up is a CORRECT answer, which both rounds framed as a broken
one.** Run offline today, section 6 reports exactly what it reports online —
here, `(none)`, and it is right. The flag is not producing wrong output; it is
producing output it promised not to pay for. **This change trades a correct
answer for a kept promise**, which is a defensible trade and a different claim
from *repairing a defect*. The note is what keeps the trade visible to whoever
reads the scan next.

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

**It does not make `--offline` mean "fast", and on this estate it will not meet
the 90 s budget this plan opens with.** Measured twice on 2026-09-17, both with
**zero host calls**:

| run | wall clock | conditions |
|---|---|---|
| a round-2 juror's | **464 s** | eight agents running |
| this plan's author's | **348 s** | quieter machine |

**The spread is the machine, not the scan**, and both readings sit four times
over the 90 s budget.

**The parse is not the residual, and the earlier arithmetic was wrong in kind.**
Two rounds of this plan — and two jurors, and a moderator — multiplied a
per-plan figure of 0.117 s by 292 files to predict ~34 s. **The scan parses
once**, and `plot-reconcile-scan.sh:556` says so four lines above the call:

```
# ONE parser invocation for the whole sweep (see the single-pass note above).
```

Measured: **470 ms for all 292 plans.** So parsing is 0.1% of an offline scan,
not 10%.

**And the residual is now measured, by a round-2 juror who instrumented the
scan per section.** At load 11.17, an offline run costs 373.58 s, of which
**340.79 s — 91.2% — is spent BEFORE section 1 begins.** Section 6, the subject
of this plan, costs **0.06 s**. The second-largest section is 18 at 23.78 s.

**The cause is `symlinked_from` (`:675`), and it is quadratic.** It walks every
link in an index and forks twice per link — `readlink` and `sed` — and it is
called per plan across both indexes. Derived from this estate's real
directories:

```
active links: 80   delivered links: 275   plans: 292
292 x 355 x 2 = 207,320 forks
```

**That is the whole finding, and it belongs to no section** — which is why four
prior readings of this plan, two panels and a moderator all looked inside
sections and found nothing.

**It is stated as a range rather than a number** because a single sample of a
load-sensitive figure is not a standing fact — the lesson this estate already
paid for once, when three versions of a plan rested on one reading of a field
that self-evicts.

**Saying so is the point, and it changes what this plan claims to be.** A reader
meeting the opening sentence — a pulse timing out at 90 s — would reasonably
expect that budget met once this lands. It will not be: honouring the flag
removes host calls that, on this estate, number zero.

**So the honest framing is a CONTRACT fix, not a performance fix.** `--offline`
declares no host call and section 6 makes one; that is worth repairing because
the flag means something.

**On the REPORTER's repository the fix does meet their symptom** — 82 delivered
plans reaching the call at 8.2 s each is ~11 minutes, and their `exit=124` kill
lands inside section 6. **On this estate it changes nothing measurable**, and
the reason is the 207,320 forks above rather than anything this plan touches.

**The separate defect is named rather than merely acknowledged**: `symlinked_from`
is quadratic in plan count, and it is somebody's plan to write. It is not this
one, because a contract fix and a complexity fix share no gate — but a reader
who finishes this plan should not have to re-derive where the time went.

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
today's over a fixture carrying a delivered plan with a merged PR; a **synthesized** fixture with 3 delivered plans whose `Type:` is outside
`docs|infra` makes 3 calls online and 0 offline, pinning both directions in one
test — synthesized because `reaching_pr_state=0` on this estate, so no real plan
would exercise it; and `pnpm run test:contracts` passes.

## Notes

**Reported 2026-09-17 with the measurement already in it** — the per-call cost,
the loop size, and the killed run with its exit code. Nothing in the Design
above is inferred; the two estate readings were re-taken here.

**Amended 2026-09-17 after a two-lens panel**
(`.plot/panels/2026-09-17-a-scan-section-honours-offline/`). Both jurors
confirmed the defect and the fix; both amended on this plan's own measurements.
`gates` established that the counting machinery the strongest gate needs already
exists at `scan.test.mjs:411`.

**The panel's own blind spot is recorded because it is this plan's too**: both
jurors reasoned about section 6, and the 464 s an offline scan costs here lies
outside it. The report's repository times out INSIDE section 6 at 100 s; this
estate spends 464 s never entering it. **Both are true and they are not the same
problem** — this plan fixes one and is titled for the other.

**The gate that found the section's last defect was `/plot-release`'s**, one day
earlier and on the same section: section 6's docs/infra exemption had silently stopped working
(`f5d052af`). Two defects in one loop in two days is worth saying out loud —
this section reads a row, spawns a process per plan, and had no test covering
either.
