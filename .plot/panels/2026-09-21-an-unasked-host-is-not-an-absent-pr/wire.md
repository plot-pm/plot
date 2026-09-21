# Wire and compatibility — an unasked host is not an absent PR

Lens: a new enum value crossing the wire is a contract change. Subject: `docs/plans/2026-09-21-an-unasked-host-is-not-an-absent-pr.md`.

Position: amend

## 1 · Does the stated problem exist, verified in code?

Yes, and the plan quotes the line correctly. `packages/domain/src/rules/quiet.ts:113` is `if (readings.prState === 'none') return 'abandoned';`, the fourth arm of `quietKind`. `QuietBranchReadings.prState` is typed `'none' | 'open' | 'closed'` with no fourth word, and its own TSDoc says `'none'` means *"the host's state for the branch's PR, or `'none'` where it opened none"* — one word for two facts, exactly as the plan states.

The defect is real at the boundary the plan does **not** name. `prState` never reaches the rule from a host answer on the failing path. Three server sites assign `AgentRow.quietKind`:

| site | path | what it passes |
|---|---|---|
| `fleet.ts:6267` | plan walk | `rowQuietKind(closedPr?…, b.state, group, b.worker, pr, b.state === 'merged')` |
| `fleet.ts:6502` | open-PR loop | hardcoded `null` |
| `fleet.ts:6735` | unmerged-branch loop | `rowQuietKind(prClosed, 'wip', placed, 'elsewhere', null, prMerged)` |

`rowQuietKind` (`:4767`) builds readings via `wipReadings(pr, merged)` / `claimedReadings(pr)` / `closedReadings()`. None of the three constructors can express *host unanswered*: `closedReadings` hardcodes `prState: 'closed'`, and `wipReadings` derives `'none'` from a null `pr`. So on the measured Bitbucket repo, `prs` is null because the fetch timed out, `pr` arrives null, and `wipReadings` synthesises `prState: 'none'` from an absence it never checked. The rule is handed a lie before it decides anything.

That matters for the plan's slice line, which says only that `QuietBranchReadings` carries the new reading and "the server passes the reading it already holds". The server does not hold it at either failing call site. See §5.

## 2 · Is this the smallest change?

No — it is smaller than the smallest correct change, and the gap is the amendment.

The plan's argument for a fifth kind over a nullable field is sound and I do not dispute it: `null` already means *the question is not asked of this row* (`AgentRowSchema.quietKind` docstring, `schema.ts:2999-3001`), and reusing it would render identically to the current defect. A distinct value is right.

What is missing is that `quietKind` is not the only consumer of the same readings. Two siblings read them and both will answer wrongly for `unasked` unless the slice touches them:

- **`quietNote`** (`quiet.ts:133`) — a `switch` over `QuietKind` with no `default`. TypeScript's exhaustiveness check makes adding `unasked` a compile error here, so it cannot be silently forgotten. The plan names this one.
- **`quietNeedsPerson`** (`quiet.ts:166`) — `kind !== 'closed-pr' && kind !== 'merged'`. An **open predicate**, not a switch. `unasked` falls through to `true` with no compile error. That may even be the wanted answer, but the plan never states it, and an unstated fallthrough in a predicate is how the `hasMergedPr` defect at `:3876` happened before.
- **`classifyGroup`'s wip arm** (`fleet.ts:4645-4652`) — `hasMergedPr ? 'done' : !quietNeedsPerson(readings) ? 'quiet' : 'waiting-on-you'`. Same open shape. An `unasked` row silently lands in WAITING ON YOU. Arguably correct — `prUnknown` already routes there deliberately at `:4283` — but again unstated, and it is a *section placement*, which is what the plan's own cited precedents (#669, #675) each got wrong by half.

So: one compile-checked site named, two uncompile-checked sites unnamed. The slice is not smallest-correct; it is under-specified.

## 3 · What I could not verify

**"the server passes the reading it already holds."** This is the plan's only claim about the server and I could not verify it at either failing site.

There **is** a reading, and the plan does not mention it: `classify`'s `prUnknown` parameter (`fleet.ts:3854`), documented as *"Whether this branch's PR could not be read from the origin"*, host-agnostic by design, already withholding a verdict at `:4282`. The plan walk supplies it as `held?.state === 'unknown'` (`:5883`). This is the same fact the plan wants, already named, already on the wire path, already with a stated rationale for exactly this failure mode.

But it is not available where the defect was measured. The unmerged-branch loop at `:6600-6606` spells out every `classify` default and passes `prUnknown` as `false` — the comment there literally says *"every default, spelled out because `hasMergedPr` is last and the list is positional."* That loop's population is *"branches carrying commits with no open PR"*, which is precisely the seven rows measured. So the existing reading is hardcoded false on the failing path, and the plan neither says so nor says how the new reading gets there.

Second unverifiable claim: **"Measured 2026-09-20 … seven branches rendered abandoned, three carrying open PRs."** The plan cites `quatico/quaweb-website`, not this repo. I cannot reach that repository, and the supporting note it rests on is honest about having overturned three of its own findings on a second pass. I take the measurement as plausible and unverified — it does not change my position, because the code defect stands on its own reading.

## 4 · What breaks if this ships as written

### 4a · Old client, new server — the real risk, and the plan's compatibility paragraph is wrong about it

The plan says: *"`null` keeps its meaning. A row the question is not asked of is unchanged, including on an older server whose payload predates the new value — `AgentRowSchema.quietKind` defaults to `null` for that reason and the default stays."*

That paragraph analyses **new client / old server** and gets it right. It never analyses **old client / new server**, which is the direction that actually breaks here, and the schema's own default does nothing for it.

**The client casts. It does not parse.** `App.tsx:241` is `const data = (await res.json()) as Board | { error: string };` and `:281` is `(await res.json()) as Fleet | { error: string }`. No `FleetSchema.parse` anywhere in `src/app/`. Grepping `FleetSchema` finds exactly one production caller — `server/mock-fleet.ts:424` — and every other hit is a test. The live `/api/fleet` response is assembled in `fleet.ts` and serialised without ever passing through `FleetSchema`.

Two consequences the plan does not account for:

1. **Zod validation never runs on the wire, in either direction.** So the plan's reassurance that the default "keeps the row validating" describes a code path the board does not execute. Nothing will reject an unknown value — and nothing will supply a default either. This is the documented repo pattern (`board-client-casts-the-fleet-never-parses-it`), and it means the compatibility story has to be told in the renderer, not in the schema.
2. **An old client receiving `quietKind: 'unasked'` hits a non-exhaustive switch that returns `undefined`.** `quietKindWord` (`tuple-row.ts:1042`) is a `switch` over five literals with **no `default` arm**. Its return type is `string`, so at runtime an unmatched value falls off the end and yields `undefined`. `stateStatus` (`:1092`) guards only on truthiness of `row.quietKind` — `'unasked'` is truthy — so it calls `quietKindWord`, gets `undefined`, and returns it from a function typed `string`. Slot 5 then renders `undefined`, or throws at whatever downstream consumer calls a string method on it. `stuck.ts:112` is a second consumer of `stateStatus`.

That is a stale-artifact failure, not a theoretical one. This repo's board runs from a built artifact under `node --watch` and the memory index carries `board-browser-tests-load-the-built-artifact` and `board-renders-the-checked-out-branch` — a client bundle one branch behind a server is an ordinary state here, not an exotic one. The failure is also silent-ish and ugly: a literal `undefined` in the status column.

**The fix is one line and the plan should mandate it**: give `quietKindWord` a `default` returning `'quiet'` or `''`. Note that adding `unasked` to `AgentRow['quietKind']` makes the switch a compile error in the *new* client — so the new client is safe by construction. Only the old one breaks, and only a defensive `default` shipped *ahead of or with* the enum protects it. The plan's "the default stays" sentence protects the wrong direction.

### 4b · Test surfaces the single slice must carry

- `packages/board/test/integration/quiet-kinds-render.browser.test.ts` — fixtures at `:51-63` construct `AgentRow`s with literal `quietKind` values. A sixth kind needs its own fixture and render assertion, or the new word ships with zero browser coverage while four siblings have it.
- `packages/board/test/unit/fleet.test.ts`, `a-landed-branch-leaves-waiting.test.ts`, `packages/domain/test/quiet.test.ts` — all reference `quietKind`.
- `mock-fleet.ts:424` is the **only** production `FleetSchema.parse`. It is the one place a bad enum value would actually throw, and it is the mock path — so the mock board is the only surface where Zod would catch a mistake, and it is not the surface operators use.

### 4c · The plan's own guard, restated correctly

*"`abandoned` must still fire"* — agreed, and the corpus it names ("a repository whose fetch succeeded") is the right one. But on the unmerged-branch loop the distinguishing input does not exist yet, so a test written against today's call signature would pass trivially in both directions. The regression lock has to be written at the server call site, not only at the rule.

## 5 · Existing or nearer mechanism the plan ignored

Yes, and it is the strongest finding here.

**`prUnknown` already is this concept, one layer out.** `fleet.ts:3831-3854` documents it as *"an origin that could not be asked propagates as a gap, never as a value a verdict can be computed from,"* declares itself host-agnostic, and `:4282` already withholds a claim rather than inventing one. That is verbatim the plan's argument, already settled, already shipped, already with the precedent the plan is re-deriving from scratch.

The plan does not mention it once. That is not fatal to the design — I agree the *kind* is the right place for the rendered answer, because `prUnknown` withholds a verdict and does not change the quiet word. But it changes what the slice is:

- the concept is not new, so `unasked` should be named and documented as *the quiet-kind projection of `prUnknown`*, not as a fresh invention;
- the plumbing is half-built, so the slice's real work is **threading the existing gap fact to the two `rowQuietKind` call sites** — not "the server passes the reading it already holds";
- `:6604`'s hardcoded `prUnknown = false` is a named, commented defect on exactly the failing path. Fixing it may be a prerequisite, and the plan should say whether it is in scope.

There is also the sibling `held?.state === 'unknown'` at `:5883`, derived from `prState`'s `'unknown'` word (`:4079`) and from the `allUnknown` detection at `:2568` (*"indistinguishable from 'could not reach'"*). The board has at least three existing spellings of *the host did not answer*. A fourth that does not say how it relates to them is how `prState: 'none'` came to mean two things in the first place.

## Touchpoint count

Eleven production sites, of which the plan names three.

| # | site | named? |
|---|---|---|
| 1 | `quiet.ts` `QuietKind` union | yes |
| 2 | `quiet.ts` `QuietBranchReadings` new field | yes |
| 3 | `quiet.ts` `quietKind` new arm, ahead of `none` | yes |
| 4 | `quiet.ts` `quietNote` switch (compile-checked) | yes |
| 5 | `quiet.ts` `quietNeedsPerson` open predicate | **no** |
| 6 | `schema.ts:3002` enum | yes |
| 7 | `tuple-row.ts:1042` `quietKindWord` switch — needs a `default` for old clients | **no** |
| 8 | `fleet.ts:4767` `rowQuietKind` signature | **no** |
| 9 | `fleet.ts` `wipReadings` / `claimedReadings` / `closedReadings` constructors | **no** |
| 10 | `fleet.ts:6267` plan-walk call site | **no** |
| 11 | `fleet.ts:6735` unmerged-loop call site (the measured defect path; `prUnknown` hardcoded false at `:6604`) | **no** |

Plus `classifyGroup`'s wip-arm group selection at `:4645`, and four test files.

The single slice is not wrong to be single — the change is coherent and small — but its one-line description covers roughly a third of what it must touch, and the two sites that break *silently* (the open predicate at #5, the defaultless switch at #7) are both unnamed.

## What would move me to proceed

1. State the **old-client** direction and mandate a `default` arm in `quietKindWord`. The client casts; the schema default is not a compatibility mechanism on this wire, and the plan currently implies it is.
2. Name `quietNeedsPerson` and `classifyGroup`'s wip arm, and say what `unasked` answers in each. Both are open predicates that will not fail to compile.
3. Replace *"the server passes the reading it already holds"* with the actual plumbing: which of `prUnknown` / `held.state === 'unknown'` / `prs === null` supplies the fact, and how it reaches `rowQuietKind` at `:6267` and `:6735` — including whether `:6604`'s hardcoded `false` is in scope.
4. Relate `unasked` to `prUnknown` explicitly, so the estate gains a projection of an existing concept rather than a fourth independent spelling of *the host did not answer*.
5. Add a browser fixture in `quiet-kinds-render.browser.test.ts` for the new kind, matching the four that exist.

None of these changes the design. The fifth kind is the right call and the precedence ahead of `none` is right. The plan is under-specified at the wire, and the one paragraph it devotes to compatibility analyses the safe direction and not the unsafe one.
