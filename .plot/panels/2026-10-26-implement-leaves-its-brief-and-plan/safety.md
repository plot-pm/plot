# Juror verdict: safety

Lens: the operator whose main checkout the fix touches. Plan read at `f891832aa`; code read at `origin/main` `46dd1e5dd` in `p2726-main`.

Position: amend

The plan leaves its design open between three options, and one of them (option 2, fast-forward the main checkout after the push) can move an operator's branch and swap bundles under a running board and fleetd. The plan names none of these hazards. The evidence also points away from the plan's stated cause, and the code already does what option 3 proposes. The plan needs a settled design that writes nothing to the main checkout, or explicit guards if it keeps option 2.

## 1. The problem

- **The plan's cause conflicts with the code (read).** The plan says the main-checkout gate blocks the implement agent's git writes. But `packages/fleet/src/shared/implement-run.ts:617` sets `PLOT_MAIN_CHECKOUT_WRITER=1` on every implement run, and `packages/board/src/server/entry/gate.ts:507-524` with `packages/domain/src/rules/main-checkout-write.ts:32-33` exempts that marker. The marker landed in `da7097509` (#2317, 2026-10-22). The installed plugin gate 2.28.1 also contains the marker (ran: grep over `~/.claude/plugins/cache/plot-marketplace/plot/2.28.1/skills/plot/scripts/board/plot-gate.mjs`).
- **A likely real cause is a stale process (ran `ps`, inference not proven).** The running board (`board-server.mjs`, pid 23604) started 2026-10-20 and fleetd (`plot-fleetd.mjs`, pid 8692) started 2026-10-17. Both predate #2317. Memory says the board does not reload its bundle. A spawn from a pre-#2317 board would lack the marker, and the gate would then refuse as the logs say. The plan must establish which process spawned the three runs before it builds anything.
- **The agents' logs confirm the symptom (read).** `plot-implement-an-agent-refused-every-write-ends.log` says "The main-checkout gate refused every git command there under `PLOT_UNATTENDED=1`" and asks the operator to `git restore` the plan and delete the brief. `plot-implement-an-idle-board-and-fleetd-spend.log` says the agent committed from a temporary worktree and did not fast-forward. `plot-implement-one-pr-reader-per-machine-and.log` says the agent found byte-identical local copies and refused to discard them, which is the correct safe behaviour.
- **fleetd does not read briefs from the main checkout (read).** `packages/fleet/src/server/entry/registryd-main.ts:768-778` asks `refs.fileExistsSync(origin/<default>, .plot/briefs/<suffix>.md)`. `skills/plot/scripts/plot-dispatch.sh:546-552` asks `git cat-file -s origin/<main>:.plot/briefs/<suffix>.md`. Both read the remote-tracking ref, not the working tree or `HEAD`. So option 3 is already the code, and a main checkout 21 commits behind cannot by itself cause `no-brief=1` in current code. The plan's Board-impact comment ("The board reads briefs from the main checkout through fleetd") is wrong on this point. Why `no-brief=1` appeared (ran: grep `fleetd.log`, lines 32947-32978) is not explained; candidates are a stale `refs/remotes/origin/main` or the 2026-10-17 fleetd process. The plan must name which.

## 2. Ownership and conflicts

- The plan does not pick an owner. It lists three options and defers to Open Questions. From the safety lens, option 1 (write nothing into the main checkout) is the only option with no path to operator damage, and it matches the gate's purpose (#2311, #2487).
- **Conflict with #2162 (read).** `implement-run.ts:597` captures `startedOn` and `:633` runs `restoreCheckedOutBranch`, a `git checkout <startedOn>` in the main checkout after the agent exits (`:494-498`). Its docstring (`:485-488`) assumes the agent leaves no uncommitted change "by the main-checkout gate's own contract". The writer marker removes that contract for implement runs, and the three occurrences prove the agent does leave changes. A fast-forward added to the same exit callback inherits this: if the operator switched branches during the run, the restore moves them back to `startedOn` before any ff. The plan does not mention this step.
- **Conflict with #2630 (read).** Any "update main" step must not be a ref-only move (`update-ref`, `fetch origin main:main`, mixed `reset`). Those leave the tree behind `HEAD`. The plan does not forbid them.

## 3. Safety paths

Each path below is a way option 2, as written, damages the operator.

1. **Moves a non-default branch (ran).** In a scratch repo, `git merge --ff-only origin/main` on branch `feat` fast-forwarded `feat` to `origin/main`. The command fast-forwards whatever branch is checked out. The plan's step "runs `git merge --ff-only origin/main` in the main checkout" must first check that `HEAD` is the default branch and that `HEAD` is an ancestor of `origin/<default>`, and refuse by name otherwise. A detached `HEAD`, a rebase or a merge in progress (`MERGE_HEAD`, `rebase-merge/`) must also refuse.
2. **Removal of the copies discards operator work (read, issue #2725 and agent log).** Occurrence 3 needed the copies removed before the ff. A step that "cleans" the copies before the ff can delete an operator's own edit to the same plan file. Removal is safe only where the working-tree file is byte-identical to the blob on `origin/<default>`, compared per file, and only for the two paths the run wrote. The plan's Open Question "refuse and name the files, or skip silently" must resolve to refuse-and-name; a silent skip is the failure mode the fleet exists to avoid.
3. **ff never overwrites, so refusal is the remaining risk (ran).** `git merge --ff-only` refused with "untracked working tree files would be overwritten" rather than overwriting. Git itself does not discard work here. The risk is any wrapper that retries with `--autostash`, `stash`, `checkout --`, `reset --hard` or `clean`. Occurrence 1 shows `git pull --autostash` already conflicted on the plan's `Started:` lines. The plan must forbid stash, autostash and hard reset in the main checkout.
4. **Swaps code under a running board and fleetd (ran `ps`, read memory).** The board and fleetd run from `/Users/jwloka/Quatico/Agentic-Tools/plot/skills/plot/scripts/board/*.mjs`, the main checkout. An unattended ff rewrites those bundles and every shell script fleetd spawns from that path. The running node processes keep their old code while their children run new scripts, which is a version skew no test covers. Memory also says a main fast-forward restarts worker loops. Today an operator chooses when to fast-forward; option 2 makes it happen at an arbitrary implement exit. The plan must either not ff, or ff only when no board, fleetd or worker loop runs from the main checkout, and say how it detects that.
5. **Concurrent runs (read).** Two implement runs can exit close together. Each would ff the same checkout. Git's `index.lock` makes the second fail rather than corrupt, but the plan must say the second refuses by name rather than retry destructively.

Option 1 has none of these paths. Option 3 is already true for brief presence, so it adds no new write either.

## 4. Slice, Changelog and acceptance

- The one slice ships an observable result only if fleetd's `no-brief` is actually caused by the checkout, which the code says it is not (section 1). The acceptance "fleetd reads the brief on its next tick" is checkable from `fleetd.log`, but a fix to the checkout cannot move it while fleetd reads `origin/<default>`.
- The Changelog promises "clean or fast-forwarded". "Fast-forwarded" is the unsafe half. A safety-checkable acceptance is: after an implement run, `git status --porcelain` in the main checkout is identical to before the run, and `HEAD` and the checked-out branch are unchanged.
- A code fix in the board or fleetd reaches the running processes only after a restart (memory: the board does not reload its bundle). The acceptance must name that restart, or it will read as failed on this machine.

## 5. Missed items

- **Tests.** No test is named. Option 1 needs a test that an implement run under `--brief-only` leaves `git status --porcelain` of the starting tree unchanged. If option 2 survives, it needs tests for: non-default branch refuses, dirty overlapping file refuses and names it, operator-edited plan file is never removed, in-progress rebase refuses.
- **Gate.** The cheapest gate for option 1 already exists: the main-checkout gate. If the copies are written by `cp` (log: "I reran it with `/bin/cp -f`"), the gate does not see them, because it gates git commands only. The plan should state whether the skill text (`skills/plot-implement/SKILL.md:248-256`, the disposable-worktree recovery) needs a sentence that the run copies nothing back, or whether a hook gates file writes into the main checkout.
- **Layering.** A ff step belongs behind the `Trees` port as an adapter call, invoked by the controller, not in skill prose and not in a new shell script (`check-shell-lines.sh` would charge it).
- **Project-agnostic.** The ff target must be the configured default branch (`refs.defaultBranch()`), never a literal `main`. Bitbucket has no effect here because no host call is involved.
- **bash 3.2.** Not relevant if the step lives in TypeScript; relevant if anyone adds it to `plot-worker-loop.sh` or a launcher.

## Named amendments

1. Establish the cause: which process spawned the three runs, and whether it carried `PLOT_MAIN_CHECKOUT_WRITER=1`. Quote the spawn's environment or the board's start time against #2317.
2. Explain `no-brief=1` against `registryd-main.ts:768-778`, which reads `origin/<default>`, and correct the Board-impact comment.
3. Choose option 1 (no write to the main checkout) as the design, or, if option 2 stays, add the guards in section 3 items 1-5 as acceptance criteria.
4. Reconcile with `restoreCheckedOutBranch` (`implement-run.ts:494-498`, `:633`) and its stale docstring.
5. Replace "clean or fast-forwarded" in the Changelog with "the main checkout's status, `HEAD` and branch are unchanged by an implement run".
