# I can see whether my build passed

> A team on Jenkins reads its build status from the board, instead of the board
> saying nothing and meaning *I never asked*.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** the-board-serves-an-enterprise-stack
- **Issue:** <!-- optional -->
- **Story:** the-board-is-blank-where-it-matters
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 2
- **Approved:** <!-- YYYY-MM-DD, who, channel -->
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

- A branch's `checks` value resolves through Jenkins where the repo declares
  `CI: jenkins`, so build status on the board is a fact for a Jenkins team
  rather than a permanent blank.

## Motivation

`plot-board-probe.sh` detects the `jen` CLI, a `Jenkinsfile`, and `jen`'s auth
state. `plot-config.sh` documents `CI: jenkins` and `Jenkins instance`.
`plot-host.sh` contains **zero** references to `jen`.

So the trail ends one step before the board: a team is asked for its Jenkins
instance, the answer is recorded, and nothing ever reads it. The configuration
reads as support.

## Design

### The four states already exist and are not ours to redefine

`pr-list --rich` reports `checks` as `passing | failing | pending | none`, plus
`failing_checks` naming which. A Jenkins backend fills those four, and adds no
fifth.

**`none` already carries a subtle meaning worth preserving.** The adapter's own
comment records it: an empty rollup means *no run exists*, which on GitHub
covers both a conflicting PR and **a bot PR whose run awaits a human click** —
the exact state that blocked release PR #436. `mergeable` is what tells those
apart. Jenkins has its own version of *no run exists*, and it must land on
`none` rather than on `failing`.

### The spike is done, and it answered the cost question outright

**Measured 2026-08-26** against `jenkins-ci-webbloqs.internal.quatico.dev`,
`jen` 0.2.0, job `webbloqs/continuous-build-multi`:

```
$ time jen -I <instance> job list webbloqs/continuous-build-multi --json
45 branches, each {name, color}          0.17 s, ONE call
```

Both of the wave's numbers, in one measurement:

1. **One call, not one per branch.** A multibranch job's branches are its
   children, and listing the job returns every branch with its build result.
   `--depth` was not even needed.
2. **0.17 s**, against a PR timer measured in tens of seconds.

**So there is no cache, and Done-when 5 is free.** The wave existed to decide
between one-call-per-refresh (no cache) and one-call-per-branch (cache
required); the first won, and the design below follows it rather than hedging.

### The payload is `{name, color}` — and colour is not the four states

The one thing the fast path does NOT give is a rich result. The full vocabulary
observed: `blue`, `red`, `yellow`, `disabled`.

| Jenkins | means | `checks` |
|---|---|---|
| `blue` | last build succeeded | `passing` |
| `red` | last build FAILED | `failing` |
| `yellow` | **UNSTABLE** — ran, tests failed, no error | `failing` |
| `disabled` / absent | no build to report | `none` |
| `*_anime` suffix | a build is RUNNING | `pending` |

**`yellow` maps to `failing`, deliberately.** Jenkins frames UNSTABLE as
*not red*, and mapping it to `passing` would be faithful to that framing and
wrong here: a branch whose tests failed would read green on a board people use
to decide what is ready. Showing a fact a team cannot otherwise see is this
sprint's whole subject, and a false green is worse than the blank it replaces.
It reports `failing` and names the job in `failing_checks`, so the difference is
visible where it matters.

**`*_anime` → `pending` is READ, NOT MEASURED.** Jenkins' documented convention
is an `_anime` suffix on the colour while a build runs. No build was running on
the instance during the spike, so no `_anime` value was observed. The
implementation verifies it against a live build and corrects this table if the
suffix does not appear as documented — Done-when 8.

### Branch names come back URL-encoded, and the join must decode them

**Measured: 27 of 45 branch names were percent-encoded**, e.g.

```
bugfix%2FCDSTLZ-189-form-validate-face      →  bugfix/CDSTLZ-189-form-validate-face
```

Every name containing a slash arrives encoded; none arrived with a raw slash. So
a naive equality join against Plot's branch names silently misses **60% of the
branches here** — and misses them as `none`, which reads as *no build* rather
than as a failed join. Decode before joining (Done-when 6).

### Which build belongs to which branch

GitHub ties a check rollup to a PR head SHA. Jenkins has no such link by
construction: a job may be multibranch (branch → job path), or parameterised, or
triggered by a webhook that names neither.

**Multibranch only.** It is the common shape, the path is derivable from the
branch name, and the spike proves `jen` queries it in one call. Anything else
reports `none` rather than guessing.

### It must not join the scan's per-branch path

`maybeAutoDispatch` and the fleet scan already pay for host latency once per
pulse. A Jenkins call per branch would put a second network round trip on the
5-second cadence — the cost `a-stale-ref-outranks-the-host` and the PR-list join
were both built to avoid. One call per refresh, joined locally. **The spike makes
this free rather than a constraint to engineer around.**

### `jen` exits 0 on failure, exactly like `bb`

`jen -I <instance> auth status` prints `Jenkins auth: NOT reachable` and
**exits 0**. `plot-board-probe.sh:193` already records the sharper form: a slug
that does not exist still prints `Keycloak: signed in`, because the slug expands
into a URL pattern without being reached.

So Done-when 4's *"an unreachable Jenkins exits 3"* cannot be implemented by
checking `$?`. Reuse the discipline `classify()` in the probe already encodes:
match the success text, and **degrade to failure rather than to `ok`** when the
wording is unrecognised. This is the same trap the sibling Bitbucket plan hit
from the other direction — `bb` writes errors to stdout and exits 1 for
everything.

## Waves

### Reported (Branch: feature/a-jenkins-build-has-a-status)

`plot-host.sh` resolves `checks` through `jen` for a multibranch job under
`CI: jenkins`, filling the existing four states from one `job list --json` call
per refresh, decoding branch names before the join.

**The spike that opened this wave is complete** — its numbers are in the Design
above, and they removed the cache the wave was hedging about. What remains is
the backend.

## Done when

1. A branch with a passing Jenkins build reports `checks: "passing"`; a failing
   one reports `failing` **and** names the job in `failing_checks`.
2. **A branch with no job reports `none`, not `failing`.** Absent is not failed —
   the same rule the adapter already keeps for an empty GitHub rollup.
3. **A repo without `CI: jenkins` is unaffected**, and a GitHub repo still reads
   its check rollup exactly as today.
4. **An unreachable Jenkins exits 3**, and this is asserted WITHOUT relying on
   the exit code: `jen` exits 0 while printing `Jenkins auth: NOT reachable`, so
   an implementation that checks `$?` reports a reachable-but-empty Jenkins and
   passes item 2 while doing so.
5. **No per-branch call joins the scan's path.** Asserted by the existing
   no-network test. The spike makes this free: one call returns every branch.
6. **A branch whose name contains `/` is joined correctly.** Names arrive
   percent-encoded (`bugfix%2Ffoo`), 27 of 45 in the measured job, and an
   equality join without decoding misses them AS `none` — indistinguishable from
   having no build.
7. **`yellow` (UNSTABLE) reports `failing`, not `passing`.** A branch whose
   tests failed must not read green on a board used to decide readiness.
8. **A RUNNING build reports `pending`.** The `*_anime` convention is read from
   Jenkins' documentation, not measured — no build was running during the spike.
   Verify against a live build and correct the Design's table if it differs.
9. `pnpm run validate`, `pnpm run test:reconcile` green.
## Notes

### Interrogated 2026-08-26

One round, on cost. Whether `jen` can report many branches in one call decides
whether this needs a cache at all, and building one on a guess is the waste the
measurement avoids — so the wave now opens with a spike and the design follows
it, the same shape that worked for the brief-source question earlier today.

### Interrogated again 2026-08-26 — the spike ran during interrogation

Round two RAN the wave's opening spike instead of describing it, following the
lesson the sibling Bitbucket plan recorded the same day: *a plan that opens with
"establish whether X is possible" should run that check during interrogation, not
during implementation.*

It took one call and settled the design fork the wave existed for: **45 branches
with build results in 0.17 s**, so no cache, and Done-when 5 is free rather than
engineered around.

Three things the spike found that no amount of reasoning would have:

- **`{name, color}` is all the fast path returns**, so the four states are filled
  from Jenkins' colour vocabulary — and `yellow` (UNSTABLE) has no natural slot.
  It maps to `failing`: a branch whose tests failed reading green on a readiness
  board is worse than the blank this sprint replaces.
- **27 of 45 branch names arrived percent-encoded.** An undecoded join misses
  them as `none`, which is indistinguishable from having no build — a silent
  60% miss on the measured job.
- **`jen` exits 0 while printing `Jenkins auth: NOT reachable`.** Done-when 4
  cannot be implemented against `$?`. `plot-board-probe.sh:193` already
  documents the sharper case: a nonexistent slug still reports "signed in".

That last one is the second CLI in this sprint whose failures are invisible to
the exit code — `bb` writes errors to stdout and exits 1 for everything. Two of
three host CLIs, found the same day, by asking rather than assuming.

### Open Points

- [ ] Non-multibranch Jenkins setups: report `none`, or ask for a job-name
      pattern in `## Plot Config`? The second is more capable and more to
      configure. **Unchanged by the spike** — it measured the multibranch path,
      which the plan already scoped to.
- [x] Does `jen` expose build status for many branches in one call? **YES —
      measured 2026-08-26: one call, 45 branches, 0.17 s.** No cache; the
      numbers are in the Design.
- [x] Where does UNSTABLE land? **`failing`**, with the job named in
      `failing_checks`.
- [ ] Does a running build really carry the `*_anime` suffix? Read from Jenkins'
      docs, not observed — nothing was building during the spike. Done-when 8
      makes verifying it the implementation's job.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 2,
  "questionHistory": [
    {
      "q": "One call or one per branch?",
      "a": "Unknown \u2014 the wave now opens with a spike measuring it, and names which number decided the design",
      "category": "nonFunctional"
    }
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {
      "stack": false,
      "architecture": true,
      "implementation": false
    },
    "domain": false,
    "ux": {
      "happyPath": false,
      "edgeCases": false,
      "errors": false,
      "accessibility": false
    },
    "nonFunctional": {
      "security": false,
      "performance": true,
      "scalability": false
    },
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
