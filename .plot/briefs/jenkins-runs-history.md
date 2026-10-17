## Implementation brief — the-agent-s-ci-wait-never (wave: Bitbucket and GitHub readings)

- **Plan (canonical):** docs/plans/2026-10-16-the-agent-s-ci-wait-never.md on main
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1868 merged
- **Branch:** `bug/jenkins-runs-history` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per plan `Review: pr`

This branch names no `waits:` annotation and no branch waits on it — it is independent of the rest of the plan's slices and can land in any order relative to them.

### What to build

Gap 9 (low priority, listed in the plan's Motivation and Design §5): `plot-host.sh`'s `runs` op, Jenkins arm (`plot-host.sh:4458-4488`), currently reports exactly one entry per branch — the *current* state from `jenkins_build_map`, with `startedAt` and `url` hard-coded to `""` — because that map holds no history and no timestamps. The comment at `:4459-4472` is explicit about why: "a history is what Jenkins holds and what its REST API answers; reading it is `the-ci-connector-is-jenkins`'s own slice." This slice is that read: make the Jenkins arm of `runs` return actual build history — several entries, newest first, each carrying its own `startedAt` and `url` — instead of a one-entry stand-in with two always-empty fields.

### The decision this plan already settles — do not re-derive it

**Reuse `jenkins_sha_runs`'s REST call; do not build a second one.** `jenkins_sha_runs` (`plot-host.sh:1707-1745`), shared today by `run-for-sha`/`runs-for-sha`, already fetches exactly the shape `runs` needs in one round trip:

```
tree=builds%5Bnumber,result,building,timestamp,url,actions%5BlastBuiltRevision%5BSHA1%5D%5D%5D%7B0,$limit%7D
```

and maps each build to `{sha, status, conclusion, url, startedAt, workflow}` — `startedAt` from `.timestamp/1000 | todate`, `url` from `.url`, `workflow` from the job path. The only difference is that it then filters `select(.sha == $sha)` for the sha-scoped callers. `runs` wants the same builds unfiltered (branch-scoped, not sha-scoped) — so either:

- factor `jenkins_sha_runs`'s fetch-and-map into a shared helper that an unfiltered caller and the sha-filtered caller both use, or
- extend `jenkins_sha_runs` (or a sibling using its credential/fetch logic) with a mode that skips the `select`.

What this plan forecloses is inventing a *third* Jenkins HTTP call for build history — one already exists, tested, and handles the credential lookup (`jenkins_rest_credential`), the job-path resolution (`jenkins_job_url_path`, tried against the branch path then the bare job path), and the rate-limit bookkeeping (`host_slot_take`/`host_slot_give`/`budget_record_call`). Re-deriving those from scratch in the `runs` arm would duplicate all of that for no new capability.

**Conclusion mapping stays host-neutral, same as the tracer slice.** `jenkins_sha_runs` maps `conclusion` straight from Jenkins' `.result` (`SUCCESS`/`FAILURE`/etc., or `null` while building) — it does not lowercase or alias it. `runs`'s Jenkins arm today instead derives `conclusion` from `jenkins_build_map`'s already-settled `checks` word. Decide explicitly which convention `runs`'s Jenkins history adopts and say so in the PR — the GitHub arm of `runs` (`:4452-4456`) emits `.conclusion` (or `.status` when conclusion is empty) verbatim from `gh run list --json`, uninterpreted. Matching that arm's convention (raw host value, uninterpreted) keeps `runs` consistent with its own GitHub sibling; this is a judgment call the plan leaves open (it is not one of the plan's three Open Questions, which are about gaps 2/3/7, not gap 9) — pick one, and do not block the PR on it.

**`runs` is branch-scoped, not sha-scoped — keep that distinction.** The plan's own comment block at `:4506-4511` explains why `run-for-sha`/`runs-for-sha` exist separately from `runs`: a branch pushed twice in quick succession can have an older sha's run finish after a newer sha's run started, so reading the newest run off a branch listing can answer about superseded code. `runs` is documented (`:4404-4421`) as FACTS, NEVER A VERDICT — history for a human to read, no sha pinning, no conclusion-drawing. Do not make this slice silently sha-filter `runs`'s output; that would change its contract and collide with what `run-for-sha` already exists to answer safely.

**Empty fields must stay empty when genuinely unknown, never guessed.** The existing comment (`:4468-4472`) states the rule the plan was already following: a field this arm cannot measure is left `""`, not invented. If Jenkins' REST payload is missing `timestamp` or `url` for some build (unlikely but not impossible — e.g., a build still queued), preserve that honesty rather than defaulting to the current wall-clock time or an empty-string URL dressed up as a real one.

### Done when

The plan's `## Done when` list does not exist as a literal heading in this plan (it uses `## Slices` + `## Notes` instead) — treat the Slices entry for this branch as the spec: *"the `runs` op returns builds with timestamps and URLs (gap 9)."* Concretely:

- `plot-host.sh runs <branch>` under `CI: jenkins` returns more than one entry when Jenkins has more than one recent build for that branch (today it always returns exactly one, or none).
- Each returned entry's `startedAt` and `url` are populated from Jenkins' REST answer, not left as `""` placeholders — unless Jenkins itself did not report them for that build, in which case `""` is still correct and should not be special-cased away.
- `workflow` continues to name the job path, matching the shape `run-for-sha`/`runs-for-sha` already emit, and matching what `index-findings.ts`/`checks-verdict.ts` on the TypeScript side expect from this op if anything there reads `runs` (search before assuming — the plan's own Notes section models exactly this kind of check: "Deliverable search for `jenkinsConclusion`: it exists at `build-jenkins.ts:22` and is applied at `:116` only.").
- A test exists covering `runs`'s Jenkins arm against a multi-build fixture (the existing worker-loop tests from the tracer slice, `bug/jenkins-run-for-sha-conclusion`, are the nearest precedent for how Jenkins REST responses are fixtured in this repo's test suite — look there first rather than inventing a new fixture shape).
- The op's existing contract is unchanged for everything this slice does not touch: `run-for-sha`/`runs-for-sha` still filter by sha and still share `jenkins_sha_runs`; the GitHub arm of `runs` is untouched; exit codes (`3` = no instance, `4` = cannot be asked / unreachable) are preserved.

Plus the repo's standing gates: build artifacts stay in sync if anything under `packages/board` reads this op's shape (check before assuming it does — the plan's own board-impact note says none of its slices move the board's `checks`/`checksSha` contract except slice 3, `bug/jenkins-pr-checks-bind-to-head`, which this branch does not touch). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — the tests that name a changed file, related tests and typecheck for a changed package, and the gate tests and `scripts/check-*.sh`. The suites in the `CI suites` config key run in CI on every pull request; do not run them locally as a matter of course.

Name the shell gate in the PR: `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This branch touches `plot-host.sh`, a `.sh` file — if the net line count grows, pay for it in the same change (remove shell elsewhere, or move logic into the domain and ask it through a bundle). The gate stores no number and grants no exemption.

### Bookkeeping

Open the PR through the controller once real work exists:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Do not run `gh pr create` — it takes its title from the last commit subject rather than the plan's wave heading, which has broken PR titles on this estate before.

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section (`docs/plans/2026-10-16-the-agent-s-ci-wait-never.md`, under `### Bitbucket and GitHub readings`), and push the first real commit as soon as it exists so the branch is visible to the fleet immediately rather than sitting unpushed.

### Scope guard

This branch owns: `skills/plot/scripts/plot-host.sh`'s `runs` op (Jenkins arm, `:4458-4488`) and, if factored out, a shared helper near `jenkins_sha_runs` (`:1707-1745`). It owns no test files outside whatever covers this op.

Other branches in this plan, verified against the plan's `## Slices` section at dispatch time:

- `bug/jenkins-run-for-sha-conclusion` → #1895 (Started 2026-10-16) — touches `buildJenkins.runForSha` / `build-jenkins.ts`, not `plot-host.sh`'s `runs` op. No file overlap expected.
- `bug/jenkins-credential-from-env` → #1936 (Started 2026-10-17) — touches `jenkins_rest_credential` in `plot-host.sh`. This branch's helper (if factored) calls `jenkins_rest_credential` but should not need to edit it — a function-boundary overlap, not a line overlap, but worth diffing against before merge if both are still open.
- `bug/jenkins-pr-checks-bind-to-head` → #1959 (Started 2026-10-17) — touches `plot-host.sh` (PR row checks, plain-pipeline sha reads, `aborted`/`notbuilt` mapping) and names `bug/jenkins-default-branch-workflow` as a `waits:` dependency. Also edits `plot-host.sh`; check its diff before merging this branch to avoid a silent collision in the same file.
- `feature/bitbucket-pr-state-binds-checks` (not yet started) — waits on `bug/jenkins-pr-checks-bind-to-head`; touches Bitbucket's `pr-state`/`pr-review` arms, not the `runs` op.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
