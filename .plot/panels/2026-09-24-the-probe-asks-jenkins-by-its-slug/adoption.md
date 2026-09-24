# Adopting-repository lens — the-probe-asks-jenkins-by-its-slug

Position: amend

## The defect is real and the fix is the right one

Traced with the reporter's own value, `ewz/kus-portal/continuous-build-multi`:

- `plot-board-probe.sh:316` — `out=$(jen -I "$jen_instance" auth status 2>&1)` passes the **whole** value. `$jen_instance` is the raw config read at `:312-313`.
- `plot-board-probe.sh:376-393` — the same value is split correctly thirty lines below, producing `job=kus-portal/continuous-build-multi`, which is exactly what the reporter's JSON shows.
- The splitter at `:377-390` strips scheme and authority before splitting, and its four measured forms (`:359-362`) are real. Hoisting it and feeding `-I` its slug is the correct fix, and the slice's "one splitter in the file" Done-when is the right shape.

Nothing in the plan's Design is wrong. My amendments are about scope and about two claims that do not survive the trace.

## The Motivation's second sentence is false, and it is the sentence that sizes the slice

> "It decides what `/plot-board-setup` proposes, so a false `failed` blocks a correct configuration from being written." (plan `:15`)

**It blocks nothing.** I read every consumer of the probe's jen fields:

- `skills/plot-board-setup/SKILL.md:448` — the `failed` row of step 4a's table: *"not authenticated — name the exact fix, e.g. `jen -I apps auth login`"*. It **prints**, it does not gate.
- `skills/plot-board-setup/SKILL.md:~460` — *"Auth failure is never a hard stop. The board is useful with no host auth at all."* Explicit.
- The two places that **do** refuse the `Jenkins instance` key are step 3's *Jenkins instance* entry (`SKILL.md:283-292`, fires when **no instance resolved**) and its *Jenkins JOB PATH* entry (`SKILL.md:294-317`, fires when **`jen.job` is `""``**). Neither reads `auth`. For the reporter, an instance resolved and `job` is non-empty, so **neither refusal fires and the key is written**.
- `SKILL.md:451-455` makes it explicit in the other direction: `jen.job` is what decides "not verified", *"whatever `auth` says"*.

So adoption for this reporter already wrote the correct config. The damage is narrower and worth stating accurately: **the operator was told their credentials do not work, and was handed `jen -I <full value> auth login` as the fix** — a command that will also fail, sending them to debug a healthy Keycloak session. That is a real defect and worth fixing. It is not a blocked configuration.

## No code reads `jen.auth`. Only skill prose does

`grep -rn 'jen\.auth\|jen_auth\|"jen"' packages/board/src packages/domain/src skills scripts` returns **five hits, all inside `plot-board-probe.sh` itself** (`:311, :319, :326, :331, :419`). The board payload never carries it; `packages/board/src/contract/schema.ts:667,1619,1674` cite the probe only as *precedent for three-valued readings*, not as a consumer. A false `failed` is invisible beyond the one `/plot-board-setup` run. The plan's "Board impact: none directly" is correct.

## The Open Question, answered: plot-host.sh does NOT share the defect

`skills/plot/scripts/plot-host.sh:1229-1231`:

```bash
jenkins_build_map() {
  local instance="$1"
  local slug job
  slug="${instance%%/*}"
```

`%%/*` — greedy strip from the first `/` — so the reporter's value yields `slug=ewz`, `job=kus-portal/continuous-build-multi`. Every `jen -I` in that function then takes the slug: `:1250` (`auth status`), `:1268` (`job view`), `:1321` (`job list`). The `run-for-sha` arm repeats the same split independently at `:3882-3886` (`_jen_host="${_jen_instance%%/*}"`).

**So after this fix the reporter's board does show build status.** Full path: `Jenkins instance` → `ci_instance()` (`:1133-1136`) / `jenkins_instance()` (`:1373-1376`) → `jenkins_build_map "$instance"` (`pr-list --rich` at `:3799`, `runs` at `:3882`) → `%%/*` split → `jen -I ewz job list kus-portal/continuous-build-multi` → branch→`checks` map → PR rows. The reporter's value is already the `<slug>/<job/path>` form #913 established as required, and `job list` on a `WorkflowMultiBranchProject` is the path `:1298` calls *"the path that has always worked"*. The probe was the only broken reader.

**The slice should record this answer rather than re-derive it.** The plan says the slice will "check whether `plot-host.sh`'s `jen` calls share the defect and report rather than widen silently" (`:94`). That check is done — above, with line numbers. Put the answer in the plan so the slice does not spend a worker re-measuring it, and so a reviewer can see the scope is genuinely one file.

## AMENDMENT 1 — the two splitters disagree on the URL form, and the plan's Done-when hides it

The plan's fourth Done-when is **"One splitter in the file"** (`:88`). Correct, and after the hoist the probe has one. But the estate then holds **two** splitters that disagree:

| value | probe (after hoist) | `plot-host.sh:1231` |
|---|---|---|
| `ewz/kus-portal/cb-multi` | `ewz` ✓ | `ewz` ✓ |
| `https://jenkins.example.com/quaweb/cb` | `jenkins.example.com` ✓ | **`https:`** ✗ |

Measured: `u="https://jenkins.example.com/quaweb/cb"; echo "${u%%/*}"` → `https:`.

The probe's own comment at `:365-367` already names this — *"`plot-host.sh:3197` carries the same latent bug and is DELIBERATELY NOT CHANGED here"* — and the plan's *What this does NOT do* (`:77`) restates the deferral. **The deferral is defensible; leaving it invisible is not.** After this fix the probe reports `auth: ok` for a URL-form instance whose board rows will all read `unknown`, because `jen -I https:` reaches nothing. That is the #913 failure mode — adoption green, board empty — reproduced through the exact fix meant to stop misreporting.

The reporter is unaffected (their value has no scheme), so this does not block the slice. **Add a Done-when**: the hoisted splitter's disagreement with `plot-host.sh`'s `%%/*` on the URL form is stated in the probe's comment as a known, scoped divergence with the issue that closes it — or the URL form is refused by the probe rather than reported `ok`. Per CLAUDE.md's *"Duplication is allowed and undeclared duplication is not"*, this is now a declared pair and it belongs in the comment at minimum.

## AMENDMENT 2 — three cited line numbers are wrong on main

- `:47` and `:81` cite `plot-host.sh:702` for the `<slug>/<job/path>` contract. Line 702 is `#`. The contract is stated at **`:1173-1174`** (and `:1105`, `:3894`).
- `:59` cites `plot-host.sh:616` for the URL form. Line 616 is unrelated `pr_list_call` prose. The URL-accepting comment is at **`:1126-1129`**.
- The probe's own comment cites `plot-host.sh:3197`; the actual latent split is **`:1231`** (and `:3882`), with `:3197` being an unrelated `else`.

The last one is pre-existing in the file and not this plan's fault, but the slice touches that comment block and should correct it while there. The first two are the plan's own and should be fixed before approval — a reviewer checking `:702` finds a comment character and cannot verify the premise.

## AMENDMENT 3 — the Done-when has no regression case for the reporter's shape

The four Done-when items (`:85-88`) cover: job-path value reports `ok`, slug-only still works, genuine failure still `failed`, one splitter. Missing: **a value whose job path is itself multi-segment**, which is the reporter's (`kus-portal/continuous-build-multi` — two segments). The hoisted splitter handles it (`#*/` is non-greedy, keeping everything after the first `/`), but it is the shape that was reported and it should be the named test case rather than a generic "carrying a job path".

## What I checked and found clean

- The `NOT reachable`-before-`reachable` ordering (`:318`) and the `OK` success word (`:326`) are untouched by the hoist and correct. The plan says so at `:75`.
- Keeping the split outside the `jen_installed` block (`:68`) is right, and the comment at `:344-347` states the reason. The hoist must land **above** `:314`, not inside it — the slice line says this.
- `PLOT_JENKINS_JOB` (`:396-401`) overrides `jen_job` only. It must **not** affect the slug handed to `-I`; `plot-host.sh:1233-1234` treats it the same way. The hoist must not accidentally couple them.
- `job_source` (`instance`/`override`/`none`) and `SKILL.md:319-323`'s handling of it are unaffected.

## Position rationale

The fix is correct, narrow and needed — an adopting operator is currently told their working credentials are broken and given a command that cannot work. I do not reject. I amend because the Motivation overstates the harm in the one sentence that justifies the slice's size, the Open Question is answerable from the code and should be answered in the plan rather than by a worker, and the fix leaves a second splitter that will produce the same class of false-green for the URL form without saying so.
