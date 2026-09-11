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
  version: 1.6.0
compatibility: Designed for Claude Code and Cursor. Requires git. Host operations (PRs, default branch) go through plot-host.sh (GitHub or Bitbucket).
---

# Plot: Cut a Release

Create a versioned release from delivered plans. This workflow can be run manually (using git and the git-host CLI), by an AI agent interpreting this skill, or via a workflow script (once available).

**Input:** `$ARGUMENTS` is optional. Can be:
- `rc` — cut a release candidate tag and generate a verification checklist
- A version number (e.g., `1.2.0`) or bump type (`major`, `minor`, `patch`) — cut the final release

`--ignore-sprint` may accompany any of these: it clears the sprint gate in step 0 and nothing else.

Examples: `/plot-release rc`, `/plot-release minor`, `/plot-release 1.2.0`, `/plot-release 2.5.2 --ignore-sprint`

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
| 0. Sprint Gate | Small | `plot-release-gate.sh` decides; this step reads its exit code and prints its sentence. The Should-Have question needs a person, not a bigger model |
| 1. Determine Version | Mid | Heuristic: plan types → bump suggestion |
| 2A. RC Path | Small | Git tag, template generation |
| 2B. Release Notes | Mid | Discovery logic, changelog collection |
| 3. Cross-check Notes | Frontier (orchestrator) + Small (subagents) | Orchestrator compares; small subagents can gather commit messages and plan changelogs in parallel |
| 4-5. Hand-off, RC cleanup | Small | Template list, no-ops |
| 5b. Record the Release in the Plans | Small | Mechanical per plan; the version comes from `git tag --contains`, not judgment. Gate on the sweep's real footer |
| 5c. Sprint Override Record | Small | One line into `## Notes`, from facts step 0 already collected |
| 6. Summary | Small | Formatting |

> **User interaction:** Use `AskUserQuestion` (Claude Code) / `ask_question` (Cursor) for all questions, proposals, and confirmations.
>
> **No user present?** If `PLOT_UNATTENDED=1` is set, do not call the question tool — each question below declares what to do instead, and every skipped question is named in the output. See [Running unattended](../plot/docs/unattended.md).

### 0. The Sprint Gate

**Run this before anything else.** A release that has been tagged cannot be
un-cut, so the sprint's claim is checked while refusing is still cheap.

**ASK THE GATE. IT DECIDES; THIS STEP REPORTS WHAT IT SAID.**

```bash
../plot/scripts/plot-release-gate.sh [--candidate] [--ignore-sprint] [--unattended]
```

It collects the sprint's facts and asks `workflows/release.ts` for its verdict.
The rule lives there — which tiers refuse, what `disputed` counts as, whether a
`withdrawn` item gates — and this skill states none of it. **A rule restated here
is a second copy that can drift from the one that fires.**

Pass `--candidate` for `/plot-release rc`, `--ignore-sprint` when the operator
gave it, and `--unattended` under `PLOT_UNATTENDED=1`.

**Exit 0 the sprint permits the cut; exit 1 it refuses; exit 2 the facts could
not be read**, which is a broken installation and not a sprint's state.

The verdict is JSON on stdout:

```json
{"pass":false,"reason":"must-haves-open",
 "detail":"1 unfinished Must Have(s): [one-place-for-what-a-row-can-do] — not delivered (sprint the-board-tells-the-truth). Deliver them, move them to Deferred, or pass --ignore-sprint.",
 "openShoulds":["plot-board-setup"],"openCoulds":[],"withdrawn":[]}
```

#### On a refusal, stop and print the sentence

**Print `detail` whole.** It names every open Must, the sprint each came from,
whether the item is undelivered or checked-but-not-delivered, and what clears it.
A message reading *"the sprint refuses"* throws away the half a person acts on.

```
plot-release: sprint the-board-tells-the-truth targets 2.5.2 and has
              1 unfinished Must Have:
                [one-place-for-what-a-row-can-do] — Approved, not delivered
              Deliver it, move it to Deferred, or pass --ignore-sprint.
```

**Change nothing and cut nothing.** The refusal is the end of the action.

#### On a pass, report what it named

`withdrawn` lists items whose plan is `Rejected` or `Superseded`, in every tier.
They do not gate, and **naming them is the point**: a cutter reading this sees
that something the sprint promised was dropped and can open the plan to find who
dropped it and why.

```
Withdrawn from this sprint:
  [the-board-answers-while-it-scans] — must, plan withdrawn (sprint the-board-tells-the-truth)
```

`openCoulds` goes in the step 6 summary if it is non-empty. Nothing more.

#### Should Haves are the operator's question, and it is asked here

**The gate reports `openShoulds` and refuses on none of them.** There is no flag
for this tier, deliberately: a hard gate on stretch goals is one operators learn
to force past, and a flag typed reflexively has stopped being a gate. But silence
is the failure this step exists to fix — a release cut with three Should Haves
open is a decision, and a decision made without being asked is one nobody made.
**The confirmation is the record that a person looked.**

So when `openShoulds` is non-empty, **ask** — naming them — and take yes or no in
the moment:

```
Sprint the-board-tells-the-truth targets 2.5.2. All Must Haves are done.
3 Should Haves are open:
  [the-board-answers-agents] — wave 1 delivered, wave 2 open
  [plot-board-setup] — not delivered
Cut 2.5.2 anyway?
```

**Answering no cuts nothing** — stop, changing no files.

Under `PLOT_UNATTENDED=1` the prompt becomes a warning: name the open items,
state that nobody was asked, and proceed. `PLOT_UNATTENDED` answers *may I ask?*
and never *may I proceed?* — **the Must-Have gate still refuses, in both modes**,
which is the gate's own behaviour and not this skill's to soften.

#### `--ignore-sprint` is the named escape

It is passed to the gate and clears the Must-Have refusal. **It clears that and
nothing else** — not the phase guardrails, not the delivered-plan checks, not
step 5b's sweep. If you find yourself reaching for it to get past something else,
that is a different problem.

A gate with no exit is one people route around by never declaring a release at
all, which would cost the field its adoption.

**When it is used, remember the open Musts the gate named** — step 5c writes them
into the sprint file, after the tag exists. Until then no version has been
released, and a note claiming one is the same defect step 5b guards against. If
the release is abandoned between here and the tag, nothing was written and
nothing needs undoing.

#### The operator's approval is separate, and it stays

A pass is the sprint's answer and not a release. **A release is the one action
nobody can undo** — a tag is public and a published package cannot be recalled —
so the version is still named by a person, and step 4 still hands off to the
project's own release process. This gate is the refusal in front of that
approval, never a replacement for it.

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

> **Unattended (`PLOT_UNATTENDED=1`):**
> - Bump type **derivable** from the delivered plans' types — proceed with it. That is a reading of recorded facts, not a choice.
>   `PLOT-UNASKED: Release v<version> (<bump> from <n> delivered plans)? — default — proceeding`
> - Bump type **not derivable** — stop. There is no safe default for a version number, and guessing one tags a repo permanently.
>   `PLOT-UNASKED: What version should this release be? — stopped — plan types were inconclusive; nothing tagged`

> **Smaller models:** Skip the automatic bump type suggestion. Instead, list the delivered plans with their types and ask the user: "What version should this release be? (major/minor/patch or exact version)" Let the human decide.

### 2A. RC Path — Cut Release Candidate

**Tag the RC:**

```bash
git tag -a v<version>-rc.<n> -m "Release candidate v<version>-rc.<n>"
git push origin v<version>-rc.<n>
```

**Generate verification checklist:**

Collect all delivered plans since the last release (via `docs/plans/delivered/` — check the Delivered date in each plan's Status section against the last release tag date). For each delivered feature or bug plan, extract the `## Changelog` section and create a checklist item. If a plan has a `Sprint: <name>` field, include the sprint name alongside the checklist item for context. Whether the sprint blocks the release is decided in step 0, from its `Release:` field — not here.

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

> **Unattended (`PLOT_UNATTENDED=1`):** the RC tag and checklist are mechanical — cut them. But **never fill a sign-off line**, and never treat an unsigned checklist as passed. Those two blanks are the record of a person taking responsibility; an agent writing into them forges it.
> `PLOT-UNASKED: Who verified / approved this release? — refused — sign-off is a person's to give; the lines are left blank`

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

**A changeset that names its plan is read, not matched.** A changeset body may carry a `plan:` line beside its `bumps:` block:

```markdown
The description, which is what the changelog publishes.

<!--
plan: docs/plans/2026-09-06-a-changeset-names-its-plan.md
bumps:
  skills:
    plot: patch
-->
```

Where that line is present, the changeset's plan is a **lookup** — pair them directly and spend no judgement on it. Where it is absent, match semantically as above. Both paths run in one release: the link is a fast path over the same cross-check, never a replacement for it.

**The link is optional and its absence is not a finding.** A changeset written by hand, or by a contributor working without a plan, is valid without one — do not report a missing `plan:` line as a gap.

**Never suggest moving the `plan:` line above the description.** Changesets publishes the first non-empty line after the frontmatter, so a reference written first becomes the release note: the failure that printed a bare comment marker as the whole description in 19 of 169 published entries. `check-changeset-packages.sh` refuses it.

> **Unattended (`PLOT_UNATTENDED=1`):** proceed with the notes as generated, and list every gap found in the output — the gaps are the finding, and a person reads them after the fact.
> `PLOT-UNASKED: Fix <n> changelog gaps before proceeding? — default — proceeded; the <n> gaps are listed above`

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
plan in this repo's history had ever reached `State: Released` — not once across
sixteen versioned releases — because step 4 hands off to the project's release
process and nothing came back afterwards.

**Only run this once the tag exists.** A plan marked before the tag is cut
claims a version nobody released. Verify with `git tag --list v<version>` before
writing anything.

For each plan currently at `State: Delivered`:

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
   - **State:** Released
   - **Released:** <tag date>, <version>
   ```

   Then declare each write, once per plan:

   ```bash
   bash ../plot/scripts/plot-state-receipt.sh --unowned <plan file> Released \
     "/plot-release has no controller — setPlanPhase does not exist"
   ```

   **`plot-state-gate.sh` refuses a `State:` line changed by anything but the
   script that owns it**, and no script owns `Released`: `setPlanPhase` does not
   exist, which the plan `the-master-agent-uses-the-controllers` records as a
   finding rather than a gap to work around. The line above is the named escape
   and it is recorded, so the gap stays countable until
   `a-release-is-a-controller-command` closes it.

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

#### 5c. Record a Sprint Override

If step 0 was cleared with `--ignore-sprint`, **now** write the line it held
into the sprint file's `## Notes` — the tag exists, so the version is finally a
fact rather than an intention. Format and placement are in step 0.

Nothing to write if `--ignore-sprint` was not used, or if no sprint declared a
`Release:`. Idempotent: a note already present for this version is left alone.

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
- Sprint gate: passed / not applicable / **cleared with `--ignore-sprint`**, and
  for the last, the Must Haves that were open and the sprint note written
- Withdrawn from the sprint: each item whose plan is Rejected or Superseded,
  with its tier — a promise the sprint dropped is a fact this release made, and
  the summary is where the cutter reads it
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
