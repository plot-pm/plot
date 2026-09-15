## Implementation brief — the-supervisor-log-has-a-ceiling

- **Plan (canonical):** `docs/plans/2026-09-15-the-supervisor-log-has-a-ceiling.md` on `main`
- **Approved:** 2026-09-15, jwloka, in-session (four challenge rounds)
- **Branch:** `infra/the-supervisor-log-has-a-ceiling` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention
- **Issue:** #916 (first half only — `--stop` is deliberately out of scope)

Sole slice of a one-wave plan. Nothing waits on it and it waits on nothing.

### What to build

`.plot/logs/registryd.log` is **69,776,046 bytes** — re-verified on this machine at 20:51 on 2026-09-15, having grown another 5 MB while the plan was drafted. `board.log` beside it, same machine, same week, same kind of long-lived daemon, is **16,745 bytes**. The daemon is not busy; it is verbose. Its CPU over 3.5 days is 3 min 52 s.

Make the **looping** daemon print its counted tick summary without the per-branch enumerations, while `--once` keeps printing everything it prints today. Three emitters re-emit per tick in proportion to something that grows, and all three must be fixed or the ceiling leaks.

The plan is canonical; this orients you and records what must not be re-derived.

### The paths in the plan are one directory off — verified 2026-09-15

The plan cites `registryd-main.ts` and `registryd.ts` under `packages/board/src/server/`. **They live in `packages/board/src/server/entry/`.** Every other citation — the line numbers, the constructs, the behaviour — was re-verified against the real files and holds exactly as written. This is a stale path in the plan, not a moved target: do not go looking for a refactor that explains it.

Current, verified line references:

| The plan says | Actually at | What it is |
|---|---|---|
| `registryd.ts:376-391` | `entry/registryd.ts:376` | `unclaimedLines` |
| `registryd-main.ts:843` | `entry/registryd-main.ts:843` | where `unclaimedLines` is printed |
| `registryd-main.ts:205` | `entry/registryd-main.ts:205` | the latent manifest emitter |
| `registryd-main.ts:781` | `entry/registryd-main.ts:781` | `readRegistry` per tick |
| `queue.ts:205-209` | `packages/domain/src/rules/queue.ts:206-207` | `merge-unknown` before the claimable split |
| `landed.ts:60-68` | `packages/domain/src/rules/landed.ts:60` | `unknown` on an unaskable host |

### The decisions the plan settles — do not re-derive them

**`reportTick` cannot currently tell `--once` from the loop, and that is the whole change.** `entry/registryd-main.ts:824` takes exactly `(report, write, warn)`. Line 793 calls it inside the loop; line 802 then decides whether to return. **One code path serves both.** The comment at `:850-853` says *"the looping daemon prints the counts on its summary line and stops there"* — that describes behaviour **the code it annotates does not implement**. You are honouring an existing documented rule, not inventing a quieter one. Expect to thread the distinction through the signature.

**Do not reach for a module-level flag or an env var to carry it.** All nine existing tests import `reportTick` and call it directly (`test/unit/registryd-main.test.ts:313-365`). A flag set by `run` is invisible to them, which makes the byte-identical gate unprovable by the only tests that can see the function. The distinction must be a parameter.

**Rotation is not the fix, and the reason changed between drafts — use the current one.** An earlier draft said launchd owned the write so rotation was impossible. **That is false**: `com.plot-pm.registryd.plist:71-72` does set `StandardOutPath`, but the running daemon reaches the log by another route. Do not repeat the dead argument. The live reason is that a rotation caps a file while the daemon goes on emitting lines nobody reads, and then needs its own maintenance — a quieter tick needs no second mechanism. Rotation stays available as a complement; this plan adds none.

**The volume is TWO re-emissions, and an earlier draft named only one.** The held-slice enumeration is the bulk. `unclaimedLines` is **38,174 lines / 7,132,536 bytes / 10.26%** — `/private/tmp/plot-baseline` 2,539×, `.worktrees/free-b2023483` 6,413×. Its own comment at `:836-842` justifies the volume by claiming the unclaimed trees "were twelve at their worst … so a looping daemon can name each one without ever writing a line nobody wants." **7.1 MB falsifies that comment.** Gating only the held block drops the log to ~9.5 MB and leaves nine scratchpad paths a minute under a comment promising it does not. Fix both, and fix the comment.

**The third emitter contributes zero bytes today and must still be gated.** `entry/registryd-main.ts:205` warns once per unparseable manifest, inside `readRegistry`'s per-name loop, and `readRegistry` runs every tick (`:781`). Zero occurrences in the current 69 MB log — which is exactly why two rounds of classifying log output missed it. It was found by enumerating every `write(`/`warn(` site instead. **One malformed file in the agent registry makes it a permanent per-tick emitter.** It is proportional to the **registry**, not the estate, so its test must grow the number of unparseable manifests; a "grow the estate" test can never fire on it.

**Four hold classes are kept and capped; only `not-claimable` loses its enumeration.** An earlier draft proposed deleting all five to fix one. `not-claimable` is a hold over the whole estate's backlog — 165→~200 branches re-enumerated 7,333 times — and that one class is the volume. The other four are holds over the **queue**: small, churning, and what a debugger reads at 3am.

**The kept four are capped rather than exempted, because a host outage is an unbounded case.** `queue.ts:206-207` tests `merge-unknown` **second**, before the claimable split, and `landed.ts:60` returns `unknown` for every slice when the host cannot be asked. **One host outage moves the entire queue into a kept class** — measured peak here, 574 slices. Each kept class names its branches up to a bound, then `… and N more`.

**`QUEUE_HOLDS` is iterated generically at `:860`.** It holds five members in order: `already-merged`, `merge-unknown`, `no-brief`, `not-claimable`, `no-free-agent`. A hard-coded `=== 'not-claimable'` string test works today and silently re-opens the hole when a sixth estate-wide hold is added. Prefer a shape a reviewer can see is total over the enum.

**The gates bound proportionality, not growth — and the plan says so deliberately.** After both re-emitter fixes the residual is a fixed **262 B/tick** (summary 207, held-header 31, supervision 24) × 1,440 ticks/day × 365 = **131 MB/year**, larger than the 69 MB file that prompted the plan. An implementation satisfying every gate still leaks. **This is stated, not hidden, and it is not yours to fix.** No file in this slice writes the log — the daemon prints to stdout and the file belongs to a hand-started `>>` loop. A byte gate here would name a write this branch does not perform, and the likeliest guess — a filesystem sink in `registryd-main.ts` — is what a reviewer rejects on layering. The ceiling's owner is `plot-fleetctl.sh`, which prints the log path at `:509` and owns the unit templates. **Do not add a filesystem sink, a rotation, or a byte cap to this branch.**

**What this slice promises is exact:** the log stops growing **with the estate**. It does not stop growing.

**Carried over unchanged:** a `no-brief=0` in the summary is a measurement and a missing key is not — absent is not false. The counted summary keeps every key it has today.

### Done when

The plan's `## Done when` (plan lines 206-224) is the specification. Those assertions exist because a naive implementation passes without them:

- **Three proportionality tests, each growing ONE input** — held-branch count, undispatched-worktree count, and **unparseable-manifest count** — asserting the line count does not follow. The third is the one a "grow the estate" test could never fire, since `:205` is proportional to the registry and emits zero bytes today.
- **`unclaimedLines` bounded, pinned separately.** It is 10.26% of the bytes and an earlier draft missed it; a single combined test lets a partial fix pass.
- **574 slices pushed into `merge-unknown`**, the measured peak one host outage produces, asserting the line count stays bounded. Catches an implementation that keeps the four classes uncapped.
- **The four queue-level classes still name their branches**, pinned explicitly. Catches over-deletion — the failure mode of the draft that deleted all five.
- **`--once` output byte-identical**, pinned. This is the path a person runs deliberately.
- **The counted summary keeps every key**, pinned by a key-set assertion.
- **A tick that cannot complete still reports its reason**, unchanged — stderr, exit 1 (`:828-831`).

Plus the repo's gates: `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board` (rebuilds the artifact), `pnpm run typecheck`, and a changeset. **Not `test:e2e`** — that is CI's gate, never a local one.

Node 24 (`nvm use`) before any pnpm command; pnpm crashes outright on Node 26.

The changeset names package `@plot-pm/board` with the description **first** and any `bumps:` block **last** — a `bumps:` block written first becomes the published release note.

**Not in the gates:** the existing 69 MB file. Removing it is an operator action on their own disk; name the command, do not run it.

### Bookkeeping

Open the PR through the controller:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while work is moving
```

**Do not run `gh pr create`** — it takes the title from the last commit subject, which on this estate is routinely `plot: build the board artifact`.

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`.

Push the first real commit as soon as it exists.

### Scope guard

This branch owns:

- `packages/board/src/server/entry/registryd-main.ts` — `reportTick`, `readRegistry`'s warn at `:205`
- `packages/board/src/server/entry/registryd.ts` — `unclaimedLines`
- `packages/board/test/unit/registryd-main.test.ts` and siblings
- the rebuilt `skills/plot/scripts/board/plot-registryd.mjs` artifact

**Out of scope, named so you do not drift into them:** `plot-fleetctl.sh` (owns the follow-up byte ceiling), `board.log` (16 KB — the control, not a problem), `--stop`'s inability to reach a detached supervisor (issue #916's second half, its own defect with its own cause), and the domain rules `queue.ts` / `landed.ts`, which are read as evidence here and not changed.

On a conflict in the board artifact: do not read the diff. It is generated output marked `-merge`. Take either side, run `pnpm build:board`, commit the result.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
