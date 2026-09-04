# Publish release-candidate packages from the release tag; stop per-push snapshot publishing

> The board package is published to npm when a release candidate is cut, and at
> no other time. The per-push prerelease job is removed.

## Status

- **Phase:** Released
- **Type:** infra
- **Sprint:** <!-- optional, filled when plan is added to a sprint -->
- **Issue:** <!-- optional, tracker issue(s) this plan answers -->
- **Story:** <!-- optional, story slug this plan is part of -->
- **Review:** pr
- **Impl:** same branch
- **Approved:** 2026-08-26, eins78, plan reviewed on PR #439
- **Started:** 2026-08-26, eins78, `infra/release-candidate-publishing`
- **Delivered:** 2026-08-28
- **Released:** 2026-08-28, v2.11.0

## Approval

- **Assignee:** eins78

## Changelog

- `@plot-pm/board` is published when a release candidate is cut, not on every
  push to `main`. `npm i @plot-pm/board@rc` returns a build nominated for
  verification.
- A failed `changeset status` query fails the release job. It was previously
  reported as an empty release set, and the job exited successfully.

<!-- Board impact: none. The plan format, plan template, helper scripts and
     docs/plans layout are unchanged. The board's code and contract are
     unchanged; the change affects when the package is published. -->

## Terms

**Snapshot** — a prerelease published automatically from a commit, without a
person nominating that commit for verification.

**Release candidate** — a build a person nominates for verification, recorded by
the tag `v<version>-rc.<n>` and a checklist under `docs/releases/`.

## Motivation

`@plot-pm/board` carries 709 published prereleases and 7 stable releases
(measured 2026-08-26). The prereleases are snapshots.

### Mechanism

The `board-rc` job in `.github/workflows/release.yml` runs on every push to
`main`. Its condition is *a `@plot-pm/board` changeset is pending*. That
condition describes repository state. It holds from the merge of a board pull
request until the merge of the version pull request, a period of days.

Every push during that period republishes unchanged board code under a new
`rc.N`. Plot's automation pushes plan, brief and sprint commits to `main`: 74
runs on 2026-08-23, 91 on 08-24, 121 on 08-25 (measured).

### Measurement: unchanged republication

Each published `0.8.0-rc.*` version was resolved to its `gitHead` and the commit
diffed against its parent (measured 2026-08-26).

| Commit touched `packages/board/` or `skills/plot/scripts/board/` | Count |
|---|---:|
| Yes | 4 |
| No | 27 |

The 27 include `plot: record start of a-marker-is-a-file-not-a-mention` and
`plot: add today's two board plans to the 2.9.0 sprint`.

### Measurement: bases that never shipped

The job derives its base version from `changeset status`, which predicts the
next version. A `minor` changeset merged later moves the prediction.
Prereleases published under the previous base then have no corresponding stable
release.

| Base | Prereleases | Stable release |
|---|---:|---|
| `0.4.0` | 188 | none |
| `0.6.0` | 249 | shipped |
| `0.6.1` | 14 | none |
| `0.7.1` | 10 | none |
| `0.8.0` | 31 | not yet |

Six of fourteen bases never shipped. `0.4.0` holds 188 prereleases for a version
that does not exist.

### Two mechanisms share one term

`/plot-release rc` already cuts release candidates. The command and the job
produce different artefacts, and neither reads the other's counter.

| | `/plot-release rc` | `board-rc` job |
|---|---|---|
| Artefact | plugin `plot`, not published to npm | npm package `@plot-pm/board` |
| Version | `v2.9.0-rc.1` | `0.8.0-rc.30` |
| Output | git tag, `docs/releases/v<version>-checklist.md` | npm publish on the `rc` dist-tag |
| Trigger | a person | a push |
| Counter | `git tag --list` plus 1 | highest published `rc.<n>` plus 1 |

### Prior purpose of the snapshots

The snapshots allowed one person to verify a build on a second machine before a
release. `/plot-release rc` performs that verification, and the `Endgame` phase
records it. `Endgame` sits between `Development` and `Released`, and holds plans
whose waves are complete and whose branches are merged.

## Design

### Decisions

| # | Decision | Basis |
|---|---|---|
| 1 | The board keeps its own version line. The release-candidate event is shared | The `0.x` line is public. Renumbering onto the plugin's `2.9.x` is irreversible and changes no behaviour |
| 2 | The snapshot job is removed, not restricted to manual dispatch | Reported usage is zero. The purpose it served is now `/plot-release rc` |
| 3 | The release-candidate tag is the trigger. No `workflow_dispatch` | The tag exists, is durable, and records an author. The GitHub web interface already creates tags |
| 4 | The first release candidate uses the version after `0.8.0` | 31 snapshots occupy the `0.8.0` prerelease range. npm forbids renaming, and forbids unpublishing after 72 hours |
| 5 | The base version remains the `changeset status` prediction | A release candidate whose base never ships stable is an expected outcome (decided) |
| 6 | The 709 snapshots are deprecated and the `rc` dist-tag is repointed | `npm deprecate` is the only available operation, and it is reversible with `--undo` |

A release candidate for `0.8.1` verifies a build. A `minor` changeset merged
during verification produces `0.9.0` as the next stable release. The release
candidate has served its purpose. Decision 5 depends on this property.

### Approach

Remove `board-rc`. Publish from the release-candidate tag.

Plot cuts the tag; this repository's CI reacts to it. No shipped skill changes,
so an adopting project may connect the same tag to any pipeline, or to none. The
alternative — `/plot-release rc` invoking `gh workflow run` — is rejected under
MANIFESTO question 2, as it places this repository's packaging in shipped skill
content.

npm trusted publishing (OIDC) permits one workflow filename per package, so the
release-candidate job remains in `release.yml`. A separate `rc-publish.yml`
would require an `NPM_TOKEN`.

```yaml
on:
  push:
    branches: [main]
    tags: ['v*-rc.*']
  # workflow_dispatch removed; it triggered board-rc only
```

The trigger change requires two conditions:

- `github.event_name` is `push` for tag pushes, so the `release` job requires
  `github.event_name == 'push' && github.ref == 'refs/heads/main'`. Without it, a
  release-candidate tag runs `changesets/action` against a tag ref.
- `board-rc` carries `github.ref == 'refs/heads/main'`, which prevents a
  feature-branch dispatch publishing from that branch's changesets. A tag trigger
  reintroduces that case, so the job asserts
  `git merge-base --is-ancestor "$GITHUB_SHA" origin/main`.

`concurrency` requires no change. Its group includes `github.ref`, so a tag
publish does not queue behind pushes to `main`.

`board-rc` becomes `board-release-candidate`, conditioned on
`startsWith(github.ref, 'refs/tags/')`. The publish body carries four changes:

1. the ancestry assertion above
2. the fallback replaced, per D2 below
3. the counter starts at 1 rather than 0, matching the `rc.1` convention stated
   in `plot-release/SKILL.md`
4. the *no pending board changeset* branch retains `exit 0`. Its meaning
   changes: the board has not changed since the last stable release, so there is
   no package to publish. A plugin-only release publishes no npm package.

### D2 — a failed status query is reported as an empty result

`release.yml` lines 66-67 and 147:

```bash
npx changeset status --output=/tmp/cs.json || echo '{"releases":[]}' > /tmp/cs.json
```

The fallback converted the D1 failure into an empty release set. The job printed
`board unchanged (no pending @plot-pm/board changeset) — skipping RC` and exited
0. Board prereleases stopped on 2026-08-23 while more than 200 subsequent runs
reported `board-rc` as successful (measured).

Measured 2026-08-26 against `@changesets/cli@2.30.0`:

```
$ changeset status --output=…      # no changesets present
EXIT=1   "error Some packages have been changed but no changesets were found"
```

The command exits 1 for the no-changesets case and for the unknown-package case.
The exit status does not distinguish them, so removing the fallback would fail
the no-changesets case. The replacement matches the message:

```bash
if ! out=$(npx changeset status --output=/tmp/cs.json 2>&1); then
  if printf '%s' "$out" | grep -q 'no changesets were found'; then
    echo "no pending changesets — nothing to publish"; exit 0
  fi
  echo "::error::changeset status failed"; printf '%s\n' "$out"; exit 1
fi
```

D3 rejects unknown package names before they reach `main`, so a
`changeset status` failure at publish time is the no-changesets case. The
message match is a second check.

### Registry cleanup

- `npm dist-tag add @plot-pm/board@0.7.0 rc`, so `npm i @plot-pm/board@rc`
  returns a stable release until the first release candidate is published
- deprecate the 709 snapshots in a rate-limited loop, after a dry run, with the
  message `snapshot build, not a release candidate`

This runs from a person's machine. The package requires two-factor
authentication and disallows tokens, and OIDC trusted publishing covers
`publish` only, so `deprecate` and `dist-tag` require an interactive
`npm login`. `npm deprecate` accepts a semver range, but no range selects the
prereleases without also selecting the 7 stable releases, so the operation
iterates over an explicit list.

### Order of operations

1. D1 and D3 fixes — complete ([#435](https://github.com/plot-pm/plot/pull/435),
   2026-08-26). The `release` job succeeds.
2. Merge the v2.9.0 version pull request. `0.8.0` ships as a stable release and
   `latest` advances. Independent of this work.
3. This pull request: remove `board-rc`, add `board-release-candidate`, fix D2,
   correct the `latest` claim, add a `plot` changeset.
4. First release candidate: `0.8.1-rc.1`, cut by `/plot-release rc`.
5. Registry cleanup.

Step 3 merges after step 2 (decided 2026-08-26). Removing the snapshot job does
not affect the v2.9.0 release, so the ordering is a release-hygiene choice rather
than a dependency: v2.9.0 ships under the publishing behaviour it was developed
under, and the change to that behaviour lands in the release that follows.

Step 4 must follow step 2. Otherwise the base version predicts `0.8.0`, whose
prerelease range holds the 31 snapshots.

### Adopter impact

| Change | Shipped | Effect on adopting projects |
|---|---|---|
| Remove `board-rc`; add `board-release-candidate` | no — this repository's CI | none |
| D2 fix | no — this repository's CI | none |
| `/plot-release rc` | yes | unchanged |
| `npx @plot-pm/board` in `plot-board-setup` | yes | resolves `latest`; unaffected |
| `plot-board-setup/README.md` `latest` claim | yes | text only; the precedence rule it explains is unchanged |
| Repoint the `rc` dist-tag | registry | no shipped skill directs adopters to `@rc` |
| Deprecate the 709 snapshots | registry | all are prereleases; none is `latest` |

### The `latest` claim in plot-board-setup

`skills/plot-board-setup/README.md` states that `@plot-pm/board` publishes
`0.3.0` as `latest` while the plugin ships a newer build, and gives that as the
reason artefact precedence places the plugin first. The registry holds `0.7.0`
(measured 2026-08-26), so the figure is wrong.

The correction replaces the figure with a command that reads the registry, and
does not substitute a newer figure. A version number in shipped documentation
goes stale on the next release, which is how this line became wrong. The
precedence rule it explains is unchanged, because the lag it describes recurs
whenever the plugin ships ahead of a stable release.

### Verification

The `ci.yml` set, per the Definition of Done: `pnpm test`, `pnpm run validate`,
`pnpm run test:reconcile`, `pnpm run test:e2e`, `pnpm run typecheck`, board build
and board tests.

Workflow changes carry no unit tests. Validation is an end-to-end run: a
`0.8.1-rc.1` cut, published, and installed with `npm i @plot-pm/board@rc`.

A tag-triggered workflow does not run until its file is on the default branch.
The trigger is not testable before merge. The first release-candidate cut is the
test.

### MANIFESTO check

| # | Question | Answer |
|---|---|---|
| 1 | Planning stays in git | Yes. A git tag replaces an implicit repository-state condition |
| 2 | Project-agnostic | Yes. No shipped skill changes; npm specifics stay in this repository's CI |
| 3 | Fails with helpful output | Improved. D2 converts a success status into a failure with the underlying error |
| 4 | Convention, not enforcement | Yes. An adopting project may connect the tag to any pipeline, or to none |
| 5 | Removal would simplify | Removal of the snapshot job is the change. The result is smaller |
| 6 | Executable by hand | Yes. `git tag`, `git push`, `npm publish --tag rc` |
| 7 | Followable by a smaller model | Yes. The job is mechanical. The decision to cut remains with a person |
| 8 | Stays out of effort tracking | Yes |
| 9 | Ceremony scales with the change | Yes. 709 automatic publishes become one publish per release candidate |

### Rejected alternatives

| Alternative | Reason for rejection |
|---|---|
| Retain snapshots behind a changed-path condition | Removes the unchanged republication. Retains an artefact with no reported users |
| Retain snapshots, publish to GitHub Actions artefacts | Same machinery for a user base measured at zero |
| `/plot-release rc` invokes `gh workflow run` | Places this repository's packaging in shipped skill content (MANIFESTO question 2) |
| Board adopts the plugin version line | Irreversible renumbering of a public package with no behavioural change |
| Read the version from `changeset-release/main` | Replaces a prediction with a computed value, and couples CI to a changesets branch name. Decision 5 makes the prediction's drift an expected outcome |
| `workflow_dispatch` that creates the tag | The GitHub web interface creates tags |
| Unpublish or rename the 709 snapshots | npm forbids both after 72 hours |

### Open Questions

None. Both were resolved at approval:

- **This change ships after v2.9.0** (decided 2026-08-26). Step 3 waits for step
  2 rather than proceeding independently.
- **The `latest` claim is corrected on this branch** (decided 2026-08-26), by
  replacing the version figure with a pointer to the registry rather than a
  newer figure.

## Slices

### Release-candidate publishing

- `infra/release-candidate-publishing` → #439 — remove the `board-rc` job; add
  the tag-triggered `board-release-candidate` job with both conditions; fix D2 at
  both occurrences; correct the `latest` claim in
  `skills/plot-board-setup/README.md`; add a `plot` changeset. The plan rides
  this branch, and one pull request carries plan and code.

## Notes

- D1 and D3 are fixed and out of scope. Six changesets named packages outside
  the workspace (`@plot-pm/plot`, `@plot-pm/skills`, `plot-deliver`), holding the
  v2.9.0 version pull request at 8 of 98 changesets for four days, 355 commits
  behind `main`. [#435](https://github.com/plot-pm/plot/pull/435) corrected the
  names and added a CI check on 2026-08-26. They are recorded because D2
  concealed them, and because D3 makes the D2 fix a second check rather than the
  only one.
- This repository declares no ceremony bounds (`Plan PRs`, `Tracker`, `Git host`,
  `Implementation home` are unset), so `/plot-idea` applied defaults. Declaring
  them is a separate change.
