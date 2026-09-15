# Verifiability lens — setup proves the Jenkins job answers (#913)

## Summary

The infrastructure this plan needs **exists and is good** — `test/reconcile/host.test.mjs` carries a mature `jen`-stubbing harness, so the fixtures are buildable. That is the one thing the rejected `the-deploy-job-shows-on-main` failed on, and this plan does not fail on it.

It fails on something worse: **I ran the plan's central measurement and it came back false.** The `Done when` clause pins a behaviour the estate does not produce, so an implementation greening that gate is pinning a fiction — and the fixture carrying it is exactly the "readings only their author took" failure #913's siblings were rejected for.

---

## 1. Factual claims — one verified, one FALSIFIED, one unverified

### TRUE: the `plot-host.sh:702-708` quotation

`skills/plot/scripts/plot-host.sh:702-708` reads verbatim:

> `$1 = Jenkins instance value from config: `<slug>` or `<slug>/<job/path>`. The slug is what `jen -I` takes; the remainder (after the first `/`) is the multibranch job's container path.`

and `:708`: `A job path in PLOT_JENKINS_JOB overrides, for a caller that has it separately.` Both citations are accurate, including the line numbers.

### TRUE: setup checks reachability only

`skills/plot/scripts/plot-board-probe.sh:247-262` is the whole Jenkins check:

```
jen_instance=$(bash "$here/plot-config.sh" get "Jenkins instance" "")
out=$(jen -I "$jen_instance" auth status 2>&1); st=$?
jen_auth=$(classify "$out" "$st" 'jenkins auth:[[:space:]]*reachable')
```

It asks `auth status` and nothing else. No `job list`, no `job view`, no resolution of the job path. `skills/plot-board-setup/SKILL.md:387-393` then renders that value as `ok`/`failed`/`unknown`. **The diagnosis that setup asks reachability and reports on usefulness is correct.**

### FALSIFIED: "a slug-only value resolves ZERO branch jobs"

This is the plan's load-bearing claim and the subject of its first `Done when` clause. **I ran `jenkins_build_map` against a slug-only value with a root listing shaped like a real Jenkins root.** Method: `awk`-extract the function from the real source (the same technique `host.test.mjs:1981` uses), PATH-stub `jen`, root listing returns two top-level folders:

```
$ PATH=/tmp/jentest:$PATH bash run.sh .../plot-host.sh "ci.test"
{"status":"ok","map":{"quaweb":{"color":null,"checks":"none","job":"quaweb"},
                      "webbloqs":{"color":null,"checks":"none","job":"webbloqs"}}}
```

**`status: "ok"`, and a map with TWO entries.** Not zero. Not `failed`. Not `unknown`.

The reason is `plot-host.sh:754-812`: `jen -I "$slug" job list ${job:+"$job"} --json` with an empty `$job` lists **the root's children**, which on a real Jenkins are its top-level folders. Those parse as a valid array, so every downstream guard passes and `from_entries` builds a map keyed by folder name.

The board then shows `checks: unknown` for every PR not because the map is empty, but because **the map is keyed by `quaweb`/`webbloqs` and the board looks up `feature/my-branch`.** A populated map with the wrong keys.

This is confirmed by `ci-scheme.test.mjs:160-175`, which already knew:

> *"`quaweb` is nested — `job/quaweb/job/release` — so a prose-derived slug alone degrades to root-scope listing, where `jenkins_build_map()`'s own comment says every branch reads `none`."*

**Every branch reads `none` — via a non-empty map.** The estate documented this and the plan's gate contradicts it.

Zero entries happens only when the root listing is a genuinely empty array:

```
$ # jen job list --json returns []
{"status":"ok","map":{}}
```

which is a Jenkins with **no jobs at all** — a shape the plan itself calls legitimate ("a fresh multibranch container has no children").

### UNVERIFIED: the `pr-list --rich` measurement table

The Design table ("slug only → **no rows**; `<slug>/quaweb/continuous-build` → 4 PRs, all green") is a reading only the author took, on an instance nobody here can reach. "No rows" is also not a shape `jenkins_build_map` produces for the slug-only case — it returns `ok` with a populated map. Whatever produced "no rows" happened further downstream, or on a different configuration than the one described. **Unverified, and inconsistent with the function's measured behaviour.**

---

## 2. Is the diagnosis right?

**The disease is real; the mechanism named is wrong, and the wrong mechanism is what the gates encode.**

Right: setup verifies reachability and reports the configuration verified. `plot-board-probe.sh:247-262` proves it. A slug-only value does produce a board with no usable build state. #913 is a real defect and worth fixing.

Wrong: *"Without the path, Plot looks for branch jobs at the Jenkins root and finds none."* It looks at the root and **finds the root's folders** — a confident, well-formed, entirely useless answer. The distinction is not pedantic: it is the difference between a check that fires and one that never does.

**"Asking whether it answers cannot refuse a working configuration"** — the plan's argument for asking over shape-checking — is true but does not reach the defect, because the broken configuration *also* answers. It answers `ok`.

---

## 3. What `Done when` fails to pin — and how to green every gate while shipping nothing

### The zero-branch-job gate cannot fire on the reported defect

> *"a slug-only value against a real multibranch container resolves **zero branch jobs and setup says so**, pinned by a fixture carrying the measured empty answer"*

Measured above: a slug-only value against a real instance resolves `{"status":"ok","map":{<folders>}}`. To pin "zero", the fixture must stub `job list` returning `[]` — **a Jenkins with no jobs**, which is the case the plan elsewhere says is legitimate and must not be flagged.

**So the gate is greened by a fixture describing a different repository than the one in #913.** An implementation that reports "zero branch jobs" only on an empty array passes every clause, ships, and the #913 configuration sails through setup reporting green exactly as it does today. The fixture proves the check works on a case that was never broken.

### The override gate and the zero-job gate demand opposite behaviour on identical bytes

Measured, same harness:

```
slug-only, empty listing:                  {"status":"ok","map":{}}
slug-only + PLOT_JENKINS_JOB=quaweb/...:   {"status":"ok","map":{}}
```

**Byte-identical.** (The second is `{}` because the stub's `job list <path>` returned `[]` for that path; the point stands — the payload carries no trace of which case produced it.)

The plan requires:
- zero branch jobs → **report it**
- slug-only + `PLOT_JENKINS_JOB` set → **NOT refused**, "pinned explicitly"

An implementation reading only the payload cannot distinguish them. It must read `$PLOT_JENKINS_JOB` from the environment separately — which is a **shape/presence check on a variable**, the very move the Design section rules out as "explicitly not the fix". The plan forbids the only mechanism that satisfies its own two clauses.

And `PLOT_JENKINS_JOB` has **no test anywhere in the estate**: `grep` over `test/` returns nothing; its only live references are `plot-host.sh:758-759` and `:3197`. The plan asks a gate to be built on an untested variable whose interaction with the payload it has not examined.

### An agent could green everything without exercising the real path

Concretely, and I believe this is the likely outcome:

1. Add a `jen job list` call to the setup flow. Stub `job list` → `[]`; assert setup reports zero jobs. **Gate 1 green.**
2. Stub `job list` → `JEN_JOBS` (the 5-branch fixture at `host.test.mjs:1534`); assert setup reports them. **Gate 2 green.** Note this fixture is the *multibranch* listing — reached only when a job path is configured — so it tests the path that already worked.
3. Set `PLOT_JENKINS_JOB` in the env, assert no refusal. **Gate 3 green** — trivially, since nothing refuses on shape anyway.
4. Assert adoption continues past zero jobs. **Gate 4 green** — it continues today; nothing is added.
5. Assert a repo with no `Jenkins instance` key is unaffected. **Gate 5 green** — `plot-board-probe.sh:251` already branches on `[ -n "$jen_instance" ]`.
6. No new config key. **Green** — none added.
7. `pnpm run test:contracts` passes.

**All seven clauses green. The #913 configuration still passes setup reporting healthy**, because nothing in that list ever asks the one question that separates it: *do the keys in this map look like branches, or like folders?*

### What the gates fail to pin — the actual discriminator

Nothing requires setup to inspect **what came back**. The defect is a populated map whose keys are not branch names. A check that would catch it: resolve the map, take the repository's own branches (`git branch -r`, which setup has for free), and report when **no configured branch appears as a key**. That is measurable, fires on exactly the #913 shape, is silent on a genuinely empty container, and needs no environment variable.

The plan never proposes it, because it believes the map is empty.

### The out-of-gate clause

> *"**Verified separately on an instance declaring `CI: jenkins`** … That cannot be checked in this repository … and is not in the slice's gates — the fixtures carry the measured payloads instead."*

Honest, and I do not fault the carve-out in principle — `CI: github-actions` is declared in `CLAUDE.md` and there is no Jenkins here. But it moves the **only** step that would have exposed the falsified premise outside the gates, and hands the remaining weight to fixtures encoding that premise. Given gate 1 is unfireable on the real shape, what remains inside the gates is **not enough to call the slice done**: every clause can pass while the reported defect is untouched.

---

## 4. Strongest argument against doing this at all

**The estate already knows the answer and states it in a comment that nothing reads.**

`plot-host.sh:637`: *"degrades `jenkins_build_map()` to root-scope listing, where its own comment says every branch reads `none`"* — and `ci-scheme.test.mjs:160-175` reasons about it in a passing test. The condition is understood, documented, and **derivable from the config string alone**: a value with no `/` degrades to root scope.

Setup already has that string (`plot-board-probe.sh:248`). A one-line report — *"`Jenkins instance: apps` names no job path; branch builds resolve at the root and every PR will read `unknown`. If `PLOT_JENKINS_JOB` is set in the board's environment this is fine; otherwise append the container path."* — costs no `jen` call, no fixture, no rate limit, cannot be wrong about reachability, and **fires on exactly the #913 configuration**.

The plan rejects this as "a shape check" on the grounds that `PLOT_JENKINS_JOB` makes slug-only legitimate. But it is a **report**, not a refusal, and the plan's own section "An empty answer is reported, never refused" establishes that reporting-without-refusing is the accepted register. A report that names the override as the escape hatch is wrong in no configuration.

Against that: the proposed live call adds a `jen job list` round trip to every adoption, on a connector that `CLAUDE.md` says owns a rate limit and an account, to obtain a payload that — measured — does not distinguish the broken case from the legitimate one.

**Secondary:** this is the fourth Jenkins plan this week and the third whose premise did not survive checking. Three were rejected for false premises. The estate declares `CI: github-actions` and has no Jenkins; every measurement behind them is single-author and unreproducible here. That is a pattern about how these plans are being measured, not about any one of them — and #913 is a real user-facing defect that deserves a plan built on a reading someone else can repeat.

---

## What would make me say proceed

1. **Re-measure `jenkins_build_map` against a slug-only value on the real instance** and paste the payload. If it genuinely returns `{"map":{}}` there, my objection collapses and the gates are close to sound — but then the "no rows" table needs re-examining too, since `ok` with an empty map is not "no rows".
2. **Replace gate 1** with the discriminator that fires on the real shape: *no branch of this repository appears as a key in the resolved map*. That is fixture-buildable with `makeJenStub` today.
3. **Resolve the override contradiction** — either drop the `PLOT_JENKINS_JOB` clause, or accept that satisfying it requires reading the variable and say so in the Design.
4. Keep the harness choice. `host.test.mjs:1452` (`makeJenStub`) and `:1981` (the `awk`-extract-from-real-source runner) are the right tools, and the `awk` lift is genuinely a gate — a pasted copy of the function would pass forever, and it cannot.

The testability of this plan is fine. Its premise is not.

Verdict: amend
