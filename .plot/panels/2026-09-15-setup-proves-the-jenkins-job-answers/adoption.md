# Adoption lens — setup-proves-the-jenkins-job-answers (#913)

Read `/plot-board-setup` whole (498 lines) as an adopting team would. Cannot reach a Jenkins instance; every claim below is from the repository at `origin/main`.

## 1. Factual claims

**The `plot-host.sh:702` citation is right, and the plan's own paraphrase of it is not the line.** `:702` reads ``# $1 = Jenkins instance value from config: `<slug>` or `<slug>/<job/path>`.`` and `:703-704` carry *"The slug is what `jen -I` takes; the remainder (after the first `/`) is the multibranch job's container path."* The plan quotes this as one block attributed to `:702` — the sentence spans `:702-704`. Cosmetic.

**`:704-708` supports the "no new config key" claim exactly as cited.** `plot-host.sh:706-708` — *"so the container travels here, on the instance value, WITHOUT a new config key … A job path in `PLOT_JENKINS_JOB` overrides."* True.

**What setup checks today — verified, and the plan's characterisation is correct.** The Jenkins path through the skill is three touchpoints and none of them asks a job anything:

- `skills/plot-board-setup/SKILL.md:272-281` — *asks* for the instance when `jen` is installed and a `Jenkinsfile` exists. Unattended it refuses the key, and the disclosure line already names the exact trap: *"a guessed slug buys a green light that verifies nothing"* (`:277-278`).
- `SKILL.md:319-320, 332-335` — writes `CI:` and `Jenkins instance:` and says *"the board does not yet render Jenkins status."*
- `SKILL.md:391-399` (step 4a) — reports `plot-board-probe.sh`'s `jen.auth` value only.

The probe's `jen` check is `plot-board-probe.sh:247-257`: `jen -I "$jen_instance" auth status`, classified on the `Jenkins auth:` wording. **It takes `$jen_instance` whole**, and `jen -I` ignores everything past the slug. So a slug-only value and a `<slug>/<job>` value produce the byte-identical probe answer. The plan's *"setup asked the first [reachability] and reported on the second [usefulness]"* is accurate.

**UNVERIFIED — and this is the load-bearing one.** The plan's measurement table (slug only → **no rows**; `<slug>/quaweb/continuous-build` → 4 PRs green) comes from #913 on a live instance. I cannot reach Jenkins. But I can check what the code *would* do, and **it does not match the plan's stated mechanism**:

`jenkins_build_map` (`plot-host.sh:754-893`) on a slug-only value sets `job=""` (`:760-764`, comment: *"list at the root scope"*), skips the shape probe (`:796`, guarded on `[ -n "$job" ]`), falls to `''` in the case (`:833-839`), and runs `jen -I "$slug" job list --json` **with no path** (`:850`). On a real Jenkins root that returns the top-level folders — a non-empty array. So the function returns **`status: ok` with a non-empty map whose keys are folder names, none of which is a branch**.

The plan says the fix is *"a setup that runs the same resolution and finds **zero branch jobs** has its answer."* On the measured configuration (`quaweb` nested under `job/quaweb/job/release`, per `plot-host.sh:638-639`) the root listing is almost certainly **not** zero entries — it is a non-empty list of the wrong things. `pr-list --rich` showing "no rows" is consistent with this: the rows are keyed by branch and no folder name matches a branch, so every lookup misses. **"Zero branch jobs" and "a map full of non-branch entries" are different observations, and the plan's whole Done-when is written against the first.** A check implementing the plan literally — count the map, report if zero — passes green on the exact configuration that filed the ticket.

**Also unverified and worth naming:** the plan says *"It does not change `plot-host.sh`. The resolution is correct."* `:760-764`'s own comment concedes the root-scope path is a degradation — *"otherwise no branch matches and every row reads `none` — honest, and the open point's fallback."* Whether "correct" survives contact with #913 is a premise lens question; I flag that the adoption check is being asked to compensate for a resolver the plan declares out of scope.

## 2. Diagnosis

**Right about the gap, wrong about where the signal lives.** Setup genuinely reports verified on a reachability check that cannot see the job path — that is real and `SKILL.md:391-399` is the proof. But the estate already knows how to say this, and the plan did not find it: `plot-host.sh:3198-3205`, the `run-for-sha` op, **already refuses a bare-host instance by name**:

```
plot-host: run-for-sha — the Jenkins instance names no job path
  A sha is a fact about a job's builds, so the instance must be
  <slug>/<job/path> rather than a bare host.
```

That is the finding the adopter in #913 needed, it is already written in this repo's own words, and it is reachable by string inspection with no Jenkins call at all. The plan explicitly rules this out — *"A shape check is explicitly not the fix"* — on the grounds that `PLOT_JENKINS_JOB` makes a slug-only value legitimate. **That argument proves too much.** `run-for-sha` handles the same override at `:3197` (`[ -n "${PLOT_JENKINS_JOB:-}" ] && _jen_job="$PLOT_JENKINS_JOB"`) and *then* refuses only if the job is still empty. Shape-plus-override is not a shape check; it is the check the estate already ships, and it would have caught #913.

## 3. What `Done when` fails to pin

- **The passing condition is unreachable as written.** "Zero branch jobs" against a real multibranch container: per `:760-764`, a slug-only value never lists that container, it lists the root. The fixture pinning "the measured empty answer" will therefore encode a payload the live defect does not produce. Nothing in the Done-when pins *what setup does with a non-empty map of non-branch entries*, which is the actual #913 state.
- **No distinguishing rule between the two zero-cases.** The brief asks whether a fresh container is distinguishable from a broken config. The Done-when requires both to be "reported and adoption continues" and pins no difference in wording, so the check emits one sentence for two causes.
- **No unattended shape.** Every question site in this skill carries a `PLOT_UNATTENDED` clause with a `PLOT-UNASKED:` line (16 occurrences; `SKILL.md:275-281` is the Jenkins one), and `test/reconcile/unattended.test.mjs` sweeps all skills structurally. If the Open Question resolves to *pause*, a new question site lands with no declared shape and that suite is the gate it meets. The Done-when names `pnpm run test:contracts` — which is exactly `test/reconcile/*.test.mjs` — without naming this obligation.
- **"Pinned by a fixture" names no fixture location.** There are **zero** Jenkins fixtures in `test/` today (`find test -iname '*jenkins*'` → empty). Four fixtures are demanded and none is sited.
- **No failure-mode row.** The skill's `## Failure modes` table (`SKILL.md:466-497`) is where an adopter looks up what a finding means; 22 conditions are listed and this plan adds none.
- **The `jen auth` precondition is unpinned.** `jenkins_build_map:779-785` returns `failed`/`unknown` with an empty map when auth is bad. An unauthenticated `jen` therefore produces the *same* empty map as a missing job path, and the Done-when's "zero branch jobs and setup says so" cannot tell them apart. Step 4a already reports auth separately — the ordering matters and is unstated.

## 4. Strongest argument against

**The check is a second, weaker copy of a refusal the estate already owns, bought at the cost of a live Jenkins call inside adoption.**

`plot-host.sh:3198-3205` answers this question offline, handles `PLOT_JENKINS_JOB`, and says the right sentence. The plan's approach requires setup to reach Jenkins — so it inherits `jen auth` state, network reachability, and an answer shape (`ok`/`failed`/`unknown`) whose empty-map cases collide. In adoption that is the worst place for a probe that can be inconclusive: `SKILL.md:396` already has to teach adopters that `unknown` is *cannot verify, never round it up*, and this adds a second reading with the same ambiguity.

## Adoption lens — the assigned questions

**Does adoption get slower or more confusing?** Slower, marginally — one more network call in a command that already makes several. **More confusing, yes**, and for a reason specific to this skill's design. `/plot-board-setup` is unusually disciplined about the difference between *proposed*, *confirmed*, *reported* and *refused*: `SKILL.md:157-167` (`propose`/`ask`/`silent`, and a fourth `null`), `:161` (*"A question carries no proposed word"*), `:396` (`unknown` is cannot-verify). Adding a finding whose two causes — fresh container, wrong config — are indistinguishable puts a fifth reading into that vocabulary that the skill cannot resolve. Every other reading here either resolves or names precisely what could not be checked.

**Is "reported and adoption continues" right?** For the *fresh-container* case, yes and obviously — refusing there would block a legitimate repo, and the plan is right to insist. For the case that filed the ticket, it is the wrong severity, and the skill's own precedent says so. The established pattern is **refuse the key rather than record an unverified one**: `SKILL.md:275-281` (Jenkins instance, unattended — *"a guessed slug buys a green light that verifies nothing"*), `:249-251` (CI, both signals — *"a wrong `CI:` is worse than an absent one"*), `:258-266` (Tracker — *"a wrong `Tracker: jira` … answers with an **empty list**, and the board renders an empty inbox that reads as *you have no tickets* — the very failure this command exists to prevent"*).

That last passage describes #913 with the nouns swapped. The skill already reasons that a recorded-but-wrong key producing an empty render is the failure it exists to prevent — and its answer there is *write no key*, not *write it and mention a finding*. **The plan invents a new severity — "verified-with-a-note" — in a skill whose organising principle is that a value is either proven, refused, or explicitly marked cannot-verify.** The one adjacent precedent for recording-with-a-warning is `Tracker` with no backend (`:354-362`), and that is a warning about *Plot's* unbuilt feature, not about the user's value possibly being wrong.

**Does a finding nobody must act on become noise?** Here, yes — sharper than usual. Step 5 (`:434-437`) already instructs: *"If anything reads `unknown`, say which check could not be completed rather than presenting a clean bill of health."* An adopter who runs setup on a fresh multibranch container gets a finding on a correct configuration, learns the finding is routine, and skips it on the run where it is real. **That is the failure the skill's own `:396` rule is built to avoid**, and it is worse than a merely-ignorable warning because it trains a skip.

**Is the fresh-container case distinguishable?** Not by the mechanism the plan chose, and I think not at all through `jenkins_build_map` — it returns a map and a status word, and both cases yield an empty-or-useless map with `status: ok`. It *is* distinguishable another way, and that way is already in the repo: the shape-plus-override test at `:3197-3205` separates *the value names no job* (config defect, actionable, offline) from *the value names a job that has no children yet* (fresh container, benign). Those are two different findings with two different sentences and two different next actions. **Splitting on job-path presence rather than on branch count gives the plan the distinction its Open Question asks for**, satisfies "does not refuse a legitimate `PLOT_JENKINS_JOB` value", needs no network call, and fits the refuse-or-prove vocabulary the skill already speaks.

## What I would amend

1. **Re-measure what a slug-only value actually returns** on the #913 instance and rewrite the premise. If it is a non-empty root listing, every "zero branch jobs" sentence in the plan and the Done-when is describing a state that does not occur.
2. **Add the offline job-path check** (shape after `PLOT_JENKINS_JOB`, per `plot-host.sh:3197-3205`) as the primary finding, and reuse that refusal's wording. Keep the resolution call, if kept at all, as the secondary *fresh container* report.
3. **Set the severity by which case fired.** No job path and no override → refuse the key, matching `:275-281`. Job path present, zero children → report and continue, exactly as the plan argues.
4. **Pin the `jen auth` ordering** so an unauthenticated CLI reports `cannot verify` and not "zero branch jobs".
5. **Add the `PLOT_UNATTENDED` clause and a `## Failure modes` row**, and site the fixtures.

The defect is real, the refusal to shape-check on `PLOT_JENKINS_JOB`'s account is honest reasoning, and "a fresh container must not be refused" is correct. The mechanism and the severity are what need changing.

Verdict: amend
