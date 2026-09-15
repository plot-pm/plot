# Connector lens — the deploy job shows on main

Reading position: this estate's layering rule, the adapter/connector distinction, `ports/host.ts` and `ports/build.ts`, `plot-host.sh` as the one place that talks to a host CLI, and the rate-limit contract that belongs to the connector kind.

## 1. Are the plan's factual claims true on main?

**VERIFIED TRUE.**

- `plot-host.sh:539` quoted verbatim. The line reads *"build status (`checks`) is resolved through `jen` — a multibranch job's branches in one call, joined locally to the PR list the host provides."* Exact match, including the wording the plan quotes.
- `plot-host.sh:3760` declares `limit:60`. Confirmed: `echo '{"connector":"jenkins","bucket":"","limit":60,...,"basis":"predicted"}'` sits at that line inside the `ci-limit)` arm.
- *"nothing in that file carries a notion of a second job"* — confirmed. The job path is single-valued throughout: `jenkins_build_map()` derives one `job` from `${instance#*/}` or `$PLOT_JENKINS_JOB` (`plot-host.sh:721-734`), and there is no second key, no list, no second call site.
- The colour table `blue`→passing, `yellow`→failing deliberately, `*_anime`→pending is real and sits at `plot-host.sh:762-775` inside the `jq` program (`color_to_checks`), documented at `:540-551`. URL-decoding is real (`urldecode` at `:759`).

**VERIFIED FALSE — and it is the plan's load-bearing structural claim.**

> *"`BuildRun` (`entities/build.ts`) carries a **`pipeline`** field beside `head`, `state`, `startedAt`, `durationMs` and `url`."*

`BuildRun` is `entities/build.ts:113-124` and its **complete** field list is:

```ts
export interface BuildRun {
  workflow: string;
  conclusion: string;
  startedAt: string;
  url: string;
}
```

It has **no** `pipeline`, no `head`, no `state`, no `durationMs`. The plan has confused `BuildRun` with **`Build`** (`entities/build.ts:51-64`), which does carry exactly `url`, `pipeline`, `head`, `state`, `startedAt`, `durationMs` — the six fields the plan names, in the plan's own order. The plan named the wrong one of two adjacent interfaces in the same file.

The confusion is consequential rather than cosmetic, because **`Build` is not on the build port at all.** `ports/build.ts` declares three operations and their return types are `readonly BuildRun[]`, `ShaRun | null`, and `readonly LimitReading[]` (`:76`, `:105`, `:126`). `Build` is reached by no port operation. So the plan's section heading — *"The entity already distinguishes them"* — asserts a capability of an entity nothing returns, and the section's conclusion (*"two runs on one branch are expressible today without a schema change"*) is unsupported by the entity it cites. `BuildRun.workflow` might carry a job name, but the plan does not argue that, and `workflow` is documented as *"the workflow's name; `''` where the CI system did not name it"* — filled by `runOf` at `build-shell.ts:47-52` from the script's JSON.

**COULD NOT VERIFY — because the plan does not state it, and it is the claim the whole shape rests on.** The plan asserts the state "lands on the default branch's row". I could find no default-branch row on this board. `board.ts:706` filters it out explicitly:

```ts
return tips.value.filter(
  (tip) => tip.branch !== '' && tip.branch !== defaultBranch,
)
```

and `checks` is a field on **`PrRecord`** (`fleet.ts:346`), consumed per-PR at `fleet.ts:4033`'s `switch (pr.checks)` and `fleet.ts:2663`'s `failingChecks: pr?.failing_checks ?? []`. Every rendered check state in this board hangs off a pull request. The default branch has no PR. So the plan's single slice — *"render its state on that branch's row beside the CI state"* — names a row and a "CI state" that, as far as I can measure, do not exist. See §3; this is the plan's real gap, and it is larger than the entity slip.

## 2. Is the declared dependency real, and does the rejection carry over?

**The dependency is NOT real, and the plan's stated reason for it is the rejected plan's own false premise, restated.**

The plan's Notes say: *"Until `buildPortFor` reaches `buildFor`, no Jenkins reading arrives at the board at all."* That sentence is the exact claim the sibling was rejected for. On main:

- `board.ts:232-233` — `buildPortFor` returns `opts.buildAdapter ?? buildShell(...)`.
- `build-resolve.ts:54-65` — `buildShell` reads the `CI` key through `plot-config.sh` and **returns `buildFor(...)`**.
- `build-resolve.ts:41-42` — `case 'jenkins': return buildJenkins(context);`

So `buildPortFor` **does** reach `buildFor`, transitively and unconditionally. The rejected plan's rejection note says exactly this and this plan was written as if the note did not exist. Repeating a disproved premise in a second plan's Notes is worse than the original error, because the disproof was already written down in the file this plan links to.

**But the dependency is unreal in a second and more interesting way, and this one is the connector lens's finding.**

Even if the build port were broken, it would not gate this work — **because the multibranch Jenkins reading does not travel through the build port at all.** It travels through the **host** connector:

- `plot-host.sh:2661` opens the `pr-list)` arm.
- `plot-host.sh:2705-2719`, **inside that arm**, calls `ci_scheme()`, `jenkins_instance()` and `jenkins_build_map()` and overlays `checks` onto the PR rows.
- `ports/host.ts:207` declares `prList(state, limit?)`, and `fleet.ts:2442`'s `host` is what carries those rows.

`ports/build.ts`'s three operations (`runs`, `runForSha`, `limit`) are a **different** reading, used at `fleet.ts:2111` for the stuck-run histories of branches whose PR already reports `checks === 'failing'` (`fleet.ts:2113`). The `checks` word the plan wants a second one of is produced by the host arm, not by `buildJenkins`.

So the plan has its own architecture inverted. The thing it declares a dependency on is irrelevant to it, and the thing it must actually modify — the `pr-list` arm's Jenkins overlay, i.e. the **host** connector — it never names. This is not a partial invalidation; the dependency line should be deleted outright, and deleting it exposes that the Design section is describing the wrong connector.

**The rejection's own open item is the live one.** The sibling's rejection note says the operator's blank board is *unexplained*, and names the cheapest next reading: `plot-config.sh get CI ''` in that repository. That reading has still not been taken as far as I can tell, and it dominates this plan — a repository answering `''` sends `buildFor` to `buildNone` **and** sends `ci_scheme()` to the non-jenkins path, so neither job would show, and a second job key would change nothing.

## 3. Is the problem real, and is the shape right?

**The problem is real.** The operator's report is a direct quote and describes a normal enterprise topology: a multibranch job for branches, a separate integration job for `main`/`develop`. `jenkins_build_map()` genuinely models one job, and a branch absent from that job's listing reads `none` — `plot-host.sh:729-731` says so in its own comment: *"otherwise no branch matches and every row reads `none` — honest."* A CD job is invisible. That is a true gap.

**The shape is wrong in three ways, and the third is the one that would sink an implementation.**

**(a) The config key is placed by analogy, not by the port it serves.** The plan says *"a new optional config key"* and never says which. The estate already has `Jenkins instance` (`plot-config.sh:119`), whose value is `<slug>` or `<slug>/<job/path>` — the job path is already inside the instance key, parsed at `plot-host.sh:721-734`. A second job is therefore a second **job path against the same instance**, same credentials, same window, same controller. That is emphatically *not* a second connector; it is one connector asked a second question. The estate's rule (`CLAUDE.md`: *"A connector reaches a remote service: it has an account, credentials, a rate limit and a transport choice"*) makes the right reading unambiguous — one Jenkins, one budget, two job paths. The plan never states this, so an implementer is free to add a second connector, a second budget key, or a `Deploy job` key that silently assumes the same instance. Which of those it is decides whether `budget_record_call jenkins ''` (`plot-host.sh:2276`) stays correct.

**(b) The extra call belongs in the host arm, which the plan does not name.** Following the estate's rules, the change is: one more `jen -I "$slug" job list "$deploy_job" --json` inside `plot-host.sh`'s `pr-list)` arm, and the `checks` word for the default branch joined onto — what? There is no row. Which brings the third.

**(c) There is no target.** The slice says *"render its state on that branch's row beside the CI state"*. `board.ts:706` removes the default branch from the branch list, and `checks` is a `PrRecord` field. The plan proposes rendering onto a row that does not exist, beside a CI state that is not rendered there either. **This is the gap that makes the plan unimplementable as written** — not the entity slip, not the dead dependency. An implementer reaching this point must invent a default-branch row, and inventing a row is a board change with its own layout, its own section, its own classification (`classifyGroup` has no arm for *a branch with no PR that is nonetheless shown*), and its own plan. The plan's Board-impact comment says *"one extra reading on the default branch's row"* — one reading onto a row that has to be built first.

If the intent was instead *"overlay the deploy job's state onto PR rows targeting main"*, that is a coherent and much smaller change that needs no new row — but it is a different plan and the plan does not say it.

## 4. What does `Done when` fail to pin?

The list is unusually well-shaped for cost and unusually silent about correctness. An implementation can satisfy every stated gate and still be wrong:

- **"asked exactly once per refresh regardless of branch count, pinned by counting the calls"** — this is the plan's strongest gate and it is still off by a factor. `jenkins_build_map()` makes **two** `jen` calls, not one: `jen auth status` at `plot-host.sh:746` and `jen job list` at `:756`. A naive second job that re-uses `jenkins_build_map()` costs **+2**, not +1, and a test counting only `job list` invocations passes while the budget takes double. The gate names the wrong unit. (The auth call is skippable for the second job, but only if the implementer knows to skip it, and nothing here tells them.)
- **Nothing pins which connector and which budget.** An implementation that adds a *separate* Jenkins connector with its own `budget_record_call` key passes every gate and splits one controller's spend across two budget lines — after which `ci-limit`'s `limit: 60` meters half the traffic and the ceiling is wrong in the permissive direction. Nothing in `Done when` forbids it.
- **Nothing pins the failure direction.** `plot-host.sh:2697-2704` is explicit that the two Jenkins failure directions are kept apart: no instance is exit 3, unreachable is `checks:"unknown"` with exit 0, because *"one dead Jenkins must not darken every row."* A second job introduces a **third** direction the existing rule does not cover: the CI job answers and the deploy job does not. `Done when` says only *"a declared job that does not exist reports that it was not found"* — that is the misconfiguration case, not the outage case. An implementation that exits 3 when the deploy job is unreachable blanks the whole PR list and passes every gate.
- **The "byte-identically to today" gate is checked in the wrong repository.** This repo declares `CI: github-actions` (`CLAUDE.md:50`), so `ci_scheme()` never returns `jenkins` and the entire Jenkins arm is dead here. A test pinning "no deploy key behaves as today" exercises the `github-actions` path and proves nothing about the Jenkins path it is guarding. The plan is honest that end-to-end needs a Jenkins instance, but it does not notice that its *regression* gate is equally unverifiable here.
- **Nothing pins the render at all**, per §3(c) — no assertion that the state reaches a row, because there is no row to assert against.

## 5. The strongest argument against doing this at all

**The board's cadence does not meter Jenkins, so "+1 call per refresh" is not a cost the system can currently absorb or even see.**

`PR_REQUESTS_PER_REFRESH` (`fleet.ts:184-193`) is keyed by **git-host backend** — `github: 1`, `bitbucket: 4` — and `prRequestsPerRefresh(backend)` (`:1909-1912`) defaults an unknown key to 1. The throttle `prRefreshMsFor(backend, rate, currentMs)` therefore paces refreshes against the **git host's** spend. Jenkins is a third axis: `plot-host.sh:2270-2276`'s `jen()` wrapper records `budget_record_call jenkins ''`, a budget line nothing in the cadence reads. The sibling plan `a-connector-declares-its-ceiling` says this in its own words — the cadence *"never answers 'how close am I to the wall?'"* — and is still **Draft**.

So on the operator's estate today, a `bitbucket` + `jenkins` repository paces its refresh on `bitbucket: 4` while the Jenkins spend rides along unmetered against a `predicted` ceiling of 60/hour. At a 60 s cadence that is already 60 auth calls + 60 job-list calls per hour — **at the declared ceiling before a second job is added.** Adding a second job takes it to 120 or 180 depending on whether auth is re-taken, i.e. 2–3× a limit the connector already declares it is at, against a controller whose only correction mechanism is refusing. And no gate in this plan, and no code in the cadence, would notice.

The order is therefore wrong. `a-connector-declares-its-ceiling` teaches the cadence to read a ceiling; that plan is the prerequisite this plan should have declared and instead declared a rejected one. Building a second Jenkins job before the cadence can see the Jenkins budget spends a ceiling nobody is measuring, to render a state onto a row that does not exist.

## Summary

The problem is real and the operator's quote is worth acting on. This plan is not the instrument: it names the wrong entity, declares a dependency on a plan rejected for the premise this plan repeats, describes the wrong connector (build, where the reading is host), places the new call and key by analogy rather than by port, mis-counts the call it exists to bound, and targets a render surface that does not exist. Each is individually correctable; together they mean the Design section does not describe the system.

The amendment I would want, concretely:

1. Delete the dependency on `the-board-asks-the-build-resolver` and take the reading that rejection asked for — `plot-config.sh get CI ''` on the operator's repository — before anything else.
2. Re-site the Design on the **host** connector: `plot-host.sh`'s `pr-list)` arm, `jenkins_build_map()`, and `ports/host.ts`'s `prList`. The build port is not involved.
3. State the key explicitly as a **second job path against the same `Jenkins instance`** — one connector, one account, one budget, two questions. Say so, so an implementer cannot add a second budget line.
4. Answer the render question first: either build the default-branch row (a separate plan) or restate the goal as an overlay onto PR rows targeting the default branch (smaller, and needs no new row).
5. Fix the cost gate to count `jen` invocations, not job-list calls, and say whether the auth call is re-taken.
6. Order it behind `a-connector-declares-its-ceiling`, which is the dependency that is actually real.

Verdict: amend
