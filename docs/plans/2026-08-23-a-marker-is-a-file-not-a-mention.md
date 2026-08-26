# A marker is a file, not a mention

> `plot_worker_blocked` greps every file's CONTENTS for `PLOT-BLOCKED:`, and twenty-eight tracked files on main contain that string because they document the feature — `CLAUDE.md` among them. Wherever no PR fact masks it, a clean worktree reads `waiting` and the board offers an operator a question lifted from a brief.

## Status

- **Phase:** Released
- **Type:** bug
- **Sprint:** the-board-tells-the-truth-in-every-section
- **Issue:** <!-- optional -->
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-23, Jan Wloka, in-session
- **Started:** 2026-08-23, Jan Wloka, `bug/a-marker-is-a-file-not-a-mention`
- **Delivered:** 2026-08-23
- **Released:** 2026-08-26, 2.9.0

## Approval

- **Assignee:** Jan Wloka

## Changelog

- A worker that finished cleanly is reported as finished, instead of as waiting for an answer nobody was asked for — the marker is now a file a worker writes, not a string any file may mention.

<!-- Board impact: the classifier every fleet component reads. Touches
     skills/plot/scripts/plot-worker-state.sh and its tests; the board consumes
     the result through the pulse and needs no change of its own beyond a
     rebuilt artifact. -->

## Motivation

Measured 2026-08-23, on a **pristine detached checkout of `origin/main` where no
worker has ever run**:

```
blocked?    YES
task_state: waiting
first match: .plot/briefs/a-waiting-agent-stays-working.md
```

`plot_worker_blocked` asks git to grep file **contents**:

```sh
git -C "$wt" grep -qIE --untracked --exclude-standard "$PLOT_BLOCKED_MARKER" \
  -- . ':(exclude).plot-worker.*'
```

`PLOT_BLOCKED_MARKER` is `PLOT-BLOCKED:|TODO\((you|human)\)`. **Twenty-eight
tracked files on `main` match it**, because Plot documents its own marker:

```
CLAUDE.md
.plot/briefs/{a-waiting-agent-stays-working,continue-with-an-answer,…}.md
docs/plans/2026-08-18-finished-is-not-a-verdict.md
packages/board/src/server/{continue,registry,worker-question}.ts
packages/board/test/unit/continue-route.test.ts
… 28 in total
```

Every worktree is a checkout of `main`, so **every worktree in this repo
contains the marker before any worker starts.**

### Where it bites, measured — and where it does not

An earlier draft said `waiting` was *unconditional here*. Measured against the
live board, that is too strong, and the correction is the useful part:

| caller | PR fact passed | result |
|---|---|---|
| `plot-fleet-scan.sh` (branch rows) | `pr` where a PR exists | `finished` ×20, `waiting` ×1 |
| `registry.ts` (agent rows) | `''`, always | `waiting` ×9 of 9 |

**An open or merged PR outranks the marker** — it is the first test in
`plot_worker_task_state`, and it is why the scan mostly escapes. Verified on one
branch directly:

```
plot_worker_task_state <wt> ""    → waiting
plot_worker_task_state <wt> "pr"  → finished
```

The registry passes an empty PR fact **by design**: its docstring records that it
*"must not be behind anything that can fail"*, so it cannot afford the host call.
That decision is right and is not what this plan changes. The consequence is that
the registry falls through to the marker grep every time, and every one of its
nine worktree-bearing entries reads `waiting`.

So the honest claim: **the false positive is masked wherever a PR fact is
available, and bites wherever it is not.** The registry is the population with no
PR fact, by construction — which is also the population WORKING is about to
render.

### The docstring states the property that fails

The constant's own comment argues for the token on exactly this ground:

> So Plot DEFINES `PLOT-BLOCKED:` — a token no other tool emits, **greppable
> without false positives**, and documented in the skills that tell workers to
> write it.

Both halves are true and they contradict each other. No *other tool* emits it —
but Plot's own documentation does, necessarily, because a marker that must be
documented will appear in the documentation. **A token cannot be both the thing
you search for and the thing you write about, when the search is over
everything.**

### It has never worked

`git log -S` puts the classifier and its own false positive in the **same
commit**: `a4ecf363` (2026-08-18, *"A worker that stopped is not a worker that
finished (wave 2)"*) both introduced `PLOT_BLOCKED_MARKER` and added the marker's
documentation to `CLAUDE.md`. There is no regression window to find; the state
has been unconditional since it shipped.

### What this costs

`waiting` outranks `stalled` and is checked before dirtiness, deliberately — the
comment records a guard that *"restarted one branch TWICE while its worker waited
on an answer"*. That ordering is right. The consequence of the false positive is
that the two states below it are now **unreachable** for any repo that documents
the marker:

- a worker that finished cleanly → `waiting`, not `finished`
- a worker that stalled with work on the floor → `waiting`, not `stalled`

So the board cannot currently distinguish *needs an answer* from *is done* from
*stranded uncommitted work*. Measured on the live board today: `waiting: 7`,
against **zero** worktrees holding an actual `PLOT-BLOCKED.md`.

**A stalled worker reported as waiting is the more expensive direction.**
`stalled` means work is on the floor and nobody can see it; presenting that as
*someone owes this branch an answer* sends an operator to write a reply instead
of to rescue the commits.

## Design

### The fix: a marker is a file

A blocked worker is instructed — by the `Worker command` in `CLAUDE.md`, and by
the skills — to **write a file**. So look for the file:

```sh
plot_worker_blocked() {
  local wt="$1" f
  [ -n "$wt" ] && [ -d "$wt" ] || return 1
  for f in "$wt"/PLOT-BLOCKED*; do
    [ -e "$f" ] && return 0
  done
  return 1
}
```

**Not `ls "$wt"/PLOT-BLOCKED* >/dev/null 2>&1`.** An unmatched glob is
shell-dependent: bash passes the literal pattern through and `ls` exits
non-zero (right answer, by luck), while zsh errors on the no-match before `ls`
runs. A `for` loop with an `-e` test answers identically under both, and this
file is sourced by callers whose shell it does not choose. Verified 2026-08-23
against all three cases below.

A filename cannot be mentioned into existence by prose. `CLAUDE.md` can describe
`PLOT-BLOCKED.md` all it likes without becoming one.

**Match the name, not the extension.** Workers have been observed writing
`PLOT-BLOCKED.md` and the instruction says *"write PLOT-BLOCKED: followed by the
question into a file"* — which does not name the file at all. A prefix match on
`PLOT-BLOCKED*` accepts what workers actually produce; the instruction should be
tightened in the same change to name the file, so the two agree going forward.

### The second copy, which fabricates a question

`worker-question.ts` declares **its own copy** of the pattern (line 28) and
re-greps the worktree (line 131) to answer *what is it waiting on*. Its
docstring names the duplication as deliberate:

> A SECOND COPY OF A PATTERN, and that is the honest cost of this change rather
> than an oversight.

The cost is larger than a maintenance burden. Grepping a pristine worktree
returns:

```
*worker waiting on you: PLOT-BLOCKED: which adapter should the fallback use?*
```

That is a **documentation example**, lifted from a brief. The board does not
merely mislabel the row — it presents an operator with a fabricated question and
a control to answer it. Answering it writes a prompt into a worktree whose worker
never asked anything.

**Both are fixed here, in one branch.** `worker-question.ts` reads the marker
file the classifier found, rather than re-deriving where the marker is:

- `markerIn` replaces its `git grep` subprocess with a read of `PLOT-BLOCKED*`.
- `firstMarkerLine` is **unchanged**. It already takes text and is already
  exported for direct testing; a file's contents suit it exactly as grep output
  did, including the leading-comment stripping.
- The pattern constant is **deleted from both files**. Nothing is left to keep
  in sync, which is the duplication its own docstring asked to be rid of.

Fixing only the classifier would leave the pair inconsistent — a row labelled
`finished` that still offers a fabricated question — which is worse than today's
consistent wrongness.

### What is lost, and why it is acceptable

Contents-matching accepts a marker in **any** file — a worker that wrote its
question into `NOTES.md` would be found today and would not be after this
change. That is a real reduction, and it is the point: the current behaviour
finds every such file, including the twenty-eight that are not questions.

The instruction is explicit about writing a file, the fleet has never been
observed relying on the looser form, and a marker convention that only works
when nobody documents it is not a convention. **A rule an agent must follow to
be seen is better than a search that sees everything.**

`TODO\((you|human)\)` should be **dropped**, not ported. It was kept as an
emergent spelling *"because it exists in trees right now"* — but it is a code
comment convention, and matching it over file contents is the same defect with a
smaller blast radius. If a worker needs to signal from inside a file, it should
write the marker file too.

### Not chosen: exclude the documenting paths

Add `':(exclude)docs/**'`, `':(exclude).plot/briefs/**'`, `':(exclude)CLAUDE.md'`
and so on. Rejected: it is a denylist that must grow every time anyone writes
about the feature, it would not have covered
`packages/board/src/server/continue.ts`, and it leaves the property — *a mention
is a marker* — intact. The exclusion list would itself be documentation of the
marker, in a file that must then be excluded.

### Not chosen: a rarer token

Replace `PLOT-BLOCKED:` with something no document would spell. Rejected for the
same structural reason: whatever token is chosen must be documented for workers
to write it, and the documentation lands in the tree the search walks. Rarity
delays the collision; it does not remove it.

### Open Questions

- [x] ~~Does the *Continue with an answer* path re-grep?~~ **Answered in round
      2: it does**, with its own copy of the pattern, and it surfaces a
      documentation example as a worker's question. Both are fixed in this
      branch — see *The second copy* above.
- [ ] Should a marker file be required at the worktree ROOT, or found at any
      depth? Root is stricter and is where every observed marker sits; any-depth
      would catch a worker that wrote into a subdirectory. Prefer root, but
      decide it rather than inheriting `ls`'s answer by accident.

## Done when

- A **pristine checkout of `main`** with no worker artefacts reads `finished`,
  not `waiting`. This is the defect; assert it directly, because every other
  assertion here passes with the bug in place.
- A worktree containing a real `PLOT-BLOCKED.md` reads `waiting`. The test must
  assert the marker is **FOUND**, not merely that a clean tree is not `waiting` —
  the existing docstring records two separate ways this grep has failed silently
  in the reassuring direction, and a test that only checks the negative case
  passes for a function that always returns false.
- A worktree with **uncommitted work and no marker** reads `stalled`, and one
  with an open PR reads `finished`. Both states are currently unreachable in this
  repo; asserting them proves the ordering below `waiting` still works.
- A file merely **containing** the string `PLOT-BLOCKED:` — a doc, a brief, a
  test fixture — does **not** make the worktree `waiting`. Assert with a fixture
  file, since this is the exact regression to prevent.
- **A pristine worktree yields no question text.** Asserted against
  `worker-question.ts` directly — this is the fabricated-question defect, and a
  fix to the classifier alone passes every assertion above while leaving it.
- A worktree with a real marker file **does** yield its first line, with leading
  comment syntax stripped. `firstMarkerLine`'s existing tests must pass
  unmodified: it is unchanged, and editing them would mean the fix reached
  further than intended.
- **Neither file declares the marker pattern any more.** Assert by grep: the
  duplicated constant is gone from both, so there is nothing left to drift.
- The `Worker command` in `CLAUDE.md` names the file it wants written, so the
  instruction and the classifier agree.
- `pnpm test`, `pnpm run test:board` green; artifact rebuilt and committed.

## Waves


<!-- ONE wave, one branch: a predicate, its tests, and the one instruction that
     must agree with it. Splitting the instruction from the classifier would
     leave a window where workers are told one thing and measured by another. -->

### Named (Branch: bug/a-marker-is-a-file-not-a-mention, PR: #342)
- `plot_worker_blocked` looks for a `PLOT-BLOCKED*` file rather than grepping every file's contents, and `worker-question.ts` reads that file instead of re-grepping with its own copy of the pattern; `TODO(you|human)` is dropped, the shared constant is deleted from both, and the `Worker command` names the file it asks for

## Notes

Found 2026-08-23 while interrogating `the-registry-names-a-live-agent`. That plan
unskips nine registry entries, and the expectation was that they would surface a
mix of `finished`/`waiting`/`stalled`. All nine read `waiting`; none held a
marker file. Checking why produced this.

The two plans are independent, and round 2 showed exactly how they meet: the
registry passes an empty PR fact by design, which is precisely the condition
under which this bug is unmasked. So the registry fix increases this bug's
audience — it unskips nine entries into a classifier that will mislabel them —
which is the argument for landing this one first. `the-registry-names-a-live-agent` deliberately asserts that its
nine entries are **classified** rather than that they read `waiting`, so that it
does not pin this bug in place.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 2,
  "questionHistory": [
    {"q": "Is the false positive real, or an artefact of untracked files in one worktree?", "a": "Real and universal: 28 tracked files on main match, CLAUDE.md included; a pristine detached checkout reads waiting", "category": "technical"},
    {"q": "Is this a regression, and when did it start?", "a": "Never worked — git log -S puts the classifier and CLAUDE.md's documentation of the marker in the same commit, a4ecf363", "category": "technical"},
    {"q": "Exclude the documenting paths instead?", "a": "Rejected — a denylist that grows with every mention, and it leaves the property (a mention is a marker) intact", "category": "tradeOffs"},
    {"q": "Is `waiting` really unconditional in this repo?", "a": "No - too strong. The PR fact outranks the marker, so the scan mostly reads finished; the registry passes an empty PR fact by design and so bites 9 of 9. Claim narrowed to: masked where a PR fact exists, bites where it does not", "category": "technical"},
    {"q": "Should the duplicated pattern in worker-question.ts be fixed here too?", "a": "Yes, one branch - it re-greps and surfaces a documentation example as a worker question; fixing only the classifier leaves a finished row still offering a fabricated question", "category": "ux"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": true},
    "domain": true,
    "ux": {"happyPath": true, "edgeCases": true, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": false, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
