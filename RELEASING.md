# Releasing Plot

Plot uses [Changesets](https://github.com/changesets/changesets) for versioning, with a per-skill version bumping layer on top. The pipeline runs in GitHub Actions on push to `main`.

## TL;DR — adding a changeset

```bash
pnpm changeset
# edit the created .changeset/<timestamp>.md
```

Each PR that touches skills should include a changeset. The CI workflow warns if a PR has no changeset and errors if a `bumps:` block references a non-existent skill directory.

## Changeset format

```markdown
---
"plot": minor
---

Brief description of the change

<!--
bumps:
  skills:
    plot-idea: patch
    plot-approve: minor
-->
```

- The frontmatter block (`"plot": minor`) drives the **plugin-level** version bump (writes to `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`).
- The HTML-comment `bumps:` block drives **per-skill** SKILL.md version bumps. Use the directory name under `skills/` (e.g. `plot-idea`, not `idea`).
- If a change touches no skills, the `bumps:` block can be omitted entirely.

Per `CLAUDE.md`: skill patch → plugin patch (at minimum), skill minor → plugin minor (at minimum), skill major → plugin major.

## Pipeline

```
pnpm run version (run by changesets/action)
  bump-skill-versions.sh → changeset version → sync-versions.sh
  (read bumps: blocks)     (consume changesets)  (sync plugin.json + marketplace.json)
```

On push to `main`:

1. **`release.yml`** runs `changesets/action`.
2. If pending changesets exist, the action opens a `release: X.Y.Z` PR that contains the bumped versions and updated `CHANGELOG.md`.
3. **`release.yml`'s `dispatch-ci` job** starts CI on `changeset-release/main`, pinned to the head commit the release job just wrote. Nothing else starts it: the pull request run is held at `action_required` because the PR is bot-authored, and a push run does not exist, because the branch is pushed with `secrets.GITHUB_TOKEN` and GitHub starts no workflow from an event that token caused. The dispatched run reports `validate`, which is the required check.
4. **Wait for `validate` on the release PR's current head, then merge with `gh pr merge` and no `--admin`.**
   - On red, fix the cause. To re-run against the same head: `gh workflow run ci.yml --ref changeset-release/main -f expected_sha=<head>`.
   - A push to `main` while you wait regenerates the branch and dispatches a new run, so the wait starts again on the new head. Read the head fresh before merging.
   - `--admin` is a named exception, not the routine: record each use in the release PR with its reason.
5. When that PR merges, the action's `publish` step runs `create-release.sh`, which tags the commit (`vX.Y.Z` plus `<skill>@<version>` for each skill) and creates a GitHub Release with the changelog.

## Local commands

| Command | Purpose |
|---------|---------|
| `pnpm changeset` | Create a new changeset file from the template |
| `pnpm run validate` | Validate SKILL.md frontmatter (CI runs this on every PR) |
| `pnpm test` | Verify all skills parse |
| `pnpm run version` | Apply pending changesets locally (bump skill versions, run `changeset version`, sync plugin metadata) |
| `pnpm run release` | Manual escape hatch: run `version`, commit, and tag locally (use only if Actions is broken) |
