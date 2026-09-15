# Readiness lens, round 3 — setup-proves-the-jenkins-job-answers (#913)

**Lens:** would I hand this to an agent tomorrow? Not *can I find something* — *is what remains cheaper to fix in review than in another round*.
**Baseline:** working tree at `c4d63baf1`; `origin/main` fetched. I read all five prior verdicts, then checked only the amendment's NEW claims against source.

---

## 1. The amendment's three new claims — all TRUE, and I executed the first

### 1a. Stripping scheme and authority handles all four measured forms — **TRUE, executed**

R2-mechanism's finding was that `${value#*/}` false-accepts `https://host/` (the #913 defect in URL clothing) and glues the host onto the job path for `https://host/job/path`. The amendment's fix is *"strips scheme and authority before splitting"*. I implemented exactly that sentence and ran it over the four pinned forms plus four neighbours:

```
jenkins.example.com                     REFUSE  job=''                    ✓ pinned
jenkins.example.com/quaweb/cb           ACCEPT  job='quaweb/cb'           ✓ pinned
https://jenkins.example.com/            REFUSE  job=''                    ✓ pinned
https://jenkins.example.com/quaweb/cb   ACCEPT  job='quaweb/cb'           ✓ pinned, host NOT carried
https://jenkins.example.com             REFUSE  job=''                    (no trailing slash)
Quatico.Webseite                        REFUSE  job=''                    the live #913 value
apps/                                   REFUSE  job=''                    trailing slash
http://h:8080/a/b                       ACCEPT  job='a/b'                 port survives the authority strip
```

**All four `Done when` forms land where the plan says, and the two R2 defects are gone**: the URL-with-no-path now refuses, and the URL-with-path yields `quaweb/cb` rather than `/jenkins.example.com/quaweb/cb`. The four unpinned neighbours also answer correctly, which matters because R2's whole finding was a shape nobody had reasoned against. I looked for a fifth: `http://h:8080/a/b` is the one where a naive authority strip could plausibly break (a colon in the authority), and it does not.

**The plan's claim that `plot-host.sh` carries the same latent bug is TRUE** — `:3193-3195` is `${_jen_instance%%/*}` / `${_jen_instance#*/}` with no scheme handling — and **the plan is right not to fix it there**. `plot-host.sh:3198` exits 4 inside one op; promoting that test into a refusal that blocks adoption is a wider blast radius, and the plan says so in those terms.

### 1b. `plot-board-probe.sh` is a sound home — **TRUE, on all three sub-questions**

| question | answer | evidence |
|---|---|---|
| does it already emit comparable readings? | **yes** | `plot-board-probe.sh:281` emits `"jen": {"installed", "auth", "instance"}` — the instance string is **already in the payload**. A `job path` reading is a sibling field on an object that already exists |
| is it tested? | **yes, maturely** | `test/reconcile/boardprobe.test.mjs`, 401 lines, five `jen` tests at `:341-400` |
| can a test call it? | **yes, and the harness is exactly right** | `stubClis()` (`:258-280`) PATH-stubs `gh`/`bb`/`jen`; `isolatedPath()` (`:294-296`) makes the stub dir the **whole** of PATH, with a measured comment explaining why appending `/usr/bin` is not isolation. `boardprobe.test.mjs:382-390` already asserts `p.jen.instance === ''` → `auth === 'unknown'` |

This is the placement both R2 lenses asked for, and it is better than either of them argued: **the field the check reads is already emitted**, so the slice adds a reading beside a reading rather than introducing a new source of truth.

**It also fixes gate 4 ("`jen` invoked zero times"), which R2-gates called green-by-absence.** In `plot-board-probe.sh` the gate becomes discriminating rather than vacuous: the probe **does** invoke `jen` at `:250` for auth, so a test asserting the job-path reading is produced while `jen` is called only for auth — or asserting the reading is correct with `jen` stubbed to exit non-zero — pins restraint rather than absence. In skill prose it could not. The placement decision converts the weakest gate into a real one.

### 1c. The nine gates are now each buildable AND discriminating — **TRUE for eight; one is a regression lock and the plan should not be read as claiming otherwise**

| # | gate | buildable in probe? | discriminating? |
|---|---|---|---|
| 1 | slug-only, no override → refused | yes | **yes** — fires on `Quatico.Webseite`, the live value |
| 2 | slug-only **with** `PLOT_JENKINS_JOB` → accepted | yes | **yes, now.** R2-gates' objection was that *"is NOT refused"* is satisfied by refusing nothing — but gate 1 now refuses that same input without the override, so the pair is discriminating **as a pair**: no implementation passes both while refusing nothing |
| 3 | `<slug>/<job path>` accepted unchanged | yes | yes |
| 4 | `jen` invoked zero times | yes | **yes, given 1b** — see above |
| 5 | no Jenkins → still `unknown` | yes | **no — already green** at `boardprobe.test.mjs:382-390` |
| 6 | fresh container, no children → not flagged | yes | yes — it names a job path, so gate 3's machinery answers it |
| 7 | refusal sentence names `<slug>/<job/path>` | yes | yes, string assertion |
| 8 | no new config key | yes | yes |
| 9 | `test:contracts` passes | yes | **yes, now** — `boardprobe.test.mjs` IS `test/reconcile/*.test.mjs`, so gates 1-7 land inside the suite gate 9 names. In skill prose it passed regardless; in the probe it cannot |

**Eight of nine discriminate. Gate 5 is a regression lock and green on main today.** That is legitimate and worth keeping — it is the *"a repository declaring no Jenkins still reads `unknown`"* clause, and a wrong implementation could plausibly break it — but it must not be counted as evidence the slice did work. The plan does not claim it is; I note it so a reviewer counting green checkmarks does not.

**The wrong implementation R2-gates constructed no longer greens.** Its recipe was: write the rule as a SKILL.md paragraph, add a `PLOT-UNASKED:` line, and all nine pass because nothing is executable. The amendment's first `Done when` clause — *"emitted by `plot-board-probe.sh` rather than described in skill prose … pinned by a test calling the probe directly"* — refuses that construction by name. I tried to build a new one and could not: any implementation that satisfies gate 1 (refuse `Quatico.Webseite`) and gate 2 (accept it with the override) and gate 3 in a probe field under a test has done the work.

---

## 2. Walking the whole `Done when` as an implementer

**I could build this tomorrow without asking a question.** The shape is: read `jen_instance` (already at `:247`), strip `*://`, split the authority off, honour `PLOT_JENKINS_JOB`, emit the reading on the `jen` object, and have the skill's step 4a act on it. That is under ten lines in a script whose neighbouring field is three lines, plus five or six tests in a file with the exact harness.

**Would a wrong implementation be caught?** The three ways to get it wrong:

- **naive `%%/*`** → caught by the two URL gates
- **prose instead of a script** → caught by the first clause and by gate 9
- **refusing nothing** → caught by gate 1 paired with gate 2

That is the failure space. I do not find a fourth that greens.

**The one thing an implementer must decide that the plan does not state: the reading's name and its values.** `jen.job_path` as a string versus `jen.job_scope: "root"|"named"` versus a boolean. R2-gates proposed the enum. This is a genuine open choice — **and it is the right size for an implementer to make.** Every consumer is inside this slice, the field is new so nothing can disagree with it, and naming a field in a plan is the kind of precision that produces a worse name than the person writing the tests would pick. **Not a blocker; a normal implementation decision.**

---

## 3. Is anything now FALSE, or merely imprecise?

**Nothing I checked is false.** Every claim I tested reproduced — three of the four line-cited claims were already verified twice by R2 lenses and I did not re-derive them; the new ones I ran.

**Four imprecisions, all of which I would raise in review rather than in a round:**

1. **The title overstates.** *"Setup proves the Jenkins job answers"* — an offline string test proves a path was **named**, never that it **resolves**. `apps/typo-nonexistent` is accepted, correctly and by design. R2-gates raised this. It is a title, the Design's own body says the opposite plainly (*"the check makes no network call … the distinction is in the value"*), and renaming a plan mid-flight costs a branch name, a slug and a symlink. **Leave it.**

2. **The `## Failure modes` row is still unlisted.** `SKILL.md:478-498` carries 21 rows, three of them refusals (`:487`, `:483`, `:486`), and `jen` appears in none. A new refusal with no row is one an adopter cannot look up. **This is a one-line table edit and it is in the skill the slice is already editing** — an implementer who adds a refusal and not its row has left the job half done, and a reviewer sees that in the diff. R2 filed it twice; I agree it should happen and disagree that its absence from `Done when` blocks dispatch.

3. **The `PLOT_UNATTENDED` obligation is real but already satisfied, and I checked rather than assumed.** `unattended.test.mjs:108-124` counts `**Unattended (` declarations against `PLOT-UNASKED:` lines and requires disclosures ≥ declarations. `SKILL.md:275-281` is the Jenkins key's existing declaration with its existing line. **A refusal that fires under the same key's clause adds no declaration, so the count is unchanged and the suite stays green.** If the implementer adds a *separate* declaration, they must add a line — and the test tells them so by name, at build time. **This is a gate that reports its own violation**, which is precisely when a plan need not restate it.

4. **The re-run path and whose environment holds `PLOT_JENKINS_JOB`.** R2-mechanism's §3, unanswered. An adopter with `Jenkins instance: Quatico.Webseite` already written, re-running setup, meets a refusal about a key that exists. And the override lives in the board's runtime env while setup runs in the operator's shell. **Both are real and both are about the refusal's WORDING, not its logic** — the sentence should name the existing key and say where the override is read from. The plan already requires the sentence to *"name `<slug>/<job/path>` and what to check"*; an implementer writing that sentence for a value that is already in the config file writes the right words or a reviewer tells them to.

**None of the four changes what gets built.** Three are wording, one is a table row inside the file being edited.

---

## 4. The one structural thing I considered blocking on, and did not

**The undeclared duplication.** Both R2 lenses raised it: the split rule now exists at `plot-host.sh:758-767`, `:3193-3197`, and — after this slice — in `plot-board-probe.sh`. CLAUDE.md's *A Shell Script Asks The Domain* says duplication is allowed and **undeclared** duplication is not; a duplicated rule joins `packages/domain/corpus/`.

**I do not think it blocks, and the reason is in the amendment itself.** The three copies are no longer the same rule: the probe's version strips a scheme and the two in `plot-host.sh` do not. A corpus test asserting they agree **would fail on the URL forms**, and it would be right to — `plot-host.sh` has the latent bug the plan deliberately declines to fix here, for a blast-radius reason I agree with. So the correct pairing does not exist yet, and demanding it in this slice would force either a corpus test that fails on day one or the wider `plot-host.sh` change the plan correctly scopes out.

**The honest disposition is a follow-up**: once `plot-host.sh` gains the same strip, the three become one rule and the corpus pair is writable. That is a plan, not a gate on this one. **A reviewer should say so in the PR; it is not worth a fourth round.**

---

## 5. The readiness judgement

**Each round has found strictly less, and the trajectory is the finding.** R1: the mechanism was wrong — the gate pinned a behaviour the estate never produces. R2: the mechanism was right and the *test* was wrong on a shape nobody had run, plus the rule had no home. R3: I ran the new test over eight shapes and it is right on all eight; the home is a script whose payload already carries the input and whose test file already stubs the CLI. **What is left is a table row and three sentences of wording.**

**Weighing another round against the imprecision:** a third amendment would produce a plan that names a probe field, a failure-modes row and a refusal sentence. Every one of those is a thing the implementer writes anyway and the reviewer reads in the diff. A round costs three agents and a day; the residual costs a review comment. **The defect is real, the premise has survived four independent checks, the mechanism now fires on the live #913 value and on the three URL forms that broke it last round, and eight of nine gates discriminate inside a suite the ninth names.**

**I would hand this to an agent tomorrow.**

### What I checked

- Implemented *"strip scheme and authority, then split"* and ran it over the four pinned forms plus four neighbours (`https://host` bare, the live `Quatico.Webseite`, `apps/`, `http://h:8080/a/b`) — all eight correct
- `plot-board-probe.sh:246-263` (the `jen` arm), `:281` (the emitted object) — the instance string is already in the payload
- `test/reconcile/boardprobe.test.mjs:248-296` (`stubClis`, `isolatedPath`), `:341-400` (five existing `jen` tests) — the harness exists and gate 5 is already green there
- `plot-host.sh:3193-3198` — confirmed it carries the unstripped split the plan declines to fix, and confirmed the override's precedence
- `plot-host.sh:640-665` (`ci_instance`, *"NO SCHEME IS NORMALISED ON"*) — confirmed URL is a first-class documented form, which is what made R2's finding real
- `skills/plot-board-setup/SKILL.md:272-281` (the precedent, verbatim), `:386-391` (step 4a's `unknown` → cannot verify), `:476-498` (21 failure-mode rows, zero naming `jen`)
- `test/reconcile/unattended.test.mjs:108-149` — read the counting logic and confirmed reusing the existing declaration keeps the suite green
- Attempted to construct an implementation greening all nine gates without fixing the defect; could not

### What I would put in the PR review, not in another round

1. Add the `## Failure modes` row for the refusal
2. Have the refusal sentence name the **existing** key on a re-run, and say the override is read from the board's environment
3. File the corpus pairing as a follow-up, once `plot-host.sh` gains the same scheme strip
4. Name the probe field whatever reads best; every consumer is in this slice

Verdict: proceed
