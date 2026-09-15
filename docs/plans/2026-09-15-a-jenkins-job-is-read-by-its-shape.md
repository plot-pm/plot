# A Jenkins job is read by its shape

> Plot asks Jenkins for a job's state with one verb that answers for a multibranch job and returns `null` for every other kind, so a team's deploy pipeline is unreadable whatever it declares.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** the-board-is-blank-where-it-matters
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- Plot can read a plain Jenkins pipeline's state, not only a multibranch job's branch children. The one verb it used answers for folders and returns nothing for a standalone job, so a CD pipeline was unreadable whatever the repository declared.

<!-- Board impact: none. This changes what `plot-host.sh` can answer, not what
     the board renders. Nothing in the plan format, template or layout moves. -->

## Design

**Measured 2026-09-15 on `Quatico.Webseite/quaweb-website`**, a repository with
real `bb`/`jen`/`jira` and a board that shows no deploy state. Every reading
below is live.

### The defect is one verb

```
jen job list quaweb/continuous-deploy --json   ->  null
jen job view quaweb/continuous-deploy --json   ->  color blue,
                                                   lastBuild #938 SUCCESS,
                                                   duration 453365ms
```

**`job list` enumerates a folder's CHILDREN.** A `WorkflowMultiBranchProject`
has one child per branch, so listing it yields exactly the branch→colour map
Plot renders today. A plain `WorkflowJob` has no children, so the same call
yields `null` — not an error, not an empty array, **`null`**.

`jenkins_build_map()` at `plot-host.sh:756` makes that one call and, at `:757`,
refuses anything that is not a JSON array:

```sh
out=$(jen -I "$slug" job list ${job:+"$job"} --json 2>&1) || true
if [ -z "$out" ] || ! printf '%s' "$out" | jq -e 'type=="array"' >/dev/null 2>&1; then
  printf '{"status":"failed","map":{}}\n'; return 0
fi
```

So a plain job reports **`failed`** — indistinguishable from an unreachable
Jenkins. **`plot-host.sh` never calls `job view`: zero occurrences.**

### This is a reader defect, not a configuration one

The obvious reading — that the repository is misconfigured — was measured and is
false:

```
CI               = jenkins
Jenkins instance = jenkins-ci-webbloqs.internal.quatico.dev/quaweb/continuous-build
Git host         = bitbucket
Tracker          = jira https://quatico.atlassian.net
```

`jen auth status` against that slug reports **signed in**, and the CI half works
— `job list` on the multibranch job returns branch children with colours
(`bugfix%2FQUACDS-915-anchor-hash` → `red`, the rest `blue`). The connector
resolves, the instance is reachable, and the declared job is right.

**So no declaration can fix this.** [`the-deploy-job-shows-on-main`](2026-09-15-the-deploy-job-shows-on-main.md)
proposed a deploy-job config key and was rejected for exactly this reason: the
key would have been read correctly and the reader would still have returned
`null`.

### A healthy Jenkins reports `unreachable`, and the port calls it `unaskable`

**The consequence is worse than a missing reading, and this is what the operator
actually sees.** `jenkins_build_map` answers `failed`, and its consumers say so
in words:

- `plot-host.sh:2717-2718` — *"plot-host: jenkins unreachable (failed) — checks reported as unknown"*
- `plot-host.sh:3024-3025` — the same sentence, then **`exit 4`**

`build-shell.ts:139-145` converts exit 4 to **`unaskable` with `refusal: null`**,
and `:133-135` states the rule deliberately: exit 4 is *not* a refusal, because
it means *"standing configuration fact, not an incident worth waiting out"*.

**So a correctly configured, reachable, signed-in Jenkins reports through the
port as "this repository has no CI to ask" — and the one signal a team could
retry on is discarded by design.** That is why the board is blank even though
every configuration value is right.

### The job's shape is named in its PARENT's listing, not in the one Plot performs

**This is the sentence to get right, and an earlier draft of this plan got it
wrong in the way that matters.**

Jenkins names a job's kind in `_class`. But `job list <container>` returns the
container's **children**, and their `_class` describes *them*:

```
jen job list quaweb/continuous-build   ->  every child: ...job.WorkflowJob
jen job list quaweb                    ->  continuous-build: ...multibranch.WorkflowMultiBranchProject
                                           continuous-deploy: ...job.WorkflowJob
```

**Both measured live 2026-09-15**, and the repository's own fixture says the same:
`test/reconcile/host.test.mjs:1505-1509` gives all five children of a multibranch
container `_class: ...job.WorkflowJob`.

**So reading `.[0]._class` from the listing Plot already performs reads a healthy
multibranch job as plain**, routes it to `job view`, and breaks the CI half that
works today — while every gate still passes.

The deciding `_class` is the **configured job's own**, and it appears one level
up. `Jenkins instance` already carries `<slug>/<job-path>`, so the parent path is
the job path minus its last segment — a second `job list` on that parent, or
`job view` on the job itself, which returns the job's own `_class` directly.

**`job view` answers both questions at once**: it returns `_class`, `color` and
`lastBuild` for the configured job. So the shape test and the plain-job reading
are one call, and the multibranch path keeps the single `job list` it has today.

**Five jobs under `quaweb`, four of them plain.** A rejected plan asserted *"two
is the shape a team has"*; the shape is tested rather than counted for that
reason.

### What this does not do

**It does not render anything.** The board has no default-branch row —
`board.ts:705-707` and `fleet.ts:1243` both filter it out, the second calling
such a row *"a row named `HEAD` that no reader can act on"* — and `build` is a
`RowKind` with no producer. **Making a reading possible and deciding where it
appears are two questions, and this is the first.** A plan that did both would
carry the destination problem that sank its predecessor.

**It adds no config key.** Which job a repository deploys from is a real
question and it is not this one. Once a plain job is readable, a key naming one
is a small plan with a working reader beneath it.

**It does not change the multibranch path.** The colour table
(`blue`→green, `red`/`yellow`→failing, `*_anime`→pending, `disabled`/absent→none),
the URL-decoding of branch names, and the one-call-per-refresh property all stay
exactly as they are.

**It does not make `null` succeed.** A job that genuinely cannot be read still
reports `failed`. What changes is that a plain job is no longer *misread* as
unreachable.

## Open Questions

- [ ] **Does `build list` belong here too?** `jen build list quaweb/continuous-deploy`
  returns full stage detail (`status`, `startTimeMillis`, `durationMillis`, per-stage
  results) where `job view` returns the last build only. `job view` is sufficient for a
  state, and `build list` is the richer read a later plan may want. **Does not block:**
  this plan takes the state.

## Slices

### A Jenkins job is read by its shape (Branch: bug/a-jenkins-job-is-read-by-its-shape)

- `bug/a-jenkins-job-is-read-by-its-shape` — read the job's `_class` from the listing Plot already performs, and resolve a plain `WorkflowJob` through `jen job view` instead of `job list`, keeping the multibranch path byte-identical

**Done when** the job's shape is decided from **the configured job's own
`_class`** and never from the `_class` of the children `job list` returns —
pinned by a test in which a multibranch container's children all carry
`...job.WorkflowJob` (the shape `test/reconcile/host.test.mjs:1505-1509` already
holds) and the container is still read as multibranch; a plain `WorkflowJob`
reports its real state rather than `failed`, pinned by a fixture carrying the
measured `job view` payload (`color: blue`, `lastBuild.result: SUCCESS`); **the
`runs` op emits a line for a plain job rather than exiting 4**, pinned by a test,
since `:3027` reads `.map[$branch]` and a plain job has no branch key — without
this gate every other one can pass while the port still answers `unaskable`; a
`WorkflowMultiBranchProject` produces a branch→checks map **byte-identical** to
today's, pinned by a fixture of the measured `job list` output including a
percent-encoded branch name and a `red` child; an unreachable Jenkins still
reports `failed` and an unrecognised auth line still reports `unknown`, both
unchanged; a job whose `_class` is neither kind is read as **unknown rather than
failed**, since a shape this plan did not measure is not the same fact as a host
that did not answer; **the jen stub learns to tell `list` from `view`** —
`test/reconcile/host.test.mjs:1462` dispatches on `group == "job"` alone and
would answer `job view` with the array fixture; **the call count is asserted on
TOTAL `jen` invocations, not on the literal string `job list`** — the existing
filter cannot see a `job view` call at all, so a per-branch storm against
Jenkins' declared limit of 60 would pass it; `grep -c 'job view' plot-host.sh`
is no longer 0; and `pnpm run test:contracts` passes.

**Verified separately on an instance declaring `CI: jenkins`**: the deploy job's
state is readable through `plot-host.sh`. That cannot be checked in this
repository, which declares `CI: github-actions`, and is not in the slice's gates
— the fixtures above carry the measured payloads instead.

## Notes

**Supersedes [`the-deploy-job-shows-on-main`](2026-09-15-the-deploy-job-shows-on-main.md)**,
rejected 2026-09-15 after a three-lens panel and this measurement. That plan
named the need correctly and the mechanism wrongly.

**The operating team had already diagnosed this.** That repository's `AGENTS.md`
records *"«deploy» kommt in `plot-host.sh` kein einziges Mal vor: Plot hat fuer
die CD-Seite kein Konzept"* — verified, `grep -ic deploy` returns 0 — alongside
a table of its two pipelines and the cost of misconfiguring the instance key
(PR #874, where every PR read `checks: unknown`). **A team wrote the finding
into its own repo and Plot never read it**; that is worth more than the plan it
corrects.

**Amended 2026-09-15 after its first panel**, which found the mechanism sentence
naming the wrong object as carrying `_class` — the same error class as the two
rejections this plan supersedes, surviving into the plan written to correct them.
Caught before dispatch this time. The panel also found three gates that could
pass while the defect stood; all three are now pinned.

**Third plan on this subject in one week, and the first with a measurement
behind it.** The two before it —
[`the-board-asks-the-build-resolver`](2026-09-15-the-board-asks-the-build-resolver.md)
and `the-deploy-job-shows-on-main` — were both rejected for premises that a
single live reading would have disproved.
