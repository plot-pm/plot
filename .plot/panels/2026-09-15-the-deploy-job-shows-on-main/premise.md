# Premise lens — the-deploy-job-shows-on-main

Lens: establish whether the thing this plan says is broken is actually broken.
Everything below was read on `main` at `a868ec7e8`, 2026-09-15.

## 1. Is every factual claim TRUE on main right now?

### TRUE — the two `plot-host.sh` citations

- `plot-host.sh:539` carries the quoted sentence verbatim. The block at `:537-540` reads: *"A repo may declare `CI: jenkins` independently of `Git host`. When it does, build status (`checks`) is resolved through `jen` — a multibranch job's branches in one call, joined locally to the PR list the host provides."* Quote accurate, line number accurate.
- `plot-host.sh:3760` carries `{"connector":"jenkins","bucket":"","limit":60,...,"basis":"predicted"}`. `limit: 60` accurate, line number accurate. The neighbouring comment at `:3752-3756` independently confirms the plan's framing — Jenkins reports no rate limit, so 60 is an estimate.

### TRUE — this repository declares `CI: github-actions`

`CLAUDE.md:50`. The plan's statement that the end-to-end path cannot be verified here is correct.

### FALSE — the `BuildRun` claim, and it is the plan's load-bearing one

The plan (`Design`, "The entity already distinguishes them") states:

> `BuildRun` (`entities/build.ts`) carries a **`pipeline`** field beside `head`, `state`, `startedAt`, `durationMs` and `url`. So a run already says which pipeline produced it, and two runs on one branch are expressible today without a schema change.

`BuildRun` is `entities/build.ts:113-124`. Its four fields are:

```
workflow: string      // :115
conclusion: string    // :117
startedAt: string     // :121
url: string           // :123
```

**There is no `pipeline` field, no `head`, no `state` and no `durationMs` on `BuildRun`.**

The six fields the plan lists belong to a *different* interface — `Build`, at `entities/build.ts:51-64`, which does carry `url`, `pipeline`, `head`, `state`, `startedAt`, `durationMs`. So the plan named the right field set and attached it to the wrong type.

This is not a pedantic mismatch, because **`Build` is not the type on the path**. The port returns `BuildRun`:

- `ports/build.ts:76` — `runs(branch, limit?): Promise<PortResult<readonly BuildRun[]>>`
- `adapters/build/build-jenkins.ts:56` — same signature
- `fleet.ts:2145` — `ci.runs(branch, RUN_HISTORY_LIMIT)`, and `:2158-2163` copies the answer into `StuckRun` as exactly `workflow, conclusion, startedAt, url`

The entity docstring at `:96-102` states the split explicitly and says why: *"A SECOND SHAPE beside `Build`, and the difference is what the CI system answers rather than a preference."*

So the plan's sentence **"What is missing is a second thing to ask, not somewhere to put the answer"** is the reverse of what main holds. `workflow` is the nearest field, and it is the CI system's own free-text word for the run, not a pipeline identity Plot assigns — `:114` says *"`''` where the CI system did not name it"*. Whether `workflow` can carry the CI/CD distinction is a real question the plan never asks, because it believed a `pipeline` field already answered it.

**This reproduces the sibling plan's error class exactly**: the sibling located `buildShell` by its filename instead of reading it; this one located `pipeline` on `BuildRun` by reading the neighbouring interface in the same file.

### UNVERIFIABLE AS STATED — "nothing in that file carries a notion of a second job"

The claim is that `plot-host.sh` has no notion of a second job. What the file actually holds is a notion of **one job path, carried on the `Jenkins instance` key**:

- `plot-host.sh:702-708` — *"$1 = Jenkins instance value from config: `<slug>` or `<slug>/<job/path>`. The slug is what `jen -I` takes; the remainder (after the first `/`) is the multibranch job's container path."*
- `:725-735` — resolution: `PLOT_JENKINS_JOB` env override, else the part after the first `/`, else `""` (root scope).
- `:3101-3108` — `run-for-sha` repeats the same resolution and **exits with a named refusal** when the instance names no job path.

So the literal claim is true in the sense that there is one job and not two. But the plan presents this as *"a new optional config key"* being the shape of the fix, and never notices that the existing job is **not** declared by a dedicated key — it is a suffix on `Jenkins instance`, with an env override, resolved in two independent places (`:725` and `:3101`). A second job added as a standalone key would sit asymmetrically beside the first, and `docs/plans/2026-08-18-plot-board-setup.md:117` already records this as an open design question: *"Should `CI` + `Jenkins instance` generalise to `CI` + `CI instance`"*. The plan does not engage with it.

### FALSE IN ITS IMPLICATION — "render its state on that branch's row"

The slice line (`:84`) says: *"render its state on that branch's row beside the CI state"*, and `Done when` requires *"the state lands on the default branch's row and on no other"*.

**There is no default-branch row, and no non-PR carrier for a check state.**

- `checks` is a field on the `Pr` entity — `entities/pr.ts:67`. Grepping `packages/domain/src/entities/` for `checks` returns hits in `pr.ts` only.
- The Jenkins overlay that produces `checks` runs inside the `pr-list --rich` arm — `plot-host.sh:2705-2720`, guarded by `[ "$ci" = "jenkins" ] && [ "$rich" = 1 ]`. It overlays **rows the PR listing produced**. `main` has no PR, so it has no row in that payload.
- The `runs` path is gated even harder. `fleet.ts:2112` — `const candidates = [...prs.entries()].filter(([, pr]) => pr.checks === 'failing')`. A branch is asked about only if it has a PR **and** that PR's checks are already failing, then filtered by `branchIsWatched` (`:2081-2099`) and capped at `RUN_FETCH_MAX = 8` (`:2032`).

So the destination the plan names — a default-branch row carrying a build state — does not exist on main. The plan describes the work as *"one extra reading on the default branch's row"* (`:18-19`, Board impact) and treats the row as given. Creating it is a board change of unstated size, and the plan's own Board-impact note explicitly disclaims one: *"a new optional config key and one extra reading… No plan format, no template."*

### NOT CHECKABLE HERE — the colour table and URL-encoding claims

`plot-host.sh:541-553` carries the colour table and it maps as the plan says (`blue`→green, `yellow`→failing deliberately, `*_anime`→pending). Note `:571-573` and `:775-780`: the mapping to the board's four words is `blue → green`, not `blue → passing`; the script's own comment explains that `passing` would render as *unknown*. The plan quotes the prose table rather than the effective one. Harmless for this plan's scope, but it is a second instance of quoting a comment rather than the code under it.

The *"27 of 45 names in a production job"* URL-encoding figure appears at `:720-721` as a recorded measurement. I cannot re-measure it — **it requires a live Jenkins instance**, and I am stating that rather than inferring it.

## 2. Is the declared dependency real, and does the rejection invalidate this plan?

**The dependency as stated is false, and the rejection's own correction says so.**

The plan's Notes (`:99-102`) read: *"Until `buildPortFor` reaches `buildFor`, no Jenkins reading arrives at the board at all."*

That is the rejected plan's premise, restated. It was disproved:

- `board.ts:232` — `buildPortFor` returns `opts.buildAdapter ?? buildShell({...})`.
- `build-resolve.ts:54-65` — `buildShell` reads the `CI` key through `plot-config.sh` and **returns `buildFor(said.stdout, context)`**.
- `build-resolve.ts:41-42` — `case 'jenkins': return buildJenkins(context)`.

`buildPortFor` already reaches `buildFor`, one hop through `buildShell`. So the stated blocker does not exist, and this plan's Notes carry forward the exact sentence the sibling was rejected for.

**But the conclusion the dependency was reaching for is partly right, for a different reason.** A Jenkins reading does reach the board — through `refreshRuns`/`ci.runs` — but only for a branch with a PR whose checks are already `failing`. For the default branch there is genuinely no path. The plan has the right intuition and the wrong mechanism, and it inherited the wrong mechanism from a rejected plan without re-checking it.

Partly invalidating, not wholly: removing the false dependency does not rescue the plan, because §1's entity error and the missing row are independent defects.

## 3. Is the problem real, and is this the right shape?

**The problem is real.** The operator's report is quoted directly (`:104-106`) and is a coherent statement about their own setup: CI multibranch, CD on main/develop. Plot models one Jenkins job — confirmed at `plot-host.sh:702-735` — so a separate CD job is invisible. Nothing I read contradicts the operator.

**The shape is wrong in three respects.**

1. **It fixes the wrong end.** The plan spends its Design on cost (+1 call per refresh) and on declared-vs-inferred config. Both are real considerations, and neither is the obstacle. The obstacle is that the default branch has no row and `checks` has no non-PR carrier. The plan's cost argument is sound reasoning about a call that has nowhere to deliver its answer.

2. **The prior unexplained failure is still open and is not excluded.** The sibling plan's rejection states: *"The operator's report is unexplained and still open. Jenkins builds genuinely do not appear on their board; the cause is not this."* It names the cheapest next reading — `plot-config.sh get CI ''` in the repository whose board is blank, since an empty answer sends `buildFor` to `buildNone`. **That reading has not been taken.** Building a second job on top of a first job that may not be resolving is a plan whose success is unobservable. This is the single most important missing step.

3. **"Two is the shape a team has" is asserted, not measured.** The plan rules out N jobs (`:72-75`) on the grounds that two is what teams have. One operator reported one two-job setup. The existing job already travels as a path suffix with an env override — a structure that reached two forms without a plan. The N-job refusal may well be right; it is not evidenced here.

## 4. What does `Done when` fail to pin?

The gates are: no-deploy-job behaves byte-identically (test); asked exactly once per refresh regardless of branch count (call count); lands on the default branch's row and no other; a declared-but-absent job reports not-found; CI colour mapping unchanged; `test:contracts` and board suite pass.

**An implementation can satisfy all six and ship nothing a user sees.** Concretely: add the config key, add a `deployRuns()` call to the build port, call it once per refresh in `refreshPrs`, store the answer on the cache entry, and render it nowhere — because no default-branch row exists to render it on. Every gate passes. "Byte-identical without the key" passes trivially. "Once per refresh" passes. "Lands on the default branch's row **and on no other**" is satisfied vacuously by landing on no row at all — the gate is phrased as an exclusion, so zero rows satisfies it. Both suites pass. The one thing the operator asked for is absent.

Four further gaps:

- **No gate that the value is rendered.** The estate's own rule is that a view state is a domain property with a test asserting the badge shows it (CLAUDE.md, *Every rendered state is a domain property*). No `Done when` entry names a rendered element.
- **"Byte-identically" is unpinned as a measurement.** Of what — the `/api/board` payload, the call sequence, the DOM? A repository with no deploy key currently has no deploy field at all; adding an optional field changes the payload, so a literal byte comparison fails while the intended property holds.
- **"Reports that it was not found rather than rendering nothing"** — reports *where*? The port has `lastRefusal()` (`ports/build.ts:140`), which is session-scoped and read immediately after the call. If the answer is `lastRefusal`, nothing says which surface displays it.
- **No gate on the second resolution site.** `run-for-sha` resolves the job independently at `plot-host.sh:3101-3108`. A deploy job added to the `pr-list` arm alone leaves the two arms disagreeing about which jobs exist, and no gate would catch it.

## 5. The single strongest argument against doing this at all

**The measurement that would tell us whether the operator's board is blank for this reason has not been taken, and it costs one command.**

The sibling plan was approved and rejected within a day on the same subject, and its rejection ends by naming that exact reading as the next step: `plot-config.sh get CI ''` in the operator's repository. Nobody ran it. This plan was then written on top of the rejected one, restating its disproved sentence as a dependency.

If that repository answers empty, `buildFor` returns `buildNone` (`build-resolve.ts:43-44`), which answers `unaskable` on every operation, and **no job is fetched — first or second**. A deploy job added on top would be equally invisible, and the plan would be implemented, merged, and reported as not working, for the third time on one subject in one week.

Two readings, both cheap, both unblocking, neither requiring a plan: run `plot-config.sh get CI ''` and `plot-config.sh get 'Jenkins instance' ''` in the operator's repository. If `CI` is set and the instance resolves, the first job works and the second-job gap is confirmed as the real remaining cause — at which point a plan can be written against a destination that has been established to exist. If it is empty, this plan targets nothing.

That is an argument for **sequencing**, not for abandoning the operator's need. The need is real and someone should serve it. This artefact is not yet the thing that serves it.

## What I could not verify, stated plainly

- Whether the operator's repository resolves `CI` and `Jenkins instance` — needs access to that repository.
- Whether the deploy job's state is fetchable via `jen job list` at the CD job's path, and what colour a CD job reports — **needs a live Jenkins instance**. I did not infer it.
- The *"27 of 45 names"* URL-encoding measurement — recorded at `plot-host.sh:720-721`, not independently re-measurable here.

## Addendum — two further readings, verified after the main pass

A parallel sweep surfaced two facts I then re-read myself. Both bear on finding 3 (the missing destination) and both make it stronger. Neither changes the verdict.

**The default branch is an EXCLUSION FILTER in both row populations, and one of them calls a default-branch row a defect.**

- `board.ts:705-707` — `tips.value.filter((tip) => tip.branch !== '' && tip.branch !== defaultBranch)`, applied before any plan card is built.
- `fleet.ts:1243` — `if (!short || short === main) continue;`, and the comment immediately above it at `:1238-1241` explains why `origin/HEAD` is dropped too: left in, *"it renders a row named `HEAD` that no reader can act on."*

So the board's stated position is that a row for the default branch is something to remove. The plan asks for the state to land *"on the default branch's row"* without noticing that both producers filter that branch out by name, and that one of them documents the removal as a fix.

**There is a `build` RowKind and it has no producer.**

- `contract/schema.ts:1289-1291` — `RowKindSchema` lists eight kinds including `'build'`.
- `schema.ts:1275-1280` states the arm was removed: *"`build` and `agent` below no longer have arms in `rowKind` … `build` never rendered outside `mock-fleet.ts`"*.
- Confirmed at the producer: `rowKind` (`fleet.ts:5305-5400`) returns only `release`, `plan`, `branch`, `wave`. There is no `build` arm.

This matters because it is the nearest thing to a precedent, and it is a negative one: the one row kind that could have named a pipeline run was tried, never rendered, and had its arm deleted. A plan proposing to render build state on a row must engage with why that kind has no producer. This one does not mention it.

Taken together, the destination gap is larger than the main pass reported: it is not merely that no default-branch row exists, but that the branch is filtered out deliberately in two places and the row kind that would carry a build result was removed as unused. `Done when` requires the state to land *"on the default branch's row and on no other"* — the row it names has been excluded by name, twice, on purpose.

## Summary

The operator's problem is real and the plan's instinct about it is right. The artefact is not: its central entity claim is false against `entities/build.ts:113-124` (`BuildRun` has no `pipeline` field — that is `Build` at `:51-64`); its declared dependency restates the sentence the sibling plan was rejected for, disproved at `build-resolve.ts:54-65`; the render destination it names does not exist, since `checks` lives only on `Pr` (`entities/pr.ts:67`) and the runs path is gated on a failing PR (`fleet.ts:2112`); and its `Done when` list can be satisfied in full by an implementation that renders nothing. The one reading that would establish whether any of this is the operator's actual cause still has not been taken.

Verdict: reject
