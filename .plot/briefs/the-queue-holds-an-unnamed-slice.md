## Implementation brief — an-approved-slice-has-a-name (slice 2: The queue holds an unnamed slice)

- **Plan (canonical):** `docs/plans/2026-10-01-an-approved-slice-has-a-name.md` on `main`
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/the-queue-holds-an-unnamed-slice` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`. Do not run `gh pr create`.
- **Review of the code:** PR review, as for any slice in this repository.

This slice waited for `bug/approval-refuses-an-unnamed-slice`. That branch merged as #1189 on 2026-10-02, so the predicate this slice reuses is on `main`.

### What to build

Slice 1 stops a plan reaching `Approved` with a branch under no `###` heading. A plan approved before slice 1 can still hold one, and the supervisor hands that slice to an agent. The agent meets `slice-unnamed` in `openSlicePr`, writes the heading on its own branch, and the board shows `(unnamed)` until that PR merges (#1057).

Add a queue hold, `slice-unnamed`, so `matchQueue` keeps such a slice in the queue and assigns it to nobody. The hold word is the same word slice 1 uses for the approval refusal.

The predicate exists: `unnamedBranches(slices)` in `packages/domain/src/rules/slice-name.ts`. It takes `{ name, branches[] }` records, and `PlanRecord.slices` (`PlanRecordSlice`, `packages/domain/src/ports/plan-store.ts:59`) has that shape, so `queueOfPlan` passes `plan.slices` unchanged. Do not write a second predicate.

### The decisions the plan settles — do not re-derive them

**The hold needs a reading on `QueuedSlice`, and `queueOfPlan` takes it.** `whyNotReady` (`packages/domain/src/rules/queue.ts`) reads one `QueuedSlice` and nothing else, so the name must travel on the slice. Add a boolean to `QueuedSlice`, computed in `queueOfPlan` (`packages/board/src/server/queue-reading.ts`, around `:143`) from `unnamedBranches(plan.slices)`. `queueOfPlan` returns `Omit<QueuedSlice, 'briefPresent' | 'landed'>`, so the new field is set there and `readQueue`'s spread carries it. The rule stays pure: no I/O, no import of an adapter.

**Where `whyNotReady` tests it.** Test it after the two landing checks and before the brief check, and only for a slice that is otherwise claimable. Three measurements and arguments fix this:

- *After the landing checks.* A merged unnamed branch is finished. `queueOfPlan` already drops a settled branch (`settled(line)`), and `landed` is tested first in `whyNotReady` so that a finished slice never reads as `no-brief` or `not-claimable`. An unnamed finished slice must read `already-merged`.
- *Only when claimable.* `not-claimable` is the estate-wide hold (165 branches on this estate, `HOLD_SCOPE` in `entry/registryd-main.ts`). A slice that no plan makes startable yet is not the slice an agent would be handed. Naming it `slice-unnamed` would put the estate's whole backlog into a new hold and print it on every tick. The hold means *this slice would be handed over if it had a name*.
- *Before `no-brief`.* A slice with no name must not read `no-brief`, because the repair for that is to write a brief, and the brief writer would write one for a slice that then stays held.

**`HOLD_SCOPE` is a total `Record<QueueHold, 'estate' | 'queue'>`.** A sixth hold fails the build until it has a key (`packages/board/src/server/entry/registryd-main.ts`, the comment above it says so). Give `slice-unnamed` the scope `'queue'`: it applies only to claimable slices, so it is bounded by the queue and not by the backlog. Run the typecheck before anything else; it names every site that needs a key.

**`QUEUE_HOLDS` lists the new hold, and the tick line gains a key.** `registryd.ts:358` prints `<hold>=<count>` for every entry of `QUEUE_HOLDS`, with a zero where the hold did not fire, so the line keeps a constant shape (`QUEUE_HOLDS`'s own comment). Existing tests assert that line (`registryd-tick.test.ts`, `registryd-main.test.ts`) and several carry the literal five-hold list. Update them; do not weaken them. `holdCounts` builds its record from `QUEUE_HOLDS`, so it needs no change.

**The plan's "the board renders the hold word" has no board surface to land on, and this is measured.** On `origin/main` no file under `packages/board/src/client` or in the board payload names a queue hold: `no-free-agent`, `already-merged` and `no-brief` occur in `packages/domain/src/rules/queue.ts`, `workflows/assign.ts`, `entry/registryd.ts`, `entry/registryd-main.ts` and `auto-dispatch.ts`, and in no client file. The plan also states *No payload field is added*. So the word reaches the operator through the supervisor's tick line and its held enumeration. Satisfy the Done-when through those, and say so in the PR body: the Done-when sentence said "the board" for a surface that is the supervisor log. Do not add a payload field or a client component to make the sentence literally true. If you believe a board surface is owed, report it and name the file.

**Rejected: reading the plan from a feature branch, naming a row from a PR title or a branch name, changing `/plot-implement`, and changing the PR link.** The board reads the main ref on purpose. `slice-pr.ts` refuses a branch name as a title for the same reason. The link already resolves by head and is out of scope. `plot-dispatch.sh --next` and `auto-dispatch.ts` are different dispatch paths with their own readings; the plan scopes this slice to the supervisor's queue. If you find that one of them still hands out an unnamed slice, report it and do not fix it here.

**Rules carried over unchanged.** *Absent is not false*: a plan with no `## Slices` section has no slices, so the new reading is `false` for nothing and the queue is unchanged. *Silence must not promote work*: `queue-reading.test.ts` pins that a host that cannot answer holds the slice. This slice only adds holds and never removes one. A deferred branch is skipped by `queueOfPlan` already (`if (line.deferred) continue`), so the deferred rule matters for the approval (slice 1) and is not the queue's concern; do not add a deferred test here that asserts a hold on a branch the queue never lists.

### Done when

The plan's `## Done when` list is the specification. The lines this slice owns:

- The queue holds such a slice as `slice-unnamed` and hands it to nobody, asserted in the domain test for `matchQueue` (`packages/domain/test/queue.test.ts`).
- The hold word reaches the tick line, asserted in the registryd tick tests (see the decision above for why this is the surface).

The assertions a naive implementation passes without:

- **Order test, landing first.** An unnamed slice with `landed: 'landed'` reads `already-merged`, and with `landed: 'unknown'` reads `merge-unknown`. A hold tested first would hide a finished slice behind a naming problem.
- **Order test, claimable gate.** An unnamed slice with `claimable: false` reads `not-claimable`. It catches a hold that moves the estate's backlog into the new word.
- **Order test, before the brief.** An unnamed, claimable slice with no brief reads `slice-unnamed`, not `no-brief`.
- **Named slice unchanged.** A named slice behaves exactly as before in every existing `matchQueue` case. Run the whole `queue.test.ts` and do not edit an existing expectation except the five-hold lists.
- **Reach test.** One `queue-reading.test.ts` case builds a `PlanRecord` whose approved plan holds a branch in a slice with `name: ''`, runs `readQueue`, and expects the hold. It catches the dead-rule failure this repository keeps measuring (`setSprintState` had nine refusals and no caller): a domain test that is green while `queueOfPlan` never sets the field.
- **Total scope map.** `HOLD_SCOPE` compiles with the new key. A test that every hold in `QUEUE_HOLDS` has a scope already exists or belongs beside the registryd tests; check before adding one.
- **No new host call.** The reading is a property of the plan record. `queue-reading.test.ts` counts host calls on its cases; the new cases leave those counts unchanged.

Plus the repository gates. Before each push run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. It selects the domain and board related tests and the typechecks (`pnpm --filter @plot-pm/domain exec tsc --noEmit -p .` and `pnpm run typecheck`). The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Run `pnpm build:board` so the committed `skills/plot/scripts/board/plot-registryd.mjs` matches its source: it bundles `rules/queue.ts`, and CI's no-diff gate compares it. Run on Node 24 (`nvm use`). A function you write is an arrow. TSDoc states what an export does, not why the decision was made; the reasoning goes in the commit message. Add a changeset with the description first and the `bumps:` block last. Copy the format from `.changeset/the-queue-reads-the-merge-subject.md` on `main`: `'@plot-pm/board': patch` for the code, and `'plot': patch` with a `bumps:` block because the registryd bundle ships under `skills/plot`.

### Bookkeeping

Open the PR with `plot-open-pr.sh`, then append `→ #<number>` after the `PR:` in this slice's heading in the plan's `## Slices` section on `main`, the way slice 1's heading carries `PR: #1189`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/queue.ts`, `packages/board/src/server/queue-reading.ts`, `packages/board/src/server/entry/registryd.ts`, `packages/board/src/server/entry/registryd-main.ts`, the tests that assert them, the rebuilt `plot-registryd.mjs` and one changeset. It reads `packages/domain/src/rules/slice-name.ts` and does not change it.

**Two branches in flight hold the same files, and this is a known collision.** Checked against `origin/main` and the remote branches on 2026-10-02:

- `bug/the-queue-reads-the-scans-order` (no PR yet) carries 12 changed files, including `rules/queue.ts`, `workflows/assign.ts`, `registryd-main.test.ts`, `registryd-tick.test.ts`, `queue.test.ts` and the `plot-registryd.mjs` bundle.
- `bug/a-held-slice-names-the-unanswered-landing` (PR #1197, open) adds a hold to `QueueHold` and `QUEUE_HOLDS`, and edits `queue-reading.ts`, `registryd.ts` and `registryd-main.ts`.

Whichever merges second rebases onto the other. Expect conflicts in the `QueueHold` union, in `QUEUE_HOLDS`, in `HOLD_SCOPE` and in the tick tests' hold list, and a conflict in the bundle. For the bundle, take either side, run `pnpm build:board` and commit the result; never read its diff. Do not reorder the existing holds to make a merge easier: `QUEUE_HOLDS` is "the order a reader should scan them", which is the order `whyNotReady` tests them. After a rebase, re-run the typecheck, because a hold added by a sibling fails `HOLD_SCOPE` until it has a key.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
