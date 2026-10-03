# The shell shrinks into the domain

> An agent runs a command; the command is a JS entry point over the domain, and shell keeps only launchers.

## Status

- **State:** Draft
- **Type:** infra
- **Issue:** #1245
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- CI refuses a change that grows the shipped shell code under `skills/`; each pull request may keep or lower the count and never raise it.
- The table in `skills/plot/scripts/README.md` records each script's kind, how often it runs and the JS command that replaces it, and a command prints each script's code lines.
- `docs/shell-and-domain.md` and `CLAUDE.md` set the target: a command an agent runs is a JS entry point, and a `.sh` file that remains is a launcher.
- `plot-controller-gate.sh` asks a domain rule which controller action a command runs, so a glob or a file being read no longer reads as an invocation (#1245).
- The other three PreToolUse hooks read command words without expanding globs.
- The first operator command moves from shell to a JS entry; its `.sh` file stays as a launcher.

<!-- Board impact: none to the plan format, template or docs/plans layout. Slices that move a script into a JS entry add a bundle under skills/plot/scripts/board/, built by pnpm build:board, under whichever bundle regime main holds when the slice starts (see a-branch-carries-no-built-bundle). -->

## Motivation

Measured 2026-10-03 on `main`: the 61 tracked `.sh` files under `skills/` hold **15,423 non-comment, non-blank lines**. 58 of them sit in `skills/plot/scripts/` and hold 15,024 lines and 481 top-level functions (`^[A-Za-z_][A-Za-z0-9_]*\(\)`; 509 when indented definitions count too). The same `skills/plot/scripts/` count was **6,904 at `91a89d95b`** (the last commit before 2026-09-01) and **11,896 at `6fdc73b36`** (before 2026-09-15): it more than doubled in one month. Of 85 commits on `main` in the 14 days to 2026-10-03 that changed shipped shell code, 76 made it longer. The domain's rules hold 13,235 lines including comments. CI ratchets direct `spawn`/`execFile` sites in TypeScript (`allowed=28`); nothing counts shell.

The growth repeats one shape: a rule is needed, and the nearest place to write it is the shell script already open. On 2026-10-03 a brief told an agent to extract a shell helper for the empty-claim predicate, and PR #1244 added `plot-empty-claim.sh`, a third shell copy of a definition that `branch-state.ts:114`, `quiet.ts:89` and `sweepable.ts:123` each restate in a comment and none computes. The same day `plot-controller-gate.sh` refused `ls skills/plot/scripts/*.sh` as `plot-approve.sh` because its token loop expands globs (#1245), a decision no unit test reaches. Three more hooks split commands the same way: `plot-phase-gate.sh:92`, `plot-state-gate.sh:87` and `plot-brief-name-gate.sh:127`.

**The division this plan sets:** shell is what an agent runs; domain functions are tooling that runs in JS. A command an agent runs is a JS entry point that goes entry → domain → port → adapter, the layering rule in `CLAUDE.md`. Git and process readings sit behind the adapters that already exist (`refs-git.ts`, the process adapter). A `.sh` file that remains is a launcher: it resolves its bundle and `exec`s it, and decides nothing.

`docs/shell-and-domain.md` (plan `a-shell-script-asks-the-domain`, released) set how a script ASKS the domain: the 39 ms cost rule, where the call goes, how a declared duplicate is held. 27 of the 58 scripts already start a bundle, and 34 entries follow the shape *the script collects readings, a bundle decides* (`plot-release-gate.sh` → `board/plot-release-gate.mjs`). This plan keeps that contract and moves the target one step further: the script does not collect for the bundle; the JS entry reads through adapters itself, and the script becomes its launcher. A collector-plus-bundle pair counts as *readings* in the inventory: its decision has moved, and its readings are the next step.

## Design

### Approach

**This plan stops the growth and sets the target. It moves one script.** The five largest scripts hold 6,930 of the 15,024 lines (46 %): `plot-host.sh` 1,737 (the connector), `plot-dispatch.sh` 1,651, `plot-fleet-scan.sh` 1,412, `plot-reconcile-scan.sh` 1,269 and `plot-worker-loop.sh` 861 (the cost rule's per-pass case). Each of them is a plan of its own, in the order the inventory ranks them; this plan delivers when its five slices merge. The descent is measured by the same count the ratchet reads, and the inventory names the next plan.

**Slice 1, the ratchet, comes first, because a migration with no gate loses to the next brief.** `scripts/check-shell-lines.sh` counts the non-comment, non-blank lines of every tracked `.sh` file under `skills/` (the shipped shell, `ralph-sprint.sh` and `templates/worker-prompt.sh` included). It fails when the count at `HEAD` exceeds the count at `git merge-base HEAD origin/<default>`. It stores no number, so it cannot drift, two pull requests that each shrink the shell never conflict on a baseline line, and no environment variable turns it off. Room a merged change freed is gone for the next one, because the next change's merge base already holds the lower count. CI fetches full history (`ci.yml:75`, `:117`). `--per-file` prints each file's count, for the inventory. The count runs in 0.044 s. The slack-free precedent is `scripts/check-script-names.sh` and `test/reconcile/script-name-gate.test.mjs`; a fixture test proves that growth fails, a net-zero change passes and a shrinking change passes.

**Every change pays for the shell it adds, in the same pull request, and the gate has no override.** That is the operator's direction ("instead of widen the gates"), and it has a price: 76 of the last 85 shell-touching commits would each have needed an offset. The offset is a line removed elsewhere, or the new rule written in the domain and asked through a bundle. Slice 1 starts after #1234 and #1244 merge, so neither is refused in flight. The five Approved siblings that edit `plot-dispatch.sh` or `plot-worker-loop.sh` (`every-desk-state-has-an-exit`, `a-desk-and-its-manifest-name-each-other`, `the-queue-reads-the-order-the-scan-reads`, `a-slice-waits-on-every-branch-it-names`, `an-assignment-is-read-where-it-is-recorded`) pay the same way once the gate lands. Their briefs name the gate.

**The cost rule's duplicate row now has a price.** `docs/shell-and-domain.md` §1 tells a per-agent-per-pass call site to duplicate a rule in shell, and §2 allows a quoted heredoc seam. Both remain allowed, and both count. A new declared duplicate removes an equal number of lines elsewhere in the same change. Slice 2 writes that sentence into §1.

**Slice 2, the inventory, orders the rest.** It extends the table that already lists every script, `skills/plot/scripts/README.md`, which `scripts/check-helper-table.sh` gates. It adds three columns: *kind* (*launcher*, *readings*, *decision*, *orchestration*), *runs* (once per operator command, once per agent per pass, as a hook on every tool call), and *replaced by* (the JS entry, or empty). Code lines are not stored in the table, because they go stale at the rate the shell grows; `check-shell-lines.sh --per-file` prints them. The ranking is a command: among scripts that run once per operator command, sorted by `--per-file` lines. The slice amends this plan to name the first-ranked script in slice 5's branch line and Changelog line before slice 5 starts. It also amends `docs/shell-and-domain.md` and the `A Shell Script Asks The Domain` section of `CLAUDE.md` to state the target and the duplicate's price, and drops "the artifact is committed" from §2 if `a-branch-carries-no-built-bundle` has landed.

**Slice 3 answers #1245 in the domain, on a rule that exists.** `rules/ci-suite.ts` already tells a command that RUNS a script from one that mentions it: `withoutQuotes` empties quoted spans, `programWords` strips `NAME=value` and `env` prefixes, and `ciSuiteRefusal` splits simple commands on `&&`, `||`, `;`, `|` and newlines. The hook already asks it at `plot-controller-gate.sh:184`. `controllerInvocation(command)` is built on those functions and answers `dispatch`, `approve`, `deliver` or none. It also strips single-quoted heredoc bodies, tells a script RUN from a script READ, and keeps the mode split (`--status`, `--dry-run` and the others read). The hook keeps the desk exemption and the receipt. The gate stays exactly as strict; no exemption list is added. Design: the comment on #1245.

**Slice 3 starts `node` only for a command that names a gated script.** The hook runs on every Bash call of every session, fleet agents included, and today costs 19–21 ms. A bundle start adds 27–52 ms. So a `case` test on the raw command text for the three basenames runs first, as the gate's CI-suite branch already does (`:159`, `:178`). That test only skips work and decides nothing; a command that does not contain a basename cannot run that script. Only a command that names one reaches the rule. **When the rule cannot be asked, the gate refuses that command**, with a message naming `pnpm build:board`. A command that names no gated script never reaches that point, so a missing bundle refuses only the commands the gate exists for. This follows `docs/shell-and-domain.md` §1 ("silence is never permission") and replaces the `trap 'exit 0' ERR` path for this case. The slice records the measured cost of both paths.

**Slice 4 brings the other three hooks onto the same reading.** `plot-phase-gate.sh`, `plot-state-gate.sh` and `plot-brief-name-gate.sh` iterate `for tok in $segment` without `set -f`, so each expands a glob in the command text. Each asks the slice 3 word reading behind the same `case` prefilter, and #1245 closes when all four agree on a fixture table of the commands it lists.

**Slice 5 moves the first whole script.** The script slice 2 names becomes a JS entry under `packages/board/src/server/entry/`, bundled to `skills/plot/scripts/board/`. It is an operator command, never a hook, `plot-worker-loop.sh` or the connector. Its `.sh` file becomes a launcher with the same name and arguments, so every caller, skill and test keeps working. The launcher follows `plot-release-gate.sh:30-33`: when the bundle is absent it exits 2 and names the build command. Under `a-branch-carries-no-built-bundle`, `main` holds the launcher about 3–5 minutes before it holds the bundle, and in that window the command refuses with that message rather than running a stale copy. The script's decisions move into `packages/domain/src/rules/` with unit tests; its git and process calls go through adapters.

**What does not change.** The cost rule stays: a call site that runs once per agent per pass and cannot yet become JS keeps its declared duplicate and its corpus test, and pays for its lines. Hooks registered by `hooks/hooks.json` keep their file names, because adopting repositories register them by path. No published script name disappears without a launcher.

**What the count does not measure.** A line count measures size, not where decisions live. A rule moved into a `node -e` heredoc inside a script lowers nothing, and a decision kept in a shorter shell function passes. The ratchet guards the direction; the inventory's *kind* column records where decisions still sit, and a reviewer reads that column, not the count, to judge a migration.

### Open Questions

- [ ] `plot-worker-loop.sh` runs per agent per pass and is the cost rule's named duplicate case. Does its plan make it a long-running JS process, which removes the per-pass `node` start entirely? This plan does not decide it; the inventory measures its call sites.
- [ ] `scripts/*.sh` (CI and local-check tooling, 1,449 lines, not shipped) is outside the count. Slice 1 prints its size so the question can be answered with a number.

## Slices

### The shell cannot grow

- `infra/the-shell-cannot-grow` — `scripts/check-shell-lines.sh`: CI and the `**` local check refuse a change whose shipped shell count exceeds its merge base's <!-- builds: check-shell-lines.sh, a merge-base shell code ratchet -->

### The shell is inventoried

- `infra/the-shell-is-inventoried` — the README script table gains kind, runs and replaced-by columns; `docs/shell-and-domain.md` and `CLAUDE.md` state the target; this plan names slice 5's script <!-- builds: kind, runs and replaced-by columns in skills/plot/scripts/README.md -->

### A command names its action in the domain

- `infra/a-command-names-its-action-in-the-domain` — `controllerInvocation(command)` on `rules/ci-suite.ts`; `plot-controller-gate.sh` asks it behind a basename prefilter and refuses when it cannot ask (#1245) <!-- builds: controllerInvocation, a domain rule -->

### Every hook reads words unexpanded

- `infra/every-hook-reads-words-unexpanded` — `plot-phase-gate.sh`, `plot-state-gate.sh` and `plot-brief-name-gate.sh` read command words through the slice 3 reading, and none expands a glob <!-- builds: unexpanded word reading in three PreToolUse hooks -->

### The first script becomes a command

- `infra/the-first-script-becomes-a-command` — the operator command slice 2 ranks first becomes a JS entry; its `.sh` stays as a launcher with the same interface <!-- builds: a JS command entry for the first-ranked operator command -->

## Notes

- 2026-10-03, direction from jwloka: "we should reduce shell use systematically and grow the domain", "instead of widen the gates", "Shell is run by agents, domain-level functions is tooling run in js".
- 2026-10-03, measurement: code lines counted with `git ls-files 'skills/plot/scripts/*.sh' | xargs cat | grep -vE '^\s*(#|$)' | wc -l`, and over `git ls-tree` at `91a89d95b` and `6fdc73b36`. Hook cost measured warm at load 6.9 on 16 cores: four PreToolUse hooks 65–70 ms per Bash call, `node` plus a small bundle 27–30 ms, a 528 KB bundle about 52 ms.
- 2026-10-03, PR #1244 was reworked so the empty-claim predicate lands as `rules/empty-claim.ts` and the bundle `board/plot-empty-claim.mjs` rather than `plot-empty-claim.sh`. `plot-worker-loop.sh` asks it in `yield_the_held_checkout`, which runs once per take-up and never per idle pass, so the bundle call is within the cost rule. It lands under `every-desk-state-has-an-exit`, outside this plan.

## Open Points

Panel round 1, 2026-10-03, unanimous `amend` (estate, contradiction, deliverable, cost). The moderation is at `.plot/panels/2026-10-03-the-shell-shrinks-into-the-domain/round1.md`.

- [x] [Technical] Slice 3 prefilter before any `node` start. — *answered: a `case` test on the three basenames*
- [x] [Technical] Slice 3 failure direction. — *answered: refuses the named command, with the build command in the message*
- [x] [Technical] Slice 3 on `rules/ci-suite.ts`; the other three hooks. — *answered: built on it; slice 4 covers the three hooks*
- [x] [Trade-off] Who pays for growth by in-flight work. — *answered: an offset in the same change, no override; slice 1 starts after #1234 and #1244 merge*
- [x] [Technical] Merge-base comparison, slack-free precedent. — *answered: merge base, no stored number; `check-script-names.sh` cited*
- [x] [Domain] Price on declared duplicates and heredoc seams. — *answered: they count and pay; slice 2 writes it into §1*
- [x] [Technical] Slice 5 against `a-branch-carries-no-built-bundle`. — *answered: launcher exits 2 naming the build; the window is named*
- [x] [Domain] No second per-script list. — *answered: columns join the README table; lines are printed, not stored*
- [x] [Domain] Slice 5 names its script; lifecycle of further slices. — *answered: slice 2 amends the plan; operator commands only; this plan delivers at slice 5*
- [x] [Domain] Notes against `every-desk-state-has-an-exit` and #1244. — *answered: Notes updated; the sibling's slice line is amended*
- [x] [Technical] `ralph-sprint.sh` in the count. — *answered: the count covers every shipped `.sh` under `skills/`*
- [x] [Domain] Changelog names the contract change. — *answered*
- [x] [Domain] Motivation numbers. — *answered: 6,904 at `91a89d95b`; the regex is named*
- [x] [Trade-off] The share this plan moves; the metric. — *answered: it stops growth and moves one script; the five largest get their own plans; the kind column, not the count, tracks decisions*
