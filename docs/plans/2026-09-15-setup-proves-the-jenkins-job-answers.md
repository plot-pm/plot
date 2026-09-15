# Setup proves the Jenkins job answers

> Adoption accepts a Jenkins instance without its job path and reports the configuration healthy, so the board shows `checks: unknown` for every PR while setup has already said everything checked out.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #913
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** the-board-is-blank-where-it-matters
- **Review:** in-session
- **Impl:** own branches

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

### The proof is one call, and the estate already makes it

`jenkins_build_map` resolves branch jobs from the configured value. **A setup
that runs the same resolution and finds zero branch jobs has its answer** — not
from a shape check on the string, but from asking.

**A shape check is explicitly not the fix.** `PLOT_JENKINS_JOB` overrides the
path separately (`plot-host.sh:708`), so a slug-only value is legitimate where
that variable is set. **Refusing a value by its shape would refuse a working
configuration**; asking whether it answers cannot.

### An empty answer is reported, never refused

**A repository may declare Jenkins before any branch job exists** — a fresh
multibranch container has no children until its first scan. So zero branch jobs
is **reported with what it means and what to check**, and adoption continues.

**What must not happen is silence.** The defect is not that setup accepted the
value; it is that setup called it verified.

### What this does not do

**It does not add a config key.** The job path travels on the instance value, by
`plot-host.sh:704-708`'s own reasoning: a multibranch container is the *parent*
of the branch and cannot be derived from it, so it rides the value it belongs to.

**It does not change `plot-host.sh`.** The resolution is correct; only the
adoption check is missing.

**It does not verify the deploy side.** A separate CD pipeline is
[`a-jenkins-job-is-read-by-its-shape`](2026-09-15-a-jenkins-job-is-read-by-its-shape.md)'s
territory, delivered today, and setup asks about the job it is given.

## Open Questions

- [ ] **Does a zero-branch-job answer belong in the summary or as a question?**
  Reporting it is settled; whether adoption pauses on it is a judgement about
  how much a fresh container should interrupt. **Does not block:** either way
  the finding is stated.

## Slices

### Setup proves the Jenkins job answers (Branch: bug/setup-proves-the-jenkins-job-answers)

- `bug/setup-proves-the-jenkins-job-answers` — have `/plot-board-setup` resolve branch jobs from the declared instance value and report what came back, instead of reporting green on reachability alone

**Done when** a slug-only value against a real multibranch container resolves
**zero branch jobs and setup says so**, pinned by a fixture carrying the measured
empty answer; a `<slug>/<job path>` value resolving branch jobs reports them and
stays green, pinned by the measured four-PR answer; **a slug-only value with
`PLOT_JENKINS_JOB` set is NOT refused**, pinned explicitly, since the override
makes it legitimate and a shape check would break it; **zero branch jobs is
reported and adoption continues**, pinned explicitly, because a fresh container
legitimately has none; a repository declaring no Jenkins at all is **unaffected**,
pinned by a test; the check adds **no new config key**; and
`pnpm run test:contracts` passes.

**Verified separately on an instance declaring `CI: jenkins`**: setup reports the
job path missing before the board is ever started. That cannot be checked in this
repository, which declares `CI: github-actions`, and is not in the slice's gates —
the fixtures carry the measured payloads instead.

## Notes

**Filed as #913 from a live adoption.** The config carried the slug alone, setup
reported healthy, and the board showed no build state for any PR.

**This is the ticket behind the blank Jenkins board**, and it is a different
defect from the reader that
[`a-jenkins-job-is-read-by-its-shape`](2026-09-15-a-jenkins-job-is-read-by-its-shape.md)
fixed today: that one could not read a plain job's state at all, this one lets a
configuration that names no job at all pass as verified.
