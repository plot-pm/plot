# A rate limit is not an outage

> The board reported *"PR data unavailable"* and *"Open issues could not be
> read"*. Measured at that moment: **GraphQL 0/5000.** The throttle that exists
> for exactly this — `rateLimitBackoffMs`, which recognises the message and
> backs off to 120 s — is wired to the **PR refresh only**. The issue poll has
> none, and neither has the ceiling any relation to when the budget actually
> returns. Slowing down is the right answer; it is applied in one place out of
> several.

## Status

- **Phase:** Approved
- **Type:** feature
- **Story:** plot-board
- **Sprint:**
- **Review:** in-session
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:** 2026-08-20 by jwloka (in-session) — throttle, do not fall back to a second budget
- **Started:** 2026-08-20, Jan Wloka, `feature/every-host-consumer-slows-down`
- **Started:** 2026-08-20, Jan Wloka, `feature/the-wait-comes-from-the-host`
- **Started:** 2026-08-20, Jan Wloka, `bug/the-note-names-the-rate-limit`
- **Started:** 2026-08-20, Jan Wloka, `bug/a-degraded-view-says-so-at-the-top`

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

### The board is not the biggest consumer — measured

Asked while the budget was exhausted: **who spends it?** Measured at that moment
— **zero `claude -p` workers running, zero board processes running, GraphQL still
0/5000.** If nothing is running and the budget is empty, nothing running spent
it.

The arithmetic, per hour:

| Consumer | Cost | Share of 5000 |
|---|---|---|
| the board | 1 `pr-list` per 60 s = **60** | 1.2 % |
| ~20 agents | one PR each, a few `gh api` checks | low hundreds |
| **operator tooling** | **26 PRs opened tonight**, each with `pr view` / `pr checks` / `pr merge`, plus watch loops polling **several PRs every 30–45 s** | the remainder |

A single watch over four PRs at a 45 s cadence is **320 calls an hour**, and
several ran concurrently.

**So this plan throttles the 1.2 % consumer.** The finding it fixes is real —
the issue poll genuinely re-fires into a spent budget — but it was never the
cause. What exhausts GraphQL is *polling in a tight loop across several PRs*,
which is operator tooling rather than anything Plot ships.

That does not weaken the branches below: a board that keeps knocking while
refused is wrong regardless of who emptied the budget, and on Bitbucket, where
one call was measured at ~10 s, the board's share is three times larger. It does
mean the plan should not claim to have fixed the *cause*.

**Recorded as an open point rather than a branch**, because the fix is to how
this repository is operated — a watch that names its cadence, or one that reads
`rate_limit` before it polls — and not to anything in `plot-host.sh`.

### The throttle exists and is wired to one caller

`rateLimitBackoffMs` (`fleet.ts:819`) reads three shapes and is correct for all
three: a named wait (*"try again in 45 seconds"*), an absolute reset stamp, and
the bare message. Verified against the exact string seen:

    "GraphQL: API rate limit already exceeded for user ID 870334."
      matches /rate limit/i     → true   → backs off to PR_BACKOFF_MAX_MS
      names seconds             → false
      names a reset stamp       → false

Its call site (`:1295`) carries the reasoning: *"A rate limit is the one failure
worth slowing down for: retrying at the normal cadence spends quota to be told
the same thing."* That is exactly right.

**It is called once.** The issue poll records `issueError` at `:1136` and
re-fires on the ordinary cadence, spending budget to be refused. So one consumer
slows down and its neighbour keeps knocking.

### The ceiling is a guess where the host states a fact

`PR_BACKOFF_MAX_MS` is 120 s. The bare message carries no reset — but
`gh api rate_limit` does, and it is **free**: the rate-limit endpoint is not
itself rate-limited. Measured 2026-08-20: GraphQL `0/5000`, resets in ~8 minutes.

So the board can back off to the actual reset instead of retrying four times
into a closed door, and can say when service returns rather than *unavailable*.

### One status panel, not one banner per condition

The first reading of this said *"the two footer paragraphs become one
degradation banner"* — one frame per condition, borrowed from
`UnreachableOverlay`. That is still one-per-condition wearing a different coat:
two problems would stack two frames, and a third would push the rows further
down. The operator's correction is the right shape.

**Two surfaces, two questions.**

| Surface | Question | Where |
|---|---|---|
| **Board status** | *is something wrong?* | one panel, **top** |
| **View status** | *how fresh is what I see?* | the existing line, **foot** |

The footer line is not a status in the first sense and does not move:

    74 branches across 23 plans · scanned 4s ago · next in 1s · PR data 16s ago · next in 37s

Every word of it is about the currency of the view. It belongs where the eye
lands after reading the rows, and it is *always* true — which is exactly what
disqualifies it from a panel that must disappear when there is nothing to say.

**The board-status panel holds every status in one box:**

- **Most severe first, newest first within a severity.** A failed scan outranks
  a rate limit; two rate limits sort by age. The reader's first line is always
  the worst thing.
- **It says how many it holds** — `3 statuses` — so a reader knows whether the
  visible one is the whole story.
- **Paging back and forth** through the stack, because the box holds one at a
  time and the others must stay reachable rather than collapse into a count.
- **A new status flashes at the top for a few seconds**, then sorts into the
  stack by severity and age. Arrival is worth interrupting for; permanence is
  not. This is the same distinction `the-line-flashes-on-any-written-update`
  already draws.
- **The panel disappears when there is nothing to report** — an empty status box
  is a claim that the board is watching something, and a healthy board is not.

**Why one box rather than a list of banners.** A list grows without bound and
pushes the work off the screen; the panel is a fixed size whatever it holds. And
a count plus paging is honest about there being more, where a truncated list
would silently hide the third problem.

### The old reading: a footer is the wrong home for a problem

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

### Slow down everywhere, not in one place

Every host consumer routes its failures through the same throttle: the PR
refresh (already does), the issue poll (does not), and the fleet scan's host
questions. One function decides the wait; the callers only report it.

**Explicitly not a REST fallback.** Considered and rejected: a REST list carries
`mergeable: null` and no `statusCheckRollup`, so substituting it silently would
answer *no checks* and *not mergeable* for every PR — a confident wrong answer
where the honest one is *not asked*. And a fallback spends the second budget to
sustain a rate that is already too high, which converts a temporary refusal into
two exhausted budgets. **The rate is the problem; slow the rate.**

### The wait comes from the host, not from a constant

When the message names a wait or a reset, honour it — already implemented. When
it does not, ask `gh api rate_limit` **once** and use the real reset. Fall back
to `PR_BACKOFF_MAX_MS` only when even that cannot be read.

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

- [ ] **Operator watch loops are the real consumer** and nothing here bounds
      them. A watch polling four PRs every 45 s costs 320 calls an hour; several
      ran at once tonight. Should the repo ship a polling helper that reads
      `rate_limit` first and widens its own cadence — the same rule this plan
      applies to the board, applied to the tooling that watches it?

- [ ] Should `issue-list` fall back too? REST has `/issues`, but the existing
      code deliberately uses `gh issue list` because *on GitHub every PR is an
      issue* and the REST endpoint returns both. The filter exists; whether it
      is worth maintaining twice is a judgement.
- [ ] Should the board surface the reset time in the banner, or only in the
      note? A countdown is more useful and more code.

## Branches

### Slows
- `feature/every-host-consumer-slows-down` — the issue poll and the scan's host questions route their failures through `rateLimitBackoffMs`, as the PR refresh already does. Tests: a rate-limited issue poll waits rather than re-firing on the ordinary cadence; a non-rate-limit failure keeps the ordinary rhythm; the PR refresh's behaviour is unchanged. → #271
- `feature/the-wait-comes-from-the-host` — where the message carries no reset, one free `rate_limit` read supplies the real one, with the constant as the last resort. Tests: a message naming seconds still wins; a bare message uses the fetched reset; an unreadable rate_limit falls back to the ceiling; the read happens once per backoff, never per call. → #272

### Says
- `bug/the-note-names-the-rate-limit` — the note distinguishes a spent budget from an unreachable host and names when service returns. Tests: a rate-limited pulse says so and names the reset; an unreachable host keeps today's wording; the note never claims checks failed when they were not asked.
- `bug/a-degraded-view-says-so-at-the-top` — **one board-status panel at the top carries every status the board has to report**, and the view-status line stays at the foot. Corrected from the first reading, which proposed a banner per condition; see the design below. Tests: two conditions render one panel, not two; the panel names how many statuses it holds; paging moves through them without changing the order; a new status flashes at the top and then sorts into place; the panel is absent entirely when there is nothing to report; the footer keeps `74 branches across 23 plans · scanned 4s ago · next in 1s · PR data 16s ago · next in 37s` and gains nothing.

## Notes

Found because `gh pr create` failed while opening an unrelated PR. The first
reading was *fall back to REST, which is idle* — and the operator's correction
is the better one: **a second budget is not a fix for spending the first too
fast.** Falling back would have sustained the rate that caused the problem and
put two budgets at risk instead of one.

The throttle was already here, already correct, and already reasoned about in a
comment that says why a rate limit is the one failure worth slowing down for. It
was simply wired to one of several callers.

The board's existing message is the reason this is worth doing rather than a
crisis: *"the two groups above that depend on it may be incomplete"* names
exactly what became unreliable. That is the standard the fallback has to meet —
partial data is fine when it says which part is missing, and the rich shape is
where it would be easiest to fail that standard quietly.
