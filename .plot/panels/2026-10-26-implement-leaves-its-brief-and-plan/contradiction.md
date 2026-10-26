# Juror verdict — lens: contradiction

Plan: `docs/plans/2026-10-26-implement-leaves-its-brief-and-plan.md` at `f891832aa` (PR #2726, issue #2725). Code cited from `p2726-main` at `46dd1e5dd`.

Position: amend

## Summary

The plan rests on two causal claims, and the code contradicts both. First, fleetd does not read briefs from the main checkout: it reads `origin/<default>`, and a push from any worktree of the repository moves that ref locally. Second, the main-checkout gate does not apply to the implement run: the run's spawn sets `PLOT_MAIN_CHECKOUT_WRITER=1`, and the gate exempts it. The defect the operator saw (a dirty main checkout that refuses `git merge --ff-only` and conflicts on autostash) is real. The plan's explanation of why it happens, and its promise of what the fix buys ("fleetd reads the brief on its next tick"), are not supported. Option 3 proposes a change that already exists. The plan needs a rewritten Motivation, a corrected Changelog, and an investigation step for the refusal the agent reported, before it is approvable.

## 1. The problem — contradictions in the account

### C1. fleetd reads briefs from the ref, not the checkout (HIGH)

Plan, line 3: "leaves the same two files uncommitted in the main checkout, which blocks the fast-forward that would make the brief visible to fleetd."

Plan, line 17 (board-impact comment): "The board reads briefs from the main checkout through fleetd".

Plan, line 39 (option 3): "fleetd reads briefs from `origin/main` instead of the checkout".

Code, `packages/fleet/src/server/entry/registryd-main.ts:768-778` (read):

```
briefPresent: async (branch) => {
  const base = await refs.defaultBranch();
  ...
  const answer = refs.fileExistsSync(`origin/${base.value}`, `.plot/briefs/${suffix}.md`);
```

Code, `packages/fleet/src/shared/auto-dispatch.ts:333-336` (read): "The check reads `origin/main`, not the filesystem, so the board cannot be wrong about main even when its own checkout lags. The spike measured a checkout 20+ commits behind main, missing 7 briefs".

Code, `packages/domain/src/rules/auto-dispatch.ts:682-683` (read): "`no-brief` — every branch it could have started is missing a brief on `origin/main`."

So option 3 is the current behaviour, and Open Question 1 ("Option 3 ... changes how fleetd finds briefs") asks about a change that would change nothing. The main checkout's dirt cannot cause `no-brief`.

### C2. The `no-brief` evidence names a different slice, and that slice really had no brief (HIGH)

Plan, line 24: "`cc5c7a1d5` (brief for `nothing-done-asks-pr-state-only-where-it-decides`) ... fleetd's tick read `no-brief=1 handed=0` for the briefed slice until an operator fast-forwarded the checkout by hand."

fleetd.log (read, lines 32923-32984): every `held on no-brief (1):` entry in that window names `bug/fleet-start-probes-worker-writes`. In the same window `bug/nothing-done-asks-pr-state-only-where-it-decides` is held on `no-free-agent`, then logs `hand over to 18829489-...` and `handed to 18829489-...`. The slice that `cc5c7a1d5` briefed was handed, not held on `no-brief`.

`bug/fleet-start-probes-worker-writes` got its brief only in `8a714dee7`. The remote-tracking reflog (ran `git reflog show refs/remotes/origin/main`) shows `8a714dee7 ... 21:05:17: update by push`, and the `no-brief=1` lines stop at line 32984, a few ticks later (ticks cost 41-77 s). Before 21:05:17 the brief did not exist on `origin/main`, so `no-brief=1` was the correct answer and not a symptom of the dirty checkout. The operator's fast-forward of the main checkout ran at 21:06:07 (ran `git reflog show main`), about 50 s after the push, so timing alone cannot separate the two; C1's code reading does.

### C3. The untracked brief in the `cc5c7a1d5` case belongs to a different, earlier run (MEDIUM)

Plan, line 24: "the main checkout stayed 21 commits behind `origin/main` with an untracked brief."

Issue #2725 (read): "with an untracked `.plot/briefs/fleetd-holds-the-pr-index-lock.md`".

`git show --name-only cc5c7a1d5` (ran): the commit adds `.plot/briefs/nothing-done-asks-pr-state-only-where-it-decides.md`, not `fleetd-holds-the-pr-index-lock.md`. That brief came from `8f06bd8fc` at 20:26 (ran `git log -- .plot/briefs/fleetd-holds-the-pr-index-lock.md`). The plan drops the file name, which hides that the `cc5c7a1d5` occurrence is not "one implement run leaves its own copy".

The `cc5c7a1d5` run's own log (`plot-implement-an-idle-board-and-fleetd-spend.log`, read) also contradicts the copy mechanism for that run: "I wrote the commit in a temporary worktree off `origin/main` and removed it afterwards" and "I did not fast-forward the main checkout." It mentions no copy into the main checkout.

### C4. The gate the plan blames exempts this run by design (HIGH)

Plan, line 27: "the controller gate blocks git writes in the main checkout while `PLOT_UNATTENDED=1`. The agent commits from a temporary worktree, pushes, and copies the two files into the main checkout."

Plan, line 41: "the gate that blocks the agent's git writes is the reason the copy exists, so the repair must not route around it."

Code, `packages/fleet/src/shared/implement-run.ts:609-617` (read):

```
tree: opts.repoRoot,
...
PLOT_UNATTENDED: '1',
// The brief and the `Started:` record are committed in the main
// checkout by design, so the `main-checkout` gate allows this run.
[MAIN_CHECKOUT_WRITER_ENV]: '1',
```

Code, `packages/domain/src/rules/main-checkout-write.ts:32-33` (read): `gatesMainCheckout = (env) => env.PLOT_UNATTENDED === '1' && env[MAIN_CHECKOUT_WRITER_ENV] !== '1'`.

Code, `packages/board/src/server/entry/gate.ts:507-510` (read): "with `PLOT_MAIN_CHECKOUT_WRITER=1`, it allows everything and reads nothing ... the brief, implement, deliver, reslice and story runs whose spawn sets the marker, commit in the main checkout by design." The only arm that ignores the marker is the mixed-reset refusal (`gate.ts:521-522`, #2630).

`.plot/briefs/implement-restores-the-checkout.md:25` (read, on main) says the same: "`implement-run.ts:574` already sets `MAIN_CHECKOUT_WRITER_ENV=1` for this exact run, by design ... That gate is doing its job correctly here; it is not the defect ... Do not weaken or extend the gate as part of this fix."

The 2.28.1 plugin bundles the agent's hooks run from also carry the marker (ran `grep -l PLOT_MAIN_CHECKOUT_WRITER` over `~/.claude/plugins/cache/plot-marketplace/plot/2.28.1/skills/plot/scripts/board/*.mjs`: `plot-gate.mjs` matches).

So either the marker did not reach the agent's hook process, or the refusal the agent reported came from a different gate (the `8a714dee7` log, read, also says "The controller gate blocked read-only greps that only named the dispatch script", which is the controller gate, not the main-checkout gate — I hit the same controller-gate refusal on a read-only `grep` of `plot-dispatch.sh` during this review), or the agent chose the worktree because the checkout's `HEAD` was stale. The plan takes the agent's sentence as fact and builds its rationale on it. The cause is unverified, and the code contradicts it.

### C5. The direction of the "copy" is inverted against the skill (MEDIUM)

Plan, line 27: "commits from a temporary worktree, pushes, and copies the two files into the main checkout."

`skills/plot-implement/SKILL.md:129-130` (read): "`/api/implement` runs this skill's agent directly in the operator's main checkout, with no worktree of its own." `SKILL.md:221-223`: write the brief to `.plot/briefs/<branch-suffix>.md` "and commit it where the plan lives". `SKILL.md:248-254`: a disposable worktree is the recovery for a rejected push only.

The skill makes the agent write both files in the main checkout first. The leftover files are then the agent's original writes, which it carried into a disposable worktree, not copies it put back. The `8a714dee7` log (read) fits that: "the main checkout still has the two uncommitted edits, identical to what I pushed." Which way the files moved changes the fix: the leftovers come from the skill's own instruction, not from a post-push copy step.

## 2. The approach — contradictions with the code and the repo

### C6. Option 1 contradicts the skill and the spawn it does not name (MEDIUM)

Plan, line 37: "The agent commits and pushes from the temporary worktree and writes nothing into the main checkout."

`SKILL.md:34-36` (read): "`--brief-only` ... no checkout, no `git push -u`, no worktree". `SKILL.md:129` and `implement-run.ts:609` (`tree: opts.repoRoot`) run the agent in the main checkout by design. Option 1 is a reversal of both, and the plan names neither file.

### C7. "A controller the gate allows" misdescribes how the gate works (MEDIUM)

Plan, line 38: "runs `git merge --ff-only origin/main` in the main checkout through a controller the gate allows".

The gate is a PreToolUse hook on an agent's tool call (`gate.ts:503-533`, read), and it exempts by environment marker, not by controller identity. Code that the board or fleetd runs after the agent exits is never gated. `implement-run.ts:633` (read) already runs such a step: `restoreCheckedOutBranch(opts.repoRoot, startedOn, opts.scriptsDir)` checks the main checkout back out in the exit callback with no gate in the way. That is the existing post-run step Open Question 3 asks for, and the plan does not find it.

### C8. "A controller the domain owns" contradicts the layering rule (LOW)

Plan, line 41: "the step belongs in a controller the domain owns".

CLAUDE.md, "The Layering Rule": "controller → domain → port ← adapter". A controller calls the domain; the domain owns the port, not the controller. A fast-forward is a git write, so under the rule it is an adapter call behind a port, with the domain deciding whether the checkout may move.

### C9. A fast-forward of the main checkout contradicts the loop-restart rule the plan does not cite (MEDIUM)

`packages/domain/src/rules/loop-restart.ts:9-22` (read): a running worker loop decides whether to replace its own process image from the main checkout's state (`onDefaultBranch`, `scriptPathsClean`, `headContainsRunning`, `pinnedHash`). Project memory: "Fast-forwarding main restarts worker loops" and "The board does not reload its bundle". Option 2 moves the main checkout's `HEAD` while worker loops and the board run from it. The plan names neither effect, and its Safety question is absent.

### C10. Open Question 2 offers "skip silently", which the repo's rules refuse (LOW)

Plan, line 46: "refuse and name the files, or skip silently?"

CLAUDE.md, "The Master Agent Uses The Controllers": a refusal is named, never silent; `auto-dispatch.ts` (`PlanSkipReason` comment, read): "an absent capability is a named refusal, never an error." Plan line 38 already says the step "refuses by name". The question contradicts the plan's own option 2.

## 3. Changelog and acceptance

### C11. The Changelog promises an effect the change cannot cause (HIGH)

Plan, line 15: "`/api/implement` leaves the main checkout clean or fast-forwarded, so fleetd reads the new brief on its next tick without an operator step."

By C1, fleetd already reads the new brief on its next tick after the push moves `origin/main`, whatever the checkout holds. The slice acceptance (line 53) repeats the claim. A test of "fleetd reads the brief on its next tick" passes on current `main`, so it proves nothing about this change. The observable outcomes the change does own are: the main checkout carries no uncommitted brief or plan edit after the run, and `git merge --ff-only origin/main` in it succeeds (or the run reports why it did not).

### C12. Type and branch prefix contradict the subject (LOW)

Plan, line 8: `**Type:** feature`; slice branch `feature/implement-leaves-its-brief-and-plan`. The issue and the plan both describe a defect ("Observed", "Expected", "Gap"). The repo's `bug/` prefix exists for that (Plot Config "Branch prefixes").

## 4. Related plans and issues

- #2162 (read, OPEN — not Released, as the panel brief states): "`/api/implement` leaves the operator's checkout on the branch it found." Its fix is `restoreCheckedOutBranch` (`implement-run.ts:633`). The plan never mentions #2162, although that restore step is the natural home for a post-run clean-up and both touch the same checkout at the same moment.
- #2630 (read, OPEN): "A write in the main checkout starts from a fresh `origin/main`, not from a stale `HEAD`." This expects implement writes to stay in the main checkout, which option 1 removes. The plan does not cite #2630 or say which expectation wins.
- #2487 (read, OPEN): the main-checkout write gate's coverage gaps. It does not say the implement run is gated; the plan's gate claim gets no support there.

## Required amendments

1. Rewrite Motivation: state that fleetd reads briefs from `origin/<default>` (`registryd-main.ts:777`), drop the `no-brief` causation, and correct the `cc5c7a1d5` entry (the untracked file was `fleetd-holds-the-pr-index-lock.md` from `8f06bd8fc`).
2. Add a first step that finds what refused the agent's git calls despite `PLOT_MAIN_CHECKOUT_WRITER=1`, from the agent transcripts, before choosing a design. Name the result in the plan.
3. Remove option 3 (already shipped) and Open Question 1's framing.
4. Name the files each option changes: `SKILL.md:129`, `:221-254` and `implement-run.ts:609-633` for option 1; the `restoreCheckedOutBranch` exit step for option 2.
5. Address the loop-restart and board-bundle effects of moving the main checkout's `HEAD` while loops run.
6. Rewrite the Changelog and acceptance to the outcomes the change owns (no leftover files; a fast-forward that succeeds or a named refusal), and drop "fleetd reads the brief on its next tick".
7. Cite #2162 and #2630 and state how the chosen design agrees with each. Change the type to bug.
