Position: reject
Evidence: executed

# The board already resolves a slice row's PR by head. The plan proposes what shipped.

## 1. The mechanism the plan proposes is the mechanism on `main`

The plan's Design says:

> **A slice row resolves its PR by head branch, and the annotation is a confirmation rather than the source.**

That is `fleet.ts:6440-6441`, inside the slice loop (`for (const wave of plan.slices) { for (const b of wave.branches)` — `fleet.ts:6410-6411`):

```ts
const held = prsByHeadMap?.get(b.branch) ?? null;
const linked = held && held.state === 'CLOSED' ? pr : (held ?? pr);
```

and `fleet.ts:6675`, which is the slice row's `pr` field:

```ts
pr: linked ? agentPr(linked) : null,
```

`prsByHeadMap` is `entry.prsByHead` (`fleet.ts:7715`), which is `byHead` (`fleet.ts:2700`, `fleet.ts:3019`) — the map the plan cites at `:2674` as the fact it wants used. **It is already the source, and it is asked FIRST**: `held ?? pr`, not `pr ?? held`.

**The plan's own citation is the answer.** It cites `fleet.ts:2651`/`:2674` as evidence the fact exists unconsumed. Four lines below `:2674` is `return { prs, byNumber, byHead }` → `applyPrMaps` → `entry.prsByHead` → the parameter → the row. The distance from the cited line to the shipped fix is under fifty lines.

## 2. The annotation is not read by this path at all — so there is nothing to "change the direction" of

The plan's Design section argues a precedence order: *"Where they disagree the **annotation** wins."* That precedence does not exist to be preserved, because **the plan annotation never reaches a slice row's `pr` field.**

Measured:

```
$ grep -n '"pr"\|pr=' skills/plot/scripts/plot-fleet-scan.sh | grep -i "json\|printf\|branch"
(no output)
```

The scan emits no per-branch PR number. The pulse branch schema carries none. Every `agentPr(...)` call site in `fleet.ts` — lines 6675, 7033, 7339 — takes a `PrRecord` from the host maps (`prs`, `prsByHead`, `byNumber`). **None reads `plan.prs`.**

So the plan's central Design decision — *the annotation wins where they disagree* — would be a **new** coupling from plan text into the row's PR field. It is not a preservation of current behaviour; it is the opposite direction from the shipped design, whose comment at `fleet.ts:6666-6674` states the rule explicitly:

> **FROM THE LINK MAP, falling back to the open one.**

## 3. The discriminating live test: the symptom does not reproduce, and the board renders the PR

Live estate, `GET localhost:7777/api/fleet`, `readRef: 65d4ee35`.

**The case the plan describes** — a slice whose plan on the read ref carries **no `→ #N`**, whose branch has an **open PR**:

```
$ git show origin/main:docs/plans/2026-09-28-a-row-is-owned-by-more-than-its-pr.md | grep -c "→ #"
0

$ gh pr view 1060 --json number,state,headRefName
PR 1060 state=OPEN head=bug/a-row-is-owned-by-more-than-its-pr draft=false
```

Zero `→ #N` annotations on the read ref. Open PR on the head. What the board renders for that row:

```json
{
 "number": 1060,
 "url": "https://github.com/plot-pm/plot/pull/1060",
 "draft": false,
 "state": "unknown",
 "author": "jwloka"
}
note: PR #1060, cannot say whether it merges
wave: A row is owned by more than its PR
```

**The board shows the PR, its number, its URL and its author, with no `→ #N` on the read ref.** This is the plan's "Done when" first bullet, passing on `main` today.

The three unannotated slices that DO render `pr: null` — `a-slice-row-finds-its-pr-by-head`, `a-state-sweep-is-one-request`, `a-sprint-item-names-a-plan-or-says-it-has-none` — each have **no open PR** (`gh pr list --state open` returns only #1064, #1060, #1047). `pr: null` is correct for all three. **There is no row on this estate whose PR the board is hiding.**

## 4. The two halves of the reported symptom have different causes, and the plan conflates them

The report says the row renders `(unnamed)` **and** no link. The plan treats these as one defect with one fix. They are not:

- **The link** comes from `prsByHeadMap` — host-derived, keyed by head, annotation-free. Shipped and working (§1, §3).
- **`(unnamed)`** is `UNNAMED_SLICE` (`schema.ts:1429`), the slice's **name**, and `schema.ts:1687-1688` states its rule: *"The unnamed form is the FALLBACK... a plan with no `###` sub-headings has an unnamed slice and this is all that can honestly be said."* That is the **slice heading** missing from the read ref — a plan-text fact with no host answer at all. **`byHead` cannot supply a slice name.**

The plan's last Done-when bullet half-notices this — *"The name and the link are two facts and the PR says whether both are fixed or only the link"* — but the Design proposes only the `byHead` resolution, which is already done and which can only ever address the link. **The half of the symptom that is real is the half the plan's mechanism cannot touch.**

## 5. The cited precedent is different in kind

The plan argues: *"`plot-impl-status.sh` already resolves un-annotated branches by head, which is the same derivation this asks the board to make."*

That script reads the plan's `## Branches` section from `origin/<default>` and resolves per BRANCH (`plot-impl-status.sh:58-61`). It is a **shell script asking the host for a plan's branches**, on the operator's clock, for `/plot-deliver`'s gate. The board's row path is a render loop over a host map already in memory. The precedent supports the *direction* and the board **already went further** than the precedent — so citing it as a gap is citing a debt already paid.

## 6. Why the Bitbucket estate saw it, and what the real plan would be

The report is from Plot 2.21.0 on Bitbucket with `Main branch: develop`. The board's fallback is host-agnostic in code, but three things differ there and none is the annotation:

- `state: "unknown"` in the live payload above shows this estate's own PR state answers are already degraded; `prUnknown` has its own handling (`fleet.test.ts:4708-4719`).
- Bitbucket's refresh cadence is 4× GitHub's (`prRefreshMsFor('bitbucket')` → `4 * PERIOD`, `fleet.test.ts:4740`), so `byHead` is colder there.
- A cold Bitbucket board buying the whole list is an *existing plan on this estate* (`2026-09-28-a-cold-bitbucket-board-buys-the-whole-list`, PR #1061, merged).

**A plan worth writing here would start from the Bitbucket payload** — was `prsByHead` populated at all when the row rendered? — rather than from a mechanism that has shipped.

## Against my own position

Three arguments for `amend` rather than `reject`, and why each falls short:

**1. I could not reproduce on the reporting estate.** My live test is GitHub/`main`; the report is Bitbucket/`develop`. A host-specific failure to populate `byHead` would produce exactly the reported symptom, and my §3 would miss it. **But that strengthens reject rather than weakening it**: if `byHead` is empty on that estate, the plan's fix — read `byHead` — cannot work either. The plan's mechanism is presupposed by its own failure mode.

**2. `(unnamed)` is a real defect and this plan is the only one filed against it.** Rejecting leaves a genuine symptom unowned. That is the strongest case against me. But the plan's Design proposes nothing that addresses the name, and its Done-when defers the question to the PR body. A plan whose stated mechanism is already built and whose one live question is out of scope should be rewritten around the name, not amended around the link.

**3. My `state: "unknown"` reading might mean the fallback is degraded, not working.** Fair — but `number`, `url`, `draft` and `author` all came through from `byHead` with no annotation. The identity resolved; only the merge-state did not, and that is `prUnknown`'s separate, tested concern.

**What would change my position:** a `/api/fleet` payload from the reporting Bitbucket estate showing a row with `pr: null` whose head carries an open PR **and** whose `prsByHead` was populated for other branches in the same response. That would show a real gap in this exact path. Nothing in the plan cites such a payload — the plan's evidence is the source line, and the source line disagrees with it.
