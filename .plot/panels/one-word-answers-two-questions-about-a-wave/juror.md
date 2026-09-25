# Juror — p994, one-word-answers-two-questions-about-a-wave

Position: amend
Evidence: executed

## Summary

The plan's *naming* observation is real and worth fixing. Its **Motivation section is factually wrong on this estate**, and **two of its five "Done when" items are already shipped and already tested**. A worker handed this plan today would find the `--next` work done, find the caller it names does not call `--next`, and would be left with one genuine item — the body's wave line — specified too loosely to build.

---

## EVIDENCE

### 1. The reproduction does not reproduce. Three of its four claimed facts are false.

The plan's Motivation block claims, verbatim:

```
  A row says whose it is — eligible
  The readers agree about what an item is — eligible

  summary: … eligible=0 blocked=1 …

$ plot-fleet-scan.sh --list-eligible ; echo $?
0
```

Run on this estate, `main` @ `52028ae13`, 2026-09-25:

```
$ skills/plot/scripts/plot-fleet-scan.sh --offline
...
summary: plans=17 waves=23 branches=23 claimed=1 eligible=1 blocked=2 deferred=0 waiting=0 prereq_missing=0 merge_detect=pr-merge host=unasked main=main
PLAIN_EXIT=0
```

**The footer reads `eligible=1`, not `eligible=0`.** The plan's headline — *"the footer reads `eligible=0`"* — is not the estate's state.

The two waves printing `eligible` are also not the two the plan names:

```
  The board knows who is asking — eligible
      feature/the-board-knows-who-is-asking — open
  A row says whose it is — blocked
      feature/a-row-says-whose-it-is — in progress
  The board filters to my work — blocked
      feature/the-board-filters-to-my-work — claimed

  The readers agree about what an item is — eligible
      bug/the-readers-agree-about-an-item — in progress
```

The plan quotes `A row says whose it is — eligible`. It reads **`blocked`** here. The plan's own quoted output block is therefore not a transcript of a run on this estate — a wave verdict cannot have moved from `eligible` to `blocked` without a prior wave regressing.

And the offer path is **not silent**:

```
$ skills/plot/scripts/plot-fleet-scan.sh --offline --list-eligible
bug/the-rollup-is-asked-of-open-prs-only
LIST_ELIGIBLE_EXIT=0
```

One branch offered, exit 0. That is a correct, non-empty offer. `--next` is the same array at `plot-fleet-scan.sh:4271-4277` — `claimable[0]` against `"${claimable[@]}"` — so it prints `bug/the-rollup-is-asked-of-open-prs-only` and exits 0 too. **Both offer paths answered.**

Worth noting what the offered branch *is*: it sits under a wave the body printed `unapproved`:

```
  The rollup is asked of open PRs only — unapproved
```

That is the honest inverse of the plan's shape and it is a *real* finding the plan does not make — a branch the offer path names under a wave the body prints as not-dispatchable. Whatever the naming fix is, it has to survive that direction too.

### 2. The two computations ARE two different questions. The plan is right here.

The wave verdict, `packages/domain/src/rules/eligible.ts:95-109`:

```ts
if (readings.phase !== DISPATCHABLE_PHASE) return 'unapproved';
return priorComplete ? 'eligible' : 'blocked';
```

It reads the plan's phase and whether prior slices completed. It reads **no branch state at all**.

The footer counter, `plot-fleet-scan.sh:3987-3990`:

```bash
if [ "${wave_claimable:$((branch_i - 1)):1}" = "1" ]; then
  n_eligible=$((n_eligible + 1))
  claimable+=("$br")
fi
```

That bit comes from `isClaimable`, `eligible.ts:168-172`:

```ts
export const isClaimable = (
  verdict: SliceVerdict,
  state: BranchState,
  held: '' | 'waiting' | 'blocked' = '',
): boolean => verdict === 'eligible' && state === 'open' && held === '';
```

**Genuinely two questions, and the second strictly contains the first as one conjunct.** The plan's claim that both are already correct is true, and its "the fix is naming, not logic" is correct. Confirmed. No refutation available here.

The counter's *name* is the defect: `n_eligible` counts branches satisfying `isClaimable`, while the body's `eligible` is `SliceVerdict`. `summary: waves=23 … eligible=1` places a branch count in a footer whose neighbours (`waves=`, `blocked=`) are wave counts — and the header at `:96` already admits the confusion it caused: *"`blocked` counts WAVES an earlier wave holds; `waiting` and `prereq_missing` count BRANCHES"*. `eligible=` is a third grain in that list and the header does not say so.

### 3. `--next`'s exit-1 contract is ALREADY implemented, documented and tested. This is the plan's central fix and it is a no-op.

Documented, `plot-fleet-scan.sh:27-30`:

```
#   --next      print ONE claimable branch name and exit 0; print nothing and
#               exit 1 when there is none. Used by /plot-implement to pick work
#               without re-deriving eligibility. "Nothing to start" is a normal
#               state — the exit code, not stderr, is what says so.
```

Implemented, `:4270-4278`:

```bash
if [ "$next_only" = 1 ]; then
  [ ${#claimable[@]} -gt 0 ] || exit 1
```

And the empty-estate arm, `:3168`:

```bash
  [ "$next_only" = 1 ] && exit 1
```

Tested twice, `test/reconcile/fleet.test.mjs:333` and `:367`:

```js
assert.equal(code, 1, '--next must exit 1 when there is nothing to start');
assert.equal(stdout.trim(), '', '--next must print nothing but a branch name');
```

```js
test('fleet: --next stays silent when nothing is claimable', () => {
  assert.equal(stdout.trim(), '');
  assert.equal(code, 1);
```

The plan's Done-when item *"`--next` exits **1** when it offers nothing, and a test asserts it"* is **already satisfied**, including the second test's fixture — a plan whose only branch is unclaimable. That is also the plan's fifth Done-when item ("a test driving the reproduced shape"), minus the claim rather than the deferral.

### 4. The named caller does not call `--next`, and gates on no exit code.

The plan: *"`plot-dispatch.sh --next` consumes exactly this."*

The dispatcher calls `--list-eligible`, twice, at `:3471` and `:3519`:

```bash
done < <({ "$script_dir/plot-fleet-scan.sh" $offline --list-eligible "$slug" 2>/dev/null
           [ "$allow_waiting" = 1 ] && printf '%s\n' ${waits_freed[@]+"${waits_freed[@]}"}
           :; } | grep -v '^$' | sort -u)
```

It reads **lines**. The scan's exit status is swallowed by the pipe — `sort -u`'s status is what the subshell returns — and the trailing `:` makes even the compound's status unconditionally 0. An empty list yields an empty `fan_out` array and the `for` loop runs zero times. **Changing `--next`'s exit code cannot affect it and neither can changing `--list-eligible`'s.**

The other historical caller has been removed. `plot-worker-loop.sh:620-623`:

```
# THE AGENT STOPS SHOPPING FOR ITS OWN BRANCH. This replaced
# `plot-fleet-scan.sh --offline --next "$PLOT_SLUG"`, and the change is not a
# cheaper way to ask the same question — it is a different question.
```

Confirmed by `test/reconcile/free-window.test.mjs:19`: *"it reads the branch the registry wrote into its manifest"*.

So on this estate `--next` has **no production caller left** — only `/plot-implement` per the header, and the tests. The plan's "Why exit 0 makes it worse" section rests on a caller relationship that does not exist.

---

## DESIGN

### The verdict-enum deferral is right, but for a better reason than the plan gives, and the plan's reason is stale.

The plan writes `FleetWaveSchema.verdict`. That schema was renamed — `packages/board/CHANGELOG.md:1989`, *"`FleetWaveSchema` → `FleetSliceSchema`, `WaveVerdictSchema` → …"*. The live type is `SliceVerdictSchema`, `packages/domain/src/entities/fleet.ts:102`:

```ts
export const SliceVerdictSchema = z.enum(['complete', 'eligible', 'blocked', 'unapproved', 'empty']);
```

Strictness is real, so the deferral holds. But **the board does not have the ambiguity the plan's open question worries about**, and the plan should say so rather than leave it open. `packages/board/src/contract/schema.ts:1489` already carries a second, branch-grain enum:

```ts
export const StartabilityVerdictSchema = z.enum([
  'start-work', 'needs-brief', 'waiting-on-approval', 'someone-is-on-it',
]);
```

with a docstring at `:1482-1487` that makes exactly the plan's distinction and settles it:

> *"It answers a different question at a different grain: `unapproved` is one SLICE-level fact, while these four are the ROW-level answer for a BRANCH … The two agree where they overlap … and neither is derived from the other."*

`someone-is-on-it` is precisely the plan's *prerequisites met, every branch taken*. **The board solved this ambiguity already, by adding a second word at the second grain rather than renaming the first.** That is a worked precedent for the shell fix and the plan does not cite it; the open question is answerable from the repo in one grep and should not ship open.

### The body-line change is not specified well enough to implement.

*"the wave line should agree with its branch lines"* names no vocabulary and no rule. A worker must invent both. Concretely unanswered:

- What word? The board's answer is `someone-is-on-it`. The shell's would be a sixth `SliceVerdict` value or a suffix on the prose line.
- Prose or verdict? The wave line renders the verdict verbatim. A prose suffix (`eligible — every branch taken`) changes no enum and no consumer; a new enum value breaks `SliceVerdictSchema`'s strict parse in the board, which is the thing the plan declined to do. The plan does not say which side of that line it is on, and they are entirely different changes.
- Which branch states count as "taken"? `claimed`, `wip`, `waiting`, `unknown`, `merged`? The scan distinguishes six. `isClaimable` refuses on everything but `open`, but "every branch is claimed" and "no branch is claimable" are not the same set — a wave whose only branch is `unknown` (unreachable host) has nothing claimable and nothing taken.

That last one is a real trap: on this estate `host=unasked` for an offline run, and `unknown` branches are common. A rule written as *not claimable ⇒ say so differently* would relabel waves the host merely could not be asked about.

### No caller breaks either way — including the ones the plan did not check.

`--list-eligible`'s exit code: both dispatcher call sites drop it. `--next`'s: no production caller. Tests assert exit 1 already. The plan's "does not touch auto-dispatch" is correct but incidental — auto-dispatch reads the manifest, not the scan.

The one thing the plan proposes that **could** break something is the `--list-eligible` change: *"where every candidate was filtered by a claim, it says so."* `--list-eligible`'s contract at `:16` is *"print EVERY claimable branch, one per line"*, and the dispatcher pipes it through `grep -v '^$' | sort -u` into a list of **branch names**. Any explanatory sentence printed on **stdout** becomes a candidate branch the dispatcher tries to dispatch. That sentence must go to stderr, and the plan does not say so.

---

## What must change (amend)

1. **Re-measure, or withdraw the Motivation transcript.** The quoted footer (`eligible=0`), the quoted wave verdict (`A row says whose it is — eligible`) and the quoted silent offer path are all contradicted by a run on this estate today. Replace with a current transcript or state the repro is from the reporter's estate only. A plan whose Done-when says *"the estate reproduces this today, so the before/after is measurable here"* must be right about that, and it is not.
2. **Delete the `--next` exit-1 item from Design and Done when.** It is implemented (`:4271`, `:3168`), documented (`:27-30`) and tested twice (`fleet.test.mjs:333`, `:367`). Leaving it in makes a shipped contract look like new work and invites a worker to rewrite a passing gate.
3. **Delete or correct "`plot-dispatch.sh --next` consumes exactly this."** The dispatcher calls `--list-eligible` at `:3471` and `:3519` and gates on no exit code; `plot-worker-loop.sh:620` records that the worker's `--next` call was removed. If no caller reads the exit code, say so — that changes the priority of the whole "Why exit 0 makes it worse" section.
4. **Name the word and the grain for the body-line change.** Cite `StartabilityVerdictSchema` (`schema.ts:1489`) as the estate's existing answer to this exact ambiguity, and say whether the shell gets a prose suffix (no schema change) or a sixth `SliceVerdict` (schema change the plan declined). Define which branch states count as taken, and exclude `unknown`.
5. **Rename or annotate the footer's `eligible=`.** This is the sharpest available fix and the plan does not propose it: `eligible=` sits between `waves=` and `blocked=` and counts branches, and the header at `:96` already documents that mixed grain for its neighbours without covering this one. `claimable=` would end the ambiguity in one line, with the old key kept beside it if a consumer reads it.
6. **Say that `--list-eligible`'s new sentence goes to stderr.** Stdout is a branch-name list the dispatcher pipes into `sort -u`; a sentence there becomes a dispatch target.
7. **Answer the open question before approval.** It is answerable from `schema.ts:1482-1489` without a measurement, and it governs item 4.

## What is right and should survive the amendment

- Two questions, one word: correct, and confirmed against `eligible.ts:95-109` versus `:168-172`.
- "The fix is naming, not logic — both computations are correct": correct.
- Deferring the enum rename: correct call, even though the cited schema name is stale.
- "The offer paths are not wrong": correct.
