# Implementer lens, round 2 — a-probe-reading-is-not-a-guess

Position: amend

I applied both slices in a scratch copy (`plot-board-probe.sh` untouched; `md5`
verified unchanged at the end) and ran them against real trees. **Both fixes
work.** The Design is now accurate. But the plan's own headline claim about
slice 1 — *"one word in one regex"* — is false as an instruction: taken
literally it **fails an existing passing test**, and the plan never names that
test. And slice 2's `Done when` contains a condition **no design named in this
panel can satisfy**, mine or round 1's.

---

## 1 — Did the amendment fix what round 1 found, or restate it?

**Fixed, genuinely, on four of round 1's five items.** I re-derived each.

| Round 1 finding | Amendment | Verified |
|---|---|---|
| Symptom is `unknown`, not `failed` | Rewritten with the exit trace | **fixed** |
| `plot-host.sh:677` citation false | Withdrawn, not replaced | **fixed** |
| Reported `failed` was correct | New section says so | **fixed** |
| Slice-1 gate pinned wrong pre-state | Now pins `unknown` | **fixed** |
| `:264` → `:263` | — | **NOT fixed** |

The `unknown` correction is not a restatement — I reproduced it:

```
$ # classify() + the :263 NOT-reachable arm, extracted verbatim
regex 'jenkins auth:[[:space:]]*reachable'   (today)
  OK line, exit 0            -> unknown      <- the plan's corrected claim
  NOT line, exit 1           -> failed
  unrecognised, exit 0       -> unknown
  OK-shaped, exit 1          -> failed
```

`classify` is at **:236** as the amendment now cites (`:236` = `classify() {`).
That citation is correct.

**Not fixed:** the plan still says *"`:264` tests `not reachable` before
`reachable`"*. It is `:263`; `:264` is the `jen_auth="failed"` assignment.

```
$ sed -n '262,264p' skills/plot/scripts/plot-board-probe.sh
262:    # `NOT reachable` must be tested BEFORE `reachable`, since it contains it.
263:    if printf '%s' "$out" | grep -qiE 'jenkins auth:[[:space:]]*not reachable'; then
264:      jen_auth="failed"
```

Round 1 named this explicitly. One line, unchanged. Minor, but it is the second
round of a panel that exists because of a wrong citation.

**Round 1's LARGEST finding was not addressed at all** — see §4.

## 2 — Did the amendment introduce a NEW false claim?

**No false claim. One number is unrepresentative, and one instruction is wrong.**

Every citation added since round 1 checks out: `:236` (classify),
`SKILL.md:434` (the `unknown` row, verbatim), `:132` (`gh_workflows` directory
test), `:130`, the `jen` exit-1 branch.

**The maxdepth table is correct, and I re-derived it on a real tree:**

```
$ mkdir -p .build/pipelines/website/{continuous-build,continuous-deploy,release}
$ # + node_modules/some-pkg/fixtures/Jenkinsfile
$ for d in 3 4 5 6; do find . -maxdepth $d \( -name node_modules -o -name .git \
    -o -name .worktrees \) -prune -o -name Jenkinsfile -type f -print | wc -l; done
-maxdepth 3 -> 0     -maxdepth 4 -> 0     -maxdepth 5 -> 3     -maxdepth 6 -> 3
```

5 is right; 4 finds nothing. The off-by-one paragraph is sound. **The plan
prints `-maxdepth 5 -> 1 hit(s)`; the reporting repository has three
Jenkinsfiles at that depth** and the plan's own Design lists all three. The
count is from a narrowed probe, not the stated tree. Cosmetic, but this plan's
subject is off-by-one arithmetic.

**The wrong instruction: "What is wrong is one word in one regex."** I applied
exactly that and measured the blast radius:

```
regex 'jenkins auth:[[:space:]]*ok'          (the literal "one word" fix)
  boardprobe.test.mjs:341 expects ok   -> unknown    ** TEST BREAKS **
  new OK-line, exit 0      wants ok    -> ok

regex 'jenkins auth:[[:space:]]*(ok|reachable)'
  boardprobe.test.mjs:341 expects ok   -> ok
  new OK-line, exit 0      wants ok    -> ok
```

`boardprobe.test.mjs:341` (*'probe: jen reachable reads as ok'*) pins
`Jenkins auth:  reachable` → `ok` — **a string the `jen` CLI never prints**, per
the plan's own §1. Round 1 (premise, §5.2) named this test and asked what
happens to it. **The amendment does not mention it.** So the plan's single most
prominent instruction silently forces a choice it never states:

- **replace** the word → one existing test fails, and the implementer must
  decide whether to delete or rewrite a test the plan never names;
- **add** the word (`ok|reachable`) → every test stays green, but the probe now
  matches a wording the CLI does not emit, which is the defect's own shape.

I confirmed the baseline is green before measuring — `node --test
test/reconcile/boardprobe.test.mjs` → **37 pass, 0 fail**, so the failure would
be caused by the change, not inherited. Blast radius is exactly **one** test:
`:444`/`:504`'s `jenFor` helper reuses the same unreal stdout but asserts only
`job`/`job_source`, and `:504` asserts `unknown` via the no-instance path where
`jen` is never invoked.

## 3 — Does `Done when` pin the corrected pre-state, and is that gate satisfiable?

**Slice 1: yes, and it is satisfiable — I satisfied it.** It now reads *"the
same fixture pinned to read `unknown` before the fix"*, which matches my
measurement exactly. Every other slice-1 condition holds under the
`(ok|reachable)` form and under ok-only:

```
NOT reachable, exit 1  -> failed   (tested before the success arm: :263 fires first)
unrecognised,  exit 0  -> unknown  (never ok)
OK-shaped,     exit 1  -> ok       <- NOT gated by the plan; see §4
```

**Slice 2: the depth gate is satisfiable and the fixture gate is not.** I ran
the four conditions against the plan's own design:

| Done-when condition | Plan's `find -maxdepth 5` + 3 exclusions | Result |
|---|---|---|
| root `Jenkinsfile` still `true` | matched | **pass** |
| `.build/pipelines/website/continuous-build/` `true` | matched (depth 5) | **pass** |
| none → `false` | no match | **pass** |
| in `node_modules` → not `true` | pruned, incl. nested | **pass** |
| **in a test fixture dir → not `true`** | **matched** | **FAIL** |

```
$ mkdir -p packages/board/test/fixtures && touch packages/board/test/fixtures/Jenkinsfile
$ find . -maxdepth 5 \( -name node_modules -o -name .git -o -name .worktrees \) \
     -prune -o -name Jenkinsfile -type f -print
./packages/board/test/fixtures/Jenkinsfile        <- the gate says this must NOT count
```

The plan names three exclusions and **none of them is a fixture directory**. The
gate cannot be tightened by depth either: the fixture above sits at depth 5 and
**the target hit is also depth 5** —
`.build/pipelines/website/continuous-build/Jenkinsfile` is five components. Any
bound that excludes one excludes the other.

**Round 1's proposed alternative fails the same gate**, which is why this is the
plan's problem and not a preference between designs:

```
$ git ls-files -- '*Jenkinsfile' '*Jenkinsfile.*' 'Jenkinsfile*'
.build/pipelines/website/continuous-build/Jenkinsfile
packages/board/test/fixtures/tiny-garden/Jenkinsfile   <- tracked, so it matches
```

A tracked fixture is tracked. **No design named anywhere in this panel satisfies
that condition.** Either the plan names a fixture exclusion, or it drops the
clause.

**The cost gate is still a rule wearing a gate's clothes** — round 1 (scope §3)
said so and the amendment kept it verbatim. I measured it, which took one
command:

```
$ time (find . -maxdepth 5 \( -name node_modules -o -name .git -o -name .worktrees \) \
        -prune -o -name Jenkinsfile -type f -print | wc -l)
0.038 total      # 0 hits; this repository has no Jenkinsfile
$ # unpruned, for contrast:                         0.079 total
$ # git ls-files equivalent:                        0.007 total
```

**38 ms — and the number is degenerate**: this repository contains zero
Jenkinsfiles, so "the search's cost on this repository" measures an empty
search. It also has **104 worktrees** under `.worktrees`, which is where the
pruning earns its 2× — a fact worth more than the number the gate asks for.

## 4 — Anything round 1 missed that is still wrong?

**(a) Round 1's biggest finding was not addressed, and it is not even a
disagreement — it is silence.** Scope's §5(a) central objection:
`plot-detect-repo.sh` emits the **same** `ci_signals.jenkinsfile` field, already
solved this exact defect on 2026-09-10 with the same `.build/pipelines/` stack
in its comment, and `/plot-board-setup` runs **both** collectors and merges them
with no stated conflict rule.

```
$ grep -c "detect-repo\|ls-files" docs/plans/2026-09-17-a-probe-reading-is-not-a-guess.md
0
$ git log -1 --format='%ai %s' -S'THE JENKINSFILE SEARCH IS NOT ROOT-ONLY' \
    -- skills/plot/scripts/plot-detect-repo.sh
2026-09-10 16:31:07 +0200 plot-init: the probe emits its CI signals
```

Still zero mentions after the amendment. The amendment's Notes section says it
reconciled a "two-lens panel" and reconciles only one lens's findings. As an
implementer this is the question I cannot answer alone: after slice 2 the estate
has **two different definitions** of one field, and `CLAUDE.md`'s own rule —
*"Duplication is allowed and undeclared duplication is not"* — says a corpus
test must then bind them. **The plan budgets no such test.** That is scope I
would be silently inventing.

**(b) A false-green hole slice 1 leaves open, and round 1 named it (premise
§5.4).** `classify` tests the regex **before** the exit code, so:

```
OK-shaped line, exit 1  ->  ok
```

A widened success regex **outranks a non-zero exit**. The plan's `Done when`
gates the unrecognised line and the NOT-reachable line, but never
*success-wording-with-a-failing-exit*. The plan's prose says *"with **exit 0**
reads `ok`"* — the condition is stated and **not gated**. Given this repo's rule
that a false green is the one direction that must never happen, that is the gate
I would expect to exist.

**(c) `-name` cannot express the configured `Worktree root`.** Answering the
rubric's question directly: **yes, the exclusion needs a config read the probe
does not currently do**, and it is cheap and idiomatic — the probe already
shells `plot-config.sh` three times (`:120`, `:121`, `:257`) and one more costs
**18 ms**. That part is fine. What is not fine is that `find -name` matches a
**basename only**, while `plot-config.sh:51-53` documents `Worktree root` as
*"A relative value resolves against the repo root, an absolute one is taken as
given"*:

```
$ # Worktree root = 'build/worktrees'
$ find . -maxdepth 5 \( -name node_modules -o -name .git \
     -o -name "build/worktrees" \) -prune -o -name Jenkinsfile -type f -print
./build/worktrees/b1/Jenkinsfile        <- NOT excluded; -name never matches a slash
./.build/pipelines/web/cb/Jenkinsfile
```

`-path`/`-prune` against a resolved absolute path is the working form. The plan
says *"excluding ... the configured `Worktree root`"* as if it were a name. It
is a path, and the default is `repo_root/..` — **outside the search root
entirely**, so in the default case the exclusion is a no-op and the plan does
not say so.

## 5 — Would I implement from this plan as it stands?

**Slice 2: yes, tomorrow.** The Design is accurate, the bound is decided rather
than delegated, and I built and ran it. Two things must change first: the
fixture-directory gate must be made satisfiable or dropped, and the
`Worktree root` exclusion must say `-path` against a resolved path.

**Slice 1: not without one sentence added.** The fix is four characters; the
undecided question is what happens to the test that pins a wording the CLI never
emitted. That is a judgement about what the estate should record, not a
mechanical step, and the plan hands it to me unnamed.

**What I would still have to invent, having actually tried it:**

1. **Replace or add?** `ok` vs `ok|reachable` — one breaks
   `boardprobe.test.mjs:341`, one keeps a fiction alive. The plan names neither
   option and neither test.
2. **What to do with `:341`, `:444`, `:504`'s unreal stdout** — delete, rewrite
   to `OK — <user>`, or leave.
3. **How to exclude a fixture directory** — by name (`fixtures`? `test`?
   `__fixtures__`?), by path, or not at all. No design in this panel satisfies
   the gate as written.
4. **`-name` vs `-path` for `Worktree root`**, and what to do in the default
   `repo_root/..` case.
5. **Whether to bind `plot-board-probe.sh` to `plot-detect-repo.sh`** with a
   corpus test, port its one-liner, or let the two answers diverge. This is a
   plan-level decision about the estate.
6. **Whether `ok` should also require exit 0.** The prose says it; nothing
   gates it.

Six decisions. **One** of them (1) sits under a sentence claiming the change is
*one word in one regex*.

**What the plan got right and I want on the record:** the pre-state gate is now
correct and I verified it by measurement, not by reading; the maxdepth argument
is sound and reproduced; the withdrawn `plot-host.sh` citation was withdrawn
rather than replaced with another guess; and the Notes section's admission that
no juror ran the probe was the right thing to write. **I ran it.** Both slices
work:

```
$ # a repo keeping .build/pipelines/website/continuous-build/Jenkinsfile
$ bash <scratch>/probe-B.sh   | jq .ci_signals   ->  {"jenkinsfile": true,  ...}
$ bash skills/.../plot-board-probe.sh | jq .ci_signals -> {"jenkinsfile": false, ...}
```

The defects are real, the fixes are right, and the plan is one round of naming
away from being implementable without invention.

*(`skills/plot/scripts/plot-board-probe.sh` was never modified — all edits were
made to a copy under the session scratchpad.)*
