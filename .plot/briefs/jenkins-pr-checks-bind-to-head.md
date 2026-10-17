## Implementation brief — the-agent-s-ci-wait-never (wave 3: Commit binding)

- **Plan (canonical):** docs/plans/2026-10-16-the-agent-s-ci-wait-never.md on main
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1868 merged
- **Branch:** `bug/jenkins-pr-checks-bind-to-head` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review app, required since 2026-10-15)

This branch waits on `bug/jenkins-default-branch-workflow` (#1937, gap 5 —
emits `workflow` as the job path). Merge that one first: `jenkins_sha_runs`
is where this slice reads plain-pipeline builds by sha, and #1937 is what
gives that path a `workflow` field to match against. `feature/bitbucket-pr-state-binds-checks`
waits on this branch in turn — it needs a head-bound check word to extend
to Bitbucket.

### What to build

Gaps 3, 4 and 10 from issue #1867, all one cause: `jenkins_build_map`
(`skills/plot/scripts/plot-host.sh:1457`) answers **one colour per branch
name**, with no commit at all. Between a push and the start of the new
Jenkins build, a PR's row keeps the *old* build's colour for the *new*
head — and the row has nothing recording which commit that colour was
even measured against. Concretely, in the `pr-list` Jenkins overlay at
`plot-host.sh:4199-4238`: the comment there already states the current
rule — "The Jenkins colours are per branch and carry no commit... so
neither emits `checksSha`" — and that is gap 3. `pr-state`'s GraphQL path
(`plot-host.sh:3591`) has the same shape question for its own Jenkins arm.

Gap 4: `jenkins_sha_runs` (`plot-host.sh:1709` onward) already has a
plain-pipeline fallback that reads by head sha (`:1711` — the comment
dates it as "has always worked" from before the shape probe existed).
Gap 4 is wiring the PR-row path to prefer that sha-bound read over the
branch-colour map wherever a sha is available, rather than widening the
branch-colour map itself — the map's shape has no sha field to add.

Gap 10: `jenkinsConclusion` (`packages/domain/src/adapters/build/build-jenkins.ts:22-36`)
already maps `ABORTED` → `cancelled` and `NOT_BUILT` → `unknown` for the
sha-run path (`runForSha`, `runsForSha`). The PR-row path's own colour
table in `jenkins_build_map`'s `color_to_checks` (`plot-host.sh:1517-1523`,
repeated at `:1570-1577`) has no equivalent for a Jenkins build that was
aborted or never built — a shell `jq` table, not the domain function, so
gap 10 is adding `aborted`/`not_built` colour cases there (or wherever the
sha-bound read replaces it) rather than calling `jenkinsConclusion` across
the shell/domain boundary.

### The decisions the plan settles — do not re-derive them

**`pending` vs `unknown` for a colour that cannot bind to the head is an
open question the plan leaves open** (plan's Open Questions, item 2:
*"when a colour cannot bind to the head, is `pending` or `unknown` the
right word? `pending` holds a merge queue; `unknown` does not."*). Do not
pick silently — if the sha-bound read answers directly, this question may
not even arise; if it does, surface the choice rather than guessing.

**The branch-colour map (`jenkins_build_map`) is not the thing to extend.**
It was built for exactly one purpose — a `runs`-op fallback with "no
timestamps, no URL and no earlier runs" (comment at `plot-host.sh:4459`) —
and its own comment says reading real history is a *different* slice's
job ("inventing entries here to fill the shape would be the collector
reaching a verdict"). The sha-bound read already exists in
`jenkins_sha_runs`'s plain-job fallback; gap 4 is routing PR rows to it,
not teaching the branch map to carry a sha it was never shaped to hold.

**This is an adapter-edge fix, not a domain change.** `merge.ts:103-104`
(`checks-unbound`) and `index-findings.ts:70-77` already consume
`checksSha` generically — they compare it against `headSha` and format a
message, with zero Jenkins-specific logic. Confirmed by reading both: the
domain already does the right thing with a `checksSha` field once one
arrives. Every other GitHub arm already emits `checksSha` (`plot-host.sh:4199`,
`:4254` for Bitbucket's own `headRefOid`, `:3591`). The only places needing
a change are inside `plot-host.sh`'s Jenkins arms. Per `CLAUDE.md`'s
layering rule and this plan's Design/Approach: "Each slice moves one
mapping to the adapter edge... and adds a test at the port."

**`aborted`/`notbuilt` belong in the shell colour table, not a shared
call into `jenkinsConclusion`.** The sha-run path and the PR-row path are
different transports reading different Jenkins endpoints (`job list
--json` colours vs. the REST `actions[].lastBuiltRevision.SHA1` history),
so there is no single function both already call — adding one would be
inventing a shared abstraction neither existing path uses. Map the colour
or result word to the same `checksFromRuns`-facing vocabulary
(`cancelled`/`unknown`) at whichever shell layer actually reads it.

### Done when

The plan's `## Done when` is the specification (see plan file; this plan
states its criteria per-slice rather than in one global list — read the
Design/Approach numbered steps 3 for this slice's scope: "bind every
Jenkins reading to a commit... A declared `Default branch checks` name
that matches no run is reported" covers gap 5's sibling branch, not this
one — this slice's own scope is "the Jenkins arm emits `workflow` as the
job path; open PR rows emit `checksSha` and read `pending` or `unknown`
where the colour cannot bind to `headSha`... `aborted` maps to `unknown`
as the run-level mapping does").

Concretely, that means:
- A PR row from `pr-list` (and `pr-state`, where it has its own Jenkins
  arm) under `CI: jenkins` carries a `checksSha`, and it equals the
  commit the reported colour/word was actually measured against — never
  the previous head.
- A push that supersedes a build in flight shows the *new* head as
  unresolved (`pending` or `unknown` — settle which, per the open
  question above) rather than carrying over the old head's colour.
- A Jenkins build that was aborted or never built reads as `cancelled`/
  `unknown` on the PR-row path, matching what the sha-run path already
  does for the same Jenkins result words.
- A worker-loop or host-contract test exercises this with an aborted and
  a not-built fixture, the way the tracer slice (#1895) did for
  success/failure — "a finding this change needs because a naive
  implementation would pass without it" catches a fix that maps the
  happy path but leaves `ABORTED`/`NOT_BUILT` to fall through to the
  table's `else` branch unchanged.

Plus: this touches `plot-host.sh`, a shell file under `skills/`, so
`scripts/check-shell-lines.sh` applies — growth there is paid for in the
same change (remove shell elsewhere, or push logic into the domain and
call it through a bundle). Board impact: per the plan's `<!-- Board
impact -->` note, slice 3 (this one) changes the `checks` and `checksSha`
fields `pr-list`/`pr-state` emit, which `checks-reading.ts` renders —
rebuild the board artifact if that contract moves, and see `CLAUDE.md`'s
"On a conflict in `board-server.mjs`" section if a merge produces one.

For tests, run `node ../plot/scripts/board/plot-local-checks.mjs` before
each push and run what it prints — the tests that name a changed file,
related tests and typecheck of a changed package, and the gate tests and
`scripts/check-*.sh`. The suites in the `CI suites` config key (`pnpm run
test:e2e`, `test:contracts`, `test:board`, domain coverage, reconcile
tests) run in CI on every pull request; do not run the full suites
locally as a matter of course — a failure there comes back as a
correction.

### Bookkeeping

Open the PR through the controller once there is a real commit:
`../plot/scripts/plot-open-pr.sh` (or `--draft` while still moving).
**Do not run `gh pr create`.** When the PR exists, append `→ #<number>`
to this branch's line in the plan's `## Slices` section (the "Commit
binding" heading), and set it to "Ready" on any configured project board.
Push the first real commit as soon as it exists — this branch sits in a
3-branch wave and `feature/bitbucket-pr-state-binds-checks` is watching
for it to merge.

### Scope guard

This branch owns the Jenkins PR-row check-binding path: `jenkins_build_map`,
the `pr-list`/`pr-state` Jenkins overlays in `plot-host.sh`, and the
colour-to-`checks` table used there. It does not own `jenkins_sha_runs`
itself (landed by the tracer and gap-5 branches) or the Bitbucket check
sources (next wave, `feature/bitbucket-pr-state-binds-checks`).

In flight alongside this one: `bug/jenkins-credential-from-env` (#1936,
merged per the plan's `Started:` record) and `bug/jenkins-default-branch-workflow`
(#1937, Started 2026-10-17, this branch's dependency — both touch
`plot-host.sh`'s Jenkins functions, so rebase onto `main` after that one
merges rather than guessing at the conflict). `bug/jenkins-runs-history`
(gap 9, next wave) touches the `runs` op's Jenkins arm (`plot-host.sh:4459`)
but not the PR-row path this branch owns — low collision risk, verify
before merging if both are open at once.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
