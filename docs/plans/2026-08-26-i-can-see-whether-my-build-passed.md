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
the exact state that blocked release PR #436 today. `mergeable` is what tells
those apart. Jenkins has its own version of *no run exists*, and it must land on
`none` rather than on `failing`.

### Which build belongs to which branch

The hard part, and the reason this is a feature rather than a wiring job. GitHub
ties a check rollup to a PR head SHA. Jenkins has no such link by construction:
a job may be multibranch (branch → job path), or parameterised, or triggered by
a webhook that names neither.

**Multibranch first.** It is the common shape, the path is derivable from the
branch name, and `jen` can query it. Anything else is out of scope and must
report `none` rather than guess.

### It must not join the scan's per-branch path

`maybeAutoDispatch` and the fleet scan already pay for host latency once per
pulse. A Jenkins call per branch would put a second network round trip on the
5-second cadence — the cost `a-stale-ref-outranks-the-host` and the PR-list join
were both built to avoid. One call per refresh, joined locally.

## Waves

### Reported (Branch: feature/a-jenkins-build-has-a-status)

**Opens with a spike, and the design follows it.** Whether `jen` can report many
branches' build status in ONE call decides the shape of everything after: one
call per refresh needs no cache, one call per branch needs one, and building a
cache that turns out to be unnecessary is the waste this measurement avoids.

Measure two things and record both in this plan before writing the backend:

1. Can `jen` list a multibranch job's branches with their last build result in a
   single invocation, or is it one call per branch?
2. What does that call cost, against the PR timer's cadence — not the 5-second
   scan's, since this joins the PR refresh.

Then: `plot-host.sh` resolves `checks` through `jen` for a multibranch job under
`CI: jenkins`, filling the existing four states.

**If the answer is one-call-per-branch and the cost is prohibitive**, the honest
fallback is Done-when 2's `none` for branches not covered, plus a note in this
plan saying which shapes are supported. Partial support that says what it does
not cover beats a cache built on a guess.

## Done when

1. A branch with a passing Jenkins build reports `checks: "passing"`; a failing
   one reports `failing` **and** names the job in `failing_checks`.
2. **A branch with no job reports `none`, not `failing`.** Absent is not failed —
   the same rule the adapter already keeps for an empty GitHub rollup.
3. **A repo without `CI: jenkins` is unaffected**, and a GitHub repo still reads
   its check rollup exactly as today.
4. **An unreachable Jenkins exits 3.** It was asked and failed; that is not the
   same as a branch having no build, and a consumer must be able to tell.
5. **No per-branch call joins the scan's path.** Asserted by the existing
   no-network test.
6. **The spike's two numbers are in this plan** before the backend is written,
   and the design names which of them decided it.
7. `pnpm test`, `pnpm run test:reconcile` green.

## Notes

### Interrogated 2026-08-26

One round, on cost. Whether `jen` can report many branches in one call decides
whether this needs a cache at all, and building one on a guess is the waste the
measurement avoids — so the wave now opens with a spike and the design follows
it, the same shape that worked for the brief-source question earlier today.

### Open Points

- [ ] Non-multibranch Jenkins setups: report `none`, or ask for a job-name
      pattern in `## Plot Config`? The second is more capable and more to
      configure.
- [x] Does `jen` expose build status for many branches in one call? **Now the
      wave's opening spike** rather than a question — it decides whether
      Done-when 5 is free or needs a cache, so it is measured first.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
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
