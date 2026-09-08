# The probe reads the CI system

> `/plot-init` documents a `CI:` proposal built from a `ci_system` field that `plot-detect-repo.sh` does not emit. The proposal is inert, and its own README says so. The slice that was to add the field merged carrying zero files.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** the-jenkins-team-sees-its-builds
- **Story:** setup-asks-what-the-repo-already-knows
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 5
- **Approved:** 2026-09-08, Jan Wloka, plan-PR #834 merged

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

### The adoption probe reports the CI system (Branch: feature/the-probe-reads-the-ci-system) <!-- waits: feature/a-probe-reports-and-the-domain-judges -->

`plot-detect-repo.sh` emits `ci_system`, shaped after `plot-board-probe.sh`'s `ci_signals`.

**IT CARRIES THE SIGNALS AND THE WORD DERIVED FROM THEM**, and that shape settles a contradiction the plan first had. `SKILL.md:181` reads ONE word — `jenkins`, `github-actions`, `both`, `none` — while `plot-board-probe.sh:34`, named here as the model, reports TWO booleans. A collector that emitted only the word would be summarising, which is what `both` already is; one that emitted only the booleans would force a rewrite of a table the skill has already argued through.

```json
"ci_system": { "jenkinsfile": true, "gh_workflows": false, "reading": "jenkins" }
```

**`reading` IS DERIVED IN THE DOMAIN, NOT IN THE COLLECTOR, AND THAT IS WHY THIS SLICE WAITS.** The first draft put the word beside the booleans in `plot-detect-repo.sh`, reasoning that mapping two flags onto four names applies no threshold and is therefore not a judgement. **It is still a derivation in a file whose header says it decides nothing**, and `a-probe-reports-and-the-domain-judges` removes six of those from the same file in the same sprint. Adding a seventh and taking it out a week later is work done twice, in a file two skills and two test files read.

So `proposeStack` lands first and this slice reports the booleans into it. **The tie-break was never in question** — `SKILL.md` already states it, *do not tie-break on the git host; ask* — and it becomes a property in `two-signals-ask-rather-than-tie-break`.

**THE COST IS THAT JENKINS ADOPTION WAITS ON A REFACTOR**, which is a real price and worth naming. It is paid because the alternative writes `ci_system` twice into the file with the most readers in the adoption path.

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

**Done when** `plot-detect-repo.sh` emits `ci_system` as booleans alone — the word is `proposeStack`'s — for a repository with a root `Jenkinsfile`, one whose only Jenkinsfiles are nested (the `quaweb-website` shape, `.build/pipelines/*/*/Jenkinsfile`), one with `.github/workflows/`, one with both, and one with neither; `proposeStack` answers `both` where both are found rather than either word; the extra paths are stated as an unmeasured assumption in the PR; the three prose-matching `ci_system` tests are gone and their replacements run the script; and each new test fails when the field is removed.

### Adoption writes the instance the connector refuses without (Branch: feature/adoption-proposes-the-jenkins-instance) <!-- waits: feature/the-probe-reads-the-ci-system -->

Where the probe proposes `CI: jenkins`, adoption proposes `Jenkins instance` too — the slug from what the repository shows, the container path asked.

**WITHOUT THIS KEY THE CONNECTOR REFUSES AND THE SPRINT GOAL IS NOT MET.** `plot-host.sh:2286` exits 3 naming three repairs, which is the right behaviour and not the outcome the goal describes: *a teammate clones a repository, runs `/plot-init`, and sees real build status — without being told which keys to set.* Four green slices and a board still blank is the failure this slice exists to prevent, so it sits with the connector rather than beside it.

**THE SLUG IS MEASURABLE AND THE PATH IS NOT**, which is the same split adoption already makes for Jira: *propose what was measured, ask for the single thing there is no way to read*. Measured in `quaweb-website` 2026-09-08 — its README carries `jenkins-ci-webbloqs.internal.quatico.dev`, so the slug is a proposal with its evidence. The container path is not: `quaweb/continuous-build` is a fact about the Jenkins job tree, and reading it would need credentials adoption does not yet have.

**ONE QUESTION WHERE THE SLUG WAS FOUND, TWO WHERE IT WAS NOT.** *"Found `jenkins-ci-webbloqs` in your README. Which job builds this repository?"* — a reader who must supply a whole `<slug>/<job/path>` value is being asked to know the key's format, which the goal rules out.

**AND A REPOSITORY THAT NAMES NO JENKINS IS THE NORMAL CASE, NOT THE EDGE ONE.** `quaweb-website` happens to link its pipeline from the README; nothing requires that, and a `Jenkinsfile` says *Jenkins builds this* without saying *which Jenkins*. So the slug is a proposal only where something was measured, and a question everywhere else — **asking beats guessing**, and the alternative is writing no key and leaving the connector to refuse at the first build lookup, which is the failure this slice exists to prevent.

**THE FALLBACK IS A QUESTION, NEVER A DEFAULT.** There is no plausible instance to invent: an instance slug is site-specific, and a wrong one produces `NOT reachable` — indistinguishable, to a reader, from a Jenkins that is down. `CI: jenkins` with no measurable instance therefore asks for it directly, naming why: *"A `Jenkinsfile` says Jenkins builds this repository. Which instance, and which job?"*

**AN UNANSWERED QUESTION WRITES WHAT IS LEFT.** With a measured slug and no path, `plot-host.sh:566` already treats a bare-host instance as *list at the root scope* — its comment calls that "honest, and the open point's fallback" — so a half-answer degrades to a wrong-but-visible reading. With neither, no key is written and the gap is stated, because a `Jenkins instance` invented to fill the field is the silent misconfiguration `/plot-init` refuses everywhere else. Unattended, the same rule as every other proposal: `PLOT-UNASKED`.

**Done when** adoption proposes `Jenkins instance` wherever it proposes `CI: jenkins`; a measured slug is proposed with its evidence and only the container path is asked; a repository naming no Jenkins is asked for both rather than defaulted; an unanswered path writes the slug alone and an unanswered slug writes no key and says so; and a `quaweb`-shaped fixture produces a config the connector does not refuse.

## Notes

### Why this is filed as a bug — 2026-09-08

The feature was specified, documented, announced in a changeset, and never written. `/plot-init` reads a field that does not exist, so the branch it documents is dead code in prose. That is a defect in shipped behaviour, not a new capability.
