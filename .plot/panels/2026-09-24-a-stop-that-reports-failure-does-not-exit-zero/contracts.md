# Contracts lens — a stop that reports failure does not exit zero

Position: amend

## What I searched

- `grep -rn "plot-fleetctl"` over the whole tree (excluding `node_modules`, `.git`, generated bundles) — every mention, code and prose.
- `grep -rn "fleetctl.sh --stop|plot-fleet --stop"` over `*.md`, `*.sh`, `*.yml`, `*.mjs`.
- `grep -rn "fleet-start.done|start_marker"` — every writer and reader of the start marker.
- `packages/board/src/server/supervisor-reading.ts`, `packages/domain/src/rules/supervisor-reading.ts` — the board's consumer of the script.
- `test/reconcile/fleetctl.test.mjs`, `test/reconcile/controller-gate.test.mjs`, `.github/workflows/ci.yml`.
- `skills/plot-fleet/SKILL.md`, `skills/plot/scripts/plot-boardctl.sh` (the cited precedent).

## Who calls `--stop`, and what reads its exit code

**Nobody reads it programmatically today.** That is the headline finding and it cuts both ways.

| Caller | File:line | Reads the exit code? |
|---|---|---|
| `/plot-fleet` skill, step 5 | `skills/plot-fleet/SKILL.md:154` | No — the skill prints the output. Model Guidance says *"Print the output; it is already shaped for reading"* (`:60-63`). |
| `fleetctl.test.mjs` `stopempty` | `test/reconcile/fleetctl.test.mjs:293-298` | No — asserts on `r.out` only. |
| `fleetctl.test.mjs` `stoporder` | `test/reconcile/fleetctl.test.mjs:300-334` | No — asserts on `r.out` and call ordering only. |
| `fleetctl.test.mjs` bad `--wait` | `:207` | Yes, but that run refuses at argument parsing (`plot-fleetctl.sh:308`) and never reaches the stop arm. |
| Board (`readSupervisor`) | `packages/board/src/server/supervisor-reading.ts:53,105-120` | Reads the exit code — but of **`--status`**, never `--stop`. `SCRIPT` is run with `['--status']` and nothing else. |
| Controller endpoints / `plot-ask.mjs` | — | None. `test/reconcile/controller-gate.test.mjs:152-156` states it explicitly: *"`--stop` … [has] no endpoint"*. |
| CI | `.github/workflows/ci.yml` | No `--stop` invocation at all; the only `fleetctl` mention is a comment at `:212`. |
| Docs | `docs/release-2.14.0-test-list.md:91,101`, four plans, several briefs | All operator prose. None gates on `$?`. |

So the plan's motivating sentence — *"A caller reading the exit code recorded that run as a clean stop"* — **names a caller that does not exist on this estate.** The exit code of `--stop` is read by exactly zero automated consumers. That does not make the change wrong (an exit code is a contract whether or not it currently has a reader, and `plot-boardctl.sh --stop` already exits 1 on an unconfirmed kill at `:537`), but the plan's Motivation asserts an observed consequence it cannot point to. The *real* damage measured is the second half — the marker left behind and `--status` announcing a crash — and that damage flows entirely through the marker, not through the exit code.

**Amendment 1: restate the Motivation on the evidence.** Say that no caller reads it today and that the exit code is being made correct ahead of a reader, or drop the sentence about a caller recording a clean stop. A plan whose leading claim is unverifiable on the estate it ships into is the pattern `blast-radius.md` flagged on the 09-22 plan ("the plan's headline number is unverifiable from the repo, and it is the number a reader will quote").

## The ambiguity between the two non-zero paths

Today `exit 1` at `plot-fleetctl.sh:782` means exactly one thing: *at least one agent did not exit within the bound*. `skills/plot-fleet/SKILL.md:191` promises it in those words — **"Exit 1 says at least one did not exit."**

The plan adds a second `exit non-zero` for the supervisor and **says nothing about which code**. If it reuses 1, that sentence in SKILL.md becomes false: a caller reading 1 can no longer tell an unexited agent from an unconfirmed unload. The two need different actions — the first says *raise `--wait` or look in the worktree*, the second says *look at launchd, the supervisor may be wedged mid-tick*. They are also independently reachable in one run (three agents stuck **and** a wedged supervisor), so a single code loses information the run already has.

**Amendment 2: name the code, and make it distinct.** `exit 2` for the unconfirmed unload, 1 kept for the agents, and say what happens when both hold (I would take the supervisor's, because it is the condition that leaves a watcher running and a stale marker). Then amend `SKILL.md:191` — its sentence is currently a complete statement of the non-zero contract and the plan's "Done when" does not mention touching it.

## A third silent-failure path the plan does not see

`plot-fleetctl.sh:724-726`:

```
if ! "$script_dir/plot-dispatch.sh" --stop "$br" >/dev/null 2>&1; then
  printf ' ... refused by plot-dispatch --stop — see: plot-dispatch.sh --stop %s\n' "$br"
  continue
fi
```

The `continue` skips the wait loop, so `n_still` is **not** incremented — a branch whose stop was refused outright prints a failure line and contributes nothing to the exit code. `docs/plans/2026-09-07-a-dispatch-stop-finds-the-desk.md:32` measured this exact case live: *"`/plot-fleet --stop` reported two agents 'refused by plot-dispatch --stop'"*. Both desks existed; the run exited 0.

This is the same defect as the plan's, in the same arm, ten lines up: **printed failure, exit 0.** The plan's title is a general statement — *a stop that reports failure does not exit zero* — and its Done-when lists only the supervisor arm. Leaving this one behind means the title's own promise is false the day it ships.

**Amendment 3: either count a refused branch toward the non-zero exit, or state explicitly in "What this does NOT do" that it is out of scope and why.** Not noticing it is the problem, not the choice.

## Reusing `--wait` for the supervisor poll

`--wait` is documented per-worker in three places: `plot-fleetctl.sh:28` (*"seconds to wait for ONE worker to exit"*), `SKILL.md:43` (*"seconds to wait per worker"*), and the summary line at `:779` (*"did not exit within ${wait_bound}s"*). It is already an N-multiplied bound — a stop of 5 agents at the default can take 150 s before the supervisor is touched.

Reusing it is **defensible but it is a contract change**, and the plan treats it as free (*"the flag the stop already takes for agents"*). Two concrete consequences:

- **Worst-case wall time changes from N×wait to (N+1)×wait.** An operator raising `--wait 300` to rescue one slow worker now also waits five minutes for a supervisor that is not coming back.
- **The two bounds want different sizes.** 30 s is sized from *"the two measured here took 2.1 s and 0.4 s"* (`:287-291`) — a worker finishing a syscall. The plan's own Design says the supervisor's window *"scales with how stuck the job is, and has no bound this script can know"*; the failing case had a 41-minute tick. Sizing that from the worker measurement is the very error the plan correctly refuses for a fixed sleep, arriving by a different door.

I do **not** think a second flag is right — a stop with two bounds is a stop an operator gets wrong. What is right is a supervisor bound derived from `--wait` but stated: e.g. `min(wait_bound, 10)` or a fixed short poll ceiling, with the argument written down. The plan currently states neither the value nor the reasoning.

**Amendment 4: state the supervisor bound explicitly** — its value, whether `--wait` scales it, and one sentence of why that value. Then fix `SKILL.md:43` and `plot-fleetctl.sh:28`, both of which say "per worker" and would become incomplete.

## The marker: "keep it" traced through every reader

`.plot/state/fleet-start.done` has exactly three writers and one reader.

Writers: `:575` (`--start` clears it before the work), `:665` (`--start` writes it on success), `:772` (`--stop` removes it after a confirmed unload).

Reader: `fleet_install_state` at `:242` — and only in the `unloaded` + unit-file-present arm. `:236-240` tests `loaded` FIRST and never consults the marker, with a comment saying why. So the marker distinguishes `installed` from `interrupted` and nothing else.

That value flows to `supervisorState` (`packages/domain/src/rules/supervisor-reading.ts:236-244`), where `install === 'installed'` with exit 1 turns `down` into **`died`** → `FLEET STOPPED UNEXPECTEDLY` at `:359`.

**"Keep the marker on an unconfirmed unload" is correct for that reader, and the plan's reasoning holds.** If the supervisor genuinely did not unload, the recorded run is still live, and the two later readings are both right: while it stays loaded, `fleet_install_state` answers `running`/`loaded-not-running` and never looks at the marker; if it later goes away on its own, `died` is the honest word, because nothing successfully stopped it.

One residual the plan should name: **an unconfirmed unload that was in fact a slow success leaves the marker permanently.** Nothing re-checks. The operator's repair is a second `--stop`, which will then confirm and clear — but only if they run one, and the plan's own non-zero exit is what tells them to. That is a coherent story; it is not written down. **Amendment 5 (minor): add one line saying the marker is cleared by a later confirming `--stop`, and that this is why the non-zero exit matters more than the code.**

## What I could not determine

- Whether any downstream consumer outside this repository gates on `--stop`'s exit code. The estate has none; an adopting project could.
- The exact poll interval the plan intends. "a short interval" is all it says, and the test it promises ("a test drives both arms") cannot be written without one — the unconfirmed arm needs a stub that stays loaded for the full bound, which is a test that sleeps for `wait_bound` seconds unless the bound is small or injectable. `fleetctl.test.mjs` already routes every run through a stub `launchctl` in `guardBin` (`:81-147`), so the seam exists; the plan should say the stub stays loaded and the bound is passed low, or the contract suite gains a multi-second sleep.

## Nothing else of concern from this lens

The direction is right, the marker reasoning is sound, the refusal to escalate to `kill -9` is consistent with `plot-dispatch --stop` being the one stop rule (and deliberately unlike `plot-boardctl.sh:527`, which does escalate over a tree it proved is its own — a difference worth one sentence in the plan, since it cites boardctl as the precedent it follows). The claim that `--status`'s prose needs no change is correct: `supervisorVerdict` reasons from `install=`, and fixing the observation fixes the message.
