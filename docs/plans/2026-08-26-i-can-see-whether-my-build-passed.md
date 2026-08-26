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

`plot-host.sh` resolves `checks` through `jen` for a multibranch job under
`CI: jenkins`, filling the existing four states.

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
6. `pnpm test`, `pnpm run test:reconcile` green.

## Notes

### Open Points

- [ ] Non-multibranch Jenkins setups: report `none`, or ask for a job-name
      pattern in `## Plot Config`? The second is more capable and more to
      configure.
- [ ] Does `jen` expose a build's status per branch in one call, or is it one
      call per job? Decides whether Done-when 5 is free or needs a cache.
