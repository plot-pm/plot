# A branch behind main holds nothing

> `branchState` returns `merged` for a branch that has a ref, carries no commits of its own, and does not point at the default branch. That shape has THREE sources and only one of them is landed work. Measured 2026-09-26: three approved slices read `merged` with `commits=0 prs=0 desks=0`, were absent from `--list-eligible`, and dispatch reported `dispatched=0 skipped=0` — the same output as a plan with nothing left to do.

## Status

- **State:** Delivered
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Sprint:** plot-works-in-the-repos-that-adopt-it
- **Issue:** #1002
- **Rounds:** 3
- **Approved:** 2026-09-26, Jan Wloka, in-session after panel (round 1)
- **Started:** 2026-09-26, Claude (plot-implement), `bug/a-branch-behind-main-holds-nothing`
- **Delivered:** 2026-09-27

## Changelog

- A branch whose ref is behind the default branch and carries nothing of its own is no longer reported as `merged`. The fleet holds it with a named reason instead of settling its wave, so an approved slice cannot be silently withheld from dispatch.

Board impact: the board renders whatever state the scan reports, so a row that read `merged` will read as held. No board code changes.

## Motivation

**`branch-state.ts:264` answers `merged` on a reading that is entirely fresh.** Measured 2026-09-26 by driving `branchState` directly, host `ok`, no PR, no wait:

```
claimed   claim ref, claim commit PUSHED      refTip != mainTip, commitsAhead=1, real=0
merged    claim ref, NO commit                refTip != mainTip, commitsAhead=0, real=0   <-- :264
open      ref points AT main                  refTip == mainTip, commitsAhead=0
open      no ref at all                       refTip == null
```

Row 2 is the defect. **No staleness is involved** — this is what the rule returns for a current reading of a ref that is behind the default branch and holds nothing.

### Round 1 refuted the producer this plan named

An earlier draft said `--start` creates the shape *"as a matter of course"*, its branch ref sitting at whatever main was at cut time. **It creates no ref at all.** `plot-dispatch.sh:2057` is `git worktree add -q --detach`, and `:2080` states *"THE EMPTY BRANCH IS THE WHOLE POINT … `write_agent_manifest` writes `"branch": ""`"*. A detached checkout pushes nothing.

**The real source is a claim commit that was lost or squashed away.** A claim always carries `commit --allow-empty` (`plot-worker-loop.sh:2307`), so a *successful* claim reads `claimed`. The behind-main-empty shape is what remains when that commit is gone — `a-claim-is-released-not-deleted`'s territory, and the two plans meet here.

### Two shipped tests assert this behaviour, and the plan must argue against them

`packages/domain/test/branch-state.test.ts:279` and `:283`:

```
it('answers merged when its tip is behind main')
it('answers merged where main cannot be read and the tip differs')
```

The second defends itself: *"The tips are compared, not resolved: an unreadable main is not equality."*

**A juror applied the fix and measured the blast radius: 4 failed / 38 passed**, all four in this file, all asserting `merged` for a zero-ahead behind-main branch. No collateral breakage.

**So the slice must argue against those two tests by name**, or accept that the behaviour is intended and the defect lies elsewhere. It may not simply change them to pass.

### The arm is reached by no branch on this estate

Measured 2026-09-26: 4 branches reach `:183`, 20 reach `:187`, 2 the has-ref arm, and **0 reach `:264`**. The fix is therefore safe to make and **cannot be verified against this estate's corpus** — see `a-corpus-test-says-what-it-verifies`, whose round 1 measured exactly this while testing the same line.

### The comment at `:239-250` names two shapes and there are three

The rule's own table:

| shape | ancestry says | truth |
|---|---|---|
| behind main | is an ancestor → merged | merged |
| reset to main | is an ancestor → merged | holds nothing |

The third shape is **cut from an older main and never committed to.** It is a ref that is a strict ancestor of the default branch, exactly like landed work, and it holds nothing, exactly like a reset. The discriminator at `:260` — equality of the two tips — separates *reset to main* from the other two and cannot separate those two from each other, because on both of them the tips differ.

**`plot-dispatch.sh --start` creates this shape as a matter of course.** A free agent's desk is cut detached at `origin/<main>`; its branch ref sits at whatever main was at cut time; main moves on; the ref is now behind it carrying nothing. CLAUDE.md records the detached cut as deliberate — this plan does not change it.

### What it costs, measured 2026-09-26

Three approved slices of three separate plans:

```
bug/the-rollup-is-asked-of-open-prs-only          commits=0  prs=0  desks=0  -> merged
bug/the-approval-reads-why-the-host-said-nothing  commits=0  prs=0  desks=0  -> merged
bug/a-wave-says-which-question-it-answered        commits=0  prs=0  desks=0  -> merged
```

None had ever carried a pull request. Deleting the three refs made all three dispatchable and agents took all three within two minutes.

**`merged` SETTLES a wave.** The rule's own comment says so at `:252`: the error *"does not stall the fleet — it advances it onto a seam nobody wrote."* Here it does something worse than advance: `plot-dispatch.sh` takes the scan's eligible list as a reading rather than deriving its own (`:3475`, `:3523`), so a slice the rule calls `merged` is offered to nobody. The plan stays Approved, the fleet reports no work, and the branch waits indefinitely.

**It also makes `dispatched=0` unreadable**, which is the operational cost. That output means *nothing to do* and *wrongly believed done* identically, so an operator cannot tell a finished plan from a hidden one without checking every branch by hand.

### Why this is separate from #995

`a-stale-pulse-keeps-the-sections-it-had` fixes the **board's render layer** — it carries a row's section forward rather than recomputing it from a pulse the banner has called stale. It deliberately does not reach the rule, and its *What this does NOT do* says so. The scan is stateless and re-derives from `origin/<main>` every run (`plot-fleet-scan.sh:3547`), so dispatch never reads a stale pulse: it reads this rule, fresh, and gets `merged`. Fixing the board does not make the withheld slice dispatchable.

## Design

### Round 2 settled the discriminator: there is none, and none is needed

**The answer is `open`, not `unknown`.** Round 1's implementation returned `unknown` unless the host said `MERGED`, and three fixture tests failed because `feature/unclaimed` — a branch the fixture calls **free** — left the eligible set.

**The rule's own reasoning already says why `open` is right.** `branch-state.ts:261`, on the tips-equal case:

> It points AT the default branch: **no work of its own, and none of its own landed.** `open` is what the scan already says for work not yet done.

A ref behind main holding nothing is **the same statement**. No work of its own, none of its own landed. The only difference is where it points, and where it points says nothing about what it holds.

So the existing arm's condition is too narrow rather than its answer being wrong. It tests `refTip === mainTip` when the question is *does this branch hold anything*, which `commitsAhead === 0` — the enclosing block's own condition — already answers.

**`unknown` was the wrong shape of answer.** It is a refusal to answer handed to callers who must decide anyway, and its two consumers read it oppositely: `queue.ts:207` makes it a `merge-unknown` **hold**, while `plot-fleet-scan.sh:3473` counts it as **outstanding, exactly as `open` is**. A rule whose answer means two things is not an answer.

### The throttled host is the index's problem, not this rule's

An earlier draft treated a silent host as a case this rule must handle, because `:258` refuses a host call on measured grounds — `plot-pr-merged.sh` answered *not merged* for three genuinely merged branches while throttled.

**Settled in round 2: the received state is written to the index, and a throttled host simply fails to refresh it.** Clients read the current index — potentially outdated, never invented. So a throttle does not change any branch's answer; it leaves the last known one standing.

That removes `hostReach` from this arm entirely. The rule reads what the index holds and does not care why it holds it.

### The fixture is right and the rule over-reached

`fleet.test.mjs:121` calls `feature/unclaimed` **free**; `:193` defines eligible as *"in an eligible wave, not already claimed, not deferred, not merged."* That is work a worker should pick up, and round 1's change removed it from the eligible set.

**Measured: 0 of 26 branches on this estate reach this arm**, and the corpus test cannot verify it (`a-corpus-test-says-what-it-verifies`). The fixture is the only place the behaviour is observable, so it is the evidence rather than an obstacle — and it says the rule captured a branch outside its target.

### Round 3: the two shapes are indistinguishable live, and the index tells them apart

**The blocked agent found the test that settles this** — `fleet: a branch behind main still reads merged — the regression that matters` (`fleet.test.mjs:1548`), which locks the opposite direction and whose comment predicted this change:

> The crude rule *"zero commits ahead means open"* is correct for the reset case and **WRONG here**: a branch merged with a fast-forward or left behind by a moving main also counts zero ahead, and **its work IS on main**. Testing only the reset case passes with that crude rule and proves nothing. **Both directions, or neither is proven.**

Its fixture merges `feature/landed` with a merge commit, keeps the ref, and runs `--offline`. So the rule sees **ref exists, 0 ahead, tips differ, no PR reading** — byte-identical to `feature/unclaimed`, opposite truths.

**Neither `open` nor `merged` nor `unknown` is right**, because no live reading separates them.

#### `mergeSubjectFound` is not the answer, and that is measured

It would tell them apart, and the scan **deliberately withholds it** from ref-carrying branches (`plot-fleet-scan.sh:3426`):

> Moving the lookup out of this `if` reads like a cheap early answer and would **silently report in-flight work as `merged`**, opening the next wave on it.

A resurrected ref carries a stale merge subject while doing new work — the `bug/done-holds-finished-plans-only` incident. Using it here reopens a defect the estate already fixed.

#### The index separates them, and it is already on disk

`.git/.plot/state/index/github.json` holds **972 rows keyed by `head`**, carrying `state: MERGED | OPEN | CLOSED`:

| branch | index record |
|---|---|
| `feature/landed` | a PR, `state: MERGED` |
| `feature/unclaimed` | none |

**The index is a record of what the host has ever said, not a live call.** So `--offline` stops meaning *blind* and means *do not ask the host now* — the last received answer still stands.

This is the same mechanism as the throttle answer below: an unreachable host leaves the index's state standing rather than erasing it. Offline is that case taken to its limit.

**It does not reopen the resurrection defect.** A resurrected ref doing new work carries an old MERGED record — but so does a genuinely merged branch, and what separates *those* is commits ahead, which is non-zero for real work. This arm runs only at zero ahead.

### The rule

**A ref that is behind the default branch and carries nothing of its own answers `merged` where the index holds a MERGED pull request for it, and `open` otherwise.**

`open` means *work not yet done*, which is what such a branch is when nothing was ever merged from it. A worker may pick it up; nothing is settled on its behalf.

**The reading is the index, never a live host call.** `:258` refuses a live call on measured grounds and that refusal stands — the index is consulted, and it answers the same offline as online.

`open` is not a new state and needs no new plumbing. It is what the scan already says for work not yet done, `--list-eligible` offers it, and a worker can act on it.

**The docstring at `:195-206` is what rules `unknown` out here:**

> `unknown` MARKS AN ABSENT READING, NEVER AN EMPTY ONE. **A host that was never asked leaves `open`**; a host that was asked and could not answer leaves `unknown`.

This arm has no absent reading. The readings are present and complete — a ref, zero commits ahead, tips differing — and they say the branch holds nothing. That is an empty answer, not a missing one, and the docstring assigns it `open`.

A branch of this shape is the same category read from git rather than from the host: the readings are present and they do not determine the answer. Two of the three sources mean *holds nothing* and one means *merged*, and nothing in `BranchReadings` separates them.

**`open` is what every consumer already handles.** It is the scan's own word for work not yet done, `--list-eligible` offers it, and a worker can act on it. No consumer needs teaching, and no new hold is introduced.

### The section must hold under every condition

**Section selection is a domain property, and it holds at any time** — regardless of board status, connection problems or machine overload. A rule that returns a wrong section under load, a failed fetch or a stale pulse is not a correct rule with bad luck; it is an incomplete rule.

CLAUDE.md names the row's section as the first example of what may not be decided in a component, so a board-side check that noticed `merged` beside an absent PR and refused to place the row would be the forbidden shape — and untestable without rendering.

**That is why the fix takes no new reading.** Measured on the live fleet 2026-09-26: **24 rows read `merged`, 23 carry a PR, exactly one does not — and that one is the only wrong row.** The contradiction is already inside `BranchReadings`. The rule is handed inputs that do not determine an answer and returns one anyway; resolving that needs nothing the rule cannot already see, and nothing that depends on a host being reachable.

### Three ways it breaks, measured in one session

Section membership failed three distinct ways on 2026-09-26, and the principle above is the one statement that covers all three:

| | what happened | visible to a reader? |
|---|---|---|
| **wrong** | `adoption-proposes-the-main-branch-key` in DONE as `merged` — 0 commits, 0 PRs ever, a live worker on it | yes, and arguable |
| **missing** | during a *"Not reaching the board server"* outage, the slices for two live agents vanished — WAITING ON A MACHINE held one row and NOT STARTED read `none`, while WORKING showed both agents | **no** |
| **stale** | the rollup slice read `waiting-on-machine · PR #1005, CI running` minutes after #1005 merged | plausible, so unquestioned |

**The missing case is the worst of the three**, and it is the one an operator cannot argue with: a wrong section is visible, an absent row is not. The banner had already said the board could not see, and a section membership was emitted anyway that silently dropped work in flight.

This plan fixes the first. The second and third are the same principle failing at other moments, and they belong to whatever holds the rule to *at any time* rather than *when the readings are fresh*.

### What promotes it to `merged`

The host, and only the host. `readings.pr === 'MERGED'` already overrides at `:231` for the `commitsAhead > 0` arm, for the resurrected-ref case; the same override applies here. A branch whose pull request the host reports merged is merged whatever its tips say.

**`mergeSubjectFound` does not apply.** It is read only where there is no ref (`:90`), and this shape has one.

### What this costs, stated

**A genuinely merged branch whose ref outlived the merge now reads `open` instead of `merged` when the host cannot confirm it.** That is a real regression in one direction and the trade this plan makes deliberately: `open` offers the branch to a worker, `merged` settles its wave. Re-offering finished work wastes an agent's time and is visible the moment it starts; settling unfinished work withholds it silently. Only the second is unrecoverable.

**The index bounds how often this can happen.** The host's answer is written to the index, so a throttled or unreachable host leaves the last received state standing rather than erasing it. A branch reads as unconfirmed only if the host has never answered about it at all.

The population is bounded by `plot-release-refs.sh`, which deletes a delivered plan's merged refs — CLAUDE.md records 3 surviving merged refs on this estate against hundreds of merges.

### What this does NOT do

- **It does not add a host call.** `:258` refuses one for a measured reason — `plot-pr-merged.sh` answered *not merged* for three genuinely merged branches while throttled — and this rule must not inherit that failure mode. The host reading it consults is the one already in `BranchReadings`.
- **It does not add a staleness field.** `BranchReadings` has no concept of when a value was read, and this defect does not need one. A field the rule cannot use from evidence it does not have would be the wrong fix for the right symptom.
- **It changes nothing in the board.** The section follows the state, and that is correct: a component comparing two payload fields to decide a row's section is the shape CLAUDE.md forbids, and it would mask a wrong state rather than fix one.
- **It does not change `plot-dispatch.sh`.** Taking the scan's verdict as a reading is correct — one derivation in one place — and a second opinion downstream would be the duplication the estate removes.
- **It does not change the detached cut in `--start`.** That shape is deliberate and documented; the rule is what misreads it.

## Done when

- A branch with a ref behind the default branch, no commits of its own, and **no MERGED record in the index** answers `open`.
- The same shape **with** a MERGED record in the index answers `merged`, offline.
- `fleet.test.mjs:1548` (`the regression that matters`) passes unchanged.
- `fleet.test.mjs` passes unchanged: `feature/unclaimed` stays eligible and the footer still reads `eligible=2`.
- The same branch with `pr: 'MERGED'` answers `merged`.
- A branch whose ref equals the default branch still answers `open`.
- A branch with a pushed claim commit still answers `claimed`.
- `:239-250`'s table names three shapes and says which the tip comparison can and cannot separate.
- A test covers the third shape by name.

## Slices

### A branch behind main holds nothing (Branch: bug/a-branch-behind-main-holds-nothing, PR: #1019)

Change the `:264` return, extend the table comment to three shapes, and cover the four rows of the probe above as cases.

## Notes

The probe that produced the four rows drives `branchState` directly with host `ok`, `pr: 'none'`, `waits: null`, varying only `refTip`, `mainTip`, `commitsAhead` and `realCommitsAhead`. It belongs in the test file rather than staying a scratch script.

The three measured branches no longer reproduce the shape — they carry real work now, because deleting their refs let agents take them. The evidence for this plan is the probe, not a live branch.
