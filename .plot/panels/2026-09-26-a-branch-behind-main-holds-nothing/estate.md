# Estate lens — a-branch-behind-main-holds-nothing

Position: amend
Evidence: read

## 1. Is the defect real?

**Yes, and it is not already fixed.** `branch-state.ts:264` is a bare `return 'merged'`
guarded only by the tip-equality test at `:260`. A ref that is a strict ancestor of
`origin/main` carrying zero commits answers `merged` on a wholly fresh reading, with no
host involvement. Measured live on this estate: of 7 remote refs, exactly ONE has that
shape — `origin/feature/the-domain-knows-a-round`, 0 commits ahead, tip != main tip — and
`gh pr list --head ... --state all` returns `[]`, so it has never carried a pull request.
That is the plan's shape, reproducing today, and nothing in the estate calls it `merged`
for a defensible reason.

`merged` really does settle a wave: `pulse.ts:67` — `complete: slice.branches.every((b) =>
b.deferred || b.state === 'merged')` — and `verdict.ts:57` returns `null` for `merged`, so
the branch is offered by nothing. The plan's causal chain to a silent withhold is sound.

## 2. Does the fix work, or is it already done / already refused?

**The state change is not already done, but the fix does NOT achieve what the plan says
it achieves, and this is the finding.**

The plan's second-to-last paragraph of Motivation is its promise: *"so an approved slice
cannot be silently withheld from dispatch"*, and the Changelog says *"the fleet holds it
with a named reason instead of settling its wave."* The second clause is true. The first
is false, and the estate says so in three places the plan cites without following:

- **`eligible.ts:145`** — *"`unknown` is a host that could not be asked, which is never
  permission."* `dispatchableBranch` requires `open`. `unknown` is refused.
- **`plot-fleet-scan.sh:3478-3482`** — *"WHAT IT DOES CHANGE IS CLAIMABILITY... `--next`
  offers branches whose state is `open`, so an `unknown` branch is not handed out."*
- **`branch-state.ts:195-206`**, the docstring the plan quotes as its precedent, states
  the same: *"What it changes is CLAIMABILITY: `--next` offers `open` branches, so an
  `unknown` branch is not handed out."*

`plot-dispatch.sh:3475` reads `--list-eligible`, whose claimable flag is the domain's
`dispatchableBranch`. So after this fix the three measured slices read `unknown`, are
still absent from `--list-eligible`, and dispatch still reports `dispatched=0`. **The
silent withhold becomes a named withhold. The work still never gets dispatched.**

The plan's own evidence agrees and it did not notice: *"Deleting the three refs made all
three dispatchable"* (line 57). Deleting the ref moves `refTip` to `null`, which takes the
no-ref arm and returns `open` — the claimable state. The repair that worked was **ref
deletion**, not a state rename, and the plan proposes the state rename while citing the
ref deletion as proof.

**`unknown` is also strictly worse than `open` here for the third source the plan
identifies.** A branch cut from an older main and never committed to is, semantically,
*nobody has started this* — which is what `open` means and what `a-reset-branch-is-not-a-
merged-one` already decided for its sibling shape (`:276`, tip equality → `open`). The
readings are not absent; they are present and say *this ref holds nothing*. The plan's own
docstring quote forbids its choice: *"`unknown` MARKS AN ABSENT READING, NEVER AN EMPTY
ONE"* (`:195`). A behind-main empty ref is the textbook EMPTY reading.

## 3. What does the plan claim that the code contradicts?

**(a) The causal claim is refuted outright.** Line 45: *"`plot-dispatch.sh --start` creates
this shape as a matter of course. A free agent's desk is cut detached at `origin/<main>`;
its branch ref sits at whatever main was at cut time."* A free agent **has no branch ref at
all.** `plot-dispatch.sh:2057` is `git worktree add -q --detach "$start_wt"
"origin/$start_main"` and `:2080` says *"THE EMPTY BRANCH IS THE WHOLE POINT... `write_agent_
manifest` writes `"branch": ""`"*. A detached checkout creates no `refs/heads/*` and pushes
nothing. `--start` cannot produce a remote ref behind main, and the sentence *"its branch ref
sits at whatever main was at cut time"* describes a ref that does not exist.

**The real source is a sibling plan filed the same day.** `a-claim-is-released-not-deleted`
(#1003) documents the operator repair — deleting a claim ref — and `plot-worker-loop.sh:2307`
shows a claim always carries `commit --allow-empty`, so a *successful* claim reads `claimed`
(the plan's own probe row 1). The behind-main-empty shape comes from a ref whose commits were
squashed away or whose claim commit was lost, not from `--start`. **Whatever the plan names as
the producer determines where the fix belongs**, and it has named the wrong one.

**(b) Two shipped tests assert the exact opposite, and the plan does not mention either.**
`packages/domain/test/branch-state.test.ts:279-281` — `it('answers merged when its tip is
behind main')` — and `:283-286` — `it('answers merged where main cannot be read and the tip
differs')`, commented *"The tips are compared, not resolved: an unreadable main is not
equality."* The second is a case the plan never considers: `mainTip: null` reaches `:264` and
would become `unknown` under this change, turning every branch on a repo whose main ref cannot
be read into a held slice. The plan's *Done when* lists four state assertions and none of them
is this one.

**(c) `queue.ts:56`/`:207` do not say what the plan says they say.** The plan cites them as
proof that *"downstream behaviour is already defined."* `queue.ts:62` declares `landed:
LandedAnswer` and `:206-207` branch on `slice.landed`, which is the host's `mergedAt` via
`rules/landed.ts` — **not** `branchState`'s word. So `merge-unknown` is not reachable from
this change, and the plan's claim that the fix *"converts a silent skip into a visible hold
with an existing reason code"* has no code path behind it.

**(d) `startabilityVerdict` has no `unknown` arm.** `verdict.ts:54-57` handles `wip`,
`claimed`, `merged`, `deferred`; `unknown` falls through to `'start-work'` if the verdict is
eligible. The plan says *"It changes nothing in the board"*, but the board's startability cue
would read *start-work* on a branch dispatch refuses — a new contradiction between two rendered
facts, and CLAUDE.md's *every rendered state is a domain property* makes that the plan's
problem, not a follow-up's.

## 4. What must the plan say before someone builds it?

1. **Name the real producer.** Delete the `--start` paragraph. `--start` cuts detached and
   writes `"branch": ""`; cite the ref-deletion repair (`a-claim-is-released-not-deleted`)
   or the squash case instead. As written, a builder reading line 45 would go looking at
   `plot-dispatch.sh` for a shape it cannot make.
2. **State what the fix does to dispatchability, honestly.** Either argue that a named hold
   is the whole deliverable and drop *"cannot be silently withheld from dispatch"* from the
   Changelog, or change the target state to `open` so `dispatchableBranch` accepts it.
   `open` is what the estate already chose for the tip-equality sibling and it is what the
   plan's own measured repair produced.
3. **Address the two tests it inverts by name**, including `mainTip: null` → `merged`, and
   say what that case should answer. A plan that silently flips a shipped assertion with a
   stated rationale (*"an unreadable main is not equality"*) has not engaged with it.
4. **Withdraw the `queue.ts` citation or re-ground it.** `slice.landed` is a `LandedAnswer`
   from the host; `branchState`'s `unknown` does not reach `merge-unknown`.
5. **Say what `startabilityVerdict` answers for `unknown`**, since it currently answers
   `start-work` and the plan claims no board change is needed.

## 5. Through my lens: what already exists that this duplicates or contradicts?

**This is the third plan on the same six lines, and the set is documented.**
`a-reset-branch-is-not-a-merged-one` (Released 2.13.0) **wrote the two-shape table this plan
proposes to extend**, and its own *"Challenged 2026-08-30"* section names the set explicitly:
*"three plans, one question, and this is the careful one... A fix for one can break the other,
because both live in the gap between ancestry and the host's answer."* The mirror is
`a-squash-merged-branch-is-merged-not-open` (2.5.1), which fixed the opposite error direction.

**So the prior art is not merely adjacent — it predicted this plan's risk and set the bar it
must clear.** The released plan priced the throttled host, reasoned about `merge_by_subject`,
and said why the squash case keeps working under its rule. This plan asserts *"`mergeSubjectFound`
does not apply"* (correct, `:183` is ref-absent-only) but never asks the mirror question the set
demands: **what does a squash-merged branch whose ref survived read after this change?** It reads
`merged` today via `:264`, since a squash leaves it behind main with 0 commits ahead by subject-
rewrite. Under this fix it reads `unknown` unless the host confirms. The plan's *What this costs*
section does describe this ("A genuinely merged branch whose ref outlived the merge now reads
`unknown`") and bounds the population at 3 via `plot-release-refs.sh` — **that half is done
properly**, and it is the plan's strongest section. What is missing is that this is the mirror
error the set was told to check, and that the shipped plan handling it is cited nowhere in this one.

**Not a duplicate, and not already refused.** `unknown` for this specific shape has not been
proposed before — `git log -S` on the table comment returns only the three commits that created
and moved it (#546, #554, #750). The rule now lives only in the domain: `a-branch-state-is-derived-
once` (#750) moved it out of the shell, and `grep -n '^branch_state'` finds no function — the shell
gathers readings (`branch_readings()`, `:3407`) and the corpus test guards the pair. So there is one
implementation and no shell/domain divergence to worry about, which the plan correctly does not claim.

**Verdict: amend.** The defect is real and reproduces on one live ref today. The state currently
returned is wrong. But the plan misidentifies what creates the shape, cites two downstream rules
that do not carry its `unknown`, silently inverts two shipped tests, and — decisively — promises
dispatchability that `unknown` cannot deliver because three separate places in this estate say
`unknown` is never permission. Amend to target `open`, or amend the promise. Do not build it as
written.
