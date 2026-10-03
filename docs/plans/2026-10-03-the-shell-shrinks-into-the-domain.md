# The shell shrinks into the domain

> An agent runs a command; the command is a JS entry point over the domain, and shell keeps only launchers.

## Status

- **State:** Draft
- **Type:** infra
- **Issue:** #1245
- **Review:** in-session
- **Impl:** own branches

## Changelog

- CI refuses a change that grows the shell code under `skills/plot/scripts/`; the count may fall and may never rise.
- `docs/shell-inventory.md` classifies every shipped shell script and names the JS command that replaces it.
- `plot-controller-gate.sh` asks a domain rule which controller action a command runs, so a glob or a file being read no longer reads as an invocation (#1245).
- The first shell script becomes a JS command; its `.sh` file stays only as a launcher.

<!-- Board impact: none to the plan format, template or docs/plans layout. Slices that move a script into a JS entry add a bundle under skills/plot/scripts/board/, built by pnpm build:board like the 35 already there. -->

## Motivation

Measured 2026-10-03 on `main`: `skills/plot/scripts/*.sh` holds 58 scripts, 481 shell functions and **15,024 non-comment, non-blank lines**. The same count was **6,876 on 2026-09-01** and **11,896 on 2026-09-15**: it more than doubled in one month. The domain's rules hold 13,235 lines including comments. CI ratchets direct `spawn`/`execFile` sites in TypeScript (`allowed=28`); nothing counts shell.

The growth repeats one shape: a rule is needed, and the nearest place to write it is the shell script already open. On 2026-10-03 a brief told an agent to extract a shell helper for the empty-claim predicate, and PR #1244 added `plot-empty-claim.sh`, a third shell copy of a definition that `branch-state.ts:114`, `quiet.ts:89` and `sweepable.ts:123` each restate in a comment and none computes. The same day `plot-controller-gate.sh` refused `ls skills/plot/scripts/*.sh` as `plot-approve.sh` because its token loop expands globs (#1245), a decision no unit test reaches.

**The division this plan sets:** shell is what an agent runs; domain functions are tooling that runs in JS. A command an agent runs is a JS entry point that goes entry → domain → port → adapter, the layering rule in `CLAUDE.md`. Git and process readings sit behind the adapters that already exist (`refs-git.ts`, the process adapter). A `.sh` file that remains is a launcher: it resolves its bundle and `exec`s it, and decides nothing.

`docs/shell-and-domain.md` (plan `a-shell-script-asks-the-domain`, released) set how a script ASKS the domain: the 39 ms cost rule, where the call goes, how a declared duplicate is held. This plan keeps that contract and changes the target: a script does not ask the domain one rule at a time; it becomes the JS command.

## Design

### Approach

**Slice 1, the ratchet, comes first, because a migration with no gate loses to the next brief.** `scripts/check-shell-lines.sh` counts non-comment, non-blank lines of the tracked `skills/plot/scripts/*.sh` files, top level only, and fails when the count exceeds the baseline it records. The baseline is the count on the commit that adds the gate. A change that lowers the count lowers the baseline in the same PR, so the room it freed cannot be spent by the next change. `check-helper-table.sh` records its baseline the same way, as a number in the script. It runs in CI and in the `**` local check. It counts lines, not files, so a script split in two counts the same and a launcher counts its few lines.

**Slice 2, the inventory, orders the rest.** `docs/shell-inventory.md` lists every shipped script with: its code lines, how often it runs (once per operator command, once per agent per pass, as a hook on every tool call), what it holds (*launcher*, *readings*, *decision*, *orchestration*), its domain twins (rules and corpus tests that already answer the same question), and the JS entry that replaces it. It ranks the scripts by decision lines per call site that the cost rule no longer protects. The slice also amends `docs/shell-and-domain.md` and the `A Shell Script Asks The Domain` section of `CLAUDE.md` to state the target above. The inventory is measured, not estimated: each number names the command that produced it.

**Slice 3 answers #1245 in the domain.** A rule, for example `controllerInvocation(command)`, answers `dispatch`, `approve`, `deliver` or none. It splits words without pathname expansion, strips single-quoted heredoc bodies, tells a script RUN from a script READ, and keeps the mode split (`--status`, `--dry-run` and the others read). The hook keeps the desk exemption and the receipt and asks the rule through a bundle, exit code first. The gate stays exactly as strict; no exemption list is added. Design: the comment on #1245.

**Slice 4 moves the first whole script.** The script the inventory ranks first becomes a JS entry under `packages/board/src/server/entry/`, bundled to `skills/plot/scripts/board/`. Its `.sh` file becomes a launcher with the same name and arguments, so every caller, skill and test keeps working. Its decisions move into `packages/domain/src/rules/` with unit tests; its git and process calls go through adapters. The slice lowers the ratchet baseline by what it removed.

**Further slices are added to this plan by amendment, one script per slice, in the inventory's order.** Each is the shape of slice 4. A slice that cannot keep a script's callers unchanged says so and becomes its own plan.

**What does not change.** The cost rule stays: a call site that runs once per agent per pass and cannot yet become JS keeps its declared duplicate and its corpus test. Hooks registered by `hooks/hooks.json` keep their file names, because adopting repositories register them by path. No published script name disappears without a launcher.

### Open Questions

- [ ] Does the ratchet also count `scripts/*.sh` (CI and local-check tooling, not shipped)? This plan scopes it to `skills/plot/scripts/`, which agents run; the inventory slice reports the other directory's size so the question can be answered with a number.
- [ ] `plot-worker-loop.sh` runs per agent per pass and is the cost rule's named duplicate case. Does it become a long-running JS process, which removes the per-pass `node` start entirely, or stay shell longest? The inventory measures its call sites; this plan does not decide it.
- [ ] Is a launcher's `exec node <bundle>` fast enough for the hooks that run on every tool call? Slice 3 measures the hook's added latency and records it.

## Slices

### The shell cannot grow

- `infra/the-shell-cannot-grow` — `scripts/check-shell-lines.sh`: CI and the `**` local check refuse a shell code count above the recorded baseline <!-- builds: check-shell-lines.sh, a shell code ratchet -->

### The shell is inventoried

- `infra/the-shell-is-inventoried` — `docs/shell-inventory.md` classifies every shipped script and ranks the migration; `docs/shell-and-domain.md` and `CLAUDE.md` state the target <!-- builds: docs/shell-inventory.md, the migration order -->

### A command names its action in the domain

- `infra/a-command-names-its-action-in-the-domain` — `controllerInvocation(command)` in `packages/domain`; `plot-controller-gate.sh` asks it, and the glob and file-operand refusals of #1245 end <!-- builds: controllerInvocation, a domain rule -->

### The first script becomes a command

- `infra/the-first-script-becomes-a-command` — the inventory's first-ranked script becomes a JS entry; its `.sh` stays as a launcher with the same interface <!-- builds: a JS command entry for the first-ranked script -->

## Notes

- 2026-10-03, direction from jwloka: "we should reduce shell use systematically and grow the domain", "instead of widen the gates", "Shell is run by agents, domain-level functions is tooling run in js".
- 2026-10-03, measurement: shell code lines counted with `git ls-files 'skills/plot/scripts/*.sh' | xargs cat | grep -vE '^\s*(#|$)' | wc -l` on `main`, and the same count over `git ls-tree` at the last commit before 2026-09-01 and 2026-09-15.
- 2026-10-03, PR #1244 is being reworked so the empty-claim predicate lands as a domain rule and a bundle rather than `plot-empty-claim.sh`; it is the first instance of this plan's direction and lands outside it.
