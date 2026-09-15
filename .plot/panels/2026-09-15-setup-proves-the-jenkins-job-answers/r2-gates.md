# Gates lens, round 2 — setup-proves-the-jenkins-job-answers (#913)

**Lens:** is each stated gate buildable, discriminating, and green only when the defect is fixed?
**Baseline:** `origin/main` at `c3c72a029`. Round 1's failure was a gate that pinned a behaviour the estate never produces (`verifiability.md` §3). My job is to check the replacement does not repeat that in a new shape.

## 1. The amendment's new claims — all four verified TRUE

| claim | check | result |
|---|---|---|
| `plot-host.sh:3197-3205` separates the zero-cases offline | read `:3192-3206` | **TRUE, and the quote is verbatim to the line.** `:3197` is the override, `:3198` the emptiness test, `:3202-3204` the two-sentence refusal, `:3205` `exit 4` |
| `PLOT_JENKINS_JOB` is honoured before the emptiness test | `:3196` then `:3197` then `:3198` | **TRUE.** The override is assigned *after* the slug-split and *before* `[ -z "$_jen_job" ]`, so a slug-only value with the override set never reaches the refusal |
| `SKILL.md:275-281` is the refuse-the-key precedent on this very key | read `:272-281` | **TRUE.** *"A wrong instance is worse than an absent one … Write no `Jenkins instance` key"* is at `:275-280`, and it is the Jenkins key, not an adjacent one |
| `jen_auth` returns `unknown` when no instance resolves | `plot-board-probe.sh:246-263` | **TRUE.** `:258-262`: the empty-instance arm sets `jen_auth="unknown"` with the comment *"Report that we cannot tell, never that it is fine."* Step 4a (`SKILL.md:389-391`) maps `unknown` → **cannot verify** |

**Nothing in the amendment is unverified.** The one claim I could not reproduce — the live `pr-list --rich` table — is unchanged from round 1 and is now **load-bearing on nothing**: the Design uses it as motivation, and no gate depends on it. That is the substantive improvement. Round 1's gate 1 *was* that measurement; the replacement is a string test on a config value, and I executed the rule to confirm it decides all four cases without a network call (below).

**One imprecision, cosmetic.** The Design's block quote is attributed to `:3197-3205` but its first line is `:3197`, and the quoted `[ -n "${PLOT_JENKINS_JOB:-}" ] && _jen_job=...` is the line *before* the `if`. The range is right; the reading order in the quote is the file's. No correction needed.

## 2. Does the new mechanism distinguish the two zero-cases?

**Yes, and this is the clean part of the amendment.** I ran the rule as `plot-host.sh:3194-3198` implements it, over the cases the `Done when` names:

```
inst='apps'                            override=''          -> REFUSE
inst='apps'                            override='quaweb/…'  -> ACCEPT (job=quaweb/…)
inst='apps/quaweb/continuous-build'    override=''          -> ACCEPT (job=quaweb/…)
inst=''                                override=''          -> NO KEY (unknown)
```

Four cases, four distinct answers, zero `jen` invocations. *The value names no job path* (config defect, refuse) and *the value names a job with no children* (fresh container, silent) are separated by **the split itself**, before anything is asked. Round 1's objection — that both zero-cases produce byte-identical payloads (`verifiability.md` §3) — dissolves, because the discriminator moved off the payload and onto the string. That is the right move and the plan argues it correctly.

## 3. Gate-by-gate: can every gate be built and run in THIS repository?

**How `/plot-board-setup` is tested today — and this is the finding.** Four test files name it: `boardprobe.test.mjs`, `boardverify.test.mjs`, `boardctl.test.mjs`, `init-stack.test.mjs`. **Every one of them tests a SCRIPT.** `boardprobe.test.mjs:3` states its own scope — it tests `plot-board-probe.sh` *"so /plot-board-setup can PROPOSE rather than interview"*. `boardctl.test.mjs:316` asserts a *string* `/plot-board-setup` appears in another script's output. `init-stack.test.mjs:134` mentions the skill in a **comment** explaining what it does not test.

**Zero tests execute the skill's decision logic.** The only tests that read `SKILL.md` at all are `unattended.test.mjs`, and they are structural: `:108-124` counts `PLOT-UNASKED:` lines against `**Unattended (...)` declarations, `:126-149` validates the em-dash field format. They assert a line exists and parses. They assert nothing about what the skill decides.

Against that, gate by gate:

| # | gate | buildable here? | discriminating? |
|---|---|---|---|
| 1 | slug-only, no override → **refused** | **Only if the rule lands in a script.** In SKILL.md prose: unbuildable as a gate | yes, if scripted |
| 2 | slug-only **with** `PLOT_JENKINS_JOB` → accepted, "pinned explicitly" | same | **weak — see §4** |
| 3 | `<slug>/<job path>` → accepted unchanged | same | yes |
| 4 | **`jen` invoked zero times** | **YES, and the precedent is exact** | yes |
| 5 | no Jenkins at all → still `unknown` | **YES — already true and already tested** | **no — see §4** |
| 6 | fresh container, no children → not flagged | yes if scripted; trivially true otherwise | **weak — see §4** |
| 7 | refusal sentence names `<slug>/<job/path>` | yes, string assertion | yes |
| 8 | no new config key | yes | yes |
| 9 | `pnpm run test:contracts` passes | yes | **passes regardless — see §4** |

**Gate 4 is assertable, and the amendment is right to claim it.** `host.test.mjs:1452-1463` — `makeJenStub` writes `printf '%s\n' "$*" >> "$callsFile"` as its first line, so every invocation is recorded. The zero-invocation assertion has a named precedent in the same file: `host.test.mjs:1374-1398`, *"bitbucket issue ops never write to the tracker"*, stubs `bb`, appends argv to `bb.argv`, and asserts the file contains no write verb. Asserting `callsFile` does not exist, or is empty, is the same move one step stronger. **This gate is real and I can see how to build it.**

**Gate 5 is already true on main and already tested.** `boardprobe.test.mjs:382-390` — *"probe: jen without a configured instance is unknown, never ok"* — asserts exactly this today. So gate 5 is a **regression lock, not a gate**: it is green before a line is written. That is legitimate and worth having, but it must not be counted toward *did this slice do anything*.

**So the amendment's central claim — "every gate above runs in this repository with no Jenkins and no fixture anybody cannot regenerate" — is TRUE as far as it goes, and it is not the property that matters.** Every gate is *runnable* offline. Gates 1, 2, 3, 6 are only *enforceable* if the rule lands somewhere a test can execute. The plan never says where it lands, and the placement decides whether four of nine gates exist at all.

## 4. What the `Done when` fails to pin — and the way to satisfy every gate and still be wrong

**This is round 1's `premise.md` §4 objection, unaddressed by the amendment.** It said: *"`Done when` does not pin WHERE the check lives, and the skill-prose placement satisfies every listed condition while delivering a rule rather than a gate."* The amendment answers the *mechanism* objection (`verifiability.md`) in full and does not touch this one.

**The concrete wrong implementation, which greens all nine:**

1. Add a paragraph to `SKILL.md` step 3 or 4: *"If the `Jenkins instance` value contains no `/` and `PLOT_JENKINS_JOB` is unset, write no key — the instance must be `<slug>/<job/path>`."* — gates 1, 3, 6, 7, 8 are now "pinned" by the prose existing.
2. Add a `PLOT-UNASKED:` line beside it. `unattended.test.mjs:108` counts it. **Green.**
3. Gate 4 — `jen` invoked zero times — is green because **nothing was added that could invoke `jen`**. The gate passes by the absence of the feature, not by its restraint.
4. Gate 5 is green on main already (`boardprobe.test.mjs:382`).
5. Gate 2 — slug-only *with* the override is accepted — is green because **nothing refuses anything**. Round 1 named this exact hole (`premise.md` §4, third bullet) and the amendment kept the clause unchanged: *"is NOT refused"* is satisfied by a check that refuses nothing, and a check that skips Jenkins entirely when the variable is set also passes.
6. `pnpm run test:contracts` — `./scripts/bounded.sh 1500 node --test test/reconcile/*.test.mjs` — passes, because **no contract test reads the skill's Jenkins prose**.

**All nine green. An adopting operator gets a rule an agent may or may not apply, and #913 recurs.** CLAUDE.md names this trap in its own words: *"Can you answer 'Did I complete this?' without actually doing the work? If yes, it's a rule."* Here the answer is yes for four of nine gates.

**This is round 1's failure in a new shape, which is what I was asked to check for.** Round 1: a gate green on a case that was never broken (an empty array = a Jenkins with no jobs). Round 2: a gate green on a case where nothing was built (gate 4 green by absence, gate 2 green by refusing nothing). Different shape, same property — **the gate does not require the defect to be fixed in order to pass.**

**Three further unpinned points:**

- **No `## Failure modes` row.** `SKILL.md:460-497` carries 21 rows and **zero** mention `jen` (grepped). An adopter looks up a finding there; a refusal with no row is a refusal nobody can interpret. `adoption.md` raised this and the amendment did not add it.
- **The `PLOT_UNATTENDED` shape is unnamed.** The new refusal is a decision at a question site. `unattended.test.mjs:108-124` requires one `PLOT-UNASKED:` line per `**Unattended (...)` declaration, and `:126-149` pins the three-field format with shape ∈ {default, refused, stopped}. If the refusal creates a new declaration, that suite is the gate it meets — and `Done when` names `test:contracts` without naming this obligation. If it *reuses* `:275-281`'s existing declaration, that should be said, because the two refusals have different triggers (no signal vs. an incomplete value).
- **A job path that names nothing is accepted.** Measured: `inst='apps/typo-nonexistent'` → ACCEPT. Correctly out of scope for an offline check, but the `Done when` nowhere states that the check proves only *a path was named*, never *the path resolves*. An operator reading "setup proves the Jenkins job answers" — **the plan's own title** — will believe more was proven than was. The title overstates the amended mechanism.

## 5. Strongest argument against doing this at all

**The amended plan is a four-line string rule, and its whole value depends on a placement it does not name.**

What survives the amendment is: split on the first `/`, honour `PLOT_JENKINS_JOB`, refuse if empty. That is `plot-host.sh:3194-3198` — four lines that already exist, already tested nowhere, and now to be written a **third** time (`:758-767` and `:3194-3197` are the two existing copies; `premise.md` §3 flagged the third-copy risk and the amendment made it certain by choosing the same rule). CLAUDE.md's *A Shell Script Asks The Domain* says duplication is allowed and **undeclared** duplication is not — a third copy joins the corpus tier or it drifts. The plan declares none.

The cheaper remedy the amendment makes available and does not take: `plot-board-probe.sh` already reads the instance at `:247`. A new probe field — `jen.job_scope: "root" | "named"` — is four lines in a script with a mature fixture harness (`boardprobe.test.mjs:255-296`, `stubClis` + `isolatedPath`), it is genuinely fixture-pinnable, the skill then *reports a probe field*, and it lands on the correct side of CLAUDE.md's own split: *"skills interpret and adapt; scripts collect and report."* Gate 4 becomes a real assertion (the probe is already under a `jen` stub that records nothing extra), and gates 1/2/3/6 become executable rather than prose. **That is the same slice, one placement decision different, and it converts four rules into four gates.**

**The counter, and it is why I am not rejecting.** The defect is real — a partial value scores strictly better than a missing one, which `jen_auth`'s own `unknown` arm proves — the premise held under three lenses, and the amended mechanism is correct, offline, override-aware, and separates the two zero-cases. Nothing here needs re-measuring. What it needs is one sentence saying where the rule lands.

## What would make this proceed

1. **Name the placement.** Put the rule in `plot-board-probe.sh` (or a helper the probe and `plot-host.sh` share), and say so in the `Done when`. Skill prose is a rule; this repo's own gate test refuses to call that done.
2. **Make gate 2 positive.** *"is NOT refused"* is satisfied by refusing nothing. Pin that with the override set the check **resolves through it** — the same assertion shape, on the accepted branch.
3. **Declare the duplication.** Third copy of a four-line rule → a corpus pair, or extract the split into one function both sites call.
4. **Add the `## Failure modes` row and name the `PLOT_UNATTENDED` shape** (new declaration, or explicitly reusing `:275-281`).
5. **Soften the title or widen the check.** "Proves the job answers" is not what an offline path test proves.

Items 2-5 are small. Item 1 is the one that decides whether this slice ships gates or prose, and it is the same finding round 1 filed and the amendment did not answer.

Verdict: amend
