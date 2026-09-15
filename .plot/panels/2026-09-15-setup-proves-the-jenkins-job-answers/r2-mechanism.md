# Mechanism lens, round 2 — setup-proves-the-jenkins-job-answers (#913)

**Lens:** does the amended offline test do what the plan now claims, judged by reading the code it points at and reasoning through both zero-cases?
**Method:** read the amended plan, all three r1 verdicts, then the cited source on `origin/main`. Executed the resolution logic offline against eight configuration values.

## What I read

| file | range | why |
|---|---|---|
| `skills/plot/scripts/plot-host.sh` | 690-730, 755-775, 895-920, 3180-3230 | the quoted refusal, both resolution sites, `jenkins_instance()` |
| `skills/plot/scripts/plot-board-probe.sh` | 227-233, 247-264, 281 | `classify`, `jen_auth`, the emitted `instance` |
| `skills/plot/scripts/plot-config.sh` | 115-125 | the `Jenkins instance` key's documented value shape |
| `skills/plot/scripts/plot-detect-repo.sh` | 137-165, 167-175, 236 | what adoption's probe reports as the instance |
| `skills/plot-board-setup/SKILL.md` | 140-160, 260-300, 460-497 | the proposal block, the refuse-the-key precedent, the failure-modes table |
| `test/reconcile/unattended.test.mjs` | 1-60 | whether the unattended sweep is a gate |
| `test/reconcile/host.test.mjs` | 1452, 1567-1610 | `makeJenStub`, the existing jen harness |
| r1 `premise.md` / `adoption.md` / `verifiability.md` | whole | what round 1 actually found |

---

## 1. Are the amendment's new claims true?

**Every one I was asked to check verifies, most of them to the line.**

**`plot-host.sh:3197-3205` says what the plan quotes — TRUE, verbatim.** The plan's fenced block reproduces the source exactly, including the two-line refusal message. The line numbers are right: `:3197` is the `PLOT_JENKINS_JOB` line, `:3198` the `if [ -z "$_jen_job" ]`, `:3202-3204` the three `echo`s, `:3205` the `exit 4`.

**`PLOT_JENKINS_JOB` is honoured there — TRUE, and with the right precedence.** `:3194-3197` derives `_jen_job` from the instance and then **overwrites it unconditionally** when the variable is set. The override therefore wins over both the slug-only and the suffixed form. The second, independent copy at `:758-767` (`jenkins_build_map`) tests the override *first* in an `if/elif/else`. Different spellings, identical precedence. The plan's claim that a slug-only value with the override set is legitimate holds at both sites.

**`SKILL.md:275-281` is the refuse-the-key precedent — TRUE, cited exactly.** The block quote is verbatim, including *"a guessed slug buys a green light that verifies nothing"* and *"Write no `Jenkins instance` key"*. It is the Jenkins key's own unattended clause, not a neighbouring one — the strongest possible form of the precedent claim.

**`jen_auth` returns `unknown` when no instance resolves — TRUE.** `plot-board-probe.sh:259-263`, the `else` arm, with a comment stating the reason in the plan's own terms: *"No instance means the only runnable form is the one that verifies nothing. Report that we cannot tell, never that it is fine."*

**And the asymmetry the plan builds its severity argument on is real.** I traced the `ok` path rather than taking it from the plan. `:250-258` runs `jen -I "$jen_instance" auth status` with the value **unsplit** — the whole `<slug>/<job/path>` string, or the bare slug, whichever is configured. `classify` (`:227-233`) greps the `Jenkins auth:` line. For a reachable server the grep hits and returns `ok` **regardless of whether a job path is present**, because the slug is the whole address of the server. So: a present-but-incomplete value scores `ok`, a wholly absent one scores `unknown`, and `unknown` is the one step 4a treats as *cannot verify*. **The partial value does score strictly better than the missing one.** That is the plan's central severity claim and it is sound at the source.

**Nothing in the amendment's new claims is unverified.** This is a marked change from round 1, where the load-bearing table was attested rather than reproduced. The amendment's mechanism now rests entirely on code in this repository, and I reproduced all of it. The one measurement still attested — `jen -I <slug> job list --json` returning four folder entries — is now doing only *negative* work: it kills the old mechanism and nothing in the new gate depends on its value. **Even if that reading were wrong, the amended gate is unaffected.** That is a genuine structural improvement, not a restatement.

---

## 2. Does the new mechanism distinguish the two zero-cases?

**Yes, cleanly, for every shape the plan names.** I executed the exact resolution from `:3194-3198` offline:

```
#913 config (slug only)         override=<unset>                  -> REFUSE
slug only + override            override=quaweb/continuous-build  -> ACCEPT
slug + job path                 override=<unset>                  -> ACCEPT
fresh container (no children)   override=<unset>                  -> ACCEPT
```

The four `Done when` cases land exactly where the plan says. The two zero-cases separate on a property that is **present in the string** — *does a job path resolve* — rather than on a payload both cases produce identically. A fresh container names a job path, so it is accepted and never flagged; a slug-only value names none, so it is refused. Round 1's objection was that the old gate pinned a behaviour the estate never produces. **This gate pins a behaviour the estate produces on the exact #913 value, and I fired it.** The mechanism is fixed.

**But the test is `%%/*` on a value the estate also allows to be a URL, and that is a false refusal the plan does not see.**

```
full URL, no job path           -> ACCEPT host=https: job=/jenkins.example.com   (wrong: should refuse)
full URL WITH job path          -> ACCEPT host=https: job=/jenkins.example.com/quaweb/cb
trailing slash "slug/"          -> REFUSE
```

This is not a hypothetical shape:

- **`plot-config.sh:119` documents the key as "the slug or URL passed to a Jenkins CLI's `-I` flag."** URL is a first-class documented form.
- **`plot-host.sh:655-658` states it as a deliberate decision**: *"BACKTICKS ARE STRIPPED AND NO SCHEME IS NORMALISED ON. `ewz` writes a bare host in backticks and the probe used a full `https://` URL; `jen -I` accepts either, so inventing a canonical form would break whichever caller passes the other one."*
- **Adoption's own probe feeds setup this shape.** `plot-detect-repo.sh:173` extracts the instance with `grep -hoiE '\b[a-z0-9._-]*jenkins[a-z0-9._-]*\.[a-z0-9-]+\.[a-z]{2,}\b'` — a **bare dotted hostname**, no slash, ever. I ran it: `jenkins-ci-webbloqs.internal.quatico.dev`. `:143-147` says so outright: *"IT REPORTS THE HOST AND NOTHING ELSE … the container path is a fact about the Jenkins job tree that no file in the repository states."*

So the population this check refuses is **every hostname-form instance**, and adoption's own detector can propose nothing else. A `https://host/` value with no job path gets `job=/host` — a non-empty string — and is **accepted while being exactly the #913 defect**. A bare-hostname value is correctly refused, but for the coincidental reason that hostnames have no slash, not because the check understood it.

**The direction of the error matters and it runs both ways**: the URL form both **false-accepts** the broken case and, at `https://host/quaweb/cb`, produces `job=/jenkins.example.com/quaweb/cb` — a path with the host still glued to the front, which is not a job path at all. `plot-host.sh` has this same latent bug, but there it is confined to one op that exits 4; promoting the split into a **refusal that blocks adoption** widens its blast radius considerably.

This is fixable — split on the *last* path segment after stripping a scheme, or test the host half against `ci_looks_like_host` the way `:690` already does — but the plan currently names `:3197-3205` as the thing to copy, and copying it verbatim ships this.

---

## 3. Is refusing the right severity?

**For the case the ticket filed, yes, and round 1's adoption lens made the argument I would have made.** `SKILL.md:275-281` is the same key's own precedent, and `:258-266` (Tracker) reasons that a recorded-but-wrong key rendering an empty view is *"the very failure this command exists to prevent"* — which describes #913 with the nouns swapped. A finding an adopter must never act on trains them to skip the run where it is real. The plan's *"A finding an adopter must never act on trains them to skip the run where it is real"* is that argument, correctly absorbed.

**And the plan is right that the escape hatch keeps the refusal honest.** Refusing only when `PLOT_JENKINS_JOB` is also unset means no working configuration is refused — the property round 1 demanded and the reason a naive shape check was rejected.

**What breaks an existing adopter — the question I was asked.** Setup writes config; it does not read a board's runtime env. Take the #913 repository itself: `Jenkins instance: Quatico.Webseite`, no override, board already running. Re-run setup and the amended check refuses the key. Under the `:275-281` precedent that means *write no key* — so a re-run can **remove a key that is already there**, or refuse to re-write it, on a board the adopter experiences as working. It is not working (that is the ticket), but the adopter did not ask setup to change their config, and `--migrate`'s existence shows this skill normally treats *moving an existing arrangement* as a separate, opted-into act.

That is survivable and I do not think it sinks the plan — but **the plan pins the fresh-install path and says nothing about the re-run path**, and the re-run path is the one every existing adopter takes. The refusal sentence should name the existing key rather than silently declining to write one.

**The `PLOT_JENKINS_JOB` escape has a matching gap.** The override lives in the *board's* environment at runtime; setup runs in the *operator's* shell. An adopter who correctly exports it in their launchd/systemd unit but not in their terminal gets refused for a configuration that works. The plan pins *"a slug-only value WITH `PLOT_JENKINS_JOB` set is accepted"* — but whose environment set it is unstated, and the two are routinely different on this estate.

---

## 4. What `Done when` fails to pin

The amended `Done when` is a real improvement — six gates, each naming a case, all runnable in this repository. What it still leaves open:

1. **The value shapes it enumerates are `slug`, `slug/job`, and `slug`+override. It never says what a URL, a trailing slash, or a bare hostname does.** Per §2 those are three different answers, one of them wrong in the defect's own direction. An implementation can satisfy all six gates with `[ -z "${v#*/}" ]` and ship the false-accept.

2. **Where the check lives.** Round 1's premise lens raised this and the amendment did not answer it. `/plot-board-setup` is 498 lines of prose with no test file; `jenkins_build_map` has **zero** test coverage. `pnpm run test:contracts` is `test/reconcile/*.test.mjs`. **A gate written into skill prose satisfies "the check makes no network call" and "no new config key" trivially and is pinned by nothing.** If the check lands in `plot-board-probe.sh` — which already holds the instance string at `:248` and already emits a `jen` object — it is testable with the existing harness. The plan should name the file.

3. **The unattended shape, which is a live gate and is missing.** `test/reconcile/unattended.test.mjs` sweeps every `skills/*/SKILL.md` structurally and requires each declared question site to carry its `PLOT-UNASKED:` line. A refusal is a new decision site on this key; `SKILL.md:275-281` is itself an unattended clause. Round 1's adoption lens listed this (item 5) and **the amendment dropped it.** As written, the plan can be implemented and `test:contracts` can fail.

4. **The `## Failure modes` row, same provenance, also dropped.** `SKILL.md:466-497` is where an adopter looks up what a finding means; it carries 22 rows including three refusals. This adds a refusal and no row.

5. **The `jen auth` ordering.** Round 1 (adoption, item 4) asked for it. If `jen` is unauthenticated, step 4a already reports `failed`/`unknown`; the plan does not say whether the job-path refusal fires before, after, or instead. Two refusals on one key with unstated precedence is how an adopter gets one sentence for two causes — the thing this amendment exists to prevent.

**The concrete way to satisfy every gate and still be wrong:** implement the check as `case "$v" in */*) accept ;; *) refuse ;; esac` in SKILL.md prose. Slug-only refuses, slug/job accepts, override accepts, no-Jenkins stays `unknown`, a fresh container accepts, zero `jen` invocations. **All six gates pass.** It false-accepts every URL-form broken value, it is pinned by no test because prose is not tested, and it fails the unattended sweep.

---

## 5. Strongest argument against doing this at all

**The offline test is a string property of a config value, and the estate has three places that already know it — so the question is not whether to check but whether adoption is where a check belongs.** `plot-host.sh:637` states the consequence in a comment, `:3198-3205` refuses on it, and `ci-scheme.test.mjs` reasons about it in a passing test. A fourth implementation in a fourth vocabulary is exactly the drift `CLAUDE.md`'s *"A Shell Script Asks The Domain"* section exists to bound — and that section's rule is that a duplicated rule **joins the corpus tier** with a test asserting the two agree. The plan duplicates `:3197-3205` into the adoption skill and declares no corpus pairing. When someone fixes the URL split in `plot-host.sh`, nothing tells them a copy exists in a skill.

**The narrower form of the same objection**, and the one I find genuinely strong: round 1's verifiability lens proposed this exact test as a **report** and the plan adopted the test while inverting the register to a refusal. Both moves are defensible; adopting the mechanism from one lens and the severity from another produced a combination **no round-1 lens actually evaluated**. Refuse-the-key is right for a *guessed* value (`:275-281` — setup invented it). A present value is the adopter's own statement about their infrastructure, and the failure mode of refusing it is different in kind from declining to guess.

**This does not make me say reject.** The defect is real, the premise survived independent checking twice, the mechanism is now verifiable end to end in this repository, and the severity has a named precedent on the same key. But the plan's own standard — stated in its section *"Asking the instance does NOT distinguish the defect, and an earlier draft got this wrong"* — is that a gate must fire on the shape the estate actually produces. **Adoption's own detector produces bare hostnames, and the plan's test was not reasoned against them.**

---

## Did the amendment fix it?

**The mechanism: yes.** Round 1's finding was that a slug-only value resolves four entries, so a zero-branch-jobs gate pinned an unreachable behaviour. The job-path test is a different test on a different input, it is offline, it is override-aware, it separates the two zero-cases, and I fired it on the #913 value. This is not a restatement — the old gate and the new one share no code path.

**The severity: yes, with the precedent correctly cited** and one unexamined consequence (the re-run path).

**What round 1 asked for and the amendment dropped: the unattended clause, the failure-modes row, the `jen auth` ordering, and the fixture location.** Three lenses raised these; the amendment absorbed the two structural findings and lost the four procedural ones.

**What no round found, because no round ran the test against the estate's own probe output: the URL and bare-hostname shapes.** That is a defect in the new mechanism itself, not a gap in its packaging, and it is the reason this is `amend` and not `proceed`.

### What would make me say proceed

1. **Reason the test against a URL-form and bare-hostname value** and pin both in `Done when`. `plot-config.sh:119` and `plot-host.sh:655-658` make URL a documented shape; `plot-detect-repo.sh:173` can propose nothing else.
2. **Name the file the check lives in.** `plot-board-probe.sh` already holds the string and has a test harness; skill prose has neither.
3. **Restore the four dropped items** — `PLOT_UNATTENDED` clause, failure-modes row, `jen auth` ordering, fixture location. The first is a gate that will fail the build.
4. **Say what a re-run does to an existing key**, and whose environment `PLOT_JENKINS_JOB` is read from.

The premise was true in round 1 and is true now. The mechanism was false in round 1 and is now true for the cases it names and false for one it does not. That is a real fix with a real remaining hole, which is the definition of amend rather than either of the other two words.

Verdict: amend
