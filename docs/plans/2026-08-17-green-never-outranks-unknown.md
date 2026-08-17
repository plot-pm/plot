# A green check never outranks an unknown merge

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:** 2026-08-17, Jan Wloka, plan-PR #187 merged
- **Started:**
- **Delivered:**

## Problem

Reported live on 2026-08-17 from a screenshot of WAITING ON YOU:

```
⑂57 green   22d
```

Measured against the host at the same moment:

```
plot-host:  checks="green"   mergeable="conflicting"
gh:         mergeable=CONFLICTING   mergeStateStatus=DIRTY
```

The branch **cannot merge** and the row said **green**. A minute later
the same row read `conflicts`, correctly. So the defect is real,
intermittent, and — because it resolves itself — the kind nobody
reproduces on demand.

### The fold is right; its input is not

`prState` gets the precedence exactly right, and its comment argues it:

```ts
export function prState(pr: PrRecord) {
  if (pr.mergeable === 'conflicting') return 'conflicts';
  switch (pr.checks) {
    case 'green': return 'green';
    …
    default: return 'unknown';   // "must read as cannot say, never as the
  }                              //  reassuring end of the range"
}
```

Two facts, one value, and `conflicting` outranks everything. That holds.

**What it does not handle is `mergeable === 'unknown'`.** The condition
simply does not fire, and control falls through to `checks`, which was
`green`. So:

| `mergeable` | `checks` | Reported | Honest answer |
|---|---|---|---|
| `conflicting` | anything | `conflicts` | ✅ |
| `mergeable` | `green` | `green` | ✅ |
| **`unknown`** | **`green`** | **`green`** | ❌ *cannot say* |

The function already knows the rule it needs — *"a new word from a future
host must read as cannot say, never as the reassuring end of the range"*
— and applies it to `checks` while letting `mergeable` bypass it.

### Two ways `unknown` arrives, and neither is rare

**GitHub computes mergeability lazily.** `plot-host.sh` says so in its
own comment: *"a PR opened seconds ago legitimately reports UNKNOWN until
the background job finishes. A consumer must not read that as clean."*
On 2026-08-17 GitHub's GraphQL API returned **503** at least four times
in one afternoon; under that load `mergeable` comes back `UNKNOWN` while
`statusCheckRollup` — a plain stored field — still answers. That is
exactly the shape of the reported minute.

**Bitbucket reports `unknown` always.** Measured — the adapter emits a
literal:

```
checks:"unknown", mergeable:"unknown"
```

So on Bitbucket this is not an outage case at all. It is **every row, all
the time**, and today it would render as whatever `checks` said. That the
same adapter also hard-codes `checks:"unknown"` is the only reason the
defect has not shipped there: change one and the other exposes it.

### Why a stale green is worse than a stale anything

`green` is the one value a reader acts on without checking. `pending`
invites waiting, `failing` invites looking, `none` and `unknown` invite
asking — but `green` says *this is fine, move on*, and #57 wore it for
22 days while being unmergeable.

This is the same defect `agent-rows-line-up` fixed for `no checks` —
*"the board reports the symptom and withholds the cause"* — with the sign
reversed. There the withheld cause hid behind a neutral word; here it
hides behind a reassuring one.

## Design

### `unknown` in either input yields `unknown` in the output

One rule, applied to both facts rather than to one of them:

```ts
if (pr.mergeable === 'conflicting') return 'conflicts';
if (pr.mergeable === 'unknown') return 'unknown';
switch (pr.checks) { … }
```

**Absent is not a clearance**, which is this repo's most-applied rule and
the one `prState`'s own comment states. It has now been paid for in
`claimed`/`eligible`, in `index.lock`, in interrogation rounds, in the
change-marker's first pulse, in the artifact-conflict fence, and here.

**`conflicting` still outranks everything**, unchanged. The new line sits
below it, so a host that knows the branch conflicts still says so.

**It does not consult `checks` at all in the unknown case.** Reading
`checks` to break the tie is what produces the defect: those are answers
to *different questions*, and a green check says nothing about whether
the branch merges. Twenty-two days of green on a conflicting branch is
the proof.

### The change reaches four consumers, not one

**Measured, and the first draft undercounted it.** `prState` has four
callers, and two of them decide more than a colour:

| Caller | What it does with the value |
|---|---|
| the row's `pr.state` | the status cell and its word |
| `classify`'s note | *no checks* / *CI running* / *conflicts* |
| **`stuck.ts`** | `prState === 'conflicts'` → a stuck branch; `'failing'` → CI evidence |
| **the change-marker** | watches `pr?.state ?? null`, flashes on transitions |

So a fifth `unknown` is not a display tweak. Each consumer gets its own
assertion, and one of them **improves**: `stuck.ts` today sees `green`
where the host said nothing, so a branch that cannot merge is not
detected as stuck at all. The fix is what lets the watcher see it.

### A change to or from `unknown` does not flash

The change-marker (#180) flashes whenever `pr?.state` differs from the
previous pulse. With this fix, a GitHub 503 turns `green` into `unknown`
and the next pulse turns it back — **two flashes for nothing that
happened.** There were four such outages on 2026-08-17 alone.

So transitions **into or out of `unknown` are not changes** and do not
flash. `unknown` means *I cannot say right now*: that is a fact about the
observation, not about the world, and the marker reports changes in the
world. This is the marker's own rule — *absent is unknown, never a
value* — applied one level up: it already refuses to flash on a first
sighting for exactly this reason.

A real transition hidden behind an outage is the cost, and it is small:
the state is re-read every 60 s, so the next successful pulse shows the
new value. The marker misses the moment, not the fact.

### The row keeps its evidence

`unknown` already renders as *checks unavailable* and the contract
documents it as a real answer. What changes is only which rows reach it.

**The note is where the nuance goes, and it says WHICH fact is missing.**
Today `unknown` renders as *checks unavailable* — which is wrong whenever
it is `mergeable` that could not be read. Two sentences, because the two
are not equally actionable:

| Missing | Note | What a reader does |
|---|---|---|
| `mergeable` | *cannot say whether it merges* | check for a rebase |
| `checks` | *cannot read the checks* | nothing yet; look again |

One label for both would be the pattern this repo has spent the day
removing. The note already differs per branch of `classify`, so this
costs a string rather than a mechanism.

### Bitbucket cannot answer this, and the board must say so

**Measured, and it changes what "fix the adapter first" can mean.** The
Bitbucket adapter hard-codes `checks:"unknown", mergeable:"unknown"` —
not from neglect, but because the CLI has nothing to report. The script
says it plainly: *"Empty on bitbucket (bb has no run listing) —
unavailable, never 'never failed'."*

So teaching the adapter real values is not deferred work; it is **not
available**. `unknown` on every Bitbucket row is the permanently correct
answer, and this fix does not cause that — it stops the answer being
overwritten by whatever `checks` was hard-coded to.

What the fix must not do is let a Bitbucket reader mistake the result for
a broken board. **WAITING ON A MACHINE will be empty there, always**, and
an empty section with no explanation reads as *nothing is running* rather
than *this host cannot tell me*. So the section says which: where the
host reports `unknown` for every row, its empty state names the host's
limit instead of implying quiet.

That is the same rule the rest of this plan applies, one level up:
**absent is not a clearance**, and an empty section is a kind of absence.

### What this does not do

**No new field, no contract change.** Both facts already travel;
`prState` is a pure function over them and this is a change to its
precedence.

**No retry, no waiting for GitHub to settle.** A row that says *cannot
say* while the background job finishes is correct, and it will say
something else on the next pulse. Blocking a 60 s refresh on a lazy
mergeability computation would make every row late to spare one row a
minute of honesty.

**No change to the fleet scan.** This is entirely in the board's fold.

## Branches

### Precedence

- `bug/green-never-outranks-unknown` — `prState` returns `unknown` when
  `mergeable` is `unknown`, before consulting `checks`; the note says
  which fact is missing

## Done when

- **`mergeable: unknown` + `checks: green` reports `unknown`.** Assert
  the live shape from #57's reported minute — the exact pair that read
  `green` while the branch could not merge.
- **`mergeable: unknown` reports `unknown` for EVERY `checks` value.**
  Assert all six: an implementation special-casing only `green` passes
  the assertion above and leaves `pending`, `failing` and `none` claiming
  more than the host said.
- **`conflicting` still outranks everything.** Assert `conflicting` +
  `green` is still `conflicts` — the pairing that matters, since the
  cheap fix is to reorder the checks and lose the cause.
- **`mergeable: mergeable` + `checks: green` is still `green`.** The
  common case must not become `unknown`; a fix that reports `unknown`
  whenever `mergeable` is not `conflicting` passes every assertion above
  and makes the board useless.
- **A Bitbucket row reads `unknown`, not whatever `checks` says.** Assert
  against the adapter's literal `checks:"unknown", mergeable:"unknown"`.
  This is permanent rather than temporary: `bb` cannot report either
  fact, so the adapter is not "not yet improved" — it is at its limit, and
  `unknown` is the correct answer there forever.
- **The note says which fact is missing**, so *cannot say whether it
  merges* is distinguishable from *cannot read the checks*. Assert both
  sentences — today `unknown` renders as *checks unavailable* on a row
  whose checks were fine and whose mergeability was not.
- **`stuck.ts` detects a conflict it previously missed.** Assert a branch
  the host calls unmergeable while its checks read `green` is now seen —
  today `prState` hands the detector `green` and the branch is not stuck
  at all.
- **The change-marker does NOT flash on a transition into or out of
  `unknown`.** Assert `green → unknown → green` produces no marker: four
  GitHub outages on 2026-08-17 would otherwise have flashed every row
  twice for nothing that happened. The pairing that matters: a marker
  that treats every visible difference as a change passes every other
  assertion and turns each outage into a light show.
- **A real transition still flashes.** Assert `pending → failing` is
  unaffected — a fix that suppresses too much removes the signal the
  marker exists for.
- **Where the host reports `unknown` for every row, the empty
  WAITING ON A MACHINE section names the host's limit** rather than
  implying quiet. Assert the Bitbucket shape: `bb` has no run listing, so
  that section is permanently empty there, and an unexplained empty
  section reads as *nothing is running*.
- **No contract change and no new field.** Assert `prState` remains a
  pure function over the two facts it already receives.
- `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`,
  `pnpm run validate` all pass.
- `pnpm build:board` run in the implementing worktree and the artifact
  committed — CI gates on no-diff.
- A changeset is present, with its `bumps:` block.

## Notes

The reported symptom was transient — the row read `conflicts` correctly a
minute later — and that is the most dangerous property it has. A defect
that repairs itself is one nobody reports twice and nobody reproduces on
request, so it survives by being unbelievable. It was caught only because
a screenshot happened to land inside the window.

The measurement that makes it worth fixing rather than watching is
Bitbucket: there `mergeable` is `unknown` on **every** row, permanently.
The defect is invisible on that host today only because the same adapter
hard-codes `checks:"unknown"` as well — so the wrong answer and the
right one coincide by accident. Anyone teaching the Bitbucket adapter to
report real checks would ship this defect on every row of the board, and
would have no reason to suspect the fold.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {"q": "prState has FOUR callers including stuck.ts and the change-marker — what follows?", "a": "Take all four deliberately, one assertion each; stuck detection actually improves", "category": "technical"},
    {"q": "green -> unknown -> green on every 503 would flash the change-marker twice", "a": "Transitions into or out of unknown are not changes and do not flash", "category": "ux"},
    {"q": "Should the Bitbucket adapter be improved first?", "a": "It cannot be — bb has no run listing. Instead the empty section must name the host's limit", "category": "domain"},
    {"q": "unknown renders as 'checks unavailable' even when mergeable is what is missing", "a": "Two sentences, because only one of them is actionable", "category": "ux"}
  ],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": true},
    "domain": {"rules": true},
    "ux": {"happyPath": true, "edgeCases": true, "accessibility": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
