# The RC is a decision, not a commit

> Delete the per-push npm prerelease; publish the board from the RC tag
> `/plot-release rc` already cuts, so a release candidate is an act someone
> takes rather than a side effect of pushing.

## Status

- **Phase:** Draft
- **Type:** infra
- **Sprint:** <!-- optional, filled when plan is added to a sprint -->
- **Issue:** <!-- optional, tracker issue(s) this plan answers -->
- **Story:** <!-- optional, story slug this plan is part of -->
- **Review:** pr
- **Impl:** same branch

## Changelog

- The board is published to npm when a release candidate is cut, not on every
  push to `main`. `npm i @plot-pm/board@rc` now returns a build someone
  deliberately nominated for verification.
- A failing `changeset status` fails the release job instead of being reported
  as "nothing to publish".

<!-- Board impact: none. No change to the plan format, the plan template, the
     helper scripts, or the docs/plans layout. The board's own code and
     contract are untouched — only the moment at which it is published. -->

## Motivation

`@plot-pm/board` carries **709 published prereleases against 7 stable
releases**. They are not release candidates.

`board-rc` gates on *"is a `@plot-pm/board` changeset pending?"* — repo state
that stays true from a board PR merging until the Version PR merges, often days.
Every push in that window republishes identical code under a fresh `rc.N`, and
Plot's own automation pushes plan and brief commits to `main` 74–121 times a day.

Measured on `0.8.0-rc.*` by resolving each published version to its `gitHead`:

| | count |
|---|---:|
| RCs whose commit touched board sources | 4 |
| RCs carrying byte-identical board code | **27** |

Because `BASE` is a *predicted* version, a `minor` landing mid-flight orphans
everything under the old base. Six of fourteen bases never shipped stable —
`0.4.0` accumulated **188 candidates for a release that does not exist**.

Meanwhile the deliberate act already exists and publishes nothing:
`/plot-release rc` cuts `v<version>-rc.<n>` plus a verification checklist, and
stops there. Two mechanisms have shared the word "RC" while being different
objects with different counters.

## Design

Full argument, measurements and rejected alternatives:
[`docs/superpowers/specs/2026-08-26-the-rc-is-a-decision-not-a-commit-design.md`](../superpowers/specs/2026-08-26-the-rc-is-a-decision-not-a-commit-design.md).

### Approach

**Delete `board-rc`.** Not gate it better — delete it. The need it served (QA on
another machine before a release) was an informal endgame; `Endgame` is now a
phase with a command behind it.

**Publish from the RC tag.** `on: push: tags: ['v*-rc.*']` in `release.yml`,
which must stay one file because npm Trusted Publishing permits exactly one
workflow filename per package. The job becomes `board-release-candidate`, gated
on `startsWith(github.ref, 'refs/tags/')`.

Recorded decisions:

| # | Decision |
|---|---|
| 1 | The board keeps its own version line; only the RC *event* is shared |
| 2 | Snapshots are deleted, not made manual — measured usage is zero |
| 3 | The tag is the trigger; no `workflow_dispatch` (GitHub's UI already creates tags) |
| 4 | First real RC is the version *after* `0.8.0`, whose prerelease space 31 snapshots polluted |
| 5 | `BASE` stays the `changeset status` prediction — an RC whose base never ships stable is **normal**, not a defect |
| 6 | Deprecate the 709 and repoint the `rc` dist-tag (manual; 2FA) |

**The tag is the interface.** Plot cuts it; this repo's CI reacts to it. No
shipped skill changes, so an adopter may wire the same tag to any pipeline.
Having `/plot-release rc` call `gh workflow run` was rejected: it would bake this
repo's packaging into shipped skill content (manifesto question 2).

**Two guards the trigger change requires:**

- `github.event_name` is `push` for tag pushes too, so the `release` job must
  tighten to `github.event_name == 'push' && github.ref == 'refs/heads/main'` —
  otherwise an RC tag runs `changesets/action` against a tag ref.
- `board-rc`'s existing `refs/heads/main` guard exists so a feature-branch
  dispatch cannot publish from that branch's changesets. A tag trigger revives
  that hazard, so the job asserts
  `git merge-base --is-ancestor "$GITHUB_SHA" origin/main`.

**D2 — the silent fallback.** `release.yml:66-67` and `:147` carry
`|| echo '{"releases":[]}'`, which turned a crash into a green
"board unchanged — skipping RC" for three days. Measured against
`@changesets/cli@2.30.0`, `changeset status` exits **1 for both** "nothing
pending" and "unknown package", so the exit code cannot discriminate them —
dropping the fallback would break the benign case. The fix matches the message
and fails loudly otherwise.

Also: the RC counter starts at **1**, matching `plot-release/SKILL.md`'s stated
`rc.1` convention, which the workflow currently contradicts by starting at 0.

### Open Questions

- [ ] Does the v2.9.0 Version PR merge before the first RC is cut? Not a blocker
      for this branch, but the first RC must follow it or `BASE` predicts the
      polluted `0.8.0`.
- [ ] `skills/plot-board-setup/README.md` documents "npm `latest` lags the
      plugin" and cites `0.3.0`; the registry says `0.7.0`. Correct it here or
      leave it to a docs plan?

## Branches

### Publish on decision

- `infra/the-rc-is-a-decision-not-a-commit` — delete the `board-rc` job; add the
  tag-triggered `board-release-candidate` job with both guards; fix D2 in both
  occurrences; add a `plot` changeset. The plan rides this branch and one PR
  carries plan + code.

## Notes

- **D1 and D3 are already fixed** and are not in scope. Six changesets named
  packages outside the workspace, freezing the v2.9.0 release PR at 8 of 98
  changesets for four days, 355 commits behind main;
  [#435](https://github.com/plot-pm/plot/pull/435) fixed the names and added the
  CI gate on 2026-08-26 while this was being designed. They are recorded because
  D2 is what concealed them, and because D3 makes D2's fix defense-in-depth
  rather than the sole discriminator.
- **Registry cleanup cannot be a CI step.** The package requires 2FA and
  disallows tokens, and OIDC trusted publishing covers `publish` only, so
  `deprecate` and `dist-tag` need an interactive login from a person's machine.
- **The trigger is untestable before merge.** Tag-triggered workflows do not run
  until the workflow file is on the default branch. The first `/plot-release rc`
  is the real end-to-end test and should be treated as such.
- The design passes the MANIFESTO 9-question checklist; the table is in the
  design document.
