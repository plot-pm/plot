---
"@plot-pm/board": minor
---

A green check no longer outranks an unknown merge: `prState` returns `unknown` when the host could not say whether a branch merges, before consulting `checks` at all.

**Measured, live, from a screenshot.** On 2026-08-17 PR #57 read `green` in the agents row while the host said the branch could not merge:

```
plot-host:  checks="green"   mergeable="conflicting"
gh:         mergeable=CONFLICTING   mergeStateStatus=DIRTY
```

A branch unmergeable for 22 days wearing the one word a reader acts on without checking. A minute later the same row read `conflicts`, correctly — so the defect is real, intermittent, and repairs itself, which is why nobody reproduced it on request.

**The fold was right; its input was not.** `prState` handled `conflicting` correctly and had no case for `unknown`, so control fell through to `checks`. GitHub computes mergeability lazily and its API returned `503` at least four times that afternoon; under that load `mergeable` comes back `UNKNOWN` while `statusCheckRollup` — a plain stored field — still answers `green`. The function's own comment already stated the rule it needed — *a new word from a future host must read as cannot say, never as the reassuring end of the range* — and applied it to `checks` while letting `mergeable` bypass it.

`conflicting` still outranks everything and the new line sits below it, so a host that knows the branch conflicts still says so. **`checks` is not consulted to break the tie**, and that is the point rather than an omission: the two fields answer different questions, and a green check says nothing about whether a branch merges. Twenty-two days of green on a conflicting branch is the proof.

**The note now says WHICH fact is missing**, because only one of the two is actionable: *cannot say whether it merges* sends a reader to check for a rebase, *cannot read the checks* sends them nowhere but back later. `classify` and `draftNote` carry the same precedence as `prState`, so a row's word and its sentence cannot disagree — a draft whose mergeability could not be read no longer gets the silence that means *not ready for you, but otherwise fine*.

**A transition into or out of `unknown` does NOT flash the change marker.** With the fix, a 503 turns `green` into `unknown` and the next pulse turns it back — two flashes per row per outage, and there were four outages in one afternoon. `unknown` is a fact about the *observation*, not the world, and the marker reports changes in the world; this is the marker's own rule — *absent is unknown, never a value* — applied one level up, the same reason it already refuses to flash on a first sighting. The memory carries the last known value across the unreadable pulse rather than storing `unknown`, so `green → unknown → failing` still flashes when `failing` becomes visible: the marker misses the moment, never the fact.

**Where no PR on the board could be read, the empty WAITING ON A MACHINE section names the host's limit** instead of promising *CI will finish*. Measured: the Bitbucket adapter emits a literal `checks:"unknown", mergeable:"unknown"` on every row because `bb` has no run listing. That is the CLI's limit rather than deferred work, so that section is permanently empty there — and an unexplained empty section reads as *nothing is running* rather than *this host cannot tell me*. The condition is ALL and not ANY: one unknown row among readable ones is a single PR mid-outage, and an empty board claims nothing at all.

**One consequence is a real cost and is asserted rather than left to be found.** `stuck.ts` reads `prState`, so a branch whose checks are `failing` while its mergeability is unreadable no longer reports `ci-failing` — it reports nothing until the next readable pulse. That is the correct trade: a stuck verdict derived from a pulse the host could not answer is a guess, and `stuck` is the one field a later wave is licensed to act on. The row still *says* *cannot say whether it merges*, so nothing is hidden from the reader; only the machine-actionable claim is withheld. Locally-observed evidence — a `merge-tree` conflict, unpushed commits — is unaffected, and asserted so.

No contract change and no new field: `prState` remains a pure function over the two facts it already received.

Two test factories omitted `mergeable` and now state it. That is load-bearing rather than cosmetic: unreadable mergeability outranks every `checks` verdict below it, so an omitted field would send every case in those blocks down the new arm and assert nothing about the checks each was named for. One assertion is replaced rather than added — it read `.toMatch(/no checks/)` for `mergeable: 'unknown'`, which encoded the defect.

<!--
bumps:
  skills: {}
-->
