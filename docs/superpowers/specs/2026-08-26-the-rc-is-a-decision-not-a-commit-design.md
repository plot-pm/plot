# The RC is a decision, not a commit — design

> Plot stops publishing artifacts of *activity* and publishes only artifacts of
> *decisions*. The automatic per-push npm prerelease is deleted; the deliberate
> `/plot-release rc` act gains an npm publish, triggered by the tag it already
> cuts.

**Status:** design approved 2026-08-26. Not yet implemented.

## Problem

`@plot-pm/board` carries **709 published prereleases against 7 stable
releases**. They are not release candidates. They are commit artifacts wearing
the RC name.

### How they accumulate

`.github/workflows/release.yml` runs a `board-rc` job on every push to `main`.
Its gate asks *"is there a pending `@plot-pm/board` changeset in the repo?"* —
a repo-state condition that stays true from the moment a board PR merges until
the Version PR merges, often for days. Every push during that window
republishes byte-identical board code under a fresh `rc.N`.

The multiplier is that Plot's own automation pushes plan, brief and sprint
commits directly to `main`: 74 runs on 2026-08-23, 91 on 08-24, 121 on 08-25.

Measured on the `0.8.0-rc.*` series by resolving every published version back to
its `gitHead` and diffing:

| | count |
|---|---:|
| RCs whose commit touched `packages/board/` or `skills/plot/scripts/board/` | 4 |
| RCs carrying byte-identical board code | **27** |

Representative of the 27: `plot: record start of a-marker-is-a-file-not-a-mention`,
`plot: approve the-registry-names-a-live-agent`, `plot: add today's two board
plans to the 2.9.0 sprint`.

### Why the versions are meaningless

`BASE` comes from `changeset status` — a *prediction* of the next version. A
`minor` changeset landing mid-flight moves the prediction and orphans everything
already published under the old base. Six of fourteen prerelease bases never
shipped a stable release at all:

| base | RCs published | stable shipped? |
|---|---:|---|
| `0.4.0` | 188 | never |
| `0.6.0` | 249 | yes |
| `0.6.1` | 14 | never |
| `0.7.1` | 10 | never |
| `0.8.0` | 31 | not yet |

188 release candidates for a release that does not exist.

### Two mechanisms, one word

Plot already has a deliberate RC, and it is a different object from the npm one.

| | `/plot-release rc` | `board-rc` job |
|---|---|---|
| Artifact | the **plugin** (`plot`, not on npm) | the **npm package** (`@plot-pm/board`) |
| Version line | `v2.9.0-rc.1` | `0.8.0-rc.30` |
| Produces | git tag + `docs/releases/v<ver>-checklist.md` | npm publish on the `rc` dist-tag |
| Trigger | a person | every push |
| Counter | `git tag --list` + 1 | max published `rc.<n>` + 1 |

They never meet. `/plot-release rc` publishes nothing to npm; the workflow cuts
no tag. Sharing one word is what let the divergence run unnoticed.

### Defects found while investigating

**D1 — the release pipeline was red from 2026-08-23 to 2026-08-26. FIXED.**
Six changesets named packages outside the workspace (`@plot-pm/plot`,
`@plot-pm/skills`, `plot-deliver`); the root workspace package is named `plot`.
An unknown name makes `changeset version` abort the whole release rather than
skip the file:

```
Found changeset 20260823-a-resurrected-ref-does-not-hide-a-merge
for package @plot-pm/plot which is not in the workspace
```

The v2.9.0 release PR sat at **8 of 98 changesets for four days, 355 commits
behind main**, and nothing reported the cause. Fixed on 2026-08-26 by
[#435](https://github.com/plot-pm/plot/pull/435), independently of this design.

**D3 — no gate caught D1. FIXED.** `ci.yml` validated that a changeset's
`bumps:` block referenced existing skill directories, but never validated the
**frontmatter package name** against workspace packages — the exact hole D1 fell
through. #435 added that check, deriving valid names from the workspace's own
`package.json` files so adding a package cannot leave it stale. It is
deliberately **not** gated on `pull_request`, since an unknown name aborts the
release from `main` as readily as from a branch.

**D2 — a silent-failure fallback hid D1 from the RC job. STILL OPEN.**
`release.yml` lines 66–67 and 147:

```bash
npx changeset status --output=/tmp/cs.json || echo '{"releases":[]}' > /tmp/cs.json
```

The `||` converts D1's crash into an empty release set, so the job reported
`"board unchanged — skipping RC"` and **exited 0 green**. Board RCs stopped dead
on 2026-08-23 while 200+ subsequent runs showed a green `board-rc`. D1 is fixed,
but the mechanism that concealed it for three days is untouched and will conceal
the next one.

## What the snapshots were for

They existed so one person could QA a build on another machine before a
release — an informal endgame. Jan's `Endgame` phase (`Discovery → Development →
Endgame → Released`) gives that practice a formal home, and `/plot-release rc`
gives it a command. The informal version is redundant, not merely unused.

## Design

### Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | The board keeps its **own version line**; the RC *event* is shared | The board is a real npm package whose `0.x` line means something to consumers; renumbering it onto the plugin's `2.9.x` would be a breaking, irreversible change for cosmetic gain |
| 2 | Snapshots are **deleted outright**, not made manual | Measured usage is zero, and the need they served is now `/plot-release rc` |
| 3 | The **RC tag is the trigger** — `on: push: tags: ['v*-rc.*']` | The tag already exists, is durable, has an author, and is what provenance should point at. No `workflow_dispatch`: GitHub's UI already creates tags |
| 4 | Ship `0.8.0` stable; the first real RC is the **next** version (`0.8.1-rc.1`) | `0.8.0`'s prerelease space is polluted by 31 snapshots; `0.8.1`'s is virgin. npm forbids renaming or (after 72 h) unpublishing |
| 5 | `BASE` stays the `changeset status` **prediction** | An RC whose base never ships stable is a **normal outcome**, not a defect — see below |
| 6 | Deprecate the 709 and repoint the `rc` dist-tag | The only lever npm offers; reversible via `--undo` |

### An RC need not lead to a stable release of the same number

Cut `0.8.1-rc.1`, land a minor during verification, ship `0.9.0`. The RC did its
job — verification — and owes no stable successor with a matching number. This
is stated as a **property of the design**, not a limitation, and it is why
decision 5 can keep a predicted base.

### The inversion

The old gate asked *"does repo state X hold?"* — level-triggered, true for days,
re-firing on unrelated activity. The new one asks *"did a person cut a tag?"* —
edge-triggered, once per decision. Same credentials, same provenance, opposite
semantics.

The deeper property: **the artifact now has an owner.** Every one of the 709 was
published by nobody in particular, which is why nobody noticed 188 of them were
candidates for a release that never existed. A tag has an author; a checklist has
a sign-off line.

## Mechanics

### The tag is the interface

Plot (generic) cuts `v<version>-rc.<n>`. Plot's own CI (specific) reacts to it.
An adopter shipping crates or containers wires the same tag to their own
pipeline. **No shipped skill changes**, and nothing about npm, `@plot-pm/board`
or trusted publishing enters shipped skill content.

The rejected alternative — having `/plot-release rc` call `gh workflow run` —
would have baked this repo's packaging into a skill that ships to every adopter,
violating manifesto question 2.

### Constraint: one workflow file

npm Trusted Publishing (OIDC) permits exactly **one workflow filename per
package**. The RC publish therefore stays a job inside `release.yml`; a separate
`rc-publish.yml` would forfeit tokenless publishing.

### Trigger surgery

```yaml
on:
  push:
    branches: [main]
    tags: ['v*-rc.*']
  # workflow_dispatch removed — it existed only to fire board-rc
```

**`github.event_name` is `push` for tag pushes too.** The `release` job's guard
must tighten, or an RC tag would run `changesets/action` against a tag ref:

```yaml
if: github.event_name == 'push' && github.ref == 'refs/heads/main'
```

**The branch guard must be reconstructed.** Today `board-rc` carries
`github.ref == 'refs/heads/main'` precisely so *"a manual dispatch from a feature
branch must not publish an RC computed from that branch's changesets."* A tag
trigger reintroduces that hazard in a new form:

```bash
git merge-base --is-ancestor "$GITHUB_SHA" origin/main \
  || { echo "::error::RC tag is not on main"; exit 1; }
```

`concurrency` needs no change — it keys on `github.ref`, so a tag publish never
queues behind main pushes.

### The RC job

`board-rc` → `board-release-candidate`, gated on
`startsWith(github.ref, 'refs/tags/')`. The existing publish body survives with
four changes:

1. the ancestor guard above
2. the `||` fallback replaced (D2 fix below)
3. the counter starts at **1**, not 0 — `(max // 0) + 1` — matching
   `plot-release/SKILL.md`'s stated `rc.1` convention, which the workflow
   currently contradicts
4. the "no pending board changeset" case keeps `exit 0` but now means something
   honest: **the board has not changed since the last stable, so there is
   nothing to RC.** A plugin-only release legitimately publishes no npm package.

### D1 and D3 — already fixed, not in scope

Both landed on `main` via [#435](https://github.com/plot-pm/plot/pull/435) on
2026-08-26, independently of this design. They are recorded here because they are
why the RC pipeline's true behaviour was invisible, and because D3 is the gate
that makes D2's fix defense-in-depth rather than the sole discriminator.

### D2 fix — the silent fallback

Measured 2026-08-26 against `@changesets/cli@2.30.0`:

```
$ changeset status --output=…      # zero changesets present
EXIT=1   "error Some packages have been changed but no changesets were found"
```

`changeset status` exits **1 for both** the benign "nothing pending" case and the
broken-package-name case. The exit code cannot discriminate them — which is why
the `||` exists. It is not gratuitous; it papers over a real ambiguity and
swallowed a fatal error as collateral. Dropping it outright would break the
benign case, so the fix discriminates on the message:

```bash
if ! out=$(npx changeset status --output=/tmp/cs.json 2>&1); then
  if printf '%s' "$out" | grep -q 'no changesets were found'; then
    echo "no pending changesets — nothing to RC"; exit 0
  fi
  echo "::error::changeset status failed"; printf '%s\n' "$out"; exit 1
fi
```

Because D3 now rejects unknown package names before they reach `main`, a
`changeset status` failure at publish time is provably the benign case — so the
message match above is a second line of defence, not the only one.

### Registry cleanup — manual, one-off

- `npm dist-tag add @plot-pm/board@0.7.0 rc` — a neutral holding position, so
  `npm i @plot-pm/board@rc` stops serving a snapshot from 2026-08-23 until the
  first real RC exists
- deprecate the 709 in a rate-limited loop, dry-run first, message *"snapshot
  build, not a release candidate"*

**This cannot be a CI step.** The package is configured *"Require two-factor
authentication and disallow tokens"*, and OIDC trusted publishing covers
`publish` only. `deprecate` and `dist-tag` need an interactive `npm login` with
2FA from a human's machine.

`npm deprecate` takes a semver range, but no range expresses "all prereleases"
without catching the 7 stables — hence an explicit loop.

## Order of operations

1. ~~D1 + D3 fixes~~ — **done** (#435, 2026-08-26). `release` is green again.
2. Merge the v2.9.0 Version PR → **`0.8.0` ships stable**, `latest` unsticks for
   adopters. Independent of this work; it only has to happen *before* step 4.
3. **This pull request:** delete `board-rc`, add the tag-triggered
   `board-release-candidate` job, fix D2.
4. First real RC: `0.8.1-rc.1`, cut by `/plot-release rc`.
5. Registry cleanup, whenever a human has 2FA to hand.

Step 3 is the one pull request. Steps 4–5 follow it.

**Ordering constraint:** step 3 may land before step 2 — deleting the snapshot
job cannot break a release that does not depend on it. But step 4 must follow
step 2, or the first RC's `BASE` would predict `0.8.0`, whose prerelease space is
the polluted one this design exists to leave behind.

## Impact on adopters

| Change | Shipped? | Impact |
|---|---|---|
| Delete `board-rc`; add tag-triggered publish | no — this repo's CI | none |
| D2 fix | no — repo-local | none |
| `/plot-release rc` | **yes** | **unchanged** |
| `npx @plot-pm/board` (`plot-board-setup`) | **yes** | resolves `latest`; untouched by RC work |
| Repoint `rc` dist-tag | consumer-facing | no shipped skill directs adopters to `@rc` |
| Deprecate the 709 | consumer-facing | all are `-rc.*`; none is `latest` |

One adopter-visible improvement arrives with step 2 rather than with this design:
`skills/plot-board-setup/README.md` ships a documented defect — *"npm `latest`
lags the plugin … which is why artifact precedence puts the plugin first."* That
lag was a symptom of D1; with D1 fixed, merging the Version PR unsticks `latest`
at `0.8.0`. The precedence rule stays correct either way. The note is also stale
on its own terms (it says `0.3.0`; the registry says `0.7.0`) and should be
corrected.

## Verification

The `ci.yml` set, per the Definition of Done: `pnpm test`, `pnpm run validate`,
`pnpm run test:reconcile`, `pnpm run test:e2e`, `pnpm run typecheck`, board build
+ tests.

Workflow changes have no unit tests; per this repo's convention validation is a
real end-to-end run — **an actual `0.8.1-rc.1` cut and verified installable via
`npm i @plot-pm/board@rc`** before the concept is called done.

**Known limit:** tag-triggered workflows do not run until the workflow file is on
the default branch, so the trigger itself is only testable after the pull request
merges. This is inherent to GitHub Actions. The first RC cut is the real test and
should be treated as such.

## Manifesto check

| # | Question | Answer |
|---|---|---|
| 1 | Keeps planning in git? | Yes — the git tag becomes the trigger, replacing an implicit repo-state condition |
| 2 | Project-agnostic? | Yes — no shipped skill changes; the tag is the interface, npm specifics stay in this repo's CI |
| 3 | Fails gracefully? | Improved — D2 converts a silent green into a loud, actionable failure |
| 4 | Convention opted into? | Yes — an adopter may wire the RC tag to anything, or to nothing |
| 5 | Would removing it simplify? | Removing the *snapshots* is the change. What remains is strictly smaller |
| 6 | Executable by hand? | Yes — `git tag && git push`, then `npm publish --tag rc` |
| 7 | Followable by a smaller model? | Yes — the job is mechanical; the judgment (should we endgame?) stays with a person |
| 8 | Stays out of effort tracking? | Yes |
| 9 | Ceremony proportional? | Yes — ceremony *decreases*: 709 unowned publishes become one owned act per release |

## Rejected alternatives

| Alternative | Why rejected |
|---|---|
| Keep snapshots, add a path-delta gate | Fixes the 87% waste but preserves an unowned artifact nobody uses |
| Keep them automatic, publish off-npm (Actions artifact) | Rebuilds the machinery to serve a user who does not exist |
| `/plot-release rc` runs `gh workflow run` | Bakes this repo's packaging into a shipped skill — manifesto question 2 |
| Board adopts the plugin's version line | Breaking, irreversible renumber of a public package for cosmetic gain |
| Read the version from `changeset-release/main` | Replaces a prediction with a computed value, but couples CI to a changesets implementation detail — and decision 5 makes the prediction's drift a normal outcome rather than a defect |
| `workflow_dispatch` that creates the tag | A second door into a room GitHub's UI already opens |
| Unpublish or rename the 709 | npm forbids both after 72 hours |
