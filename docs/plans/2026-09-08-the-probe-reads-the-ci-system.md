# The probe reads the CI system

> `/plot-init` documents a `CI:` proposal built from a `ci_system` field that `plot-detect-repo.sh` does not emit. The proposal is inert, and its own README says so. The slice that was to add the field merged carrying zero files.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** the-jenkins-team-sees-its-builds
- **Story:** setup-asks-what-the-repo-already-knows
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 2

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

**AND THERE ARE FIFTEEN GREEN TESTS OVER A FEATURE THAT DOES NOT EXIST.** `test/reconcile/init-stack.test.mjs` holds `init: ci_system proposes a CI key`, `init: two signals ask rather than tie-break on the git host` and `init: an absent ci_system writes no key and is not none`. Every one passes. Every one is a regex over `SKILL.md`:

```js
assert.match(proposal, /`ci_system` proposes `CI:`/, …)
```

**They assert that the documentation says something, not that the code does it.** `git log` settles where they came from: `b63a2d5e` — PR #824, `adoption-proposes-the-stack` — created the file and these tests in the same commit that wrote the specification they match. The test reads the prose its own commit added.

**THAT IS WHY NOBODY NOTICED FOR FOUR DAYS.** A slice merged carrying zero files, a sibling slice's tests reported the feature as covered, and the release note announced it. The gap was found by a person reading `build-resolve.ts`'s comment, not by a suite.

## What this is not

**Not a second probe.** The adoption probe and the board probe answer different questions and keep their own collectors; this adds a field to the one that lacks it.

**Not the `CI:` write.** `/plot-init` already knows what to do with the field. This makes the field exist.

**Not a judgement about which CI a repository should use.** The probe reports what it found. Whether two signals tie-break or ask is `two-signals-ask-rather-than-tie-break`'s question.

## Slices

### The adoption probe reports the CI system (Branch: feature/the-probe-reads-the-ci-system)

`plot-detect-repo.sh` emits `ci_system`, shaped after `plot-board-probe.sh`'s `ci_signals`.

**IT CARRIES THE SIGNALS AND THE WORD DERIVED FROM THEM**, and that shape settles a contradiction the plan first had. `SKILL.md:181` reads ONE word — `jenkins`, `github-actions`, `both`, `none` — while `plot-board-probe.sh:34`, named here as the model, reports TWO booleans. A collector that emitted only the word would be summarising, which is what `both` already is; one that emitted only the booleans would force a rewrite of a table the skill has already argued through.

```json
"ci_system": { "jenkinsfile": true, "gh_workflows": false, "reading": "jenkins" }
```

**`reading` IS A DERIVATION, NOT A JUDGEMENT**, and the difference is what keeps this out of `a-probe-reports-and-the-domain-judges`'s way. It applies no threshold and weighs nothing: two booleans map onto four words, and `both` is the honest name for a repository carrying both files rather than a tie-break between them. **The tie-break is the skill's**, and `SKILL.md` already states it — *do not tie-break on the git host; ask.* When `reading` moves into the domain later, the booleans stay here and nothing about the measurement changes.

**THE EVIDENCE TRAVELS WITH THE SIGNAL**, because the skill prints it: a proposal that says *`CI: jenkins`* without *`Jenkinsfile at the repository root`* asks the reader to trust it. The booleans are that evidence — `reading: "jenkins"` alone cannot say which file was found.

**A `Jenkinsfile` IS LOOKED FOR IN MORE THAN THE ROOT, AND THAT IS AN ASSUMPTION THIS PLAN OWNS.** `plot-board-probe.sh:94` tests `$git_root/Jenkinsfile` and nothing else, which is right for a board probe answering *can the board run here* and wrong for adoption, where a missed signal means the user is never asked about CI at all. So `ci/Jenkinsfile`, `.jenkins/Jenkinsfile` and `Jenkinsfile.*` count too.

**AND A REAL REPOSITORY SETTLED WHERE TO LOOK, BY DISPROVING THE FIRST ANSWER.** Measured 2026-09-08 in `quaweb-website` — Bitbucket remote, Jenkins CI, the exact stack this sprint is for:

```
.build/pipelines/website/release/Jenkinsfile
.build/pipelines/website/continuous-build/Jenkinsfile
.build/pipelines/website/continuous-deploy/Jenkinsfile
```

**Three Jenkinsfiles, none of them at any of the four paths first proposed** — not the root, not `ci/`, not `.jenkins/`, not `Jenkinsfile.*`. A root-only probe reads this repository as having no CI, and so does the extended list that was reasoned from convention.

**SO THE READING IS A BOUNDED SEARCH, NOT A LIST OF GUESSED PATHS.** `git ls-files` for a basename matching `Jenkinsfile*`, which is bounded by what git already tracks: no `node_modules`, no untracked fixtures, no tree walk, and one command whatever the layout. The four hardcoded paths are dropped — they were an assumption, and the first repository that could test it disagreed.

**ONE FILE IS THE SIGNAL; THREE ARE STILL ONE SIGNAL.** `jenkinsfile: true` says Jenkins builds this repository. How many pipelines it has is not adoption's question, and a count would invite a caller to weigh it against `gh_workflows`.

**IT STAYS BOUNDED BY GIT, NEVER A TREE WALK.** `git ls-files` sees only tracked files, so a `Jenkinsfile` inside `node_modules` or an unstaged fixture cannot answer for the repository — the failure a bare `find` would introduce, and a worse answer than the root-only one it replaces.

**THE PROSE TESTS ARE REPLACED, NOT JOINED.** The three `ci_system` tests in `init-stack.test.mjs` are deleted and rewritten against the probe's output. Keeping them beside behaviour tests would keep a suite that reported a missing feature as covered — and a test whose failure mode is *the documentation was edited* answers a question nobody asked. The tracker tests beside them stay: `ticket_prefix` exists, so those assert against a field that is really emitted.

**Done when** `plot-detect-repo.sh` emits `ci_system` with both booleans and a derived `reading` for a repository with a root `Jenkinsfile`, one whose only Jenkinsfiles are nested (the `quaweb-website` shape, `.build/pipelines/*/*/Jenkinsfile`), one with `.github/workflows/`, one with both, and one with neither; `reading` is `both` where both are found rather than either word; the extra paths are stated as an unmeasured assumption in the PR; the three prose-matching `ci_system` tests are gone and their replacements run the script; and each new test fails when the field is removed.

## Notes

### Why this is filed as a bug — 2026-09-08

The feature was specified, documented, announced in a changeset, and never written. `/plot-init` reads a field that does not exist, so the branch it documents is dead code in prose. That is a defect in shipped behaviour, not a new capability.
