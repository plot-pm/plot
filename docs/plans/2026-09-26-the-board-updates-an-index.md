# The board updates an index

> The client replaces its whole fleet with every payload, so a row absent from one arrival is erased from the screen. The scan takes 18 s and the poll is 4 s, so a partial arrival is the ordinary case — and the server already says `complete: false` when it sends one. Measured 2026-09-26: two live agents' slices were missing from the board while WORKING showed both agents.

## Status

- **State:** Rejected
- **Type:** bug
- **Review:** pr
- **Impl:** own branches
- **Issue:** #1008 (carried by `a-decision-reads-the-index`)
- **Sprint:** a-refusal-names-what-it-cannot-see
- **Rounds:** 1

## Superseded

**Closed 2026-09-26. `a-decision-reads-the-index` carries #1008 forward** — same principle, correct mechanism. This file stays as the record of a refuted explanation, so nobody re-derives it.

**The symptom is still open.** Two live agents' slices were absent from the board while WORKING showed both agents. That measurement stands and no juror explained it.

## Why this was rejected

**Rejected 2026-09-26 after a five-lens panel: 1 reject, 4 amend, and three of the four amends found what the reject found.**

**The premise is false.** `fleet.ts:3242`'s `publishPartial` already composes a partial scan over the previous answer, shipped in PR #242 four months before this plan was written — *"Plans this scan has spoken about win; plans it has not reached yet stay as they were."* `setFleet` does replace the fleet, but what it replaces with is already accumulated. A client-side index would be a second accumulator over an already-accumulated stream.

**Two supporting claims are also false.** `complete` has a client reader at `AgentList.tsx:2206`, contradicting this plan's flat statement that it has none. And the cost table counted `grep -c plot-host.sh` matches rather than call sites: 15 against 6 measured for the fleet scan, 15 against 2 for reconcile, 7 against 4 for impl-status — most matches are comments and operator-advice strings, and the surviving calls are already bundled.

**The justification was obsolete when it was written.** The ~37 s rollup figure is the pre-fix number from #1005's own commit message. #1005 merged 2026-09-26 12:08, about four hours before this plan cited it as live evidence.

**The symptom remains unexplained.** Two live agents' slices were absent from the board while WORKING showed both agents. That measurement stands; this plan's explanation of it does not, and no juror supplied another. Reproducing it against a board that already accumulates is where a replacement starts.

**Four findings survive any redesign**, recorded in `.plot/panels/2026-09-26-the-board-updates-an-index/panel.md`: `branch` is not a unique key across plans; git cannot invalidate a `localDirty` entry; an action's 202 is narrower than this plan assumed; and slices 1 and 2 could not have landed independently.

**The panel's own blind spot is worth keeping too.** Four of five jurors read and did not run. The one that executed is the one that overturned the justification.

## Changelog

- The board accumulates what it receives into an index and renders the index — from the heartbeat and from every action's own answer. A row the latest answer did not mention keeps what was last known about it, instead of disappearing until a later pass happens to include it, and a dispatched row moves when the dispatch returns rather than when a scan rediscovers it.

Board impact: **entirely board, and entirely client-side.** No scan change, no domain rule, no new server field — the payload already carries everything this needs.

## Motivation

**Received data should land in an index, and the board should render the index.** It does neither. `App.tsx:283` is the only `setFleet` call site and it replaces the whole fleet with whatever arrived, so the rendered set is exactly the last payload's `rows` array. There is nowhere that *what is known* is distinct from *what just arrived*.

### The server already answers partially, on purpose

`fleet.ts:898`:

> A scan takes 18 s on 84 branches, so for most of that window the answer is genuinely partial — which is a fact about the answer, not a defect in it.

And it says so, in a field added for exactly this:

> `claimed: 0` and "no pulse yet" must not render identically, and neither must **"no plans left" and "the rest have not arrived"**.

**Scan 18 s against a 4 s poll**, so a poll landing mid-scan is the ordinary case rather than an edge. The field reaches the client as `complete` on every payload, beside `ageSeconds`, `generatedAt` and `readRef`.

**It has zero readers in `packages/board/src/app/`.** The server states the answer is incomplete; the client renders it as whole.

### What it produced, measured 2026-09-26

Two agents were working. The board showed **both agents in WORKING** and **neither of their slices** — WAITING ON A MACHINE held one row, NOT STARTED read `none`. Both rows returned on a later poll.

```
free-ebbb37c6  bug/a-wave-says-which-question-it-answered   pid 99861  live
free-83d3325b  feature/the-board-filters-to-my-work         pid 34787  live
```

### The outage was not the cause, and the first reading of this said it was

A *"Not reaching the board server"* banner was on screen, so the connection looked responsible. It was not: nothing on the failure path removes a row. `App.tsx:290`:

> The fetch did not reach the server. **Keep the last good fleet on screen** — it is still the best information available, and blanking it would destroy what the reader came for.

`setFleet` is never called on failure. **A partial payload landed, then the fetches began failing, and the failure path faithfully preserved the partial view.** The banner froze a screen that was already missing rows, which is why the outage appeared to cause what it had only kept.

**This matters beyond the diagnosis**: the failure path is already correct. It keeps what it has. The defect is that what it has was destroyed one poll earlier, by a successful response.

### It is a third route to a wrong section

Section selection is a domain property and holds at any time. Three independent routes broke it, and this is the one no rule fix reaches:

| route | where | state |
|---|---|---|
| `branch-state.ts:264` classifies wrongly | domain | plan written (#1002) |
| a stale scan re-derives sections | server | shipped (#999) |
| **classified correctly, never rendered** | **client** | **this plan** |

## Design

### The rule

**The board updates an index from each heartbeat; the client renders the index.**

A payload is an *update*, not a *replacement*. Each arriving row is merged into the index by branch; a row the payload does not mention keeps what the index already held.

`branch` is the key — present on every row, stable across passes, and how the estate identifies a slice everywhere else.

### Every tool call updates the index

**An action's own answer is a reading, and it is the freshest one there is.** A dispatch that returned 202 for a slug knows something no poll has yet observed; a deliver that succeeded knows the plan moved. Today each of those answers is discarded and the board waits for a scan to rediscover it.

`StartWorkButton.tsx:282` states the current behaviour exactly:

> Stay `starting` on success — the spinner runs until the pulse confirms the row moved (idle) or the wait elapses (dispatched). **Nothing to store.**

There is nowhere to store it. Without an index there is no *what we know* — only *what the last poll said* — so an action result has no home, and the row spins for up to a full scan while the board re-learns a fact it was handed.

**So every tool call writes its outcome into the index**, and the poll afterwards confirms rather than reveals. **Twelve POST sites across ten endpoints** reach the client today — `approve`, `commission`, `continue`, `deliver`, `dispatch`, `fleet-controls`, `idea`, `implement`, `reslice`, `story` — and each learns something about a row it currently throws away.

**This is the same defect as the partial payload, from the other side.** Both are a fact arriving with nowhere to be kept. That is why they belong in one plan: the index is the missing place, and adding it for one and not the other would leave half the board still guessing from polls.

**An action writes what it was told and never what it assumes.** A 202 from `dispatch` says the dispatch was accepted, not that a worker is running — so the index records acceptance, and the state a worker reaches is still the scan's to report. An action that refuses writes nothing: the refusal is already rendered beside the button, and a refusal is not a reading about the row.

### The index serves every consumer, not only the render

**A tool call is expensive whether the data is remote or local, so its result must be available to everything that needs it.** Four consumers ask the host the same questions independently today:

| consumer | asks for | call sites |
|---|---|---|
| `plot-fleet-scan.sh` | `pr-state`, `pr-list` | 15 |
| `plot-reconcile-scan.sh` | `pr-state`, `issue-list` | 15 |
| `plot-impl-status.sh` | `pr-state`, `pr-list` | 7 |
| the supervisor's queue rule | `landed` — *"the host's `mergedAt`"* (`queue.ts:51`) | via readings |

The rollup alone was measured at ~37 s of a ~55 s scan, and that is **one** consumer's share of one question. Nothing shares an answer with anything else.

**So the index is not a render cache.** It is where a paid-for answer lands so that the fleet, the registry, the supervisor and the board all read one copy. A render-only index would fix the vanishing rows and leave the cost exactly where it is.

### This must not become the record the estate already refused

`fleet.ts:2173` states the rule this plan has to satisfy rather than talk past:

> **A DERIVATION, NEVER A RECORD.** Every input is this pass's own … A persisted verdict would be a cache git cannot reach, which is precisely what the plan rejects.

**The distinction that makes this admissible is between a verdict and an answer.** A verdict is derived — re-derivable from git for free, and stale the moment a ref moves. A host answer is *bought* — it cannot be re-derived at any price, and no git operation can reproduce it.

**The estate already caches host answers on exactly these terms.** `PLOT_TERMINAL_CACHE` holds terminal PR states across passes, and `plot-fleet-scan.sh:1234` says why it is safe:

> **THE VALIDATION IS THE FEATURE.** Every arm here is a question to git, asked on every pass, and any disagreement discards the entry rather than repairing it.

Each entry is keyed by the plan's blob hash and the default branch's tip; either having moved makes it *"a fact about a repo that no longer exists"* and the entry is dropped. And *"only a decided answer is terminal"* — an unanswerable question is never stored, so one unreachable afternoon cannot freeze into every later pass.

**This index adopts those three properties and stores nothing else:**

- an entry records **what the host said**, never what a rule concluded from it;
- every entry carries what it was read against, and is revalidated against git on every pass;
- an answer that could not be obtained is not an entry — absence stays absence.

A cache revalidated against git on every read is still a derivation. Only an unvalidated one is a record.

### When absence means removal

**A row's absence is evidence only when the answer claims to be whole.** `complete: true` means the scan reached its terminal line, so a branch the index holds and the payload omits is genuinely gone — reap it from the index. `complete: false` means the rest has not arrived, and absence says nothing at all.

That is the same distinction `pulseComplete` was added to preserve on the server, carried one layer further instead of being dropped at the boundary.

### A held row says what it is

A row carried from an earlier pass is not the same claim as a row just measured, and the board must not present them identically — the failure this repo has measured repeatedly. The payload already carries `generatedAt` and `ageSeconds`; an index entry keeps the one it was last updated by, so a held row can show its own age rather than the fleet's.

**It keeps its section.** It was classified correctly when it was measured, and nothing since has said otherwise — re-deriving would be the mistake `a-stale-pulse-keeps-the-sections-it-had` already settled.

### What this does NOT do

- **It adds no server field and changes no scan.** `complete`, `generatedAt`, `ageSeconds` and `readRef` are all already on the wire. A plan that needed a new field would be evidence the diagnosis was wrong.
- **It does not change the failure path.** Keeping the last good fleet on an unreachable server is correct and stays exactly as it is.
- **It does not re-derive a section client-side.** The index stores what the server decided; it never recomputes it. A component deciding a row's section is what CLAUDE.md forbids.
- **It does not touch `/api/board`.** That endpoint polls at 30 s and carries artifacts, which move in days. The partial-answer problem is the fleet's.
- **It does not put the shared index behind HTTP.** A script asking a running board would gain a dependency on the board being up — the failure `plot-ask.mjs` exists to avoid, and seven skills would fail on a machine with no board. How a shell consumer reaches the index is the third slice's question and it is open.
- **It does not make the index survive a reload.** Nothing is persisted; the index is in memory and a reload starts cold, which is honest — a cold board already renders nothing rather than guessing.

## Done when

- A payload with `complete: false` that omits a known row leaves that row on screen, in its section.
- A payload with `complete: true` that omits a known row removes it.
- A held row is distinguishable from a freshly measured one, by its own age.
- The failure path still keeps the last good fleet, unchanged.
- A successful action writes its outcome to the index and the row moves without waiting for a poll.
- A refused action writes nothing to the index.
- A test drives two successive payloads — a complete one, then a partial one omitting half its rows — and asserts nothing vanished.

## Slices

Three slices. The first is the structure, the second writes into it, and the third — deliberately unspecified — opens it to the consumers that are paying for the same answers today.

### The board updates an index (Branch: `bug/the-board-updates-an-index`)

The index, the merge keyed by branch, the `complete`-gated removal, the held-row age, and the two-payload test above. No action endpoint changes here, so the accumulation can be proved before anything writes to it.

### Every tool call updates the index (Branch: `bug/every-tool-call-updates-the-index`)

The twelve POST sites write their outcomes into the index on success. Each writes what the endpoint reported and nothing it did not; a refusal writes nothing. A test asserts a dispatched row moves on the action's own answer, with no poll in between.

### The index serves the other consumers (Branch: `bug/the-index-serves-its-consumers`)

**The open slice, and it is deliberately last.** The two above are client-side and self-contained; this one crosses into the scan, the reconcile sweep and the supervisor, and it has a question neither of them has: **how does a shell script read the index without depending on a running board?**

`plot-ask.mjs` is the precedent — the controller reached without HTTP, built because *"a board is optional and none was running when the choice was measured; seven skills would have gained a dependency whose failure arrives as a skill that works on the operator's machine and not in a worker's."* The same argument applies here and the same answer may not: an index is state, and `plot-ask.mjs` answers questions.

**This slice is not specified.** It states the problem and the constraint; the shape is for whoever takes it, after the first two have proved the index itself.

## Notes

The first reading of this blamed the client-side outage and was published on #1008 before being refuted by `App.tsx:290`. The correction is on the issue. What made the difference was checking the poll interval — 4 s against a banner reading *"last heard 6s ago"* — which ruled out the rows never having been received and forced the question of what a successful response had done.
