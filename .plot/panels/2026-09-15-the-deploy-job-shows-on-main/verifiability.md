# Panel: the-deploy-job-shows-on-main — VERIFIABILITY lens

Lens: of every gate this plan proposes, could a worker in THIS repository actually prove it?

## 1. Is every factual claim true on main right now?

**Verified true:**

- `plot-host.sh:539` — the quoted sentence is exact: *"build status (`checks`) is resolved through `jen` — a multibranch job's branches in one call, joined locally to the PR list the host provides."* (`skills/plot/scripts/plot-host.sh:537-540`)
- `plot-host.sh:3760` — `limit:60` for Jenkins is exact, and `basis:"predicted"`. The neighbouring comment confirms it is an estimate, not a reported ceiling.
- The colour table is as described: `blue`→green, `red|yellow`→failing, `*_anime`→pending, `disabled|absent`→none (`plot-host.sh:778-784`). One wording correction: the code maps `blue` to **`green`**, not `passing` — and `plot-host.sh:764-769` explicitly says the board's `checkWord()` renders the prose word "passing" as *cannot read the checks*. The plan's Design section repeats the plan-prose word `passing`. Harmless in a design paragraph, dangerous if a worker copies it into code.
- URL-encoded branch names are decoded (`plot-host.sh:775-777`, `urldecode`).
- This repository declares `CI: github-actions` (`plot-config.sh get CI` → `github-actions`). The plan is right that the real path cannot be exercised here.

**FALSE — and it is the plan's load-bearing claim:**

> "`BuildRun` (`entities/build.ts`) carries a **`pipeline`** field beside `head`, `state`, `startedAt`, `durationMs` and `url`."

`BuildRun` (`packages/domain/src/entities/build.ts:118-127`) has exactly **four** fields: `workflow`, `conclusion`, `startedAt`, `url`. It has no `pipeline`, no `head`, no `state`, no `durationMs`.

The six fields named belong to a **different interface** — `Build` (`entities/build.ts:51-63`), which does carry `pipeline` at `:55`. The plan names one type and describes another.

This is not a typo with no consequence. `grep -rn pipeline packages/domain/src/` returns the field at exactly one site: `entities/build.ts:55`. **`Build` has no producer anywhere on the estate.** Its only importer is `transitions/build.ts`, which consumes it in two pure functions (`buildStateObservable:193`, `observeBuildState:215`); no adapter constructs one, and no board code imports it. Every build connector — `build-actions.ts`, `build-jenkins.ts`, `build-none.ts`, `build-fixture.ts`, `build-shell.ts` — imports `BuildRun` and `ShaRun` only.

So the plan's section heading **"The entity already distinguishes them"** and its conclusion **"two runs on one branch are expressible today without a schema change"** are both false of the type that actually flows. The type that flows (`BuildRun`) cannot distinguish two pipelines on one branch by anything but the free-text `workflow` string, and the type that could (`Build`) is unreachable, dead code.

**Could not verify / not checkable here:** nothing else — but see §4 for what the plan never claims and needed to.

**This is the same error class the sibling was rejected for.** `the-board-asks-the-build-resolver` was rejected because a grep excluded the one directory holding the disproof. Here a claim about `BuildRun` was written from `Build`. Both plans assert a measurement about a type/function that the file itself contradicts, and in both cases reading the named file settles it in under a minute.

## 2. Is the declared dependency real, and does the rejection invalidate this plan?

**The stated dependency is false.** The plan says:

> "Until `buildPortFor` reaches `buildFor`, no Jenkins reading arrives at the board at all"

`buildPortFor` calls `buildShell` (`board.ts:232`); `buildShell` is defined in `build-resolve.ts:57-70` and its last line is `return buildFor(...)`. **`buildPortFor` already reaches `buildFor`, and `buildFor` already returns `buildJenkins(context)` for `jenkins` (`build-resolve.ts:41`).** The chain is connected on main. That is precisely why the sibling was rejected, and this plan's Notes assert the rejected plan's false premise as its own blocking dependency.

So: the dependency is **not real**, and the blocker it names does not exist. That half is good news for this plan — it is not blocked.

But the rejection damages it in a worse way. The sibling's rejection note names the still-open question:

> "The operator's report is unexplained and still open. Jenkins builds genuinely do not appear on their board; the cause is not this."

**This plan proposes a second job before anyone has established why the first one is invisible.** It inherits an unexplained defect and builds on top of it. If the root cause is, say, an empty `CI` key or an unset `Jenkins instance` on the operator's repository, then a declared deploy job is invisible for exactly the same unknown reason, and the slice ships a feature that demonstrates nothing.

## 3. Is the problem real, and is this the right shape?

**The problem is real.** The operator's quote is concrete, and a CI-plus-CD split is an ordinary shape. The design reasoning is genuinely good in three places: rejecting naming-convention inference in favour of a declared key (a silent failure traded for a loud one); refusing to generalise to N jobs; refusing to gate on a red deploy. Those are the arguments of someone who has thought about it.

**The shape is wrong against the code as it stands**, for a reason the plan never confronts: *the board has no default-branch row to render onto.*

- `grep -rn "defaultBranch\|default_branch\|default-branch" packages/board/src/server/fleet.ts` → **zero matches**.
- `grep -rn "'main'\|mainBranch" packages/board/src/server/fleet.ts` → **zero matches**.
- Rows are built from `pulse.plans` and their branches (`fleet.ts:2090`, `:2652`, `:5685`). A row exists because a *plan names a branch*. The default branch is not a plan's slice and gets no row.
- The board does have a `kind: 'build'` row type — and `tuple-row.ts:1463-1466` states plainly: **"No row is emitted for a build today, and the kind is designed anyway... a projection waiting for a caller rather than a source waiting to be fetched."** The only producers are `mock-fleet.ts:184` and `:201`.

The plan's slice line says the state should "land on the default branch's row". **There is no such row.** The slice as written cannot be implemented as described without first creating a row class the board does not have — work the plan does not name, does not scope, and does not cost.

There is a second, sharper problem. `jenkins_build_map` (`plot-host.sh:721`) **already returns every branch in the multibranch job in one call** — "One call, every branch — the spike's whole point" (`:753`) — and that map already includes the default branch if the job builds it. What discards it is the **join**: the map is overlaid onto the **PR list** (`plot-host.sh:2711`, inside the `pr-list --rich` arm). The default branch has no open PR, so its entry is joined against nothing and dropped.

So the plan's diagnosis — "Plot models one job per repository" — is only half the cause. The other half is that Plot's build reading is **PR-shaped**, at both the script join and the board's row model. A second job declared in config would arrive and be discarded at the same join, for the same reason, unless the row model changes too.

## 4. What does `Done when` fail to pin?

The list has six gates. Four are genuinely provable here; two are not what they appear.

| Gate | Provable in this repo? |
|---|---|
| no deploy key ⇒ byte-identical | **Yes.** Real and valuable — this is the regression gate. |
| asked exactly once per refresh regardless of branch count | **Yes**, via a counting fixture. `build-fixture.ts` exists and is the right instrument. |
| state lands on default branch's row and no other | **No.** There is no default-branch row; there is nothing to assert against. |
| declared job that does not exist reports not-found | **Partly.** Provable against a stub; the real not-found path is `jen`'s, unreachable here. |
| CI colour mapping unchanged | **Yes** — a characterization test over the existing `jq` table. |
| `test:contracts` + board suite pass | **Yes**, but this is a no-regression gate, not a feature gate. |

**Here is the concrete way to satisfy every stated gate and still be wrong.** A worker:

1. adds a `Deploy job` key to `plot-config.sh` reads — trivially provable;
2. adds an arm to `plot-host.sh` that calls `jen job list` for the declared job once per refresh — call count provable with a stub;
3. adds a field to the payload carrying the deploy state;
4. writes a test that no-key behaviour is byte-identical — passes;
5. writes a test counting exactly one call — passes;
6. runs `pnpm run test:contracts` and the board suite — green.

**Every gate green. Nothing rendered.** No row exists for the default branch, so step 3's field reaches no renderer; the payload grows a key nobody reads. The plan explicitly pushes the rendering proof outside the gates ("Verified separately on an instance declaring `CI: jenkins`"), so nothing inside the slice notices that the feature's entire visible half is absent. The worker reports done, honestly, having built a field and a call with no consumer.

That is not a hypothetical failure mode in this repository — it is the *documented status quo* of the build row (`tuple-row.ts:1465`, "a projection waiting for a caller"), and this plan would add a second such projection waiting for a caller.

**Three things the gates never pin, each of which decides whether the work is real:**

- **Where the state renders.** Named in the slice line, untestable as written, and moved outside the gates by the "Verified separately" paragraph. The one thing a reader would call the feature.
- **What happens when the deploy job is declared and `Jenkins instance` is not.** `plot-host.sh:819` exits **3** for exactly this, and `:3025` exits **4** for an unreachable instance. Two distinct refusals a new arm must honour; neither appears in `Done when`.
- **That the `+1 call per refresh` claim survives both call sites.** `buildPortFor` is called at `fleet.ts:2111` and `fleet.ts:2442` — two independent resolutions per pass. The plan's fixed-cost argument is its whole affordability case and it counts one site. `refreshRuns` also bounds GitHub calls through `withHostSlot` only when `ci.system() === 'github-actions'` (`fleet.ts:2144`); a Jenkins deploy call is deliberately unslotted, so "+1" must be proven against both entry points, not asserted.

## 5. The single strongest argument against doing this at all

**The visible defect that prompted this is still unexplained, and this plan would bury it.**

The operator reported Jenkins builds missing. One plan blamed the resolver and was disproved. This plan blames the job count. Neither has established the actual cause, and the sibling's rejection says so explicitly. The cheapest reading it names — `plot-config.sh get CI ''` in the repository whose board is blank — costs one command and has not been run.

If the cause is a config key, this plan ships a second job that is invisible for the first job's reason, and the estate now has two unexplained blanks instead of one. If the cause is the PR-shaped join (which §3 shows is at minimum *a* cause — the default branch's entry is already fetched and already discarded), then the right change is to the join and the row model, and a config key for a second job is the wrong lever pulled first.

Either way the ordering is wrong: **diagnose the blank board, then decide whether a second job is the missing piece.** Against that, the cost of waiting is one reading.

## Summary

The design *thinking* here is above average — the declared-over-inferred argument and the refusal to generalise are both right and both well-argued. What fails is the measurement layer, in the same way the sibling failed.

- The central entity claim is false: `BuildRun` has no `pipeline` field; `Build` does, and `Build` has no producer on the estate.
- The declared dependency is false: `buildPortFor` already reaches `buildFor`, which already returns `buildJenkins`.
- The slice's landing place does not exist: the board emits no default-branch row and no build row at all.
- A worker can green every stated gate while rendering nothing, and the plan moves the only gate that would catch this outside the slice.

**Amend, not reject.** The operator's need is real, the rejected sibling does not invalidate it, and the design arguments survive intact. What must change before dispatch:

1. Delete the `pipeline`/`BuildRun` paragraph, or rewrite it against `Build` and say plainly that `Build` is unreachable today.
2. Delete the dependency on the rejected plan — it is already satisfied.
3. Establish why the operator's board is blank first, and state the finding in the plan.
4. Name where the state renders. If that means a default-branch row or the first real `kind: 'build'` producer, scope it — it is the larger half of this work and is currently invisible in the plan.
5. Add a gate that fails when the reading reaches no renderer, so "green gates, nothing shown" cannot be reported as done.
6. Prove `+1 per refresh` against both `fleet.ts:2111` and `fleet.ts:2442`.
7. Say what a declared deploy job with no `Jenkins instance` does — exit 3 and exit 4 are both live refusals.

On shipping unverified: the plan is honest that the end-to-end path needs a Jenkins instance, and that honesty is real. It is not honest about the gap between "verified elsewhere" and "verified nowhere" — as written, the *rendering* is proven by nothing at all, in this repository or another, because no row exists to render onto in either.

Verdict: amend
