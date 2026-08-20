# A rate limit is not an outage

> The board reported *"PR data unavailable … the two groups above that depend on
> it may be incomplete"* and *"Open issues could not be read"*. Measured at that
> moment: **GraphQL 0/5000, REST core 4988/5000.** The host was reachable, the
> credentials were valid, and one of two APIs had been spent. `gh pr create`
> failed for the same reason and the PR was opened through `gh api` seconds
> later.

## Status

- **Phase:** Draft
- **Type:** feature
- **Story:** plot-board
- **Sprint:**
- **Review:** in-session
- **Impl:** own branches
- **Assignee:** jwloka

## Problem

`plot-host.sh` reaches GitHub exclusively through `gh pr list` / `gh issue list`,
which use **GraphQL**. When that budget is spent every host question fails at
once, and the board degrades to *the host cannot be asked* — which is the
correct message for the wrong reason.

**Measured 2026-08-20 while the board was live:**

| API | Remaining |
|---|---|
| GraphQL | **0 / 5000** |
| REST core | **4988 / 5000** |

REST answers the same question:

    gh api 'repos/plot-pm/plot/pulls?state=all&per_page=3'
    #267 open head=bug/the-order-holds-still draft=false
    #266 open head=feature/a-worktree-holds-its-branch draft=false
    #265 closed head=feature/the-gates-know-design draft=false

So the fleet scan, the board's PR column and `/plot-deliver`'s gate all stop
working while 99.8 % of a second budget sits unused.

### The two shapes are not equivalent, and that is the whole design

`pr-list --rich` asks for `statusCheckRollup`, `mergeable`, `mergeStateStatus`
and `reviewDecision`. Measured: a REST **list** carries none of them —
`mergeable: null`, no `statusCheckRollup`. A REST **per-PR** read does carry
`mergeable` and `mergeable_state`, at one call per PR.

| Field | GraphQL list | REST list | REST per-PR |
|---|---|---|---|
| number, title, state, head, draft | ✅ | ✅ | ✅ |
| `mergeable`, `mergeStateStatus` | ✅ | **null** | ✅ |
| `statusCheckRollup` | ✅ | **absent** | separate endpoint |
| `reviewDecision` | ✅ | **absent** | separate endpoint |

So a fallback that silently substitutes REST would answer *no checks* and *not
mergeable* for every PR — the `an-outage-is-not-an-answer` failure inverted:
manufacturing a confident wrong answer where the honest one is *not asked*.

### The message is in a footer, and a footer is the wrong home for it

Both notes render as `<p>` elements at the foot of the Agents list —
`AgentList.tsx:4696` and `:4762`. They wrap rather than truncate, which was a
deliberate fix (*"the one moment the reader is owed the full sentence"*), and
they still sit below every row in the section they qualify.

Three consequences, all observable:

- **They are read last, or not at all.** A reader scanning WAITING ON YOU and
  NOT STARTED sees the incomplete data before the sentence saying it is
  incomplete. The qualifier arrives after the thing it qualifies.
- **Two independent failures make two paragraphs**, stacked, with no shared
  frame — the PR one and the issue one appeared together on 2026-08-20 and read
  as unrelated notes rather than one condition.
- **They are prose where a state exists.** The board already has a panel
  vocabulary for *this view is degraded*: `UnreachableOverlay` for a host that
  cannot be reached, and the dimming that the integration tests describe as
  *"dims the BOARD tab too"*.

A spent rate limit is exactly that state — partial, temporary, and with a known
end. It belongs in the same place, not in a footnote.

## Design

### Fall back for the plain shape, degrade explicitly for the rich one

**Plain `pr-list`** — number, title, state, head — falls back to REST silently,
because REST answers it completely. Nothing downstream can tell the difference
and nothing should.

**`pr-list --rich`** falls back to REST for the fields REST has and reports the
rest as **not asked**, in the vocabulary the scan already uses for a host it
could not reach. The board then shows a PR with its number and state and says
its checks are unknown, rather than claiming they failed.

Per-PR REST reads to recover `mergeable` are **not** done in the fallback: that
trades a rate limit for a call count, on the arm that fires precisely when the
budget is short. If it is ever wanted it belongs behind an explicit flag.

### The message names the cause

*"PR data unavailable"* is true and unactionable. A rate limit has a reset time,
and `gh api rate_limit` reports it:

    PR checks unknown — GraphQL rate limit spent, resets 06:17 (REST still serving)

That tells the reader it is temporary, when it ends, and that what they are
looking at is partial rather than wrong.

### Detection, not prediction

The fallback triggers on the **error**, never on a pre-flight budget check. A
pre-flight read costs a call, can itself be stale, and would have to run before
every question. `gh` exits non-zero with `API rate limit already exceeded` on
stderr; that string is the signal, and anything else stays an outage.

### What must not change

- **`an-outage-is-not-an-answer` holds.** A host that cannot be reached at all
  still reports `-`, never `NONE`. A rate limit is a THIRD state — *this API is
  spent, another answered* — and it must not collapse into either.
- **Bitbucket is untouched.** `bb` has one API; there is nothing to fall back
  to, and the existing exit-4 behaviour for `issue-list`/`issue-view` stands.
- **No new call per branch.** The scan's cost was cut from 279 s to 20 s across
  #262 and #264; a fallback that reintroduces per-branch host calls would undo
  it exactly when the host is least able to serve them.

### Open Points

- [ ] Should `issue-list` fall back too? REST has `/issues`, but the existing
      code deliberately uses `gh issue list` because *on GitHub every PR is an
      issue* and the REST endpoint returns both. The filter exists; whether it
      is worth maintaining twice is a judgement.
- [ ] Should the board surface the reset time in the banner, or only in the
      note? A countdown is more useful and more code.

## Branches

### Serves
- `feature/the-host-falls-back-to-rest` — `plot-host.sh` retries `pr-list` through REST when `gh` reports a spent GraphQL budget. The plain shape falls back completely; `--rich` returns what REST carries and marks `statusCheckRollup`/`reviewDecision`/`mergeable` as not asked. Tests: a stubbed rate-limit error produces a REST-shaped answer; the plain shape is byte-identical between the two paths; the rich shape marks the missing fields unknown rather than false; a genuine outage still exits as an outage; bitbucket is unaffected.

### Says
- `bug/the-note-names-the-rate-limit` — the board's degradation note distinguishes a spent budget from an unreachable host and carries the reset time. Tests: a rate-limited pulse says so and names the reset; an unreachable host keeps today's wording; the note never claims checks failed when they were not asked.
- `bug/a-degraded-view-says-so-at-the-top` — the two footer paragraphs become one degradation banner in the frame the board already uses for `UnreachableOverlay`, above the rows they qualify rather than below. Tests: a single condition renders one banner, not two paragraphs; both a rate limit and an unreachable host use the same frame with different words; the banner appears above the first affected section; a healthy pulse renders no frame at all.

## Notes

Found because `gh pr create` failed while opening an unrelated PR, and the same
PR opened through `gh api` immediately afterwards. Two paths to one host, one
spent and one idle.

The board's existing message is the reason this is worth doing rather than a
crisis: *"the two groups above that depend on it may be incomplete"* names
exactly what became unreliable. That is the standard the fallback has to meet —
partial data is fine when it says which part is missing, and the rich shape is
where it would be easiest to fail that standard quietly.
