# Scope lens — a probe reading is not a guess

Position: amend

Both defects are real and I reproduced each one. My objection is not to the goal. It is that **slice 2 proposes to invent a bounded search that this repository already built, measured and documented seven days ago in the sibling collector that emits the same field** — and that the plan's one deferred decision (the bound) is deferred to an implementer who will now re-derive an answer that exists at `plot-detect-repo.sh:191-205`.

---

## 1 — Is the problem real, and stated correctly?

**Both readings re-derived. Both defects are real. One supporting claim is wrong.**

### Defect 1 — the auth regex. Real, and confirmed at the source.

The probe's success arm, verbatim:

```
$ sed -n '263,266p' skills/plot/scripts/plot-board-probe.sh
    if printf '%s' "$out" | grep -qiE 'jenkins auth:[[:space:]]*not reachable'; then
      jen_auth="failed"
    else
      jen_auth=$(classify "$out" "$st" 'jenkins auth:[[:space:]]*reachable')
```

Line 266 is exactly as cited. `jen` is a bash script on this machine, so I read its emitters rather than trusting a captured sample — these are the **only two** `Jenkins auth:` lines it can print:

```
$ grep -n 'Jenkins auth:' /Users/jwloka/bin/jen
928:    echo "Jenkins auth:  OK — ${fullname}"
930:    echo "Jenkins auth:  NOT reachable"
```

The word `reachable` appears in the CLI's vocabulary **only inside `NOT reachable`**. The success wording is `OK`. So the success regex at :266 can never match a success, and — because the `not reachable` arm at :263 fires first — `reachable` alone is not merely wrong, it is **unmatchable**. Confirmed.

### But the plan's causal story is wrong in one respect, and it matters for the fix.

The plan says the match fails and "`classify` falls through to `failed` or `unknown` — the report says `failed`." I traced why `failed` and not `unknown`, and the answer is the exit code:

```
$ sed -n '929,933p' /Users/jwloka/bin/jen
  else
    echo "Jenkins auth:  NOT reachable"
    [[ "$jsrc" == "none" ]] && echo "  No Jenkins token for ${slug}. Run: jen -I ${slug} auth login"
    exit 1
```

The failure path exits **1**. The success path returns 0. So on a genuinely broken instance, `classify`'s second arm (`status -ne 0` → `failed`) gives the right answer **even with the regex broken**, and the `:263` special-case is belt-and-braces.

The consequence for the fix: **the defect only ever misreports the SUCCESS case**, where `jen` exits 0 and prints `OK`. The status quo produces `unknown` there, not `failed`. Which leads to the one claim I could not reproduce — see §4.

### Defect 2 — the root-only Jenkinsfile test. Real, cited line exact.

```
$ sed -n '130p' skills/plot/scripts/plot-board-probe.sh
[ -n "$git_root" ] && [ -f "$git_root/Jenkinsfile" ] && jenkinsfile=true
```

A single `-f` on one path. A repository keeping `.build/pipelines/*/Jenkinsfile` reads `false`. Confirmed, and the downstream consequence is real: `ciSignalsFrom` maps `jenkinsfile` to the `jenkins` signal, `proposeCi` counts present signals, and zero signals answers `silent`:

```
$ grep -n "toBe('silent')" packages/domain/test/stack.test.ts
278:    expect(proposeCi(ci(false, false)).answer).toBe('silent');
```

And a `silent` CI blocks the Jenkins-instance question, which `plot-board-setup/SKILL.md:272` gates on `ci_signals.jenkinsfile` being true. The chain holds.

---

## 2 — Is this the right fix, or a symptom fix?

**Slice 1: right fix, correctly narrow.** One word in one regex, with the ordering and fallthrough explicitly preserved. I have no scope objection.

**Slice 2: this is where I dissent.** The fix is right in direction and **wrong in construction**, because it rebuilds something that exists.

### The plan defers the bound. The bound is already decided, next door, in the same repo, for this same field.

`plot-detect-repo.sh` — the *other* adoption collector — emits the identical `ci_signals.jenkinsfile` field and **already solves exactly this**:

```
$ sed -n '195,205p' skills/plot/scripts/plot-detect-repo.sh
# BOUNDED BY GIT, for the reason the two searches above are: `git ls-files`
# sees only tracked files, so a `Jenkinsfile` fixture inside `node_modules` or
# an unstaged experiment cannot answer for the repository.
#
# THE JENKINSFILE SEARCH IS NOT ROOT-ONLY, and that is a measurement. The
# stack this was written for keeps three of them at
# `.build/pipelines/<project>/<pipeline>/Jenkinsfile` — none of the paths
# reasoned from convention, root included. A root-only probe reads that
# repository as having no CI at all.
jenkinsfile=false
...
  git ls-files -z -- '*Jenkinsfile' '*Jenkinsfile.*' 'Jenkinsfile*' 2>/dev/null \
    | grep -qz . && jenkinsfile=true
```

That comment names **the same three-Jenkinsfile `.build/pipelines/` stack** the plan's Design section presents as a new 2026-09-17 finding. It landed a week before this plan was drafted:

```
$ git log -1 --format='%ai %s' -S'THE JENKINSFILE SEARCH IS NOT ROOT-ONLY' -- skills/plot/scripts/plot-detect-repo.sh
2026-09-10 16:31:07 +0200 plot-init: the probe emits its CI signals
```

**The plan never mentions this file.** `plot-detect-repo.sh` appears nowhere in it.

### `git ls-files` dissolves the entire "bound" problem the plan defers

The plan's hardest open question — depth, exclusions, cost, "measured and stated in the script" — is not a question under this approach. I proved it in a sandbox:

```
$ mkdir -p .build/pipelines/web/cb node_modules/pkg
$ echo x > .build/pipelines/web/cb/Jenkinsfile
$ echo x > node_modules/pkg/Jenkinsfile
$ echo 'node_modules/' > .gitignore && git add -A
$ git ls-files -z -- '*Jenkinsfile' '*Jenkinsfile.*' 'Jenkinsfile*' | tr '\0' '\n'
.build/pipelines/web/cb/Jenkinsfile
```

The nested Jenkinsfile is found. The `node_modules` one is **not** — not because a list excludes it, but because it is untracked. Every one of slice 2's four Done-when conditions is satisfied by this one line, with **no depth bound to choose and no exclusion list to maintain**.

Cost, measured on this repository:

```
$ time (git ls-files -z -- '*Jenkinsfile' '*Jenkinsfile.*' 'Jenkinsfile*' | grep -qz .)
0.007 total
```

7 ms. The plan's demand that cost be "measured and stated in the script" is answerable in one command, and the answer is that cost is a non-issue.

**So the symptom/root distinction lands here:** the plan treats *"the probe reads one path"* as the root cause. The actual root cause is *"two collectors emit the same field and only one of them was fixed."* Fixing the probe with a **third, independently-designed search** leaves the estate with two different definitions of `jenkinsfile` — which is the condition that produced this bug, not a fix for it.

---

## 3 — Does `Done when` contain a gate that plumbing alone cannot satisfy?

**Yes for both slices. This is the plan's strongest section and I want to credit it precisely.**

**Slice 1** — two independent gates that a pass-through cannot fake:

- *"a `Jenkins auth: NOT reachable` still reads `failed` and is tested **before** the success arm, pinned by a fixture that contains both words"* — a fixture containing **both** words is the discriminating input. A naive widening (e.g. matching `ok|reachable`) passes the success test and **fails this one**, because `NOT reachable` contains `reachable`. This gate cannot be satisfied by plumbing; it can only be satisfied by preserving the ordering.
- *"an unrecognised line still reads `unknown` and never `ok`"* — pins the fail-safe direction. A regex widened to `.*` passes the success case and fails this.

Together these bracket the change from both sides. That is real gate design, not a checklist.

**Slice 2** — *"a Jenkinsfile inside `node_modules` or a test fixture directory does **not** make it `true`, pinned by a fixture that contains one"* is a genuine negative gate: a bare `find` passes the positive cases and fails this one.

**One gate is weak, and it is the one my lens is about.** *"the search's cost on this repository is measured and stated in the script, not assumed"* is satisfiable by writing any number in a comment. There is no threshold, no failing condition, and no test. It reads as a gate and functions as a rule. Under `git ls-files` this does not matter (the cost is 7 ms and structural); under the unbounded-search-plus-exclusions design the plan actually describes, it is the **only** thing standing between the implementer and an arbitrary `-maxdepth` — and it cannot stop them.

---

## 4 — What could I not verify, or find false?

### False, as stated: "the report says `failed`" for an authenticated CLI

This is the plan's headline — the title is *a probe reading is not a guess*, and the opening quote is `jen auth: failed` "against an authenticated CLI". I could not reproduce it, and the code says it should not happen.

The live reading on this machine, against the exact instance the plan names:

```
$ jen -I 'jenkins-ci-apps.internal.quatico.dev/quaweb/continuous-build' auth status
Keycloak:      signed in
Instance:      jenkins-ci-apps.internal.quatico.dev/quaweb/continuous-build (...)
Secret store:  keychain
Jenkins token: stored (keychain), user jan.wloka@quatico.com
Jenkins auth:  NOT reachable
EXIT=0
```

Two problems for the plan's account:

1. **This CLI prints `NOT reachable`, not the `Jenkins auth:  OK — jan.wloka@quatico.com` the plan quotes as "The CLI prints:".** The token is stored and Keycloak is signed in, yet Jenkins is not reachable — so `auth: failed` here is arguably a *correct* reading, not a false one. The plan's own evidence (`"instance"` resolved, token stored) is consistent with this.
2. **Exit code 0 with `NOT reachable` is a real inconsistency the plan does not note** — `jen` exits 1 at line 932 when it prints that on the non-JSON path, so the 0 I measured suggests a different path was taken. That is unexplained, and it is the kind of thing the plan's fixture should pin.

More structurally: since the failure path exits 1, a broken regex plus `classify`'s exit-code arm yields `failed` — **the correct answer**. The regex bug's real consequence is that a *genuine success* (exit 0, `OK`) falls to `unknown`, not `failed`. `unknown` is the state `plot-board-setup/SKILL.md:434` handles as *"cannot verify — say so; never round it up"*, which is the **safe** direction, not the trust-costing one the plan describes.

**This does not make the defect unreal** — the regex is provably unmatchable and must be fixed. It means **the reported symptom and the diagnosed cause may be two different bugs**, and the plan has merged them. If the reporter genuinely saw `failed` against a working Jenkins, something other than this regex produced it, and slice 1 will not fix their report.

### Could not verify: `plot-host.sh:677`

The plan says a `silent` CI means "`plot-host.sh:677` exits 3 at the first build lookup". Line 677 is not an exit-3 site — it is inside a backtick-parsing loop for the CI config value:

```
$ sed -n '675,679p' skills/plot/scripts/plot-host.sh
  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    if ci_looks_like_host "$candidate"; then
```

The real refusal is at **918**. The claim is directionally right and the citation is off. Two domain comments (`stack.ts:515`, `:550`) carry the same stale `:677`, so the plan inherited it rather than inventing it — worth correcting at the source rather than propagating a third copy.

---

## 5 — What has the plan missed that my lens notices?

### (a) The estate now has TWO collectors of this field, and the plan fixes one without naming the other

This is my central finding. `/plot-board-setup` runs **both**:

```
$ sed -n '82,85p' skills/plot-board-setup/SKILL.md
../plot/scripts/plot-board-probe.sh    # can the board run here?
../plot/scripts/plot-detect-repo.sh    # what is this repo?
```

and then:

> *"Merge their reports; **neither script grows the other's field**"*

Both emit `ci_signals.jenkinsfile`. The skill says to merge them and **does not say which wins on a conflict**. On the reporting repository the two disagree: `plot-detect-repo.sh` answers `true` (it searches properly), `plot-board-probe.sh` answers `false`. On this repository I confirmed detect-repo answers:

```
$ bash skills/plot/scripts/plot-detect-repo.sh | jq .ci_signals
{"jenkinsfile": false, "gh_workflows": true}
```

**So there is a live, undefined merge conflict on the exact field this plan changes, and the plan does not mention it.** Three outcomes the plan should have chosen between, and did not:

1. Fix the probe independently (what the plan proposes) → two implementations that must not drift, with no corpus test binding them. The repo's own rule in `CLAUDE.md` — *"Duplication is allowed and undeclared duplication is not"* — makes this the option that requires the **most** extra work, none of which the plan budgets.
2. Port detect-repo's one-liner into the probe → two identical implementations, drift still undeclared, but at least agreeing on day one.
3. **Remove the field from `plot-board-probe.sh` and let `plot-detect-repo.sh` own it.** Setup already calls both and merges. The probe's stated question is *can the board run here?*; which CI builds the repository is *what is this repo?* — detect-repo's question by the skill's own division at `SKILL.md:83-84`.

My lens says (3) is the smaller change and the one that removes a class of bug rather than an instance. But the point is not that I get to pick — **it is that this is a plan-level decision about what the estate contains, and the plan resolved it by not noticing it.**

### (b) The deferred bound is the wrong thing to defer, per the plan's own precedent

The plan defers depth and exclusions to the implementer, demanding they be "measured and stated in the script". It cites `plot-deliverable-search.sh` as precedent. **The precedent does not transfer, and it argues against the plan.** I read its header: what makes it exemplary is that it **names its corpora in the plan/header rather than leaving them to the implementer** —

> *"WHAT IT SEARCHES IS NAMED, NOT GUESSED — four corpora, the four places those five were hiding"*

Its bound is *declared and justified*, not delegated. It also explicitly rejects a proxy bound (*"a `length >= 3` filter was written first and it silently deleted `gh`... a term is refused by measurement and never by a proxy for one"*). A `-maxdepth N` chosen by an implementer is precisely such a proxy. Invoking this precedent while deferring the bound inverts it.

And the plan's other cited model — *"`gh_workflows` is the model that already works — it tests a known directory, not a path"* — **cannot be followed for Jenkinsfiles**, because there is no known directory; `.build/pipelines/...` is the plan's own counter-example. The plan names two models, and neither one supports the design it leaves open.

### (c) `gh_workflows` — I checked, and it does NOT have the same root-only problem. Fixing one is defensible.

My lens required me to ask whether this is a one-of-N fix. It is not:

```
$ sed -n '131,132p' skills/plot/scripts/plot-board-probe.sh
gh_workflows=false
[ -n "$git_root" ] && [ -d "$git_root/.github/workflows" ] && gh_workflows=true
```

`.github/workflows` is a **fixed, tool-mandated location** — GitHub Actions reads nowhere else. Root-only is correct there, and a search would be wrong. The asymmetry is real, so slice 2's narrow scope is justified.

**But there is a smaller latent defect the plan did not look for, which detect-repo already fixed:** the probe tests for the **directory**, while detect-repo requires an actual workflow **file**:

```
$ sed -n '206,209p' skills/plot/scripts/plot-detect-repo.sh
  # A directory with no workflow file in it is not a signal: `.github/workflows`
  # survives in repositories whose workflows were deleted.
  git ls-files -z -- '.github/workflows/*.yml' '.github/workflows/*.yaml' | grep -qz . && gh_workflows=true
```

An empty `.github/workflows/` makes the probe answer `true`. That is a false positive in `proposeCi`, and it is the **same class of bug** as slice 2 — same field-set, same collector, already solved in the sibling. It is in scope for a plan titled *a probe reading is not a guess*, and the plan does not see it. This strengthens the case for option (3) above: the probe's `ci_signals` block is wrong in **two** ways, and detect-repo is right in both.

### (d) The auth fix cannot break `gh`/`bb` — verified, no objection

I was asked to check whether the shared `classify()` puts the gh/bb readings at risk. **It does not**, provided the fix stays inside the `jen` block. `classify` takes the success regex as a parameter; gh and bb pass their own:

```
$ grep -n "classify \"\$out\"" skills/plot/scripts/plot-board-probe.sh
247:  gh_auth=$(classify "$out" "$st" 'logged in to')
254:  bb_auth=$(classify "$out" "$st" 'logged in as')
266:    jen_auth=$(classify "$out" "$st" 'jenkins auth:[[:space:]]*reachable')
```

Both live wordings still match their regexes:

```
$ gh auth status   →  ✓ Logged in to github.com account jwloka (keyring)     [matches 'logged in to', -i]
$ bb auth status   →  Logged in as: Jan Wloka (jwloka)                        [matches 'logged in as', -i]
```

So the blast radius is one argument at one call site — **as long as the fix is the regex and not `classify`'s body.** The plan says "the fix must not widen the line it reads", which covers this. I would make it explicit: **`classify()` is not to be touched.** Its three callers make it the one genuinely shared surface in this change, and it is the only way slice 1 could acquire a blast radius it does not currently have.

---

## What I would amend

1. **Name `plot-detect-repo.sh` in the Design, and decide the ownership question** — probe fixes itself / probe copies detect-repo / probe drops the field. The plan cannot leave two collectors of one field undecided while changing one of them.
2. **Decide the bound in the plan.** `git ls-files -- '*Jenkinsfile' '*Jenkinsfile.*' 'Jenkinsfile*'` is measured at 7 ms, needs no depth and no exclusion list, and satisfies all four Done-when conditions. If it is rejected, say why in the plan — do not hand the question to the implementer.
3. **Separate the reported symptom from the diagnosed cause in slice 1.** The regex defect misreports *success* as `unknown`; the report claims `failed` against a working CLI. Pin the fixture to the CLI's real output (`OK — <user>` **and** exit 0), and note that `NOT reachable` + exit 1 already reads `failed` without the regex.
4. **Fix the `plot-host.sh:677` citation to `:918`**, and consider correcting the two domain comments that carry the same stale line.
5. **Either drop the cost "gate" or give it a threshold.** As written it is a rule wearing a gate's clothes.
6. **Add: `classify()` is unchanged.** One sentence, and slice 1's blast radius is provably one regex argument.
7. **Consider folding in the empty-`.github/workflows` false positive** — same collector, same class, already solved next door.

None of these needs new discovery. Items 1, 2 and 7 are answered by one file the plan has not read.
