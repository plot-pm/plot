# Blast-radius lens — a-jenkins-job-is-read-by-its-shape

Read at `origin/main` = `bc4d00235`. Lens: this touches the ONE place Plot talks to a git host and CI, used by every adopting repository. I establish every caller, what each does with each status word, what a GitHub-only repo executes, and whether the byte-identical claims are pinnable.

## 1. Every factual claim about this repository, checked

| Claim | Verdict | Evidence |
|---|---|---|
| `jenkins_build_map()` at `plot-host.sh:756` makes the `job list` call | **TRUE** | `:756` is exactly `out=$(jen -I "$slug" job list ${job:+"$job"} --json 2>&1) \|\| true` |
| `:757` refuses anything not a JSON array | **TRUE** | `:757-759` is the `jq -e 'type=="array"'` guard printing `{"status":"failed","map":{}}` |
| The quoted 4-line `sh` block is verbatim | **TRUE** | Byte-for-byte `plot-host.sh:756-759` |
| "`plot-host.sh` never calls `job view`: zero occurrences" | **TRUE** | `grep -c 'job view'` = 0. The only `jen …job` call in the file is `:756` |
| Colour table `blue`→green, `red`/`yellow`→failing, `*_anime`→pending, `disabled`/absent→none | **TRUE** | `color_to_checks` at `plot-host.sh:781-787`; each arm pinned by a test (`host.test.mjs:1529, 1548, 1561, 1574`) |
| Percent-decoding of branch names | **TRUE** | `def urldecode` at `:779`, pinned at `host.test.mjs:1600` |
| Board has no default-branch row; `board.ts:705-707` and `fleet.ts:1243` filter it | **NOT INDEPENDENTLY VERIFIED** — out of my lens and I did not open those lines. Flagging as unchecked rather than asserting. |
| `_class` appears nowhere in `plot-host.sh` | **TRUE, and I add it** — `grep -c _class plot-host.sh` = 0. The field exists in the *payload* but the script reads only `.name` and `.color`. This strengthens the plan: the shape is genuinely discarded today. |

**What I cannot check:** every `jen` reading (`job list` → `null`, `job view` → `color blue`, the five-job `_class` listing, `jen auth status`). No Jenkins instance is reachable from here. The plan is explicit about this and I do not hold it against it — but see §5.

## 2. Is the reasoning internally coherent?

**Yes, and it is the first plan in this series whose mechanism matches what the code does with the answer.** The chain holds: `job list` on a childless `WorkflowJob` returns `null` → `:757`'s `type=="array"` guard rejects `null` → `failed` → the overlays at `:2803` and `:2902` both test `if $jstatus != "ok" then "unknown"` → every row reads `unknown`.

That last hop is where the defect becomes severe, and **the plan understates it.** `packages/domain/src/rules/checks-reading.ts` holds `checksUnaskable`:

```ts
export const checksUnaskable = (readings: readonly ChecksReadings[]): boolean =>
  readings.length > 0 && readings.every((one) => one.checks === 'unknown');
```

A plain-`WorkflowJob` repo hits this on **every** PR, so the board prints the connector-level sentence *"The host cannot report check states… This is a fact about the connector, not about the work."* That sentence is **false** in this case — the connector is reachable, signed in, and answering. The plan's *"indistinguishable from an unreachable Jenkins"* is true at `plot-host.sh` and becomes an actively wrong sentence rendered to a reader two layers up. This is an argument **for** the plan, and the plan does not make it.

## 3. Is the problem real, and is fixing the reader separable from deciding where it renders?

**The problem is real.** Independent of any Jenkins measurement: `jenkins_build_map` reads `.name` and `.color` and nothing else, and the array guard collapses `null` into the same word as an unreachable host. The `unknown` path is a proven dead end downstream — `checks-reading.ts` exists *because* `none` vs `unknown` collapsing is a known defect class here.

**The separation is genuinely clean, and I verified the boundary rather than trusting it.** `jenkins_build_map` has exactly two callers: `:2711` (`pr-list --rich`) and `:3017` (`runs`). Both consume `{status, map}` and neither reads `.color` or the job shape. A plain job appearing in `map` keyed by branch flows through the existing join with no new render site. Nothing needs a new row to benefit — the `runs` op and the `pr-list` overlay both improve immediately.

**But the plan's scope claim "it does not change the multibranch path" is separately at risk from a site it never mentions.** See §4.

## 4. What `Done when` fails to pin — the blast-radius findings

### 4a. THE COUNTING GATE IS ALREADY DEFEATED. This is the strongest finding.

The plan gates: *"the number of `jen` calls per refresh is unchanged for a multibranch job and pinned by counting."* **Every existing count assertion filters on the literal string `job list`:**

- `host.test.mjs:1617` — `.filter((c) => c.includes('job list'))`, asserts `1`
- `:1630`, `:1691`, `:1733`, `:1813` — same filter

A `job view` call is **invisible to all five**. An implementation that calls `job list` once *and then* `job view` per branch passes every one of them. The gate as written ("pinned by counting") is satisfiable by a test that counts the wrong thing, and the repo's own existing tests are that test. **The gate must count total `jen` invocations, not `job list` lines** — and that requires editing five existing assertions, work the plan does not name.

### 4b. THE `jen` STUB CANNOT TELL `job list` FROM `job view`.

`makeJenStub` at `host.test.mjs:1440-1470` routes on the *group* word only:

```sh
if [ "$group" = job ]; then
  printf '%s' '<jobsJson>'
  exit <jobListExit>
fi
```

`job list` and `job view` both match `$group = job` and both return the **same array**. So a new `job view` fixture cannot be expressed without rewriting the stub to dispatch on the subcommand. The plan's Done-when asks for *"a fixture carrying the measured `job view` payload"* as if it were an addition; it is a harness change to a shared helper used by ~15 tests. Not a blocker — but the plan's implied cost is wrong, and a worker under budget pressure will reach for the path of least resistance, which is exactly 4a.

### 4c. THE EXISTING FIXTURE'S CHILDREN ARE `WorkflowJob` — the class the plan routes to `job view`.

`JEN_JOBS` (`host.test.mjs:1505-1511`) carries five children, **every one** `_class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob'`. That is correct and matches Jenkins — a multibranch job's branch children *are* `WorkflowJob`s. **So the `_class` test must be applied to the job being asked about, never to entries in the returned listing.** An implementation that reads `_class` from the array elements would see `WorkflowJob` five times and route every branch child to `job view` — five extra calls, the multibranch path destroyed, and 4a's gate still green. This is the single most likely way to satisfy every stated gate and be wrong, and the plan's own prose invites it: *"the parent listing Plot already performs carries it for every job."* The **parent's own** `_class` is what matters, and it is not in the child array at all.

### 4d. A SECOND JOB-RESOLUTION SITE ALREADY EXISTS AND SOLVES THIS DIFFERENTLY. The plan never mentions it.

`plot-host.sh:3124-3140`, the `run-for-sha` Jenkins arm, faces the identical question and answers it with an explicit refusal to read the shape:

```
# A BRANCH IS A JOB SEGMENT ON A MULTIBRANCH JOB AND NOT ON A PLAIN
# ONE, and no reading of the configured path says which this is. So the
# multibranch URL is tried first and the plain one is the fallback
```

It tries `job/…/job/<branch>` then falls back to `job/…`, against Jenkins' **REST API with a keychain credential** (`:3113`), because `jen` cannot answer shas. So after this plan lands, `plot-host.sh` holds **two different mechanisms for "is this job multibranch or plain?"** — `_class` via `jen` in `jenkins_build_map`, and try-then-fallback via `curl` in `run-for-sha`. Neither is wrong. But the estate's own rule (*One answer to "did this land"*, `CLAUDE.md`) is precisely against two implementations of one question. The plan should either name this as accepted duplication with a reason, or state why `run-for-sha` is out of scope. It does neither, and a reviewer of the resulting diff has no way to know the second site was considered.

### 4e. "Byte-identical" is not pinnable as stated — but a stronger gate is available.

The Done-when says the multibranch branch→checks map is *"byte-identical to today's, pinned by a fixture."* A fixture pins **that fixture's** output, not byte-identity of the code path. Since `jq` object key order is insertion-ordered and the map is built via `from_entries`, a reordered jq program could produce different bytes with identical semantics — or identical bytes from a path that now makes an extra network call (4a). **The pinnable form is: capture `jenkins_build_map`'s full stdout for the existing `JEN_JOBS` fixture on `origin/main`, commit it as a golden string, and assert equality.** That is cheap, it is genuinely byte-level, and it is what the phrase promises.

### 4f. Unnamed: the `runs` op's behaviour change.

`runs` (`:3017`) exits **4** when status is not `ok` (`:3026`). Today a plain-job repo gets `exit 4` from `runs`; after this plan it gets a one-entry history. That is the desired outcome, but it is a **contract change on a second op** and appears in no Done-when clause. `packages/domain/src/adapters/build/build-jenkins.ts` reads that exit code through `buildReads`, mapping 4 to `unaskable`. A repo that currently renders *"cannot be asked"* will start rendering a state. Correct — and untested by anything the plan names.

### 4g. Unnamed: the `unknown` widening.

The plan adds a **new** producer of `unknown`: *"a job whose `_class` is neither kind is read as unknown rather than failed."* I agree with the direction. But `unknown` is not inert downstream — it flows to `checksProminence` → `'note'` (`checks-reading.ts:92`) and feeds `checksUnaskable`, which fires on **all-unknown** and prints a connector-level accusation. An org with, say, a `FreeStyleProject` would now get a *different* wrong sentence instead of the current one. Better than today, still not right, and not gated.

## 5. Blast radius for repositories that have no Jenkins — my lens's core question

**This is the plan's strongest property, and it holds under verification.** A GitHub-only or Bitbucket-only repository executes **none** of the changed code:

- `jenkins_build_map` is reached only from `:2711` and `:3017`, both inside `if [ "$ci" = "jenkins" ]` / `case … jenkins)`.
- `ci_scheme()` must return exactly `jenkins`. A repo declaring `github-actions` or nothing takes the `statusCheckRollup` arm at `:2825+` (GitHub) or the `checks: unknown` arm at `:2925+` (Bitbucket).
- This is already pinned: `host.test.mjs:1671` asserts a non-Jenkins repo calls `jen` **zero** times and reads its rollup unchanged.
- The `run-for-sha` GitHub arm is a separate `case` branch and is untouched.

**The `--rich` arm itself is not being changed** — only the payload one of its inputs produces. `mergeable`, `review`, `url`, `failing_checks` and the GitHub rollup collapse are all outside the diff.

**Risk to a non-Jenkins adopter: low, and structurally so** — gated by a config-key equality test, with an existing regression lock. My only residual concern is 4c: an implementation that reads `_class` from array elements changes behaviour for **multibranch Jenkins users**, who are today's *working* population. That is the real blast radius here: not GitHub repos, but the repos the current code serves correctly.

## 6. The single strongest argument against doing this at all

**Third plan in one week on one subject, and this one still cannot be verified where it is built.** Its central readings come from an instance nobody reviewing it can reach, and its Done-when concedes the end-to-end property is *"not in the slice's gates."* The two predecessors were rejected for premises a single live reading would have disproved — and the corrective this time is fixtures that encode **the same unverifiable readings**, written by the same session that took them. A fixture asserting `job view` returns `{color: 'blue', lastBuild: {result: 'SUCCESS'}}` proves the parser handles that shape; it proves nothing about whether Jenkins emits it. If the shape is wrong, the tests are green, the plan delivers, and the operating team sees no change — the third failure in a row, this time with a passing suite behind it.

**Why I do not find that decisive:** the *defect* does not depend on any Jenkins reading. `jq -e 'type=="array"'` collapses a non-array answer into `failed`, and `_class` appears zero times in the file — both checkable here, both true. The plan is right about the code even if it were wrong about Jenkins, and the `checksUnaskable` consequence (§2) makes the current state worse than the plan claims.

**Second-strongest:** the plan sequences a reader fix ahead of a render decision and argues the destination problem sank its predecessor. Sound — but nothing in it commits to the second plan, and a reader whose output no row displays is improvement that no operator observes. The `runs` op (4f) is the partial answer, and the plan does not use it.

## What would move me to `proceed`

Amend the Done-when to pin what the gates currently miss:

1. **Count every `jen` invocation, not `job list` lines** — and say the five existing assertions (`host.test.mjs:1617, 1630, 1691, 1733, 1813`) are being changed, because they are the gate 4a defeats.
2. **State that `_class` is read from the job being asked about, never from the returned listing's entries** — with a test proving the `JEN_JOBS` multibranch fixture (whose five children are all `WorkflowJob`) still makes exactly one call. Without this clause 4c is the likely implementation.
3. **Replace "byte-identical … pinned by a fixture" with a golden-string assertion** captured from `origin/main` (4e).
4. **Name `run-for-sha` at `plot-host.sh:3124`** — either as out of scope with a reason, or as accepted duplication of the shape question, so a reviewer knows it was seen (4d).
5. **Add the `runs` contract change** (`exit 4` → one-entry history) as an explicit gate (4f).

Every one of these is a wording change to `Done when` plus one test. None changes the plan's shape, its slice count, or its argument — which is why this is `amend` rather than `reject`. The diagnosis is correct and better than the plan states; the gates do not yet stop the implementation that would satisfy them wrongly.

Verdict: amend
