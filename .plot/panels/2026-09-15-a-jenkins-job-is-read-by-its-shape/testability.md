# Juror: testability

**Lens:** this repository declares `CI: github-actions` and has no Jenkins. Every gate the plan names must be met by a fixture carrying a payload nobody here can regenerate. The question is whether those fixtures can be built, whether they would catch the defect, and whether a frozen payload is evidence or a restatement of the plan's own assumption.

## 1. Are the factual claims about this repository TRUE on main right now?

Read at `origin/main` = `bc4d0023554f3f35ef88430279a0b537272addaf`.

| Claim | Verdict | Evidence |
|---|---|---|
| `jenkins_build_map()` makes the `job list` call at `plot-host.sh:756` | **TRUE** | `skills/plot/scripts/plot-host.sh:756` is exactly `out=$(jen -I "$slug" job list ${job:+"$job"} --json 2>&1) \|\| true` |
| The jq array guard is at `:757` | **TRUE** | `:757` is `if [ -z "$out" ] \|\| ! printf '%s' "$out" \| jq -e 'type=="array"' >/dev/null 2>&1; then`, and `:758` prints `{"status":"failed","map":{}}` |
| The quoted three-line snippet matches the source | **TRUE**, verbatim including `|| true` and the `return 0` |
| `plot-host.sh` never calls `job view`: zero occurrences | **TRUE** | `grep -c 'job view'` on the file at `origin/main` returns `0` |
| The colour table (`blue`→green, `red`/`yellow`→failing, `*_anime`→pending, `disabled`/absent→none) | **TRUE** | `plot-host.sh:778-784`, `color_to_checks`. Note the plan states the mapping in the *four-word `checks`* vocabulary (`green`), which is what `:781` actually does — the rejected predecessor stated it as `blue`→**passing**, a word the board's `checkWord()` renders as `unknown`. The plan corrected its predecessor's error here. |
| `board.ts:705-707` filters the default branch | **TRUE** | `:705-707` is `tips.value.filter((tip) => tip.branch !== '' && tip.branch !== defaultBranch)` |
| `fleet.ts:1243` filters it again | **TRUE** | `:1243` `if (!short \|\| short === main) continue;` and the *"a row named `HEAD` that no reader can act on"* comment is at `:1239-1240` |
| `build` is a `RowKind` with no producer | **TRUE** | the only `'build'` kind literals under `packages/board/src/server/` are `mock-fleet.ts:184` and `:201` |
| `grep -ic deploy plot-host.sh` returns 0 | **TRUE**, reproduced |

**Could not verify:** every live reading — the `jen job list … -> null`, the `jen job view … -> color blue, lastBuild #938 SUCCESS`, the five-job `_class` listing, `jen auth status` signed in, and the `Quatico.Webseite/quaweb-website` config block. `jen` is not on PATH in this checkout and no Jenkins is reachable. This is expected and is the whole subject of my lens; it is not a criticism of the plan, which states plainly that these are live readings from another repository.

**One claim about this repository that is NOT verifiable and is presented as if it were:** the plan says *"the parent listing Plot already performs carries it [`_class`] for every job."* Plot's parent listing is `job list <container>` — which enumerates the **branch children** of the multibranch container. The `_class` values on those children are `WorkflowJob` (see the existing fixture, `test/reconcile/host.test.mjs:1505-1509`, five children all `WorkflowJob`). **The `_class` of the container itself is not in that array.** The five-job listing the plan quotes comes from `jen job list quaweb` — the listing of the *folder above* the configured instance path, which Plot performs nowhere. I flag this in §4; it is the specific place where the fixture story and the code story come apart.

## 2. Is the reasoning about `job list` → null / `job view` → state internally coherent?

**Yes, and the mechanism is the Jenkins REST model rather than a `jen` quirk**, which is what makes it credible without the live instance. `job list` is a children enumeration; `WorkflowMultiBranchProject` is a folder-like container with one child per branch; `WorkflowJob` is a leaf with no children. A leaf asked to enumerate its children returning `null` rather than `[]` is unremarkable for the Jenkins JSON API, where an absent `jobs` key deserialises to null.

The coherence check that matters for me is **whether the current code would misreport that payload the way the plan says**, and this I *can* reproduce without Jenkins, because `:757` is pure jq:

```
null                                          -> failed
[]                                            -> ok (array)
{"_class":"...WorkflowJob","color":"blue"}    -> failed
```

So **both** shapes a plain job could return — `null`, or a single object — fall through the guard to `failed`. The plan's conclusion that a plain job is indistinguishable from an unreachable Jenkins holds for either payload, which means the conclusion survives even if the exact live reading were misremembered. That is a genuinely robust piece of reasoning, and it is the opposite of the two rejected predecessors, whose central claims collapsed the moment one line was read.

Two coherence gaps, neither fatal:

- The plan never says what `job view` returns **on stdout in `--json` form**. It describes the payload in prose (`color blue, lastBuild #938 SUCCESS, duration 453365ms`) and the `Done when` names `color: blue` and `lastBuild.result: SUCCESS` as fixture fields. Those are two different shapes (`color` at top level *and* a nested `lastBuild.result`), and the implementer must pick which one the reading keys on. For a fixture-only gate, that choice is unfalsifiable here — see §4.
- The plan says the multibranch path stays "byte-identical" *and* that the shape is now read from the listing. Reading `_class` off the listing does not change the multibranch output, so the two are compatible — but only if `_class` is read from a call whose payload actually carries the container's class, which per §1 it does not.

## 3. Is the problem real and is the shape right?

**The problem is real**, and unusually well-evidenced for this subject: `job view` occurs zero times, the jq guard demonstrably fails a non-array, and `failed` is the same word an unreachable Jenkins produces. A team cannot tell a misconfigured instance from an unreadable job shape — and the operating team's own `AGENTS.md` finding, quoted in the Notes, is corroboration from outside Plot.

**The shape is right, and the scope discipline is the best thing in the plan.** "Make the reading possible" and "decide where it renders" are separated, with the destination problem (`board.ts:705-707`, `fleet.ts:1243`, `build` with no producer) named explicitly as *not this plan's*. That is the direct correction of the predecessor's fatal flaw, where every gate could pass while a user saw nothing.

**But from my lens that separation creates the plan's central testability problem, and the plan does not acknowledge it.** A plan that deliberately renders nothing has no user-visible outcome to test. Every gate is therefore internal, and every internal gate is met against a fixture the author wrote from a payload only the author has seen. The predecessor failed because *gates passed while nothing rendered*; this plan's answer is *rendering is out of scope*, which makes the same gap a feature rather than a defect. It is a better answer than the predecessor's, but it is not a complete one, because "did this actually fix the operator's board" remains unanswerable inside this repository by construction.

## 4. What does `Done when` fail to pin?

The harness exists and is good. `test/reconcile/host.test.mjs:1426-1487` gives `makeJenkinsRepo()` (a temp repo with a `## Plot Config` declaring `CI: jenkins` and a `Jenkins instance`), `makeJenStub()` (a PATH-stubbed `jen` recording argv to `jen.calls`), and `runJenkins()` merging the jen stub dir with the gh/bb stub dir onto `PATH`. `JEN_JOBS` at `:1504-1510` is already a frozen multibranch payload with percent-encoded names, a `red` child, and `_class` on every entry. Nine Jenkins tests already run against it, including the call-count gate at `:1614` and the unreachable-auth gate at `:1653`.

**So the fixtures this plan demands can be built.** That part of my lens comes back positive, and more strongly than I expected: the plan's `Done when` list maps almost one-to-one onto tests that already exist in the same file. Four of its gates are literally the existing tests re-run (`:1653` unreachable→failed, `:1614` one call per refresh, `:1594` percent-decoding, `:1517` red). A reviewer can be confident those are cheap and real.

**Five things the gates fail to pin.**

**(a) The stub is verb-blind, so "resolve through `job view`" is not actually gated.** `makeJenStub()` at `:1447-1466` parses argv down to a `group` and branches on `auth` vs `job` — it never looks at the *subcommand*. `job list` and `job view` both hit the same arm and both emit `jobsJson`. An implementation that called `job view` and one that called `job list` twice would be **indistinguishable** to the current stub. The gate `grep -c 'job view' plot-host.sh` is no longer 0 is a *grep on the source*, not a behavioural assertion — it is satisfied by the string appearing in a comment. **An implementer can satisfy every gate in the list while never issuing a `job view` call**, unless the stub is extended to tell the verbs apart and a test asserts on `jen.calls`. The plan should require that assertion by name; the harness makes it easy (`callsOf(jen.callsFile).find((c) => c.includes('job view'))`, the pattern already used at `:1622`).

**(b) `_class` is read from a listing that does not carry it.** Per §1: Plot lists the *container's children*, and their `_class` is `WorkflowJob` for every branch of a healthy multibranch job — see `:1505-1509`. If the implementation reads `_class` off the child entries, **every multibranch job looks like a plain job**, and the plan's own byte-identical gate would catch that only because the existing fixture happens to be an array (so the array guard still routes it down the old path first, depending on ordering). To read the *container's* class, Plot must either list one level up (a second call — which collides with the unchanged-call-count gate) or read it from `job view` on the container (also a second call, and a different verb than the plan describes). **This is the plan's one unexamined mechanism**, and it is exactly the class of error that sank both predecessors: a plausible sentence about a payload, unchecked against the call that actually produces it. It is disprovable here in about two minutes by anyone with the instance, and not at all by anyone without it.

**(c) The unrecognised-shape → `unknown` gate is the weakest link and is untestable as evidence.** The plan says a job whose `_class` is neither kind reads `unknown` rather than `failed`. A fixture proving this is trivial to write — invent a `_class` string, assert `unknown`. But the fixture proves only that the code does what the fixture's author decided; it says nothing about which `_class` values real Jenkins emits. There are many (`FreeStyleProject`, `MavenModuleSet`, `Folder`, `OrganizationFolder`, matrix configurations). A `FreeStyleProject` has a `color` and is perfectly readable through `job view`, yet under this plan it reports `unknown` and the user sees *cannot verify*. The gate as written is satisfied by the narrowest possible implementation, and the narrow implementation is a new silent-failure class for every Jenkins shape outside the measured two.

**(d) Nothing pins that the failure classes stay distinct in what a caller sees.** The plan's value claim is that a plain job stops being *misread as unreachable*. But `failed` and `unknown` both produce `map: {}` and both render rows `unknown` — see `:1653`, where an unreachable Jenkins yields `checks: 'unknown'`. So after this change, a plain job that is a recognised `WorkflowJob` reads its state, and one that is anything else reads identically to a dead Jenkins. The distinction the plan is named for is restored for exactly one shape.

**(e) The "verified separately on an instance" line is explicitly outside the gates.** The plan is candid about this, which I credit. But it means the single reading that would confirm the fix works — the operator's board showing deploy state — is a promise in prose with no owner, no recorded procedure, and no artefact. Given that this is the third plan in a week on this subject and the previous two died of unverified premises, a plan whose only real verification lives outside its gates should say *who* runs that check and *what they paste back into the plan*.

**The concrete way to satisfy every gate and still be wrong:** read `_class` off the child entries of the existing listing; find `WorkflowJob` there (true for every multibranch branch child); route to a `job view` code path that the verb-blind stub answers with the same array fixture; the array parses, the multibranch map comes out byte-identical, the call count is unchanged because the stub does not care, the `grep` for `job view` passes because the string is in the source, the invented-`_class` fixture passes because it was written to, the unreachable test passes because it was never touched, and `pnpm run test:contracts` is green. **Nothing in the gate list distinguishes that from a correct implementation**, and against a real plain job it would still return `null` and still report `failed`.

## 5. Is a frozen fixture evidence, or a restatement of the plan's assumption?

This is my lens's core question and it deserves a direct answer: **it is a restatement, and that is not automatically disqualifying — but it depends entirely on which claim the fixture is carrying.**

A fixture frozen from a live payload is evidence of *how the code behaves given that payload*. It is never evidence that the payload is what the service sends. For the multibranch half that distinction is harmless, because `JEN_JOBS` has been in the tree since the original Jenkins slice, nine tests ride on it, and it is corroborated by the sprint note at `docs/sprints/2026-W39-the-jenkins-team-sees-its-builds.md:135` recording an independent reading of percent-encoded children. It has been load-bearing and has not been contradicted.

For the plain-job half it is different. A new `job view` fixture would be **a single author's transcription of a single reading, frozen into a file that then defines correctness for everyone**. If the shape is wrong — `result` nested where the code expects it flat, `color` absent on a never-built job, a `lastBuild: null` on a job whose first build has not finished — the test passes and the code fails in production, and no one in this repository can tell. That is precisely the failure mode that produced two rejections in a week, relocated from the plan's prose into a test file, where it is harder to spot because a green suite reads as proof.

**What would convert restatement into evidence**, and what I would want the plan to require: paste the *raw* `jen job view … --json` stdout into the fixture verbatim as a captured artefact with its date and instance recorded beside it — the way `plot-host.sh:741` records *"measured live 2026-08-26: `Jenkins auth: OK — user@host`"* — rather than a hand-built object assembled from the prose description. The repository already has that habit; the plan should invoke it. A verbatim capture with provenance is still one instance's payload, but it is a *recorded* one, and a later reader can tell the difference between what was seen and what was assumed. The `Done when`'s phrasing — a fixture "carrying the measured `job view` payload (`color: blue`, `lastBuild.result: SUCCESS`)" — describes two fields, not a captured payload, and two fields is a summary.

## 6. The strongest argument against doing this at all

**It makes a reading that nothing reads.** The plan is explicit and correct that there is no destination: the default branch is filtered at `board.ts:705-707` and `fleet.ts:1243`, `checks` is a `PrRecord` field consumed per-PR, the default branch has no PR, and `build` is a `RowKind` with no producer. So on merge, `jenkins_build_map` can answer for a plain job and **not one pixel changes for the operator whose blank board started this**. The follow-up plan that adds the config key and the follow-up after it that finds a destination are both unwritten and unscheduled.

Against that: the reading genuinely is a prerequisite, the predecessor was rejected *for* bundling it with a destination, and a correct small step beats a large wrong one. The counter-argument I find harder to dismiss is narrower — **the work is being gated entirely by fixtures in a repository that cannot falsify them, to enable a feature with no consumer, on a subject with a two-for-two record of premises that did not survive contact with a live reading.** The cheapest responsible alternative is to spend one more live reading before writing any code: `jen job view quaweb/continuous-deploy --json` captured verbatim, and `jen job list quaweb/continuous-build --json` captured verbatim to settle whether the container's `_class` is reachable from the call Plot already makes. Both are one command each on the operator's machine. That is minutes of someone's time against the risk of a third plan in this series being wrong about a payload.

## Recommendation

The plan is markedly better than the two it supersedes: its central claim is verified, its snippet is verbatim, it corrects its predecessor's colour-vocabulary error, and it refuses the scope creep that killed the last one. The harness its fixtures need already exists and is good. I would not reject it.

I would amend it on four points, all small and all mechanical:

1. **Settle `_class`'s provenance before implementation** — confirm with one live `job list` capture whether the container's own `_class` is reachable from the call Plot already makes, or state that a shape probe costs a second call and reconcile that with the unchanged-call-count gate. This is the plan's one unexamined mechanism and the one most likely to be wrong.
2. **Make the verb a behavioural gate, not a grep** — require that `makeJenStub()` distinguish `job list` from `job view` and that a test assert on `jen.calls` that a plain job produced a `job view` and a multibranch job produced none. Replace `grep -c 'job view'` with that; a grep on source text is not a gate.
3. **Capture the `job view` payload verbatim with instance and date**, in the style of `plot-host.sh:741`, rather than describing two of its fields.
4. **Name the unrecognised-`_class` policy's cost** — a `FreeStyleProject` is readable and would report `unknown` under this rule. Either widen to "has a `color`, read it" or state deliberately that unmeasured shapes degrade, so the next reader knows it was chosen rather than overlooked.

Verdict: amend

testability: amend
