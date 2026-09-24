# Adopting-repository lens — fleet-control-finds-its-own-artifact

Position: amend

The diagnosis is right and the fix is real: line 89 is a genuine outlier, the `$script_dir` choice is correct, and the plan is right that the unit fill must use the same resolution. `/plot-fleet --once` WILL work in the consumer after this slice. But the plan's "Done when" promises the reporter a working `/plot-fleet`, and `--start` still cannot deliver one — for reasons the plan never names. Two of them are `$repo_root` resolutions in the same file, and the plan's own gate would not catch either.

## What I verified works — the plan is right about these

**`--once` needs only line 89.** `skills/plot/scripts/plot-fleetctl.sh:503-510` is the whole arm: `[ -f "$registryd" ]`, then `exec node "$registryd" --once`. No other file is touched. `node` comes off PATH with no version check on this path.

**The registryd bundle is self-contained and location-independent.** `skills/plot/scripts/board/plot-registryd.mjs` is 431 KB with `zod` bundled — 0 hits for `from 'zod'`, so no `node_modules` is needed. Critically, it does NOT re-derive script paths from the repo: `packages/board/src/server/entry/registryd-main.ts:87` is `scriptsDirFor = (here) => process.env.PLOT_SCRIPTS_DIR ?? join(here, '..')`, and `:1011` passes `dirname(fileURLToPath(import.meta.url))`. So the daemon resolves `plot-*.sh` beside ITSELF, in the plugin. `repoRoot` (`:796`, `PLOT_REPO_ROOT ?? cwd()`) is used only for the estate's own files. The daemon is already plugin-correct; only the shell that launches it is not. The plan's "board impact: none" holds.

**`UNIT_DIR` is already correct.** `plot-fleetctl.sh:85` is `"$script_dir/../units"`, and `git ls-files skills/plot/units/` shows both templates tracked. The templates' three placeholders are `__REPO_ROOT__`, `__NODE__`, `__REGISTRYD__` — only `__REGISTRYD__` is wrong today, and `__REPO_ROOT__` is correctly the consumer's. Slice item 2 is a one-line change at `:591-594` that follows from item 1.

**`plot-dispatch.sh --start` resolves its own bundle correctly.** `plot-dispatch.sh:1936` is `start_bundle="$script_dir/board/plot-fleet-size.mjs"`, and the comment at `:1907-1924` records the plugin case explicitly. Its refusal at `:1955-1960` even distinguishes a missing bundle from a broken runtime and scopes `pnpm build:board` to "in a development checkout". That is the message model the plan's item 3 should copy.

## Finding 1 — `pinned_major` reads `$repo_root/.nvmrc`, so REFUSAL 2 silently vanishes for every consumer

`plot-fleetctl.sh:108-112`:

```
pinned_major() { v=$(tr -d ' \tv\n' < "$repo_root/.nvmrc" 2>/dev/null); printf '%s' "${v%%.*}"; }
```

`git ls-files | grep nvmrc` returns exactly one path: `.nvmrc` at the repo root. It is NOT under `skills/`, so a plugin install ships no `.nvmrc` and there is no `$script_dir` equivalent to move to. I confirmed the behaviour in a scratch repo with no `.nvmrc`: `pinned_major` returns empty, and the guard at `:530` is `if [ -n "$want" ] && [ "$have" != "$want" ]`, so **the refusal never fires**.

This is the same class of defect as line 89 — a `$repo_root` read of something that only exists in Plot's own checkout — and it is worse in kind, because line 89 fails loudly and this one fails silently. The plan's Motivation says the node refusal's whole justification is that "the unit bakes `$NODE` in permanently", and `skills/plot-fleet/SKILL.md:132-137` says a wrong interpreter "arrives as a daemon that keeps restarting, long after anybody is watching". The consumer is precisely the population that gets no protection: `--start` will happily bake the operator's node 26 into a launchd plist.

The plan cannot simply repoint this at `$script_dir`, and that is why it needs a decision rather than a one-liner. The right reading for a consumer is arguably the consumer's own `.nvmrc` (it is their machine and their repo), but then the refusal must handle its absence rather than skipping. At minimum the slice should state which repository's pin governs, and a consumer with no `.nvmrc` should get a stated reading — "no pin found, node 26.7.0 will be baked in" — rather than silence.

**This is not caught by the plan's proposed gate.** "A gate counts `$repo_root`-resolved bundle paths and holds at zero" (line 93) counts *bundle* paths. `.nvmrc` is not a bundle. The gate as scoped passes a file that still carries the same defect two lines above the one being fixed.

## Finding 2 — `Worker command` is repo-relative and runs with the worktree as cwd, so `--start` starts a supervisor and zero working agents

This is the leg that decides whether the reporter gets a working fleet, and the plan does not mention it. The plan's text contains zero occurrences of "worker" or "Worker command".

The chain: `plot-fleetctl.sh:648/650` calls `plot-dispatch.sh --start`, which reaches `start_worker` (`plot-dispatch.sh:988`). `:1050` reads the command: `cmd=$("$script_dir/plot-config.sh" get "Worker command" "")`. `plot-config.sh:145-150` reads it from `$(git rev-parse --show-toplevel)/CLAUDE.md` — the CONSUMER's CLAUDE.md, which is correct, since the key is the consumer's to set.

The launch is at `plot-dispatch.sh:1389`: `( cd "$wt" && ... nohup sh -c ... '"$cmd"' ... )`. **The cwd is the agent's worktree.** So a relative `Worker command` resolves against `$wt`, not against the plugin and not against the consumer's repo root.

This repo's own configured value (CLAUDE.md:52) is `PLOT_UNATTENDED=1 skills/plot/scripts/plot-worker-loop.sh` — a repo-relative path that works here only because this repository IS the plugin. A consumer copying it gets `$wt/skills/plot/scripts/plot-worker-loop.sh`, which does not exist, and every dispatched agent dies with `command not found` in a detached shell nobody is reading.

**This is what the issue's `Worker command: none` mitigation is telling you.** `none` is handled at `:1054` and `:1990-1997`: it means "this repo starts them by hand", and the fan-out prints "no worker will start". So the reporter's mitigation is not a workaround for the artifact bug at all — it is them discovering that the only configuration that does not crash is the one that starts nothing. After this plan lands, `/plot-fleet --start` in that repository will load a supervisor and cut desks that no worker ever occupies. That is a different failure from the reported one, and the reporter will read it as the fix not working.

I am not asking this plan to solve the worker command — it is the consumer's key and Plot correctly hardcodes no agent tooling (Principle 5). I am asking it to **state the boundary**. The plan's "Done when" (line 90) says `/plot-fleet --once` works, which is true and sufficient for item 1; but the Motivation frames the defect as "a consumer repository cannot start fleet control at all", and a reader takes the slice as restoring fleet control. One sentence in "What this does NOT do" — that a consumer must still configure a `Worker command` resolvable from a worktree, and that `plot-worker-loop.sh` must be named by an absolute or `$script_dir`-derived path — converts a silent second failure into a known limit. Grep found no `Worker command` guidance in `skills/plot-init/SKILL.md` or `skills/plot/templates/claude-md-snippet.md`, so there is nowhere else a consumer would learn it.

## Finding 3 — the refusal message. "Reinstall or update the plugin" is not actionable, and dispatch already has the right wording

Plan item 3 (line 79) says the honest repair "is to reinstall or update the plugin". As a message to a consumer that is weak: they do not know whether they are in a plugin install or a dev checkout, and reinstalling is a large action for what is most likely a partial install.

`plot-dispatch.sh:1955-1963` already solves this exact problem for a sibling bundle and should be copied rather than re-invented:

```
The rule's bundle is missing: $start_bundle
Every bundle is tracked in git, so this is a broken or partial installation.
In a development checkout, run 'pnpm build:board'.
```

That names the path, states the invariant that makes absence diagnostic, and scopes `pnpm build:board` to the one case where it applies instead of deleting it. The plan should adopt this wording; it satisfies "a repair a consumer can perform" (line 92) better than "reinstall", and it keeps the dev-checkout repair the plan is otherwise removing outright.

Note both `--once` (`:504-508`) and `--start` REFUSAL 1 (`:517-521`) carry the message, with different second lines. Both need changing; the slice line says "the missing-artifact message" in the singular.

## Finding 4 — the upgrade path is true but undiscoverable, and the symptom is misattributed

The plan's claim at line 86 is correct. I verified `skills/plot-fleet/SKILL.md:142-149`: "AN INSTALLED UNIT DOES NOT UPDATE ITSELF ... Run `--stop` then `--start` to re-fill it; that is the whole upgrade path, and there is no other."

Discoverability is the problem, and there is a specific reason it bites harder here than for the `--start-agents` precedent that paragraph documents. That precedent names a recognisable symptom: "a tick reporting `handed=N` while the agents it named keep an empty `branch:`". A stale `__REGISTRYD__` has no such tell for a consumer. The unit points at a path that does not exist, so launchd/systemd cannot start the process at all; `KeepAlive: true` plus `ThrottleInterval: 60` produces a restart loop with no process.

What the operator sees is `--status` printing `supervisor: LOADED, NOT RUNNING`, whose printed diagnosis (`plot-fleetctl.sh:384-386`) is "Most often a crash loop ... Read why before restarting: `.plot/logs/registryd.log`". That log will be empty, because nothing ever executed. The operator is sent to read a file that cannot explain anything, and the actual cause — a unit filled by the old code — is named nowhere.

Since the consumer is by construction someone who upgraded Plot to get this fix, this is the *expected* path, not an edge case. The slice should either add the stale-path case to that `loaded-not-running` diagnosis, or the plan should record in "What this does NOT do" that a consumer who installed a unit before this lands gets `LOADED, NOT RUNNING` with a misleading repair. Right now line 86 states the fact and leaves the consequence for the person who hits it.

## What would move me to proceed

1. The `.nvmrc` resolution (`:110`) is addressed in this slice or split out with a named decision — which repo's pin governs, and what a missing pin does. Leaving it silent re-creates the reported defect's class in the same function, one that fails quietly.
2. The gate in "Done when" (line 93) counts `$repo_root`-resolved reads of *anything Plot ships*, not only bundles — otherwise it holds at zero over a file that still has the bug.
3. One sentence under "What this does NOT do" naming the `Worker command` limit, so the reporter is not surprised by a supervisor with no working agents.
4. Item 3 adopts `plot-dispatch.sh:1955-1963`'s wording, and says both call sites (`:504` and `:517`) change.

None of these is large. The plan's analysis is sound and its chosen resolution is the right one; the amendment is about the two other `$repo_root` reads on the consumer's path and about telling the reporter where the fix stops.
