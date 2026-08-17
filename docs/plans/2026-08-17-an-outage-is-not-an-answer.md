# An outage is not an answer, and an empty set is not a small one

## Status

- **Phase:** Delivered
- **Type:** bug
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:** 2026-08-17, Jan Wloka, plan-PR #193 merged
- **Started:** 2026-08-17, Jan Wloka, `bug/an-empty-conflict-set-is-not-a-refusal`
- **Delivered:** 2026-08-17
## Problem

Three defects, found within an hour of each other on 2026-08-17, all one
shape: **a failure to observe reported as an observation.**

### 1. The resolver refuses the exact case it exists for

Reported live. A row read:

```
artifact conflict  conflicting: skills/plot/scripts/board/board-server.mjs
                   repair refused — not-artifact-only
```

The classification and the refusal contradict each other. Measured, the
classification is right:

```
$ git merge-tree --write-tree origin/feature/… origin/main
CONFLICT (content): Merge conflict in skills/plot/scripts/board/board-server.mjs
```

One file, and it is the artifact. The board's own row agrees —
`state: "artifact-conflict"`, `conflicts: ["skills/plot/scripts/board/board-server.mjs"]`.

The resolver's log says why it refused:

```
step: reusing worktree …/plot-wt-feature-working-rows-show-their-pace
step: conflict set is not exactly the artifact — refusing
step: unmerged:
```

**`unmerged:` is empty.** The resolver reads the conflict set from the
worktree's unmerged paths — and it *reused an existing worktree in which
no merge was running*, so there was nothing to read. It found zero paths,
compared zero against one, and concluded *not artifact-only*.

Formally correct; factually inverted. **Empty here does not mean "other
files", it means "I did not look."** The wave that built this was told
never to act on a host verdict without an observed conflict set — the
right rule, now firing in the wrong direction: it prevents a correct
repair instead of an incorrect one.

**And the worktree it reused belongs to a running agent.** Measured at
the same moment: zero unmerged paths, three modified files, an agent
working in it. The resolver reached into someone else's active worktree
to perform a merge.

It also retried in a loop — five identical entries in the log, one per
pulse, each reaching into the same worktree.

### 2. `plot-host.sh` exits 0 when it could not ask

Measured:

```
$ plot-host.sh pr-list --rich   # during a GitHub 503
HTTP 503: No server is currently available…
$ echo $?
0
```

The script documents `exit 0` deliberately — *"structured output, no
interpretation, exit 0 with state NONE rather than nonzero on lookup
misses."* That rule is right and this is not a lookup miss. *No PR found*
is an answer; *the host would not talk to me* is not.

Both leave `rc=0`, so no caller can tell them apart from the exit code.
The board compensates by noticing the empty result and saying *PR data
unavailable* — it guesses correctly, but it guesses.

This is the same defect `green-never-outranks-unknown` fixed one layer
up, at its source: **absent read as known.**

### 3. The error message truncates mid-path

`AgentList.tsx:3176`:

```tsx
PR data unavailable ({fleet.prError.slice(0, 80)}) — …
```

Eighty characters, and the path is longer:

```
Command failed: bash /Users/jwloka/Quatico/Agentic-Tools/plot/skills/plot/script
                                                                              ↑ cut
```

The reader is shown `…/skills/plot/script`, a file that does not exist.
Measured cost: one wrong lookup before finding `plot-host.sh`. A message
whose purpose is to point at a cause must not point at a fiction.

## Design

### The resolver observes, or refuses for that reason

**The refusal was right; its reason was wrong.** Distinguish them:

| Conflict set | Meaning | Resolver |
|---|---|---|
| exactly the artifact | the licensed case | repair |
| other files present | needs judgement | refuse, `not-artifact-only` |
| **empty, no merge run** | **nothing was observed** | **refuse, `not-observed`** |

An empty set is never `not-artifact-only`, because that name asserts
something about files nobody looked at.

**The resolver performs its own merge in its own worktree.** Reusing a
worktree is fine when it is idle and the resolver's own; reaching into
one where another agent has modified files is not. It must either create
a scratch worktree or refuse with `worktree-busy` — the second is
acceptable and the honest minimum.

**A refusal for `not-observed` does not retry every pulse.** Five
identical log entries in a row is a loop with no new information between
iterations. Retry when the input changes, not when the clock ticks.

### `plot-host.sh` separates "no" from "could not ask"

`exit 0` stays for lookup misses — a PR that does not exist is an answer
and the calling contract depends on it.

A **transport failure** — the host CLI erroring, a non-2xx response, an
empty body where JSON was expected — exits **non-zero** and prints
nothing on stdout. Callers that branch on state keep working unchanged;
callers that need to know whether they were answered can finally ask.

The board then stops inferring its `prError` from an empty result and
reads the exit code, which is the difference between knowing and
guessing.

### The message shows the end of the path, not the start

Truncate from the **left** when a path must be shortened — the tail
identifies the file, the head is boilerplate every message shares:

```
…/plot/skills/plot/scripts/plot-host.sh: HTTP 503
```

Better: keep the whole error and let it wrap. Eighty characters is a
guess about a terminal width the board does not have — it is a web page,
and the footer already wraps. **The cheapest correct fix is to remove the
`slice` entirely**, and the plan prefers it.

## Branches

### Observation

- `bug/an-empty-conflict-set-is-not-a-refusal` — the resolver
  distinguishes *nothing observed* from *other files*, works in a
  worktree that is its own or idle, and does not retry a `not-observed`
  refusal every pulse → #198

### Transport

- `bug/plot-host-exits-nonzero-when-it-cannot-ask` — a transport failure
  exits non-zero with empty stdout; lookup misses keep `exit 0`; the
  board reads the code instead of inferring from emptiness → #200

### Message

- `bug/the-error-shows-the-whole-path` — drop the 80-character slice; the
  footer wraps → #202

Three waves. **Observation first** — it is the one that refused a correct
repair and touched a running agent's worktree, and the fix is
self-contained. **Transport second**, because the board change depends on
the script's new contract. **Message last**, and it is a one-line change
that needs neither.

## Done when

- **An empty conflict set refuses as `not-observed`**, never
  `not-artifact-only`. Assert the reason string — a refusal that names
  the wrong cause sends the reader to look for files that were never
  examined.
- **The exact case is repaired.** Assert a real artifact-only conflict,
  observed in a worktree the resolver controls, is repaired — the case
  the live board refused.
- **The resolver never merges in a worktree with foreign modifications.**
  Assert it refuses (or uses its own) when the target worktree has
  modified files. The measured case: zero unmerged paths, three modified
  files, an agent working in it.
- **A `not-observed` refusal does not repeat every pulse.** Assert the
  second pulse with unchanged input produces no second attempt — five
  identical log entries is the measured symptom.
- **`plot-host.sh` exits non-zero on a transport failure** and prints
  nothing on stdout. Assert a simulated 503.
- **A lookup miss still exits 0** with its documented state. The pairing
  that matters: a fix that exits non-zero on "no PR found" breaks every
  caller that branches on state, and passes the assertion above.
- **The board reads the exit code** rather than inferring `prError` from
  an empty result. Assert an empty-but-successful response is not
  reported as unavailable.
- **The error message shows the whole path.** Assert a message longer
  than 80 characters reaches the reader intact.
- `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`,
  `pnpm run validate` all pass.
- `pnpm build:board` run in the implementing worktree and the artifact
  committed — CI gates on no-diff.
- A changeset is present, with its `bumps:` block.
- macOS bash 3.2 — no `declare -A`.

## Notes

All three are the same defect wearing three costumes, and it is the one
this repo has now paid for ten times in a day: **an absent observation
read as a known value.** `claimed`/`eligible`, `index.lock`,
interrogation rounds, the change-marker's first pulse, `mergeable:
unknown`, the artifact fence — and now the resolver's own empty set, the
adapter's exit code, and a path cut at eighty characters.

The resolver case is the sharpest, because the rule that produced it was
correct and deliberate. Its wave was told: *never act on a host verdict
without an observed conflict set.* It obeyed — and the same test, applied
to a set it never gathered, now refuses the one repair it was built to
perform. A guard that cannot tell *I looked and found nothing* from *I
did not look* will eventually guard against the right answer.

The worktree intrusion is the part to fix first regardless of the rest:
the resolver ran `git merge` inside a worktree an agent was actively
editing. It refused before writing anything, so nothing was lost — but
that was luck, not design.
