# Estate lens — the-probe-asks-jenkins-by-its-slug

Position: amend

The defect is real, the line citations are accurate, and the fix direction is right. Three findings require amendment: the splitter computes no slug at all (the plan says "the computation moves earlier" as if a slug already exists), the hoist has a real ordering hazard the plan does not name, and the Open Question is answerable now — the answer narrows the slice rather than widening it.

## Verified: the defect and its line numbers

`skills/plot/scripts/plot-board-probe.sh:316` reads exactly as quoted:

```bash
out=$(jen -I "$jen_instance" auth status 2>&1); st=$?
```

`$jen_instance` is the raw config value, assigned at `:312-313` (config key, then `JENKINS_INSTANCE` fallback). The `unknown` arm the plan cites is at `:330-333` and its comment is quoted correctly: *"Report that we cannot tell, never that it is fine."* The contract the plan attributes to `plot-host.sh:702` is actually stated at **`plot-host.sh:1173-1174`** — *"`<slug>` or `<slug>/<job/path>`. The slug is what `jen -I` takes"*. `:702` is in `url_encode`'s region and carries no such statement. Minor citation error; the contract itself is real.

## Verified: the splitter exists and is careful — but it produces a JOB, not a SLUG

`:337-402`. The four-form table the plan reproduces is verbatim at `:359-362`. The mechanism at `:376-394`: strip scheme (`:381-383`), take the remainder after the first `/` (`:384`), empty it when there was no `/` (`:385`), trim a trailing slash (`:388-390`).

Simulated against the five relevant forms, adding `slug="${_ji%%/*}"` after the scheme strip:

```
ewz/kus-portal/continuous-build-multi  → slug='ewz'                  job='kus-portal/continuous-build-multi'  ✓
apps                                   → slug='apps'                 job=''                                   ✓
https://jenkins.example.com/           → slug='jenkins.example.com'  job=''                                   ✓
https://jenkins.example.com/quaweb/cb  → slug='jenkins.example.com'  job='quaweb/cb'                          ✓
jenkins.example.com/quaweb/cb          → slug='jenkins.example.com'  job='quaweb/cb'                          ✓
```

So the slug is correct for all five — **but no `slug` variable exists in the file today.** `grep -n slug skills/plot/scripts/plot-board-probe.sh` returns eight hits, every one inside a comment. The plan's sentence *"the computation moves earlier, its scope does not narrow"* understates the change: the hoist must also **add** `slug="${_ji%%/*}"`, which is a new line, not a move. That is still one splitter, and the plan's Done-when 4 is satisfiable — but the slice description should say "hoist and extend", or an implementer reading "hoist" literally will find nothing to pass to `-I`.

### The hoist is safe, with one hazard the plan does not name

The splitter's own reason for sitting outside `jen_installed` (`:346-349`) is preserved by hoisting: it is a string test on a config value and must answer when `jen` is absent. Moving it *above* the auth block keeps it outside that block, so the property holds. `test/reconcile/boardprobe.test.mjs:512-522` is the gate that enforces it and would still pass.

**The hazard is `PLOT_JENKINS_JOB`.** The splitter's tail (`:395-401`) overrides `jen_job` from the environment. That override applies to the **job**, never to the slug. If the hoisted block is moved wholesale and an implementer later derives the slug from `jen_job`, a `PLOT_JENKINS_JOB=from/override` with instance `apps/from/instance` would corrupt the slug. The slug must be taken from `_ji` at `:384`'s point, before the override arm. The existing test at `:494-496` covers the job side of this and would not catch a slug regression — a new assertion is needed.

**Second, smaller hazard:** hoisting moves the whole `if [ -n "$jen_instance" ]` block above `:312`'s assignment if done carelessly. `jen_instance` is read at `:312-313`, and the auth block starts at `:314`. There are two lines of room. The hoist target is between `:313` and `:314`, not higher.

## ANSWERED: `plot-host.sh` does call `jen -I`, four times, and it splits — naively

Every `jen -I` invocation in the estate:

| site | what is passed | splits? |
|---|---|---|
| `plot-board-probe.sh:316` | `"$jen_instance"` — **raw value** | **NO — the defect** |
| `plot-host.sh:1250` | `"$slug"` | yes, `slug="${instance%%/*}"` at `:1228` |
| `plot-host.sh:1268` | `"$slug"` | same variable |
| `plot-host.sh:1321` | `"$slug"` | same variable |

So the probe is the **only** site passing a raw instance value. `plot-host.sh` does not share the defect the plan is fixing, and the slice does not widen. The plan's *"It does not touch `plot-host.sh`'s own `jen` calls"* is the right call and can now be stated as a finding rather than a check.

**But `plot-host.sh:1228` carries a different, weaker defect** — `slug="${instance%%/*}"` does not strip the scheme, so `https://jenkins.example.com/quaweb/cb` yields `slug='https:'`. The probe's own comment at `:368-370` already names this (*"`plot-host.sh:3197` carries the same latent bug and is DELIBERATELY NOT CHANGED here"*) and gives the blast-radius reason for leaving it. The line number in that comment is stale — the naive splits are at **`:1228`** and **`:3884-3886`**, not `:3197`, which is a `gh pr list` call. Whether `jen -I https://…` works is moot for `plot-host.sh` since `ci_looks_like_host` (`plot-host.sh:1074-1077`) passes a URL whole and `:1127-1129` records that *"`jen -I` accepts either"* form — meaning the URL form would reach `-I` as `https:` after the naive split, which is neither the URL nor the slug. Out of scope here; worth filing.

## Tests exist, and they are good

`test/reconcile/boardprobe.test.mjs` covers the jen surface densely: `:341-400` the auth enum, `:449-496` all four URL forms plus both `PLOT_JENKINS_JOB` arms, `:512-522` the jen-not-installed gate, `:525-553` the no-network gate asserting `calls.length === 1` and `calls[0]` matching `/auth status/`.

**That no-network gate is the one the fix must not break** (`:546-552`). It asserts exactly one `jen` invocation and that it is the auth call. Hoisting adds no call, so it passes — but the test's instance is slug-only (`apps`), so it exercises the case that already works. A new test with `ewz/kus-portal/continuous-build-multi` asserting the recorded argv contains `-I ewz` and not `-I ewz/kus-portal/...` is the regression lock this slice needs, and the counting stub at `:415-429` already provides the mechanism.

## Prior art

Fifteen plans touch Jenkins. The relevant ones: `docs/plans/2026-09-09-the-ci-key-carries-its-instance.md` established the `<slug>/<job/path>` form; `docs/plans/2026-09-15-setup-proves-the-jenkins-job-answers.md` is #913 and built the splitter this plan hoists; `docs/plans/2026-09-15-a-jenkins-job-is-read-by-its-shape.md` built `jenkins_build_map`, the function whose `slug` at `:1228` is the correct-by-example the probe lacks. No plan proposes this fix. No duplication.

## What to amend

1. Slice text: say the change **adds** a slug derivation beside the existing job split, not merely that it hoists. There is no slug variable to move.
2. Name the `PLOT_JENKINS_JOB` ordering constraint — the slug is read before the override arm at `:395-401`, never from `jen_job`.
3. Close the Open Question with the table above: `plot-host.sh:1250/1268/1321` all pass `$slug` from `:1228`. No widening.
4. Correct `plot-host.sh:702` → `:1173-1174`.
5. Add a Done-when for the regression lock: a probe over `ewz/kus-portal/continuous-build-multi` records `jen -I ewz auth status` and nothing longer.

Everything else in the plan is accurate and the direction is right.
