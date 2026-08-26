## Implementation brief — release-candidate-publishing

- **Plan (canonical):** `docs/plans/2026-08-26-release-candidate-publishing.md` on this branch
- **Approved:** 2026-08-26, eins78, plan reviewed on PR #439
- **Branch:** `infra/release-candidate-publishing` (base: `main`)
- **Ends as:** one PR to `main` — [#439](https://github.com/plot-pm/plot/pull/439), already open, carrying plan and code
- **Review of the code:** PR review per repo convention; CI `validate` must pass
- **Merge timing:** after v2.9.0 ships (decided 2026-08-26). Do not merge before it.
- **Scope guard:** implement what the plan says; drift → back to the plan.

### What to build

Five changes in `.github/workflows/release.yml`, one shipped README, and a
changeset. All on this branch.

#### 1. Remove the `board-rc` job

Delete the job at `release.yml:92` and its header comment block describing the
`workflow_dispatch` path. Its publish body is reused by item 3, so read it before
deleting.

#### 2. Change the triggers

```yaml
on:
  push:
    branches: [main]
    tags: ['v*-rc.*']
  # workflow_dispatch removed; it triggered board-rc only
```

Then tighten the `release` job's condition at `release.yml:28`:

```yaml
if: github.event_name == 'push' && github.ref == 'refs/heads/main'
```

`github.event_name` is `push` for tag pushes. Without the branch test, a
release-candidate tag runs `changesets/action` against a tag ref.

Leave `concurrency` alone. Its group includes `github.ref`, so a tag publish does
not queue behind pushes to `main`.

#### 3. Add `board-release-candidate`

The removed job's publish body, with four changes:

1. **Condition:** `if: startsWith(github.ref, 'refs/tags/')`
2. **Ancestry assertion**, replacing the deleted `refs/heads/main` guard. That
   guard stopped a feature-branch dispatch publishing from that branch's
   changesets; a tag trigger reintroduces the case:

   ```bash
   git merge-base --is-ancestor "$GITHUB_SHA" origin/main \
     || { echo "::error::RC tag is not on main"; exit 1; }
   ```

3. **Counter starts at 1**, not 0 — `(max // 0) + 1`. `plot-release/SKILL.md`
   states `rc.1` as the convention; the current job contradicts it.
4. **Keep the `exit 0`** on the no-pending-board-changeset path. Its meaning is
   now: the board has not changed since the last stable release, so there is no
   package to publish. A plugin-only release publishes no npm package. Update the
   message accordingly.

Keep `--provenance --tag rc --access public`, the OIDC permissions
(`id-token: write`), and the npm pin. The job must stay in `release.yml`: npm
trusted publishing permits one workflow filename per package.

#### 4. Fix D2 at both occurrences

`release.yml:66-67` and `:147` both carry:

```bash
npx changeset status --output=… || echo '{"releases":[]}' > …
```

Replace both with the message-discriminating form:

```bash
if ! out=$(npx changeset status --output=/tmp/cs.json 2>&1); then
  if printf '%s' "$out" | grep -q 'no changesets were found'; then
    echo "no pending changesets — nothing to publish"; exit 0
  fi
  echo "::error::changeset status failed"; printf '%s\n' "$out"; exit 1
fi
```

**Do not simply delete the fallback.** Measured 2026-08-26 against
`@changesets/cli@2.30.0`, `changeset status` exits 1 for the no-changesets case
*and* the unknown-package case. The exit status does not distinguish them, so
removal would fail the benign case. Adjust the `exit 0` branch for the `release`
job, where skipping means "no version bump pending", not "nothing to publish".

#### 5. Correct the `latest` claim

`skills/plot-board-setup/README.md:171` states `@plot-pm/board` publishes `0.3.0`
as `latest`. The registry holds `0.7.0` (measured 2026-08-26).

Replace the figure with a command that reads the registry —
`npm view @plot-pm/board version` — and **do not substitute a newer figure**. A
version number in shipped documentation goes stale at the next release, which is
how this line became wrong. Keep the precedence rule it explains: the lag recurs
whenever the plugin ships ahead of a stable release.

This is shipped surface. Keep the sanitization bar: no project names, no internal
infrastructure references.

#### 6. Add a changeset

`'plot': patch`. This repository treats release-infrastructure changes as
changeset-worthy — see `.changeset/20260826-a-changeset-names-a-real-package.md`,
added by #435 for a CI-only change. No `bumps:` block: no skill directory
changes. `README.md` under `skills/plot-board-setup/` is documentation, not skill
content.

### Done when

- `release.yml` has no `board-rc` job and no `workflow_dispatch` trigger
- the `release` job carries the branch test; `board-release-candidate` carries
  the tag condition and the ancestry assertion
- neither `changeset status` call can report a failure as an empty result
- the README cites a command rather than a version number
- a `plot` changeset exists
- the `ci.yml` set passes: `pnpm test`, `pnpm run validate`,
  `pnpm run test:reconcile`, `pnpm run test:e2e`, `pnpm run typecheck`, board
  build and board tests

### Not yours

- **Registry cleanup** (deprecating the 709 snapshots, repointing the `rc`
  dist-tag). Requires an interactive `npm login` with two-factor authentication
  from a person's machine; OIDC covers `publish` only.
- **Cutting the first release candidate.** Follows the v2.9.0 release.
- **D1 and D3.** Fixed by #435.

### Verification limit

A tag-triggered workflow does not run until its file is on the default branch.
The trigger is **not testable before merge**. CI passing is not evidence the
trigger works. The first `/plot-release rc` is the test — say so rather than
reporting the trigger as verified.

### Bookkeeping

PR #439 already exists and its number is recorded on the branch's line in the
plan's `## Branches` section, so there is no `→ #<number>` to append on PR
creation. The end-PR body must carry the plan link and mirror its approval
record: the file is the truth, the PR body is the reviewer-facing mirror.
