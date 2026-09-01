# One account has one budget

> Every board and every script budgets host calls for itself, and the limit
> belongs to the account. Two boards are two budgets against one cap, so the
> arithmetic that keeps one board under the limit says nothing about what the
> machine actually spends.

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** <!-- optional -->
- **Issue:** <!-- optional -->
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 5
- **Approved:** 2026-09-01, Jan Wloka, in-session
- **Started:** 2026-09-01, Jan Wloka, `bug/a-connector-answers-for-its-limit`
- **Started:** 2026-09-01, Jan Wloka, `bug/a-budget-belongs-to-the-computer`

## Changelog

- The board stops running the host out of requests when more than one of them is
  open: host calls are spent against one budget per account, held where every
  board and every helper can see it, so the cadence stretches with the number of
  spenders rather than per process.

Board impact: this IS the board, plus `plot-host.sh` as the one place that talks
to the host. The plan format, template and `docs/plans` layout are untouched.

> **Design spec:** [Budget](../stories/the-master-agent-holds-the-fleet/DESIGN-budget.md)
> — the entity, its identity, its provenance and where it lives. The connector
> kind it rests on is [Ports § A connector is a kind of adapter](../stories/the-master-agent-holds-the-fleet/DESIGN-ports.md).
> **The specs are the model; this plan is the work.** Where they disagree, the
> spec is what a later reader will trust.

## Motivation

**The banner is the symptom:**

> PR data paused: the host's rate limit is spent, service returns in ~12 min —
> showing data from 49 min ago — the two groups above that depend on it may be
> incomplete.

Two things are wrong there, and only one is cosmetic. The board is **49 minutes
stale on a 60 s timer**, and it is telling the operator to wait rather than
telling them the fleet is competing with itself.

### The budget arithmetic is correct and per-process

`fleet.ts:93-135` does this properly, and says so:

> the hourly spend stays 60 on both hosts; the higher a host's per-refresh cost,
> the further apart its refreshes
>
>     GitHub      1 request  → refresh every  60 s → 60 requests / hour
>     Bitbucket   4 requests → refresh every 240 s → 60 requests / hour

Every word of that holds **for one board**. Nothing in it is per-account, and
the limit is.

**Measured 2026-09-01: two `board-server` processes running on this machine.**
Two budgets, 120 requests/hour, each process believing it spends 60. Add the
operator's own `gh` calls and a dispatched worker's scans and no component knows
what the total is — including the one that renders the apology.

### The repo has already measured the failure this causes

`plot-host.sh:239` names it, with the date:

> the SECONDARY limit — concurrent-request throttling, which is the outage this
> repo actually had on **2026-08-27 with eight workers against a cap of seven**
> — reports a 403 naming abuse detection, while `gh api rate_limit` reads
> 5000/5000 on both buckets.

So **a second ceiling exists** — concurrency — reached by adding processes
rather than by any one process misbehaving, and a per-process budget cannot see
it by construction.

**But note which evidence that conclusion rested on.** `5000/5000 on both
buckets` was read from `gh api rate_limit`, the endpoint measured below
reporting 5000 while the headers reported 0. That reading cannot distinguish
*"the quota is fine, this is a secondary limit"* from *"the quota is spent and
this endpoint is wrong"*. The 403 naming abuse detection is independent evidence
and stands; the bucket reading beside it does not. Whether 2026-08-27 was purely
concurrency or partly an exhausted GraphQL quota is now unknown — which is
itself a reason to budget by bucket and read the headers, since the same
ambiguity will otherwise recur at every diagnosis.

**And the cap of seven inherits that same uncertainty.** The number appears
twice in `plot-host.sh` (lines 242 and 514) and both citations are the same
2026-08-27 incident; it has no independent source — not GitHub's documentation,
not a second observation. **Seven was never measured.** What was observed is
that eight failed, and seven is the inference from it.

**So the concurrency slice must discover its bound rather than hard-code one.**
`bug/the-budget-bounds-simultaneous-calls` says *"sized against the measured
seven"*, and that phrasing should not survive: a cap compiled in from one
incident is a guess wearing a measurement's clothes, and it is wrong in the
direction that hurts — too high and it never fires, too low and it throttles work
that would have succeeded. **The bound belongs with the connector's predicted
limit**, corrected by the refusals it causes, which is the mechanism this plan
already has.

### The buckets are separate, and the board budgets neither of them by name

GitHub meters **REST (`core`) and GraphQL as independent buckets**, 5000 each,
plus narrower ones (`code_search` is 10). Measured 2026-09-01 from the response
headers:

| bucket | limit | remaining | used |
|---|---|---|---|
| `core` (REST) | 5000 | **4990** | 10 |
| `graphql` | 5000 | **0** | **5000** |

`plot-host.sh` uses both forms and does not distinguish them: `gh pr list`,
`gh pr view` and `gh issue list` are GraphQL; `gh api repos/…` and `gh run list`
are REST. One is exhausted while the other is untouched, so a single "host
requests" budget both under-counts the bucket that is nearly spent and refuses
calls that would have gone to the bucket with 4990 left.

**This is why REST worked all evening while GraphQL refused** — not a secondary
limit, which is what the failure looked like from the aggregate view.

**But a spent bucket is not the only cause, and a second measurement proves it.**
2026-09-01, hours after that evening: `gh pr view` refused with *"API rate limit
already exceeded"* while the same account's GraphQL headers read **4854 of 5000
remaining, 146 used**. A bucket with 97 % left does not refuse on quota. So both
causes are real — an exhausted bucket AND a limit that fires on burst
concurrency — and the aggregate view cannot tell them apart, which is exactly why
the banner must name which one it hit.

### The endpoint plot asks reports the wrong number

`graphql_budget_spent()` (`plot-host.sh:536`) reads
`.resources.graphql.remaining` from `gh api rate_limit`. Measured 2026-09-01,
three consecutive readings, uncached, against the same account and moment:

    rate_limit says graphql=5000   response header says=0
    rate_limit says graphql=5000   response header says=0
    rate_limit says graphql=5000   response header says=0

The gate that exists to notice a spent GraphQL budget **cannot see it**, because
the endpoint it trusts reports a full bucket while every real call is refused.
The same reading is what licensed the comment beside it — *"the call itself is
FREE, measured 2026-08-27: three consecutive readings, all used=0"* — and
`used=0` from this endpoint is not evidence that a call was free; it is the
symptom.

**Re-measured 2026-09-01 in a QUIET moment, and it is worse than a
throttle-time artefact.** With no rate limiting in effect:

    /rate_limit          graphql: 5000/5000   used 0
    a real GraphQL call  X-Ratelimit-Remaining: 4854   Used: 146   Resource: graphql

**146 calls spent, reported as zero.** The first measurement above could be read
as the endpoint lagging under pressure; this one cannot. The endpoint is wrong
when nothing is wrong, which means `graphql_budget_spent()` has never been able
to fire — its `-eq 0` test is applied to a number that does not move.

**So the authority must be the headers on a real response**, which report
`X-RateLimit-Resource` naming the bucket the call actually spent, alongside
`Limit`, `Remaining` and `Used`. A call that has to happen anyway carries its own
accounting; a separate question about the budget is both an extra request and, as
measured, wrong.

### Eleven scripts and the board share the same cap

`plot-build-monitor.sh`, `plot-board-probe.sh`, `plot-approve.sh`,
`plot-deliver.sh`, `plot-fleet-scan.sh`, `plot-dispatch.sh`,
`plot-impl-status.sh`, `plot-plan-meta.sh`, `plot-release-refs.sh`,
`plot-reconcile-scan.sh`, `plot-reap.sh` all reach the host through
`plot-host.sh`. None of them knows a board is running, and a dispatched worker
runs several of them in a loop.

**Re-counted 2026-09-01: eleven, not twelve** — the heading said one thing and
the list another, and the list was right. The twelfth is easy to reach for and
wrong: `plot-host.sh` is the script being *called*, not a caller sharing the cap.

**And the scripts are not the whole population.** Five files under
`packages/board/src/server/` reach `plot-host.sh` directly, so the spenders are
**eleven scripts, the board, and a person at a terminal** — which is exactly why
the record is append-only and the cadence derives from an observed rate rather
than a headcount. A count of scripts would have missed the board; a count of
boards would miss the terminal.

`plot-host.sh:222` already anticipates the shape of the answer:

> a board on a 5 s cadence, a scan inside a 90 s budget and a person at a
> terminal want three different answers — and a retry inside the adapter would
> impose one

That is the right instinct about *retry*. It leaves *spending* unowned.

### What the existing mitigation does and does not do

`PLOT_TERMINAL_CACHE` removes the host round trip for branches in a terminal
state — 26 of 54 here — and it works. But `fleet.ts:2193` passes it into the
child scan from the board's own memory, so each board has its own. Two boards
ask the host the same questions twice, and a board started a minute ago has an
empty cache and asks everything.

## Design

### One budget, on disk, per account

The spender that matters is the **account**, so the record must live where every
process on the machine can find it, keyed by host and account, holding what has
been spent, against which bucket, and when.

**`.plot/state/` is NOT that place, and an earlier draft of this section said it
was.** That directory is per CHECKOUT. Measured 2026-09-01 on this computer:

| checkout | remote | `.plot/state/` |
|---|---|---|
| `Agentic-Tools/plot` | github | its own |
| `Agentic-Tools/agent-skills` | github | its own |
| `EKZ.Webportal/ekzweb` | bitbucket | its own |

**Two checkouts, one GitHub account (`jwloka`), two budget files** — and each
would read a full 5000 while the other spent it. That is precisely the
over-spend this plan exists to prevent, reproduced by its own storage choice.

**The third checkout sharpens it rather than softening it.** `ekzweb` is on
bitbucket, so it shares no bucket with the other two. A per-checkout record makes
the `host` half of the key do no work — every file has exactly one host in it —
while the `account` half, the half that actually needs to be shared, cannot be.
The key is right and the location contradicts it.

**And the title is wrong in a way the storage flaw hides: there is no ONE
budget.** Every connector has its own limit, its own buckets and its own way of
reporting them — or none at all. Measured 2026-09-01 across
`skills/plot/scripts/*.sh`:

| connector | call sites | limit model |
|---|---:|---|
| `bb` (Bitbucket) | **102** | its own scheme; no `X-RateLimit-Resource` |
| `gh` (GitHub) | 59 | REST + GraphQL, 5000/hr each, plus an undocumented secondary limit |
| `jen` (Jenkins) | 9 | typically none |
| `jira` | 8 | its own |

**Bitbucket is the most-called connector in this repo, and the plan mentions a
non-GitHub host three times.** Its entire mechanism — reading
`X-RateLimit-Resource`, `Remaining` and `Used` from a response header — is a
GitHub convention. Bitbucket does not send those headers, and Jenkins has no
limit to send.

**The spending entity is therefore `(connector, account, bucket)`, not `account`.**
The plan's key already carries `host` and `account`; what it lacks is that
*what a limit means* is connector-specific, so the record has to hold a
connector's own vocabulary rather than GitHub's.

**This is already a live defect, not only a design gap.** `graphql_budget_spent()`
runs `gh api rate_limit` with **no branch on backend** — so on a Bitbucket
project it asks GitHub about a budget the project never spends, and on Jenkins
it asks about a limit that does not exist. `plot-host.sh` resolves
`backend=github|bitbucket` at the top and the budget gate ignores it.

**Four today, and the list is open — GitLab and Trello are named as next.** That
settles the shape rather than merely widening the table: **a design keyed to four
connectors is one that breaks on the fifth.** The budget record must carry a
connector as a STRING it does not validate.

**Plot's own config already splits on exactly this, inconsistently.**

| key | shape | on an unknown value |
|---|---|---|
| `Git host` | closed enum `github\|bitbucket` | `plot-host.sh:1006` **dies** |
| `Tracker` | `plot \| jira \| github-issues \| linear` | tolerated |

`Tracker` already names `linear`, a connector Plot has no adapter for, and
`plot-plan-meta.sh:276` branches on it for BEHAVIOUR (`jira|linear` enable the
key form) without the identity being closed. **That is the pattern to copy: the
connector names itself; the code branches only where behaviour genuinely
differs.**

**A third closed enum is the failure mode to avoid.** If the budget validates
its connector, adding GitLab means editing the budget as well as the host
adapter — and the edit that gets forgotten is the one that turns an unknown
connector into a refusal or, worse, into GitHub's defaults.

**CI is a THIRD axis, and it does not follow the git host.** Jenkins, GitHub
Actions and GitLab pipelines are chosen independently of where the code lives —
this repo runs GitHub Actions on a GitHub remote, while `ekzweb` runs Jenkins
against Bitbucket. `plot-host.sh:1336` already resolves `ci_backend()`
separately, reads a `Jenkins instance` with its own auth, and spends against that
server rather than against the git host's quota.

**And CI can be the same vendor on a different budget.** GitHub Actions minutes
are a quota distinct from the API's 5000/hr, so *"the connector is github"* does
not identify the bucket. `(connector, account, bucket)` already carries that —
provided the bucket is the connector's own word rather than a normalised one.

**`ci_backend()` is the model to follow, and it is already right.** It reads
`$PLOT_CI` or the `CI` key, lowercases, and validates nothing — no enum, no
`die`. Plot therefore has three connector axes with three disciplines today:

| axis | shape | on an unknown value |
|---|---|---|
| `Git host` | closed enum | **dies** (`plot-host.sh:1006`) |
| `Tracker` | named set, open in practice | tolerated; branches on behaviour |
| `CI` | free string | tolerated |

### The connector answers for its own limit, and says how well it knows

**Settled 2026-09-01.** The adapter — not the budget, and not a table in Plot —
answers *what is this connector's limit?*, and tags the answer with how it was
obtained:

- **`actual`** — the connector has a rate-limit API or sends limit headers, and
  this is what it said. GitHub's `X-RateLimit-Limit`/`Remaining`/`Resource` are
  the case.
- **`predicted`** — the connector offers nothing to ask, so this is a value from
  experience. Jenkins has no limit to report; Bitbucket, GitLab and Trello each
  answer differently or not at all.

**This is why the budget needs no connector table and no probe at setup.** It
asks the port and reads the tag. A connector Plot has never seen returns
`predicted` from its own adapter, which is the only place that could know — and
a connector nobody has written an adapter for cannot be called at all, so it has
no budget to get wrong.

**A `predicted` value is corrected by the session that disproves it.** A refusal
observed while spending — `plot-host.sh:245` already classifies stderr as
`throttled` — is evidence about the real limit, and it updates the prediction
for the rest of the session. The estimate improves where it is wrong and costs
nothing where it is right. **This is the piece a static default cannot have**: a
number shipped in Plot is stale the moment a vendor changes it, while a number
corrected by the refusal it caused cannot be.

**The vocabulary already exists in this repo.** `StateSourceSchema`
(`entities/identity.ts:40`) is `stated | derived | foreign | measured`, and
`stateFailureMode` names how each goes wrong — *"`measured`: decaying
instantly"*. A limit reading is the same idea one level down: **`actual` decays,
`predicted` is wrong until something proves it.** Name the pair in that
vocabulary rather than inventing a second one.

**And it is orthogonal to `PortResult`.** `answered | failed | unaskable` says
whether the question could be put; `actual | predicted` says how the answer was
come by. A `predicted` limit is *answered* — the adapter is not failing, it is
telling the truth about what it knows.

**The budget follows `CI`.** It is the axis that already survives a vendor
nobody has written an adapter for, which is what gitlab and trello will be.

**What each connector must supply, and nothing more:** its own name, the bucket
a call spent, and how to read what remains — or an honest *unknown*. GitHub
reads `X-RateLimit-Resource` from a response header; Bitbucket answers
differently; Jenkins has no limit at all. **The adapter knows; the budget only
records.**

**So the design must state what it does where a connector reports nothing.** The
honest answer is *unknown*, and `unknown` must not collapse into *spent* or
*free* — the same `PortResult` distinction the rest of this repo keeps
re-learning. A connector with no limit needs no budget; a connector with an
unreadable one needs a refusal that says which.

**So the record belongs outside any checkout**, somewhere every Plot instance on
the computer resolves identically — the same distinction
[`a-machine-is-an-instance`](2026-08-30-a-machine-is-an-instance.md) draws
between the Machine (one per Plot project, keyed by `repoRoot + scriptsDir`) and
the Computer (one, and the owner of anything hardware- or account-shaped). **A
rate limit is an account fact, so it is the Computer's**, not the instance's.

**A shared file does NOT reopen the lock question**, and it is worth saying why
rather than leaving the reader to worry. The design is already append-only —
*"each spender appends what it spent, with a timestamp; a board derives its
cadence from the observed rate across the whole file"* — which is the shape that
tolerates several writers: there is no read-modify-write to interleave. Moving
the file from a checkout to the computer changes who appends, not how.

**The one assumption that becomes load-bearing is the line length.** Concurrent
`O_APPEND` writes are atomic only below `PIPE_BUF` (4096 bytes on Linux and
macOS). A budget line — timestamp, host, account, bucket, count — is two orders
of magnitude under that, so the property holds; but it holds *because* the line
is short, and a future field that carries a response body or an error message
would break it silently. **State the cap where the record is defined.**

Every host call goes through `plot-host.sh` already, which is the one place that
appends to it.

### GraphQL stays the default, and the asymmetry is why

The obvious inversion — *use REST whenever possible, switch to GraphQL when REST
is spent or lacks a feature* — is rejected, and `plot-host.sh:524` already
argues it in those words:

> "Use REST whenever possible" trades one cheap call for a hundred and eighty.

The cause is structural rather than incidental. **Verified 2026-09-01** against
this repo:

    GET /repos/{o}/{r}/pulls  →  mergeable_state: null,  no statusCheckRollup

REST's list endpoint carries neither the merge state nor the check rollup, so
full data costs **two REST calls per PR** — ~186 for a 93-branch scan — against
**one** GraphQL call that returns the rollup inline. Inverting the default would
multiply the board's main query by ~186 and exhaust `core` faster than GraphQL
is exhausted today, which is the failure this plan exists to remove rather than
relocate.

**So the rule is: the cheap path per question, with the other bucket as the
fallback.** For a PR list that is GraphQL. It is not a global preference for one
API, and the plan should not be read as endorsing GraphQL — a question REST
answers in one call belongs on REST, and `issue-view` fetching one issue is a
candidate.

**Where REST is not a fallback but the only answer**, the routing must say so
too: a feature GraphQL lacks is a routing input exactly like a spent budget.

### A connector is a kind of adapter, and only one exists today

**Settled 2026-09-01.** Not every adapter is a connector. A **connector** reaches
a remote service across a network — it has an account, credentials, a rate limit,
and a transport choice. Every other adapter reaches the local machine, where none
of those apply.

**Measured across `packages/domain/src/adapters/`:**

| adapter | shells to | remote CLI calls |
|---|---|---:|
| **`host`** | `plot-host.sh` | **11** (`gh`, `bb`, `jen`, `jira`) |
| `refs` | `plot-fleet-scan.sh` | 0 |
| `processes` | `plot-worker-state.sh` | 0 |
| `plan-store` | `plot-config.sh`, `plot-plan-meta.sh` | 0 |
| `performer` | `plot-reconcile-scan.sh` | 0 |
| `machine`, `trees`, `clock`, `channel` | — | 0 |

**Exactly one adapter is a connector.** The rest read git, the process table, the
filesystem and a socket — free, unmetered, and answerable without an account.
`refs` carries **12 ops** against `host`'s 6 precisely because nothing charges for
`git rev-parse`.

**So the rate-limit contract belongs to the connector kind, not to `Adapter`.**
Only a connector answers *what is your limit, and how well do you know it?*; only
a connector records what a call spent; only a connector chooses a transport. A
future filesystem port must not be made to implement any of it, and a future
GitLab connector must implement all of it.

**And the port stays the domain's, unchanged.** `Host` names six questions and no
transport, no account, no bucket — which is what lets the connector hide all
three. **The connector-ness is on the adapter side of the port**, invisible to
every caller, which is the property that makes adding GitLab an adapter change
rather than a domain change.

**This is also why `Git host`, `Tracker` and `CI` are three axes and not one
setting.** Each names a connector independently: this repo is GitHub + Actions,
`ekzweb` is Bitbucket + Jenkins. Three axes, one kind, and a budget per
`(connector, account, bucket)` falls out of that rather than being imposed on it.

### The transport is the connector's business, not the caller's

**Settled 2026-09-01, and it inverts the section below.** REST-versus-GraphQL is
a **GitHub** distinction. Bitbucket has no such split; Jenkins has neither
transport; GitLab and Trello will each have their own. **A routing rule lifted
above the adapters would model a fork that exists for exactly one connector**,
and every future adapter would implement an interface shaped by GitHub's
accident.

**So routing goes down, into the connector.** A caller asks *"is this branch
merged?"* — `prMerged(branch)` — and the GitHub adapter decides whether that is
cheaper as REST or GraphQL given what each bucket has left. The choice, the
budget reading, and the bucket the call spent are all **hidden implementation
detail of the adapter that owns them**.

**The `Host` port already has this shape and names no transport.** `prState`,
`prMerged`, `prList`, `issueList`, `issueView` are questions, not routes. Nothing
in the port would change; what changes is that the adapter stops leaking the
decision to its caller.

**This is the layering rule applied rather than a new idea** — *"the domain owns
the port; an adapter implements it and is the only place that may reach the
world."* A router above the adapters is domain-specific code outside the domain,
which the rule forbids in as many words.

**And it makes the count below an argument for descending, not ascending.** 14
backend branches consulting 3 budgets is what routing scattered *inside*
`plot-host.sh`'s github branches looks like. Gathering it into one place per
connector fixes that; gathering it into one place for all connectors fixes it and
then charges every other connector for the privilege.

**What the budget still needs from the adapter is the RECORD, not the decision:**
which bucket the call spent, in the connector's own word. That is the tag
`bug/the-budget-knows-which-bucket-it-spent` writes, and it is an observation
after the fact rather than a choice made before it.

### The routing decision belongs where every adapter can reuse it

**This is the plan's structural gap, and it is bigger than the budget.** The
choice between paths is made *inside* one op's github branch —
`plot-host.sh:1046`, within `if [ "$be" = "github" ]`, under a comment saying
*"THE ROUTE IS CHOSEN ONCE, HERE"*. Once **for `pr-state`**, and nowhere else.

**Measured 2026-09-01:**

| | count |
|---|---|
| backend branches (`be" = "github"`) in `plot-host.sh` | **14** |
| paths that consult the budget at all | **3** |

So roughly eleven host-touching paths spend with no idea what is left, and any
new op inherits that by default — the routing was written for one question and
never generalised. A second copy would drift from the first, which is the
argument `plot-pr-merged.sh` already makes about a duplicated gate failing in
the permissive direction.

**One router, asked by every op.** Given a question, the budget record and what
each API can answer, it returns which path to take — or that neither can be
taken now. The ops call it; they do not each re-derive it. That is also what
makes the `Host` port (`packages/domain/src/ports/host.ts`) able to express this
for adapters other than `gh`: the decision is a domain rule over readings, not a
property of one CLI.

### There is no registry, and no lock

Two things this plan deliberately does NOT build, because both were considered
and both cost more than they return.

**No spender registry.** Nothing counts boards. Measured 2026-09-01: nothing
registers a running board at all — `.plot/state/` holds `fleet-controls.json`
and `last-pulse.json`, and `index.ts` knows its own `boundPort` and nothing
about peers. A lease file with heartbeats would answer *"how many boards?"* and
bring with it a liveness protocol and stale-entry reaping — the same class of
problem the orphaned-server work has already been through twice, with one
unexplained termination path and 152 orphans measured on this machine.

**Instead the spend rate is the signal.** Each spender appends what it spent,
with a timestamp; a board derives its cadence from the observed rate across the
whole file, not from a headcount. A board that dies stops appending and stops
counting, with nothing to reap and no protocol to get wrong. *"How many
spenders"* becomes a question nobody has to answer correctly.

**No lock.** Reading and writing the budget under a lock on a 5 s cadence
serialises every host call behind a filesystem operation. The budget is
**best-effort**: appended without a lock, tolerant of a lost write, and read as
an estimate. An occasional double-spend costs one request out of 5000; a lock on
the hot path costs latency on every request and adds a failure mode — a stale
lock — whose recovery nobody has written.

**This makes the budget advisory, and that is the honest description.** It is
not a quota enforcer. It is a shared measurement that lets a cadence adapt, and
the property below is what it must deliver.

### The cadence divides, it does not double

A board's refresh interval already stretches by per-refresh cost. It must also
stretch by the **observed spend rate**: when two boards are spending, each
refreshes half as often, and the pair still spends 60 requests an hour.

This is the property the plan is named for. A second board must not increase
what the account spends — it must halve what each board spends. Note what
follows from deriving it from rate rather than headcount: the operator's own
`gh` calls from a terminal, and a dispatched worker's scans, are counted too,
because they also append. A headcount of boards would have missed both.

### Concurrency is a separate ceiling from quota

The 2026-08-27 outage was **eight workers against a cap of seven** with the
quota untouched. So the budget must bound *simultaneous* requests as well as
requests per hour, and those are different numbers with different recovery
behaviour. A quota exhaustion has a reset time worth printing; a secondary limit
clears in seconds and the board should retry, not apologise for 49 minutes.

### Halving the frequency is the wrong reaction, and to both failures

**Settled 2026-09-01.** The obvious response to a refusal — *halve the cadence*
— is rejected, because the two failures recover differently and halving suits
neither.

| | quota spent | secondary / burst |
|---|---|---|
| what is exhausted | requests per hour | requests at once |
| recovery | the reset time, minutes | seconds |
| halving the cadence | **does not help** — the bucket is empty, and a slower call is refused identically | **too slow both ways** — it waits far longer than needed and still bursts |
| the right reaction | **stop until the reset**, and say when | **retry shortly, and lower concurrency** |

**A spent bucket is not a rate problem.** Nothing is spendable until the reset,
so a halved cadence is a slower way of being refused. The honest reaction is to
stop asking, print the reset the header already carries, and resume at the old
cadence — the previous rate was not the cause.

**A secondary limit is a concurrency problem wearing a rate costume.** The
2026-08-27 outage was eight workers against a cap of seven with the quota
untouched; halving each worker's frequency would have left eight in flight and
refused again. **The lever is `bug/the-budget-bounds-simultaneous-calls`, not the
cadence.**

**So the cadence divides on OBSERVED SPEND, never on a refusal.** Division is how
the account stays within its budget while several spenders share it — it is
proactive, derived from the record, and it is already the section above. A
refusal is not an input to it: reacting to an error by halving would compound
with the division already happening and drift the cadence down with nothing to
bring it back.

**What a refusal DOES update is the prediction.** For a connector answering
`predicted`, a `throttled` is the evidence that its value was wrong, and the
correction belongs there rather than in the cadence.

**Nothing reacts at all today** — verified 2026-09-01: `plot-host.sh` has no
sleep, no retry and no backoff, and `fleet.ts` never reads `throttled`. So this
is new behaviour rather than a correction, and it should be built in the order
above: stop-until-reset first, because it is the one with a number the header
already supplies.

### The banner tells the truth about which limit and which clock

Today it prints the primary reset (`~12 min`, `~59 min`) whatever the failure
was. On a secondary limit that number is wrong and the advice it implies —
wait — is the opposite of what helps. When the cause is *this machine's own
spenders*, the banner should say so and name how many, because the fix is
closing a board rather than waiting for GitHub.

### Open Questions

- [ ] Where does the budget file live when boards run from different worktrees?
      `.plot/state/` is per-checkout, and two worktrees of the same repo are two
      directories with one account behind them — measured tonight: two boards
      ran from two worktrees. The record is keyed by ACCOUNT, so its path must be
      too; a per-checkout path would give each worktree its own budget and
      reproduce the exact bug this plan exists to fix, one level up. Decide
      before the first slice writes a file, because moving it later is a
      migration.
- [x] Is a file lock enough, or does the budget need a daemon? **Neither — the
      budget is lock-free and best-effort.** An append without a lock can lose a
      write; that costs one request of 5000 and is recoverable by the next
      append. A lock costs latency on every call and introduces stale-lock
      recovery, and a daemon introduces a process that can die holding the
      answer. The remaining question is not the lock but the FORMAT: an
      append-only record tolerates concurrent writers far better than a
      rewritten JSON object, and the first slice should pick accordingly.
- [ ] What does a script do when the budget is spent — refuse, or spend anyway
      and say so? `plot-reap.sh` treats an unreachable host as *not merged* and
      keeps, which is safe. `/plot-deliver` blocking on a budget would be new
      behaviour, and a workflow command a person is waiting for is not a poll.

## Branches

**Every slice below says *per account* and now means *per `(connector, account,
bucket)`*, in a record outside any checkout.** The two findings that changed
this — `.plot/state/` being per checkout, and the connector list being open —
are recorded in the Design above. **Naming the record is a slice of its own and
comes first**, because five branches write to it.

### Asking the connector

- `bug/a-connector-answers-for-its-limit` — `Host` gains one op: *what is this connector's limit, and how well do you know it?* The answer carries a value and a tag — `actual` where the connector has a rate-limit API or sends limit headers, `predicted` where it has neither and the adapter supplies a value from experience. **The adapter is the only place that could know**, which is what removes the need for a connector table in Plot or a probe at setup. Deliverables: the port op, GitHub's `actual` implementation from response headers, one `predicted` implementation (Jenkins, which has no limit to report), and the rule that a `predicted` value is corrected by a `throttled` observed during the session — `plot-host.sh:245` already classifies the stderr. **First, because the record cannot be shaped before it is known what a connector can answer.**

### Naming the record

- `bug/a-budget-belongs-to-the-computer` — where the record lives and what it is keyed by, before anything appends to it. Outside any checkout, since two GitHub checkouts on this machine share one account and each `.plot/state/` would read a full 5000. Keyed by connector, account and bucket, with the **connector carried as a string the record does not validate** — `Tracker` already names `linear` without an adapter, and a third closed enum is an edit that gets forgotten when GitLab arrives. Append-only with a stated line cap, since concurrent `O_APPEND` is atomic only below `PIPE_BUF`. Deliverables: the location, the key, the format, and what a connector that reports no limit records — which is `unknown`, never `free`. **Plus the window and the pruning**, which the design spec settles and which cannot be deferred: measured 2026-09-01, one board at 5 s and eleven scripts at 90 s append **~1,160 lines an hour, 15 MB a week**, so a rate derived over the whole file approaches zero and every reader parses megabytes. A reader consumes only lines newer than the connector's own reset window and truncates what it has just proven dead — the one write that is not an append, at most once per reset.

### Counting what is spent

- `bug/the-host-adapter-counts-what-it-spends` — `plot-host.sh` appends every call to a per-account record, lock-free, and can read back the recent spend rate. No behaviour change beyond the record: the deliverables are a number every component can see, the append format (which must tolerate concurrent writers without a lock), and the answer to where the file lives when two worktrees share one account.

### Dividing the cadence

- `bug/the-board-refresh-divides-by-its-peers` — `fleet.ts` derives `PR_REFRESH_MS` from the observed spend rate as well as the per-refresh cost, so N boards spend what one board spends. No peer counting: the rate is read from the record, which also captures the operator's own `gh` calls and a worker's scans. The measurement is two boards running for an hour against a request count.

### Telling the two limits apart

- `bug/a-secondary-limit-is-not-a-spent-quota` — the banner names which limit was hit, prints a reset time only when there is one, and when the cause is local contention says how many spenders it found. **`plot-host.sh` does NOT already distinguish them, and an earlier draft of this line said it did.** Verified 2026-09-01: `host_failure_kind` matches one regex — `rate limit|ratelimit|too many requests|429|secondary rate|abuse detection|exceeded a secondary` — and returns `throttled` for every one of them. *"API rate limit exceeded"* and *"You have exceeded a secondary rate limit"* both come back `throttled`, so the board is not discarding a distinction; there is none to discard. **This slice makes it, rather than surfacing it.**

### One router, reused

- `bug/one-router-chooses-the-path` — the GitHub adapter chooses REST or GraphQL for itself, and no caller learns which. Today the choice is made inside `pr-state`'s github branch under *"THE ROUTE IS CHOSEN ONCE, HERE"* — once for `pr-state`, and nowhere else, while 14 backend branches consult 3 budgets. **Gather it into one place PER CONNECTOR, not one place for all of them:** REST-versus-GraphQL is a GitHub distinction, and a shared router would make every future adapter implement a fork that exists for one vendor. The `Host` port already names no transport, so nothing in it changes. No new capability — the deliverable is that eleven paths stop spending blind and the transport stops being the caller's business.

### Budgeting each bucket by name

- `bug/the-budget-knows-which-bucket-it-spent` — the record from slice 1 is keyed by bucket (`core`, `graphql`, and whatever `X-RateLimit-Resource` names), read from the response headers of calls that were going to happen rather than from `gh api rate_limit`, which was measured reporting 5000 while the headers reported 0. Fixes `graphql_budget_spent()` in the same slice: a gate that cannot see the condition it gates on is worse than no gate, because it reports safety.

### Waiting for the reset

- `bug/a-spent-bucket-waits-for-its-reset` — the reaction to a refusal, which nothing does today: `plot-host.sh` has no sleep, no retry and no backoff, and `fleet.ts` never reads `throttled`. On a **spent quota** the caller stops until the reset the response header carries and resumes at its previous cadence — the rate was not the cause, so it is not the fix. On a **secondary limit** it retries after seconds and lowers concurrency, never frequency. **The cadence is not touched by either**: it divides on observed spend, and a refusal that also halved it would compound with that division and drift downward with nothing to restore it. Needs the bucket naming from `bug/the-budget-knows-which-bucket-it-spent` to know which reaction applies.

### Bounding concurrency

- `bug/the-budget-bounds-simultaneous-calls` — a cap on in-flight host requests per account. **Discovered, not hard-coded:** seven has no independent source — `plot-host.sh:242` and `:514` both cite the one 2026-08-27 incident, where eight failed and seven is the inference. The bound starts as the connector's `predicted` value and is corrected by the refusals it causes, the same mechanism the limit itself uses. Last, because it needs the record from slice 1 and the reporting from slice 3 to show it is working rather than merely quiet.

## Done when

- **Two boards running for an hour spend no more host requests than one board
  does** — counted from the budget record, stated in the changeset. This is the
  plan's name and its only real claim.
- A third board changes that number by nothing.
- The banner never prints a reset time it did not receive, and when the limit is
  local it says how many spenders were found.
- **Every op consults the router**, and no op re-derives the choice. Asserted by
  there being one implementation, not by review.
- **A spent GraphQL bucket does not stop a REST call, and vice versa** — the two
  are budgeted by name, so the board keeps answering from the bucket that has
  4990 left instead of pausing on the one that has 0.
- `graphql_budget_spent()` returns true when the headers say the bucket is spent,
  asserted against a response whose `X-RateLimit-Remaining` is 0 — not against
  `gh api rate_limit`, which reported 5000 at that moment three times running.
- The 2026-08-27 shape is covered: more spenders than the concurrency cap
  degrades cadence rather than producing a 403.
- A script whose budget is spent behaves the way its own safety argument
  requires — `plot-reap.sh` keeps, and nothing silently reads *unreachable* as
  permission.
- `pnpm run test:board`, `pnpm run typecheck`, `pnpm build:board`, `pnpm test`,
  changeset.

## Notes

**Nothing here is a new diagnosis.** `fleet.ts` did the per-refresh arithmetic
and stated its unit; `plot-host.sh` separated the primary limit from the
secondary one and recorded the outage that motivated it. Both were right about
what they measured. The gap is that a *process* was the unit of both, and the
limit's unit is an account.

**The cheap path is per question, not per API.** An earlier reading of this
plan inverted it — REST first, GraphQL when REST runs out — which is the natural
instinct once you know REST's bucket is the untouched one. The measured
asymmetry refuses it for the board's main query, and the same measurement is why
the router takes the question as an input rather than applying one global
preference.

**The aggregate endpoint is not a source of truth.** Two of this plan's
findings come from comparing it to the headers on a real response, and both
times it was the endpoint that was wrong. Anything that decides whether to spend
should read what the last spend reported.

**The stale banner is the tell.** A board 49 minutes behind on a 60 s timer is
not slow — it has been refused ~49 times, and the only thing it can say is when
GitHub will forgive it. It cannot say *"the other board on this machine is
asking the same questions"*, because it has no way to know another board exists.
