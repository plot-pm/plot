# Juror: root cause

Plan: `docs/plans/2026-10-26-a-board-or-fleetd-older-than.md` (Draft, PR #2729, issue #2728). Code cited from `p2729-main` at `48dec508e` (current `origin/main`).

Position: amend

## Summary

The plan names a real failure, but it treats the symptom (a missing marker) as the cause. What goes stale is the long-lived process image: the code a board or fleetd loaded at start. That code runs against two other code sources that move on their own schedules: the installed plugin, which supplies the gate, and the repo checkout, which supplies every new bundle. Neither slice removes the failure. Slice 1 adds text to a refusal that also fires on the gate's legitimate path, so the text cannot honestly say "likely stale spawner". Slice 2 compares the wrong pair of code sources. It fires on almost every merge in this repository, and it never fires in an adopting repository. The repo already has a working mechanism for this problem, `loop-restart.ts`, and the plan does not cite it. Amend before approval.

## 1. The problem

**The account is mostly right, but the headline example is out of date.** (read)

- `implement-run.ts:617` no longer sets the marker. Commit `a98afb890` (#2740, 2026-10-26 22:49) removed both the `MAIN_CHECKOUT_WRITER_ENV` import and the `[MAIN_CHECKOUT_WRITER_ENV]: '1'` line. (ran `git log -S MAIN_CHECKOUT_WRITER -- packages/fleet/src/shared/implement-run.ts` and `git show a98afb890`.) A `--brief-only` implement run now books through `plot-brief-book.sh` in a disposable worktree. Six marker sites remain, and the plan cites each one correctly: `deliver.ts:649`, `reslice.ts:473`, `story.ts:514`, `auto-deliver.ts:272`, `brief-ask.ts:163`, `plot-dispatch.sh:827`. `continuation.ts:1116` sets the marker to empty, and the plan says so correctly. (ran `grep -rn MAIN_CHECKOUT_WRITER packages/*/src skills/plot/scripts/*.sh`.)
- **The skew runs in both directions, and the plan covers only one of them.** The board (pid 41304) and fleetd (pid 68664) restarted on 2026-10-26 at 21:18:00 and 21:18:23. #2740 merged afterwards, at 22:49. The bundles on disk in the main checkout have mtime 2026-10-26 23:46:45. (ran `ps -o lstart`, `stat`.) So the running fleetd is stale again today. Its implement spawn still sets `PLOT_MAIN_CHECKOUT_WRITER=1` and uses the old prompt, which writes the brief into the main checkout. That is the #2725 leftover that #2740 fixed. The gate **allows** those writes, because the marker is present. A spawner that is older than a change that *withdrew* a grant cannot be seen by any gate message. Slice 1 cannot catch this direction by construction. Slice 2 can, but only as an operator-polled flag.
- **Other spawner-vs-gate contracts that could skew the same way** (read):
  - `brief-push`. `gatesBriefPush` (`brief-push.ts:17-18`) and `gate.ts:565` read `PLOT_BRIEF_ONLY` and `PLOT_BRIEF_BRANCH`, which the spawner sets. If a spawner predates them, the gate fails **open**, and nothing anywhere shows it.
  - `controller`. `gate.ts:637-660` reads `PLOT_UNATTENDED`, the desk pid markers, and the action receipts that board controllers write. A receipt format change skews the same way.
  - The stranding-reset arm (`gatesStrandingReset`, `main-checkout-write.ts:351`) depends only on `PLOT_UNATTENDED`, so it is safe.
  - The general class is this: **every environment variable or file a spawner writes and a gate reads is an unversioned contract between two code sources.** The plan solves one variable.

## 2. The approach against the code

**There are three code sources, not two, and the plan compares the wrong pair.** (read and ran)

- The gate runs from the installed plugin. `hooks/hooks.json` runs `${CLAUDE_PLUGIN_ROOT}/skills/plot/scripts/plot-gates.sh`, which `exec`s `board/plot-gate.mjs` beside it. The install is `~/.claude/plugins/cache/plot-marketplace/plot/2.28.1` at `52fd988`, updated 2026-10-23. (read `installed_plugins.json`.) Its `plot-gate.mjs` contains the marker once. (ran grep.)
- In this repository, the board and fleetd run from the repo checkout. The launchd unit `com.plot-pm.fleetd.plist` names `/Users/jwloka/Quatico/Agentic-Tools/plot/skills/plot/scripts/board/plot-fleetd.mjs`, and `plot-boardctl.sh:421-426` runs `node $artifact`. (read.)
- In an adopting repository, both run from a **versioned plugin directory**. `com.plot-pm.fleetd.agent-skills.plist` names `.../plot/2.28.0/.../plot-fleetd.mjs`, but 2.28.1 is installed. (read the plist; that unit is not currently loaded per `launchctl list`.) A plugin update writes a new directory and leaves the old file untouched. Slice 2 compares "the bundle on disk" with "the bundle they started from". In an adopting repository those are the same unchanged file, so **slice 2 never fires in the setting where Plot is a plugin.** The one existing signal there is `plot-fleetctl.sh:827-828` `BUNDLE MISSING`, after cache cleanup removes the old directory.
- In this repository the opposite happens: main builds bundles after every merge (CLAUDE.md, *Testing*). The running process differs from disk within minutes of most merges, so `stale: true` is almost always shown. Open Question 4 ("does every rebuild count?") is not a detail. It decides whether the signal carries information. As written, it does not.
- **The contract that actually broke is spawner vs gate, and slice 2 does not measure it.** In this repository the plugin gate lags the repo for days, because a release needs an explicit request. So the gate is often *older* than the spawner, and a "spawner older than gate" check needs a comparison that is defined across two code sources. A file hash does not provide one: `plot-gate.mjs` at 2.28.1 and `board-server.mjs` at HEAD are different files from different commits. **The well-defined comparison is a declared contract number.** The domain would export one (for example beside `MAIN_CHECKOUT_WRITER_ENV`), raise it whenever a gate starts to read a new spawner-set variable or withdraws one, and every unattended spawn would export it. The gate then compares the number with its own and names both numbers. An unset value means the spawner predates the contract. This also separates "marker unset" (an old spawner) from "marker explicitly empty" (a desk worker, `continuation.ts:1116`, `plot-dispatch.sh:1558`). Today `gatesMainCheckout` (`main-checkout-write.ts:32-33`) folds the two together with `!== '1'`.
- **Slice 1's wording would mislead.** The main-checkout refusal fires mainly on its intended path: a desk worker, or an `idea`/`design`/`verify` run from the `* command` config keys, which set `PLOT_UNATTENDED=1` without the marker. Text that names "a spawner older than the gate" as the likely cause would be wrong in most refusals. It would also give an agent a reason to argue past a correct refusal. The gate can state the cause only when it can verify it, and that needs the contract number above.
- **The refusal text already causes the reported behaviour.** `mainCheckoutWriteRefusal` (`main-checkout-write.ts:404-405`) tells the agent to *"route it through a disposable worktree the way plot-dispatch.sh books its Started record"*. In #2725 the agent improvised exactly that. The plan should change this advice for the stale-spawner case. Today the gate itself sends the agent around the refusal.
- **Precedent the plan omits.** `packages/domain/src/rules/loop-restart.ts` already decides "the loaded bundle differs from the main checkout's bundle" with a content hash (`loadedHash`, `pinnedHash`, `runningHashNow`). It applies the conditions that matter: on the default branch, clean script paths, `HEAD` contains the running commit, in a free wait. It restarts through `process.execve`, and `worker-loop.ts:2384-2410` reads the hashes through the refs port. This answers Open Question 1 (hash), and it supplies the domain rule, the adapter and the tests that slice 2 would otherwise duplicate. It also points to the fix that **removes** the failure, which neither slice attempts: fleetd re-execs itself on the newer bundle at an idle point between ticks, as the worker loop already does.
- **Where detection should live** (judgement): (a) the domain owns a spawn-contract number, and the gate states a mismatch only when it can verify one; (b) fleetd applies a `loop-restart`-style rule and self-restarts when idle; (c) status surfaces show the **contract** gap, not every rebuild. Text in the domain rule is right for wording that a test asserts, because the domain owns `mainCheckoutWriteRefusal`. This answers Open Question 3.

## 3. Safety

- Slice 1 tells an unattended agent to restart the board and fleetd. An agent that acts on this runs `plot-boardctl.sh --stop`, which kills the board's process tree deepest first (`plot-boardctl.sh:160-190`, read). Or it boots out fleetd. Project memory records that both kill the agents those processes hold ("Board stop kills continued agents", "bootout of fleetd kills its agents"; I read the memory index and did not re-verify). The refusal text must address the operator and must not ask the agent to act.
- `pnpm board` (`package.json:14`) runs `node --watch`. That board already restarts itself on every rebuild, mid-action. Any "automatic reload" design must use an idle gate like `loop-restart`'s `inFreeWait`, and must not imitate `--watch`. (read.)
- Slice 2 is read-only and safe as specified. As section 2 shows, it is mostly noise.
- A contract-number refusal at spawn time (not proposed here) would refuse work that would have succeeded under an older gate. The plan rightly declines refusal at spawn. A self-restart at an idle point refuses nothing.

## 4. Slices against Changelog and acceptance

- Slice 1 ships an observable result: a refusal string with a test. But the string asserts a cause it cannot verify, and the plan defines no acceptance check beyond "names the cause".
- Slice 2 ships an observable `stale` field. It has no acceptance that separates a meaningful gap from a routine rebuild. It has no acceptance at all for a plugin-installed board or fleetd, where it never fires.
- No slice ships a result that shows the failure gone. One should: "after a merge that changes a spawn contract, fleetd spawns its next marker-dependent role from the new bundle, with no operator restart", proved by a test that drives the restart rule with a changed contract number.

## 5. New defects

- **Adopting repositories.** As specified, slice 2 compares a file with itself under a versioned plugin path. Any staleness reading must compare against the *installed* plugin version (`installed_plugins.json` / `CLAUDE_PLUGIN_ROOT`) when the process runs from the plugin cache, and against the main checkout's bundle when it runs from a Plot checkout.
- **Layering.** Hashing a bundle reaches the filesystem, so it must go through an adapter, as `refs.hashFilesSync` already does. The comparison belongs in a domain rule next to `loop-restart.ts`, not in `plot-boardctl.sh` or `plot-fleetctl.sh`.
- **`check-shell-lines.sh`.** Printing a `stale` line from both `ctl` scripts adds shell lines that the ratchet requires the change to remove elsewhere. The board status should come from the board's API, and the fleet status from the fleetd bundle.
- **The marker's own docstring is stale.** `main-checkout-write.ts:13-16` and `gate.ts:507-510` still list "implement" as a marker-setting run after #2740. Slice 1 touches this file and should correct them.

## Named amendments

1. Restate the cause as "a long-lived process runs code older than the contracts its spawns and the gate share". Drop `implement-run.ts:617` from the role list, and add the reverse direction (an old spawner granting a marker that a newer design withdrew).
2. Replace slice 1's "likely cause" wording with a verifiable spawn-contract number that the spawner exports and the gate compares. Keep unset and empty distinct. Address the text to the operator. Remove or condition the "disposable worktree" advice at `main-checkout-write.ts:404-405`.
3. Rebuild slice 2 on `loop-restart.ts`. Flag (or, better, self-restart at an idle point) only when the contract number differs, not on every rebuild. Define the comparison for plugin-installed processes.
4. Add acceptance that shows the failure removed, not only named.
