# A start step leaves no claim and no desk

> The implement step that `/api/dispatch` and `/api/implement` run claims the slice's branch and cuts a checkout for it, then stops. Under the registry model nobody works that claim: the supervisor holds the slice as claimed, and when it is later handed out, the agent cannot check out a branch the leftover checkout holds.

## Status

- **State:** Delivered
- **Approved:** 2026-10-02, jwloka, in-session
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1090, #1151
- **Review:** in-session
- **Impl:** own branches
- **Started:** 2026-10-02, Jan Wloka, `bug/a-worker-less-checkout-yields-its-branch`
- **Delivered:** 2026-10-02

## Changelog

- The implement step a dispatch runs writes the brief and the `Started:` record and stops. It pushes no claim and cuts no checkout, so the supervisor hands the slice to a free agent.
- An agent handed a slice whose branch a clean, worker-less checkout holds removes that checkout and takes the branch. A checkout that holds work, a marker or a live worker is kept, and the agent writes a `PLOT-BLOCKED` that names it.

## Motivation

Measured 2026-10-01 on this repository:

- **The implement step claims and cuts a desk.** `.worktrees/plot-implement-a-merge-subject-proves-a-landing-the-host-cannot.log` ends: *"Claim: I pushed `bug/the-merge-subject-is-one-rule` to `origin`, cut from `origin/main` at `142ae697`"* and *"Desk: the work happens in the worktree `.worktrees/the-merge-subject-is-one-rule`"*. It then stopped, as `/plot-implement` step 3 instructs (`skills/plot-implement/SKILL.md:140-149`): push the claim, then *"hand the brief to the implementing session"*.
- **The supervisor then holds the slice.** `claimedBranches` (`packages/board/src/server/entry/registryd-main.ts:554-562`) reads every remote branch as claimed, and `queueOfPlan` (`packages/board/src/server/queue-reading.ts:144-172`) drops a claimed branch from the queue. Three slices of this sprint (`bug/the-merge-subject-is-one-rule`, `bug/a-closed-sprint-stops-filtering`, `bug/the-tally-names-its-tickets`) sat at `142ae697` with no worker until their refs were released by hand.
- **The checkout stops the agent it is handed to (#1151).** After the release, the supervisor handed `bug/the-merge-subject-is-one-rule` to agent `11945014`. `reset_desk` (`skills/plot/scripts/plot-worker-loop.sh:884-893`) runs `git checkout -b "$branch"`, then `git checkout "$branch"`; git refuses both while another worktree holds the branch, and the board row read *held in a local worktree*. The leftover checkout was clean: no change, no commit, no `.plot-worker.*` file. After `git worktree remove`, the agent took the branch on its next manifest read.
- **Every dispatch runs the implement step.** `/api/dispatch` calls `/plot-implement` before the dispatch script on every request (`packages/board/src/server/dispatch.ts:356-372`, the brief gate), and `composeImplementPrompt` (`packages/board/src/server/implement.ts:122-124`) asks only *"Run /plot-implement <slug> and follow it."* So auto-dispatch repeats the claim each time it fires. #1090's own comment of 2026-09-30 records the same repeat at `efa5192e`.

The board half of #1090 shipped in v2.22.0 (`a-slice-nobody-worked-on-reads-not-started`, #1106 and #1108): an empty claim no longer reads as delivered. This plan does not change it.

## Design

### Approach

**Slice 1: the implement step stops at the brief.** `/plot-implement` gains a `--brief-only` mode. In that mode it runs its preflight (steps 1 and 2), writes the hand-off brief (step 4) and the `Started:` record (step 5), and skips step 3: no checkout, no claim push, no worktree. `composeImplementPrompt` asks for `Run /plot-implement <slug> --brief-only and follow it.`, so both callers, `/api/dispatch` and `/api/implement`, run the brief step only. The claim belongs to the agent the supervisor hands the slice to: the loop pushes it at take-up (`plot-worker-loop.sh:2270` and the push after it).

The `Started:` record stays. The board derives *Ready* against *In progress* from it (`packages/board/src/server/board.ts:1004`), and a plan whose brief is written is in progress. The record names the slice's branch, as today.

`/plot-implement` run by a person without the flag keeps its step 3: a person who claims a branch is about to work it, and that claim is legitimate. The skill text says that the claim then belongs to the session that pushed it, and that a supervisor never works it.

**Slice 2: a checkout that yields its branch.** A new domain rule, `checkoutYield` in `packages/domain/src/rules/checkout-yield.ts`, answers whether a worktree that holds a branch may be removed so that an agent handed that branch can take it. It takes readings and answers `{ yields: true }` or `{ yields: false, condition }`. The conditions, tested in this order, reuse the words `rules/reapable.ts` and `desk_reset_refusal` already use:

| Condition | Reading | Source in the shell |
|---|---|---|
| `live-worker` | the checkout's `.plot-worker.pid` names a live process | `plot-worker-state.sh` |
| `blocked-marker` | a `PLOT-BLOCKED*` file exists | `plot_worker_blocked` |
| `uncommitted-changes` | `plot_worker_dirty` is not empty | `plot_worker_dirty` |
| `unpushed-commits` | the checkout's `HEAD` has commits its upstream does not | `rev-list --count @{upstream}..HEAD` |
| `registered` | an agent manifest names the checkout's path | the registry directory |
| `main-checkout` | the checkout is the repository's main worktree | `git worktree list --porcelain` |

A reading the shell could not take is `unknown`, and an `unknown` reading keeps the checkout. The rule is pure and vendor-free, and its unit tests cover every row and the `unknown` case at 100% branch coverage.

The shell asks it through one bundle, `skills/plot/scripts/board/plot-checkout-yield.mjs`: readings on stdin as one tab-separated line, the answer on stdout as `yields` or `keep\t<condition>`, exit 2 for unreadable input. The loop asks it only when `reset_desk` fails because another worktree holds the branch, which is once per take-up and never per pass, so the cost rule in `docs/shell-and-domain.md` permits the call.

`reset_desk` changes in one place. When both checkouts in step 2 fail, the loop reads the holding path from `git worktree list --porcelain`, takes the readings, and asks the bundle. On `yields` it runs `git worktree remove "<path>"` without `--force`, logs *"removed the worker-less checkout at <path> that held <branch>"*, and retries step 2 once. On `keep` it leaves the checkout as it is and writes a `PLOT-BLOCKED` in its own desk that names the path, the branch and the condition. A bundle that cannot be asked keeps the checkout and writes the same marker with the condition `unaskable`.

### What this does NOT do

- **It does not release a claim a person left.** A ref pushed by a person who runs `/plot-implement` without the flag stays claimed; `plot-dispatch.sh --release` is the repair, and #1152 covers its race with the supervisor.
- **It does not touch the queue.** `claimedBranches` still reads every remote branch as claimed. After slice 1, the dispatch path pushes no ref, so there is nothing new for it to misread.
- **It does not remove a checkout that holds a different branch.** Slice 2 acts only on the worktree that holds the branch the agent was handed.
- **It does not change the board half of #1090**, which shipped in v2.22.0.

### Open Points

- `/api/implement` today offers the operator an Implement action. With slice 1 it writes the brief and `Started:` only. If an operator expects that button to cut a desk for in-session work, the button's label needs a separate change; this plan only states the new behaviour in the button's capability reason.

## Slices

### The implement step stops at the brief (Branch: bug/the-implement-step-stops-at-the-brief, PR: #1173)

`--brief-only` in `skills/plot-implement/SKILL.md` (step 3 skipped, its Model Guidance row and its unattended lines updated, `README.md` beside it), `composeImplementPrompt` in `packages/board/src/server/implement.ts`, the capability reason that names the Implement action's effect, and a `plot-implement` minor bump plus an `@plot-pm/board` patch in one changeset. Tests: a unit case that `composeImplementPrompt('x')` contains `--brief-only`; the existing dispatch test at `packages/board/test/dispatch.test.mjs:448` asserts the prompt argument its stub implement receives carries `--brief-only`.

### A worker-less checkout yields its branch (Branch: bug/a-worker-less-checkout-yields-its-branch, PR: #1198)

`rules/checkout-yield.ts` with its unit tests, the bundle `board/plot-checkout-yield.mjs` and its entry under `packages/board/src/server/entry/`, its line in `packages/board/build.mjs` and `.gitattributes`, the `reset_desk` change in `plot-worker-loop.sh`, a row in `CLAUDE.md`'s Helper Scripts table for the bundle, and an `@plot-pm/board` patch changeset. Tests: a contract test in `test/reconcile/` holds the branch in a clean worker-less worktree, hands the slice to a stub loop, and asserts the loop checks the branch out and logs the removal; a second case holds it in a worktree with an uncommitted file and asserts the worktree survives and the marker names `uncommitted-changes`.

The two slices are independent: slice 2 also clears a checkout a person's `/plot-implement` left, so neither waits on the other.

## Done when

- A dispatch through `/api/dispatch` leaves no remote ref and no worktree for the slice, and the supervisor's next tick hands the slice to a free agent. The dispatch test proves the prompt; one run on this repository after the merge confirms the ref and the worktree are absent.
- `checkoutYield` answers each condition in the table and `unknown` keeps, at 100% branch coverage.
- The loop takes a branch a clean worker-less worktree held, and leaves a worktree with work in it untouched with a `PLOT-BLOCKED` that names it.
- `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board` and `pnpm run typecheck` pass.

## Notes

- Measured cases: `142ae697` (2026-10-01, three slices of `the-fleet-runs-through-its-limits`), `efa5192e` (2026-09-30, #1090's comment), and agent `11945014` blocked by `.worktrees/the-merge-subject-is-one-rule`.
