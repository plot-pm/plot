# Adversary lens — round 2 — a probe reading is not a guess

Position: amend

The amendment fixed the sentence round 1 named and left three dependent claims standing elsewhere in the file. One is a **new false claim** introduced by the amendment itself. Two are round-1 findings the amendment silently dropped rather than answering. And slice 2's `Done when` now contains a condition that **the plan's own newly-named design cannot satisfy** — measured below.

---

## 1 — Did the amendment fix what round 1 found, or restate it?

**It fixed it, and the fix is correct.** This is the strongest part of the amendment and I want to credit it before attacking the rest.

Round 1's core finding was that `classify` answers `unknown` on a zero exit, so a reachable Jenkins reads `unknown`, never `failed`. Re-run:

```
$ bash -c 'classify() { local out="$1" st="$2" ok_re="$3"
    if printf "%s" "$out" | grep -qiE "$ok_re"; then echo ok
    elif [ "$st" -ne 0 ]; then echo failed
    else echo unknown; fi; }
  RE="jenkins auth:[[:space:]]*reachable"
  OUT="Jenkins auth:  OK — jan.wloka@quatico.com"
  for s in 0 1 2; do echo "classify(status=$s) -> $(classify "$OUT" "$s" "$RE")"; done'
classify(status=0) -> unknown
classify(status=1) -> failed
classify(status=2) -> failed
```

Matches the plan's quoted trace exactly. The `jen` source confirms the exit asymmetry:

```
$ sed -n '926,933p' "$(command -v jen)"
  if [[ -n "$result" ]]; then
    fullname="$(echo "$result" | jq -r '.fullName // .id // "?"')"
    echo "Jenkins auth:  OK — ${fullname}"
  else
    echo "Jenkins auth:  NOT reachable"
    [[ "$jsrc" == "none" ]] && echo "  No Jenkins token for ${slug}. Run: jen -I ${slug} auth login"
    exit 1
  fi
```

Only the failure branch exits non-zero. **Round 1's correction is now correctly stated**, the headline is rewritten, the Changelog is rewritten, the consequence paragraph is rewritten to the safe-direction reading, and the "What this does not do" contradiction round 1 flagged is gone. The amendment also records the correction rather than quietly applying it — the `### The reported failed was correct` section and the Notes entry are both honest. That is real repair, not restatement.

**But round 1 made five findings and the amendment answered two.** Sections 2 and 4 below.

---

## 2 — Did the amendment introduce a NEW false claim?

**Yes. One, and it is in the sentence that replaced the withdrawn citation.**

The amendment withdrew `plot-host.sh:677` — correctly, round 1 proved it is a candidate loop. But it did not merely withdraw; it substituted a new causal claim in the same sentence (`:108-113`):

> `proposeCi` then answers `silent` and setup writes no `CI:` key, so the Jenkins instance question is never asked either — and **a board with no `CI:` resolves its build port to the arm that fetches nothing.**

**"The arm that fetches nothing" is false.** The arm exits 4:

```
$ grep -n 'ci_unaskable' skills/plot/scripts/plot-host.sh
596:# ABSENT IS NOT FALSE: `ci_unaskable()` reads an empty scheme as *this
972:ci_unaskable() { # $1 = the op's name, $2 = the CI word (may be empty)
3126:        ci_unaskable runs "$_ci"
3275:      *) ci_unaskable run-for-sha "$_ci" ;;

$ sed -n '972,985p' skills/plot/scripts/plot-host.sh
ci_unaskable() { # $1 = the op's name, $2 = the CI word (may be empty)
  local ci_word="${2:-}"
  if [ -z "$ci_word" ] || [ "$ci_word" = none ]; then
    echo "plot-host: $1 — this repository declares no CI system, so there is nothing to ask" >&2
    ...
  exit 4
}
```

An empty `CI:` word takes the first arm and **exits 4** — a loud, named refusal that prints the exact config key to add. That is the opposite of "fetches nothing". `plot-host.sh:596`'s own comment says so: *"ABSENT IS NOT FALSE"*.

This matters beyond pedantry. The withdrawn `:677` claim was *"exits 3"* — wrong line, right **kind** of thing. The replacement is right that no `CI:` key is the failure, and wrong about what that failure looks like, in the direction that **understates** the defect. The plan now describes a silent degradation where the estate actually produces an explicit refusal. An implementer or reviewer checking this sentence finds the code disagrees, exactly as round 1 found with `:677`. **The same failure mode, one sentence later, in the sentence written to repair it.**

The honest form is available and shorter: the plan already says *"no `CI:` key is itself the failure the setup skill exists to prevent"*. That clause needs no downstream claim at all. The added one is unforced.

**The two measurements the rubric named specifically both hold.** I re-ran each.

`-maxdepth 5`, reconstructing the reporting repository's path:

```
$ mkdir -p /tmp/mdtest/.build/pipelines/website/continuous-build
$ touch /tmp/mdtest/.build/pipelines/website/continuous-build/Jenkinsfile
$ cd /tmp/mdtest; for d in 1 2 3 4 5 6; do
    echo "-maxdepth $d -> $(find . -maxdepth $d -name Jenkinsfile -type f | wc -l | tr -d ' ') hit(s)"; done
-maxdepth 1 -> 0 hit(s)
-maxdepth 2 -> 0 hit(s)
-maxdepth 3 -> 0 hit(s)
-maxdepth 4 -> 0 hit(s)
-maxdepth 5 -> 1 hit(s)
-maxdepth 6 -> 1 hit(s)
```

The plan's three quoted rows reproduce exactly, and the off-by-one story is true. It also holds with an absolute start point and a trailing slash, which is how the script would call it with `$git_root`:

```
$ find /tmp/mdtest  -maxdepth 4 -> 0 ;  -maxdepth 5 -> 1
$ find /tmp/mdtest/ -maxdepth 4 -> 0 ;  -maxdepth 5 -> 1
```

`classify(status=0) -> unknown`: reproduced above, verbatim.

**Neither is padded and neither is wrong.** Credit where due: the amendment's self-incriminating note — *"the off-by-one is exactly the defect this plan exists to fix, made once more in its own Design"* — is accurate and is the kind of thing a plan usually hides.

---

## 3 — Does `Done when` pin the corrected pre-state, and is that gate satisfiable?

**Slice 1's pre-state is now correctly pinned, and it is satisfiable — but the plan does not say it requires deleting a currently-passing test, which is the work it hides.**

The gate now reads:

> a captured `Jenkins auth:  OK — <user>` line with **exit 0** reads `ok` ... — and the same fixture pinned to read `unknown` **before** the fix

`unknown` is the right pre-state, per §1. Adding the **exit 0** requirement is a genuine improvement the amendment made on its own: it pre-empts round 1's premise finding (4) that a widened regex could beat the exit code and turn a true `failed` into a false `ok`. Good.

**But three live tests pin a string `jen` cannot print, and the plan still does not name them.** Round 1's premise lens raised this as finding (2). The amendment did not answer it.

```
$ grep -n 'reachable\|Jenkins auth' test/reconcile/boardprobe.test.mjs
341:test('probe: jen reachable reads as ok', () => {
351:        'Jenkins auth:  reachable',
361:test('probe: jen NOT reachable reads as failed even though it exits 0', () => {
374:        'Jenkins auth:  NOT reachable',
444:  const stub = stubClis({ jen: { stdout: 'Jenkins auth:  reachable' } });
504:  const stub = stubClis({ jen: { stdout: 'Jenkins auth:  reachable' } });
```

Against the CLI's only two emitters:

```
$ grep -n 'Jenkins auth:' "$(command -v jen)"
928:    echo "Jenkins auth:  OK — ${fullname}"
930:    echo "Jenkins auth:  NOT reachable"
```

`Jenkins auth:  reachable` is a string the CLI has never printed. All 37 tests pass today:

```
$ node --test test/reconcile/boardprobe.test.mjs   # node v24.4.1
✔ probe: jen reachable reads as ok (4922.395583ms)
ℹ tests 37   ℹ pass 37   ℹ fail 0
```

So `boardprobe.test.mjs:341` is a **green test asserting the exact behaviour the plan calls the defect** — a fabricated line reading `ok`. The plan's slice-1 line says the fix must keep *"the exit-code fallthrough"* and says nothing about this. An implementer has three choices (delete :341, keep it as a compatibility fixture, or rewrite it to the real wording), each defensible, and **the plan makes none of them.** Round 1 asked for this by name; the amendment's Notes claim *"the two slices' fixtures are what convert them"*, which is precisely the question left open.

Worse, `:444` and `:504` use the unreal string **incidentally** — they test job-path parsing, not auth — so whoever deletes the fabricated wording must notice two tests that will start reading `unknown` instead of `ok` and decide whether those assertions care. Neither line is mentioned anywhere in the plan.

**Slice 2's gate is NOT satisfiable by the design the plan names. This is my hardest finding.**

The amendment's headline improvement was naming the bound instead of deferring it: `find -maxdepth 5`, excluding `node_modules`, `.git`, and `Worktree root`. The gate it must satisfy, unchanged from round 1:

> a Jenkinsfile inside `node_modules` **or a test fixture directory** does **not** make it `true`, pinned by a fixture that contains one

The exclusion list has three entries and **"test fixture directory" is not one of them.** Measured:

```
$ mkdir -p /tmp/fixtest && cd /tmp/fixtest && git init -q .
$ mkdir -p test/fixtures/repo packages/domain/test/fixtures
$ echo x > test/fixtures/repo/Jenkinsfile
$ echo x > packages/domain/test/fixtures/Jenkinsfile
$ find . -maxdepth 5 \( -name node_modules -o -name .git -o -path './.worktrees' \) -prune \
    -o -name Jenkinsfile -type f -print
./test/fixtures/repo/Jenkinsfile
./packages/domain/test/fixtures/Jenkinsfile
```

**Both fixture Jenkinsfiles are found. The gate says they must not be.** The plan's own Design names the danger — *"a vendored fixture Jenkinsfile would be a false positive in the other direction"* — and then names a bound that does not address it. The amendment tightened the depth and left the exclusions exactly as loose as round 1 found them.

This is the amendment's signature failure: it fixed the number and not the list. The two travel in one sentence (`find -maxdepth 5 ... excluding node_modules, .git, and the configured Worktree root`), and only one half was re-derived.

Nor does the obvious alternative rescue it. Round 1's scope lens proposed `git ls-files`, arguing untracked files self-exclude. That fails the same gate for a different reason — a *tracked* fixture is still tracked:

```
$ cd /tmp/fixtest; git add -A && git commit -qm x
$ git ls-files -- '*Jenkinsfile' '*Jenkinsfile.*' 'Jenkinsfile*'
packages/domain/test/fixtures/Jenkinsfile
test/fixtures/repo/Jenkinsfile
```

And its `node_modules` half is **machine-dependent**, which no one has noticed. It passes on this machine only because of a personal global ignore file:

```
$ git check-ignore -v node_modules/pkg/Jenkinsfile
/Users/jwloka/.gitignore:81:node_modules	node_modules/pkg/Jenkinsfile
$ git config --get core.excludesfile
~/.gitignore
```

With that removed — a clean CI runner, or a fixture repo the harness builds with no `.gitignore`:

```
$ GIT_CONFIG_GLOBAL=/dev/null git -c core.excludesfile=/dev/null add -A
$ GIT_CONFIG_GLOBAL=/dev/null git -c core.excludesfile=/dev/null ls-files -- '*Jenkinsfile*'
node_modules/pkg/Jenkinsfile
```

The test harness commits everything it writes (`repoWith` at `boardprobe.test.mjs:41-56` does `git add -A; git commit`) and writes no `.gitignore`, so a `git ls-files` implementation would **fail the node_modules gate inside this very test file.** Neither round-1 juror ran that, and the plan inherits the gap either way.

**So the gate is currently unsatisfiable by both candidate designs**, and the plan asserts the bound is settled: *"what they do not decide is the shape, because a bound chosen during implementation is a bound nobody reviewed."* The shape named is reviewed and does not work. That sentence is now the plan's own trap.

Two further gate problems, both surviving round 1 unaddressed:

- **The cost gate is still a rule wearing a gate's clothes.** *"the search's cost on this repository is measured and stated in the script, not assumed"* — satisfiable by typing any number in a comment. Round 1's scope lens said this verbatim; the amendment kept the clause word for word while *also* moving the bound into the plan, which removes the only reason the clause existed. Measured, the cost is not a live concern in either design: `find -maxdepth 5` with prunes is 0.051 s and `git ls-files` is 0.055 s on this repository.
- **The negative fixture must be created, not found.** This repository contains no Jenkinsfile at all (`git ls-files -- '*Jenkinsfile*'` and a depth-6 `find` both return empty), so the implementer writes the adversarial fixture themselves — which means the fixture's shape *is* the gate, and the plan describes it only as "a test fixture directory".

---

## 4 — Anything round 1 missed that is still wrong?

**Round 1 did not miss it — round 1's scope lens made it its central finding, and the amendment dropped it without a word.** I am restating it because it survived the correction pass, which is exactly what this lens is for.

**`plot-detect-repo.sh` already solved defect 2, a week earlier, for the same repository, emitting the same field — and the plan still does not mention it.**

```
$ grep -c 'detect-repo\|ls-files\|collector' docs/plans/2026-09-17-a-probe-reading-is-not-a-guess.md
0
```

Zero mentions, before and after the amendment. What is there:

```
$ sed -n '195,209p' skills/plot/scripts/plot-detect-repo.sh
# THE JENKINSFILE SEARCH IS NOT ROOT-ONLY, and that is a measurement. The
# stack this was written for keeps three of them at
# `.build/pipelines/<project>/<pipeline>/Jenkinsfile` — none of the paths
# reasoned from convention, root included. A root-only probe reads that
# repository as having no CI at all.
jenkinsfile=false
gh_workflows=false
if [ -n "$(git rev-parse --git-dir 2>/dev/null)" ]; then
  git ls-files -z -- '*Jenkinsfile' '*Jenkinsfile.*' 'Jenkinsfile*' 2>/dev/null \
    | grep -qz . && jenkinsfile=true
```

That comment describes **this plan's reporting repository**, at this plan's exact path shape, and states this plan's exact conclusion — *"A root-only probe reads that repository as having no CI at all"* — in code that landed 2026-09-10. The plan presents the same finding as new on 2026-09-17 and proposes a third, differently-constructed search for it.

Both collectors run in one adoption:

```
$ sed -n '82,85p' skills/plot-board-setup/SKILL.md
../plot/scripts/plot-board-probe.sh    # can the board run here?
../plot/scripts/plot-detect-repo.sh    # what is this repo?
```

So after slice 2 the estate has **two implementations of `ci_signals.jenkinsfile` with different semantics** — `find`-by-depth against `git`-by-tracking — which disagree on any untracked or deep-past-5 Jenkinsfile, merged by a skill that does not say which wins. `CLAUDE.md`'s own rule is explicit: *"Duplication is allowed and undeclared duplication is not... What makes it safe is not that one side is authoritative — it is that a test says they agree."* The plan budgets no corpus test and does not declare the duplication.

**The amendment's Notes say what it addressed, and this is absent from that list.** The Notes claim the panel *"found the first defect's symptom and consequence stated backwards"* — true, but that was one of two lenses' findings. Scope's finding was that slice 2 rebuilds an existing solution, and the amendment neither adopted it, rejected it, nor recorded it. **A panel record that reports only the finding the author agreed with is the failure mode this repository built the panel to prevent.**

**Two smaller items, also raised in round 1 and also dropped:**

- **The empty-`.github/workflows` false positive.** `plot-board-probe.sh:132` tests `-d`; `plot-detect-repo.sh:206-209` tests for an actual `*.yml`/`*.yaml` file, with a comment saying why. Same field-set, same collector, same class of bug, already fixed next door. The plan cites `:132` approvingly — *"`gh_workflows` is the model that already works"* — which is the one sentence in the plan that is **weakened** by the amendment rather than strengthened: the amendment added the `:132` line number, making the wrong claim more precise. It works for *location*; it is wrong about *emptiness*.
- **`classify()` is unchanged** is not stated. Round 1's scope lens verified the blast radius is one regex argument at one of three call sites (`:247` gh, `:254` bb, `:266` jen) and asked for one sentence pinning it. The plan says *"the fix must not widen the line it reads"*, which is about the regex, not about the shared function. One sentence would make slice 1's blast radius provable rather than argued.

**And one the amendment created:** the Notes now say *"both jurors reasoned from the probe's source and neither ran it."* Round 1's premise lens **did** run it — it reports a live `jen -I <the reporting instance> auth status` with captured output and exit code, and a stub-based simulation of the probe's own block (`REAL-SHAPE EXIT=0 / RESULT=unknown`). The scope lens ran `bash skills/plot/scripts/plot-detect-repo.sh | jq .ci_signals` against this repository. The plan's self-criticism is more severe than the record supports — harmless in direction, but it is a factual claim about a document in the repository, and it is wrong.

---

## 5 — Would I implement from this plan as it stands?

**Slice 1: yes, with one decision handed back.** The mechanism is correct, the pre-state is now right, the exit-0 conjunct closes the false-green risk, and the gate ordering is genuinely well designed. What the implementer must decide alone:

1. **What happens to `boardprobe.test.mjs:341`** — a passing test asserting a fabricated CLI line reads `ok`. Delete, keep, or rewrite. The plan is silent, and whichever they pick changes what the suite means.
2. **Whether `:444` and `:504` care** — two job-path tests reusing the same fabricated stdout, which will flip to `unknown` if the fabricated wording goes.
3. **Whether `classify()` may be touched.** Almost certainly no, but the plan does not say it.

**Slice 2: no.** Not because the defect is unreal — it is real and I reproduced `:130` — but because implementing it as written produces a change that **fails its own `Done when`** on the fixture-directory condition, measured above, and lands a third definition of a field two collectors already emit. The implementer would have to decide, alone and mid-implementation:

4. **How to exclude a test fixture directory** — by name (`test/`, `fixtures/`, `__fixtures__/`?), by pattern, or not at all. This is the bound the plan says it has settled, and it has not: it settled the depth and left the list. A bound chosen during implementation is the thing the plan's own sentence forbids.
5. **What to do about `plot-detect-repo.sh`** — match its `git ls-files` semantics, diverge deliberately, declare a corpus pair, or remove the field from the probe. The plan does not know this file exists.
6. **Which collector wins in the merge** when the two disagree on the reporting repository, since `plot-board-setup/SKILL.md` says to merge and does not say which.
7. **What number to write for cost**, against no threshold and no failing condition.

Seven decisions, four of them in one slice, three of them plan-level questions about what the estate contains. That is more than an implementer should carry, and points 4 and 5 are the kind that get resolved at 80% completion by whichever answer makes the test pass.

---

## What moves me to proceed

1. **Fix or delete the new false claim.** *"a board with no `CI:` resolves its build port to the arm that fetches nothing"* — the arm is `ci_unaskable` and it **exits 4** with a named refusal (`plot-host.sh:972-991`). The clause that follows it already carries the argument; cut the claim.
2. **Name `plot-detect-repo.sh` and decide the ownership question.** Probe copies it / probe diverges with a declared corpus pair / probe drops the field to detect-repo. Any of the three, argued. Not silence.
3. **Make slice 2's bound satisfy slice 2's gate.** Either add the fixture-directory exclusion to the named shape and measure it, or change the gate. As it stands the plan names a design that provably fails a condition it demands — and the whole point of the amendment was that the shape is reviewed rather than delegated.
4. **Name `boardprobe.test.mjs:341`, `:444` and `:504`** and say what happens to the fabricated `Jenkins auth:  reachable` wording. This is the only place slice 1 touches existing green tests.
5. **Either give the cost gate a threshold or drop it.** The bound is now in the plan; the clause has lost its job.
6. **Correct the Notes' claim about the panel.** Both jurors ran things; premise ran `jen` live against the reporting instance and simulated the probe block, scope ran `plot-detect-repo.sh`. Claim the real blind spot — nobody ran `plot-board-probe.sh` in the reporting repository — rather than a larger one.
7. **Optional but cheap:** one sentence pinning `classify()` unchanged, and a note on the empty-`.github/workflows` false positive at `:132`, which the plan currently cites as the model that works.

Items 1, 2, 3 and 4 are the ones I would block on. Items 2 and 3 are answered by one file the plan has still not read, seven days after that file answered them.
