## Implementation brief — the-release-pr-needs-a-person (wave 2: Release guard)

- **Plan (canonical):** docs/plans/2026-11-03-the-release-pr-needs-a-person.md on main
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3070 merged
- **Branch:** `feature/the-release-head-is-the-version-step` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** PR review per repo convention (`plot/review` is required on main)

Wave 2 of 2. Wave 1 (`feature/the-release-review-is-switched-on`, PR #3175) is merged. The sibling in this wave, `feature/the-release-checks-are-counted` (ref pushed, no PR yet at brief time), owns `checks-missing` and edits the same two domain files. The two branches have no ordering between them.

### What to build

`Auto-review: true` is now set, so fleetd starts the release review with no person. That makes the release head's content an unattended input: `changeset-release/main` is an unprotected branch, and a foreign commit on it would be reviewed and merged by the same path as the changesets version step. The plan decided a provenance check, with no ruleset or branch-protection change.

Build one domain rule, *the release head changes only what the changesets version step writes*, and make three callers read it:

1. `releaseApprove` (`packages/domain/src/workflows/release-approve.ts`) refuses a new reason, `release-head-foreign`, before it calls `mergeAt`. Add it to `ReleaseApproveRefusal`. The detail text names the first foreign path and the pinned head, as the sibling refusals do.
2. The release review start (`releasePrepareNext`, `packages/domain/src/rules/release-prepare.ts`) holds on a foreign head, so fleetd starts no unattended review on it.
3. `releaseStage` shows the hold `release-head-foreign` on the board's release row. The row's shape is unchanged. Read the stage and hold types in `release-prepare.ts` and the board's release-row reader before you pick where the hold lives.

The rule reads the head's changes from its merge base with `origin/main`: `origin/main...<head>`. A two-dot diff lists main's newer commits as the head's changes, and every release head sits behind main by the time a person looks at it. The allowed set, verified against release commits `14d28a097` (2.30.0, 96 files) and `fbe76191e` (2.29.x):

| Path | Allowed change |
|---|---|
| `.changeset/*.md` | deletion only (`config.json`, `README.md`, `changelog-functions.js` and `_template` stay untouched) |
| `CHANGELOG.md`, `packages/*/CHANGELOG.md` | any |
| `package.json`, `packages/*/package.json` | the `"version"` line only |
| `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | the `"version"` line only |
| `skills/*/SKILL.md` | the frontmatter `metadata.version` line only |

Anything else refuses `release-head-foreign`, naming the first foreign path. The plan is canonical; this is orientation.

### Settled decisions — do not re-derive

- **`Refs.changedFiles` is not enough, and a path list cannot decide.** It returns paths (`ports/refs.ts`, `refs-git.ts:504` runs `git diff --name-only`). Four of the five table rows allow a change to one line of a file, so the rule needs the changed lines, not the names. Add a narrow reading to the `Refs` port (a line-level diff of `origin/main...<sha>`), or compare the blobs at both revisions through the existing `listBlobs`/`readBlobs` pair, and pick one in the PR description. Whichever you pick, the rule itself takes the reading as a value and awaits nothing, as the rest of the domain does; the adapter is the only place that reaches git.
- **Read at the pinned sha, never at the branch name.** `changedFiles(branch)` takes a branch name, and `changeset-release/main` is force-pushed. A rule that asks the branch name can pass one commit and merge another. `releaseApprove` is already pinned to `input.sha` and refuses `head-moved`; the diff reads that sha.
- **Absent is not passing.** A diff read that failed, or a head the checkout does not hold, answers `unaskable` and refuses. It never answers "nothing foreign". An empty diff is a reading too: say what it means for a release head (no version step ran) and test it.
- **The review start and the approval read the same rule.** Do not write a second copy for `releaseTick`. The plan's test pair holds this: the foreign head holds the review start and the stage, and the approval refuses.
- **GitHub only.** A Bitbucket or Jenkins repository answers `unaskable` for the new reading and `release-approve` keeps its current behaviour there (plan, Scope). The release workflows have no arm on those hosts.
- **Do not change branch protection or the ruleset.** Decision 3 refuses it.
- **Facts are measured, not guessed.** Cite the plan's figures in the commit message (`14d28a097`, `fbe76191e`); do not re-measure. Release PR #3080 (2.31.0, `changeset-release/main`) is open now: read its diff as a live fixture for the control, and write no host state to it.
- **Rules carried over:** absent is not false; read the exit code and not the emptiness; a refusal ends the action and no caller retries with the pin dropped.

### Done when

The plan's `## Design` tests for the provenance slice are the specification. Each fails before the change and passes after, except the control:

- `packages/domain/test/workflows-release-approve.test.ts`: "a head that changes .github/workflows/ci.yml refuses release-head-foreign"; "a head that changes a SKILL.md body line refuses release-head-foreign"; "a head that changes a package.json dependency refuses release-head-foreign". All three pass today. Control: "a head holding only the version step's changes passes".
- `packages/domain/test/release-prepare.test.ts`: "a foreign release head holds the review start and the stage". The review starts today.

Lift these because a naive implementation passes without them:

- A `package.json` whose dependency line changes beside the version line. A rule that allows the whole file passes the three tests above and ships a dependency swap. The fixture must change both lines and expect the refusal.
- A `.changeset/*.md` file added, not deleted, and `.changeset/config.json` deleted. A rule that allows the directory passes both and fails the table.
- A head diffed two-dot. Give the fixture a main that moved after the release head was cut; a two-dot rule refuses a clean head.
- The review-start test must use a head whose `CI` run succeeded, so the hold is the provenance hold and not `checks-pending`.

Plus: a changeset for `plot` with the description first and the `bumps:` block last (`./scripts/check-changeset-packages.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. If the slice touches a `.sh` file, `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base: pay for growth in the same change, by removing shell elsewhere or by writing the rule in the domain and asking it through a bundle. The gate counts commands, not lines, and has no override. A change to `plot-host.sh` also brings the contract tests and `scripts/check-host-cli-callers.sh`. A new `Refs` op needs the adapter test and the purity gate (`packages/domain/src/` outside `adapters/` imports `zod` and nothing else).

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`). When it exists, append `→ #<number>` to this branch's line under `## Slices` in the plan. Push the first real commit as soon as it exists. The functions you write are arrows. A TSDoc block states what an export does, takes, returns and how it fails; the reasoning goes in the commit message.

### Scope guard

Owns: the provenance rule (a new file under `packages/domain/src/rules/`), `packages/domain/src/workflows/release-approve.ts` (the new refusal only), `packages/domain/src/rules/release-prepare.ts` (the review-start hold and the stage hold only), the `Refs` port and adapter if you add the diff reading, the board's release-row reader if it needs the hold, their tests, and one changeset.

The sibling `feature/the-release-checks-are-counted` edits `release-approve.ts` and `releaseStage`. Keep each edit to your own refusal and your own hold so a rebase onto the sibling is a small conflict. Do not add `checks-missing` here. Do not touch `release-tick.ts`, `registryd-main.ts`, `CLAUDE.md` or `AGENTS.md`: wave 1 owned them and it is merged. Do not edit `.github/workflows/ci.yml` or `release.yml`: plan #3076 owns them.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
