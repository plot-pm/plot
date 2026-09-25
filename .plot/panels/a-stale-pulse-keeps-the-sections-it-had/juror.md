# Juror: p995 — a stale pulse keeps the sections it had

Position: amend
Evidence: read

Load was 31 with eight agents running, so nothing was executed. Every claim below is a
file read with a line reference. Two claims are marked UNVERIFIED and say what would
settle them.

## The evidence checks out, with one line-reference correction

**`coldState` at `AgentList.tsx:563` — confirmed verbatim.**

```
packages/board/src/app/components/AgentList.tsx:563
  const cold = coldState(fleet.ready, fleet.error);
```

**The suppression comment — confirmed verbatim, at `:578-580`** (the plan's reference is
exact):

```
packages/board/src/app/components/AgentList.tsx:578-580
    // The sections are SUPPRESSED rather than filled. Rendering `none` per
    // section is a claim about the repository, and a board that never completed
    // a scan has no basis for one.
```

The plan represents it fairly. The principle quoted is the one the code states.

**The scan comment at `plot-fleet-scan.sh:3435-3439` — confirmed verbatim:**

```
skills/plot/scripts/plot-fleet-scan.sh:3435-3439
  # The landed-work case is not lost; it is answered by the TIP COMPARISON. A
  # branch whose commits are all in `$MAIN` counts `ahead = 0`, and a merge that
  # deleted the ref takes the no-ref arm above. If a future change makes `ahead`
  # something other than "commits `$MAIN` lacks", THAT is the invariant that
  # would break — the ancestry must move back, not be missed.
```

**`coldState`'s arms — three, and it covers only the never-scanned case.** Read at
`AgentList.tsx:238-245`:

- `if (ready) return null` — *"A board that HAS scanned is not cold, whatever it is now
  doing"* (`:232-234`)
- `!ready && !error` → `Waiting for the first fleet scan…`
- `!ready && error` → `This board has never completed a scan…` + the verbatim failure

So the plan's characterisation is right: `coldState` is gated on `ready` alone, and the
warm-stale case falls straight through to the ordinary view. Its own comment at `:559-562`
says this is deliberate — *"Deliberately BEFORE the staleness check and deliberately
unchanged by it"*.

## THE CENTRAL PREMISE IS WRONG — the sections are NOT retained, and nothing near them is

The plan's `### Where it goes` says:

> the last successful pulse is already retained — that is what the banner renders from.
> What is missing is **carrying the section forward** rather than recomputing it.

The first clause is true. The second understates the work by a layer.

**What is retained is the raw pulse, on the server.** `fleet.ts:3438-3442`, the catch arm:

```
  } catch (err) {
    // A failed refresh NEVER overwrites a good result. Replacing real state
    // with emptiness because one scan failed is what makes a monitoring view
    // untrustworthy — the tab keeps the last pulse, its age, and this error.
```

`entry.pulse` is written only on success (`fleet.ts:3318`) and the catch writes only
`entry.error` (`:3456`). So the old pulse survives — correct.

**But the sections are re-derived from it on every render, server-side.**
`fleet.ts:7549`:

```
  const rows = entry.pulse
    ? rowsFromPulse(entry.pulse, entry.ages, repo, quietMinutes, entry.prs, …)
    : [];
```

`rowsFromPulse` runs unconditionally whenever `entry.pulse` is non-null — the failure is
not consulted. Each row's section comes out of `classify()`, whose signature is
`fleet.ts:4328`: `): { group: WaitingGroup; note: string }`. That runs fresh every poll.

**And no previous section is stored anywhere.** `freshCacheEntry()` at `fleet.ts:3470-3485`
enumerates the entry's whole shape — `pulse, ages, at, error, shrink, branchUrlBase,
terminal, approvedAt, ideaPlans, versions, …` — and there is no rows field, no group map,
no prior classification. The client holds no copy either: the three `useRef`s in
`AgentList.tsx` are `prior` (watched PR states, `:140`), `marks` (`:142`) and `echo`
(`:177`), all about change animation, none about section membership.

**So "carry the section forward" requires storing something that does not exist today.**
The slice must add a per-row section memory to the cache entry, decide its key (branch?
`file`? — the schema comments at `:1160` say `file` is *"the key every consumer already
joins on"*), decide its lifetime across a restart (`freshCacheEntry`'s comment at `:3474`
is explicit: *"nothing survives this process, so the first pulse is cold"*), and decide
whether it is server-side or client-side. That is a design decision the plan has not made,
and it is the largest single thing the slice must do. **The one-line slice description does
not name it.**

This alone is an `amend`: the plan must say WHERE the carried section lives and what
happens to it on a board restart.

## THE SCOPE QUESTION OVERTURNS THE MECHANISM — `ahead = 0` already discriminates

The panel prompt asked whether a claim-only branch reads `ahead = 0` on a FRESH pulse and
therefore shows as merged even when scanning healthily. **It does not, and the plan's
account of the mechanism is out of date.**

Two separate readings already prevent it.

**1. A claim carries a real commit, so it is `ahead > 0` and lands in `claimed`, not
`merged`.** `branch-state.ts:337-341`:

```
  if (readings.commitsAhead > 0) {
    // A CLAIM is a branch whose only commits beyond the default branch are
    // claim markers — empty commits a dispatcher pushed to take the work. They
    // must be real commits and not a bare pointer at the default branch: two
    // branches pointing at one commit do not diverge, so both pushes succeed
    // and both sides think they hold the claim.
    if (readings.realCommitsAhead === 0) return 'claimed';
```

The scan says the same at `plot-fleet-scan.sh:3410-3414`. A dispatched claim is
`commitsAhead = 1, realCommitsAhead = 0` → `claimed`. It never reaches the zero-ahead arm.

**2. Even at genuine zero-ahead, the tip comparison separates *merged* from *holds
nothing*.** `branch-state.ts:385-389`:

```
  if (readings.refTip !== null && readings.refTip === readings.mainTip) {
    // It points AT the default branch: no work of its own, and none of its own
    // landed. `open` is what the scan already says for work not yet done.
    return 'open';
  }
  return 'merged';
```

And its comment, `:367-372`, is the exact table the plan re-derives as novel:

```
  //   | shape         | ancestry says           | truth         |
  //   |---------------|-------------------------|---------------|
  //   | behind main   | is an ancestor → merged | merged        |
  //   | reset to main | is an ancestor → merged | holds nothing |
```

That discriminator was added in `959393307` *"A branch state is one rule (#750)"* and
wired to the scan in `63bbf014c` *"The scan asks the domain for a branch's state (#768)"*.

**So the plan's *"Why `ahead = 0` is not enough"* section is arguing against a rule the
estate replaced.** The plan writes:

> `ahead = 0` means *nothing of its own*, which is either **finished** or **not started**,
> and the tip comparison cannot separate them.

The scan's own comment at `:3495-3497` says the opposite, in terms:

```
  # THE DISCRIMINATOR IS THE OTHER DIRECTION, and it is why BOTH TIPS are
  # reported rather than a verdict about them. A branch with zero commits ahead
  # is either equal to the default branch or a strict ancestor of it, so
  # "behind = 0" and "tip = main tip" are the same predicate.
```

The tip comparison is *precisely* what separates them. The plan quotes the comment five
lines above this one and stops before the sentence that refutes it.

**This does not kill the plan — it relocates the bug.** The five DONE rows were real; the
operator saw them. But `ahead = 0` on a fresh pulse is no longer a plausible cause, so
**the plan has not established what actually produced them.** Two candidates the plan
never considers, both consistent with a stale pulse and neither addressed by carrying
sections forward:

- **The pulse is old, so the refs in it are old.** A branch dispatched after the last good
  scan is not in `entry.pulse` at all. It renders as a "row that did not exist at the last
  good pulse" — which is the plan's own unplaced case, not a mis-classification. That
  would make the DONE rows something else entirely.
- **`classify` reaches `done` by PHASE, not by `merged`.** `fleet.ts:4367` and `:4563`
  both read `if (planPhase === 'delivered' || planPhase === 'released') return { group:
  'done', … }`, and `:4563`'s comment says this outranks even a live worktree. The
  observed note was `delivered · merged`, and `delivered` is a PHASE word. **UNVERIFIED:**
  which arm fired is settleable only by reproducing the pulse, which needs the board.

**The plan must name the arm that produced the five rows before it can claim its rule
fixes them.** Right now the Done-when says *"the reproduction from #995 is a test: a branch
with a ref, zero commits, no PR, against a stale pulse"* — and per `branch-state.ts:385`
that fixture reads `open`, not `merged`, so **the stated reproduction does not reproduce
the reported symptom.** That is the sharpest single defect in the plan.

## "Strictly safer in both directions" is false as written

The plan claims:

> This is strictly safer in both directions: a genuinely merged slice stays in DONE where
> the last good scan put it, and a freshly dispatched one stays out.

Both halves are about rows that were *already* correct. The case the claim skips is the
row whose section CHANGED during the outage — a slice that merged, or whose PR went red,
after the last good pulse. That row is carried forward into WORKING or WAITING ON YOU and
is now wrong in a new way: it asserts a live state for finished work, and it does so
*silently*, because the carried section is indistinguishable from a derived one.

It is not strictly safer. It is a different trade: today the board mis-classifies toward
DONE (a row that looks finished), and under the plan it mis-classifies toward live (a row
that looks like it needs attention). The second is the better default — an operator
investigating a finished row loses a minute, while a finished-looking live row is the
failure the plan is named after — but **it is a judgement about which error is cheaper,
not an absence of error**, and the plan should say so. `amend`: replace "strictly safer in
both directions" with the argued trade.

## "unplaced" is justified, and the cold-case objection does not land

The prompt asked whether the cold case argues against showing unplaced rows. It does not,
and the distinction the code draws is the reason.

The cold suppression at `:578-580` is justified as *"Rendering `none` per section is a
claim about the repository"* — the harm is the claim of EMPTINESS, not the hiding. A warm
board hides nothing today; adding rows to an `unplaced` heading makes no emptiness claim
about any section. The two cases are consistent.

The stronger argument for `unplaced` is in the estate already: `fleet.ts:3301-3307`
describes `shrink`, where a scan that exits 0 with fewer plans is *"accepted … but it is
MARKED, so the tab degrades rather than hiding."* `unplaced` is the same move. This is
worth citing in the plan — it turns a bare assertion (*"hiding them would be its own
lie"*) into an estate precedent.

## The banner distinction the plan conflates

`AgentList.tsx:281-283`:

```
  // Whether the server is answering at all. Not the same question as
  // `fleet.error`, which is a server that answered to say its scan failed.
  const stale = staleSeconds !== null;
```

The plan's title and prose say "stale pulse" throughout and quote the `fleet.error` banner
(`Last scan failed: … showing the last successful pulse below`, built at `:657-664`).
Those are two conditions with two banners and two severities (40 vs 30, `:649`/`:658`).
`amend`: the rule must state which one it triggers on. My reading is `fleet.error` only —
under `stale` the client is not receiving new data at all, so there is nothing being
re-derived and the frozen view is already correct. If the slice guards on both it will
change behaviour in a case that is not broken.

## The staleness ceiling

Leaving it open is acceptable and I would not block on it. The slice is buildable without
it: the rule "carry forward on failure" is complete, and a ceiling is an additive second
rule with its own threshold argument. The plan is right that the cold case offers no
precedent. Note only that `staleSeconds` already exists as a rendered value (`:653`), so
whoever answers it later has the reading in hand.

## What must change for `proceed`

1. **Name the arm that produced the five DONE rows**, or state plainly that it is
   unidentified and that the slice's first task is to identify it. The current mechanism
   story cites `ahead = 0` against `branch-state.ts:337` (`claimed`) and `:385` (`open`),
   both of which already prevent it.
2. **Fix the stated reproduction.** *"a branch with a ref, zero commits, no PR"* reads
   `open` per `branch-state.ts:385-389`, not `merged`. The Done-when asserts a fixture that
   cannot fail today.
3. **Say where the carried section is stored** — `CacheEntry` (`freshCacheEntry`,
   `fleet.ts:3470`) or client `useRef` — and what a board restart does to it. The claim
   *"the last successful pulse is already retained … what is missing is carrying the
   section forward"* reads as though the storage exists; it does not.
4. **Replace "strictly safer in both directions"** with the actual trade: a row whose
   section changed during the outage is carried forward wrong, and that error is preferred
   because a live-looking row costs less than a finished-looking one.
5. **State whether the rule fires on `fleet.error`, on `stale`, or on both** —
   `AgentList.tsx:281-283` says they are different questions.

Items 1 and 2 are the blocking ones. A slice built on the plan as written would add a
retention mechanism, pass a test asserting a fixture reads `open`, and leave the operator's
five rows exactly where they are.
