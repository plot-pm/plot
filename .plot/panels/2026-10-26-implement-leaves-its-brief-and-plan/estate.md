# Juror verdict: estate lens

Plan: `docs/plans/2026-10-26-implement-leaves-its-brief-and-plan.md` at `f891832aa`. Code read at `origin/main` `46dd1e5dd` (worktree `p2726-main`). Lens: maintainer of the implement controller, the controller and main-checkout gates, and fleetd's brief check.

Position: amend

The symptom is real: implement runs leave copies in the main checkout, and nothing advances that checkout. But the plan's causal chain is wrong in two of its three links. A slice built from it would fix the wrong component and could pass its own acceptance without changing anything.

## 1. The problem

**fleetd does not read briefs from the main checkout. It reads `origin/<default>`.** (read)

- `packages/fleet/src/server/entry/registryd-main.ts:768-779`: `briefPresent` calls `refs.fileExistsSync(\`origin/${base.value}\`, \`.plot/briefs/${suffix}.md\`)`. The queue's `no-brief` hold (`packages/domain/src/rules/queue.ts:590`) depends only on that reading.
- `packages/fleet/src/shared/auto-dispatch.ts:60` (`findMissingBriefs`) reads `'origin/main'`. Its own comment says *"This is why we read git"*. `skills/plot/scripts/plot-dispatch.sh:548` (`brief_present`) reads `origin/<main>` too.
- Design option 3 ("fleetd reads briefs from `origin/main`") is therefore already the code. The plan's summary line, the Board-impact comment ("The board reads briefs from the main checkout through fleetd") and the Open Question about option 3 all rest on a false premise.

**The `no-brief` evidence in the issue is misattributed.** (read, from `.plot/logs/fleetd.log` and the reflogs)

- The `held on no-brief` lines from about line 32800 on name `bug/fleet-start-probes-worker-writes`, and for a while also `feature/fleetd-holds-the-pr-index-lock`. They never name `bug/nothing-done-asks-pr-state-only-where-it-decides`. That slice appears only as `held on no-free-agent` (line 32954) and is then handed over (32957). The issue's second item says the briefed slice read `no-brief=1` until a hand fast-forward. The `1` was `fleet-start-probes-worker-writes`, whose brief did not exist until `8a714dee7` at 21:05:15. That hold was correct.
- `fleetd-holds-the-pr-index-lock`: its brief `8f06bd8fc` reached `origin/main` by push at 20:26:27 (remote-tracking reflog). fleetd handed it over at line 32858, before the operator's first fast-forward at 20:55:43 (`main` reflog). So the brief became visible without any update to the checkout.
- `fleet-start-probes-worker-writes`: brief pushed 21:05:17, checkout fast-forwarded 21:06:07, claim ref created 21:06:57. With ticks at 42-77 s, the log cannot tell which event released it. The `origin/main` read alone explains it.

**What does depend on the checkout is the plan list, not the brief.** (read) `packages/domain/src/adapters/plan-store/plan-store-shell.ts:184-197`: `listPlans` runs `find docs/plans …` with `cwd: context.repoRoot`, and `readPlans` reads files from the working tree. Registryd builds its queue from that list (`registryd-main.ts:753-758`). A plan approved on the host (`9f2513068`, 20:38, approves `an-idle-board-and-fleetd-spend`) is invisible to the queue until the checkout advances. The checkout was at `ea2aa9743` until 20:55:43. This is the likely reason `nothing-done-asks…` sat in `not-claimable` and became claimable only after the hand fast-forward (inference: the log does not name not-claimable branches). This lag also applies to every approval or delivery merged on the host, with or without an implement run. A fix that only fast-forwards after `/api/implement` does not cover it.

**Why the agent copied instead of committing: a stale board, not the gate's design.** (read and ran greps)

- On main, the implement run is a declared main-checkout writer. `packages/fleet/src/shared/implement-run.ts:614-617` sets `PLOT_MAIN_CHECKOUT_WRITER=1` (added in `da7097509`, 2026-10-22, #2317). `gatesMainCheckout` (`packages/domain/src/rules/main-checkout-write.ts:32-33`) exempts that marker, and the installed plugin 2.28.1's `plot-gate.mjs` honours it (grep shows `vp=e=>e.PLOT_UNATTENDED==="1"&&e[ok]!=="1"`).
- The board that spawned these runs is pid 23604, started **2026-10-20 09:33** (`ps`). The `board-server.mjs` on `origin/main` at that time (`42922051b`) contains `PLOT_MAIN_CHECKOUT_WRITER` 0 times and `PLOT_BRIEF_ONLY` 0 times. Today's bundle contains each once (ran `git show … | grep -c`). The board does not reload its bundle. So it spawns implement runs without the marker, the 2.28.1 gate refuses them (transcript `e4166d74…jsonl` holds the `main-checkout-gate: … PLOT_UNATTENDED=1 marks the caller as an unattended agent` refusal), and the agent improvises a disposable worktree. fleetd (pid 8692, started 2026-10-17) is equally stale for `brief-ask.ts:163`'s marker.
- The plan's Motivation repeats the agent's account ("the controller gate blocks git writes … while `PLOT_UNATTENDED=1`") as the design. On current code that block does not happen. The plan must name the version skew. Otherwise the fix lands in the same stale process and does nothing until somebody restarts the board.

**The copies come from step 4's order, which the plan does not name.** (read) `skills/plot-implement/SKILL.md:224-262` writes the brief and the `Started:` line into the checkout first, then fetches and commits. A refused `git restore` leaves the copies. With the marker present and a `HEAD` that is behind, the same steps commit locally on the stale `main`, the push is rejected, and the skill re-cuts in a disposable worktree (`:248-262`). That leaves a **local commit on `main` that diverges from `origin/main`**. This is worse than untracked copies: `--ff-only` refuses it forever. The skill fetches but never fast-forwards before writing, although a marked writer may run `git merge --ff-only`. The plan must address this path. It is the one current code takes.

**Is the checkout the right source?** For briefs, no, and the code already agrees. For plans, the board already moved to the ref (`docs/plans/2026-08-27-the-board-reads-the-ref-not-the-checkout.md`). fleetd's plan store did not. That gap is the structural cause of "nothing happens until someone pulls".

## 2. The approach against the code

- The plan offers three options and picks none. One option already exists (option 3, for briefs). It cites no file or line in the code. It names no owner.
- **Owner, if the checkout must advance:** the implement run's end handler, `implement-run.ts:628-639`, which already calls `restoreCheckedOutBranch` (`:494`, through `treesGit(...).checkoutSync`). A fast-forward belongs there, after the restore, through a new `Trees` port operation. The `Trees` port has no fast-forward operation today (grep of `ports/` and `adapters/`). A raw `spawn('git', …)` in `packages/fleet/src` would trip *One place reaches a process* (`.github/workflows/ci.yml:1224`, `allowed=11`). Precedent for the shape: `docs/plans/2026-10-21-fleet-work-leaves-the-main-checkout.md` settled *"Where a command must advance `main`, it either updates the tree with the ref (`git merge --ff-only`) or does not touch a checked-out branch"*.
- **Better owner for the lag:** fleetd's plan store reading `origin/<default>` the way the board does. That removes the dependency for approvals, deliveries and briefs alike, and needs no write to the operator's checkout. The plan should weigh this against the fast-forward, not against a brief read that already exists.
- **Skill fix:** step 4 should fast-forward (`git merge --ff-only origin/<default>`) or write in a disposable worktree **before** it writes any file in the checkout. The skill is prose, so a rule. Pair it with the end-handler check as the gate.
- **Gate conflict:** none with the main-checkout gate when the board is current: the marked writer may merge. The mixed-reset arm (`gate.ts:526`, `gatesStrandingReset`) is unaffected by `--ff-only`. #2162: the fast-forward must run after `restoreCheckedOutBranch`, and only when the restored branch is the default branch. #2630: the skill's re-cut path is what produces the divergent local commit described above. The plan must say how a diverged `main` is reported (refuse by name, never reset).

## 3. Safety

- `git merge --ff-only` with a dirty tree does not discard work: git refuses when a dirty file would be overwritten, and otherwise carries the changes along. The plan's open question ("refuse and name the files, or skip silently?") must be answered *refuse and name*. A silent skip reproduces today's state with no signal.
- **Path that moves the operator off their branch:** a fast-forward that runs before `restoreCheckedOutBranch`, or that runs on whatever branch is checked out. The plan must state the order (restore first) and the branch condition (only the default branch; otherwise do nothing and say so).
- **Running board:** a fast-forward changes `board-server.mjs` on disk under pid 23604, which keeps serving the old bundle. That is today's state after any hand pull, but the plan should say the board stays stale.
- **Worker loops:** `packages/domain/src/rules/loop-restart.ts:86-111` restarts a loop on a newer bundle in the main checkout only during a free wait (`phase === 'later' && !inFreeWait` → `stay`). That restart guard is newer than the 2026-10-15 memory, so the risk is smaller than the memory says. A desk mid-slice is not cut off. The plan should cite this and add a test that a fast-forward during a working desk restarts nothing.
- **Concurrent writers:** two implement runs end close together. Each end handler fast-forwards. `--ff-only` is idempotent, but the plan should state that the implement lock (`takeImplementLock`) covers the fast-forward.

## 4. Slices against Changelog and acceptance

- Slice acceptance reads *"fleetd reads the brief on its next tick"*. Current code already meets this whenever the push lands, because fleetd reads `origin/<default>`. The acceptance cannot fail, so it proves nothing.
- A checkable acceptance: after `/api/implement` exits 0, `git -C <main> status --porcelain` lists no file the run wrote, and `HEAD` either equals the commit that holds the brief or is unchanged with a named refusal in the run log. A test runs the run in a sandbox whose `main` is N commits behind its origin, with an untracked operator file present.
- The Changelog line is observable and fine once the acceptance matches it.
- One slice is too coarse if the plan adopts the plan-store-reads-the-ref fix. That fix is its own slice with its own board/fleet tests.

## 5. New defects and misses

- **Version skew is undetected.** Nothing tells the operator that board pid 23604 runs a 6-day-old bundle that lacks a gate marker. The plan should at least name it. A probe at spawn time is cheap: the run could log the `PLOT_MAIN_CHECKOUT_WRITER` value it received.
- **Hardcoded default branch:** `auto-dispatch.ts:60` reads `'origin/main'` literally, while `registryd-main.ts:777` resolves `refs.defaultBranch()`. An adopting repository on `master` would read every brief as missing on the auto-dispatch path. This is adjacent to the plan, and the plan must not copy it: any fast-forward target must come from the configured default branch. Plot is project-agnostic, and Bitbucket repos in this estate are a live case.
- **Layering:** the fast-forward goes controller → domain decision (may this checkout advance: on default branch, not diverged, no overlap with dirty files) → `Trees` port → adapter. A shell step in `plot-implement` or `plot-worker-loop.sh` would add shell lines under `scripts/check-shell-lines.sh` and duplicate a rule (*A Shell Script Asks The Domain*).
- **Tests the plan omits:** a domain unit test for the advance decision (clean / dirty-disjoint / dirty-overlapping / diverged / off-default-branch); an implement-run test that the end handler restores, then fast-forwards, in that order; a skill corpus or contract check that step 4 fast-forwards before it writes.
- **Gates the change must pass** (read from CLAUDE.md `Local checks`): `check-plan-headings.sh`, `check-changeset-packages.sh` (package `plot` or `@plot-pm/board`; the fleet package needs care), `check-host-cli-callers.sh` (no new `gh`/`bb`), `check-bash32-syntax.sh` if any shell changes, and the spawn ratchet above.
- **The `d315381c6` item** is history from an earlier run. The 18:48 agent log says it wrote nothing because the brief already existed on `origin/main`. It is evidence that stale copies outlive their run, not a separate occurrence of the defect.

## Named changes before approval

1. Correct the Motivation: fleetd reads briefs from `origin/<default>` (`registryd-main.ts:777`). Drop option 3 as written, and correct the Board-impact comment.
2. Name the real causes: (a) board pid 23604's bundle predates the `PLOT_MAIN_CHECKOUT_WRITER` marker in `implement-run.ts:617`; (b) `SKILL.md` step 4 writes before it fast-forwards, and its re-cut path leaves a divergent local commit; (c) fleetd's plan store reads the working tree (`plan-store-shell.ts:184`).
3. Pick an owner and argue it: the end handler at `implement-run.ts:628` through a new `Trees` op, and/or fleetd's plan store reading the ref. Answer the dirty-tree question with *refuse and name*. State the order relative to `restoreCheckedOutBranch` and the default-branch condition.
4. Replace the acceptance with a checkable end state (porcelain and `HEAD` after the run), tested against a behind-by-N sandbox with an operator file present.
5. Note that a fix in the board or fleetd reaches the operator only after a restart, and add the spawn-time marker log line.
