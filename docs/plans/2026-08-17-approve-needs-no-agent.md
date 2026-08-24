# Approving is collecting, so it belongs in a script

## Status

- **Phase:** Released
- **Type:** bug
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:** 2026-08-17, jwloka, plan-PR #163 merged (four interrogation rounds)
- **Started:** 2026-08-17, Jan Wloka, `feature/plot-approve-script`
- **Delivered:** 2026-08-17
- **Released:** 2026-08-18, v2.5.0
- **Started:** 2026-08-17, Jan Wloka, `bug/approve-button-needs-no-config`

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
| Tallying `ballot` reviewers | Removing the `.plot/hold` entry for each branch the plan names |
| Judging whether a draft is *ready* | Updating the sprint annotation |
| | Pushing via `plot-push-main.sh` and reporting its verdict |
| | Refusing, with a reason, what it cannot judge |

**Seven steps, not five.** The hold and the sprint annotation are on the right
of that table because they are writes with no decision in them — and because
leaving either to a caller re-creates the split this plan exists to close.

**The hold is keyed by BRANCH, not by plan**, which the first draft got wrong by
writing *"the plan's `.plot/hold` line"*. Measured:
`plot-phase-gate.sh:121` matches `$1 == b` against the branch name, and a plan
names several branches. So the script reads the plan's `## Branches` section and
removes the entry for each — the plan is what connects a slug to the branch
names the hold file speaks in. Entries for branches this plan does not name stay
exactly where they are: approving one piece of work must not release someone
else's gate.

Measured too: **there is no `.plot/hold` in this repo at all.** Handled anyway,
for the same reason as the `Review:` values — the gate reads that file on every
commit, and it is absent only because nobody has written one yet. A script that
ignored it would behave correctly until the first time it mattered, which is
precisely when it would be relied upon.

**The script must survive the repo's own gate.** `plot-phase-gate.sh` is a
PreToolUse hook that blocks commits *while the governing plan is Draft* — and
`plot-approve.sh` commits exactly then, because rewriting the phase **is** the
transition. The gate lets plan-file-only commits through, so this should work;
what is missing is that nothing says so. The `Done when` list turns that
assumption into a check, because a script strangled by its own repo's hook would
fail in the one state it always runs in.

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

### It is idempotent, because one of the seven steps cannot be undone

Step 2 merges the PR, and **that write is irreversible** — everything after it
is local. So a run interrupted between the merge and the push leaves the PR
merged while the plan on the default branch still reads `Phase: Draft`. The
skill names that exact outcome as the thing never to allow: *"never leave the
merged plan stranded at `Phase: Draft`"*.

The skill also already contains the answer, and the first draft of this plan did
not carry it across — step 2's `Already merged` case says *"the approval already
happened — skip to step 4 to make sure it's recorded"*. That is not error
handling; it is **idempotence**, and it means the repair for a half-finished
approval is *run it again*.

So `plot-approve.sh <slug>` may run any number of times. Each step asks whether
it is already done and skips if so:

| Step | Already-done test |
|---|---|
| Merge the PR | `plot-host.sh pr-state` reports `MERGED` |
| Flip the phase | `plot-plan-meta.sh` reports `approved` |
| Fill `Approved:` | the record is non-empty |
| Clear the holds | no entry for the plan's branches |
| Sprint annotation | already carries the approval |
| Push | nothing left to commit |

**Each test asks the source the step would have written**, never a progress file
of its own. A progress file is a second source of truth that can disagree with
the repository — and disagree exactly when someone intervened by hand between
two runs, which is the case it would exist for. Git and the files **are** the
state (Principle 1).

**Reordering to put the merge last was the alternative, and it is worse.** It
would leave a window where the plan reads `Approved` while its PR is still open,
and where the `Approved:` record names a PR number that has not merged — trading
a recoverable half-state for a lying one.

### The board's button loses its configuration requirement

`approveAvailability()` stops asking for `Approve command` and asks what
`dispatchAvailability()` asks: is this a local, same-origin request. The button
then behaves exactly like `Start work` — offered where the action is possible,
refused with a reason where it is not.

**`Approve command` is not removed, it is demoted.** A project that wants the
full skill — the tracer suggestion, the ceremony questions — can still declare
one, and the board prefers it when present. Absent, the script runs. That keeps
the richer path available without making it the price of entry.

**And the two entrances are not two implementations.** The skill calls the
script, as `plot-dispatch/SKILL.md` does — so `Approve command` starts an agent,
which runs the skill, which runs `plot-approve.sh`. The seven mechanical steps
go through **one** implementation either way:

```
no Approve command:    board → plot-approve.sh
with Approve command:  board → agent → SKILL.md → plot-approve.sh
```

Without that, demoting rather than removing would leave two paths to one
outcome, free to drift — precisely the duplication this plan exists to remove,
reintroduced as a configuration option.

**Over Tailscale the button is disabled, and that is correct.** `dispatch.ts:51`
states the rule the board already lives by: *the binding is the authorisation*,
and a Tailscale address is **deliberately not localhost**. So the same phone
that reads the board perfectly well cannot approve from it — approving merges a
PR and writes to the default branch, which is a different decision from reading
a status away from the desk.

Recorded here because it will otherwise look like a bug: `Start work` behaves
identically for the same reason, and a future reader finding both disabled on a
phone should see this paragraph rather than "fix" it.

### A native `disabled` becomes `aria-disabled`

Found alongside: `ApproveButton` uses the **native** `disabled` attribute, which
#160 deliberately abandoned for `StartWorkButton` — *a natively disabled control
leaves the tab order and takes its `title` explanation with it, out of reach of
exactly the reader who cannot see that it is dimmed.*

Two buttons on one surface with opposite patterns, because they were built in
parallel and the second did not see the first's decision. The fix is one
attribute and belongs here rather than in a plan of its own.

## Waves


### Script (Branch: feature/plot-approve-script, PR: #168)
- → #168 — `plot-approve.sh` performs the
  mechanical approval and refuses what it cannot judge; `plot-approve/SKILL.md`
  calls it instead of describing it


### Board (Branch: bug/approve-button-needs-no-config, PR: #169)
- → #169 — `approveAvailability()` drops the
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
- **The `.plot/hold` entry for EACH branch the plan names is removed.** Assert
  with a hold file holding three entries where the plan names two: the two go,
  the third stays. Keyed by branch, not by slug — approving one piece of work
  must not release an unrelated gate.
- **A missing `.plot/hold` is not a failure.** The file does not exist in this
  repo, so the common path is the absent one.
- **The script commits successfully while `plot-phase-gate.sh` is active and
  the plan is still Draft.** The state it ALWAYS runs in: rewriting the phase is
  the transition, so the commit happens before the plan stops being a Draft. A
  script strangled by its own repo's hook fails in its only case.
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
- **A second run after a completed one changes nothing and fails nothing.**
  Assert idempotence directly: the merge is irreversible, so *run it again* has
  to be the repair for every interruption after it.
- **A run interrupted between the merge and the push is repaired by re-running
  it.** Assert the exact half-state — PR merged, plan still `Draft` — reaches
  Approved on the second run. This is the case the whole property exists for,
  and a test that only re-runs a *successful* approval passes without it.
- **The already-done tests read the real sources, not a progress file.** Assert
  the script recovers when the state was changed by hand between runs: a
  progress file would disagree with the repository in exactly that case.
- **The skill still owns what it judges.** Assert the tracer heuristic, the
  ceremony questions and the `in-session` walkthrough are unchanged — this moves
  a mechanism, not a decision.
- **`Approve command`, when declared, still wins.** Assert a project that sets
  it gets the skill path: demoted is not removed.
- **Both entrances run the SAME mechanical implementation.** Assert the skill
  path ends in `plot-approve.sh` rather than repeating its steps — two paths to
  one outcome would drift, which is the duplication this plan removes.
- **The button is disabled over a non-localhost binding**, with the binding's
  own reason. Assert a Tailscale-style host: reading the board from a phone
  works, approving from it does not, and `Start work` behaves identically.
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
  "round": 4,
  "questionHistory": [
    {"q": "The plan lists five mechanical steps, but the skill has two more side effects it missed: step 5 removes a .plot/hold entry, and /plot-sprint depends on /plot-approve writing sprint annotations it later reads.", "a": "Both move into the script. An approval that leaves the hold in place still blocks; one that skips the annotation makes /plot-sprint status wrong. Both are writes with no decision in them — delete a line, rewrite a comment — so they belong to collecting. Five of seven steps would be a half-approval, worse than none", "category": "domain-workflows"},
    {"q": "plot-push-main.sh already exists and solves the branch-protection question — it reports clean/bypassed/unknown and names the waived rules. Does that change the scope?", "a": "The script chains existing pieces rather than building new ones: pr-state, pr-merge, awk in the shape of append_started_line, plot-push-main.sh. ~120 lines of sequencing plus refusals. That IS the argument for it being a script — every piece already exists at the collecting layer; only the sequence was missing", "category": "technical-implementation"},
    {"q": "The script refuses Review: in-session and ballot — but every plan in this repo declares Review: pr, so the refusal fires for nothing that exists.", "a": "Refuse anyway. /plot-idea offers all three, and a script treating an unfamiliar Review: as pr would approve a plan nobody discussed — silently, with a commit indistinguishable from a legitimate one. Unused is not impossible, and a default of 'carry on' is the stale-assumption shape this story keeps finding", "category": "domain-rules"}
    {"q": "The plan says the script removes 'the plan's .plot/hold line'. Measured: plot-phase-gate.sh:121 matches $1 == b against the BRANCH name, and a plan names several branches.", "a": "Remove the entry for every branch the plan names — the plan is what connects a slug to the branch names the hold file speaks in. Entries for branches this plan does not name stay: approving one piece of work must not release someone else's gate", "category": "domain-rules"},
    {"q": "plot-phase-gate.sh is a PreToolUse hook blocking commits while the governing plan is Draft — and plot-approve.sh commits exactly then, because rewriting the phase IS the transition.", "a": "Pin it as an acceptance criterion. The gate lets plan-file-only commits through, so it should work; what is missing is that nothing says so. A script strangled by its own repo's hook would fail in the one state it always runs in", "category": "technical-implementation"},
    {"q": "There is no .plot/hold in this repo at all — the mechanism is unused, like Review: in-session.", "a": "Handle it anyway, same reasoning. The gate reads that file on every commit; it is absent only because nobody has written one. A script that ignored it would behave correctly until the first time it mattered — which is exactly when it would be relied on", "category": "domain-data"}
    {"q": "dispatch.ts:51 says a Tailscale address is deliberately NOT localhost — the binding is the authorisation. So Approve would be disabled on the phone that reads the board.", "a": "Correct, and recorded explicitly. Approving merges a PR and writes to the default branch — a different decision from reading a status away from the desk. Start work behaves identically for the same reason, and a future reader finding both disabled should see the paragraph rather than fix it", "category": "nonFunctional-security"},
    {"q": "Demoting rather than removing Approve command leaves two paths to one outcome, free to drift — the script does seven steps, the skill could do something else.", "a": "The skill calls the script, as plot-dispatch/SKILL.md does. Approve command starts an agent, which runs the skill, which runs plot-approve.sh — one implementation of the mechanics, two entrances. Otherwise demotion reintroduces the duplication this plan removes, as a configuration option", "category": "technical-architecture"}
    {"q": "The plan describes seven steps and not one sentence about partial failure — and step 2 (pr-merge) writes irreversibly to GitHub. An interruption after it leaves the PR merged while the plan still reads Phase: Draft.", "a": "Idempotent. The skill already contains the answer the first draft did not carry across — 'Already merged: the approval already happened, skip to step 4' — so the repair for a half-finished approval is RUN IT AGAIN. Reordering to put the merge last would trade a recoverable half-state for a lying one: the plan would read Approved while its PR is still open", "category": "technical-implementation"},
    {"q": "If the script is idempotent, how does each step know it is already done? The seven steps write to very different places.", "a": "Each step asks the source it would have written: pr-state for the merge, plot-plan-meta.sh for the phase and record, the hold file, the sprint annotation. Never a progress file of its own — that is a second source of truth that disagrees with the repository exactly when someone intervened by hand between runs, which is the case it would exist for. Git and the files ARE the state", "category": "ux-errors"}
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
