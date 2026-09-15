# Round 3 — the readiness lens

My question is not *can I find something*. It is **would I hand this to an agent tomorrow and expect a correct branch back**. I read all three prior files, then verified the amendment's new claims against the code myself.

**The plan changed on disk while I was reading it.** I read the `Rounds: 2` version first; by the time I inspected `reportTick` the file was `Rounds: 3` and carried two new sections (`Proportionality is not a ceiling`, `A kept class has an unbounded case`) plus a rewritten `Done when`. **Everything below judges the round-3 text**, which is what an implementer would receive.

## 1. The new claims verify

| Amended claim | What I ran | Verdict |
|---|---|---|
| `registryd-main.ts:205` is per-tick and registry-proportional | `sed -n '190,215p'` — the `warn` sits inside `readRegistry`'s `for (const name of names)` loop, one line per unparseable manifest. `:782` wires `registry: () => readRegistry(registryDir, warn)` as the tick's closure, and `:776-781`'s own comment says *"THE REGISTRY IS RE-READ HERE, at the top of every tick"* | **TRUE**, exactly as described |
| It contributes zero bytes today | `grep -c "is not a manifest this parse understands"` → **0** | **TRUE** — latent, not active |
| The daemon has seven emitters | **Under-counted.** `grep -n "write(\|warn(\|console\.\|process\.stdout\|process\.stderr"` returns emitting sites at `:205`, `:688`, `:697`, `:712`, `:721`, `:830`, `:833`, `:836`, `:843`, `:848`, `:863`, `:864`. Round 2's enumeration covered `reportTick` and `:205` but **collapsed four `startAgents` sites into one row** | **The count is wrong; the conclusion is not** — see §2 |
| The four non-`reportTick` emitters are bounded | Checked structurally, not by observation. `:688`/`:697` iterate `report.handOver.writes` filtered to `agent-assign` — bounded by `taken` (`assign.ts:124`). `:712`/`:721` iterate the same filtered to `worker-start`, which `assign.ts:140-149` emits as `(input.fleet?.desks ?? []).slice(0, scaling?.start ?? 0)` — **bounded by the fleet cap**. Log counts: 0, 0, 0, and 15 | **TRUE, and now proved by construction rather than by absence** |
| Each of the three gates fires on its own input | `reportTick` is exported and pure over a `TickReport`; the held gate grows `report.handOver.detail.held` (`:861`), the unclaimed gate grows what feeds `unclaimedLines(report)` (`:843`) — **different fields, so gate 2 cannot be satisfied by reusing gate 1's fixture**, which was round 2's §4-route-2 worry and is now closed. Gate 3 is over `readRegistry`, reachable independently | **TRUE** |

**One citation correction that matters to an implementer, in both prior rounds and inherited by the plan's reasoning:** there is no `packages/board/src/server/entry/registryd-main.test.ts`. The tests are at **`packages/board/test/unit/registryd-main.test.ts`**, with **8** `reportTick` call sites (rounds 1 and 2 said eleven), all three-argument, at lines 313–365. The line numbers coincide; the path does not. An agent told to edit the cited path finds nothing.

## 2. Is there a FOURTH? — the completeness re-check

I did the enumeration round 2 did, with the wider grep the rubric names (`console.`, `process.stdout`, `process.stderr` included).

**No fourth unbounded emitter exists.** The full set is twelve sites, not seven, and the four round 2 folded together are the `startAgents` pair at `:688`/`:697` and `:712`/`:721`. I checked the two paths the rubric flagged specifically:

- **`:836` agent supervision** — iterates `report.decision.detail.agents` with `if (verdict === 'leave') continue`. Bounded by registered agents.
- **`:848` hand-over** — iterates `report.handOver.detail.assignments`. Bounded by assignments.

Neither is estate-proportional. **`:205` remains the only latent one, and the plan names it.** On completeness the remedy is now closed, and I would not spend a fourth round here.

Two notes an implementer should have and the plan does not give:

- **`:712`'s `unaskable` warn is per `worker-start` item per tick**, and a repository with no `Worker command` produces one line per queued start every tick, forever. It is bounded by the fleet cap, so it is not a leak — but it is the shape closest to `:205` among the four "bounded" ones, and it is worth a sentence so nobody re-discovers it as a fifth.
- **`:830` sends the incomplete tick line to `warn`.** Under the bash loop's `2>&1` that lands in the same file; under the plist it lands in `registryd.err`. The gate *"a tick that cannot complete still reports its reason, unchanged"* is therefore about a different sink, and `registryd.err` is 0 bytes — the gate has never fired in production.

## 3. Walking the `Done when` as an implementer — and the one defect that blocks

I can build gates 2–7. Gate 1, as written, **cannot be built in the slice the plan names**, and gate 2 contradicts a later clause of the same sentence.

### (a) The byte ceiling has no owner in this branch — this is the blocker

The new first gate reads:

> *the log has a **stated ceiling in bytes** and a tick that would exceed it truncates rather than grows, pinned by a test*

**The daemon cannot do this.** Measured:

- `registryd-main.ts:751` — `write: (s: string) => void = (s) => process.stdout.write(s)`. That is the daemon's only sink.
- `grep -n "createWriteStream\|openSync\|appendFile"` over `registryd-main.ts` → **nothing**. The daemon never opens a file.
- `grep -rn "registryd.log"` over `skills/` and `packages/` (non-test) → **three hits, none of them code that writes**: `units/README.md:57` (a `tail -f` example), `com.plot-pm.registryd.plist:72` (the unsubstituted template), and `plot-fleetctl.sh:509` (an `echo` naming the path in `--status`).

So **nothing in this repository owns the file**. The path exists only because a hand-started `bash -c while true; … >> .plot/logs/registryd.log 2>&1` (PID 91960, PPID 1) chose it — which is the plan's own round-1 correction. A daemon writing to stdout cannot know its own size, cannot truncate, and has no filename to truncate.

**Where the ceiling would actually have to live is outside the slice**: the plist/systemd unit templates, `plot-fleetctl.sh`'s start path, or a rotation helper. The slice line names exactly one thing — *"have the looping daemon print the counted tick summary without the per-branch lists"* — and the branch is `infra/the-supervisor-log-has-a-ceiling`.

This is not a quibble about wording. **An agent handed this plan tomorrow has three bad options and no good one:** invent a file sink inside the daemon (wrong layer, and `registryd-main.ts` reaching a path is exactly what the stdout design avoids); silently widen scope into the unit templates and `plot-fleetctl.sh` that the slice does not mention; or skip the gate. Rounds 1 and 2 each measured that the *previous* gate could be satisfied while leaving the log growing; round 3 fixed that by adding a gate **that the named branch cannot satisfy at all**. The failure moved rather than closing.

The fix is small and it is a plan edit, not a rebuild: either **name the second slice** that puts the ceiling where the writer is (unit templates plus `plot-fleetctl.sh`, which already prints the path at `:509` and is the natural owner), or **state the residual honestly** — 262 B/tick, and amend the Changelog's *"stops growing without bound"*, which is the sentence round 2 correctly said would publish false. Either resolves it. What cannot stand is a gate naming a write no file in the branch performs.

### (b) `Done when` contradicts itself on the four kept classes

Within one sentence:

> *the four kept hold classes are **CAPPED** with `… and N more`, pinned by a test that pushes 574 slices into `merge-unknown`*

and, six clauses later:

> *the four queue-level hold classes **still name their branches**, pinned explicitly*

Both are pinned, and an implementer must satisfy both. They are reconcilable — cap at N, name up to N — but only if the reader supplies the reconciliation. The second clause is the round-2 text that the round-3 amendment superseded and did not delete. **A wrong implementation here is not caught**: an agent that reads the second clause and uncaps reproduces `merge-unknown`'s 574-line outage case and still passes a test written from the second clause. Delete the superseded clause, or state the cap as the single rule with the naming as its consequence.

### (c) `--once` byte-identical — flagged twice, still unfixed

Both prior rounds said this is untestable against a live estate (`cost=NNNNms`, live `held=`). The round-3 text is unchanged. It can only mean fixture-identical, and `reportTick`'s 8 fixture call sites are exactly how you'd assert it. One word.

### (d) The key-set gate still passes before the diff

`tickLine` (`registryd.ts:330`) emits all five `QUEUE_HOLDS` keys unconditionally. A gate green before the change is not a gate; it should assert *unchanged by this diff*. Flagged in rounds 1 and 2, unchanged.

### (e) Header line 3 still carries the retracted premise

> *`registryd.log` reached 69 MB … and nothing rotates it **because launchd owns the write**.*

The Design retracts this at `:49-55`. The one-line summary — the part that travels into the board, the sprint and the changelog — still asserts it. Mechanical, but it is the false claim the panel was convened over, surviving in the most-quoted line.

## 4. What I checked, and what I would do

Checked: `:205`'s loop and its per-tick wiring; all twelve emitting sites; the structural bound on `worker-start` via `assign.ts:140-149`; the three gates' independence over distinct `TickReport` fields; the real test path and its 8 three-argument call sites; and — the one that decides it — every writer of `registryd.log` in the repository.

**Each round has found less, and that is true here too.** Completeness is closed: there is no fourth emitter, the three gates are independent and would each catch a regression, and the four bounded ones are bounded by construction. On the merits I would dispatch this.

**But I would not hand it to an agent tomorrow**, and the reason is one defect, not a fourth lens's worth of findings: **the byte-ceiling gate names a write that no file on this branch performs.** The daemon writes to stdout; the file belongs to a hand-started bash loop; the slice names only the daemon's printing. That is a half-day of an agent guessing at scope, and the likeliest guess — putting a filesystem sink in `registryd-main.ts` — is the one a reviewer would reject on layering.

The amendment needed to clear it is a paragraph: name the ceiling's owner as a second slice, or drop the gate and state the residual. Items (b)–(e) are one-line edits that should ride along; (b) is the only other one that could produce a wrong implementation nothing catches.

Verdict: amend
