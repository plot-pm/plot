# Panel round 1 — moderation

Subject: `docs/plans/2026-10-26-implement-leaves-its-brief-and-plan.md` at `f891832aa` (#2725, plan PR #2726, Draft). Jurors: safety, estate, rootcause, contradiction. Gate: all four committed (exit 0). Reconcile: `unanimous amend`.

## Evidence basis

All four read the code on `origin/main` `46dd1e5dd`. Three ran evidence: `ps` and `lsof` on the board and fleetd, `git show` of the bundles those processes started from, the reflogs of `main` and `refs/remotes/origin/main`, and greps of `fleetd.log`. Rootcause read the three implement transcripts. Safety reproduced `git merge --ff-only` on a non-default branch in a scratch repository. No juror ran a test.

## Findings all four share

1. **fleetd reads briefs from `origin/<default>`, not from the main checkout.** `registryd-main.ts:768-779` and `plot-dispatch.sh:546-552` read the remote-tracking ref, which a push from any worktree moves at once. The plan's option 3 is the current code, and its Board-impact comment is wrong.
2. **The issue's `no-brief` evidence is misattributed.** Every `held on no-brief` line in the window names `bug/fleet-start-probes-worker-writes`, whose brief did not exist until `8a714dee7` (21:05:17). The slice that `cc5c7a1d5` briefed was held on `no-free-agent` and then handed over. The untracked file in that occurrence (`fleetd-holds-the-pr-index-lock.md`) came from another run (`8f06bd8fc`).
3. **The gate the plan blames exempts this run by design.** `implement-run.ts:617` sets `PLOT_MAIN_CHECKOUT_WRITER=1`, and `gatesMainCheckout` allows it. The refusals in the transcripts come from version skew: the board (pid 23604, started 2026-10-20) and fleetd (pid 8692, started 2026-10-17) run bundles that predate the marker (`da7097509`, #2317, 2026-10-22), while every agent session loads the current plugin gate. The spawner sends `PLOT_UNATTENDED=1` without the marker, the gate refuses, and the agent improvises.
4. **The leftovers are the agent's own first writes.** `SKILL.md` step 4 writes the brief and the `Started:` line into the main checkout, then commits. When the commit is refused, the agent moves the work to a disposable worktree and the original writes stay behind; the gate then also refuses the cleanup.
5. **The acceptance cannot fail.** "fleetd reads the brief on its next tick" holds on current code. A checkable acceptance is the main checkout's `git status --porcelain`, `HEAD` and branch unchanged by an implement run.

## Findings three jurors share

6. **A fast-forward of the main checkout (option 2) adds a writer under the running board, fleetd and worker loops** (safety, rootcause, contradiction). It moves a non-default branch if one is checked out (safety ran it), swaps bundles under the board, and under skew would run in the stale controller anyway. Estate keeps it as a possible owner with guards (default branch only, after `restoreCheckedOutBranch`, refuse and name on overlap).
7. **The `restoreCheckedOutBranch` docstring (`implement-run.ts:485-488`) is false under skew** and must change with the fix; the plan never cites #2162's restore step (estate, safety, contradiction).

## Single-juror findings worth keeping

- **Estate:** the real dependency on the checkout is the **plan list**, not the brief. `plan-store-shell.ts:184-197` runs `find docs/plans` in the working tree, so a plan approved on the host is invisible to fleetd's queue until the checkout advances. That fits `nothing-done-asks-…` sitting in `not-claimable` until the hand fast-forward. The board already reads plans from the ref (`2026-08-27-the-board-reads-the-ref-not-the-checkout`); fleetd's plan store does not.
- **Estate:** `auto-dispatch.ts:60` reads `'origin/main'` literally; an adopting repository on `master` reads every brief as missing on that path.
- **Rootcause:** the same marker gap affects every marker-dependent role (deliver, reslice, story, auto-deliver, brief-ask, continuation), not only implement. Nothing detects a spawner older than the gate.
- **Contradiction:** the plan is a bug (`Type: feature`, `feature/` branch should be `bug`); #2162 and #2630 are still OPEN and must be reconciled.

## Disagreement: who owns the fix

- **Rootcause and safety:** option 1 only. A `--brief-only` run writes and commits only in a disposable worktree; the main checkout stays byte-for-byte unchanged; the writer marker becomes unnecessary for brief runs, so a stale spawner cannot reproduce the failure.
- **Estate:** fix the lag structurally, with fleetd's plan store reading `origin/<default>` like the board, and, if the checkout must advance, a guarded fast-forward in the implement run's end handler through a new `Trees` port operation.

These are not exclusive. Option 1 removes the leftovers; the plan-store change removes the queue lag that made the leftovers matter.

## Shared blind spot

All four found that the running board and fleetd are 6 and 9 days older than the code on main. None asked what else the operator is running stale: every fix merged since 2026-10-20 that lives in the board or fleetd bundle (including today's #2718 lock and the slices now in flight) reaches this machine only after a restart. The immediate remedy for the incident is a board and fleetd restart, which the plan does not name and which needs the operator's go.
