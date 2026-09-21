# An unasked host is not an absent PR

> `quietKind` answers `abandoned` where the PR fetch failed, so a branch with an open pull request is labelled as work nobody finished.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A branch whose pull-request state could not be fetched is no longer reported as abandoned. The reading says the host was not asked instead of the constructor inventing *no pull request* from a null map. `quietKind` read `prState: 'none'` as *no pull request was ever opened*, which is also what an unreachable or unanswered host produces — so on a Bitbucket repository the board called seven branches abandoned and three of them carried pull requests, one open and two draft.

Board impact: **none on the wire.** The fix is a reading, not a verdict — `QuietKind` keeps its four words and `AgentRowSchema` is unchanged, so no old client meets a value it cannot parse.

## Design

### The rule cannot say "not asked"

`packages/domain/src/rules/quiet.ts:109`:

```
if (readings.prState === 'none') return 'abandoned';
```

`none` carries two meanings that a reader must never confuse: **the host was asked and said there is no pull request**, and **the host was not asked, or did not answer**. The first licenses `abandoned`; the second licenses nothing at all.

Plot already knows the difference and states it honestly one layer out — the fleet payload carries `prAgeSeconds: null` for *no successful fetch since this process started*, and `plot-host.sh` emits `possibly truncated … unprovable` rather than claiming completeness. **The care is taken and then discarded at the last step**, where not-knowing becomes a fact about the branch.

### What it says today, and what is true

Measured 2026-09-20 on `quatico/quaweb-website`: `prAgeSeconds: null`, seven branches rendered *"commits, no PR ever opened — abandoned"*, **three of them carrying pull requests** (#358 OPEN, #405 and #445 DRAFT). The raw call answers correctly in 0.4 s; the board never sees it before its own timeout.

`abandoned` is the most consequential word on the row — it is what tells a person the branch can be deleted. Producing it from an absence of evidence is the one direction this must never fail in.

### SETTLED 2026-09-21: the reading gains a word, not the verdict

The panel divided two-to-one on this and the division is resolved from the code rather than from the count.

**`prState` is documented as *"The host's state for the branch's PR"*** — an assertion about what the host SAID. A host that said nothing has no state, and `'none'` is the constructor inventing one:

```ts
prState: pr ? 'open' : 'none'      // fleet.ts:4698 — an absence it never checked
```

**The interface already has a convention for silence, and it is per-reading.** `hasMergedPr` carries *"An unreachable host answers `false`, so silence is never a merge."* That is the same question answered one field over, and the answer lives on the reading.

**And the estate has already made this exact decision, three lines above the defect.** `fleet.ts:3088`:

> *"Null, never 'github': **"not yet asked" and "asked, and it is GitHub" are different answers**, and `resolveBackend` distinguishes them to ask once."*

The same argument, for `backend`, in the same initialiser. The rule exists here; it was simply not applied to `prState`.

**So: `prState` gains `'unknown'`** — the word `HostReach`, `PrSchema.state` and `BriefStateSchema` already use, per the vocabulary juror — and `quietKind` gains an arm that returns an existing kind rather than a fifth one. `QuietKind` stays four words, `AgentRowSchema` stays unchanged, and nothing crosses the wire that did not before.

**What `quietKind` returns for it is the one thing still to decide in the slice**, and it is a small question once the reading is right: `'quiet'` is the honest existing answer — *nobody is on it, and we cannot say why* — and it keeps `quietNeedsPerson`'s fallthrough truthful without a new case.

### Superseded: a fifth kind, not a nullable field

`quietKind` returns a word and `null` already means *the question is not asked of this row* — a live agent, a merged branch, a PR under review. Reusing `null` for *asked and unanswered* would collapse two different silences, and the row would render exactly as it did before the fetch failed, which is the current defect with extra steps.

So the rule gains **`unasked`**, and it is tested BEFORE `prState === 'none'`: the two readings are not independent, and a host that did not answer has no `prState` worth consulting.

`quietNote` gains its sentence, and the sentence says what a person should do about it — the note names the state rather than the age, which the rule's own header establishes.

### What must not break

**`null` keeps its meaning.** A row the question is not asked of is unchanged, including on an older server whose payload predates the new value — `AgentRowSchema.quietKind` defaults to `null` for that reason and the default stays.

**`abandoned` must still fire.** A host that WAS asked and reported no pull request is genuinely abandoned work, and narrowing this into never saying so would trade one wrong answer for another. The corpus for that case is a repository whose fetch succeeded.

**One derivation.** `quietKind` is forwarded, never re-derived on the client — the rule `worker` and `findings` follow. The new value crosses the wire like the other four.

## Slices

### The rule knows it was not asked (Branch: bug/the-rule-knows-it-was-not-asked)

- `bug/the-rule-knows-it-was-not-asked` — `QuietBranchReadings.prState` gains `'unknown'`; `quietKind` tests it **below `hasMergedPr`** and above `prState === 'none'`, returning `'quiet'`; `wipReadings`/`claimedReadings` take the fact instead of deriving `'none'` from a null `pr`. **The fact is `entry.prs === null`, which is per ENTRY and not per branch** — one boolean threaded from `rowsFromPulse` through `classifyGroup`/`rowQuietKind`, **appended last** per `fleet.ts:3850`'s positional rule, both `rowQuietKind` call sites and the loose-branch path at `:6600` included. `everyCase()` in `packages/domain/test/quiet.test.ts` gains a dimension; `quietNote`'s `Record<QuietKind, string>` is untouched because no kind is added. Tests pin that `abandoned` still fires on a successful fetch reporting no PR, and that a merged branch never reads as unasked

### `prUnknown` is the same concept and its producer is broken

`classifyGroup` already takes `prUnknown`, whose docstring is this plan's thesis — *"an origin that could not be asked propagates as a gap, never as a value a verdict can be computed from"*. Its only producer is `held?.state === 'unknown'` over `prsByHeadMap?.get(...) ?? null`, so a null map makes it `false` for the whole outage, and the loose-branch path hardcodes `false`.

**Both readings answer from `entry.prs === null`, so the slice supplies both from one fact** rather than adding a second independent spelling. Fixing `prUnknown`'s producer is in scope; inventing a parallel mechanism is not.

## Notes

- Found while measuring why `plot-host.sh` is slow on that repository. The slowness has its own plan, `2026-09-21-the-ledger-prunes-what-it-read.md`; this one is independent and would still be worth fixing if every call were instant, because a fetch can fail for reasons no cache removes.
- Full measurement in `docs/notes/2026-09-20-the-board-never-fetches-pr-data.md`.
