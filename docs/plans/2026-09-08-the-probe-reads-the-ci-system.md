# The probe reads the CI system

> `/plot-init` documents a `CI:` proposal built from a `ci_system` field that `plot-detect-repo.sh` does not emit. The proposal is inert, and its own README says so. The slice that was to add the field merged carrying zero files.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** the-jenkins-team-sees-its-builds
- **Story:** setup-asks-what-the-repo-already-knows
- **Review:** pr
- **Impl:** own branches

## Changelog

- Adoption proposes `CI:` from what the repository shows, so a first run on a Jenkins team is configured rather than left with a key nobody knew to set.

<!-- Board impact: none directly. The board reads `CI:` once it is written;
     this is about the key arriving at all. -->

## Motivation

**`skills/plot-init/SKILL.md:178` specifies the proposal in full** — which word each signal proposes, what evidence to print, and that an absent signal writes no key and says so. **`plot-detect-repo.sh` emits no `ci_system`.** Measured 2026-09-08 on this repository: the probe returns `git_host`, `default_branch`, `dod_candidates`, `ticket_prefix`, `commit_style`, `existing_systems`, `hub_docs`, `has_plot_config`, `has_settings`, `language_hint` — and nothing about CI.

**THE SKILL'S OWN README ALREADY RECORDS THIS**, at `plot-init/README.md:206`:

> *"`plot-detect-repo.sh` does not emit `ci_system` yet. The `CI:` proposal above reads a field the probe is specified to report and does not, so it is inert until that slice lands."*

**The slice that was to fix it merged carrying zero files.** `feature/the-probe-reads-the-ci-system`, PR #811, `gh pr diff 811 --name-only` returns nothing — the claim commit and no work. The plan it belonged to reads Delivered.

**THE SIGNAL IS ALREADY READ NEXT DOOR.** `plot-board-probe.sh:34` reports `ci_signals: {jenkinsfile, gh_workflows}`, and that is where this field's shape comes from rather than from a new invention.

## What this is not

**Not a second probe.** The adoption probe and the board probe answer different questions and keep their own collectors; this adds a field to the one that lacks it.

**Not the `CI:` write.** `/plot-init` already knows what to do with the field. This makes the field exist.

**Not a judgement about which CI a repository should use.** The probe reports what it found. Whether two signals tie-break or ask is `two-signals-ask-rather-than-tie-break`'s question.

## Slices

### The adoption probe reports the CI system (Branch: feature/the-probe-reads-the-ci-system)

`plot-detect-repo.sh` emits `ci_system`, shaped after `plot-board-probe.sh`'s `ci_signals`.

**IT REPORTS SIGNALS, NOT A CHOICE.** A repository can carry both a `Jenkinsfile` and `.github/workflows/`, and reporting one of them as *the* CI system is a tie-break this collector must not perform. The field carries what was found; `/plot-init` step 2 already states the rule for what to do when two signals disagree.

**THE EVIDENCE TRAVELS WITH THE SIGNAL**, because the skill prints it: a proposal that says *`CI: jenkins`* without *`Jenkinsfile at the repository root`* asks the reader to trust it.

**Done when** `plot-detect-repo.sh` emits `ci_system` for a repository with a `Jenkinsfile`, for one with `.github/workflows/`, for one with both, and for one with neither; the field names its evidence; and `/plot-init`'s documented proposal is exercised end to end rather than described.

## Notes

### Why this is filed as a bug — 2026-09-08

The feature was specified, documented, announced in a changeset, and never written. `/plot-init` reads a field that does not exist, so the branch it documents is dead code in prose. That is a defect in shipped behaviour, not a new capability.
