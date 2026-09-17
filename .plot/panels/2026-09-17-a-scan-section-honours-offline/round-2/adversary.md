# Round 2 — ADVERSARY lens

Subject: `docs/plans/2026-09-17-a-scan-section-honours-offline.md`

Position: amend
adversary: amend

The amendment fixed the three sentences round 1 named and **introduced a new
false claim in the paragraph it wrote to replace them**. The `0.117 s × 292 ≈
34 s` prediction is wrong by two orders of magnitude and wrong in KIND: the scan
does not parse per plan. It parses all 292 in **one** invocation, measured at
**0.456 s**. So the plan's "an order of magnitude is unaccounted for" is not a
humble admission — it is an arithmetic error dressed as one. The residual is not
10× unexplained. It is **~1000×**, and the plan has now published a wrong
explanation of why it does not know.

And round 1's single highest-consequence finding — `gates` §5(i), the
`/plot-release` gate — was **not addressed at all.** I reproduced the exact
regression it predicted. It is worse than `gates` thought.

---

## 1. Did the amendment fix what round 1 found, or restate it?

**Three of four fixed properly. One ignored. Verified clause by clause.**

| round-1 amendment | in the plan now? |
|---|---|
| `premise` 1 — replace "2 delivered at 1.76 s" with `reaching_pr_state=0` | **Fixed**, and correctly |
| `premise` 2 — mark the 8.2 s table as reported | **Fixed** — "Reported on a repository with" |
| `premise` b / moderator — say the test needs a synthesized fixture | **Fixed**, and put in `Done when` |
| moderator — scope the cure honestly against 464 s | **Fixed in form, broken in substance** (§2) |
| **`gates` §3(e) — state the `unreleased_delivered` rule** | **NOT FIXED — verbatim unchanged** |
| **`gates` §5(i) — the `/plot-release` gate interaction** | **NOT FIXED — never mentioned** |
| `gates` §3(c) — require a non-empty online section 6 | **Not fixed** (clause still says only "a merged PR") |
| `gates` §5(iv) — a `--no-fetch` clause | **Not fixed** |
| `gates` §5(ii) — name `scan.test.mjs:612` as insufficient | **Not fixed** |

I re-derived the estate reading the amendment adopted, and it is right:

```
$ grep -lE '^\- \*\*State:\*\* Delivered' docs/plans/*.md | while read f; do
    echo "$f :: $(grep -m1 -E '^\- \*\*Type:\*\*' "$f")"; done
docs/plans/2026-09-15-the-skills-say-slices.md :: - **Type:** docs
docs/plans/2026-09-15-the-supervisor-log-has-a-ceiling.md :: - **Type:** infra
$ ls docs/plans/*.md | wc -l
     292
```

`:1143` is `case "$ptype" in docs|infra) continue ;; esac`, above the `pr-state`
call at `:1156`. **`reaching_pr_state=0` is correct.** Credit where due.

**But the amendment answered `premise` and left `gates` on the floor.** Five of
`gates`' findings survive untouched, including the two it said would move it to
`proceed`. The plan's own Notes claim *"Both jurors confirmed the defect and the
fix; both amended on this plan's own measurements"* and cite `gates` only for
the fact that test machinery exists — the one `gates` finding that required no
work. **An amendment that adopts the juror who found numbers and ignores the
juror who found consequences is not a correction pass.**

## 2. Did the amendment introduce a NEW false claim?

**Yes. The paragraph written to be honest about the residual is itself wrong,
and it is the only new prose in the Design.**

The plan now says:

> The per-plan parse at 0.117 s over 292 files predicts ~34 s, so **an order of
> magnitude is unaccounted for and this plan does not know what it is.**

Two independent errors.

**Error 1 — the per-plan figure is wrong.** Timed here, three runs:

```
$ for i in 1 2 3; do /usr/bin/time -p skills/plot/scripts/plot-plan-meta.sh \
    docs/plans/2026-09-15-the-skills-say-slices.md >/dev/null; done
real 0.08
real 0.03
real 0.03
```

**0.03 s, not 0.117 s** — and 0.08 s on the cold first run, so 0.117 s is not
even a warm outlier. The stated figure is ~4× the measurement.

**Error 2, and it is the disqualifying one — the scan does not parse per plan.**
`plot-reconcile-scan.sh:554-561`:

```bash
set -- "$PLAN_DIR"/[0-9]*.md
if [ -f "${1:-}" ]; then
  # ONE parser invocation for the whole sweep (see the single-pass note above).
  plan_json=$("$script_dir/plot-plan-meta.sh" "$@" --prefixes "$PREFIX_RE" 2>/dev/null)
```

The comment says **"ONE parser invocation for the whole sweep"**, four lines
above the call. So `0.117 × 292` multiplies a per-file cost by a loop that does
not exist — **structurally the identical error round 1 caught and the plan just
finished correcting** (`1.76 s × 2` over a loop that does not execute). The
plan fixed that instance and committed the same class of error in the
replacement paragraph.

Measured, the real whole-estate parse:

```
$ time skills/plot/scripts/plot-plan-meta.sh docs/plans/[0-9]*.md --prefixes "$PREFIX_RE" > pm.json
        0.26s user 0.03s system 63% cpu  0.456 total
$ wc -l < pm.json
     292
```

**0.456 s for all 292 plans.** Not 34 s. Not 0.117 s each.

**So "~34 s is the right prediction for 292 files" is FALSE, and the answer the
rubric asks for is: no.** The correct prediction for plan parsing is **~0.5 s**,
which is 0.1% of a 464 s scan, not 7%.

**The consequence is worse than the arithmetic.** The plan's honesty paragraph
reads "an order of magnitude is unaccounted for". With the real number the gap
is **464 s against 0.456 s — a factor of ~1000**, and the plan has *published a
false account of the 34 s it thought it could explain*. A reader now believes
plan parsing is the largest known component of an offline scan. It is among the
smallest. **A wrong explanation is more expensive than a stated absence**,
because the next person to optimise the scan starts at the parser.

I checked the other obvious candidates and eliminated them, so no one repeats
my search:

```
$ git for-each-ref --format='%(refname:short)' refs/remotes/origin | wc -l
       3          # branch loops (§2, §3, §19, §20) cannot dominate
$ time git log -1 --format=%ct -G'[Rr]ounds?[:*"]' -- <plan>
        0.046 total        # §15 pickaxe, and only 5 Draft plans exist
$ git tag | wc -l ; time git tag --contains <sha>
     209
        0.099 total        # §6's tag resolution
```

None of these explains 464 s either. **The plan is right that it does not know.
It is wrong about what it does know, and that is the new false claim.**

**One more inherited number nobody has flagged.** The plan's table keeps `8.2 s`
per `pr-state` from the reporting estate, while `test/reconcile/scan.test.mjs:601`
carries a comment reading *"Per-plan pr-state calls would cost 0.61 s each"* and
`premise` measured ~1.9 s here. Three figures, 13× apart, one of them in the very
test file this plan's gate will be written into. The plan now labels its table
"Reported", which is honest — but it does not say the repo's own test file
disagrees by an order of magnitude, so an implementer writing the cost comment
for the new test has no basis to pick.

## 3. Does `Done when` pin the corrected behaviour, and is the fixture gate satisfiable?

**The fixture gate is satisfiable — I built it and ran it. `Done when` still
does not pin the corrected behaviour, because `gates`' two amendments were
never applied.**

### The fixture is satisfiable, and cheaply

`scan.test.mjs` already contains everything needed. `Type: bug` / `Type: feature`
delivered plan fixtures exist at `:1012-1013`, `:1658-1659`, `:2871`, and
`shimScripts` at `:3054` copies the real scripts into a shim directory where
`plot-host.sh` is then overwritten by a stub (`:3139`). That is exactly the
level section 6 calls at.

**I built the plan's stated fixture — 3 delivered `Type: bug` plans, each
annotated `PR: #10N`, one tag `v1.0.0` — against an argv-logging `plot-host.sh`
stub.** Online:

```
########## ONLINE (--no-fetch) ##########
--- pr-state calls: 3
== 6. Delivered but already released (candidate /plot-release) ==
  2026-01-01-del1.md — shipped in v1.0.0, plan still Delivered
  2026-01-02-del2.md — shipped in v1.0.0, plan still Delivered
  2026-01-03-del3.md — shipped in v1.0.0, plan still Delivered
--- footer --- unreleased_delivered=3
```

**3 delivered plans → 3 calls, and a non-empty section naming a tag.** So
`gates`' §3(c) worry — that the obvious fixture prints `(none)` and the
byte-identity clause pins nothing — is avoidable, and this fixture avoids it.
**The plan's clause still does not require it**: it says "a fixture carrying a
delivered plan with a merged PR", and a merged PR whose merge commit carries no
tag prints `(none)`. One clause, unamended since `gates` asked. The answer to
"is it satisfiable" is yes; "does the clause require the satisfying version" is
still no.

### Offline — the defect, and the thing both rounds missed

```
########## OFFLINE ##########
--- pr-state calls under --offline: 3
   1 pr-state 101
   1 pr-state 102
   1 pr-state 103
--- header promise ---
PR state: skipped (--no-pr) — git merge-state only; no git-host network call.
--- footer --- unreleased_delivered=3   pr_source=off
```

Three host calls under the flag promising none, in a run whose own header denies
it. **Defect confirmed independently of both round-1 jurors.**

Then I diffed the two section 6 bodies:

```
$ diff <(sed -n '/^== 6\./,/^== blocking/p' online.txt) \
       <(sed -n '/^== 6\./,/^== blocking/p' offline.txt)
IDENTICAL — offline produces the FULL online answer
```

**Today `--offline` section 6 is not degraded. It is completely correct — it
cheats to get there.** That reframes the change and neither round said it: the
fix does not repair a broken output, it **removes a correct output** that was
being obtained by breaking a promise. Everything downstream of section 6 under
`--offline` gets worse in exchange for the flag becoming true. That is still the
right trade — but it is a trade, and the plan presents the change as pure repair.

### Which makes `gates` §3(e) + §5(i) the finding, and it is unaddressed

`gates` said the plan must state what `unreleased_delivered` reports under
`pr_source=off`, and warned the choice breaks `/plot-release`. The clause is
**verbatim unchanged**: *"reports a number that a reader can tell apart from a
measured zero"* — a goal, no rule.

I measured the consequence rather than arguing it. `skills/plot-release/SKILL.md:431`:

```
`unreleased_delivered=0` clears the gate. Any other number is a hard stop: show
section 6's findings and fix them before proceeding.
```

On my fixture **today**, `--offline` yields `unreleased_delivered=3` — the gate
correctly refuses. **After the fix, with the counter left at 0, the same estate
yields `unreleased_delivered=0` and the gate PERMITS a release it currently
refuses.** That is not the confusion `gates` predicted (a reader unable to tell
"never asked" from "nothing to release"); it is a **release gate silently
flipping from refuse to permit**, which is the one direction a gate must never
move by accident. Conversely, reporting the unresolved count hard-stops every
offline-run release and reproduces the 2026-09-16 incident `f5d052af` fixed.

Both branches are bad and the plan picks neither. **This is the amendment.**

**The repo already contains the answer, in this very file.** Section 20 does
exactly the right thing when its input is unavailable (`:2286-2292`):

```bash
if [ "$pr_reliable" != 1 ]; then
  echo "  (not evaluated — merged-PR list unavailable: pr_source=$PR_SOURCE${PR_ERROR:+ — $PR_ERROR})"
  echo "  Whether a branch's PR merged is the host's answer, never ancestry's."
  echo "  Re-run once the git host answers."
```

— counter stays 0, the section says it never ran, and it is **advisory so a
zero misleads nobody.** Section 6 is **blocking**, which is precisely why
copying section 20's shape without deciding the counter is unsafe. The plan
should say: the counter stays 0, the note states the skip AND the count of plans
skipped (`premise` §5(c)), and **`/plot-release`'s gate must additionally refuse
on `pr_source=off`** — because a 0 that means "never asked" cannot be allowed to
clear a gate that reads 0 as "nothing to release". That last half is a change
outside this plan's stated scope, and that is the finding: **the plan's scope is
too narrow for its own consequence.**

## 4. Is there anything both rounds have missed?

**Four things. The first two are mine; the third is the rubric's question.**

**(i) The scan parses once, so the plan's cost model is wrong in kind.** §2.
Both rounds accepted `0.117 s/plan` — `premise` even did the multiplication and
reported ~34 s as a legitimate partial explanation, and the moderator repeated it.
**Both jurors and the author reasoned from a per-plan parse that does not exist**,
four lines below a comment saying so.

**(ii) `--offline` section 6 is currently byte-identical to online.** §3. Both
rounds framed the change as repairing a broken flag; nobody measured that the
output being sacrificed is *complete and correct*.

**(iii) Is an unexplained order of magnitude acceptable in a plan?**

**Acceptable in a plan. Not acceptable in THIS plan, because it sits in the
opening sentence.** The distinction is the plan's framing, not its honesty.

A plan may say *"I do not know X"* about something outside its scope. But this
plan's `>` line — the one a reader meets first — is:

> `--offline` promises no git-host call and section 6 makes one per delivered
> plan, **so a scan the operator asked to stay local times out against the
> network.**

The `so` clause is a causal claim about the timeout, and the plan now admits it
cannot support it here: an offline scan on this estate takes 348–464 s with
**zero** host calls, so the timeout on this estate is not caused by the network
and will not be fixed by this change. The plan says this, deep in *What this does
not do* — the honesty is real. **But saying "my headline sentence's causal claim
does not hold here" in a later section does not repair the headline.**

**So the plan is aimed at the right defect and titled for the wrong one.** The
moderator said exactly this (*"fixes one and is titled for the other"*), and the
amendment added a caveat instead of retitling. The defect — *a declared flag is
violated* — needs no timeout to justify it. It is a broken promise in a tool, and
`gates` proved it with a call count, not a stopwatch. **A plan whose premise is
sound does not need a symptom it cannot reproduce.** The fix: lead with the
violated flag, demote the reporting estate's timeout to corroboration, and drop
the 34 s paragraph entirely rather than correcting its arithmetic — the residual
belongs in its own plan, where somebody measures it.

**(iv) Two `Done when` gaps survive from round 1 unaddressed** — no `--no-fetch`
clause (a guard written against `do_fetch` instead of `PR_SOURCE` passes every
other clause and silently changes a third flag), and `scan.test.mjs:612` still
unnamed as false coverage. That test is literally named *"--offline makes no host
call"* and passes today while section 6 calls the host — it asserts over a `gh`
stub, and section 6 goes through `plot-host.sh`. **The single most likely way
this ships green and wrong**, flagged in round 1, still not in the plan.

## 5. Would you implement from this plan as it stands?

**No — but the distance to yes is short, and none of it is design.**

What is sound: the defect (reproduced twice, independently), the fix (guard
`:1156` on `PR_SOURCE`), the refusal to go silent, the deferral of bundling, and
the fixture gate (built and run, both directions).

What blocks implementation:

1. **Decide `unreleased_delivered` under `pr_source=off`, and follow it
   downstream.** Leaving it 0 flips `/plot-release`'s gate from refuse to
   permit — measured, not argued. Section 20's `pr_reliable` shape is the
   precedent, and the release gate needs a matching refusal on `pr_source=off`.
   **If that is out of scope, the plan must say the gate is left unsafe and
   name the follow-up** — this estate's own rule (`CLAUDE.md`, *Where a rule
   exists and nothing calls it, that is a defect to report*).
2. **Delete or correct the 34 s paragraph.** It is false twice over and it is the
   only new prose the amendment added. "This plan does not know what an offline
   scan costs here, and 292 plans parse in 0.456 s so it is not the parser" is
   both true and more useful.
3. **Amend the byte-identical clause** to require a non-empty section 6 naming a
   tag — I have shown the fixture that does it.
4. **Add the `--no-fetch` clause and name `scan.test.mjs:612` as insufficient
   coverage.** Both were round-1 findings; both cost one sentence.

Item 1 is the one that matters. Items 2–4 are round 1's, unapplied. **I would
implement item 1's answer first, then this plan in an afternoon.**

---

**What would move me to `proceed`:** the counter rule stated with its
`/plot-release` consequence named; the 34 s claim removed; and the three
unapplied `gates` clauses folded in. **The design has survived two rounds of
adversarial reading and needs no change. The plan's prose has now been wrong
about its own numbers twice in the same paragraph position, and that is a
pattern rather than an accident.**
