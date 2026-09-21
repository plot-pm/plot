# The board asks only what changed

> One `gh pr list` is 30 744 ms of a 32 105 ms scan. The host filters by update time server-side, so the same call over the last day is 943 ms — the board stops re-reading a history that cannot change.

## Status

- **State:** Approved
- **Type:** feature
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-21, jwloka, in-session

## Changelog

- The board asks its git host only about pull requests that changed since it last looked, and remembers the rest between runs. Measured on this repository: one `gh pr list --state all` over 933 pull requests takes 29 811 ms with the fields the board needs, and the same call with `--search "updated:>"` over one day takes 943 ms for 3 rows. The board refreshes every 5 s against a derivation that takes 32 s, so under load it reported *"No contact with the board server for 12 polls"* while the server was alive and inside that call.

Board impact: yes, and it is the subject. `refreshPrs` gains a durable store; nothing on the wire changes.

## Design

**The full argument is [`docs/stories/the-index-holds-what-the-host-said/DESIGN-index.md`](../stories/the-index-holds-what-the-host-said/DESIGN-index.md)**, including the per-connector lifecycle and the three questions it leaves open. This plan implements the two slices that need no further decision.

### What is already there, and what is missing

`PR_REFRESH_MS = 60_000` exists: PR data is **already** on its own timer rather than on the 5 s render. `refreshPrs` is one function, makes **one** `hostSaid(['pr-list', '--rich', …])` call, and writes four fields — `prs`, `prsByNumber`, `prsByHead`, `prAt`.

**So the seam is narrow and the missing parts are two:** the map does not survive the process, and the call asks about the whole history every time.

### The store

```
.plot/state/index/<connector>.json
```

Machine-local and gitignored, `plot-boardctl.sh:83`'s reason: a store travelling in a commit would describe another machine's account. Keyed by **PR number**, never by branch — a branch carries several PRs over its life, and `plot-pr-merged.sh` records what keying by the newest costs.

**`watermark` is the newest `updatedAt` the host RETURNED, never the local clock.** Skew would otherwise close a window forever: a PR updated at 18:42:10 host-time, read by a client whose clock says 18:42:12, is excluded by every later `updated:>18:42:12`.

**A field the host did not answer is absent, not false** — the rule `an-unasked-host-is-not-an-absent-pr` states, and the `state: 'unknown'` path at `fleet.ts:2568` already distinguishes.

### What must not break

**A cold store behaves exactly as today.** No index, or an unrecognised `v`, means one full read — the current call, unchanged. The store is an optimisation and its absence may cost time and nothing else.

**A failed delta never advances the watermark.** The window stays open and the next refresh re-asks it. A skipped window is a change nobody ever sees again, which is the one direction this may not fail in.

**Completeness is recorded, not inferred.** `plot-fleet-scan.sh:1031` falls through to one host call per branch when the bundled list cannot be proven whole — measured 2026-08-23, **28 of 29** such calls were for branches with no ref and no PR, re-learning `NONE` forever. A partial store must never license that answer, so *"asked, and there is no PR"* is a fact with a timestamp rather than an absence.

**The `allUnknown` outage path stays.** `fleet.ts:2568` keeps the last good map and raises the banner when every PR reads `unknown`. A store makes that path more important, not less: it is what stops a dark host overwriting good data.

## Slices

### The store holds what the host said (Branch: feature/the-store-holds-what-the-host-said)

- `feature/the-store-holds-what-the-host-said` — `refreshPrs` reads the store before its call and writes it after, keyed by PR number, with the watermark taken from the returned data. The call itself is unchanged, so this slice is measurable on its own: a restart stops costing a full read. A cold store, an unrecognised version and a failed write each fall back to today's behaviour

### The call asks only for the delta (Branch: feature/the-call-asks-only-for-the-delta) <!-- waits: feature/the-store-holds-what-the-host-said -->

- `feature/the-call-asks-only-for-the-delta` — `plot-host.sh pr-list` gains `--since <iso>`, passing `--search "updated:>…"` on GitHub and `q=updated_on>=…` on Bitbucket; `refreshPrs` sends the watermark and merges the answer into the store. A periodic full read stays, because a delta cannot see a deletion. `PR_REQUESTS_PER_REFRESH` follows the new cost

## Notes

- **Jenkins and git are deliberately out of scope**, by measurement: `jen build list` is 12 ms, `git for-each-ref` over 266 refs is 104 ms. The design records both.
- Where the store is read — shell or board — is settled here for the board only: `refreshPrs` is the one caller and it is TypeScript. Whether `plot-fleet-scan.sh` should read the same store is left open, because the two run at different frequencies and `docs/shell-and-domain.md` §1 decides it on exactly that.
