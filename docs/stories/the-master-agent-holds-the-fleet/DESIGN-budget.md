---
title: Budget — domain object specification
story: the-master-agent-holds-the-fleet
author: jwloka
status: draft
created: 2026-09-01
updated: 2026-09-01
---

# Budget — domain object specification

What a connector will still answer, and how well anyone knows it.

> **Story:** [The master agent holds the fleet](STORY-the-master-agent-holds-the-fleet.md)
>
> **Companions:** [Ports](DESIGN-ports.md) · [Machine](DESIGN-machine.md) ·
> [Entities](DESIGN-entities.md)

## Contents

| § | section | answers |
|---|---|---|
| 1 | What a Budget is | *what is being metered, and by whom?* |
| 2 | Identity | *which budget is this?* |
| 3 | The domain object | *what does it hold?* |
| 4 | Provenance | *how well is the limit known?* |
| 5 | Where it lives | *whose record is it?* |
| 6 | Reacting to a refusal | *what happens when it runs out?* |
| 7 | Relations | *what does it touch?* |
| 8 | What it is not | *what must not be built here?* |

## 1. What a Budget is

**A Budget is what a connector will still answer.** Not a quota Plot enforces —
a measurement Plot reads, so a cadence can adapt before a refusal arrives.

**Only a connector has one.** Of nine adapters, exactly one reaches a remote
service: `host`, through `plot-host.sh`'s 11 `gh`/`bb`/`jen`/`jira` calls. The
other eight read git, the process table, the filesystem and a socket — free,
unmetered, answerable without an account. `refs` carries 12 operations to
`host`'s 6 precisely because nothing charges for `git rev-parse`.

**So a Budget belongs to the connector kind**, and a local adapter must never be
made to implement one. See [Ports § 2c](DESIGN-ports.md).

## 2. Identity

**`(connector, account, bucket)`** — three parts, and each is load-bearing.

| part | why | measured |
|---|---|---|
| **connector** | every connector meters differently, or not at all | `bb` 102 call sites, `gh` 59, `jen` 9, `jira` 8 |
| **account** | the limit is spent by a person, not a checkout | two GitHub checkouts on this computer, one account `jwloka` |
| **bucket** | one connector can meter several pools independently | GitHub `core` and `graphql` are 5000 each; `code_search` is 10 |

**The connector is a string the record does not validate.** `Tracker` already
names `linear`, for which Plot has no adapter, and `ci_backend()` validates
nothing at all. `Git host` is the counter-example — a closed enum that *dies* on
an unknown value — and it is the shape to avoid: **a design keyed to four
connectors breaks on the fifth**, and GitLab and Trello are next.

**The bucket keeps the connector's own word.** `X-RateLimit-Resource` says
`graphql`; a normalised vocabulary would lose the distinction between a GitHub
Actions minute quota and the API's 5000/hr, which are the same vendor on
different budgets.

## 3. The domain object

| field | meaning |
|---|---|
| `connector` | who is being asked, in its own name |
| `account` | whose credentials spent it |
| `bucket` | which pool, in the connector's word |
| `limit` | how many, where a limit exists |
| `remaining` | how many are left, where the connector says |
| `source` | `actual` or `predicted` — see § 4 |
| `measuredAt` | when, ISO-8601; a reading without one cannot be judged stale |

**`unknown` is a value, and it is not `free`.** A connector that reports nothing
records *unknown*, never a full bucket. This repo has twice shipped a collapse
of *cannot answer* into a value, and the third time is the one to prevent.

## 4. Provenance

**Two sources, and the tag is part of the answer.**

- **`actual`** — the connector has a rate-limit API or sends limit headers, and
  this is what it said. GitHub's `X-RateLimit-Limit` / `Remaining` / `Resource`.
- **`predicted`** — it has neither, so the adapter supplies a value from
  experience. Jenkins has no limit to report.

**A `predicted` value is corrected by the session that disproves it.** A refusal
observed while spending is evidence the prediction was wrong, and it updates for
the rest of the session. **This is what a static default cannot have:** a number
shipped in Plot is stale the moment a vendor changes it; a number corrected by
the refusal it caused cannot be.

**The tag is orthogonal to `PortResult`.** `answered | failed | unaskable` says
whether the question could be put; `actual | predicted` says how the answer was
come by. **A `predicted` limit is `answered`** — the adapter is not failing, it
is telling the truth about what it knows.

**The vocabulary follows `StateSource`.** `entities/identity.ts` already carries
`stated | derived | foreign | measured`, with `stateFailureMode` naming how each
goes wrong — *"`measured`: decaying instantly"*. A limit reading is the same idea
one level down: **`actual` decays; `predicted` is wrong until something proves
it.**

**The endpoint that looks authoritative is not.** Measured 2026-09-01 in a quiet
moment: `gh api rate_limit` reported `graphql 5000/5000, used 0` while a real
call's header on the same account read `Remaining 4854, Used 146`. **146 calls
spent, reported as zero.** An `actual` reading comes from the headers of a call
that was going to happen anyway; a separate question about the budget is both an
extra request and a wrong answer.

## 5. Where it lives

**On the Computer, not the Machine.** [Machine](DESIGN-machine.md) is one per
Plot instance, keyed by `repoRoot + scriptsDir`; the Computer is one, and owns
what is shared. **A rate limit is an account fact, so it is the Computer's.**

**`.plot/state/` is per checkout and cannot hold it.** Measured 2026-09-01: two
GitHub checkouts on this computer share one account, and each would read a full
5000 while the other spent it — the over-spend the record exists to prevent,
reproduced by storing it in the wrong place.

**Append-only, and therefore lock-free.** Each spender appends what it spent with
a timestamp; the rate is derived across the file. There is no read-modify-write
to interleave, so several instances may write concurrently. **The line stays
short:** concurrent `O_APPEND` is atomic only below `PIPE_BUF` (4096 bytes), so a
future field carrying a response body would break the property silently.

**A rate, not a headcount.** Deriving the cadence from observed spend counts the
operator's own terminal calls and a worker's scans, because they also append. A
count of boards would miss both — and the spenders here are eleven scripts, the
board, and a person.

## 6. Reacting to a refusal

**Two failures, two recoveries, and halving the cadence suits neither.**

| | quota spent | secondary / burst |
|---|---|---|
| exhausted | requests per hour | requests **at once** |
| recovery | the reset, minutes | seconds |
| halving the cadence | **does not help** — the bucket is empty; a slower call is refused identically | **too slow both ways** — waits far longer than needed and still bursts |
| the reaction | **stop until the reset**, and say when | **retry shortly, lower concurrency** |

**A spent bucket is not a rate problem.** Resume at the *previous* cadence: the
old rate was not the cause, so it is not the fix.

**A secondary limit is a concurrency problem wearing a rate costume.** Halving
each spender's frequency leaves the same number in flight.

**The cadence divides on observed spend and never on a refusal.** Division is
proactive and derived from the record; reacting to an error by also halving would
compound with it and drift the cadence down with nothing to restore it.

**What a refusal updates is the prediction** (§ 4), not the cadence.

## 7. Relations

```
Computer ──owns──►  Budget  ◄──reads/appends── Connector (an Adapter)
                      ▲
                      └── the cadence divides by the rate it observes
```

**The port names no budget.** `Host` asks six questions and mentions no
transport, no account and no bucket — which is what lets a connector hide all
three, and what makes adding GitLab an adapter change rather than a domain
change.

## 8. What it is not

**Not a quota enforcer.** It is a shared measurement that lets a cadence adapt.
Refusing a call the connector would have answered is a worse failure than making
it.

**Not a spender registry.** Nothing counts boards. A lease file with heartbeats
would bring a liveness protocol and stale-entry reaping — the class of problem
the orphaned-server work has been through twice.

**Not a transport router.** Whether a question goes REST or GraphQL is the
connector's private business. REST-versus-GraphQL is a **GitHub** distinction;
lifting it above the adapters would make every future connector implement a fork
that exists for one vendor.

**Not a hard-coded cap.** *"Eight workers against a cap of seven"* cites one
incident twice (`plot-host.sh:242`, `:514`) and has no independent source —
**eight failed; seven is the inference.** A concurrency bound starts as a
`predicted` value and is corrected by the refusals it causes.
