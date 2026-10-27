# Juror: safety

Lens: the operator whose board, fleetd and running agents the plan touches. Code cited from `p2729-main` at `48dec508e`.

Position: amend

## Summary

The plan's two detections do not change any spawn or any gate decision, so neither one kills an agent or refuses work by itself. The plan also rejects the issue's third option (refuse to spawn), which is the one option that would refuse working runs (plan line 39). The danger is in what each detection tells its reader to do. Slice 1 puts "restart the board and fleetd" into a refusal that fires on every unmarked unattended write, most of which are refused by design, and an unattended agent can run that restart: no gate stops it. Slice 2 flags "stale" about eight times a day on this repository, and each flag invites a restart, and a restart stops agents. Both slices need a stated "report, never act" contract and a cause test that does not misfire.

## 1. The problem

- **Read:** the marker check is `gatesMainCheckout` at `packages/domain/src/rules/main-checkout-write.ts:32-33`. The setters the plan lists exist at the cited lines: `deliver.ts:649`, `reslice.ts:473`, `story.ts:514`, `auto-deliver.ts:272`, `brief-ask.ts:163`, `plot-dispatch.sh:827`. `continuation.ts:1116` and `plot-dispatch.sh:1558` set it empty on purpose.
- **Read, and the plan is out of date here:** `implement-run.ts` no longer sets the marker. Commit `a98afb890` (#2740, merged 2026-10-26 22:49) removed both the import and `[MAIN_CHECKOUT_WRITER_ENV]: '1'`. The spawn env is now at `implement-run.ts:652-659` and carries `PLOT_UNATTENDED`, `PLOT_BRIEF_ONLY`, `PLOT_PLAN_SLUG` and `PLOT_BRIEF_BRANCH`, with no marker. The role that motivated the plan now books from a disposable worktree and depends on the marker no longer. The plan's "seven roles" are six. `implement-run.ts:617` points at nothing.
- **Read:** a missing marker is the normal state for most unattended runs, not a sign of skew. `idea.ts:725`, `interrogate.ts:490`, `auto-verify.ts:500`, `auto-design.ts:757` and `implement-run.ts:655` set `PLOT_UNATTENDED=1` and leave the marker unset. Desk workers and continuations set it empty. So "unattended without the marker" describes every desk worker and every idea, interrogate, verify, design and implement run on a current spawner.

## 2. The approach against the code

- **Read:** the refusal text is not in `gate.ts`. It is `mainCheckoutWriteRefusal` at `main-checkout-write.ts:391-407`, and `gate.ts:534` returns it for BOTH arms. The second arm (`gate.ts:531`, `gatesStrandingReset`) fires for a mixed `git reset` even when the marker IS set. A sentence "the marker is missing, a stale spawner is the likely cause" in the shared text prints a false cause to a correctly marked deliver, reslice or story run. The open question at plan line 47 has a forced answer: the domain needs two refusal texts, one per arm, and the marker sentence goes only in the arm that `gatesMainCheckout` decided.
- **Read:** the gate cannot tell "spawner predates the marker" from "spawner does not mark this role by design". Both leave the variable unset. The plan's slice 1 therefore can only say "if this run should write here, its spawner may be older than this gate". It cannot say "likely".
- **Read:** an identity the gate can compare exists only if spawners start to carry one. A spawn-time variable naming the spawner's bundle (for example its content hash or plugin version) makes the comparison well defined, and its absence then means "spawner predates the identity contract" without guessing. That would make slice 1 precise. It is message-only and stays safe.
- **Ran:** hashing is cheap. `sha256` over `board-server.mjs` (2,349,154 bytes) took 2 ms and over `plot-fleetd.mjs` (618,077 bytes) 1 ms. The open question at plan line 45 resolves to the content hash. An mtime flags a rebuild that produced identical bytes, which adds false stale flags.
- **Read:** the hash comparison already exists for worker loops. `packages/domain/src/rules/loop-restart.ts` reads `loadedHash` and `runningHashNow` and restarts only in a free wait (`inFreeWait`, `phase: 'later'`). Slice 2 should reuse those readings and say why the board and fleetd do not also adopt the free-wait restart.
- **Read:** two code sources make slice 2 vacuous outside this repository. `plot-fleetctl.sh:118` resolves `fleetd="$script_dir/board/plot-fleetd.mjs"`. In an adopting repo `script_dir` is a versioned plugin cache directory (`~/.claude/plugins/cache/plot-marketplace/plot/2.28.1/...`; this machine holds 2.27.0, 2.27.1, 2.28.0 and 2.28.1, **ran** `ls`). A plugin update adds a new directory and leaves the old file unchanged. The running fleetd's file never differs from its start, so slice 2 reports "fresh" while the gate comes from the newer version. The skew the issue names is spawner against gate, and slice 2 compares spawner against itself.
- **Read:** `pnpm board` (this repo's `Board command`, `package.json:14`) runs `node --watch`, which reloads the board child on a bundle change. A board started that way is never stale, and the plan's "Neither reloads its bundle" (line 26) holds only for `plot-boardctl.sh --start` (`plot-boardctl.sh:425`, plain `node`).

## 3. Safety

**3a. The gate text can make an agent restart the board and fleetd (kills agents).** Plan line 36 says "The text names the board and fleetd restart as the check." The refusal goes to the agent that was refused, and it runs with `--permission-mode bypassPermissions` (Plot Config `Implement command`, `Idea command` and others). **Read:** the registered gates are `bundle-commit`, `brief-name`, `state`, `controller`, `phase`, `main-checkout`, `brief-push` (`gate.ts:690`). None refuses `plot-boardctl.sh --stop`, `plot-fleetctl.sh --stop`, `launchctl bootout` or `kill` from an unattended agent. `plot-fleet --stop` signals every agent before it unloads the supervisor (`skills/plot-fleet/SKILL.md:212-224`). Operator memory records that a board stop kills continued agents and that a fleetd bootout kills its agents (**not re-verified here**). Because the refusal fires on every unmarked write (section 1), a desk worker or an idea run that hits the gate would read a restart suggestion it has no reason to follow. Path: unattended agent → main-checkout refusal → "restart board and fleetd" → `plot-fleet --stop` → every running agent signalled mid-action. **Amend:** the text addresses the operator, tells the agent to stop and report the refusal (write `PLOT-BLOCKED.md` or end the run), and never names a stop or restart command. Add a domain test that asserts the refusal names no `--stop`, `bootout` or `kill`.

**3b. A stale flag on every bundle rebuild invites restart churn (kills agents, restarts mid-action).** **Ran:** `git log --since=2026-10-20` shows 56 commits that changed `board-server.mjs` and 49 that changed `plot-fleetd.mjs`, about eight per day, because `main` rebuilds bundles after every merge. Slice 2 as written flags "stale" after each of them. An operator who restarts on each flag stops the fleet's agents eight times a day. The plan has no restart route that keeps agents alive, and none exists today: fleet stop is per-agent signalling (`SKILL.md:205-224`). **Amend:** the stale report states what a restart would stop (agents running under fleetd, runs the board started) and says "restart when the fleet is idle". It stays a report: no code path reads `stale` to stop, start, kick or reload anything. Add a test that a stale reading produces no process action. Answer open question 4 (plan line 48) in favour of a narrower flag, or at least show the eight-per-day rate in the plan and accept it explicitly.

**3c. The status contract must not move (refuses working state).** **Read:** `supervisor-reading.ts:10-13` makes the exit code of `plot-fleetctl.sh --status` the board's contract: 0 loaded, 1 not. `plot-fleetctl.sh:859-860` and `:971-973` repeat that the exit code and the first `summary:` line do not change. If slice 2 sets a non-zero exit or rewrites `supervisor=` for a stale fleetd, the board reads a running fleet as `down` or `died` and raises an `alert` (`supervisor-reading.ts:335`). **Amend:** slice 2 adds a separate field or line and leaves the exit code and `supervisor=` word untouched, with a test on both.

**3d. Unknown is not fresh, and not stale.** A board or fleetd started before slice 2 records no start identity. The reading must answer `unknown` for it, the three-state shape `supervisor-reading.ts:20-28` already uses. A missing record shown as `stale` produces a restart prompt on first deploy; shown as `fresh` it hides exactly the process this plan exists for.

**3e. What is safe as written.** Slice 1 changes text, not `wants` or `ask` (`gate.ts:525-537`). If the slice keeps both functions byte-identical, it refuses nothing new. **Amend:** the acceptance states this and a test pins it (same allow/refuse set over the existing `main-checkout-gate.test.ts` cases). The plan's refusal of option three (line 39) is correct from this lens: a spawn refusal on a stale reading would stop runs that the gate would allow.

## 4. Slices against Changelog and acceptance

- Slice 1 is observable only after a release. **Read:** the gate the agents run comes from the plugin cache (the brief and the cache listing above), not from `main`. A merged slice 1 changes nothing for any agent until a release ships and the plugin updates. The Changelog line is correct, but the slice line needs an acceptance that says "after the next release", or it reads as done at merge.
- Slice 2's Changelog line ("differs from the bundle they started from") is checkable, but it is the wrong comparison for adopting repos (section 2). Acceptance should name the reading per process (`fresh`, `stale`, `unknown`) and the surface (`--status` line, payload field).
- Neither slice has an acceptance that names a safety property. Section 3 lists four.

## 5. New defects

- **Read:** `check-shell-lines.sh` ratchets shipped shell lines. A stale line in `plot-fleetctl.sh` or `plot-boardctl.sh` must remove an equal number of lines elsewhere, or the reading must come from a JS bundle the script calls. The plan does not name which.
- **Read:** fleetd's start identity must be written by fleetd (a process fact in `.plot/state/`) for a shell `--status` to read it. That is a new state file with one writer; the plan should name its writer and its reader, as the CLAUDE.md index sections do.
- Plan line 20 says no helper script changes, but slice 2 changes the output of two helper scripts.

## Named amendments

1. Drop `implement-run.ts:617` and the implement role from the motivation; state that #2740 removed the marker from implement.
2. Split `mainCheckoutWriteRefusal` into one text per arm; the marker sentence appears only where `gatesMainCheckout` refused.
3. The refusal says "may be older", addresses the operator, tells the agent to stop and report, and names no stop or restart command. Test it.
4. Slice 1 keeps `wants` and `ask` decisions unchanged, with a test.
5. Slice 2 is report-only: no consumer of `stale` starts, stops or reloads a process. Test it.
6. Slice 2 leaves the `--status` exit code and the `summary:` `supervisor=` word unchanged, and answers `unknown` for a process with no recorded start identity.
7. The stale report names what a restart would stop and recommends restarting when idle.
8. Use the content hash (measured 1–2 ms) and reuse `loop-restart.ts`'s readings.
9. Either compare spawner against gate (a spawn-time identity variable the gate reads), or state that slice 2 detects nothing in an adopting repo whose bundle path is a versioned plugin directory.
