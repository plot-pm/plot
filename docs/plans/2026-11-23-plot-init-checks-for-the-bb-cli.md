# Plot-init checks for the bb CLI

> `/plot-init` on a Bitbucket repository reads which `bb` answers on `PATH`, proposes `brew install quatico-solutions/tap/quatico-bb` where none or the wrong one answers, names a `bb` that shadows the Homebrew one, and reports `bb` authentication.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:**
- **Issue:** #2533
- **Review:** pr
- **Impl:** own branches

## Changelog

- `/plot-init` on a Bitbucket repository checks the `bb` CLI. Where no `bb` or a `bb` other than Quatico's answers, it proposes `brew install quatico-solutions/tap/quatico-bb` and runs it on the operator's confirmation. It names a `bb` that shadows the Homebrew one on `PATH`, and names `bb auth login` where authentication fails. Unattended, it reports and installs nothing.

<!-- Board impact: none. The probe `plot-detect-repo.sh` gains two fields, the domain's stack rule gains one proposal, and adoption gains one gap line. No plan format, template or docs/plans layout changes. -->

## Motivation

Issue #2533 reports that `/plot-init` records `Git host: bitbucket` and adds a "`bb`, not `gh`" note (`skills/plot-init/SKILL.md:681`), but never checks that a usable `bb` is installed. The gap is still on main at `e15c9d319`: `skills/plot-init/SKILL.md` names `bb` only for the tracker and the hub note. `plot-detect-repo.sh` reports no `bb` reading. `plot-board-probe.sh:387-391` reports `bb.installed` and `bb.auth`, and `/plot-init` step 5 runs that probe for `artifact_source` only (`SKILL.md:837`). On 2026-10-24 the issue measured a hand-written `~/.local/bin/bb` that ran `bb` 1.0.0 from a stale plugin cache, while the Homebrew formula was at 1.12.0. On this machine on 2026-11-23, `bb --version` printed `bb 1.15.1 (quatico-bb — brew install quatico-solutions/tap/quatico-bb)`.

`plot-host.sh` already tells Quatico's `bb` from another one at the first call: `bb_identity_check` (`skills/plot/scripts/plot-host.sh:3113`) refuses a version line with a hex sha in parentheses, the form craftamap/bb prints (`bb version 0.6.0 (abc1234)`). So a wrong `bb` fails today, but at the first host call of a later command, not at adoption. A second operator who follows Plot's documents to an unattended run, for the sprint goal "Plot can take over the software development part of the operator's home automation: a second operator follows Plot's own documents to an unattended run, and that run has a spend cap and a delivery measure", must leave `/plot-init` with a host adapter that runs.

## Design

### Approach

- **The probe collects.** `plot-detect-repo.sh` adds `bb_version_line` (the first line of `command bb --version`, empty where none answers) and `bb_paths` (every `bb` on `PATH`, in order, through `type -ap bb`). It reads them only where `git_host` is `bitbucket`. A version call sends no request.
- **The domain decides.** `proposeBbCli` in `packages/domain/src/rules/stack.ts` returns `{ state: 'quatico', version }`, `{ state: 'absent' }`, `{ state: 'other', line }` or `{ state: 'shadowed', first, others }`, each with the install command where one applies. It follows `proposeNode` (`stack.ts:363`), which already turns a version reading into a proposal. The identity test duplicates `bb_identity_check`; `plot-host.sh` runs it on every host call, so the shell keeps its copy, and `packages/domain/corpus/bb-identity.corpus.test.ts` holds the pair.
- **Adoption reports.** `composeAdoption` (`rules/adoption.ts:479`) adds a gap line for every state but `quatico`, so `plot-adopt.mjs` names the remedy in its output and a test asserts it.
- **The skill acts.** `skills/plot-init/SKILL.md` step 2 shows the reading in the proposal and asks before it runs `brew install quatico-solutions/tap/quatico-bb`. Step 5 reads `bb.auth` from the `plot-board-probe.sh` run it already makes, and names `bb auth login` on `failed`; it never runs a login. Unattended it prints a `PLOT-UNASKED:` line and installs nothing. The Model Guidance table gains the step at the Small tier.
- `plot-deliverable-search.sh "bb identity"` found no domain rule for the `bb` identity; the shell's `bb_identity_check` is the one implementation.

### Open Questions

- [ ] `[question-minimum-version]` Must adoption refuse an old Quatico `bb`? Recommendation: no floor. `plot-host.sh` keeps none, and `BB_LIST_PAGE_VERSIONS` only tunes paging; report the version.
- [ ] `[question-shadow]` A path under `$(brew --prefix)/bin` is the Homebrew one. Recommendation: the probe reads `brew --prefix` only where `brew` is on `PATH`; without `brew`, `shadowed` cannot be told and the reading names every path.
- [ ] `[question-no-brew]` Where `brew` is absent, recommendation: name the formula and the tap, and run nothing.
- [ ] `[question-board-setup]` `/plot-board-setup` reads the same probe. Recommendation: it reuses `proposeBbCli` in a later plan; this plan changes adoption only.

## Slices

### Reading

- `bug/plot-init-reads-which-bb-answers` — `plot-detect-repo.sh` reports `bb_version_line` and `bb_paths` on a Bitbucket repository, `proposeBbCli` turns them into a state, and `composeAdoption` adds the gap line <!-- builds: proposeBbCli, the bb CLI proposal --> <!-- tests: stack.test.ts — `bb 1.15.1 (quatico-bb — …)` and `bb 1.12.0` answer quatico, `bb version 0.6.0 (abc1234)` answers other, an empty line answers absent, two paths with a non-Homebrew first answer shadowed; bb-identity.corpus.test.ts — rule and bb_identity_check agree on each line; adoption.test.ts — an absent bb adds the brew install gap -->

### Skill

- `bug/plot-init-proposes-the-bb-install` <!-- waits: bug/plot-init-reads-which-bb-answers --> — `/plot-init` shows the `bb` reading, runs the install on confirmation, reports `bb.auth`, and installs nothing unattended <!-- builds: the bb step of plot-init's SKILL.md --> <!-- tests: pnpm test parses the skill; a changeset bumps plot-init -->

## Notes

Created on 2026-11-23 from issue #2533, for the sprint plot-describes-itself.
