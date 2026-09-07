# Adoption asks about the stack

> `/plot-init` probes for Bitbucket seven times and for Jira and Jenkins not at all. A teammate adopting Plot in a Jira shop is asked nothing about the tracker they use every day, and silently gets `trackerNone`.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** the-board-serves-a-team
- **Story:** the-domain-knows-what-plot-knows
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- Adoption proposes `Tracker:` and `CI:` from what the repository shows, so a first run on a non-GitHub stack is configured rather than silently defaulted.

## Motivation

**Measured 2026-09-07.** `plot-detect-repo.sh` emits ten fields — `git_host`, `ticket_prefix`, `commit_style`, `default_branch`, `dod_candidates`, `existing_systems`, `has_plot_config`, `has_settings`, `hub_docs`, `language_hint`. **There is no `tracker` and no `ci_system`.** The word `bitbucket` appears seven times; `jira` and `jenkins` appear **zero**.

**BOTH KEYS ALREADY EXIST.** `plot-config.sh:99` documents `CI` as `jenkins | github-actions | none`, and `Tracker` is a declared key with four connectors behind it. **The vocabulary is built and adoption does not speak it.**

**THE DEFAULT IS SILENT AND IT IS WRONG FOR THE NEXT USERS.** A repository that declares no tracker gets `trackerNone`, which answers `unaskable` on every operation — correct behaviour for a repository with no tracker, and a lie about a team that has Jira. Nothing tells them: `unaskable` reads the same whether there is no tracker or nobody asked.

**AND HALF THE PROBE IS ALREADY BUILT.** `plot-detect-repo.sh:79` scans 80 commit subjects for `[A-Z]{2,10}-[0-9]+` and reports the prefix **only when it recurs** — *"one stray `ABC-1` in a subject line is not a scheme"*. `/plot-init:71` already prints the result: *"no ticket scheme"*. **The Jira signal works and is already shown to the operator; nothing turns it into a `Tracker:` key.**

**WHAT IS GENUINELY ABSENT IS THE CI SYSTEM.** No field, no signal, no proposal — and a `Jenkinsfile` is a fact sitting in the working tree.

## What this is not

**Not an interrogation.** `/plot-init`'s own rule is *"propose, don't interrogate"* — the probe reports and a person confirms. Two more proposals, not two more questions.

**Not a guess presented as a fact.** A `Jenkinsfile` is evidence, not proof: a repo may have one and build elsewhere. Every field the probe emits is *"a proposal a human confirms"*, and these are too.

**Not a change to the connectors.** They exist. This is the step that tells them which one a team has.

## Slices

### The probe reads the CI system (Branch: feature/the-probe-reads-the-ci-system)

`plot-detect-repo.sh` emits `ci_system` beside the ten fields it already reports.

**ONE NEW FIELD, NOT TWO.** `ticket_prefix` is the tracker signal and it works. A second field restating it would be two records of one reading — the defect this estate has now measured four times.

**A `Jenkinsfile` IS EVIDENCE AND SO IS `.github/workflows/`.** Both present means a person decides, and the field must say **both were found** rather than picking one. `existing_systems` already reports a list this way.

**NO EVIDENCE IS `none`, NOT EMPTY.** A blank invites the silent default this plan exists to remove.

**IT READS FILES AND ASKS NOTHING.** Whether `jen` authenticates is `plot-board-probe.sh`'s question and it already asks it.

**Done when** the probe emits `ci_system` with the evidence behind it, both signals present is reported as both, `none` is a value rather than a blank, and the probe still needs no credential.

### Adoption proposes the tracker and the CI system (Branch: feature/adoption-proposes-the-stack) <!-- waits: feature/the-probe-reads-the-ci-system -->

`/plot-init` turns both readings into `Tracker:` and `CI:` proposals.

**IT PROPOSES WHAT IT MEASURED AND ASKS FOR WHAT IT CANNOT KNOW.** A recurring `PROJ-` prefix says the scheme is Jira; **the base URL is nowhere in git history**, and `tracker-jira.ts` takes one. So `/plot-init` proposes `Tracker: jira` and asks for the URL — the single question it has no way to answer.

**THAT ASK IS THE ONLY ONE ADDED**, and it obeys `/plot-init`'s own rule: *propose, don't interrogate*. Everything else is a proposal a person confirms or rejects.

**THE EVIDENCE TRAVELS WITH THE PROPOSAL.** `jira (PROJ in 38 of 80 subjects)` lets a reader confirm in one read; a bare `jira` teaches nothing. `/plot-init` already prints the ticket scheme this way.

**UNDER `PLOT_UNATTENDED=1` THE ASK BECOMES A REPORT.** An unattended adoption cannot answer, so it proposes `Tracker: jira` with the URL unset and **says the URL is missing** — the shape `/plot-init` already uses for `PLOT-UNASKED`. A half-configured tracker that announces its gap beats one that fails later saying nothing.

**Done when** a recurring ticket prefix yields a `Tracker:` proposal, `ci_system` yields a `CI:` proposal, the evidence is printed with each, the base URL is the one thing asked, and an unattended run reports the gap rather than guessing.

## Notes

### Why this is the first Must — 2026-09-07

Every other item in this sprint is reachable only after adoption. A teammate whose `Tracker` is wrong on line one meets `unaskable` at every issue operation for the rest of the run, and has no reason to connect the two.

### Round 1 — 2026-09-07

**The plan said the probe must learn to find Jira. It already had.** `plot-detect-repo.sh:79` has scanned commit subjects for a recurring ticket prefix since before this plan, with a comment stating the rule — *"a prefix only counts when it recurs"* — and `/plot-init:71` prints the answer. **What was missing was never the detection; it was that nothing turns the reading into a key.**

That halves the probe work to one genuinely absent field, `ci_system`, and moves the rest into the skill.

**The round also found the half-known value.** A commit prefix gives `PROJ` and no host — `tracker-jira.ts` needs a base URL that is nowhere in git history. Rather than guessing it from a remote or leaving the tracker unset, adoption **proposes the scheme it measured and asks for the one thing it cannot know**, which is the smallest honest shape and the only question this plan adds.

**And the unattended case forced an answer the attended one hides:** with nobody to ask, the proposal ships with the URL unset and says so. A half-configured tracker that announces its gap is better than `trackerNone` answering `unaskable` for a reason nobody can see.
