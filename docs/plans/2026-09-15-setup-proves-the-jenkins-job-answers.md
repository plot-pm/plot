# Setup refuses a Jenkins instance that names no job

> Adoption records a Jenkins instance that names no job path and calls it verified — scoring a half value strictly better than a missing one, which setup already refuses.

## Status

- **State:** Approved
- **Type:** bug
- **Issue:** #913
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** the-board-is-blank-where-it-matters
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 3
- **Approved:** 2026-09-15, jwloka, in-session

## Changelog

- `/plot-board-setup` proves a declared Jenkins instance actually answers for a branch before reporting it green. A slug without its job path passed every check and produced a board with no build state at all.

<!-- Board impact: none at runtime — this changes what adoption verifies. No
     plan format, no template, no layout. -->

## Design

**`plot-host.sh:702` states the contract and setup does not enforce it:**

> *"`<slug>` or `<slug>/<job/path>`. The slug is what `jen -I` takes; the
> remainder (after the first `/`) is the multibranch job's container path."*

**Without the path, Plot looks for branch jobs at the Jenkins root and finds
none.** Measured in #913 with `pr-list --rich`:

| Value | Result |
|---|---|
| slug only | **no rows** |
| `<slug>/quaweb/continuous-build` | 4 PRs, all `checks: green` |

**And setup reported the first one healthy.** The board then showed
`checks: unknown` for every PR and *"WAITING ON A MACHINE — could not reach the
host"*, after adoption had said the configuration checked out.

### Reachability is not the same question as usefulness

**The existing check asks whether the instance answers.** It does — `jen auth
status` succeeds against the slug alone, because the slug is the whole address
of the *server*. The job path addresses the **container**, and nothing verified
that anything was found inside it.

**So the two questions are: can I reach Jenkins, and does this value name a job
that answers for a branch?** Setup asked the first and reported on the second.

### Asking the instance does NOT distinguish the defect, and an earlier draft got this wrong

**This plan first proposed resolving branch jobs and reporting zero.** Measured
live 2026-09-15 against the instance in #913, a slug-only value resolves a
**non-empty** list:

```
jen -I <slug> job list --json
  → demos (Folder), quaweb (Folder), set-image-name (WorkflowJob), webbloqs-website (Folder)
```

**Four entries, not zero.** The broken configuration *answers*, and answers `ok`.
So a gate pinning *"resolves zero branch jobs"* pins a behaviour this estate
never produces — greenable only by stubbing an empty array, which is **a Jenkins
with no jobs at all**, the case this plan calls legitimate. The fixture would
prove the check works on a case that was never broken.

### The distinguishing test is the JOB PATH, and the estate already has it

`plot-host.sh:3197-3205` separates the two zero-cases exactly, and does it
**offline**:

```sh
[ -n "${PLOT_JENKINS_JOB:-}" ] && _jen_job="$PLOT_JENKINS_JOB"
if [ -z "$_jen_job" ]; then
  echo "plot-host: run-for-sha — the Jenkins instance names no job path" >&2
  echo "  A sha is a fact about a job's builds, so the instance must be" >&2
  echo "  <slug>/<job/path> rather than a bare host." >&2
  exit 4
fi
```

**The value names no job** is a config defect — actionable, checkable without a
network call, and it honours `PLOT_JENKINS_JOB`, so a legitimate slug-only value
with the override set is **not** refused. **The value names a job with no
children** is a fresh container — benign, and a different sentence.

**Those are two findings with two next actions**, which is what the Open Question
asked for and what asking the instance could never give.

### The split is on the JOB PATH, not on a slash — and a URL form breaks a naive test

**`${value#*/}` is the wrong test, and `plot-host.sh:3197` carries the same latent
bug.** The estate accepts a URL form (`plot-host.sh:616` matches `https://*`), and
measured:

```
jenkins.example.com                   → job=''                              refuse  ✓
jenkins.example.com/quaweb/cb         → job='quaweb/cb'                     accept  ✓
https://jenkins.example.com/          → job='/jenkins.example.com/'         ACCEPT  ✗
https://jenkins.example.com/quaweb/cb → job='/jenkins.example.com/quaweb/cb' host glued on ✗
```

**A URL with no job path is ACCEPTED while being exactly the #913 defect**, and a
URL with one produces a path carrying the host. **The bare-hostname case is
refused correctly by accident** — hostnames have no slash.

**So the check strips the scheme and authority before splitting.** In
`plot-host.sh` this bug is confined to one op that exits 4; **promoting it into a
refusal that blocks adoption widens the blast radius**, which is why this plan
fixes the test rather than copying it.

### The rule lands in a script, not in skill prose

**A rule written only in `SKILL.md` is unenforceable** — four of the gates below
can only be tested if the check executes somewhere a test can call it. The
existing probe `plot-board-probe.sh` already reports `jen_auth` and is the
established home for a reading adoption consults, so the job-path reading joins
it and the skill acts on what the probe reports.

**That is this estate's own split** — *scripts collect and report, skills
interpret and adapt* — and it is what makes the gates real rather than described.

### Refuse the key, do not record it with a note

**The skill's own precedent settles the severity**, and an earlier draft invented
a new one. `SKILL.md:275-281`, on this very key:

> *"A wrong instance is worse than an absent one — `jen -I <bogus> auth status`
> prints `Keycloak: signed in` and exits 0, so a guessed slug buys a green light
> that verifies nothing. Write no `Jenkins instance` key."*

**And the failure is already narrower than "setup reports green".** `jen_auth`
returns `unknown` when **no** instance resolves, and step 4a maps that to *cannot
verify*. So setup already refuses a **missing** key — the defect is that a
**present but incomplete** value reads `ok` while a wholly absent one reads
`unknown`. **A partial value scores strictly better than no value**, which is the
worse of the two failures.

**So a value naming no job path and carrying no override is refused the way a
guessed slug is**, rather than recorded with a finding. A finding an adopter must
never act on trains them to skip the run where it is real.

### What this does not do

**It does not add a config key.** The job path travels on the instance value, by
`plot-host.sh:704-708`'s own reasoning: a multibranch container is the *parent*
of the branch and cannot be derived from it, so it rides the value it belongs to.

**It does not change `plot-host.sh`.** The resolution is correct; only the
adoption check is missing.

**It does not verify the deploy side.** A separate CD pipeline is
[`a-jenkins-job-is-read-by-its-shape`](2026-09-15-a-jenkins-job-is-read-by-its-shape.md)'s
territory, delivered today, and setup asks about the job it is given.

## Slices

### Setup proves the Jenkins job answers (Branch: bug/setup-proves-the-jenkins-job-answers)

- `bug/setup-proves-the-jenkins-job-answers` — have `/plot-board-setup` resolve branch jobs from the declared instance value and report what came back, instead of reporting green on reachability alone

**Done when** the job-path reading is emitted by **`plot-board-probe.sh`** rather
than described in skill prose, so every gate below is executable — pinned by a
test calling the probe directly; **a URL-form instance is split correctly**,
pinned across all four measured forms: `host` refused, `host/job/path` accepted,
`https://host/` **refused** and `https://host/job/path` accepted with a job path
that does **not** carry the host; a `Jenkins instance` naming **no job path** and
carrying no `PLOT_JENKINS_JOB` is **refused** rather than recorded, in the shape
`SKILL.md:275-281` already uses for a guessed slug, pinned by a test; **a
slug-only value WITH `PLOT_JENKINS_JOB` set is accepted**, pinned explicitly,
since the override makes it legitimate and this is the one case a shape test
could get wrong; a `<slug>/<job path>` value is accepted unchanged, pinned; **the
check makes no network call**, pinned by asserting `jen` is invoked zero times —
the distinction is in the value, and a live call cannot make it; a repository
declaring **no Jenkins at all** still reads `unknown` exactly as today, pinned,
because setup already refuses that case correctly; **a fresh multibranch
container with no children is NOT flagged**, pinned by a fixture, since it names
a job path and is legitimate; the refusal sentence names `<slug>/<job/path>` and
what to check, following `plot-host.sh:3200-3203`; **no new config key**; and
`pnpm run test:contracts` passes.

**Amended twice. Round 2 confirmed the mechanism is fixed** — *"This gate pins a
behaviour the estate produces on the exact #913 value, and I fired it"* — and
found two things the first amendment missed: the URL form breaking the split in
both directions, and the rule having no stated home, which left four of nine
gates unenforceable.

**Nothing is verified separately any more.** An earlier draft deferred its
central check to a live instance; the job-path test is a string test on a config
value, so **every gate above runs in this repository** with no Jenkins and no
fixture anybody cannot regenerate.

## Notes

**Filed as #913 from a live adoption.** The config carried the slug alone, setup
reported healthy, and the board showed no build state for any PR.

**Amended 2026-09-15 after a three-lens panel**
(`.plot/panels/2026-09-15-setup-proves-the-jenkins-job-answers/panel.md`),
unanimous `amend`. **The premise was confirmed independently** — a grep for
`job path|branch job|job list|jenkins_build_map|pr-list` over the 498-line setup
skill returns **zero**, so setup has no concept of the job path at all.

**The mechanism was wrong and the panel measured it.** A slug-only value resolves
a non-empty list, so the zero-branch-jobs gate pinned a behaviour the estate
never produces. The job-path test replaces it: offline, override-aware, and it
distinguishes the two zero-cases the Open Question could not.

**This is the ticket behind the blank Jenkins board**, and it is a different
defect from the reader that
[`a-jenkins-job-is-read-by-its-shape`](2026-09-15-a-jenkins-job-is-read-by-its-shape.md)
fixed today: that one could not read a plain job's state at all, this one lets a
configuration that names no job at all pass as verified.
