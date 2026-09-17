# Panel — the-deploy-job-shows-on-main

Subject: `docs/plans/2026-09-15-the-deploy-job-shows-on-main.md` (Draft, uninterrogated)
Lenses: premise, connector, verifiability.
Reconciliation: **divided — amend=connector,verifiability · reject=premise**

## The disagreement, named rather than averaged

Two jurors say amend, one says reject. **This is not "mostly amend."** All three found the same three defects and agree on every fact; they disagree about whether what survives is a plan to fix or a plan to rewrite.

- **`premise` says reject** because the plan's *stated* mechanism — a dependency, an entity, a target row — is wrong in all three parts, and what remains after deleting them is a different plan.
- **`connector` and `verifiability` say amend** because the underlying need (a team's CD state is invisible) is real and untouched by the three errors.

**The panel should be read as: the intuition is sound, the plan is not salvageable as written.** Whether that is "amend" or "reject" is a naming question about one document, and this moderation does not resolve it by counting. It is the caller's call, and the difference is small: nobody on this panel thinks an agent should be dispatched against this text.

## Three defects, each found independently by more than one lens

### 1. The declared dependency is the rejected sibling's false premise, restated

Plan Notes `:99-102`: *"Until `buildPortFor` reaches `buildFor`, no Jenkins reading arrives at the board at all."*

That sentence is the one `the-board-asks-the-build-resolver` was rejected for. `buildPortFor` already reaches `buildFor`, one hop through `buildShell` (`board.ts:232` → `build-resolve.ts:54-65` → `:41-42`).

**The rejection was recorded yesterday and the dependency was carried forward anyway.** That is the finding worth keeping: a plan citing a rejected plan inherited its false sentence rather than its correction.

### 2. "The entity already distinguishes them" — the load-bearing claim, and it is false

The plan rests on `BuildRun` carrying a `pipeline` field. Both `connector` and `verifiability` read the port: `ports/build.ts` returns `readonly BuildRun[]`, `ShaRun | null`, `readonly LimitReading[]` (`:76`, `:105`, `:126`). **`Build` — the entity that has `pipeline` — is returned by no port operation.** It is unreachable from the board.

What actually flows is `BuildRun` (`entities/build.ts:113-124`), which carries **exactly four** fields — `workflow`, `conclusion`, `startedAt`, `url`. The six the plan lists belong to `Build` at `:51-64`, a different interface in the same file whose own docstring at `:96-102` explains the split. Its only job-identifying field is the free-text `workflow`, documented as *"the workflow's name; `''` where the CI system did not name it"*.

So *"two runs on one branch are expressible today without a schema change"* is unsupported by the entity the plan cites — **and the plan read the neighbouring interface in the same file**, which is the sibling's error class exactly.

### 3. There is no target row — the defect that makes it unimplementable

`board.ts:706`:

```ts
return tips.value.filter(
  (tip) => tip.branch !== '' && tip.branch !== defaultBranch,
)
```

**The default branch is explicitly filtered out of the branch list.** And `checks` is a field on `PrRecord` (`fleet.ts:346`), consumed per-PR. Every rendered check state on this board hangs off a pull request; the default branch has no PR.

So the slice — *"render its state on that branch's row beside the CI state"* — names a row that does not exist **and** a CI state that is not rendered there either. An implementer reaching this point must first invent a default-branch row: a new section, a new `classifyGroup` arm for *a branch with no PR that is nonetheless shown*, its own layout. That is a board change with its own plan. The Board-impact comment calls it *"one extra reading on the default branch's row"*.

### 3b. The destination gap is larger than it first reported

`premise` returned two further verified facts after the panel closed, both re-read independently.

**The default branch is excluded in BOTH row populations, and one calls such a row a defect.** `board.ts:705-707` filters it before any plan card is built; `fleet.ts:1243` does it again (`if (!short || short === main) continue;`), its comment at `:1238-1241` explaining that a default-branch row *"renders a row named `HEAD` that no reader can act on."* The plan asks the state to land on a row that two producers remove by name, one of them describing the removal as the fix.

**And there is a `build` RowKind with no producer — the nearest precedent, and it is negative.** `schema.ts:1289-1291` lists eight kinds including `build`; `:1275-1280` records that its arm was removed and that *"`build` never rendered outside `mock-fleet.ts`"*. Verified at the producer: `rowKind` returns only `release`, `plan`, `branch`, `wave`.

**The enum keeping `build` is not evidence of support.** Its own docstring says kinds stay in the enum so the two `Record<RowKind, …>` tables become a compile error — *"a gate rather than a rule"*. So an implementer would find the types accept a build row and nothing render. **The one row kind that could have named a pipeline run was tried, never rendered, and deleted**, and the plan does not mention it.

### 3c. The gates can be met while rendering nothing

*"Lands on the default branch's row AND ON NO OTHER"* is phrased as an **exclusion**, so **zero rows satisfies it vacuously.** Add the key, add the call, store the answer, render it nowhere — every gate green, both suites pass, the operator sees exactly what they see today.

Also unpinned: `"byte-identically"` names no measurement; *"reports that it was not found"* names no surface; and no gate covers the **second job-resolution site** at `plot-host.sh:3101-3108`, where `run-for-sha` resolves the job independently — a deploy job added to the `pr-list` arm alone leaves the two arms disagreeing.

### 3d. The existing job is not a dedicated key

It is a **suffix on `Jenkins instance`** (`<slug>/<job/path>`, `plot-host.sh:702-708`) with a `PLOT_JENKINS_JOB` env override, resolved independently in two places. A second job as a standalone key sits asymmetrically beside the first — and `docs/plans/2026-08-18-plot-board-setup.md:117` already records the open question *"Should `CI` + `Jenkins instance` generalise to `CI` + `CI instance`"*. The plan does not engage with it.

## What the lenses had in common — and what it cost

All three verified the `plot-host.sh` citations and the `CI: github-actions` declaration, and all three found them true. **The plan's *quotations* are accurate; its *inferences from them* are not.** Every defect above is an inference: that an entity's field is reachable, that a dependency exists, that a row exists. A lens checking quotations would have passed this plan.

That is the same shape as the rejected sibling, where a function was located by its filename rather than by reading it. **Two plans in two days, both from accurate citations and wrong inferences.**

## The cost gate is off by a factor

The plan's strongest gate — *"asked exactly once per refresh, pinned by counting the calls"* — names the wrong unit. `jenkins_build_map()` makes **two** `jen` calls: `jen auth status` (`plot-host.sh:746`) and `jen job list` (`:756`). A second job re-using it costs **+2 per refresh**, against Jenkins' declared budget of 60/hr — the tightest connector on the estate. A test counting `job list` invocations passes while the budget takes double.

## What survives, and it is worth keeping

**A team whose CD runs in a separate job genuinely cannot see it.** No juror disputed this. `premise` confirms there is no path to the default branch's build state, by a different route than the plan claimed.

`connector` names the smaller coherent version: **overlay the deploy job's state onto PR rows targeting main.** No new row, no new section, no `classifyGroup` arm — and it needs a different plan, because this one does not say it.

## What the caller should do

1. **Do not dispatch this.** Unanimous in substance across all three lenses.
2. **Delete the dependency on the rejected plan** — it is false and it is the second document to carry that sentence.
3. **Run the two readings first** — `plot-config.sh get CI ''` and `Jenkins instance` in the operator's repository. If `CI` is empty, `buildFor` returns `buildNone` (`build-resolve.ts:43-44`), which answers `unaskable` on every operation and fetches **no** job, first or second — a deploy job on top would be equally invisible, and that would be the third implementation on one subject in one week reported as not working. **This is a sequencing objection, not a reason to drop the operator's need.**
4. **Re-scope to PR rows targeting main**, or write the default-branch row as its own plan first. Decide which; they are different sizes.
5. **Re-count the call cost as +2**, against a 60/hr ceiling.
6. Keep the plan's honest split of what can and cannot be verified here — `verifiability` confirms that part was right.

## The measurement the panel could not take (2026-09-15)

**Taken on a real bb/jen/jira repository** — `Quatico.Webseite/quaweb-website` — after the operator named it. Everything below is a live reading, not an inference. **It refutes this plan's design and vindicates its motivation.**

### `buildNone` is NOT the explanation — the config is complete

`premise`'s strongest objection was a sequencing one: if `CI` is empty, `buildFor` returns `buildNone`, nothing is fetched, and a second job would be equally invisible. **Measured, that hypothesis is false:**

```
CI                = jenkins
Jenkins instance  = jenkins.example.com/quaweb/continuous-build
Git host          = bitbucket
Tracker           = jira https://quatico.atlassian.net
```

`jen auth status` against that slug: **signed in**, token in keychain. So the connector resolves, the instance is reachable, and the CI half genuinely works — `job list quaweb/continuous-build` returns branch children with colours (`bugfix%2FQUACDS-915-anchor-hash` → `red`, others `blue`).

### There are FIVE jobs, not two — the plan's central shape claim is false

```
continuous-build         WorkflowMultiBranchProject   ← the only one Plot reads
continuous-deploy        WorkflowJob
continuous-deploy-stable WorkflowJob
release                  WorkflowJob
set-image-name           WorkflowJob
```

This plan says: *"It does not generalise to N jobs. **Two is the shape a team has**: one job that builds branches, one that deploys the integrated result. A list of jobs would be inventing a structure nobody has asked for."*

**The first real instance measured has four CD-side jobs.** The fixed count of two is what the whole cost argument rests on (*"+1 call per refresh, fixed"*), and it does not survive its own motivating example.

### The real defect: `job list` cannot read a plain job's state

**This is the mechanism, and no juror found it because none had an instance.**

```
jen job list quaweb/continuous-deploy --json   →  null
jen job view quaweb/continuous-deploy --json   →  color: blue,
                                                  lastBuild: #938 SUCCESS,
                                                  duration 453365ms
```

`job list` enumerates a folder's **children**. A `WorkflowMultiBranchProject` has children — one per branch — so listing it yields the CI answer. A plain `WorkflowJob` has none, so the same call yields `null`.

**`plot-host.sh` calls only `job list` (`:756`) and never `job view` — zero occurrences.** So the CD side is unreachable through the verb Plot uses, *whatever* job is declared.

**That is a different defect from the one this plan names.** The plan says the gap is *"a second thing to ask"*. The gap is **a second way to ask**: `job view`, which Plot does not call, and `build list`, which returns full stage detail for the same job.

### The target repo had already diagnosed this, in writing

`AGENTS.md` carries a table of the two pipelines, and this sentence:

> *"`Jenkins instance` nimmt nur einen Wert, und «deploy» kommt in `plot-host.sh` kein einziges Mal vor: Plot hat fuer die CD-Seite kein Konzept."*

Verified: `grep -ic deploy skills/plot/scripts/plot-host.sh` → **0**.

It also records the cost of getting the key wrong (PR #874, 2026-09-15): the path must carry `<slug>/<job-path>`, or *"das Board meldet dann fuer jeden PR `checks: unknown`"*.

**An operating team wrote the diagnosis into its own repo and Plot never read it.** That is worth more than the plan it corrects.

### What this means for the plan

- **The need is confirmed.** A real team runs a separate CD pipeline and cannot see it.
- **The declared-key design survives** — a naming convention would have to guess among `continuous-deploy`, `continuous-deploy-stable`, `release` and `set-image-name`.
- **"Two is the shape" must go.** Five jobs, four of them CD-side.
- **The `+1 call per refresh` gate is unsound** — `jenkins_build_map()` already makes two calls, and a plain job needs `job view`, a verb the map does not use.
- **The plan's stated mechanism is wrong.** It is not a missing config key in front of a working reader; it is a reader that cannot answer for this job shape.
- **The destination problem is untouched** by any of this. The board still has no default-branch row, and `build` is still a RowKind with no producer.
