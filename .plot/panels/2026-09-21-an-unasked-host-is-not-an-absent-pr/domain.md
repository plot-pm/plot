# Domain rule lens — an unasked host is not an absent PR

Position: amend

Reading position: `packages/domain/src/rules/quiet.ts` in full, `packages/domain/test/quiet.test.ts` in full, every caller of `quietKind`/`quietNote`/`quietNeedsPerson` in `packages/board/src/server/fleet.ts`, the schema field in `packages/board/src/contract/schema.ts:3002`, and the renderer in `packages/board/src/app/lib/tuple-row.ts:1042`.

## 1. Does the stated problem exist, verified in code?

**Yes, and the line the plan quotes is the right line.** `quiet.ts:113` is `if (readings.prState === 'none') return 'abandoned';`, and `QuietBranchReadings.prState` is typed `'none' | 'open' | 'closed'` with its own docstring saying *"or `'none'` where it opened none"* — a claim the caller cannot honour when it never asked.

The caller side confirms the collapse rather than merely permitting it. Every readings constructor derives `prState` from a nullable map lookup:

- `wipReadings` (`fleet.ts:4696`): `prState: pr ? 'open' : 'none'`
- `claimedReadings` (`fleet.ts:4676`): the same expression
- and the `pr` handed in is `prs?.get(b.branch) ?? null` (`fleet.ts:5806`, `:6544`)

`prs` is `Map<string, PrRecord> | null` (`fleet.ts:634`), initialised `null` (`fleet.ts:3083`) and assigned only on the happy path (`fleet.ts:2585`). So `prs === null` (never fetched) and `prs.get(branch) === undefined` (fetched, no PR) both arrive at the rule as `prState: 'none'`. `?.` and `??` are precisely where the distinction is destroyed, one layer below the rule.

**The measurement is consistent with that code path.** `prAgeSeconds: null` means `entry.prAt === null` (`fleet.ts:7056`), which means no successful fetch has ever completed in that process — so `entry.prs` is still `null`, `pr` is `null` for every branch, `prState` is `'none'` for every branch, and every `wip` branch with commits reads `abandoned`. Three of the seven having open PRs is exactly what this path produces. The defect is real and the diagnosis is right.

**But the defect is not confined to the word.** `classifyGroup`'s fallthrough (`fleet.ts:4634-4650`) calls `quietNote(wipReadings(...))` and then puts the row in `waiting-on-you` via `quietNeedsPerson`. Fixing `quietKind` fixes all three at once *only because* `quietNote` and `quietNeedsPerson` both ask `quietKind` — which they do (`:134`, `:167`). That part of the plan's "one derivation" claim holds inside the domain.

## 2. Is it the smallest change that fixes it?

**No — and my objection is the opposite of the usual one. The plan is too small in the reading and too large in the vocabulary.**

### 2a. The reading the plan needs is not available where it says it is

The plan's slice says *"the server passes the reading it already holds"*. **It does not hold it at the call sites.**

The three readings constructors take a `PrRecord | null`. Null already means two things there. To pass "the host answered", the server must thread a *new* fact from `CacheEntry` down into `classifyGroup` and `rowQuietKind`. Trace what that costs:

- `classifyGroup` is a **positional** signature with ~19 parameters whose own docstrings say four separate times *"LAST, BECAUSE IT IS THE NEWEST … inserting a parameter mid-list shifts every spread-tuple caller in the suite silently past the compiler, and this file has paid that once already"* (`fleet.ts:3850-3854`). A new parameter must go last, after `hasMergedPr`.
- `classify` reads `args[16]` **by index** (`fleet.ts:4887`). A test at `fleet.test.ts:4712` exists specifically to lock that index. Appending is safe; the comment says so.
- `rowQuietKind` (`fleet.ts:4764`) needs the same fact as a seventh parameter, and both its call sites (`:5950`, `:6622`) need it.
- `rowsFromPulse` (`:5616`) has fourteen optional trailing parameters and **does not receive `entry.prAt` or `entry.prError` at all** (`:6987-6995`). A fifteenth must be threaded.
- The loose-branch path at `:6600` spells out **every default positionally** in a comment-annotated argument list precisely because `hasMergedPr` is last.

That is a genuine multi-site change through a signature the file itself calls fragile. The plan's one slice bullet describes it as the server passing something it holds. **It holds it on `CacheEntry`, seven frames up.** This is the plan's largest under-admission and the main reason for `amend`.

### 2b. There is a nearer mechanism, and the plan does not mention it

`classifyGroup` **already takes a `prUnknown` parameter** (`fleet.ts:3854`) whose docstring is almost the plan's own thesis:

> *"Whether this branch's PR could not be read from the origin … an origin that could not be asked propagates as a gap, never as a value a verdict can be computed from."*

It already withholds the slice verdict (`:4282`) and has a constant sentence, `PR_UNKNOWN_NOTE = 'cannot read the PR — the host could not be asked'` (`schema.ts:1689`).

So the estate has already decided, in this file, that *the host could not be asked* is a first-class reading. The plan proposes a second, independently-named expression of the same concept without acknowledging the first. That is the CLAUDE.md shape — *"Where a rule exists and nothing calls it, that is a defect to report"* — applied to a reading rather than a rule.

**And `prUnknown` is itself broken in exactly the measured case, which is the finding the plan should have made.** Its single production producer is `held?.state === 'unknown'` (`fleet.ts:5881`). `held` is `prsByHeadMap?.get(b.branch) ?? null` (`:5833`), and `prsByHead` is `null` for the whole outage. **A null map yields `held === null`, so `prUnknown` is `false`.** The withholding arm at `:4282` never fires on the very outage the note measured. The loose-branch path passes `prUnknown` as a hardcoded `false` (`:6604`).

So `prUnknown` fires when the host answered with an unreadable PR record, and stays silent when the host was never successfully asked at all — the strictly worse of the two failures. **The correct smallest change is to fix the producer of the reading that already exists, and let `quiet` consume it**, rather than to introduce a parallel one. That is the amendment I would require.

### 2c. The new value may not be needed in `QuietKind` at all

Given 2b, an alternative worth costing that the plan never considers: `rowQuietKind` returns `QuietKind | null`, and null already means *the question is not asked of this row*. When the host was never asked, **the question genuinely cannot be asked of the row** — which is not the same as the plan's characterisation. The plan says reusing `null` "would collapse two different silences, and the row would render exactly as it did before the fetch failed, which is the current defect with extra steps."

**I checked that claim and it is right, for a reason the plan does not give.** `stateStatus` (`tuple-row.ts:1092`) falls through a null `quietKind` to `row.state`, which renders `wip` as *in progress* — the original defect. So `null` is genuinely unusable **at the row level**. But that argument is about the *row field*, not about the *domain enum*. Those are two decisions and the plan merges them. A defensible smaller shape: `rowQuietKind` gains the `unasked` answer for the ROW, and `quietKind` gains a refusal rather than a fifth kind. I do not insist on it, but the plan asserts the choice without separating the two questions.

## 3. What the plan claims that I could NOT verify

1. **"the server passes the reading it already holds."** Verified **false** as written at the call sites; see 2a. The fact lives on `CacheEntry.prAt`/`prError`, and neither reaches `rowsFromPulse`.
2. **"it is tested BEFORE the `prState === 'none'` test … a host that did not answer has no `prState` worth consulting."** The ordering claim is **under-specified, and the plan's own justification is too strong for the position it asks for.** If a host that did not answer has no `prState` worth consulting, `unasked` must also outrank `closed-pr` (`:111`) — that arm reads `prState` too. The plan only positions it above `none`. Worse, `prState` cannot be `'closed'` or `'open'` when the host went unasked, since both come from a PR record's presence — so placing `unasked` above `none` and below `closed`/`orphaned-claim` is *observationally* fine but rests on a premise the stated reason contradicts. The one ordering that genuinely matters and the plan does not state: **`unasked` must sit BELOW `hasMergedPr`** (`:110`). `hasMergedPr` comes from a different source (`plot-pr-merged.sh` / `b.state === 'merged'`, `fleet.ts:5950`), can be true while the PR map is dark, and a merged branch labelled *unasked* would re-open the exact regression `quiet.test.ts:59-70` was written to lock (six merged branches reading "nobody is on it", 2026-09-04). **The plan must state this or the implementer has a coin-flip.**
3. **"`AgentRowSchema.quietKind` defaults to `null` … and the default stays"** — verified true (`schema.ts:3002`), and back-compat holds.
4. **"One derivation. `quietKind` is forwarded, never re-derived on the client"** — verified true; `tuple-row.ts:1042` switches on the value and decides nothing. The new value needs a case there, and the switch is exhaustive over `NonNullable<AgentRow['quietKind']>`, so the compiler will demand it. Good.
5. **The board impact is understated by one file.** The plan names the schema and the row render. It does not name `quietKindWord` (`tuple-row.ts:1042`), `quietNeedsPerson`'s consequence (below), or the two `rowQuietKind` call sites.

## 4. What breaks if this ships as written

1. **`quietNeedsPerson` silently answers `true` for `unasked`.** `:168` is `kind !== 'closed-pr' && kind !== 'merged'`. A fifth kind falls into the true branch by default, so every branch on a repository with a dark host lands in **WAITING ON YOU** (`fleet.ts:4650`). On the measured repo that is seven rows demanding a person act on a Plot outage. The plan says nothing about this function. It is arguably the right answer — somebody should look at the banner — but it must be a decision, not a fallthrough, and `quiet.test.ts:149` (`agrees with quietKind on every case`) will pass either way because it re-derives the same expression.
2. **`everyCase()` (`quiet.test.ts:162`) enumerates 12 records over three deciding readings and its docstring says it is *"enumerated rather than sampled so a fourth arm cannot be added without a case covering it."*** A fourth boolean reading makes that 24 and the loop must gain a dimension. If the implementer adds the field with a default and leaves the loop alone, the guard the file explicitly built silently stops covering the new arm — and `quietNote`'s `Record<QuietKind, string>` at `:117` will be the only thing that fails. **The plan's slice does not name this file.**
3. **The `abandoned`-still-fires corpus is harder than the plan says.** *"The corpus for that case is a repository whose fetch succeeded"* — but the readings constructors cannot today distinguish a succeeded fetch from a never-attempted one, so the fix must reach the producer before any such test is meaningful. A unit test with the field set by hand proves the rule and nothing about the board.
4. **Two producers, one concept.** Ship as written and the file holds `prUnknown` (fires when the host answered badly) and `unasked` (fires when the host was not asked), with no stated relationship, no shared constant, and overlapping sentences — `PR_UNKNOWN_NOTE` says *"cannot read the PR — the host could not be asked"* and the new `quietNote` sentence will say something adjacent. That is a drift pair the estate's own corpus-tier rule exists to prevent.
5. **Ordering regression risk** from §3.2 — a merged branch reading `unasked` if the implementer places the new arm first, which the plan's stated reason ("has no `prState` worth consulting") invites.

## 5. Existing mechanism, or a nearer one

**Yes: `prUnknown`.** Same concept, same file, already threaded through the positional signature, already carrying a constant sentence, already withholding a verdict rather than inventing one. Its defect is its producer, not its design.

`prAgeSeconds` is the other existing expression — the note itself says *"A third state — not asked — is already derivable from `prAgeSeconds: null`"* — and the plan quotes the note's honesty about it without following it to its conclusion: the fact exists on `CacheEntry`, is already published on the fleet payload (`schema.ts:3816`), and is already rendered (`AgentList.tsx:2175`, *"no PR data yet"*). The board **already tells the reader the host was not asked, in the header, while labelling the rows abandoned underneath.** That is the sharpest statement of the defect available and the plan does not make it.

## What would move me to `proceed`

1. State the ordering fully: `unasked` goes **below `hasMergedPr`** and above `prState === 'none'`, with the merged-branch regression named as the reason.
2. Reconcile with `prUnknown` explicitly — either extend it to the null-map case and have `quiet` consume that one reading, or state in the plan why two readings are right. Do not leave them unrelated.
3. Name the producer honestly: the fact is on `CacheEntry.prAt`/`prError` and must be threaded through `rowsFromPulse` → `classifyGroup`/`rowQuietKind`, appended last per the file's own positional rule, with both `rowQuietKind` call sites and the loose-branch path at `:6600` updated. Say so in the slice instead of "the reading it already holds".
4. Decide `quietNeedsPerson` for `unasked` in the plan text, rather than letting the expression at `:168` decide it.
5. Name `packages/domain/test/quiet.test.ts` in the slice, including `everyCase()` gaining a dimension and `quietNote`'s `Record<QuietKind, string>`.

The premise is sound, the defect is real, the fix belongs in this rule. The plan understates where the reading comes from, ignores a near-identical mechanism thirty lines away in the same file, and leaves two ordering and fallthrough decisions to the implementer. Amend.
