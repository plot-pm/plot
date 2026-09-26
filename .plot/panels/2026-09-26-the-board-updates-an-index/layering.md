# Layering lens — the board updates an index

## 1. The index already exists, and it is on the server

The plan's central claim is that there is nowhere *what is known* is distinct from *what just arrived* (line 23). That is false at the layer the plan never looked at.

`packages/board/src/server/fleet.ts:3226` holds the previous scan's plans for exactly as long as the current scan is partial, and `:3241-3243` composes them:

```
const publishPartial = (): void => {
  const spoken = new Set(arrived.map((p) => p.file));
  const plans = [...previous.filter((p) => !spoken.has(p.file)), ...arrived];
```

Its own docstring at `:3230-3233` states the plan's motivation almost verbatim: *"at line one the tab would otherwise drop 23 of 24 plans and grow them back, which reads as the board losing the fleet rather than refreshing it. Plans this scan has spoken about win; plans it has not reached yet stay as they were."*

**This is the merge-by-key the plan proposes**, keyed by `p.file` instead of `branch`, one layer inward. `mergePlan` (`:1180-1186`) is the per-entry upsert. `entry.sections` (`:7681-7683`) is a *second* index — the remembered section map, carried across passes and consulted on failure at `:7667`.

So the estate has already answered *who owns the index*: the server does. A plan that adds a second index in the client, keyed differently (`branch` vs `file`), against a payload the server composed from its own index, creates two accumulators over one fact with no test that they agree. That is the shape the estate calls drift, and CLAUDE.md's *"A Shell Script Asks The Domain"* section is explicit that duplication is allowed only when *declared* and held by a corpus test.

## 2. "Zero readers in `packages/board/src/app/`" is false

Plan line 37: *"**It has zero readers in `packages/board/src/app/`.** The server states the answer is incomplete; the client renders it as whole."*

`packages/board/src/app/components/AgentList.tsx:2206`:

```
{!fleet.complete && ' so far'} · scanned{' '}
```

The client reads `fleet.complete` and qualifies the summary with it. The surrounding comment at `:2195-2205` reasons about exactly the plan's scenario — *"The scan takes 18 s on 84 branches against a 5 s cadence, so this window is most of the time"* — and makes a deliberate, argued choice the plan contradicts without engaging:

> *"The rows themselves are NOT qualified: each one is fully derived from its plan and its refs, and is exactly as true now as it will be when the scan ends. Only the TOTAL is provisional, so only the total says so."*

The plan must either rebut that reasoning or state why the rows-vs-totals split no longer holds. It does neither, because it believes the field is unread. **A plan's diagnosis resting on "nobody reads this" must be corrected when somebody does.**

## 3. The diagnosis points at the wrong layer — and the real one is reachable

Both server accumulators are keyed on the plan file; rows are then derived from plans. Two candidate mechanisms survive that the plan never considers, and both sit server-side:

- **`previous` is seeded once, at scan start** (`:3226`, `entry.pulse?.plans ?? []`) — and `entry.pulse` may itself already be a *partial* composition from the preceding scan. Consecutive partial scans therefore compose partial over partial; nothing re-seeds from the last *complete* answer, which is captured separately as `before` at `:3144` and used only for `pulseShrink`.
- **A plan that arrives with fewer branches than it had** is overwritten wholesale by `mergePlan` (`:1184`, `next[at] = plan`). The carry-forward protects a plan the scan has not *reached*; it protects nothing inside a plan the scan has spoken about. Two agents' slices vanishing while both agents render in WORKING — WORKING reads `fleet.agents`, not rows — is precisely that signature.

The second is consistent with the measured symptom in a way the client-replacement story is not. **A client index would paper over it**: the rows would be held from an earlier payload while the server kept emitting the truncated plan, and the defect would become invisible rather than fixed. That is fixing a neighbouring problem.

## 4. Through the layering lens specifically

- **Slice 1 puts new state in the component layer.** CLAUDE.md `:439-444`: every rendered state is a domain property, and the measurable form is that *"a view state that cannot be asserted without a browser is a domain property that has not been extracted yet."* An accumulated index in `App.tsx` is state whose merge rule, `complete`-gated eviction and held-row age are all only assertable by driving two payloads through a mounted client. The plan's own "Done when" (line 160) describes exactly such a test. The merge rule is a domain rule and belongs in `packages/domain` or, at minimum, in a pure module the server already has.

- **Slice 2 is the sharper violation.** *"Every tool call writes its outcome into the index"* (line 88) across twelve POST sites makes each call site decide what a 202 means for a row's state. The plan tries to fence this with *"an action writes what it was told and never what it assumes"* (line 92) — but *which row field a 202 updates* is a decision, made in twelve places, in the client. That is a lifecycle transition decided outside the domain. Compare CLAUDE.md's "The Master Agent Uses The Controllers": the estate's settled position is that the controller's answer is the transition, not the caller's reading of it.

- **Slice 3 contradicts slices 1 and 2.** Line 107: *"the index is not a render cache. It is where a paid-for answer lands so that the fleet, the registry, the supervisor and the board all read one copy."* An index serving `plot-fleet-scan.sh`, `plot-reconcile-scan.sh`, `plot-impl-status.sh` and the supervisor cannot live in React memory — the plan concedes this at line 150 (*"the index is in memory and a reload starts cold"*). **The plan therefore specifies an index in the one place its own stated purpose forbids**, and defers the contradiction to an unspecified third slice. Building slices 1 and 2 as written guarantees slice 3 rewrites them.

- **The `plot-ask.mjs` precedent does not transfer, and the plan half-says so.** Line 178 notes *"an index is state, and `plot-ask.mjs` answers questions."* That is the whole difficulty, and it is the layering question: a cross-consumer index needs an owner and a store. `PLOT_TERMINAL_CACHE` (`:3288`, `:3307`) is the estate's existing answer for a bought host answer — passed as env into the scan, re-validated against git every pass, replaced wholesale rather than merged because *"an entry no scan re-derived would survive on nothing but its own age."* The plan cites this cache approvingly at line 117 but does not notice it already occupies the niche slice 3 describes.

## 5. What the plan must say before anyone builds it

- Why `fleet.ts:3241`'s composition is insufficient, with the mechanism by which a row is lost *despite* it. Until that is stated, slice 1 is a second index over a working first one.
- Which layer owns the index. If the answer is "the server, extending `publishPartial`", slices 1 and 2 collapse into a much smaller change and slice 3 stops contradicting them.
- A rebuttal to `AgentList.tsx:2195-2205`'s rows-vs-totals argument, now that `fleet.complete` is known to have a reader.
- Where the merge rule and the `complete`-gated eviction are unit-tested without a browser.
- Whether the two keys (`file` server-side, `branch` client-side) are declared duplicates with a test that they agree, or one key.

## Verdict

The symptom is real and worth fixing. The diagnosis stops one layer short, rests on one verifiably false claim, and places new cross-cutting state in the component layer the estate's settled rules reserve for rendering. Amend: re-diagnose against `fleet.ts:3226-3256`, and site the index where its own third slice already says it has to live.

Position: amend
