# A deleted ref is not an unstarted branch

## Status

- **Phase:** Approved
- **Type:** bug
- **Story:** plot-gates
- **Review:** pr
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:** 2026-08-16, jwloka, plan-PR #126 merged
- **Started:**
- **Delivered:**
- **Started:** 2026-08-16, Jan Wloka, `bug/fleet-merged-branch-state`

## Problem

`plot-fleet-scan.sh` opens `branch_state()` with a single question:

```sh
if ! git show-ref -q --verify "refs/remotes/origin/$br"; then
  echo "open"; return
fi
```

Absence carries two meanings and the script silently picks one. A branch that
never existed and a branch that was merged and then deleted are the same
missing ref — and both are reported as `open`, which the wave arithmetic reads
as *outstanding*.

Observed 2026-08-16, immediately after #125 merged:

```
== 2026-08-15-reconcile-scan-accuracy.md ==
  Section 2 — complete
      bug/scan-single-pr-plans — merged
  Section 3 — eligible
      bug/scan-contained-in-pr — open        ← merged as #125, ref deleted
  Coverage — blocked                          ← blocked BY the line above
      feature/update-board-test — open
```

Wave 3 cannot be dispatched because wave 2 — finished, merged, delivered-ready
— reads as unstarted.

### Why this stopped being cosmetic

It was recorded twice as cosmetic, on the reasoning that *the wave gate is
advisory, not enforced*. That reasoning was sound when written and is now
false: #124 gave the gate an automated reader. With both of `board-reads-git`'s
PRs merged and both refs deleted:

```
$ plot-fleet-scan.sh --next
bug/board-claimed-from-git
```

`--next` names **finished work as the next thing to start**, and that is
precisely the question `plot-dispatch.sh` asks before fanning out.

That is not an inference. `--dry-run` writes nothing, so the consequence can be
observed directly — and it is worse than one branch:

```
$ plot-dispatch.sh --dry-run board-reads-git
would dispatch bug/board-claimed-from-git → …/plot-wt-bug-board-claimed-from-git
would dispatch bug/dispatch-records-started → …/plot-wt-bug-dispatch-records-started
summary: dispatched=2 reused=0 skipped=0 started=0
```

**The entire completed plan would be re-dispatched** — both branches, both PRs
merged hours earlier, both refs deleted.

And nothing downstream stops it. `plot-dispatch.sh` carries a loop guard
(`exhausted`), but it has exactly two triggers — a claim rejected by another
session, and a worktree that cannot be created. Both are *contention*
conditions. Here neither fires: the refs are gone, so each claim push
**succeeds**, creating the branch fresh from the default branch, recreating the
deleted ref, and handing an agent a worktree whose diff is already on `main`.
The wrong answer manufactures the evidence that justifies it, and the guard
that looks like it would catch this was built for a different problem.

It also explains the ref that had to be restored by hand earlier that day to
unblock a wave. That was the symptom; this `if` is the cause.

Not the finding that changed — its surroundings did. Worth re-reading every
open point after a merge that grants a component more autonomy.

## Design

### The constraint that shapes the fix

The obvious repair is the one `plot-reconcile-scan.sh` already uses: ask the
host for merged PRs and match their heads against the plan's branches
(`reconcile-scan-accuracy`, "the signal that survives a deleted branch").

**That answer does not transfer here**, and the reason is cost, not
correctness. `plot-fleet-scan.sh` is git-only on its default path — `pr_ready`
is reached solely under `--loose` — and that is exactly why the board can poll
it every 5 s. Adding a `--state merged` call to the default path inverts the
script's cost property from *free, callable at any rate* to *metered*.
Measured on this repo the same day: one board costs 80 GraphQL calls/hour, and
seven accumulated boards cost 560/h — enough to exhaust a 5000/hour budget
across a working day with no human call involved. A metered fleet scan on a
5-second timer would dwarf that.

### The local signal

Nothing local survives the ref itself. Checked before designing around it:
after `bug/scan-contained-in-pr` was deleted, `git reflog show
origin/bug/scan-contained-in-pr` fails outright and `for-each-ref` finds **0**
matching refs. There is no cached tip, no packed remnant to consult.

What does survive is the merge commit on the default branch. Verified against
this repo:

```
bug/scan-contained-in-pr           merge-commit:37e9ed4
bug/board-claimed-from-git         merge-commit:3b04a1e
bug/dispatch-records-started       merge-commit:d0f9d38
feature/push-main-bypass           merge-commit:d4b98af
feature/update-board-test          merge-commit:none      ← never merged
```

Four merged branches found, the one unmerged branch correctly absent, no API
call. So `branch_state()` gains one question before it answers `open`: *did
this branch land on the default branch?* A hit returns `merged`, which is
already the state that settles a wave — the arithmetic does not change and no
new state is introduced.

### The anchored subject is the whole mechanism

The obvious implementation is a `git log --grep` for the branch name, and it is
wrong in the dangerous direction. Of this repo's 119 merges reachable from
`main`, eleven are *backward* merges:

```
Merge remote-tracking branch 'origin/main' into bug/scan-single-pr-plans
```

That subject **also names a branch**, with the opposite meaning: main was
pulled *into* the branch, not the branch onto main. These are genuinely
reachable — confirmed, not assumed: `35fb8a5` is an ancestor of `origin/main`,
so any scan of `origin/main --merges` walks straight over it. A name-only grep
would read all eleven as merge evidence and report **unfinished branches as
merged**.

That inversion is worse than the bug being fixed. Today the scan calls finished
work outstanding, which is irritating; inverted, it calls outstanding work
finished and **opens the next wave on an unlanded seam** — the exact failure
`--loose` was hardened against ("readiness must be verified, never assumed").

The defence is the *shape* of the subject, anchored end to end:

    ^Merge pull request #[0-9]+ from [^/]+/<branch>$

A backward merge is a different sentence — it opens `Merge remote-tracking
branch`, so it cannot match however its branch is named. Measured on this
repo: **0 of the 11 backward merges match the anchored pattern.**

So the candidate set is simply what is reachable from the default branch:

    git log "origin/$MAIN" --merges --pretty=%s
      | grep -E "^Merge pull request #[0-9]+ from [^/]+/<branch>$"

### Two structural filters were considered and tested away

Both are recorded because each looked convincing and neither survived contact
with a fixture.

**Second parent as a counter-check.** The idea was to accept a subject match
only if `^2` is a branch tip not already on the first parent's side. Tested on
real commits: PR merges and backward merges are *identical* under it — both
have a distinct second-parent tip. It would have passed on all eleven traps and
discriminates nothing.

**First-parent chain as the candidate filter.** This one measured well and was
adopted in round 1 on the strength of `119 merges → 109 on the chain, all 11
backward merges gone`. The number was real; the comparison was not. It measured
the filter against *raw merges*, when the mechanism it must improve on is the
**anchored pattern**. Against that baseline:

```
reachable + anchored    : 108
first-parent + anchored : 108      ← identical
```

**The filter eliminates zero additional traps.** And it is not free: it breaks
GitFlow. A feature merged into `develop`, where `develop` later merges into
`main`, does not sit on `main`'s first-parent chain. Built as a fixture and
run:

```
feature/alpha work is an ancestor of main : YES
first-parent from main → hits             : 0   → open   ← wrong
reachable  from main → hits               : 1   → merged ← correct
```

A restriction whose measurable benefit is nil and whose cost is a false `open`
for every GitFlow feature. Dropped.

The general trap is worth naming, because it is easy to repeat: a new mechanism
was compared against *no mechanism* rather than against the one it was meant to
improve. That flatters any addition.

**Reachability does not over-report either**, which is the obvious worry once
the filter is gone. A PR merged into a long-lived branch that was then
abandoned is not reachable from the default branch at all — fixture-tested: 0
hits for a sub-branch merged into a `feature/big` that never landed.
Reachability is itself an ancestry claim, so it cannot see work that never
arrived.

### Read the history once per run, not once per branch

`branch_state()` is called per branch — 14 per run on this repo today — and the
board polls the scan every 5 s. The naive shape runs `git log` inside that
loop, re-walking the whole history for every branch: O(history × branches)
where O(history + branches) is available.

Invisible at this repo's size, decisive at the size Plot is meant to reach.
Measured on a purpose-built 2000-merge / 4001-commit fixture, 14 branches:

```
                     496 commits      4001 commits
one call per branch    81 ms             197 ms
one call per run       58 ms              79 ms
```

So the subjects are read once and matched in-shell:

```sh
subjects=$(git log "origin/$MAIN" --merges --max-count="$MERGE_SCAN_LIMIT" --pretty=%s)
# per branch:
printf '%s\n' "$subjects" | grep -qE "^Merge pull request #[0-9]+ from [^/]+/$br$"
```

This is the bundling rule `plot-reconcile-scan.sh` already applies to PR lists
("ONE call for all plans, so cost is constant in plan count") — same argument,
local data.

**The cap must report saturation, or it re-creates this very bug.** A blind cap
was tested and it fails exactly where it hurts: with `--max-count=300` against
2000 merges, a branch merged early is **not found** and reads `open` — the
defect this plan exists to remove, reintroduced for precisely the long-hanging
plans most likely to suffer it.

`plot-reconcile-scan.sh` already resolved this tension for its merged-PR list,
and its comment reads as if written for this decision: *"Too low silently
misses old plans, which is precisely this check's own failure mode."* Its
answer is neither "cap" nor "no cap" but **cap generously and report
saturation** (`MERGED_PR_LIMIT=500` with `MERGED_PR_TRUNCATED` printing a
note). The same shape applies here, with one asymmetry: that list pays a
network round trip per page, so its cap buys real time, while this walk is
local and nearly free. Measured on the 2000-merge fixture:

```
cap 500  :  7.7 ms
cap 2000 : 12.3 ms
no cap   : 11.8 ms
```

The cap saves ~4 ms across an entire history — inside the noise. It therefore
exists as a guard against a pathological history, not as an optimisation, and
should be set high (`MERGE_SCAN_LIMIT=2000`, an order of magnitude above this
repo's 119). When the walk comes back full, say so:

    note: merge scan hit its limit of <n> — older merges were not examined;
          a branch merged before that point may still read as open.

A silent cap would make the scan lie in the one direction this plan was written
to stop.

### Which branch counts as "landed"

`MAIN` is already resolved as `Main branch` config → `origin/HEAD` →
`"main"`, so the script is not pinned to a branch named `main`. Detection uses
**that one configured default branch** and no other.

A GitFlow repo sets `Main branch: develop`, because that is where feature PRs
land and therefore where wave progress is decided. Release merges from
`develop` into a production `main` are a different question — the Released
phase, not wave progress — and deliberately out of scope here. One script, one
notion of *landed*; a second branch concept would have to be threaded through
the wave arithmetic, which currently knows exactly one.

### The merge subject a human rewrote

Of the 108 conforming merges, one nearby commit does not conform:

```
41045d1 Merge PR #44: @plot-pm/board release pipeline — OIDC trusted publishing…
```

A real PR merge carrying **no branch name**. No amount of anchoring recovers
it, and that is the honest bound: a merge whose author rewrote the subject is
invisible to detection. Nor can it be recovered structurally — matching by
commit identity needs the branch's tip SHA, which is exactly what a deleted ref
no longer provides. It is one commit, on a delivered plan, so it costs nothing
here — but it is why the plan does not claim detection is complete.

### What happens when the signal is absent

The pattern depends on a commit-message convention. Squash and rebase merges
leave no such commit; hand-written subjects like the one above defeat it; a
branch genuinely never started has nothing to find either.

**All of them keep today's answer, `open`.** This is a strict improvement,
never a regression: the fix can only move a branch from `open` to `merged`, and
only on positive evidence. It must not guess in the other direction, and it
must not invent a third state the wave arithmetic would have to learn.

But `open` must stop being silent about *why*. Today the same word means "never
started" and "I could not tell" — the very ambiguity this plan exists to
remove, reappearing one level up. The summary footer therefore names the
detection source, in the shape `plot-reconcile-scan.sh` already uses for
`pr_source=gh|bb|degraded`:

    summary: … merge_detect=pr-merge|truncated|none …

`truncated` is its own value rather than folded into `pr-merge`: a capped walk
did detect, but not exhaustively, and a reader deciding whether to trust an
`open` needs those apart.

`none` when the default branch carries no conforming merge commits at all —
the squash/rebase repo — so a reader can tell "nothing was merged" from
"this repo does not leave the evidence I look for". Following
`bug/scan-contained-in-pr`: where evidence is unavailable, skip rather than
guess, and say that you skipped.

### Ordering: the ref check must stay in front

A branch name can be reused. Merge `bug/flaky`, delete it, then create
`bug/flaky` again for a second attempt — a normal thing to do when work is
reopened — and the merge subject from the *first* attempt is still on the
default branch. That evidence is now stale: it describes work that landed,
while the branch of the same name carries new work that has not.

Fixture-tested, and the answer is reassuring but fragile:

```
ref exists?         yes
work on main?       NO — in flight
merge-subject hits: 1     ← stale evidence from attempt 1
```

Today this is **correct by placement**. The merge lookup belongs in the no-ref
arm, and a recreated branch has a ref, so it never reaches the lookup — it
takes the existing ancestry path and reports `wip`. Nothing new is required.

But nothing states the dependency either, and a refactor that hoists the merge
check to the top of `branch_state()` — a natural tidying move, since it reads
like a cheap early answer — would silently report in-flight work as `merged`
and open the next wave on it. So the ordering is pinned by a test rather than
left to survive on placement.

This is the same ordering hazard `bug/scan-contained-in-pr` documented one
script over ("Claim first, containment second. Do not reorder these"), and it
earns the same treatment: state the constraint, and let a test hold it.

### Plan annotations are not consulted

Plans carry `→ #<n>` annotations, and using them would be cheaper still. The
plan does **not**, for the reason `reconcile-scan-accuracy` already established:
"the missing annotation and the missing delivery have the same cause", so a fix
depending on annotations misses exactly the sloppy plans that hang.

Confirmed live rather than quoted: `board-reads-git` has **both** its branches
merged (#123, #124) and **neither** carries a `→ #<n>` annotation. The very
plan whose stuck wave motivated this work would have been missed by an
annotation-based fix. Detection reads git and nothing else, which also keeps
the scan stateless — re-derived from refs and history on every run.

## Branches

- `bug/fleet-merged-branch-state` — `branch_state()` recognises a
  merged-and-deleted branch from an anchored PR-merge subject reachable from
  the configured default branch; `merge_detect` in the footer; absence keeps
  `open`; tests in `test/reconcile/fleet.test.mjs` → #129

**One branch, deliberately.** An earlier cut split this into Detection and
Coverage waves. That was wrong twice over: the change is one function in one
file, so there is nothing to fan out, and the split created a sequential
dependency with no parallelism to show for it — the same shape currently
blocking `reconcile-scan-accuracy`. The last three bug branches (#122, #125)
each shipped implementation and ~200 lines of tests together, so a separate
test wave would formalise a step that does not happen in practice.

#### What the board does with the new answer — and why it needs no change

The board consumes branch states through `classify()` in
`packages/board/src/server/fleet.ts`. Read rather than assumed, because "no
change needed" is the kind of claim that is wrong quietly.

**The state change lands in an arm that already handles it.** A merged branch
returns `{ group: 'done', note: 'merged' }`, or `'merged — wave still open'`
when the wave has other outstanding branches. Today the same branch takes the
`'open'` arm and renders *"eligible — nobody has taken it"* — an invitation to
start finished work, the board-facing half of the dispatch problem above.

Two properties make this work without touching the package, and both are
accidental enough to be worth writing down:

**1. The `merged` arm never reads `ageMinutes`.** That matters here more than
anywhere else: branch ages come from `git for-each-ref refs/remotes/origin`, so
a deleted branch has no entry and its age is `null`. Every other arm has a
`null`-age fallback for exactly that reason; `merged` needs none because it
does not ask.

**2. The PR arm is guarded against both states.** Before the state arms,
`classify()` lets a PR outrank git:

```ts
if (pr && state !== 'merged' && state !== 'open') { … }
```

Today a deleted branch escapes that arm via the `'open'` exclusion; after the
fix it escapes via `'merged'`. **Both exclusions already exist**, so the change
moves a branch from one excluded value to another and the PR arm never sees it
either way.

That is a fortunate alignment, not a designed one — and it means this fix's
correctness partly rests on a condition in a *different package*, written for a
different reason, invisible from `plot-fleet-scan.sh`. A board test pins it, so
the coupling is enforced rather than merely noted.

#### Dispatch is deliberately not hardened

The obvious belt-and-braces addition — have `plot-dispatch.sh` check whether
the work already landed before claiming — is **not** in scope, and the reason
is not cost.

A correct pulse removes the condition entirely: `merged` is not `eligible`, so
the branch never reaches the dispatch list. A second check would be redundancy
against a bug that no longer exists, in a code path that would then never
execute — and a guard nothing exercises is a guard that rots. The `exhausted`
mechanism above is the cautionary example: it looks like it protects this case
and does not, because it was written for contention.

Fix the answer, not every consumer of the wrong answer. If a later failure
shows the pulse can be wrong in some *other* way, that argues for defence in
depth on its own evidence — not on this one.

## Done when

- A branch whose PR merged and whose ref was deleted reports `merged`, and its
  wave reports `complete`. Demonstrate against this repo's real state
  (`reconcile-scan-accuracy` wave 2 → complete, wave 3 → eligible), not against
  a reading of the code.
- `--next` no longer names finished work. This is the assertion that matters
  most: it is the interface `plot-dispatch.sh` acts on.
- **A backward merge (`Merge remote-tracking branch 'origin/main' into X`) is
  not accepted as evidence that X merged.** Pin with a test that builds the
  real shape — a branch that merged main into itself and was *never* merged
  back — and assert it still reads `open`. This is the inversion described
  above and it fails silently; it is the single most important assertion here.
- **A GitFlow feature is detected.** Build the two-level shape — feature merged
  into `develop`, `develop` later merged into the default branch — and assert
  the feature reads `merged`. This is the case that killed the first-parent
  filter; without a test it will be reintroduced by the next person who reads
  "119 → 109" and finds it persuasive.
- **A PR merged into a branch that was then abandoned does not read as
  merged.** The mirror of the case above: a conforming merge subject that is
  *not* reachable from the default branch must not count. This is what makes
  reachability safe, and it is the assertion that fails if someone later
  broadens the search to `--all`.
- **The default branch is honoured, not assumed.** Run the suite against a
  fixture whose default branch is `develop` (no branch named `main` present at
  all) and assert detection works. `MAIN` resolution already exists; this pins
  that detection uses it rather than a hardcoded `main`.
- **A reused branch name does not inherit the old merge's verdict.** Merge a
  branch, delete it, recreate it with new unmerged work, and assert it reads
  `wip` — not `merged`. Correct today only because the ref check precedes the
  merge lookup; the test is what keeps a refactor from quietly inverting it.
- **The history is read once per run, not once per branch.** Count the `git
  log` invocations (the suite already logs argv for the PR-call assertion in
  `scan.test.mjs`) and assert the merge walk happens once regardless of branch
  count. Without this, the O(history × branches) shape returns unnoticed —
  it is invisible in a small fixture, which is exactly why a fixture cannot
  catch it by timing.
- **A saturated walk is reported, never silent.** With `MERGE_SCAN_LIMIT`
  forced low against a history that exceeds it, assert the note appears. This
  is the assertion that stops the cap from re-creating the bug: a branch beyond
  the limit reads `open`, which is acceptable only while the scan says it
  stopped looking.
- **`plot-dispatch.sh --dry-run` on a fully merged plan dispatches nothing.**
  The end-to-end proof, and the one that speaks in the consumer's terms:
  `dispatched=0` where it reports `dispatched=2` today. Run it against
  `board-reads-git`, whose branches are merged and deleted.
- **The board renders a merged-and-deleted branch as `done`.** A `@plot-pm/board`
  test calling `classify('merged', verdict, null, …)` — state `merged` with a
  `null` age, which is what a deleted ref produces — asserting group `done`.
  This pins the cross-package coupling described above; without it, the fix's
  correctness depends on an exclusion in `classify()` that nothing connects to
  this plan.
- A branch with no merge commit still reports `open` — no third state, no
  guessing — and `merge_detect=none` appears in the footer when the default
  branch offers no conforming merges at all.
- **Plan `→ #<n>` annotations are not read.** Assert against a plan whose
  branches merged with no annotation present (the `board-reads-git` shape);
  detection must still succeed.
- The default path makes **no host calls**. Pin this too: the whole design
  rests on it, and a future edit could reintroduce one without any test
  noticing.
- `pnpm run test:reconcile` and `pnpm run validate` pass.
- A changeset is present.
- macOS ships bash 3.2: no `declare -A`, no bash-4-only constructs.
- Assert per line, not with whole-output regexes — this suite has been fooled
  three times by patterns matching across report lines or the summary footer.

## Notes

Structurally the same defect `bug/scan-contained-in-pr` fixed one `else` over
in `plot-reconcile-scan.sh`, where *"not the head of an open PR"* meant
**orphan**. Two scripts, one blind spot, one of them now repaired. Both cases:
a branch falls through to a catch-all arm that serves several causes and
answers the common one wrongly.

The board consumes this through the fleet pulse, so the fix also removes the
condition where a card can spring back to *eligible* after its work merged.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 4,
  "questionHistory": [
    {"q": "How robust must the merge signal be, given no local ref trace survives?", "a": "Text plus structural counter-check — proposed second-parent check tested and found non-discriminating; replaced by first-parent filter in round 1, which round 2 then removed as well", "category": "technical-architecture"},
    {"q": "Should the fix consult plan → #N annotations?", "a": "No — git only; board-reads-git proved live that merged branches carry no annotation", "category": "technical-architecture"},
    {"q": "Is silently keeping `open` acceptable when no evidence exists?", "a": "Keep `open` but report the degradation via merge_detect in the footer", "category": "nonfunctional-observability"},
    {"q": "Keep Detection/Coverage as separate waves?", "a": "Collapse to one branch — no parallelism gained, and the last three bug branches shipped tests with the code", "category": "tradeoffs-decomposition"},
    {"q": "What if the repo is on develop or next rather than main?", "a": "Overturned round 1: first-parent adds 0 traps caught over the anchored pattern (108 = 108) and breaks GitFlow (feature via develop reads open). Reachability + anchored subject instead; abandoned-stack case fixture-tested as safe", "category": "technical-architecture"},
    {"q": "Which branch counts as landed when a repo has both develop and main?", "a": "The one configured default branch (Main branch → origin/HEAD → main). GitFlow sets Main branch: develop; release merges to production main are the Released phase, out of scope", "category": "domain-workflows"},
    {"q": "One git log per branch, or one per run, given the board polls every 5s?", "a": "Bundle and cap. Measured 197ms vs 79ms at 2000 merges; cap set high (2000) and saturation REPORTED, since a blind 300-cap was tested and silently missed an early merge — recreating this plan's own bug", "category": "nonfunctional-performance"},
    {"q": "A merged-then-deleted branch name reused for new work carries stale merge evidence — how to handle?", "a": "Correct today by placement (ref check precedes merge lookup); pin the ordering with a test so a refactor cannot invert it silently", "category": "technical-implementation"},
    {"q": "Should plot-dispatch.sh also be hardened, given --dry-run shows dispatched=2 on a fully merged plan?", "a": "No — a correct pulse removes the condition entirely; a guard nothing exercises rots, and the existing `exhausted` guard is the cautionary example (built for contention, looks like it covers this, does not). Fix the answer, not every consumer of the wrong answer", "category": "tradeoffs-scope"},
    {"q": "The board needs no change — but only because classify() already excludes both 'open' and 'merged' from its PR arm, and the merged arm never reads ageMinutes. How to record that?", "a": "Document the cross-package coupling in the plan and pin it with a board test: classify('merged', verdict, null) → group 'done'", "category": "technical-architecture"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": false},
    "domain": false,
    "ux": {"happyPath": false, "edgeCases": false, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": true, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
