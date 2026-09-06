---
'plot': patch
---

The changeset check names the changesets that link no plan, and refuses none of them. Slice 1 added the count; a bare `1 of 28` is not actionable, and a finding must be actionable the day it fires — so the files a person would open are listed beneath it, the same shape `ci.yml`'s other ratchets use: the count, then the hits.

**Count first, gate later.** The line is `::notice::`, never `::error::`, and the exit code is unchanged whatever the number says. The other ratchets bound a number that must not *grow*; this one watches a number that should, so there is no count at which it becomes a failure. Measured 2026-09-06 before the convention landed: **0 of 14** changesets named a plan, and a refusal would have failed every one in flight.

The reading is asked of `parseChangeset`, never re-derived in the script. The rule owns what a plan reference looks like, down to the leading `#` some authors write inside the comment block, and a second reading here would be a third implementation that drifts the first time the form changes.

The check now takes an optional root, which is what makes both outcomes testable against fabricated `.changeset` directories rather than against whatever the estate holds that day — the same optional shape `check-bundle-attributes.sh` already carries, and for the same reason. The rule is still imported from the script's own repository by absolute path: a fixture carries changesets, not a copy of `packages/domain`.

That argument exposed a latent bug it also fixes. `[ -f "$d/package.json" ]` is the last command in the package-name glob loop, so under `set -e` a repository with no `packages/` directory aborted the assignment and the whole script — exit 1, empty stdout, empty stderr. Invisible in this repo, where `packages/` always exists.

<!--
plan: docs/plans/2026-09-06-a-changeset-names-its-plan.md
bumps:
  skills:
    plot: patch
-->
