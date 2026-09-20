## Implementation brief — one-exit-code-one-answer (The port answers partial)

- **Plan (canonical):** `docs/plans/2026-09-20-one-exit-code-one-answer.md` on `main`
- **Approved:** 2026-09-20, jwloka, in-session
- **Branch:** `bug/the-port-answers-partial` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention

Sole slice of the plan. Nothing waits on it and it waits on nothing.

### What to build

`plot-host.sh` exits **7** for a partial `pr-list` — several states asked, some answered, some did not — and the rows the answering states printed are on stdout. The `Scripts` port learned to read that in #951. **The host port did not.** `host-shell.ts`'s `record()` sends 7 through `refusalKindOfExit`, which knows only 5 and 6 and returns `'failed'` for everything else; the rows are then discarded by `resultOf`. Teach the host port to keep them.

This is a defect in merged work of mine. The panel that reviewed #951 asked about callers and I answered for `plot-fleet-scan.sh` — the caller the issue named — and not for the port.

**It is a contract gap, not a live symptom.** Do not go looking for a broken screen to confirm the fix; there is none, and the plan's Design section records the three refutations that killed the causal claim. `prList`'s only consumer today is `registryd-main.ts:436`, a merge-queue reading that renders no rows. The value is that the next caller to take the multi-state route through the port gets rows instead of a refusal. The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**`PortResult` gains no fourth arm.** A `partial` arm would reach every consumer of every port. The partial answer is expressible with what the port already has: the rows travel through the normal answered arm, the sentence through `lastRefusal()`, which the port already exposes. The plan states this and the `Done when` list checks it.

**The two adapters must NOT be made to agree about meaning.** An earlier draft demanded that; it is wrong, and `ports/host.ts:254` names the mistake — *"lifting a sentence onto every filesystem port"*. `host-shell` is a **connector** and answers *how long to wait*, so it splits 5 into `throttled` and 6 into `secondary`. `hostSaid` in `scripts-shell.ts` is the generic `Scripts` port and collapses both to `failed`, because it carries no limit vocabulary. Forcing agreement lifts connector words onto every filesystem port. **What is shared is the NUMBERS** — one file naming which integer is which condition, and each adapter keeps its own reading of what that condition means for its callers.

**The duplication the earlier draft cited does not exist.** `scripts-shell.ts` defines no exit constants; it uses bare literals (`run.code === 7`, `=== 4`). So the shared module is worth writing on its own merits, not as de-duplication — and writing it means `scripts-shell.ts` gains imports where it had literals.

**There is no second slice.** A draft proposed making a failed `pr-list` state return to the collector rather than `exit`, believing the `exit` ends the run. It does not: `pr_list_call` runs inside a command substitution, so the `exit` leaves a **subshell** and the code is captured and classified. `plot-host.sh` documents this twice, at `:518` and `:569`, in the two function headers the draft quoted from. `test/reconcile/host.test.mjs:1038` already pins it, under the banner *"A PARTIAL ANSWER IS NOT AN OUTAGE (#912)"*.

**Seven hypotheses were refuted before this one** — three spot-checked by a juror and all three holding: the empty shim directory, 19 KB against a 10 MB `maxBuffer`, and concurrency. They are recorded in `.plot/panels/2026-09-20-one-exit-code-one-answer/`. Do not re-run them.

### What the plan leaves to you, with the readings taken

**`record()` has two outputs and exit 7 is wrong in both.** `host-shell.ts:191` sets `refusal` from `refusalKindOfExit(run.code)` *and* returns `resultOf(run, parse)`. Fixing only `refusalKindOfExit` still loses the rows, because `resultOf` discards stdout. Read both before editing either.

**`resultOf` lives in `adapters/run-script.ts:210` and is shared by seven adapters.** Its own docstring enumerates the codes it knows and states that any other code is `failed`, on the stated grounds that guessing `unaskable` turns a broken call into a confident "there is none". Teaching **it** about 7 hands every port a partial reading it never asked for. The fix belongs in `record()`, which is host-shell's own.

**Settle what `lastRefusal()` returns on a partial.** `ports/host.ts:265` documents it as *"the last refusal, or null where the last call answered"*, and `record()` currently nulls it on 0 and 4 only. A partial both answers and has something to report, so whichever you pick, the test says so out loud — this is the line a later reader will otherwise re-litigate.

**The shared file must not be named so that CI's `ports/` rule claims it.** `ci.yml:591` asserts every `packages/domain/src/ports/<name>.ts` has a matching `adapters/<name>/` directory. A file dropped in `ports/` fails that check for a reason unrelated to this work. The plan names this constraint; the gate is at `ci.yml:583-597`.

**Exit 7 is unreachable through `prList` by construction.** `prList(state, limit)` passes one state (`ports/host.ts:207` — `state: string`, singular), and `plot-host.sh:587` states that with one state asked, *"some answered and some did not"* is unreachable. A stubbed run confirms it: `--state merged` against a failing host exits **3**. So the new test pins the **adapter's reading of the code**, through a stubbed `plot-host.sh` that exits 7 anyway — it does not pin a route the port can reach today. Say that in the test, or the next reader deletes it as unreachable.

### Done when

The plan's `## Done when` list is the specification. Lifting the assertions that exist because a naive implementation would pass without them:

- **`record()` keeps the rows on exit 7**, pinned by a test with a PATH-stubbed `bb` that fails one of three states. Catches the half-fix that maps the refusal kind and still returns `failed` from `resultOf`.
- **`refusalKindOfExit(7)` no longer returns `'failed'`**, pinned — **it has no test today, so this writes the first one.** Catches a change that is invisible because nothing asserts the old behaviour.
- **`PortResult` gains no new arm and its consumers are untouched** — stated and checked. Catches the fourth-arm reflex the plan rejected.
- **Exits 3, 5 and 6 are byte-identical in behaviour, pinned per code.** Catches a refactor of `refusalKindOfExit` that quietly widens or narrows the two known codes. `host-shell.test.ts` already covers 1, 3, 4, 5 and 6 — extend that corpus rather than starting a parallel one.
- **`prList`'s single-state route is unaffected**, since 7 is unreachable there by construction.
- **The exit codes are defined in one file both adapters import**, naming the numbers only, whose name does not collide with `ci.yml`'s `ports/` rule.

Plus the repo gates: `pnpm run test:contracts` passes (the plan names it), `pnpm test`, `pnpm run typecheck`, and a changeset. `nvm use` first — pnpm crashes on Node 26. **Do not run `pnpm run test:e2e`**; it is CI's gate, not a local one.

Style: `packages/domain/**` is arrow functions, and TSDoc states what an export does — the reasoning goes in the commit message and the plan, not the comment block.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while the work moves
```

When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/adapters/host/host-shell.ts`, the new shared exit-code file, the import sites in `packages/domain/src/adapters/scripts/scripts-shell.ts`, and `packages/domain/test/host-shell.test.ts`.

`adapters/run-script.ts` is shared by seven adapters — read it, do not change it. `plot-host.sh` is not in scope: its exit-7 behaviour is already correct and already pinned.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
