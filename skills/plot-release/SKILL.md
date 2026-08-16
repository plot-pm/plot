---
name: plot-release
description: >-
  Verify release readiness and guide the release process.
  Part of the Plot workflow. Use on /plot-release.
globs: []
license: MIT
metadata:
  author: eins78
  repo: https://github.com/plot-pm/plot
  version: 1.2.0
compatibility: Designed for Claude Code and Cursor. Requires git. Host operations (PRs, default branch) go through plot-host.sh (GitHub or Bitbucket).
---

# Plot: Cut a Release

Create a versioned release from delivered plans. This workflow can be run manually (using git and the git-host CLI), by an AI agent interpreting this skill, or via a workflow script (once available).

**Input:** `$ARGUMENTS` is optional. Can be:
- `rc` — cut a release candidate tag and generate a verification checklist
- A version number (e.g., `1.2.0`) or bump type (`major`, `minor`, `patch`) — cut the final release

Examples: `/plot-release rc`, `/plot-release minor`, `/plot-release 1.2.0`

<!-- keep in sync with plot/SKILL.md Setup -->
## Setup

Add a `## Plot Config` section to the adopting project's `CLAUDE.md`:

    ## Plot Config
    <!-- Optional: uncomment if using a GitHub Projects board -->
    <!-- - **Project board:** owner/number (e.g. eins78/5) -->
    - **Branch prefixes:** idea/, feature/, bug/, docs/, infra/
    - **Plan directory:** docs/plans/
    - **Active index:** docs/plans/active/
    - **Delivered index:** docs/plans/delivered/

## Model Guidance

| Steps | Min. Tier | Notes |
|-------|-----------|-------|
| 1. Determine Version | Mid | Heuristic: plan types → bump suggestion |
| 2A. RC Path | Small | Git tag, template generation |
| 2B. Release Notes | Mid | Discovery logic, changelog collection |
| 3. Cross-check Notes | Frontier (orchestrator) + Small (subagents) | Orchestrator compares; small subagents can gather commit messages and plan changelogs in parallel |
| 4-5. Hand-off, RC cleanup | Small | Template list, no-ops |
| 5b. Record the Release in the Plans | Small | Mechanical per plan; the version comes from `git tag --contains`, not judgment. Gate on the sweep's real footer |
| 6. Summary | Small | Formatting |

> **User interaction:** Use `AskUserQuestion` (Claude Code) / `ask_question` (Cursor) for all questions, proposals, and confirmations.

### 1. Determine Version

Check for the latest git tag:

```bash
git tag --sort=-v:refname | head -1
```

If `$ARGUMENTS` is `rc`:
- Determine the target version (same rules as below — check delivered plans, suggest bump type)
- Check for existing RC tags for this version: `git tag --list "v<version>-rc.*"`
- Next RC number: if no existing RCs, use `rc.1`; otherwise increment
- Proceed to **step 2A (RC path)**

If `$ARGUMENTS` specifies a version (e.g., `1.2.0`):
- Use it directly (validate it's valid semver)
- Proceed to **step 2B (final release path)**

If `$ARGUMENTS` specifies a bump type (`major`, `minor`, `patch`):
- Calculate the new version from the latest tag
- Proceed to **step 2B (final release path)**

If `$ARGUMENTS` is empty:
- Check if there's an open RC checklist (`docs/releases/v*-checklist.md`) with all items checked
- If yes: propose cutting the final release for that version
- If no: look at delivered plans since the last release to suggest a bump type:
  - Any features → suggest `minor`
  - Only bug fixes → suggest `patch`
  - Breaking changes noted in changelogs → suggest `major`
- If unable to determine bump type from plan metadata, ask the user to specify the version directly
- Propose the version and confirm with the user

> **Smaller models:** Skip the automatic bump type suggestion. Instead, list the delivered plans with their types and ask the user: "What version should this release be? (major/minor/patch or exact version)" Let the human decide.

### 2A. RC Path — Cut Release Candidate

**Tag the RC:**

```bash
git tag -a v<version>-rc.<n> -m "Release candidate v<version>-rc.<n>"
git push origin v<version>-rc.<n>
```

**Generate verification checklist:**

Collect all delivered plans since the last release (via `docs/plans/delivered/` — check the Delivered date in each plan's Status section against the last release tag date). For each delivered feature or bug plan, extract the `## Changelog` section and create a checklist item. If a plan has a `Sprint: <name>` field, include the sprint name alongside the checklist item for context. Sprint completion is informational — it does not block the release.

```bash
mkdir -p docs/releases
```

Write `docs/releases/v<version>-checklist.md`:

```markdown
# Release Checklist — v<version>

RC: v<version>-rc.<n> (YYYY-MM-DD)

## Verification

- [ ] <feature/bug slug> — <changelog summary>
- [ ] <feature/bug slug> — <changelog summary>

## Automated Tests

- [ ] CI passes on RC tag

## Sign-off

- [ ] All items verified by: ___
- [ ] Final release approved by: ___
```

```bash
git add docs/releases/v<version>-checklist.md
git commit -m "release: v<version>-rc.<n> checklist"
git push
```

**Summary (RC):**
- RC tag: `v<version>-rc.<n>`
- Checklist: `docs/releases/v<version>-checklist.md`
- Plans included: list of slugs
- Progress: `[ ] Draft > [ ] Approved > [x] Delivered > [*] Released (RC)`
- Suggested next actions:
  1. Test against the checklist items
  2. If bugs found: fix via `bug/` branches, merge, then `/plot-release rc` for next RC
  3. When all items pass: `/plot-release` to cut the final release

### 2B. Final Release Path — Generate Release Notes

Check for project-specific release note tooling, then either run it or fall back to manual collection.

**Discover tooling** — check in this order:

1. **Changesets:** Does `.changeset/config.json` exist? If so, the project uses `@changesets/cli`.
2. **Project rules:** Read `CLAUDE.md` and `AGENTS.md` for release note instructions (e.g., custom scripts, specific commands).
3. **Custom scripts:** Check `package.json` for release-related scripts (e.g., `release`, `version`, `changelog`).

**If tooling is found:** remind the user to run it (e.g., `pnpm exec changeset version` for changesets). Do not run release tooling automatically — the user controls when and how versions are bumped. Then proceed to step 3 (cross-check).

**If no tooling is found:** collect changelog entries from delivered plans and present them to the user:

```bash
# Get the date of the last release tag (exclude RC tags)
LAST_TAG=$(git tag --sort=-v:refname | grep -v '\-rc\.' | head -1)
if [ -n "$LAST_TAG" ]; then
  LAST_RELEASE_DATE=$(git log -1 --format=%ai "$LAST_TAG" | cut -d' ' -f1)
else
  LAST_RELEASE_DATE="1970-01-01"
fi

# Find delivered plans newer than the last release
ls docs/plans/delivered/ 2>/dev/null
```

For each delivered plan since the last release:
1. Read the `## Changelog` section
2. Read the `## Status` section for the **Type** (feature/bug/docs/infra)
3. Collect the changelog entries

Only include feature and bug plans in the release notes (docs/infra are live when merged — they don't need release).

Present the collected entries to the user and suggest they add them to `CHANGELOG.md`. Do not write to `CHANGELOG.md` directly.

### 3. Cross-check Release Notes

> **Model tiers for this step:**
> - **Frontier (e.g., Opus):** Full cross-check — compare changelog entries against delivered plans and commit messages. Can delegate data gathering (reading plans, collecting commit messages) to small subagents. Flag significant gaps (missing features, phantom entries). Don't nitpick wording.
> - **Mid (e.g., Sonnet):** Compare changelog entry count against delivered plan count. Can delegate plan reading to small subagents. Flag obvious mismatches (plan with no corresponding entry, entry with no corresponding plan). Skip semantic content comparison.
> - **Small (e.g., Haiku):** Skip gap detection. Present the generated release notes and ask: "Do these release notes look complete?" Human review is the final gate.

Whether generated by tooling or manually constructed, compare the changelog against the actual work:

1. Collect the list of delivered plans and commit messages since the last tag
2. Compare against the generated changelog entries
3. **Only flag significant gaps or errors** — e.g., a delivered feature completely missing from the changelog, or a changelog entry that doesn't match any actual work
4. Don't nitpick wording or minor omissions — offer improvements only if there are clear, meaningful gaps
5. If gaps are found, show them to the user and ask whether to fix before proceeding

This cross-check is the primary value of `/plot-release` — verifying that release notes accurately reflect delivered work.

### 4. Hand-off to Project Release Process

The remaining mechanics — updating `CHANGELOG.md`, bumping the version, tagging, pushing — belong to **the project's own release process**, not to `plot-release`. Plot's job ended with the cross-check in step 3.

Different projects release differently: some use changesets (`pnpm exec changeset version` + a "Version Packages" PR), some run a CI release workflow triggered by a tag, some do it manually. `plot-release` is a participant in that flow, not the driver.

For reference — if the project has no release tooling and the user asks for the manual sequence, it typically looks like:

1. Update `CHANGELOG.md` with the entries collected in step 2B
2. Bump version (e.g. `pnpm version <version> --no-git-tag-version`)
3. Commit: `git commit -am "release: v<version>"`
4. Tag: `git tag -a v<version> -m "Release v<version>"`
5. Push: `git push origin main && git push origin v<version>`

Do **not** execute these on the user's behalf. Point them at their release tooling (or the list above if there is none) and stop.

### 5. Clean Up RC Artifacts

If RC tags exist for this version, they remain in git history (don't delete them — they're part of the release record). The checklist file at `docs/releases/v<version>-checklist.md` stays committed as documentation of what was verified.

### 5b. Record the Release in the Plans

The release exists; the plans it shipped do not know it. Until this step, no
plan in this repo's history had ever reached `Phase: Released` — not once across
sixteen versioned releases — because step 4 hands off to the project's release
process and nothing came back afterwards.

**Only run this once the tag exists.** A plan marked before the tag is cut
claims a version nobody released. Verify with `git tag --list v<version>` before
writing anything.

For each plan currently at `Phase: Delivered`:

1. **Skip docs/infra plans.** `/plot-deliver` already told their authors they are
   live on merge; marking them Released contradicts a message Plot itself sends.
2. **Resolve the version from git, never from dates.** Take the plan's last
   `→ #N` annotation, get its merge commit, and find the release tag containing
   it:

   ```bash
   SHA=$(../plot/scripts/plot-host.sh pr-state <N> | jq -r '.mergeCommit')
   TAG=$(git tag --contains "$SHA" | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | head -1)
   ```

   The delivery date is when the plan was **booked**, not when its code merged —
   those can be months apart, and two tags may share a date. Dates get this
   wrong; `--contains` cannot.
3. **A plan with no annotation, or no merge commit, is left alone** and reported
   as unresolvable. An invented version in a transition record is a claim nobody
   re-checks.
4. Write, in the plan's `## Status`:

   ```
   - **Phase:** Released
   - **Released:** <tag date>, <version>
   ```

   **The symlink does not move.** `delivered/` means "no longer active", not
   "phase is exactly Delivered" — unlike `/plot-deliver`, this step moves
   nothing.

**Idempotent:** a plan already at Released with a record for this version is
left untouched. Re-running after a partial failure converges.

Commit on the default branch using the disposable-branch mechanic from
`/plot-approve` step 4 (including its branch-protection fallback).

**Then the gate.** This is a multi-file write followed by a push, the shape that
half-lands — and worse than delivery's, because it touches N plans, so a partial
write leaves some released and some not with nothing to say which. Run the sweep
and show its **real output**:

```bash
../plot/scripts/plot-reconcile-scan.sh 2>/dev/null | tail -1
```

`unreleased_delivered=0` clears the gate. Any other number is a hard stop: show
section 6's findings and fix them before proceeding.

**Report what you did NOT mark, with the reason.** A silently skipped plan looks
identical to a plan with nothing to do — precisely the confusion that hid this
for sixteen releases:

```
Released as v2.3.0:
  fleet-agent-view          docs/plans/2026-08-15-fleet-agent-view.md
Not marked:
  some-docs-plan            docs plan — live when merged
  older-plan                unresolvable: no PR annotation
summary: … unreleased_delivered=0 …
```

### 6. Summary

**Orient, don't enumerate** (Manifesto Principle 11): open the summary
with where the work now stands, what falls out next, and why — the
mechanical details follow.

Print:
- Version: `v<version>`
- Plans included:
  - `<slug>` — <type>
  - `<slug>` — <type>
- Cross-check result: complete / gaps found
- Plans marked Released: `<slug>` → `<version>` for each, and every plan **not**
  marked with its reason (docs/infra, or unresolvable)
- Release-recorded gate: paste the sweep's actual `summary:` footer from step 5b
  — the objective artifact, not the word "verified"
- RC iterations: <count> (if any)
- Progress: `[ ] Draft > [ ] Approved > [ ] Delivered > [x] Released`
- Plot verification complete — hand off to the project's release process (changesets, CI, or manual) for version bump, tag, and push.
- Suggested next actions:
  1. Run the project's release tooling (or the manual sequence from step 4 if none exists)
  2. Run `/plot` to verify clean state
  3. Start next cycle: `/plot-idea` or `/plot-sprint`
