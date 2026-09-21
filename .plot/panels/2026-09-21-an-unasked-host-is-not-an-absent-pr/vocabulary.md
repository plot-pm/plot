# Vocabulary lens — an-unasked-host-is-not-an-absent-pr

Position: amend

The defect is real and the fix direction is right. The **word is wrong**, and it is wrong in the one way this estate has a rule against: `unasked` is already load-bearing vocabulary in this codebase, in three places, meaning the **exact opposite** of what the plan assigns it.

## 1. Does the stated problem exist?

**Yes, verified in code.** `packages/domain/src/rules/quiet.ts:109` reads `if (readings.prState === 'none') return 'abandoned';` as the plan quotes it, and `QuietBranchReadings.prState` is typed `'none' | 'open' | 'closed'` with no third absence.

The conflation does not originate in the rule — it originates one layer out, at `packages/board/src/server/fleet.ts:4696`:

```ts
const wipReadings = (pr?: PrRecord | null, hasMergedPr = false): QuietBranchReadings => ({
  branch: '', prState: pr ? 'open' : 'none', hasMergedPr, isEmptyClaim: false,
});
```

`'none'` is **manufactured here from the absence of a local `PrRecord`**, never reported by the host. When `refreshPrs` throws (`fleet.ts:2607`), `entry.prs` keeps its last map — which on a first-fetch failure is `null` — so every branch arrives with `pr == null` and `wipReadings` asserts `'none'` about a host that was never heard from. The rule then faithfully answers `abandoned`. The plan's diagnosis is correct; its location note ("the server passes the reading it already holds") is also correct — `entry.prAt` is in scope and `fleet.ts:7056` already derives `prAgeSeconds` from it.

## 2. Is `unasked` the right word? **No — it is taken, and it means the opposite.**

This is my lens's core finding. Three existing definitions, all settled, all in the same subject area (host answers about PRs):

**(a) `packages/domain/src/rules/branch-state.ts:15-34`** — the domain's own `HostReach`, the file *beside* `quiet.ts`:

> `unasked`   no host configured, or `--offline`. **Nothing was lost**, so a branch with no other evidence stays `open`.
> `throttled` … `failed` a transport error. **The question was put and went unanswered**, so the scan holds no evidence either way and the branch is `unknown`.

The docstring's header sentence is *"a question that was not put is not a question that went unanswered."* The plan proposes `unasked` for **the second half of that sentence**. The domain package already spells that half `unknown`.

**(b) `packages/board/src/app/lib/agent-rows/host-notes.ts:204-233`** — `HostAnswer = 'answered' | 'unasked' | 'unreachable'`, keyed off the *same two fields the plan wants to read*:

```ts
if (fleet.prAgeSeconds !== null) return 'answered';
return fleet.prError ? 'unreachable' : 'unasked';
```

`HOST_ANSWER_HINT.unasked = 'not checked yet'`, and the docstring says *"`unasked` resolves itself in seconds and asks the reader for nothing; `unreachable` will not resolve until somebody looks at the error."* The plan's measured scenario — a timeout, `prError` set — is **`unreachable` by this existing function**, not `unasked`. The plan would ship a row labelled `unasked` on a fleet the board's own classifier calls `unreachable`, reading off the identical inputs.

**(c) `skills/plot/scripts/plot-fleet-scan.sh:650`** — `HOST_VERDICT=unasked` means *"no host to ask, or --offline. **Not a degradation**: the scan was never going to ask, and saying `failed` would report a fault where there is a configuration."* Line 756 is explicit that a host that cannot be asked at all "belongs there rather than among answers that failed to arrive."

The CHANGELOG states the contract in one line (`packages/board/CHANGELOG.md:309`):

> `unasked` yields `open` because **the scan was never going to ask**, while `throttled`, `secondary` and `failed` yield `unknown` because **the question was put and went unanswered**.

The plan's Design section inverts this precisely: it glosses `null` as *"question not put"* and `unasked` as *"asked, no answer."* Every existing site in the estate says the reverse. Shipping this creates a term that means one thing in `rules/quiet.ts` and its opposite in `rules/branch-state.ts` — two files in the same directory of the package CLAUDE.md calls *"unusually strict about terminology."*

**The right word already exists: `unknown`.** It is the estate's settled term for *asked, no answer* — `HostReach`'s three failure verdicts map to it; `PrSchema.state` carries it ("the host cannot report it", `schema.ts:2479`); `BriefStateSchema`, `checks.state`, and `plot-board-probe.sh` auth all use it the same way. `an-unreachable-host-is-not-an-answer` (Released, 2.11.0) settled `unknown` as *"what a host that could not answer says."* A reader meeting `unknown` on a quiet row finds the same meaning everywhere else in Plot.

## 3. Is a fifth enum value the right shape? **No — the narrower fix is a fifth `prState`.**

The plan argues a new `QuietKind` because "`null` already means the question is not asked of this row." That argument is sound *about `null`* and does not establish that the new value belongs on `QuietKind`.

`QuietKind`'s five values all answer **"what kind of quiet is this branch in?"** — a property of the branch. *The host did not answer* is not a property of the branch; it is a property of **the reading**. Putting it on `QuietKind` makes the enum answer two different questions, which is the exact split CLAUDE.md draws for worker-vs-agent states ("a state answering *what is the process doing?* goes on the worker; one answering *what does this agent owe?* goes on the agent").

`quiet.ts`'s own header anticipates this and sets the bar: *"Should a population still land here that deserves its own word, that word is what the next reading adds."* **The next reading** — not the next kind.

The smaller change that fits the existing grain:

- `QuietBranchReadings.prState` gains `'unknown'` — one field, one value, mirroring `PrReading`'s `'unreadable'` in the sibling rule and `PrSchema.state`'s `'unknown'`.
- `quietKind` tests it first: `if (readings.prState === 'unknown') return 'quiet';` — the fallthrough kind, whose existing note is *"nobody is on it"* and whose `quietNeedsPerson` is already `true`.
- The wire, `AgentRowSchema`, `quietKindWord` and `quiet-kinds-render.browser.test.ts` are **untouched**. `abandoned` stops firing on an unanswered host, which is the plan's whole stated goal.

That said, `quiet` under-reports: the reader is not told *why* the row is bare. If the board should say so, the honest carrier is the field that already exists — `hostAnswer(fleet)` at `host-notes.ts:204`, which is fleet-wide, already renders `'could not reach the host'`, and already distinguishes the two silences correctly. A per-row duplicate of a fleet-wide fact is the *"two records of one fact"* shape `plot-reconcile-scan.sh` §18 and §16 were both written to report as drift.

If the panel concludes a fifth `QuietKind` really is wanted, it must be spelled `unknown` or `unreadable`, never `unasked`.

## 4. What could I not verify?

- **The measurement is inconsistent with the code on one point, and it matters for the fix.** The note attributes the failure to *"the board never gets to see the answer before its own timeout"* with `prAgeSeconds: null`. But since #912 shipped (`a-partial-page-is-not-an-outage`, Released 2.19.0), a **partial** answer takes the happy path at `fleet.ts:2593` and **stamps `prAt`** — so `prAgeSeconds` would be non-null, `hostAnswer` would read `answered`, and the plan's proposed reading would answer *the host did answer*. `prAgeSeconds: null` proves the observed failure was a **throw** (a timeout), not a partial page. The plan never names which failure mode it fixes. Under a timeout `prError` is set, so `hostAnswer` reads **`unreachable`** — confirming the word is wrong for the very case measured.
- Whether the operator's environment ran 2.19.0 *with* the #912 fix active. The note says Plot 2.19.0 (`2d9ef409`) and #912 released in 2.19.0, so both were present — which strengthens the point above.
- I did not run the board or reproduce against `quatico/quaweb-website` (no access). Rule-level behaviour was read, not executed; I did not run the suites.

## 5. What breaks if this ships as written?

1. **A term inverts inside one package.** `unasked` means *never asked* in `rules/branch-state.ts` and *asked, no answer* in `rules/quiet.ts` — same directory, opposite senses. Nothing greps for this; it is caught only by a reviewer who knows both, which CLAUDE.md names as the difference between a rule and a gate.
2. **`hostAnswer` and the new kind disagree on the measured case.** Row says `unasked`; the footer, driven by `HOST_ANSWER_HINT` off the same `prAgeSeconds`/`prError` pair, says *could not reach the host*. One board, one fetch, two vocabularies.
3. **`quietNeedsPerson` is unspecified for the new kind.** The plan never says. Falling through the `!== 'closed-pr' && !== 'merged'` guard makes it `true` — probably right, but it is a behaviour the plan does not name and no listed test pins.
4. **Exhaustiveness fans out further than the plan's one slice admits.** Adding a `QuietKind` value makes `quietNote`'s switch, `quietKindWord`'s switch (`tuple-row.ts:1042`), `AgentRowSchema`'s enum, and `quiet.test.ts`'s `Record<QuietKind, string>` at line 116 all compile errors. The slice mentions the first three; the fourth is a test the plan does not name, and `quiet-kinds-render.browser.test.ts` renders one fixture per kind.
5. **`prState` stays a three-value type**, so `wipReadings` at `fleet.ts:4696` still asserts `'none'` about an unheard-from host — the plan adds a *sibling* boolean beside the lie rather than removing it. A later caller reading `prState` directly still gets `'none'`. Fixing the field fixes it at source; a fifth kind fixes it at the one call site that remembers to pass the flag.

## What would make this proceed

- Spell the state `unknown` (matching `HostReach`, `PrSchema.state`, `BriefStateSchema`) and add it to **`QuietBranchReadings.prState`**, not to `QuietKind`.
- Name the failure mode: throw/timeout (`prError` set) versus partial (`prAt` stamped). They produce different readings after #912, and the plan's own measurement only matches the first.
- State `quietNeedsPerson`'s answer for the new reading, and pin it.
- If a distinct rendered word is still wanted after that, justify it against `hostAnswer`, which already draws this distinction fleet-wide with the correct words.
