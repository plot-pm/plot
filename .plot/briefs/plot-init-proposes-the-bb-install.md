## Implementation brief — plot-init-checks-for-the-bb-cli (wave 2: Skill)

- **Plan (canonical):** `docs/plans/2026-11-23-plot-init-checks-for-the-bb-cli.md` on `main`
- **Approved:** 2026-11-24, jwloka, plan-PR #3699 merged
- **Branch:** `bug/plot-init-proposes-the-bb-install` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (`Review: pr`)

This branch waits on `bug/plot-init-reads-which-bb-answers` (wave 1, merged as #3711). Nothing waits on this branch.

### What to build

Issue #2533: `/plot-init` on a Bitbucket repository records `Git host: bitbucket` and adds the "`bb`, not `gh`" note, but never checks that a usable `bb` is installed. A wrong `bb` fails only at the first host call of a later command (`bb_identity_check`, `plot-host.sh`), not at adoption. Measured 2026-10-24: a hand-written `~/.local/bin/bb` ran `bb` 1.0.0 from a stale plugin cache while the Homebrew formula stood at 1.12.0.

Wave 1 already landed the reading and the decision. `plot-detect-repo.sh` reports `bb_version_line`, `bb_paths` and `bb_brew_prefix`. `proposeBbCli` (`packages/domain/src/rules/stack.ts:742`) returns a `BbCliProposal` with state `quatico`, `absent`, `other` or `shadowed`, with `install` and `brew` on `absent` and `other`. `proposeStack` carries it as `bbCli` (`null` where the repository is not on Bitbucket). `composeAdoption` already adds the gap line through `bbCliGap` (`rules/adoption.ts:420`). This branch changes only `skills/plot-init/SKILL.md` (plus its changeset and README if the README describes the steps):

- **Step 2** shows the `bbCli` reading in the proposal block and acts on the state. Read it from the `plot-propose-stack.mjs` answer the step already uses; do not re-derive the state in prose.
  - `quatico`: one line with the version. Ask nothing.
  - `absent` or `other` with `brew: true`: show the reading (`line` for `other`) and ask before running `brew install quatico-solutions/tap/quatico-bb`. Run `install` exactly as the proposal carries it. Never run it without a yes.
  - `absent` or `other` with `brew: false`: name the formula and the tap, run nothing (`[question-no-brew]`).
  - `shadowed`: name `first` and `others`, run nothing. An install does not fix a shadow; the operator reorders `PATH`.
- **Step 5** reads `bb.auth` from the `plot-board-probe.sh` run it already makes for `artifact_source`, and on `failed` names `bb auth login`. It never runs a login: a login opens a browser tab for the operator, and `/plot-init` has no business spending one.
- **Unattended** (`PLOT_UNATTENDED=1`): print a `PLOT-UNASKED:` line in the format of the existing ones (`SKILL.md:202`, `:244`, `:341`) and install nothing. The step-2 install question and nothing else is the skipped question.
- **Model Guidance** table gains the step at the **Small** tier. Reading `bbCli` is transcription; the decision is `proposeBbCli`'s.

### Settled decisions — do not re-derive

- **The skill never decides the state.** A prose rule such as "the first line has a hex sha in parentheses" would be a third copy of `bb_identity_check` and `bbLineIsOther`, and `corpus/bb-identity.corpus.test.ts` holds only two. The skill reads `state` and branches on it.
- **No minimum version** (`[question-minimum-version]`). `plot-host.sh` keeps none and `BB_LIST_PAGE_VERSIONS` only tunes paging. Report the version; refuse nothing. A version floor here would refuse a `bb` that every later host call accepts.
- **`bb --version` sends no request**, so probing it needs no credential and no network. `bb.auth` is the only authentication reading, and it comes from the board probe, not from a second `bb` call in this skill.
- **`bbCli` is `null` off Bitbucket.** On a GitHub repository the step shows nothing and asks nothing. Test that sentence against the skill text: a GitHub run must not mention `bb`.
- **`/plot-board-setup` is out of scope** (`[question-board-setup]`). It reuses `proposeBbCli` in a later plan; do not touch `skills/plot-board-setup/`.
- **Carried invariants:** absent is not false — an empty `bb_version_line` means "no `bb` answered", and `bbCli: null` means "not asked"; the two are different answers. Read exit codes, not emptiness, wherever the skill shells out.

### Done when

The plan's `## Done when` is its Slices entry for this branch: `/plot-init` shows the `bb` reading, runs the install on confirmation, reports `bb.auth`, and installs nothing unattended; `pnpm test` parses the skill; a changeset bumps `plot-init`.

Assertions a naive edit passes without:

- Every state has its own sentence in step 2, and only `absent`/`other` with `brew: true` carries a command to run. Catches a skill that offers the install on `shadowed`, where it does nothing.
- The unattended path names `PLOT-UNASKED` and states that nothing installs. Catches a skill whose unattended run blocks on a question or installs silently.
- Step 5 says `bb auth login` is named and not run. Catches a skill that runs the login.
- The Model Guidance row exists. `pnpm test` does not fail without it; a reviewer does.

Plus: write the changeset with the description first and the `bumps:` block last (`plot-init: minor`, package `plot`), and run `./scripts/check-changeset-packages.sh`. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI and a failure there comes back as a correction. List no full suite. The branch changes no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count; if you find yourself editing one, growth is paid for in the same change. Do not commit a rebuilt board bundle.

### Bookkeeping

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot-init/SKILL.md`, its README where it lists steps, and one changeset. Wave 1 (`bug/plot-init-reads-which-bb-answers`, #3711) owns `plot-detect-repo.sh`, `rules/stack.ts` and `rules/adoption.ts`; it is merged, so no collision is expected. If the reading the skill needs is missing from `proposeStack`'s output, report it rather than editing the rule here.
