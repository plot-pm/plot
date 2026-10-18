## Implementation brief — the-agent-s-ci-wait-never (wave 4: Bitbucket and GitHub readings)

- **Plan (canonical):** docs/plans/2026-10-16-the-agent-s-ci-wait-never.md on main
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1868 merged
- **Branch:** `feature/bitbucket-pr-state-binds-checks` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review app, required since 2026-10-15)

This branch waited on `bug/jenkins-pr-checks-bind-to-head` (#1959), merged
2026-10-17. `bug/jenkins-runs-history` is the sibling branch of this wave
(gap 9, the `runs` op's Jenkins history) — it touches `plot-host.sh:4459`
onward, not the paths this branch owns, so collision risk is low, but
verify before merging if both are open at once.

### What to build

Gaps 2, 6 and 8 from issue #1867: give Bitbucket's `pr-state` and
`pr-review` ops the same head-bound check word GitHub's arms already
return, and make `pr-state` follow `pr-list`'s check source under
`CI: jenkins`.

Concretely, in `skills/plot/scripts/plot-host.sh`:

- **`pr-state`'s Bitbucket arm** (`:3599-3665`) emits
  `number,state,draft,url,mergeCommit,base` and nothing about checks —
  no `headSha`, no `checks`, no `checksSha`. The GitHub arm's rollup path
  emits all three (`:3585`: `headSha:(.headRefOid // "")`,
  `checksSha:(.headRefOid // "")`). Add `headSha` from
  `.source.commit.hash` (the same field `pr-list`'s Bitbucket arm already
  reads at `:4283` and `:4379`) to both the by-number and by-branch
  paths, and add `checks`/`checksSha` per the `CI: jenkins` branch below.
- **`pr-state` follows `pr-list`'s source under `CI: jenkins`.** `pr-list`'s
  Bitbucket+Jenkins overlay (`:4360-4382`) already joins Bitbucket PR rows
  against `$jmap`, the branch-colour map — unbound to a commit, the exact
  gap #1959 just closed for the GitHub+Jenkins `pr-list` arm (`:4208-4214`,
  calling `board/plot-jenkins-pr-checks.mjs rows`/`bind` against
  `jenkins_sha_runs`). `pr-state` for a single PR needs the same binding:
  read the branch's Jenkins colour, and where it is `green` or `failing`
  (ambiguous without a commit), call `jenkins_sha_runs` for that one head
  sha and bind through the same `plot-jenkins-pr-checks.mjs bind` path.
  A `none`/`pending` colour needs no sha lookup — `jenkins-pr-checks.ts`'s
  own doc comment says so (`rules/jenkins-pr-checks.ts:44-45`).
- **`pr-review`'s Bitbucket arm is an outright refusal today**
  (`:3862`: `[ "$be" = "github" ] || { echo "... bitbucket is not supported
  yet" >&2; exit 4; }`). Build it: read the `plot/review` build status
  from Bitbucket's commit-status endpoint,
  `GET /2.0/repositories/{workspace}/{repo_slug}/commit/{sha}/statuses`
  — the same endpoint the plan's Design/Approach step 4 names for
  `pr-state`'s own check read — and fold it into the same
  `{sha,state,bypass}` shape the GitHub arm returns. `bypass` reads PR
  comments for a `review-bypass:` prefix exactly as the GitHub arm does
  (`:3864`).

### The decisions the plan settles — do not re-derive them

**This is an adapter-edge fix, extending a binding that already exists —
not a new mechanism.** `packages/domain/src/rules/jenkins-pr-checks.ts`
(`rowsToBind`, `bindChecks`) and its shipped bundle
`skills/plot/scripts/board/plot-jenkins-pr-checks.mjs` already solve
"a branch colour carries no commit" for GitHub's PR rows (#1959). Do not
write a second version of this logic for Bitbucket — call the same
bundle. `bindChecks` takes `job` and `sha` as plain arguments; nothing in
either function or the bundle's CLI contract is GitHub-specific. Confirm
this by reading `jenkins-pr-checks.ts` before writing code: the `rows`
and `bind` subcommands the GitHub `pr-list` arm pipes through at
`:4213-4217` are the exact two calls this slice's `pr-state` and
`pr-list` arms need too.

**`pending` vs `unknown` is already settled, by #1959, not by this
slice.** The plan's Open Question 2 asked which word a colour that
cannot bind to the head should read as. `bindChecks` answers: a head with
no matching build is `pending` (`rules/jenkins-pr-checks.ts:96`,
`:80-81`: "An answer with no build of the commit is `pending`: the head
has not been built yet"). `ABORTED`/`NOT_BUILT` are `unknown` (`:78`,
`:102`). Follow that, uniformly — do not pick a different word for the
Bitbucket arm now that the GitHub arm has already decided it.

**`jenkins_build_map`/`$jmap` is still not the thing to extend** — the
rule carried over from the previous wave's brief
(`.plot/briefs/jenkins-pr-checks-bind-to-head.md`) applies here exactly as
it did there. It was built for the `runs`-op fallback
(`plot-host.sh:4459`'s comment: "no timestamps, no URL and no earlier
runs") and carries no sha field to bind. The sha-bound read is
`jenkins_sha_runs`'s plain-job fallback (`:1711` onward); route Bitbucket's
`pr-state` to it exactly as the GitHub `pr-list` arm now does, rather than
widening the branch-colour map.

**Bitbucket's own check source is absent, not false, and stays that
way where Jenkins is not configured.** `pr-list`'s plain Bitbucket arm
(`:4287-4295`) documents this: "Bitbucket carries no check rollup through
`bb pr list`... Rather than guess, --rich reports checks:"unknown"...
An honest gap beats an invented answer." `pr-state`'s new `checks` field
follows the same rule: `unknown` when `CI: jenkins` is not set, never a
guess from PR state or mergeability.

**Use the fields `pr-list`'s Bitbucket arm already reads — don't re-ask
Bitbucket for data already in hand.** `headSha` comes from
`.source.commit.hash`, already read by the by-number path's existing `bb
pr view --json` call; no second `bb` call is needed to add it. `bb`
calls are expensive — measured 2026-08-18 at ~10 s each
(`plot-host.sh:3626-3631`'s comment) — so this slice must not introduce a
new one where the existing payload already carries the field.

### Done when

The plan's `## Done when` criteria are stated per-slice in the
Design/Approach section rather than as one global list; this slice's
scope is step 4: "The Bitbucket arms of `pr-state` return `headSha`,
`checks` and `checksSha`, read from the Jenkins build for
`source.commit.hash` or from Bitbucket commit build statuses... `pr-review`
reads the `plot/review` status from the same endpoint. Under `CI:
jenkins`, `pr-state` uses the same check source as `pr-list`."

Concretely, that means:
- `pr-state` on a Bitbucket repository with `CI: jenkins` returns
  `headSha`, `checks` and `checksSha` for both the by-number and
  by-branch paths, bound to the commit the colour was measured against —
  never the previous head's colour, matching gap 3/4's fix for
  `pr-list`.
- `pr-state` on a Bitbucket repository with no `CI: jenkins` returns
  `headSha` (cheap, already in hand) and `checks: "unknown"` —
  `checksSha` absent or `""`, per the "absent is not false" rule above.
- `pr-review` on Bitbucket no longer exits 4. It returns
  `{sha, state, bypass}` reading the `plot/review` context from the
  commit-status endpoint, with `bypass` read from PR comments the same
  way the GitHub arm does.
- A host-contract test (alongside `test/reconcile/host.test.mjs`'s
  existing Jenkins coverage, added by #1959) exercises `pr-state` with a
  Bitbucket+Jenkins fixture whose branch colour is ambiguous
  (`green`/`failing`) and a head sha with no matching build — the case
  that would read stale without the binding. This is the assertion a
  naive implementation (joining `$jmap` directly, as `pr-list`'s Bitbucket
  arm still does today) would pass without.

Plus: this touches `plot-host.sh`, so `scripts/check-shell-lines.sh`
applies — a growth there must be paid for in the same change (remove
shell elsewhere, or push logic into the domain and call it through a
bundle, as calling the existing `plot-jenkins-pr-checks.mjs` bundle
already does for free). Board impact: per the plan's `<!-- Board impact
-->` note, this slice changes the `checks`/`checksSha` fields `pr-state`
emits for Bitbucket — the same fields slice 3 already changed for
GitHub/`pr-list` — so rebuild the board artifact if `checks-reading.ts`'s
contract moves. See `CLAUDE.md`'s "On a conflict in `board-server.mjs`"
section if a merge produces one.

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
to this branch's line in the plan's `## Slices` section (the "Bitbucket
and GitHub readings" heading), and set it to "Ready" on any configured
project board. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `pr-state`'s and `pr-review`'s Bitbucket arms in
`plot-host.sh`, and the `CI: jenkins` source-selection logic inside
`pr-state`. It does not own `jenkins_sha_runs`, `jenkins_build_map`, or
the `pr-list` Jenkins overlays (landed by earlier waves of this plan) —
those are read from, not modified, except where `pr-list`'s own
unbound-`$jmap` gap in the Bitbucket+Jenkins overlay (`:4360-4382`) is
cheap to close alongside this slice's `pr-state` fix using the identical
binding call; if that turns out not to be cheap, leave `pr-list` as is
and report the gap rather than expanding scope. `bug/jenkins-runs-history`
(gap 9, this wave's sibling branch) owns the `runs` op's Jenkins arm
(`:4459` onward) and is out of scope here.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
