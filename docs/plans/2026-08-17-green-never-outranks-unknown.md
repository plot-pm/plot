# A green check never outranks an unknown merge

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

### The row keeps its evidence

`unknown` already renders as *checks unavailable* and the contract
documents it as a real answer. What changes is only which rows reach it.

**The note is where the nuance goes.** A row that is unknown *because the
host cannot say whether it merges* is different from one unknown because
its checks are unreadable, and the note can carry that where a
six-value enum cannot. This costs nothing: the note already exists and
already differs per branch of `classify`.

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
  against the adapter's literal `checks:"unknown", mergeable:"unknown"` —
  today the defect is masked there only because both are hard-coded, and
  the masking must not be the thing that holds.
- **The note says which fact is missing**, so *cannot say whether it
  merges* is distinguishable from *cannot read the checks*.
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
