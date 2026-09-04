# Manual test list — 2.13.0

Derived from the 165 changesets awaiting this release. **This lists only what the
automated suites cannot decide**, because the suites already ran green on the
release candidate:

| suite | result |
|---|---|
| board vitest | **2806 pass / 151 files** |
| `@plot-pm/domain` | **1511 pass / 74 files** |
| `test/reconcile` | **1161 pass / 56 files** |
| `test/e2e` | 11 files, CI's gate |

So a changeset whose claim is *"the rule returns X"* or *"the parser reads a
`## Slices` heading"* is **not** in this list — a test decided it. What is here
is the four kinds of claim a test cannot settle:

1. **What a reader perceives.** *"A section's membership is true"* is a claim
   about a person. Every assertion behind it can pass while the screen misleads
   — this release contains two defects of exactly that shape, both found by
   looking (`quiet-holds-one-kind-of-row`, and the closed-PR note fixed on
   09-04).
2. **Cost.** *"The read route stops spawning"* is true or false by measurement.
   Ten changesets in this release are performance claims.
3. **What needs a real host.** Rate limits, GraphQL refusing for burst, a REST
   fallback under pressure. Thirteen changesets touch this.
4. **Whether a refusal is actionable.** Every gate here fails closed. Whether
   the message tells a person what to do next is not something an exit code
   knows.

**This release is held.** The sprint's note *No release until the domain is
real* holds 2.13.0 until production calls the domain rather than holding its own
copy. This list does not lift that hold — see §6.

---

## 1 — Look at the board and decide (∼30 changesets)

Start it on a repo with a real estate: `pnpm board`, then the **Agents** tab.

- [ ] **Every section's membership is true of every row in it.** Take one row per
      section and say the claim out loud: WAITING ON YOU *a person owes
      something*; WORKING *an agent is on it now*; WAITING ON A MACHINE *nothing
      owed, a machine is running*; NOT STARTED *approved, nobody took it*; QUIET
      *nobody is on it and nobody need be*; DONE *it shipped, or it was decided
      against*.
- [ ] **For every row in WAITING ON YOU, say what you owe it.** A row you cannot
      answer that for is the defect this section exists to catch. Measured
      2026-09-04: the section held 35 rows, **3** of them work anyone was waiting
      on (`quiet-holds-one-kind-of-row`).
- [ ] **QUIET and DONE are not interchangeable.** Quiet reads as *go and look*;
      DONE means there is nothing to look at. A merged branch and a closed PR
      both belong in DONE — merged work shipped, a closed PR is a decision
      somebody already took.
- [ ] **The note agrees with the status word.** A row labelled `closed` must not
      say *"no PR ever opened"*; a merged row must not say *"nobody is on it"*; a
      row linking `#NNN` must not claim no PR exists. Measured 2026-09-04:
      fifteen rows failed this, the label right and the sentence written for a
      different kind.
- [ ] **A blocked agent's question is readable from the board**, not only from
      the marker file (`the-agent-monitor-reads-the-desk`).
- [ ] **The Stories tab reads as the strategic layer** — status grouping,
      story → plan navigation, drift visible when a story says `active` and every
      plan released.
- [ ] **A degraded view says so at the top**, and an unavailable capability with
      an empty reason reads as an absence rather than a refusal
      (`plot-ask.mjs`'s transport fields).

## 2 — Click the things that write (∼12 changesets)

Every one of these performs a host or filesystem write. Do them on a scratch
clone, never the live estate.

- [ ] **Create plan from a ticket** — the board's *Create plan* action fetches
      one issue body per click and writes a draft plan. Confirm the draft
      appears (`plot-host.sh issue-view`).
- [ ] **A refused dispatch asks for a brief** and leaves **nothing** behind — no
      desk, no ref, the slice still queued. The refusal names the **ref** the
      agent will read, not a local path.
- [ ] **`--no-brief` hands over and says so**, keeping the override on the
      record.
- [ ] **A dispatched agent creates or resets its own desk**, and the desk carries
      `.metadata_never_index` — dispatch cuts none.
- [ ] **The reaper sweeps three more kinds of leftover** and refuses on each of
      its five measurements (`plot-reap.sh`).
- [ ] **A plan delivers only when every non-deferred slice merged**, and the
      index symlink moves with it.

## 3 — Measure, do not assert (∼10 changesets)

- [ ] **The read route stops spawning.** `/api/board` reads git through the
      `Refs` port rather than spawning on the event loop. Measure the response
      time under load; the claim is about cost, not correctness.
- [ ] **The board serves while it scans.** Check `uptime` **first** — a load
      average above ~20 makes the 250 ms assertion meaningless, and that is a
      known false failure rather than a regression.
- [ ] **The pulse ladder holds.** One clock, subscribers by divisor, every
      remainder zero (`a-subscriber-names-its-divisor`).
- [ ] **The terminal-state cache saves the host round trip and nothing else.**
      Git is re-consulted every pass; confirm the entry is discarded the moment
      it disagrees.
- [ ] **`plot-release-refs.sh` pays for itself.** Measured 2026-08-27: deleting
      nine merged branches took the scan **218.5 s → 111.5 s**.

## 4 — Needs a real host under pressure (13 changesets)

None of this can be mocked into truth; it needs a live `gh` and a real limit.

- [ ] **`pr-state` falls through to REST when GraphQL refuses for rate.** Provoke
      it, then confirm the answer is the same through both paths.
- [ ] **A secondary limit is not a spent quota.** Both buckets can read 5000/5000
      while mutations are refused — confirm the board says which it hit
      (`a-secondary-limit-is-not-a-spent-quota`). Reproduced 2026-09-04.
- [ ] **An unreachable host answers *not merged*.** Silence is never permission:
      confirm `plot-pr-merged.sh` refuses rather than assuming.
- [ ] **A throttled scan says so** instead of reporting every branch unmerged.
- [ ] **The connector records what a call spent**, and only the connector — no
      filesystem adapter implements a rate-limit contract.

## 5 — Refusals are actionable (∼8 changesets)

Trigger each and read the message. Ask only: **would somebody who has not read
the source know what to do next?**

- [ ] `plot-deliver.sh` on a Draft plan, and on a plan with an unmerged slice.
- [ ] `plot-dispatch.sh` on a branch whose `waits:` prerequisite has not merged
      — it must name the prerequisite.
- [ ] `./scripts/check-changeset-packages.sh` on a changeset with a `bumps:`
      block first and no description. Measured 2026-08-30: **19 of 169**
      published entries, 11%, printed a bare comment marker as their description.
- [ ] `./scripts/check-ancestry-decisions.sh` on an undeclared ancestry call.
- [ ] The phase-gate hook on an implementation commit under a Draft plan — and
      confirm that when `origin/<main>` is unreadable it **allows the commit and
      says the phase went unverified**.

## 6 — The release gate (do not lift it here)

```bash
bash skills/plot/scripts/plot-sprint-release.sh
```

- [ ] **Read the JSON, not the checkboxes.** The plan estate outranks the box in
      one direction only: a checked box over an undelivered plan is `disputed`;
      an unchecked box over a delivered one is `done`, because `/plot-deliver`
      moves the plan and nobody re-ticks the box.
- [ ] **Every `disputed` item is genuinely unfinished.** A `disputed` that is
      actually done means the sprint and the plan estate disagree, and the sprint
      is the one that is wrong.
- [ ] **The sprint's three conditions hold** — *replaced*, *fully covered*,
      *expressed as domain concepts*. The third is the one the sprint calls easy
      to fake: relocating `allWavesMerged` is not the same as making it
      `allSlicesMerged`, a rule about a **Slice**.

**The hold is the operator's to lift.** Nothing in this list cuts the release.

## 7 — Full lifecycle walkthrough (the skills)

The skills have no unit tests; a lifecycle run is their only validation. Follow
[fleet-user-test.md](fleet-user-test.md) for dispatch, the fleet pulse and the
merge queue, then confirm:

- [ ] A plan written from the template carries `## Slices`, and
      `plot-plan-meta.sh` reads it.
- [ ] `/plot-idea` → `/plot-approve` → `/plot-implement` → `/plot-deliver` on one
      small plan, end to end.
- [ ] An agent that finds its slice already done writes a `PLOT-BLOCKED` marker
      and asks, instead of writing duplicate code. Two branches in this release
      did exactly that.

## What this list deliberately omits

- **Anything a test already decides.** 5478 automated assertions pass on this
  candidate; re-checking them by hand would find nothing and cost an evening.
- **`pnpm run test:e2e`.** CI's gate, not a local one — it dispatches real
  workers into sandbox repositories. Measured 2026-08-31: two agents running it
  produced **53 concurrent `node --test` processes** and a board that could not
  answer a request in 25 seconds.
- **Re-reading the 182 migrated plan headings.** They were renamed to
  `## Slices` on 2026-09-04 by a script that parses each plan before and after
  and reverts it unless the two are byte-identical, so the estate proved itself
  file by file. What is worth a look instead is §7's first item: a plan written
  from the template today, parsed end to end.
- **The known apt-mirror flake** in *Install Playwright browser*. It stalls
  against a deliberate 3-minute bound and is not a code defect; re-run it.
