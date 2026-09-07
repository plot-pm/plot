# Adoption asks about the stack

> `/plot-init` probes for Bitbucket seven times and for Jira and Jenkins not at all. A teammate adopting Plot in a Jira shop is asked nothing about the tracker they use every day, and silently gets `trackerNone`.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** the-board-serves-a-team
- **Story:** the-domain-knows-what-plot-knows
- **Review:** pr
- **Impl:** own branches

## Changelog

- Adoption proposes `Tracker:` and `CI:` from what the repository shows, so a first run on a non-GitHub stack is configured rather than silently defaulted.

## Motivation

**Measured 2026-09-07.** `plot-detect-repo.sh` emits ten fields — `git_host`, `ticket_prefix`, `commit_style`, `default_branch`, `dod_candidates`, `existing_systems`, `has_plot_config`, `has_settings`, `hub_docs`, `language_hint`. **There is no `tracker` and no `ci_system`.** The word `bitbucket` appears seven times; `jira` and `jenkins` appear **zero**.

**BOTH KEYS ALREADY EXIST.** `plot-config.sh:99` documents `CI` as `jenkins | github-actions | none`, and `Tracker` is a declared key with four connectors behind it. **The vocabulary is built and adoption does not speak it.**

**THE DEFAULT IS SILENT AND IT IS WRONG FOR THE NEXT USERS.** A repository that declares no tracker gets `trackerNone`, which answers `unaskable` on every operation — correct behaviour for a repository with no tracker, and a lie about a team that has Jira. Nothing tells them: `unaskable` reads the same whether there is no tracker or nobody asked.

**THE SIGNALS ARE IN THE REPOSITORY.** A Jira shop leaves `PROJ-123` in commit subjects and branch names; a Jenkins shop has a `Jenkinsfile`. `plot-detect-repo.sh` already reads commit style and branch prefixes for exactly this kind of inference — the probe's shape is right and two questions are missing from it.

## What this is not

**Not an interrogation.** `/plot-init`'s own rule is *"propose, don't interrogate"* — the probe reports and a person confirms. Two more proposals, not two more questions.

**Not a guess presented as a fact.** A `Jenkinsfile` is evidence, not proof: a repo may have one and build elsewhere. Every field the probe emits is *"a proposal a human confirms"*, and these are too.

**Not a change to the connectors.** They exist. This is the step that tells them which one a team has.

## Slices

### The probe reads the tracker and the CI system (Branch: feature/adoption-asks-about-the-stack)

`plot-detect-repo.sh` emits `tracker` and `ci_system`, and `/plot-init` proposes both.

**THE EVIDENCE IS NAMED WITH THE PROPOSAL.** A field saying `jira` teaches nothing; `jira (PROJ-1234 in 38 of 50 commit subjects)` lets a person confirm or reject in one read. The probe already reports `dod_candidates` this way.

**A `Jenkinsfile` IS THE STRONGEST SIGNAL AND NOT THE ONLY ONE.** `.github/workflows/` means GitHub Actions; both present means a person decides, and the probe must say both were found rather than picking one.

**NO EVIDENCE IS AN ANSWER.** `none` is a legitimate value for both keys and must be proposed as one, not left blank — a blank invites the silent default this plan exists to remove.

**IT PROBES, IT DOES NOT AUTHENTICATE.** Whether `jen` or a Jira token works is `plot-board-probe.sh`'s question, and it already asks it. This reads files.

**Done when** the probe emits `tracker` and `ci_system` with the evidence behind each, `/plot-init` proposes both alongside `Git host`, `none` is proposed where nothing was found, both signals present is reported as both, and no credential is required to run it.

## Notes

### Why this is the first Must — 2026-09-07

Every other item in this sprint is reachable only after adoption. A teammate whose `Tracker` is wrong on line one meets `unaskable` at every issue operation for the rest of the run, and has no reason to connect the two.
