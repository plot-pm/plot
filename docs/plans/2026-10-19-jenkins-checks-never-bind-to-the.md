# Jenkins checks bind to the head on a real Bitbucket + Jenkins repository

> On a real Bitbucket + Jenkins repository (ewz-kus-portal) all 10 rows of `pr-list --open --rich` carry `checksSha: ""`. A slug-form `Jenkins instance` is used as a host name, the sha match reads the wrong `lastBuiltRevision`, and the lookup failure is discarded without a message.

## Status

- **State:** Released
- **Type:** bug
- **Sprint:**
- **Issue:** #2075
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-19, Jan Wloka, plan-PR #2099 merged
- **Started:** 2026-10-19, Jan Wloka, `bug/jenkins-checks-bind-to-the-head`
- **Delivered:** 2026-10-19
- **Released:** 2026-10-22, v2.28.0

## Changelog

- `plot-host.sh pr-list --rich`, `run-for-sha` and `runs` resolve a slug-form `Jenkins instance` to the host `jen -I <slug>` uses, match a build by any of its `lastBuiltRevision` actions, and report a failed sha lookup on stderr and in the row.

Board impact: the board and the merge queue read `checks` and `checksSha` from `pr-list`. On this repository they read `unknown` for every row today, and they read a bound colour after the fix. No plan-format change, no rebuild of the board artifact expected.

## Motivation

Field test on 2026-10-19 against ewz-kus-portal (`Jenkins instance: ewz/kus-portal/continuous-build-multi`), plot at `fb05579d6`. Nothing was written to any host. `plot-host.sh pr-list --state open --rich` returned 10 rows and all 10 had `checksSha: ""`, for example `#3686 headSha 66836536f8c9 checks green checksSha ""`. The output said nothing about it. The delivered plan for #2053 added the Bitbucket binding, and this field test is the first run of it against a real Jenkins. Three causes, in the order a call meets them:

1. **The slug is used as a host.** `jenkins_sha_runs` (`plot-host.sh:1729`) sets `host="${instance%%/*}"`, which is `ewz`. The keychain lookup and `curl https://ewz/...` both use that literal. The lookup refuses with `no Jenkins API credential for 'ewz'`. The `jen` CLI resolves the same slug to `jenkins-ci-ewz.internal.quatico.dev`. `runs <branch>` exits 4 the same way.
2. **The first revision wins.** Every build on this Jenkins carries two `lastBuiltRevision` actions: `develop` first, the branch head second. The jq filter at `plot-host.sh:1759` takes `| first`, so it reads the develop sha. With the full host set in a scratch clone, `run-for-sha bug/ewzkus-3772-usage-naming a9b6aabb19cc` returned nothing, while build #2 is SUCCESS at exactly a9b6aabb19cc. The 5 rows that were looked up turned from `green` to `unknown`.
3. **The failure is silent.** `jenkins_bind_rows` (`plot-host.sh:1778`) runs `jenkins_sha_runs ... 2>/dev/null || break`, so a refused lookup leaves the unbound colour in place and reports nothing.

## Design

### Approach

One slice fixes the three causes in `plot-host.sh`. The plan states the target behaviour and leaves the mechanism to the slice.

- **Slug to host.** A slug-form `Jenkins instance` resolves to the same host as `jen -I <slug>`. `plot-board-probe.sh:417` already derives the slug with one splitter, and the host name behind a slug is what `jen` knows. The slice reuses the `jen` resolution where `jen` is installed and fails by name where it cannot resolve. It adds no second splitter.
- **Revision match.** A build matches the asked sha when ANY of its `lastBuiltRevision` actions names it, or when the action whose branch is the job's branch names it. The `first` selection goes. The unfiltered `runs` path keeps its branch filter.
- **Visible failure.** A failed sha lookup prints its reason on stderr and marks the row, so a reader can tell `unknown` from *the lookup was refused*. The `2>/dev/null || break` in `jenkins_bind_rows` goes. The pass still ends on the first refusal, because every later lookup meets the same cause.
- **Real-shaped tests.** Host tests use a slug-form instance, a build with two `lastBuiltRevision` actions (`develop` first), a 12-character Bitbucket hash and a 40-character Jenkins SHA1.

### Open Points

- [ ] How does `jen` map `ewz` to `jenkins-ci-ewz.internal.quatico.dev`? Name the source (a `jen` command, a config file, or a convention) before the slice relies on it. The keychain entry is keyed by the bare host, so the resolved host also decides the credential lookup.
- [ ] Should Bitbucket rows read `GET /commit/{hash}/statuses` instead of Jenkins? The issue measured that it accepts the 12-character hash and returns Jenkins' own `SUCCESSFUL` for 66836536f8c9, with no Jenkins credential. It is a head-bound source for Bitbucket rows only. Decide whether it replaces the Jenkins lookup, backs it up when the lookup is refused, or becomes its own plan. It adds a second source that can disagree with Jenkins, so the decision needs a person.
- [ ] Which row marker reports a refused lookup: a new field, or `checks: unknown` plus a reason? Check the board's reading of `pr-list` rows before adding a field.

## Slices

### Binding repair

- `bug/jenkins-checks-bind-to-the-head` — resolve a slug-form Jenkins instance to the `jen` host, match a build by any `lastBuiltRevision`, and report a failed sha lookup; host tests on real-shaped values <!-- builds: slug-to-host resolution in jenkins_sha_runs, any-revision sha match, reported lookup failure in jenkins_bind_rows --> → #2109

## Notes

- Source: tracker issue #2075, from a field test on 2026-10-19.
- Related: #1974 (prefix rule for `pr-state`), #2053 and #2063 (the Bitbucket arm of `pr-list --rich`, delivered).
- Related plans: `2026-10-18-bitbucket-jenkins-pr-list-binds-a.md` (added the binding this plan repairs), `2026-09-24-the-probe-asks-jenkins-by-its-slug.md` (the probe's slug splitter).
- Deliverable search for `jenkins_sha_runs` found only `plot-host.sh`. This plan repairs it and builds no duplicate.
- Intake defaults (unattended): `Design` was not answered, so the plan starts in Draft.
