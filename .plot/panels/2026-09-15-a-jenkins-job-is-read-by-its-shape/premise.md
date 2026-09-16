# Premise lens — a Jenkins job is read by its shape

Read at `origin/main` = `bc4d0023554f3f35ef88430279a0b537272addaf`, 2026-09-15.

My reading position: establish whether the thing this plan says is broken is actually broken, by reading the code on the path rather than its neighbours. The two rejected predecessors both failed by attributing a neighbour's property to the thing in use — `buildShell` read as bypassing a resolver it in fact calls, and `Build`'s fields read onto `BuildRun`. So I traced `jenkins_build_map` from its definition through both of its callers to what a consumer finally sees, and I name every line I read.

## 1. Every factual claim about this repository's code

**All verified true on main. Nothing I could check was false.**

| Claim | Reading | Verdict |
|---|---|---|
| `jenkins_build_map()` makes the `job list` call at `:756` | `skills/plot/scripts/plot-host.sh:756` — `out=$(jen -I "$slug" job list ${job:+"$job"} --json 2>&1) \|\| true` | TRUE, exact line |
| `:757` refuses anything not a JSON array | `plot-host.sh:757` — `if [ -z "$out" ] \|\| ! printf '%s' "$out" \| jq -e 'type=="array"' >/dev/null 2>&1; then` | TRUE, exact line |
| The refusal prints `{"status":"failed","map":{}}` | `plot-host.sh:758` | TRUE |
| `plot-host.sh` never calls `job view`: zero occurrences | `grep -c 'job view'` on the file at `origin/main` returns **0** | TRUE |
| `job list` occurs at `:756` and nowhere else as a call | `grep -n 'job list'` returns `:117` (a comment) and `:756` (the call) | TRUE |
| Colour table: `blue`→green, `red`/`yellow`→failing, `*_anime`→pending, `disabled`/absent→none | `plot-host.sh:778-784`, the `color_to_checks` jq def | TRUE. Note `disabled` has no literal arm — it reaches `none` through the final `else`. The plan's table states the *behaviour* correctly; an implementer must not read it as naming a branch that exists. |
| `board.ts:705-707` filters the default branch out | `packages/board/src/server/board.ts:705-707` — `.filter((tip) => tip.branch !== '' && tip.branch !== defaultBranch)` | TRUE |
| `fleet.ts:1243` does it again, its comment calling such a row "a row named `HEAD` that no reader can act on" | `packages/board/src/server/fleet.ts:1243` — `if (!short \|\| short === main) continue;`, comment at `:1239-1240` | TRUE, and the quoted sentence is verbatim |
| `build` is a `RowKind` with no producer | `packages/board/src/contract/schema.ts:1275` — *"That is why `build` and `agent` below no longer have arms in `rowKind`"*; `:1278` — *"`build` never rendered outside `mock-fleet.ts`"*; `rowKind` is defined at `fleet.ts:5305` | TRUE |

**One imprecision worth naming, and it is in the plan's favour.** The plan cites `board.ts:705-707` and `fleet.ts:1243` with no directory. Both live under `packages/board/src/**server**/`, not `src/`. `git show origin/main:packages/board/src/board.ts` returns nothing. A brief writer who greps the cited path literally finds no file — the same shape of miss that produced the first rejection, though here the line numbers are right and the content is right.

**What I could not verify:** nothing in this repository. Every in-repo claim resolved.

## 2. The live reading I cannot reproduce — is the reasoning coherent?

I cannot reach `jenkins.example.com`. `jen` is on PATH at `/Users/jwloka/.local/bin/jen`; I did not invoke it against that instance. So `job list → null` and `job view → color blue` are taken on the plan's word.

**The reasoning is internally coherent, and — this is the part I can check — it is consistent with what `plot-host.sh` does with the answer.** The chain holds at every link I can read:

1. `job list` is documented in this repo's own contract test as enumerating a multibranch job's branch children: `test/reconcile/host.test.mjs:1408-1411` records the 2026-08-26 spike — *"ONE `job list --json` call returns every branch as `{_class,name,color}`"*. `:1418-1424` states that the container is the **parent** and the branch is a **child**. A parent listing returning its children, applied to a job with no children, yielding nothing, is exactly what that comment describes.
2. `:757` accepts **only** `type=="array"`. JSON `null` fails that test. The plan does not need the instance to be reachable for this half — the guard is right there, and `null` is not an array.
3. So the `failed` word is produced by the code on the path, not inferred from a neighbour.

**And the consequence the plan asserts is understated.** I traced what a caller actually sees, which the plan does not do:

- **`pr-list --rich`**, `plot-host.sh:2711-2719`: reads `.status`, and at `:2717-2718` prints `plot-host: jenkins unreachable ($jen_status) — checks reported as unknown`. A plain job produces the literal word **"unreachable"** about a Jenkins that answered correctly.
- **`runs`**, `plot-host.sh:3017-3025`: same read, and at `:3024-3025` prints `plot-host: runs — jenkins unreachable` and **`exit 4`**.
- Exit 4 lands in `packages/domain/src/adapters/build/build-shell.ts:139-145`. `record()` sets `refusal = null` for code 4, and `:133-135` states the rule: *"Exit 4 is NOT a refusal. It says this connector cannot be asked at all, which is a standing configuration fact rather than an incident worth waiting out."*

**That is the finding my lens owes the panel.** The defect is worse than "reports `failed`". A plain `WorkflowJob` is reported through the port as **`unaskable` with no refusal text** — the domain's word for *this repository has no CI to ask*, deliberately distinguished from a transient outage precisely so that nobody retries it. The one signal a team could have acted on is discarded by design, at a line whose comment explains why discarding it is correct for the case it was written for. A reachable Jenkins, a correctly declared instance, a signed-in `jen`, a job that built successfully 453 seconds ago — and the port's honest answer is *there is nothing here to ask*.

The operator's report is therefore explained end to end by this mechanism, and the first rejection's open question (*"the cheapest next reading is `plot-config.sh get CI ''`"*) is answered: the config is fine, and this is why the board is blank anyway.

## 3. Is the problem real, and is the shape right?

**The problem is real.** Traced above, on the path, with no step taken from a neighbour.

**The shape is right, and the separation is genuine rather than rhetorical.** The plan refuses to render anything, and I checked that this is a real boundary and not an excuse to ship half a thing:

- A rendered deploy state needs a row. `board.ts:705-707` and `fleet.ts:1243` both delete the default branch before any card exists, and `build` has no `rowKind` arm (`schema.ts:1275`). Those are three separate edits in a different package, each with its own argument.
- The reader fix needs none of them. `runs` is a `plot-host.sh` op with a domain consumer that exists today (`build-jenkins.ts:56`, `build-shell.ts:151`). Fixing the reader makes `plot-host.sh runs <branch>` answer for a plain job — observable, testable, and useful to the operating team from a terminal — with zero board change.

So the two halves are separable at a real seam, and the plan takes the half that is provable here. Given two rejections in one week for premises that render-side work would have inherited, taking the reader first is the right order.

**`_class` costs nothing — verified in this repository, not only on the instance.** `test/reconcile/host.test.mjs:1505-1509`: every element of the existing `JEN_JOBS` fixture already carries `_class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob'`. The field is present in the payload the tests already drive, so "read the shape from a call already being made" is true against in-repo evidence and needs no live reading.

## 4. What `Done when` fails to pin

Four gaps. The first two are ways to pass every gate and still be wrong.

**(a) The `_class` the plan tests is on the WRONG object, and the fixture proves it.** This is my strongest finding.

The plan says: *"read the job's `_class` from the listing Plot already performs"*, and *"the parent listing Plot already performs carries it for every job"*. But trace which listing:

- The listing Plot performs is `job list <container>` — the **children** of the configured job (`plot-host.sh:756`, and `host.test.mjs:1418-1424` on the container/child relation).
- Its elements' `_class` describes each **child**. `host.test.mjs:1505-1509` shows all five children of a *multibranch* container carrying `_class: …job.WorkflowJob` — the children of a multibranch job are themselves `WorkflowJob`s.
- The plan's own evidence table lists `continuous-build → WorkflowMultiBranchProject` alongside four `WorkflowJob`s. That table is a listing of the **`quaweb` folder**, one level *above* the configured job.

So the `_class` that decides the verb belongs to the **configured job itself**, which appears in the *parent's* listing — a call `plot-host.sh` does **not** make. An implementer reading the plan's sentence literally will inspect `.[0]._class` of the existing `job list` output and find `WorkflowJob` for a healthy multibranch container, because that is what its branch children are. That reads a multibranch job as plain and routes it to `job view`, breaking the CI half — or, for a plain job, the listing is `null` and carries no `_class` at all, so there is nothing to read.

Every gate still passes. `test:contracts` passes because the multibranch fixture's `_class` is `WorkflowJob` and a fixture authored to match will agree with whatever the implementer wrote. `grep -c 'job view'` is non-zero. The call count is unchanged. **This is the same error class as both rejections — a property read off a neighbouring object — and the plan has it in the one sentence that specifies the mechanism.** The plan is right that the shape is the fact; it names the wrong object as carrying it, and does not say which call yields it.

**(b) The call-count gate is already satisfied and does not constrain the new path.** *"The number of `jen` calls per refresh is unchanged for a multibranch job and pinned by counting."* That test exists — `host.test.mjs`, *"one job-list call serves every branch — no per-branch call"* — and it counts calls whose argv **contains the literal string `'job list'`**. A `job view` call contains `job view` and is invisible to that filter. So the existing counter passes whatever the plain-job path does, including a per-branch `job view` storm, and it says nothing about the case the plan adds. The gate as worded ("for a multibranch job") is honest about its scope but is satisfied by a test that already passes on main — it pins nothing new. There is no gate on the plain-job call count at all, which matters because Jenkins declares the estate's tightest budget (`limit: 60`, `plot-host.sh:3760`).

**(c) The stub cannot tell the two verbs apart, so "byte-identical" is untestable as written.** `host.test.mjs:1462` dispatches on `group == "job"` and returns `jobsJson` for **any** `job` subcommand. A `job view` call gets the array fixture back. The plan asks for a fixture carrying the `job view` payload; the stub must first learn to distinguish `list` from `view`, or a test asserting the plain-job path will be answered by the multibranch fixture and pass for the wrong reason. Not a defect in the plan's intent — a real edit the slice needs and does not name.

**(d) `unaskable` is not in the gates, and it is the fact the operator experiences.** The gates say a plain job "reports its real state rather than `failed`". But `runs` converts `failed` to `exit 4` → `unaskable` (`plot-host.sh:3025`, `build-shell.ts:141`). A gate on the script's internal status word can pass while the port still answers `unaskable`, if `runs` is left reading only `.map[$branch]` — which is exactly what `:3027-3029` does, and a plain job has no branch key in any map. **Nothing in `Done when` requires `plot-host.sh runs <default-branch>` to emit a line on a plain job.** That is the one observable the operating team can check without a board change, and it is the natural gate for this slice.

**(e) Minor.** *"a job whose `_class` is neither kind is read as unknown rather than failed"* is a good refusal, but `unknown` already exists at `:751` meaning *unrecognised auth wording*. Two causes reaching one word, with `:2718` printing "jenkins unreachable" for both. Worth a distinct stderr sentence; not a blocker.

## 5. The strongest argument against doing this at all

**Nothing consumes the result, so the fix is unobservable to the people who reported the problem, and the plan's own evidence says the destination is three edits away in another package.**

`board.ts:705-707` and `fleet.ts:1243` filter the default branch; `build` has no `rowKind` arm; `checks` is a field on `PrRecord` and a plain deploy job has no PR. A team whose board is blank today will have a blank board after this ships. The plan is candid about this — and candour is not the same as value. Against a third plan in one week on one subject, "we fixed the reader, the board is unchanged, the next plan renders it" is a real risk of a fourth.

**Why it does not persuade me.** `plot-host.sh runs <branch>` is a real op with a real domain consumer, reachable from a terminal; making it stop saying "unreachable" about a reachable Jenkins is a check the operating team can run today. And the counterfactual is worse: the previous plan bundled reader and destination, and the destination problem is what sank it. Fixing the reader first is the correct decomposition even though it delays the visible win — provided the plan does not pretend the win has arrived, and it does not.

## Verdict

The premise is **sound and verified on the path**, which is what my lens was asked for and what neither predecessor achieved. The defect is real, the mechanism is the one the plan names, and the consequence is worse than stated — `unaskable`, not merely `failed`.

The mechanism sentence, however, names the wrong object as carrying `_class` (finding 4a), and it names it in the one place an implementer will read as instruction. That is the identical error class as both rejections, surviving into the plan written to correct them, and it is repairable with two sentences: say that the deciding `_class` is the **configured job's own**, appearing in its **parent's** listing, and name the call that yields it. Findings 4b, 4c and 4d are gate repairs of the same size. None of this touches the plan's shape, its separation, or its evidence — which is why this is an amendment and not a rejection.

Verdict: amend
