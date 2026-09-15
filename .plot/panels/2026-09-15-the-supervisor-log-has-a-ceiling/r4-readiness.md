# Round 4 — the readiness lens

My question is the one I asked in round 3: **would I hand this to an agent tomorrow and expect a correct branch back.** I re-read all three prior files, then checked the amendment's changes against the code and against my own round-3 findings — including whether the defect I blocked on is actually gone rather than reworded.

## 1. The round-3 blocker is closed, and closed properly

I blocked on one thing: *the byte-ceiling gate named a write no file in this slice performs.*

| Check | Result |
|---|---|
| Does any byte-ceiling gate survive in `Done when`? | `grep -n "ceiling in bytes\|stated ceiling\|truncat"` over the plan → **zero hits**. The gate is gone, not reworded |
| Is the daemon still stdout-only? | `registryd-main.ts:751` — `write: (s: string) => void = (s) => process.stdout.write(s)`; `grep -n "createWriteStream\|openSync\|appendFile"` → **nothing**. Unchanged, and now the plan agrees with it (`:119-123`) |
| Is the follow-up owner real? | `plot-fleetctl.sh:509` — `echo "  log: $repo_root/.plot/logs/registryd.log"`, verbatim, inside the `--status` arm. The plan's cited line is exact, and the script does own the unit templates |

The amendment did not merely delete the gate. `:118-131` states *why* the ceiling cannot live here (the daemon prints to stdout, the file belongs to the hand-started `>>` loop), names the owner with a line number I verified, and closes with **"What this slice therefore promises is exact: the log stops growing with the estate. It does not stop growing."** That is the sentence an implementer needs, and it is in the Design rather than only in the Notes.

## 2. Rubric 1 — is the Changelog true, and does the Design agree?

**The Changelog is now true of what the slice does.** Line 18: *"stops growing with the estate … what remains is a fixed 262 bytes per tick, and a ceiling on the file is a separate slice."* Round 2's decisive finding was that *"stops growing without bound"* would publish false; the replacement states the residual in the published line itself, which is more than the minimum that would have cleared it.

**No surviving Design sentence claims more.** I looked for the shape round 2 caught — a promise of boundedness anywhere outside the amended paragraphs. `:130` and `:177-181` both state the residual. The `What this does not do` section opens *"It does not put a ceiling on the file"* and repeats the 262 B/tick figure. The Design and the Changelog say the same thing.

**The arithmetic is honest, and slightly conservative.** `262 × 1440 × 365 = 137.7 MB/year`; the plan states **131 MB**. Round 2 computed 93 MB at 1,024 ticks/day. The plan took the higher cadence and then rounded *down* by 5%, so its headline number understates its own residual — an error in the direction that cannot flatter the plan. Not worth a round.

**One sentence still carries the retracted premise, and it is not blocking.** Header line 3 still reads *"nothing rotates it **because launchd owns the write**"* — the claim `:49-55` retracts. I raised this in round 3 as item (e). It is the plan's most-quoted line and it should be fixed with the next touch. It does not block dispatch: the Design retracts it explicitly two screens down, the gates do not rest on it, and no implementer decision turns on it. Flagging a one-line summary edit as a fifth blocking round would be exactly the pattern the brief warns against.

## 3. Rubric 2 — is the scope coherent?

**Every gate now names work a file in this slice performs.** Walking them against the code:

| Gate | The file that performs it |
|---|---|
| Cap the four kept hold classes | `reportTick` (`registryd-main.ts:824`), the branch-list loop at `:864` |
| Held-branch count does not drive line count | same loop, over `report.handOver.detail.held` |
| Undispatched-worktree count does not drive it | `unclaimedLines` (`registryd.ts:376-391`), printed at `:843` |
| Unparseable-manifest count does not drive it | `readRegistry`'s loop, `registryd-main.ts:205` |
| `--once` unchanged | `reportTick`'s signature and its callers |
| Key set unchanged | `tickLine` (`registryd.ts:330`) |
| Incomplete tick reports its reason | `reportTick:829-831` |

All seven land inside `registryd-main.ts` / `registryd.ts` — one slice, one branch, no scope smuggled in. The follow-up sits outside and is named with its owner rather than hidden in a gate.

## 4. Rubric 3 — walking `Done when` as an implementer

**I could build exactly this.** `reportTick` is exported and pure over a `TickReport` (`:824-828`), so every gate is a unit test over a constructed report — no daemon, no estate, no host. The three growth gates read **distinct fields** (`handOver.detail.held`, the `unclaimedLines` input, `readRegistry`'s names), so one fixture cannot satisfy all three, which was round 2's route-2 worry.

**The cap gate is buildable.** `whyNotReady` (`queue.ts:205-209`) is verbatim as cited — `merge-unknown` is tested second, before the claimable split — and `landed` (`landed.ts:60-68`) returns `unknown` on `default`, i.e. for every slice when the host cannot be asked. So 574 slices into `merge-unknown` is constructed by handing the fixture 574 slices with `landed: 'unknown'`. No mocking, no outage simulation. The plan's cited lines `queue.ts:206` and `landed.ts:66` both land inside the right statements.

**Would a wrong implementation be caught?** Yes for the three growth gates and the cap — each grows one input and asserts the line count does not follow, which is a failing assertion on the unfixed code and a passing one after. Round 2's three escape routes are closed: route 1 (satisfy the gates, leave the log growing) is now *stated as the outcome* rather than a loophole; route 2 (reuse one fixture) is closed by the field-disjointness above; route 3 (`merge-unknown` unbounded) is the cap gate.

**Two soft spots survive, and neither is a blocker.**

- **The `Done when` still contradicts itself on the kept classes** — *"CAPPED with `… and N more`"* and, later in the same sentence, *"still name their branches, pinned explicitly."* I raised this in round 3 as (b). Reading it again with the amended Design in hand, it reconciles cleanly and the Design does the reconciling in plain words at `:145-147`: *"each names its branches up to a bound and then says `… and N more`."* An implementer reading the plan — not just the sentence — cannot build the uncapped version, because the cap clause is the *first* gate and carries the 574-slice test that fails without it. The residual risk is an agent that reads only the second clause and writes a test from it; that agent still fails gate 1. **This is a wording edit that should ride along, not a defect that ships a wrong branch.**
- **`--once` "byte-identical"** still means fixture-identical — a live diff carries `cost=NNNNms`. Flagged in rounds 1–3. An implementer testing `reportTick` over the 8 fixture call sites at `packages/board/test/unit/registryd-main.test.ts:313-365` does the right thing by default, because that is the only way the function is testable. One word, worth correcting, not worth a round.

**The citation correction from round 3 is moot**: the plan cites no test path at all (`grep -n "registryd-main.test\|test/unit"` → nothing), so no agent is sent to a path that does not exist. The real file is `packages/board/test/unit/registryd-main.test.ts` with **8** `reportTick` call sites — confirmed again this round.

## 5. What I checked

The absence of any byte gate in the plan text; the daemon's sink and its lack of any file-opening call; `plot-fleetctl.sh:509` as the named owner; `whyNotReady` and `landed` line-for-line against the cap gate's citations; `reportTick`'s export and signature for buildability; the three growth gates' field-disjointness; the residual arithmetic at both tick cadences; the Changelog against every Design sentence that could claim more; and the real test path and its call-site count.

## 6. Decision

Three rounds each found one real blocking defect. This round I looked for a fourth and the honest answer is that there isn't one. The defect I blocked on is closed at the root — the gate is deleted, the reason is stated, the owner is named with a verified line — and the two items I would still edit (the header's retracted `because launchd owns the write`, and the `CAPPED` / `still name their branches` wording) are one-line touches that change no implementation and fail no gate. Holding a dispatch for them would be inventing a finding to justify a fifth round.

**I would hand this to an agent tomorrow.** The gates are buildable without a daemon, a wrong implementation fails gate 1 or gate 2, the scope is one branch's worth of two files, and what the slice does not do is written into the published line rather than left for a reader to discover.

Verdict: proceed
