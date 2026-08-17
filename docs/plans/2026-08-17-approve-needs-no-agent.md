# Approving is collecting, so it belongs in a script

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:**
- **Started:**
- **Delivered:**

## Problem

Asked on 2026-08-17 while looking at a board where every eligible card offered
`Start work` and none offered `Approve`: *if you can approve a plan, why can a
button not?*

The answer turned out to be an inconsistency rather than a reason.

### One button needs configuration and its sibling does not

| Control | Calls | Works out of the box |
|---|---|---|
| `Start work` | `plot-dispatch.sh` — a script Plot ships | **yes** |
| `Approve` | `sh -c '<Approve command> "<prompt>"'` | **no** |

Measured on the live board:

```json
"approve": { "available": false,
             "reason": "no `Approve command` in this project's Plot Config
                        — add one to approve from the board" }
```

The button renders, dimmed, naming the key. That behaviour is right for a
missing capability — what is wrong is that the capability is missing at all.

### The justification does not survive the comparison

`approve.ts` states it plainly:

> *"`plot-dispatch.sh` ships with Plot; it can approve only where the project
> has said how to run an agent … exactly as `plot-dispatch.sh` does for
> `Worker command`, and for the same reason."*

**It is not the same reason.** `Worker command` exists because dispatch starts
an agent that will *write an implementation* — genuinely per-project, genuinely
unknowable to Plot (Principle 5). Approving, under `Review: pr`, is:

1. read the plan's `Review:` answer and the PR's state
2. merge the plan PR (`plot-host.sh pr-merge`, which exists)
3. flip `**Phase:** Draft` → `Approved`
4. fill the `Approved:` transition record
5. commit and push it to the default branch

Every step is `gh` and `git` — which Plot already requires — plus one line
written into a markdown file. **Approving writes one line; dispatching starts a
program that writes a codebase.**

Two more side effects belong to it, and the first draft of this plan missed
both. Step 5 of the skill removes a `.plot/hold` entry — *the approval is what
releases the gate* — and `/plot-sprint` depends on `/plot-approve` writing the
sprint annotations it later reads (`pr:`, `status:`, `branch:`). Both are
mechanical: delete a line, rewrite a comment. **An approval that leaves the hold
in place still blocks, and one that skips the annotation makes
`/plot-sprint status` wrong** — so a script that did five of seven steps would
produce a half-approval, which is worse than none.

So the real difference is not *approve needs an agent*. It is **approve has no
script**. `plot-dispatch.sh` exists; `plot-approve.sh` does not, and the board
reached for an agent because there was nothing else to reach for.

### The machinery is already written, twice

`plot-dispatch.sh:423` holds `append_started_line()` — awk that fills a
`- **Started:**` placeholder in a plan's Status block, commits it, and pushes to
the default branch with the branch-protection fallback. `Approved:` is the same
shape in the same block, and that function was repaired on 2026-08-17 after it
appended below `Delivered:` instead of filling the placeholder — evidence that
the tricky part is written and debugged.

`plot-host.sh` already exposes `pr-state`, `pr-merge` and `default-branch`. And
the part that looked hardest is written too: **`plot-push-main.sh`** already
performs the protected-branch push and *reports what happened to it* —
`clean`, `bypassed` (naming the rules waived and the checks that did not run),
or `unknown`. A bare `git push` cannot say that, because a
protected-but-not-enforced repo waves the push through with exit 0 and only a
notice on stderr.

So the script writes almost nothing new: it chains `pr-state` → `pr-merge` →
awk-in-the-shape-of-`append_started_line` → `plot-push-main.sh`, and adds its
refusals. **That is the argument for it being a script at all** — not that
approving is simple, but that every piece of it already exists at the collecting
layer and only the sequence was missing.

## Design

### `plot-approve.sh` takes the mechanical half

Manifesto Principle 3 puts the line exactly where this problem is: **scripts
collect and report; skills interpret and adapt.** Merging a PR whose number the
plan already records, and writing a dated line into a known field, is
collecting. Deciding *whether a plan is ready* is interpreting.

So the split follows the principle rather than the current accident:

| Stays in `plot-approve/SKILL.md` | Moves to `plot-approve.sh` |
|---|---|
| Walking an `in-session` review | Reading `Review:` / `Impl:` and the PR state |
| Asking the two ceremony questions when a plan predates them | Merging the plan PR via the host adapter |
| The tracer-bullet suggestion heuristic | Flipping the phase, filling `Approved:` |
| Tallying `ballot` reviewers | Removing the plan's `.plot/hold` line |
| Judging whether a draft is *ready* | Updating the sprint annotation |
| | Pushing via `plot-push-main.sh` and reporting its verdict |
| | Refusing, with a reason, what it cannot judge |

**Seven steps, not five.** The hold and the sprint annotation are on the right
of that table because they are writes with no decision in them — and because
leaving either to a caller re-creates the split this plan exists to close.

**The skill keeps calling the script**, as `plot-dispatch/SKILL.md` does. It does
not lose a step; it stops re-implementing one in prose.

### It refuses the cases it cannot judge, and says why

A script that silently approves what a human should have looked at would be
worse than the current gap. Three refusals, each already checkable without
judgement:

- **Phase is not `draft`** — nothing to approve, and `/plot-approve` says so
  today.
- **`Review:` is not `pr`** — `in-session` and `ballot` need a human in the
  room, and no script can stand in for one. This is the honest boundary of the
  mechanical half.

  Measured: **every plan in this repo declares `Review: pr`**, so the refusal
  fires for nothing that exists today. It is still the load-bearing branch.
  `/plot-idea` offers all three values, and a script that treated an unfamiliar
  `Review:` as `pr` would approve a plan nobody had discussed — silently, and
  with a commit that looks exactly like a legitimate one. Unused is not
  impossible, and a default of *carry on* is the shape of stale assumption this
  story keeps finding.
- **The PR is a draft, closed, or has no PR** — the existing preconditions,
  moved from prose into an exit code.

**Refusing is the script's job; explaining is its output.** The board already
surfaces a failing command's own words on the card (#161), so a refusal reaches
the reader without the board learning the rules.

### The board's button loses its configuration requirement

`approveAvailability()` stops asking for `Approve command` and asks what
`dispatchAvailability()` asks: is this a local, same-origin request. The button
then behaves exactly like `Start work` — offered where the action is possible,
refused with a reason where it is not.

**`Approve command` is not removed, it is demoted.** A project that wants the
full skill — the tracer suggestion, the ceremony questions — can still declare
one, and the board prefers it when present. Absent, the script runs. That keeps
the richer path available without making it the price of entry.

### A native `disabled` becomes `aria-disabled`

Found alongside: `ApproveButton` uses the **native** `disabled` attribute, which
#160 deliberately abandoned for `StartWorkButton` — *a natively disabled control
leaves the tab order and takes its `title` explanation with it, out of reach of
exactly the reader who cannot see that it is dimmed.*

Two buttons on one surface with opposite patterns, because they were built in
parallel and the second did not see the first's decision. The fix is one
attribute and belongs here rather than in a plan of its own.

## Branches

### Script

- `feature/plot-approve-script` — `plot-approve.sh` performs the mechanical
  approval and refuses what it cannot judge; `plot-approve/SKILL.md` calls it
  instead of describing it

### Board

- `bug/approve-button-needs-no-config` — `approveAvailability()` drops the
  `Approve command` requirement and matches dispatch; `ApproveButton` moves to
  `aria-disabled`

Two waves, sequential: the button cannot stop requiring a command until there is
a script for it to call. They also touch the same two files (`approve.ts`,
`ApproveButton.tsx`), and this session paid four manual conflict resolutions in
one hour for two branches meeting in the same objects.

## Done when

- **A board with no `Approve command` can approve.** Assert against this repo's
  own config, which declares none — the exact state that produced the question.
- **`Start work` and `Approve` have the same availability rule.** Assert both
  read the same binding: two controls on one surface asking different questions
  is the defect, and a fix that only adds a fallback keeps it.
- **The script refuses a Draft-phase plan**, with the reason on the card. Assert
  the text reaches the reader — a bare failure sends them to a terminal, and
  then the command could have been typed there.
- **The script refuses `Review: in-session` and `Review: ballot`.** The
  assertion that stops the mechanical half from pretending to be the whole: a
  script cannot stand in for a human in the room, and approving without one
  would be worse than the gap this closes.
- **`Approved:` fills the placeholder rather than appending after the list.**
  Assert the line lands above `Delivered:` — `append_started_line()` had exactly
  this bug on 2026-08-17, and a second implementation would repeat it.
- **The `.plot/hold` line for the plan is removed.** Assert the gate is
  released: an approval that leaves it standing still blocks, and the plan reads
  Approved while behaving as if it were not.
- **The sprint annotation is updated.** Assert `/plot-sprint status` reports the
  approval — the annotation is written by `/plot-approve` and read by
  `/plot-sprint`, so an approval that skips it makes the sprint view wrong
  rather than merely incomplete.
- **A plan in no sprint is not a failure.** The pairing: the annotation step
  must be a no-op where there is nothing to annotate, not an error.
- **The push reports `clean` / `bypassed` / `unknown` verbatim.** Assert the
  bypass report survives to the caller: `plot-push-main.sh` exists precisely
  because a protected-but-unenforced repo exits 0 with only a stderr notice, and
  swallowing that turns a missing CI run into a mystery.
- **The push falls back to a micro-PR under branch protection.** Assert the
  rejected-push path: `/plot-approve` documents it, and a merged plan stranded
  at `Phase: Draft` is worse than an unapproved one.
- **The skill still owns what it judges.** Assert the tracer heuristic, the
  ceremony questions and the `in-session` walkthrough are unchanged — this moves
  a mechanism, not a decision.
- **`Approve command`, when declared, still wins.** Assert a project that sets
  it gets the skill path: demoted is not removed.
- **The disabled button stays focusable.** Assert `aria-disabled` and not the
  native attribute, and that the reason is reachable by keyboard.
- `pnpm run test:board`, `pnpm run test:reconcile`, `pnpm run typecheck`,
  `pnpm run validate` all pass.
- `pnpm build:board` run in the implementing worktree and the artifact
  committed — CI gates on no-diff.
- A changeset is present.
- macOS bash 3.2: no `declare -A`.

## Notes

The question came from a board, not from reading the code: every card showed
`Start work` and none showed `Approve`, and the asymmetry was visible before its
cause was.

Deliberately out of scope: making the board approve `in-session` or `ballot`
plans. Those exist because a human reviews in the room, and a button is the
wrong shape for that — the script refusing them is the design, not a limitation
to be lifted later.

Also out of scope: the duplicate-card defect found in the same screenshot, where
a plan renders twice while its own idea-branch is checked out. It is a
collector-overlap in `board.ts` — the working tree and the branch stager do not
know about each other — and shares nothing with this beyond the screenshot that
surfaced both.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {"q": "The plan lists five mechanical steps, but the skill has two more side effects it missed: step 5 removes a .plot/hold entry, and /plot-sprint depends on /plot-approve writing sprint annotations it later reads.", "a": "Both move into the script. An approval that leaves the hold in place still blocks; one that skips the annotation makes /plot-sprint status wrong. Both are writes with no decision in them — delete a line, rewrite a comment — so they belong to collecting. Five of seven steps would be a half-approval, worse than none", "category": "domain-workflows"},
    {"q": "plot-push-main.sh already exists and solves the branch-protection question — it reports clean/bypassed/unknown and names the waived rules. Does that change the scope?", "a": "The script chains existing pieces rather than building new ones: pr-state, pr-merge, awk in the shape of append_started_line, plot-push-main.sh. ~120 lines of sequencing plus refusals. That IS the argument for it being a script — every piece already exists at the collecting layer; only the sequence was missing", "category": "technical-implementation"},
    {"q": "The script refuses Review: in-session and ballot — but every plan in this repo declares Review: pr, so the refusal fires for nothing that exists.", "a": "Refuse anyway. /plot-idea offers all three, and a script treating an unfamiliar Review: as pr would approve a plan nobody discussed — silently, with a commit indistinguishable from a legitimate one. Unused is not impossible, and a default of 'carry on' is the stale-assumption shape this story keeps finding", "category": "domain-rules"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": false, "architecture": true, "implementation": true},
    "domain": {"rules": true, "workflows": true, "data": false},
    "ux": {"happyPath": false, "edgeCases": false, "errors": true, "accessibility": true},
    "nonFunctional": {"security": false, "performance": false, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
