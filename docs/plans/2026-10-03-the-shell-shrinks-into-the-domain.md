# The shell shrinks into the domain

> An agent runs a command; the command is a JS entry point over the domain, and shell keeps only launchers.

## Status

- **State:** Draft
- **Type:** infra
- **Issue:** #1245
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 2

## Changelog

- CI refuses a change that grows the shipped shell code under `skills/`: a pull request against its merge base, and a push to `main` against its parent. A change may keep or lower the count and never raise it.
- The table in `skills/plot/scripts/README.md` lists every shipped script with its kind, how often it runs and the JS command that replaces it, and a command prints each script's code lines.
- `docs/shell-and-domain.md`, `CLAUDE.md` and the `/plot-implement` brief set the target: a command an agent runs is a JS entry point, a `.sh` file that remains is a launcher, and a change pays for the shell it adds.
- `plot-controller-gate.sh` asks a domain rule which controller action a command runs, so a glob or a file being read no longer reads as an invocation (#1245).
- The first operator command moves from shell to a JS entry; its `.sh` file stays as a launcher.

<!-- Board impact: none to the plan format, template or docs/plans layout. Slices that move a script into a JS entry add a bundle under skills/plot/scripts/board/, built by pnpm build:board, under whichever bundle regime main holds when the slice starts (see a-branch-carries-no-built-bundle). -->

## Motivation

Measured 2026-10-03 on `main`: the 61 tracked `.sh` files under `skills/` hold **15,423 non-comment, non-blank lines**. 58 of them sit in `skills/plot/scripts/` and hold 15,024 lines and 481 top-level functions (`^[A-Za-z_][A-Za-z0-9_]*\(\)`; 509 when indented definitions count too). The same `skills/plot/scripts/` count was **6,904 at `91a89d95b`** (the last commit before 2026-09-01) and **11,896 at `6fdc73b36`** (before 2026-09-15): it more than doubled in one month, and it grew 1,737 lines in the three days to 2026-10-03. Of 85 commits on `main` in the 14 days to 2026-10-03 that changed shipped shell code, 76 made it longer. The domain's rules hold 13,235 lines including comments. CI ratchets direct `spawn`/`execFile` sites in TypeScript (`allowed=28`); nothing counts shell.

The growth repeats one shape: a rule is needed, and the nearest place to write it is the shell script already open. On 2026-10-03 a brief told an agent to extract a shell helper for the empty-claim predicate, and PR #1244 added `plot-empty-claim.sh`, a third shell copy of a definition that `branch-state.ts:114`, `quiet.ts:89` and `sweepable.ts:123` each restate in a comment and none computes. The same day `plot-controller-gate.sh` refused `ls skills/plot/scripts/*.sh` as `plot-approve.sh` because its token loop expands globs (#1245), a decision no unit test reaches.

**The division this plan sets:** shell is what an agent runs; domain functions are tooling that runs in JS. A command an agent runs is a JS entry point that goes entry → domain → port → adapter, the layering rule in `CLAUDE.md`. Git and process readings sit behind the adapters that already exist (`refs-git.ts`, the process adapter). A `.sh` file that remains is a launcher: it resolves its bundle and `exec`s it, and decides nothing.

`docs/shell-and-domain.md` (plan `a-shell-script-asks-the-domain`, released) set how a script ASKS the domain: the 39 ms cost rule, where the call goes, how a declared duplicate is held. About half the 58 scripts already start a bundle (25 to 27, depending on the pattern counted), and 34 entries follow the shape *the script collects readings, a bundle decides* (`plot-release-gate.sh` → `board/plot-release-gate.mjs`). Four entries run with no `.sh` file at all: `plot-panel.mjs`, `plot-local-checks.mjs`, `plot-ask.mjs` and `plot-registryd.mjs`. This plan keeps that contract and moves the target one step further: the script does not collect for the bundle; the JS entry reads through adapters itself, and the script becomes its launcher. A collector-plus-bundle pair counts as *readings* in the inventory: its decision has moved, and its readings are the next step.

## Design

### Approach

**This plan stops the growth and sets the target. It moves one script.** The five largest scripts hold 6,930 of the 15,024 lines (46 %): `plot-host.sh` 1,737 (the connector), `plot-dispatch.sh` 1,651, `plot-fleet-scan.sh` 1,412, `plot-reconcile-scan.sh` 1,269 and `plot-worker-loop.sh` 861 (the cost rule's per-pass case). Each of them is a plan of its own. **`plot-worker-loop.sh` comes first**, because the ratchet bites there first: it grew 287 lines in the three days to 2026-10-03, and five Approved siblings edit it. This plan delivers when its four slices merge. The descent is measured by the same count the ratchet reads, and the inventory names the order of the follow-on plans.

**Slice 1, the ratchet, comes first, because a migration with no gate loses to the next brief.** `scripts/check-shell-lines.sh` counts the non-comment, non-blank lines of every tracked `.sh` file under `skills/` (the shipped shell, `ralph-sprint.sh` and `templates/worker-prompt.sh` included). It compares two counts and fails when the first is higher:

| Event | Compared against |
|---|---|
| pull request | `git merge-base HEAD origin/<default>` |
| push to `main` | `HEAD^1`, the first parent |
| a revert of one commit on `main` | that commit's parent, so a rollback restores exactly the count it had |

The push row exists because a direct push to `main` passes branch protection as an admin, and a merge-base comparison on `main` compares `HEAD` with itself. A growing push cannot be refused after it lands, so CI fails that run and names the commit and the lines, which makes `main` red until a change offsets them. A revert is recognised by its tree, not its subject: the change's diff is the exact inverse of one commit on `main`. The gate stores no number, so it cannot drift, two pull requests that each shrink the shell never conflict on a baseline line, and no environment variable turns it off. Room a merged change freed is gone for the next one, because the next change's base already holds the lower count. The `validate` job fetches `origin/<default>` the way the `corpus` job does (`ci.yml:86-90`). When the base cannot be read, the gate fails and says so, because a count compared with nothing is not a pass. `--per-file` prints each file's count, for the inventory. The count runs in 0.044 s. `test/reconcile/script-name-gate.test.mjs` is the precedent for a test that refuses slack; a fixture test here proves that growth fails, a net-zero change passes, a shrinking change passes, a growing push fails, and a revert passes.

**Every change pays for the shell it adds, in the same change, and the gate has no override.** That is the operator's direction ("instead of widen the gates"), and it has a price: 76 of the last 85 shell-touching commits would each have needed an offset. The offset is a line removed elsewhere, or the new rule written in the domain and asked through a bundle. The price lands first on the fleet's own loop, which the five Approved siblings below edit and whose JS form this plan leaves to the loop's own plan. Slice 1 waits on #1234 (`bug/the-monitor-follows-the-hop`, +37 lines), so that bug fix is not refused in flight. #1244 nets 0 lines and needs no wait.

**Slice 1 tells the work already approved.** Seven Approved siblings write shell: `every-desk-state-has-an-exit`, `a-desk-and-its-manifest-name-each-other`, `the-queue-reads-the-order-the-scan-reads`, `a-slice-waits-on-every-branch-it-names`, `an-assignment-is-read-where-it-is-recorded`, `a-scan-says-where-its-time-goes` and `a-branch-carries-no-built-bundle` (which adds a fifth hook). Slice 1 adds a Notes line to each, naming the gate and the offset rule. It also adds one paragraph to `/plot-implement`'s brief template, under the repo gates, so every brief written after it names the gate. The gate's failure message states the offset rule too, because an agent reads the CI failure before it reads a plan.

**The cost rule's duplicate row now has a price.** `docs/shell-and-domain.md` §1 tells a per-agent-per-pass call site to duplicate a rule in shell, and §2 allows a quoted heredoc seam. Both remain allowed, and both count. A new declared duplicate removes an equal number of lines elsewhere in the same change. Slice 2 writes that sentence into §1.

**Slice 2, the inventory, orders the rest.** It extends the table that already lists the scripts, `skills/plot/scripts/README.md`, which `scripts/check-helper-table.sh` gates. It first adds rows for the 13 scripts the table lacks, `plot-worker-loop.sh` among them, so that `check-helper-table.sh`'s baseline falls by 13. It then adds three columns: *kind* (*launcher*, *readings*, *decision*, *orchestration*), *runs* (once per operator command, once per agent per pass, as a hook on every tool call), and *replaced by* (the JS entry, or empty). Code lines are not stored in the table, because they go stale at the rate the shell grows; `check-shell-lines.sh --per-file` prints them. **The ranking is a command:** scripts whose *runs* is "once per operator command", excluding the five largest named above, sorted by `--per-file` lines, largest first. The slice amends this plan to name the first-ranked script in slice 4's branch line and Changelog line before slice 4 starts. It also amends `docs/shell-and-domain.md` and the `A Shell Script Asks The Domain` section of `CLAUDE.md` to state the target and the duplicate's price, and drops "the artifact is committed" from §2 if `a-branch-carries-no-built-bundle` has landed.

**Slice 3 answers #1245 in the domain, on a rule that exists.** `rules/ci-suite.ts` already tells a command that RUNS a script from one that mentions it: `withoutQuotes` empties quoted spans, `programWords` strips `NAME=value` and `env` prefixes, and `ciSuiteRefusal` splits simple commands on `&&`, `||`, `;`, `|` and newlines. The hook already asks it through `board/plot-local-checks.mjs`. `rules/start-command.ts`'s `loopWord` is a third matcher for "does this command run script N", and the slice folds it onto the same reading. `controllerInvocation(command)` is built on those functions and answers `dispatch`, `approve`, `deliver` or none. It also strips single-quoted heredoc bodies, tells a script RUN from a script READ, and keeps the mode split (`--status`, `--dry-run` and the others read). A word that is a glob is matched against the three basenames as a pattern, so `bash …/plot-disp*.sh` still reads as `dispatch`, exactly as the token loop's expansion reads it today. The gate stays exactly as strict; no exemption list is added. Design: the comment on #1245.

**Slice 3 starts `node` only where today's gate would have to decide.** The hook runs on every Bash call of every session, fleet agents included, and today costs 17–21 ms. A bundle start adds 22–61 ms, depending on the bundle's size. So the hook keeps its order: the desk exemption and the receipt come first, as they do now. Then a `case` test on the raw command text runs, and only a command that contains `plot-dispatch`, `plot-approve` or `plot-deliver`, or contains `plot-` together with a glob character, reaches the rule. That test only skips work and decides nothing; measured over 36,960 Bash calls, it keeps 95 % at today's cost. `controllerInvocation` ships in a bundle of its own rather than in `plot-local-checks.mjs`, which costs 55–61 ms to start. **When a command reaches the rule and the rule cannot be asked, the gate refuses that command.** The gate's header says *fail-open on its own machinery, closed on the case it exists for* (`:61-67`). A command that names a gated script is the case it exists for, so a missing bundle refuses only those commands. The message names the missing file and says to update the plugin, which is the remedy in an adopting repository. The slice records the measured cost of both paths.

**#1245 reaches a session only with a release.** Hooks run from the installed plugin (`cache/plot-marketplace/plot/<version>`), not from the checkout, so slice 3 changes behaviour at the next release and a plugin update. The release carries the new bundle, which `release.yml` already builds; a release without it would refuse every gated command in every adopting repository, and the bundle-resolution gate (`scripts/check-bundle-resolution.sh`) holds that. The three commit hooks (`plot-phase-gate.sh`, `plot-state-gate.sh`, `plot-brief-name-gate.sh`) are not part of #1245: each exits before its token loop on every command the issue lists, because each reads only commands that contain `git commit`. `plot-state-gate.sh` relies on glob expansion on purpose, to count every file a glob could cover (`:74-77`), so this plan leaves all three as they are.

**Slice 4 moves the first whole script.** The script slice 2 names becomes a JS entry under `packages/board/src/server/entry/`, bundled to `skills/plot/scripts/board/`. Its decisions move into `packages/domain/src/rules/` with unit tests; its git and process calls go through adapters. A launcher stays only where a caller names the `.sh` path: a skill, a hook, a test or another script. The four bundles that agents already run directly show that a command with no such caller needs none. Where a launcher stays, it keeps the name and arguments, and it follows `plot-release-gate.sh:30-33`: when the bundle is absent it exits 2 and names the build command. Under `a-branch-carries-no-built-bundle`, `main` holds the launcher about 3–5 minutes before it holds the bundle, and in that window the command refuses with that message rather than running a stale copy. A rollback of slice 4 is a revert, which the ratchet measures against the reverted commit's parent.

**What does not change.** The cost rule stays: a call site that runs once per agent per pass and cannot yet become JS keeps its declared duplicate and its corpus test, and pays for its lines. Hooks registered by `hooks/hooks.json` keep their file names, because adopting repositories register them by path. No published script name disappears while a caller still names it.

**What the count does not measure.** A line count measures size, not where decisions live. A rule moved into a `node -e` heredoc inside a script lowers nothing, and a decision kept in a shorter shell function passes. The ratchet guards the direction; the inventory's *kind* column records where decisions still sit, and a reviewer reads that column, not the count, to judge a migration.

### Open Questions

- [ ] `plot-worker-loop.sh` runs per agent per pass and is the cost rule's named duplicate case. Does its plan, the first follow-on, make it a long-running JS process, which removes the per-pass `node` start entirely? This plan does not decide it; the inventory measures its call sites.
- [ ] `scripts/*.sh` (CI and local-check tooling, 1,449 lines, not shipped) is outside the count. Slice 1 prints its size so the question can be answered with a number.

## Slices

### The shell cannot grow

- `infra/the-shell-cannot-grow` <!-- waits: bug/the-monitor-follows-the-hop --> — `scripts/check-shell-lines.sh`: CI and the `**` local check refuse a pull request above its merge base and fail a push above its parent; the seven Approved siblings and the brief template name the gate <!-- builds: check-shell-lines.sh, a shell code ratchet with no stored number -->

### The shell is inventoried

- `infra/the-shell-is-inventoried` — the README script table lists all 58 scripts with kind, runs and replaced-by columns; `docs/shell-and-domain.md` and `CLAUDE.md` state the target; this plan names slice 4's script <!-- builds: kind, runs and replaced-by columns in skills/plot/scripts/README.md -->

### A command names its action in the domain

- `infra/a-command-names-its-action-in-the-domain` — `controllerInvocation(command)` on `rules/ci-suite.ts`, in its own bundle; `plot-controller-gate.sh` asks it after the desk exemption and a basename prefilter, and refuses a named command it cannot check (#1245) <!-- builds: controllerInvocation, a domain rule -->

### The first script becomes a command

- `infra/the-first-script-becomes-a-command` — the operator command slice 2 ranks first becomes a JS entry; a launcher stays only where a caller names its `.sh` path <!-- builds: a JS command entry for the first-ranked operator command -->

## Notes

- 2026-10-03, direction from jwloka: "we should reduce shell use systematically and grow the domain", "instead of widen the gates", "Shell is run by agents, domain-level functions is tooling run in js".
- 2026-10-03, measurement: code lines counted with `git ls-files 'skills/plot/scripts/*.sh' | xargs cat | grep -vE '^\s*(#|$)' | wc -l`, and over `git ls-tree` at `91a89d95b` and `6fdc73b36`. Hook cost measured warm at load 6.9 on 16 cores: four PreToolUse hooks 65–70 ms per Bash call, `node` plus a small bundle 22–30 ms, a 528 KB bundle about 52–61 ms. Prefilter shares from 36,960 Bash calls in this machine's session logs: 5.0 % name a gated basename, 4.7 % contain `git commit`.
- 2026-10-03, PR #1244 was reworked so the empty-claim predicate lands as `rules/empty-claim.ts` and the bundle `board/plot-empty-claim.mjs` rather than `plot-empty-claim.sh`. `plot-worker-loop.sh` asks it in `yield_the_held_checkout`, which runs once per take-up and never per idle pass, so the bundle call is within the cost rule. It lands under `every-desk-state-has-an-exit`, outside this plan.

## Open Points

Panel rounds 1 and 2, 2026-10-03, each unanimous `amend` (estate, contradiction, deliverable, cost). The moderations are at `.plot/panels/2026-10-03-the-shell-shrinks-into-the-domain/round1.md` and `round2.md`.

- [x] [Technical] Round 1, slice 3: a prefilter before any `node` start, the failure direction, `rules/ci-suite.ts`. — *answered in round 1; round 2 moved the desk exemption first, added glob words to the prefilter, gave the rule its own bundle and changed the message to "update the plugin"*
- [x] [Trade-off] Round 1: who pays for in-flight growth; the merge-base comparison; the duplicates' price. — *answered; round 2 added the push and revert rows, the CI fetch, and a `waits:` marker on #1234 only*
- [x] [Domain] Round 1: the inventory joins the README table; slice 4 names its script; the plan delivers at its last slice. — *answered; round 2 added the 13 missing rows and the sort order, and excludes the five largest*
- [x] [Technical] Round 1, slice 4 (the other three hooks). — *round 2: dropped; those hooks exit before their token loop on every #1245 command, and `plot-state-gate.sh` expands globs on purpose*
- [x] [Domain] Round 2: "their briefs name the gate" was false; the sibling list was short. — *answered: slice 1 amends seven siblings and the brief template*
- [x] [Trade-off] Round 2, shared blind spot: a direct push to `main` was never compared. — *answered: a push is compared against its first parent*
