# Premise lens — setup-proves-the-jenkins-job-answers (#913)

**Lens:** does setup genuinely fail to verify what this plan says it fails to verify?
**Method:** read `skills/plot-board-setup/SKILL.md` end to end (all 498 lines, steps 1-5 plus the failure-modes table), then `plot-host.sh:700-880` and `plot-board-probe.sh:210-264` on `origin/main` at `af09f8dcb`.

## What I read

| file | range | why |
|---|---|---|
| `skills/plot-board-setup/SKILL.md` | 1-498, whole file | establish what the gate actually checks |
| `skills/plot/scripts/plot-host.sh` | 700-880, 3185-3215 | the `<slug>/<job path>` contract and both resolution sites |
| `skills/plot/scripts/plot-board-probe.sh` | 41-43, 120-121, 210-264, 266-282 | what the probe emits about `jen` |
| `test/reconcile/boardprobe.test.mjs` | 68, 248-300, 330-379 | the existing `jen` stub harness |
| `docs/plans/2026-09-15-the-board-asks-the-build-resolver.md` | 96-121 | rejected sibling #1 |
| `docs/plans/2026-09-15-the-deploy-job-shows-on-main.md` | 110-135 | rejected sibling #2 |
| `docs/plans/2026-09-15-a-jenkins-job-is-read-by-its-shape.md` | 111-234 | the survivor, delivered today |
| `docs/sprints/2026-W41-a-declared-agent-costs-what-it-costs.md` | 1-25 | sprint state |

## 1. Every factual claim about this repository — checked

**The `plot-host.sh:702-708` contract: TRUE, cited exactly.** The line numbers are right to the line:

```
702: # $1 = Jenkins instance value from config: `<slug>` or `<slug>/<job/path>`.
703: #      The slug is what `jen -I` takes; the remainder (after the first `/`) is
704: #      the multibranch job's container path.
708: #      path in `PLOT_JENKINS_JOB` overrides, for a caller that has it separately.
```

The plan's block quote reproduces :702-704 verbatim. Its `:708` citation for the override is exact.

**The override exists and behaves as described: TRUE.** `plot-host.sh:758-767`:

```sh
if [ -n "${PLOT_JENKINS_JOB:-}" ]; then job="$PLOT_JENKINS_JOB"
elif [ "$instance" = "$slug" ]; then job=""      # bare host → root scope
else job="${instance#*/}"; fi
```

The override is tested **first**, so it wins over both the slug-only and the suffixed form. A second, independent resolution at `:3194-3197` (the `run-for-sha` arm) applies the same precedence. **The plan's claim that a slug-only value is legitimate under the override is correct on both sites.**

**The slug-only failure mode: TRUE and stronger than the plan states.** `:760-764` sets `job=""`, and `:850` then runs `jen job list --json` at the root scope. The code's own comment concedes the outcome: *"otherwise no branch matches and every row reads `none`"*. So the mechanism the plan blames is documented in the source it cites.

**"Setup checks reachability only": TRUE — and I verified it by reading the gate rather than the plan's summary.** Step 4 has exactly three parts. **4a Auth** (`:388-398`) reports the probe's `jen.auth` enum and nothing else. **4b** (`:400-425`) starts the board and asserts `/api/board` parses with non-empty `columns` — it asserts nothing about `checks`. **4c** (`:427-443`) runs `plot-plan-meta.sh` per plan when cards are zero — plan-format only. Step 5 summarises.

The probe behind 4a (`plot-board-probe.sh:250-263`) runs `jen -I "$jen_instance" auth status` — **the slug only**, `$jen_instance` unsplit, no job path, no `job list`, no `job view`. `classify` (`:227-233`) greps the `Jenkins auth:` line. For `Quatico.Webseite/quaweb-website` the slug is reachable, so this returns `ok`.

**Decisive negative evidence.** `grep -n -i "job path\|branch job\|job list\|jenkins_build_map\|pr-list"` over the whole 498-line skill returns **zero matches**. The word *job* appears in the skill only inside `jen -I apps auth login` remediation text (`:392`) and in `package.json` script discussion. **Setup has no concept of the job path at all.** That is a stronger statement than "it checks reachability only", and it is the plan's premise confirmed independently of the plan's wording.

**One claim I could not verify, and the plan says so first.** The live table (slug-only → no rows; `<slug>/quaweb/continuous-build` → 4 PRs green) is a `pr-list --rich` measurement against `Quatico.Webseite/quaweb-website`. I cannot reach a Jenkins instance. The plan flags this itself under `Verified separately`, and the same pair of readings appears in an independent artifact — `.plot/panels/2026-09-15-the-deploy-job-shows-on-main/premise.md:53` records the identical resolution rule from a different lens on a different day. **The mechanism is verified from source; the two-row outcome table is attested, not reproduced.**

**Unverified, minor:** the plan's reported board symptom (*"WAITING ON A MACHINE — could not reach the host"*) — I did not trace which renderer emits that string for `checks: unknown`. It is colour on the report, not load-bearing.

## 2. Is the diagnosis right?

**Yes, and it is the sharpest of the four Jenkins plans this week.** The defect is a genuine scope mismatch between two questions:

- the slug addresses the **server**, and `jen auth status` answers about the server;
- the job path addresses the **container**, and nothing in setup asks about it.

Both siblings that were rejected got the *mechanism* wrong. `the-board-asks-the-build-resolver` claimed `buildFor` had no caller — disproved by `build-resolve.ts:64` (`:101-108`). `the-deploy-job-shows-on-main` claimed a missing key when the real gap was a missing verb, `job view` vs `job list` (`:119-135`). **This plan names no mechanism that does not exist.** It asserts only that setup omits a check, and an omission is verified by exhaustive reading — which is what the zero-match grep is.

It also stays inside its lane where the siblings did not: it explicitly declines to change `plot-host.sh`, correctly, since `a-jenkins-job-is-read-by-its-shape` fixed the reader today and this is the adoption side.

**One diagnostic refinement the plan understates.** `jen_auth="unknown"` is returned when **no** instance resolves (`:259-263`), and step 4a's table maps `unknown` to *cannot verify*. So setup already refuses to green-light a **missing** key. The gap is narrower than "setup reports green on an unverified Jenkins": it is that a **present but incomplete** value reads `ok` while a **wholly absent** one reads `unknown`. That is the worse failure of the two — a partial value scores strictly better than no value — and it sharpens the plan's case rather than weakening it. Worth stating in the plan.

## 3. Is "a shape check is not the fix" correct?

**Correct, and verified at two sites.** `PLOT_JENKINS_JOB` is tested before both the slug-only and suffixed branches at `:758` and again at `:3197`. A repository exporting it with `Jenkins instance: apps` is fully functional. A shape check refusing `apps` for lacking a `/` would refuse that working configuration.

The plan's positive form — *ask whether it answers, which cannot refuse a working configuration* — is right as stated, because the resolution the check would run is the same resolution `jenkins_build_map` runs, override included. **A check that reproduces the override's precedence cannot disagree with runtime.** That is the whole argument, and it holds.

**Caveat for implementation, not an objection.** The property only holds if the check **reuses** the resolution rather than reimplementing it. `plot-host.sh` already carries two independent copies (`:758-767` and `:3194-3197`); a third, written in skill prose or in the probe, is where the override would get dropped. **This is the failure mode most likely to occur and the `Done when` does not forbid it** — see §4.

## 4. What `Done when` fails to pin

**The gap is WHERE the check lives, and it decides whether any gate is real.**

`/plot-board-setup` is a **skill** — 498 lines of prose. It has no unit tests; `git ls-tree` finds no test file for it. `jenkins_build_map` likewise has **zero test coverage**: grepping `jenkins_build_map` across the estate returns only plans, briefs, panels and the changeset — **no test file**. So "pinned by a fixture" and "`pnpm run test:contracts` passes" are satisfiable in two very different ways:

- **In the probe** (`plot-board-probe.sh`), where `boardprobe.test.mjs:260-296` already has a `stubClis` PATH-isolation harness that stubs `jen` with canned stdout. A check here is genuinely fixture-pinnable, and the two existing `jen` tests (`:341`, `:361`) are the template.
- **In the skill**, as prose instructing the agent to run a command. `test:contracts` would pass **without executing the new check at all**, because no contract test reads the skill's Jenkins prose.

**The concrete way to satisfy every gate and still be wrong:** add a paragraph to SKILL.md step 4 saying *"run `jen -I <slug> job list <path> --json` and report the count"*, add a fixture to `host.test.mjs` asserting a canned empty listing maps to an empty map, and ship. Every listed gate passes — the empty answer is "pinned by a fixture", the four-PR answer is "pinned", no config key was added, `test:contracts` is green. **And an adopting operator gets nothing**, because the prose is a rule and not a gate, and nothing verified the agent runs it. This repo's own CLAUDE.md names that exact trap: *"Can you answer 'Did I complete this?' without actually doing the work? If yes, it's a rule."*

**Three further unpinned points:**

- **The override is not pinned in the resolution.** The gate says a slug-only value with `PLOT_JENKINS_JOB` set *"is NOT refused"*. Passing that is trivial — a check that refuses nothing satisfies it. What is unpinned is that the check **resolves through the override**, i.e. that with `PLOT_JENKINS_JOB=quaweb/continuous-build` the check *reports the branch jobs it finds*, not merely that it declines to refuse. As written, a check that skips Jenkins entirely when the variable is set passes this gate.
- **`unknown` is not distinguished from zero.** Since today's sibling, `jenkins_build_map` returns three statuses (`ok`/`failed`/`unknown`, `:781-784`, `:844`). The gate names only *"zero branch jobs"*. An unreachable host (`failed`) and an unmeasured shape (`unknown`) both yield an empty map, and reporting *"zero branch jobs — check the path"* for an auth failure sends the operator to fix the wrong thing. The estate is emphatic about this distinction elsewhere; the gate should carry it.
- **The Open Question is left open in the gate.** Whether adoption pauses on zero is deferred, which is fine, but *"reported and adoption continues"* is pinned while the wording is not — and the wording is the entire deliverable of a report-only change.

**What would fix §4:** put the check in `plot-board-probe.sh` as a new field (e.g. `jen.job_scope` / `branch_jobs`), resolved by a helper shared with `jenkins_build_map` or corpus-paired with it, and pin it in `boardprobe.test.mjs` with the existing `stubClis` harness. The skill then *reports a probe field*, which is exactly the split CLAUDE.md mandates — *"skills interpret and adapt; scripts collect and report"* — and the fixture becomes a real gate instead of a rule.

## 5. Strongest argument against doing this at all

**Nobody who hits this defect is running the check.** The board was already adopted at `Quatico.Webseite/quaweb-website`; `/plot-board-setup` is an adoption command, run once. Fixing it helps the *next* repository, while the repository that filed #913 is fixed by editing one config line. Against a sprint whose goal is agent charters and cost, a one-run-per-repo adoption nicety is arguably the wrong week's work — and the cheapest full remedy for #913 might be a **runtime** report (the board saying *"Jenkins answered, zero branch jobs for the configured path"*) which helps every repository on every refresh, not just at adoption.

**The counter, which I find stronger.** The failure this prevents is not *a wrong value* but *a false green* — adoption saying the configuration checked out when it had not looked. That is the precise failure mode `/plot-board-setup` exists to prevent, stated in the skill itself at `:429-431` (*"Claiming a rendering that does not exist is the failure this whole command is built to avoid"*) and again at `:451-454`. A command whose purpose is to refuse false confidence, issuing false confidence, is worth one slice. And the cost is genuinely small: one resolution, one call, a report.

**Secondary caution.** Three Jenkins plans were rejected this week on false premises. This one's premise holds — but note the correlation: all three failures came from **claims about what code does**, and this plan's central claim is about what code *does not* do. Absence is the harder thing to verify, which is why I read the skill exhaustively rather than sampling it. The zero-match grep is what I would ask a reviewer to re-run.

## Summary

The premise **holds**. Setup does not verify the job path — it has no concept of one, confirmed by exhaustive reading and a zero-match grep over the whole skill. The `plot-host.sh:702-708` contract is cited to the line. The `PLOT_JENKINS_JOB` override exists at two sites with the precedence the plan describes, so the "shape check is not the fix" reasoning is sound. The live two-row table is attested and not reproducible here, and the plan declares that itself.

What needs amending is not the diagnosis but the gate: **`Done when` does not pin where the check lives**, and the skill-prose placement satisfies every listed condition while delivering a rule rather than a gate — in a repository whose own rules name that trap. Pin the check to the probe with the existing `jen` stub harness, pin the override path positively, and separate `unknown`/`failed` from zero.

Verdict: amend
