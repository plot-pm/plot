# Panel — a-jenkins-job-is-read-by-its-shape

Subject: `docs/plans/2026-09-15-a-jenkins-job-is-read-by-its-shape.md` (Draft, `Rounds: 1`)
Lenses: premise, blast-radius, testability. Reconciliation: **unanimous — amend**.

## The premise survives reading — the first of four on this subject that does

**Every in-repo claim verified TRUE by all three jurors independently**, at
`bc4d0023`: `plot-host.sh:756` (the `job list` call, quoted verbatim), `:757-759`
(the `jq type=="array"` guard printing `failed`), `grep -c 'job view'` = **0**,
the colour table at `:778-787`.

Two jurors added supporting facts the plan did not claim:

- **`grep -c _class plot-host.sh` = 0** — the shape is genuinely discarded today.
- **`testability` reproduced the jq guard standalone**: `null` → failed, a single
  object → failed, `[]` → ok. **So every shape a plain job could return falls
  through to `failed`** — the conclusion survives even if the exact live reading
  were misremembered. That is the opposite of both predecessors, whose claims
  collapsed on one line read.

## The defect is worse than the plan states, and two jurors traced it further

`premise` followed the status word to its consumers; `blast-radius` went two
layers higher.

- `plot-host.sh:2717` and `:3024` print *"jenkins unreachable"* — **about a
  reachable, signed-in Jenkins**.
- `:3025` exits **4**, which `build-shell.ts:139-145` converts to **`unaskable`,
  `refusal: null`** — deliberately not a refusal, because `:133-135` defines
  exit 4 as *"a standing configuration fact, not an incident worth waiting out"*.
  **The one signal a team could retry on is discarded by design.**
- `blast-radius` went further: `checks-reading.ts`'s `checksUnaskable` fires when
  **every** PR is unknown, so a plain-job repository gets the board printing
  *"The host cannot report check states… a fact about the connector"* — **false
  when Jenkins is reachable and signed in.**

**This answers the first rejection's open question.** The config is fine; this is
why the board is blank anyway.

## The blast radius is low, and that is structural rather than lucky

`jenkins_build_map` has exactly **two** callers (`:2711` `pr-list --rich`,
`:3017` `runs`), both inside `ci = jenkins` guards. A GitHub or Bitbucket
repository takes untouched arms, and `host.test.mjs:1671` already locks *"jen
called zero times"*.

**The real exposure is the population the code serves CORRECTLY today** —
multibranch users — through the finding below.

## The decisive finding: all three jurors found the same mechanism error

**And it is the error class that sank both predecessors, surviving into the plan
written to correct them.** It was caught before dispatch and fixed mid-panel
(`b34299b7e`); this moderation records it because the near-miss is the point.

`job list <container>` returns the container's **children**, and
`host.test.mjs:1505-1509` gives **all five children of a multibranch container**
`_class: …job.WorkflowJob` — identical to a plain job's own class. Confirmed
live: every child of `quaweb/continuous-build` carries exactly that.

**So reading `_class` off the returned array routes a healthy multibranch job to
`job view`, destroys the CI half that works today, and every gate stays green.**
The deciding `_class` belongs to the job **asked about** and appears in its
parent's listing — the plan's own five-job table, a call `plot-host.sh` does not
make.

**The plan now states this explicitly.** The gate demanded here is the one that
refuses the wrong reading, not merely prose describing the right one.

## The gates were defeatable, and three jurors found overlapping holes

**The counting gate was already defeated.** `blast-radius` enumerated **five**
existing count assertions (`host.test.mjs:1617, 1630, 1691, 1733, 1813`), all
filtering on the literal string `'job list'`. **A `job view` call is invisible to
every one of them** — an implementation calling `job list` once and `job view`
per branch passes all five, against Jenkins' declared limit of 60. *"Pinned by
counting"* must mean **total `jen` invocations**, and five assertions need
editing: work the plan did not name.

**The stub is verb-blind.** `makeJenStub()` (`:1447-1466`) branches on
`group == "job"` and never reads the subcommand, so `job list` and `job view`
return the same array. **And `grep -c 'job view'` is a grep on SOURCE, satisfied
by the string in a comment.** `testability` assembled the full green-suite
failure: read `_class` off the children, find `WorkflowJob`, route to a `job view`
path the stub answers with the same array, multibranch output byte-identical,
count unchanged, grep passing — **and a real plain job still returns `null`.**

**A second job-resolution site is unmentioned.** `plot-host.sh:3124-3140`,
`run-for-sha`, faces the identical multibranch-or-plain question and answers it
by **explicitly refusing to read the shape** — try the multibranch URL, fall back
to plain, via `curl` against Jenkins REST. After this lands the file holds **two
mechanisms for one question**, which the estate's *One answer* rule says must be
named or scoped out. The plan does neither.

**`failed` and `unknown` both yield `map:{}`** and both render rows `unknown`, so
the distinction the plan is named for is restored for exactly one shape.

## The shared blind spot — what all three could not do

**None of them could reach the Jenkins instance.** All three said so plainly
rather than inferring, which is the discipline the two rejections lacked. But it
leaves the sharpest objection standing, `testability`'s:

> Fixture-gated work in a repository that cannot falsify the fixtures, for a
> feature with no consumer, on a subject 0-for-2 on premises surviving a live
> reading.

**For the multibranch half the fixture is corroborated** — nine tests ride on
`JEN_JOBS`, plus an independent reading in a sprint doc. **For the plain-job half
it is a restatement**: one author's transcription frozen into the file that then
defines correctness. And the `Done when` asks for *"the measured payload
(`color: blue`, `lastBuild.result: SUCCESS`)"* — two fields, a **summary**, and
structurally inconsistent (top-level `color` **and** nested `lastBuild.result`).

**Capture the raw `--json` stdout verbatim, with instance and date** — the habit
`plot-host.sh:741` already models.

## The separation is genuine, and all three agree

A rendered state needs three edits in another package (both default-branch
filters plus a `rowKind` producer); the reader fix needs none. Both callers
consume only `{status, map}` and neither reads `.color` or the shape. **Fixing
the reader first is the right order given two rejections inherited the
destination problem.**

## What this panel asks for

1. **Total-`jen`-call counting**, naming the five assertions that change.
2. **Teach `makeJenStub` to tell `list` from `view`**, and assert on `jen.calls`
   rather than a source grep.
3. **Capture the `job view` payload verbatim**, with instance and date.
4. **Name `run-for-sha`** — reconciled or scoped out.
5. **Gate the `runs` contract change** (exit 4 → a line for a plain job).
6. **Name the unrecognised-`_class` cost** — a `FreeStyleProject` has a colour and
   would report `unknown` — or widen to *"has a colour, read it"*.

**Strongest of the three plans, and still not dispatchable.** `premise` put it
exactly: *"the diagnosis is correct and better than the plan states; the gates do
not yet stop the implementation that would satisfy them wrongly."*
