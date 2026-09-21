# An unasked host is not an absent PR

> `quietKind` answers `abandoned` where the PR fetch failed, so a branch with an open pull request is labelled as work nobody finished.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A branch whose pull-request state could not be fetched is no longer reported as abandoned. `quietKind` read `prState: 'none'` as *no pull request was ever opened*, which is also what an unreachable or unanswered host produces — so on a Bitbucket repository the board called seven branches abandoned and three of them carried pull requests, one open and two draft.

Board impact: yes. A new `quietKind` value crosses the wire; `AgentRowSchema.quietKind` gains it and the row renders it.

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

### A fifth kind, not a nullable field

`quietKind` returns a word and `null` already means *the question is not asked of this row* — a live agent, a merged branch, a PR under review. Reusing `null` for *asked and unanswered* would collapse two different silences, and the row would render exactly as it did before the fetch failed, which is the current defect with extra steps.

So the rule gains **`unasked`**, and it is tested BEFORE `prState === 'none'`: the two readings are not independent, and a host that did not answer has no `prState` worth consulting.

`quietNote` gains its sentence, and the sentence says what a person should do about it — the note names the state rather than the age, which the rule's own header establishes.

### What must not break

**`null` keeps its meaning.** A row the question is not asked of is unchanged, including on an older server whose payload predates the new value — `AgentRowSchema.quietKind` defaults to `null` for that reason and the default stays.

**`abandoned` must still fire.** A host that WAS asked and reported no pull request is genuinely abandoned work, and narrowing this into never saying so would trade one wrong answer for another. The corpus for that case is a repository whose fetch succeeded.

**One derivation.** `quietKind` is forwarded, never re-derived on the client — the rule `worker` and `findings` follow. The new value crosses the wire like the other four.

## Slices

### The rule knows it was not asked (Branch: bug/the-rule-knows-it-was-not-asked)

- `bug/the-rule-knows-it-was-not-asked` — `QuietBranchReadings` carries whether the host answered, `quietKind` returns `unasked` ahead of the `none` test, `quietNote` gains its sentence, `AgentRowSchema.quietKind` gains the value, and the server passes the reading it already holds; tests pin that `abandoned` still fires on a successful fetch reporting no pull request

## Notes

- Found while measuring why `plot-host.sh` is slow on that repository. The slowness has its own plan, `2026-09-21-the-ledger-prunes-what-it-read.md`; this one is independent and would still be worth fixing if every call were instant, because a fetch can fail for reasons no cache removes.
- Full measurement in `docs/notes/2026-09-20-the-board-never-fetches-pr-data.md`.
