# The shell shrinks into the domain

> An agent runs a command; the command is a JS entry point over the domain, and shell keeps only launchers.

## Status

- **State:** Released
- **Type:** infra
- **Issue:** #1245
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 3
- **Approved:** 2026-10-03, jwloka, in-session
- **Started:** 2026-10-03, Jan Wloka, `infra/the-shell-is-inventoried`
- **Started:** 2026-10-04, Jan Wloka, `infra/a-command-names-its-action-in-the-domain`
- **Started:** 2026-10-04, Jan Wloka, `infra/the-first-script-becomes-a-command`
- **Delivered:** 2026-10-04
- **Released:** 2026-10-04, v2.23.0

## Changelog

- CI refuses a change that grows the shipped shell code under `skills/`. A pull request and a manual run are compared against their merge base, and a push to `main` against the commit before it. A change may keep or lower the count and never raise it.
- The table in `skills/plot/scripts/README.md` lists every shipped script with its kind, how often it runs and the JS command that replaces it, and a command prints each script's code lines.
- `docs/shell-and-domain.md`, `CLAUDE.md` and the `/plot-implement` brief set the target: a command an agent runs is a JS entry point, a `.sh` file that remains is a launcher, and a change pays for the shell it adds.
- `plot-controller-gate.sh` asks a domain rule which controller action a command runs, so a glob or a file being read no longer reads as an invocation (#1245).
- The first operator command moves from shell to a JS entry — `plot-deliver.sh`, confirmed by the ranking slice 2 ran; its `.sh` file stays as a launcher where a caller names it.

<!-- Board impact: none to the plan format, template or docs/plans layout. Slices that move a script into a JS entry add a bundle under skills/plot/scripts/board/, declared in packages/board/build.mjs and built on main by build-bundles.yml (a-branch-carries-no-built-bundle). -->

## Motivation

Measured on `main` on the morning of 2026-10-03: the 61 tracked `.sh` files under `skills/` held **15,423 non-comment, non-blank lines**. 58 of them sit in `skills/plot/scripts/` and held 15,024 lines and 481 top-level functions (`^[A-Za-z_][A-Za-z0-9_]*\(\)`; 509 when indented definitions count too). By the afternoon, after that day's merges, the counts were 15,499 and 15,100. The `skills/plot/scripts/` count was **6,904 at `91a89d95b`** (the last commit before 2026-09-01) and **11,896 at `6fdc73b36`** (before 2026-09-15): it more than doubled in one month, and it grew 1,737 lines in the three days to 2026-10-03. Of 85 commits on `main` in the 14 days to 2026-10-03 that changed shipped shell code, 76 made it longer. The domain's rules hold 13,235 lines including comments. CI ratchets direct `spawn`/`execFile` sites in TypeScript (`allowed=28`); nothing counts shell.

The growth repeats one shape: a rule is needed, and the nearest place to write it is the shell script already open. On 2026-10-03 a brief told an agent to extract a shell helper for the empty-claim predicate, and PR #1244 added `plot-empty-claim.sh`, a third shell copy of a definition that `branch-state.ts:114`, `quiet.ts:89` and `sweepable.ts:123` each restate in a comment and none computes. The same day `plot-controller-gate.sh` refused `ls skills/plot/scripts/*.sh` as `plot-approve.sh` because its token loop expands globs (#1245), a decision no unit test reaches. It refused two read-only `git grep` commands the same afternoon, one for a `*.sh` pathspec and one for a pathspec naming `plot-dispatch.sh`.

**The division this plan sets:** shell is what an agent runs; domain functions are tooling that runs in JS. A command an agent runs is a JS entry point that goes entry → domain → port → adapter, the layering rule in `CLAUDE.md`. Git and process readings sit behind the adapters that already exist (`refs-git.ts`, the process adapter). A `.sh` file that remains is a launcher: it resolves its bundle and `exec`s it, and decides nothing.

`docs/shell-and-domain.md` (plan `a-shell-script-asks-the-domain`, released) set how a script ASKS the domain: the 39 ms cost rule, where the call goes, how a declared duplicate is held. About half the 58 scripts already start a bundle (25 to 27, depending on the pattern counted), and 34 entries follow the shape *the script collects readings, a bundle decides* (`plot-release-gate.sh` → `board/plot-release-gate.mjs`). Four entries run with no `.sh` file at all: `plot-panel.mjs`, `plot-local-checks.mjs`, `plot-ask.mjs` and `plot-registryd.mjs`. This plan keeps that contract and moves the target one step further: the script does not collect for the bundle; the JS entry reads through adapters itself, and the script becomes its launcher. A collector-plus-bundle pair counts as *readings* in the inventory: its decision has moved, and its readings are the next step.

## Design

### Approach

**This plan stops the growth and sets the target. It moves one script.** The five largest scripts hold 6,930 of the 15,024 lines measured in the morning (46 %): `plot-host.sh` 1,737 (the connector), `plot-dispatch.sh` 1,651, `plot-fleet-scan.sh` 1,412, `plot-reconcile-scan.sh` 1,269 and `plot-worker-loop.sh` 861 (the cost rule's per-pass case). Each of them is a plan of its own. **`plot-worker-loop.sh` comes first**, because the ratchet bites there first: it grew 287 lines in the three days to 2026-10-03, and every open PR that grows the shell edits it. This plan delivers when its four slices merge. The descent is measured by the same count the ratchet reads, and the inventory names the order of the follow-on plans.

**Facts that move go into the briefs, not into this plan.** Line counts, open PRs, sibling lists and `ci.yml` line numbers change every day the plan waits. Three panel rounds found them stale each time. Each slice's brief measures them on the day the slice starts. This plan states the design they are measured against.

**Slice 1, the ratchet, comes first, because a migration with no gate loses to the next brief.** `scripts/check-shell-lines.sh` counts the non-comment, non-blank lines of every tracked `.sh` file under `skills/` (the shipped shell, `ralph-sprint.sh` and `templates/worker-prompt.sh` included). Like `scripts/main-bundles.sh`, it takes the CI event as a mode argument and holds the decision in the script, where a fixture test runs it. It compares the count after the change with the count before, and fails when the first is higher:

| Mode | "Before" is |
|---|---|
| `pr` (a `pull_request`, or a `workflow_dispatch` run on a branch) | `git merge-base HEAD origin/<default>` |
| `push` to `main` | `github.event.before`, so a push of several commits is measured as one range |
| a revert, in either mode | the parent of the commit it reverts, so a rollback restores exactly the count it had |

A revert is recognised by its tree, not its subject: the change's net diff is the exact inverse of one commit on `main`. Under the ruleset, a revert reaches `main` as a pull request, so the revert rule applies in `pr` mode.

**A push to `main` is reported, not refused.** The ruleset lets the Repository admin push past the pull-request rule, and a pushed commit cannot be refused after it lands. The `push` mode fails that run and names the commit and the lines. The next push measures only its own range and passes, so the report is the failing run. A person reads it, and the next pull request offsets the lines. The admin bypass is the one override the repository has. It is a person's act, and the push mode reports every use that grows the shell.

The gate stores no number, so it cannot drift, two pull requests that each shrink the shell never conflict on a baseline line, and no environment variable turns it off. Room a merged change freed is gone for the next one, because the next change's base already holds the lower count. The `validate` job fetches `origin/<default>` the way the `corpus` job does. When the base cannot be read, the gate fails and says so, because a count compared with nothing is not a pass. `--per-file` prints each file's count, for the inventory. The count runs in 0.044 s. `test/reconcile/script-name-gate.test.mjs` is the precedent for a test that refuses slack. A fixture test here proves that growth fails, a net-zero change passes, a shrinking change passes, a growing push range fails, and a revert passes.

**Every change pays for the shell it adds, in the same change.** That is the operator's direction ("instead of widen the gates"), and it has a price: 76 of the last 85 shell-touching commits would each have needed an offset. The offset is a line removed elsewhere, or the new rule written in the domain and asked through a bundle. The price lands first on the fleet's own loop, whose JS form this plan leaves to the loop's own plan. **Slice 1 starts after the open pull requests that grow the shell have merged.** On 2026-10-03 those were #1257 (+118), #1251 (+20), #1256 (+17) and #1252 (+5), and slice 1's branch line names their branches as waits. Until `a-slice-waits-on-every-branch-it-names` lands, the parser keeps only the last `waits:` on a line, so the brief rechecks all four at dispatch.

**Slice 1 tells the work already approved.** Every Approved plan whose slices write shell gets a Notes line naming the gate and the offset rule. The brief lists those plans on the day slice 1 starts; on 2026-10-03 there were six. Slice 1 also adds one paragraph to `/plot-implement`'s brief template, under the repo gates, so every brief written after it names the gate. The gate's failure message states the offset rule too, because an agent reads the CI failure before it reads a plan.

**The cost rule's duplicate row now has a price.** `docs/shell-and-domain.md` §1 tells a per-agent-per-pass call site to duplicate a rule in shell, and §2 allows a quoted heredoc seam. Both remain allowed, and both count. A new declared duplicate removes an equal number of lines elsewhere in the same change. Slice 2 writes that sentence into §1.

**Slice 2, the inventory, orders the rest.** It extends the table that already lists the scripts, `skills/plot/scripts/README.md`, which `scripts/check-helper-table.sh` gates. It first adds rows for the 13 scripts the table lacks, `plot-worker-loop.sh` among them, so that `check-helper-table.sh`'s baseline falls by 13. It then adds three columns: *kind* (*launcher*, *readings*, *decision*, *orchestration*), *runs* (once per operator command, once per agent per pass, as a hook on every tool call), and *replaced by* (the JS entry, or empty). **A script with several callers takes the most frequent caller's *runs* value**, because that caller sets its cost: `plot-fleetctl.sh` runs from `/plot-fleet` and also on every board refresh (`supervisor-reading.ts:53`), so it runs per refresh. Code lines are not stored in the table, because they go stale at the rate the shell grows; `check-shell-lines.sh --per-file` prints them. **The ranking is a command:** scripts whose *runs* is "once per operator command", excluding the five largest named above, sorted by `--per-file` lines, largest first. By that rule on 2026-10-03 the first is `plot-deliver.sh` (601 lines). `/plot-deliver`, the board's deliver endpoint and `auto-deliver.ts` call it. The last rides the scan's clock but starts the script only when a plan becomes deliverable, so every caller runs it once per plan delivered. Slice 2 confirms or replaces that candidate, and amends this plan to name the result in slice 4's branch line and Changelog line before slice 4 starts. It also amends `docs/shell-and-domain.md` and the `A Shell Script Asks The Domain` section of `CLAUDE.md` to state the target and the duplicate's price, and drops "the artifact is committed" from §2, since `a-branch-carries-no-built-bundle` has started building bundles on `main`.

**Slice 3 answers #1245 in the domain, on a rule that exists.** `rules/ci-suite.ts` already tells a command that RUNS a script from one that mentions it: `withoutQuotes` empties quoted spans, `programWords` strips `NAME=value` and `env` prefixes, and `ciSuiteRefusal` splits simple commands on `&&`, `||`, `;`, `|` and newlines. The hook already asks it through `board/plot-local-checks.mjs`. `rules/start-command.ts`'s `loopWord` is a third matcher for "does this command run script N", and the slice folds it onto the same reading. `controllerInvocation(command)` is built on those functions and answers `dispatch`, `approve`, `deliver` or none. It also strips single-quoted heredoc bodies, tells a script RUN from a script READ, and keeps the mode split (`--status`, `--dry-run` and the others read). A word that is a glob is matched against the three basenames as a pattern, so `bash skills/plot/scripts/*dispatch.sh` still reads as `dispatch`, as the token loop's expansion reads it today. No exemption list is added.

**Slice 3 starts `node` only for a word that could name a gated script.** The hook runs on every Bash call of every session, fleet agents included, and today costs 17–21 ms. A bundle start adds 22–61 ms, depending on the bundle's size. The order is:

1. **A per-word prefilter, in shell, with no `node` start.** It runs with pathname expansion off. A command passes only if one of its words contains `plot-dispatch`, `plot-approve` or `plot-deliver`, or ends in `.sh` and holds a glob character (`*`, `?` or `[`). Everything else exits as allowed, which is exactly what today's gate does with a command whose expanded words name no gated script. That test only skips work and decides nothing. A whole-command test let 31 % of 32,352 logged Bash calls through; a per-word test of the same kind measured 8.7 %. The slice records the rate of the test it ships.
2. **The desk exemption.** It runs after the prefilter, so its three `git rev-parse` calls (15–16 ms) are paid only by the commands that passed. Today it runs after the `node` start (`:188`) and the script-name loop (`:209`), at `:270`; the slice moves it ahead of the rule.
3. **The rule**, in a bundle of its own rather than in `plot-local-checks.mjs`, which costs 55–61 ms to start.
4. **The receipt**, which needs the action the rule returns, so it comes last.

**When a command reaches the rule and the rule cannot be asked, the gate refuses that command.** The gate's header says *fail-open on its own machinery, closed on the case it exists for* (`:61-67`). A command that passed the prefilter is the case it exists for, so a missing bundle refuses only those commands. The message names the missing file and gives both remedies: update the plugin in an adopting repository, or run `pnpm build:board` in the plot repository. Slice 4's launcher uses the same message.

**#1245 reaches a session only with a release.** Hooks run from the installed plugin (`cache/plot-marketplace/plot/<version>`), not from the checkout, so slice 3 changes behaviour at the next release and a plugin update. The release carries the new bundle because the bundle is declared in `build.mjs`'s `shipped*` set, which `scripts/main-bundles.sh` reads in `release` mode before a tag. The three commit hooks (`plot-phase-gate.sh`, `plot-state-gate.sh`, `plot-brief-name-gate.sh`) are not part of #1245. Each exits before its token loop on every command the issue lists, because each reads only commands that contain `git commit`. `plot-state-gate.sh` expands globs on purpose, to count every file a glob could cover (`:74-77`), so this plan leaves all three as they are.

**Slice 4 moves the first whole script.** The script slice 2 names becomes a JS entry under `packages/board/src/server/entry/`, declared in `build.mjs` and bundled to `skills/plot/scripts/board/`. Its decisions move into `packages/domain/src/rules/` with unit tests; its git and process calls go through adapters. A launcher stays only where a caller names the `.sh` path: a skill, a hook, a test or another script. The four bundles that agents already run directly show that a command with no such caller needs none. Where a launcher stays, it keeps the name and arguments, and it follows `plot-release-gate.sh:30-33`: when the bundle is absent, it exits 2 with slice 3's message. On `main`, the launcher lands one `build-bundles` run before its bundle, measured at 22–36 s over four runs, and in that window the command refuses with that message rather than running a stale copy. A rollback of slice 4 is a revert, which the ratchet measures against the reverted commit's parent.

**What does not change.** The cost rule stays: a call site that runs once per agent per pass and cannot yet become JS keeps its declared duplicate and its corpus test, and pays for its lines. Hooks registered by `hooks/hooks.json` keep their file names, because adopting repositories register them by path. No published script name disappears while a caller still names it.

**What the count does not measure.** A line count measures size, not where decisions live. A rule moved into a `node -e` heredoc inside a script lowers nothing. A decision kept in a shorter shell function passes, and so do lines joined with `;`. The ratchet guards the direction; the inventory's *kind* column records where decisions still sit, and a reviewer reads that column, not the count, to judge a migration.

### Open Questions

- [ ] `plot-worker-loop.sh` runs per agent per pass and is the cost rule's named duplicate case. Does its plan, the first follow-on, make it a long-running JS process, which removes the per-pass `node` start entirely? This plan does not decide it; the inventory measures its call sites.
- [ ] `scripts/*.sh` (CI and local-check tooling, 1,449 lines, not shipped) is outside the count. Slice 1 prints its size so the question can be answered with a number.

## Slices

### The shell cannot grow

- `infra/the-shell-cannot-grow` <!-- waits: bug/a-pr-carries-no-bundle --> <!-- waits: bug/a-refused-slice-is-held --> <!-- waits: bug/a-continued-loop-carries-its-manifest --> <!-- waits: bug/a-hand-over-is-checked-before-it-is-made --> — `scripts/check-shell-lines.sh`: CI refuses a pull request above its merge base and reports a push range above its start; the Approved siblings that write shell and the brief template name the gate → #1264 <!-- builds: check-shell-lines.sh, a shell code ratchet with no stored number -->

### The shell is inventoried

- `infra/the-shell-is-inventoried` — the README script table lists all 58 scripts with kind, runs and replaced-by columns; `docs/shell-and-domain.md` and `CLAUDE.md` state the target; this plan names slice 4's script → #1266 <!-- builds: kind, runs and replaced-by columns in skills/plot/scripts/README.md -->

### A command names its action in the domain

- `infra/a-command-names-its-action-in-the-domain` — `controllerInvocation(command)` on `rules/ci-suite.ts`, in its own bundle; `plot-controller-gate.sh` asks it after a per-word prefilter and the desk exemption, and refuses a command it cannot check (#1245) → #1268 <!-- builds: controllerInvocation, a domain rule -->

### The first script becomes a command

- `infra/the-first-script-becomes-a-command` — `plot-deliver.sh` (601 lines), the ranking's confirmed first operator-command script, becomes a JS entry; a launcher stays only where a caller names its `.sh` path → #1270 <!-- builds: a JS command entry for the first-ranked operator command -->

## Notes

- 2026-10-03, direction from jwloka: "we should reduce shell use systematically and grow the domain", "instead of widen the gates", "Shell is run by agents, domain-level functions is tooling run in js".
- 2026-10-03, measurement: code lines counted with `git ls-files 'skills/plot/scripts/*.sh' | xargs cat | grep -vE '^\s*(#|$)' | wc -l`, and over `git ls-tree` at `91a89d95b` and `6fdc73b36`. Hook cost measured warm at load 6.9 on 16 cores: four PreToolUse hooks 65–70 ms per Bash call, `node` plus a small bundle 22–30 ms, a 528 KB bundle about 52–61 ms. Prefilter rates from 32,352 logged Bash calls: 31.0 % for a whole-command test, 8.7 % for a per-word test.
- 2026-10-03, PR #1244 (merged as `8d95b21d4`) landed the empty-claim predicate as `rules/empty-claim.ts` and the bundle `board/plot-empty-claim.mjs` rather than `plot-empty-claim.sh`. `plot-worker-loop.sh` asks it in `yield_the_held_checkout`, which runs once per take-up and never per idle pass, so the bundle call is within the cost rule.

## Open Points

Panel rounds 1–3, 2026-10-03, each unanimous `amend` (estate, contradiction, deliverable, cost). The moderations are at `.plot/panels/2026-10-03-the-shell-shrinks-into-the-domain/round1.md`, `round2.md` and `round3.md`.

- [x] [Technical] Rounds 1–2, slice 3: prefilter, failure direction, `rules/ci-suite.ts`, glob words. — *answered; round 3 made the prefilter per word with expansion off, set the hook order (prefilter, desk exemption, rule, receipt), and gave both missing-bundle messages one text*
- [x] [Trade-off] Rounds 1–2: in-flight growth, merge base, duplicates, push and revert. — *answered; round 3 added the `workflow_dispatch` mode, `before..after` for a push, the revert rule in `pr` mode, the four waits, and named the admin bypass as the one override*
- [x] [Domain] Rounds 1–2: inventory in the README table, slice 4's script, delivery at the last slice. — *answered; round 3 added the several-callers rule and the candidate `plot-deliver.sh`*
- [x] [Domain] Round 3, shared: moving facts went stale between rounds. — *answered: counts, open PRs and sibling lists are measured in each slice's brief on the day it starts*
