# Panel — a slice row finds its PR by head (#1057)

Subject: `docs/plans/2026-09-29-a-slice-row-finds-its-pr-by-head.md`
Round 1, 2026-09-29. One juror, both commitments gated.

| Juror | Position | Evidence |
|---|---|---|
| evidence | **reject** | executed |

**REJECT. The mechanism is on `main`, and the plan's own citation is the answer.**

## The fix exists, fifty lines from the evidence the plan cited

`fleet.ts:6440-6441`, inside the slice loop:

```ts
const held = prsByHeadMap?.get(b.branch) ?? null;
const linked = held && held.state === 'CLOSED' ? pr : (held ?? pr);
```

`fleet.ts:6675` is the row's `pr` field. `prsByHeadMap` is `entry.prsByHead` = the `byHead` map the plan cited at `:2674` as an unconsumed fact. **`held ?? pr` asks the head map FIRST**, and the comment at `:6666-6674` states the rule with its measurement: *"FROM THE LINK MAP, falling back to the open one… Measured on #252/#253/#254: merged, refs deleted, and every row carried `pr: null` while the PR page was alive."*

Verified by the moderator at both line numbers.

## The precedence the plan argued for would have been a regression

*"Where they disagree the annotation wins"* describes a coupling that **does not exist**. No `agentPr` call site (`:6675`, `:7033`, `:7339`) reads `plan.prs`; `plot-fleet-scan.sh` emits no per-branch PR number; the pulse branch schema carries none.

So the plan's central Design decision would have **introduced** plan text as an input to a host-derived field — the opposite direction from the shipped design, described as preserving it.

## The discriminating live test, run and verified

```
$ git show origin/main:…a-row-is-owned-by-more-than-its-pr.md | grep -c '→ #'
0
$ curl localhost:7777/api/fleet
branch: bug/a-row-is-owned-by-more-than-its-pr
pr: {"number": 1060, "url": "…/pull/1060", "draft": false, "author": "jwloka"}
```

**Zero annotations on the read ref, open PR on the head, and the board renders it.** The plan's first `Done when` passes on `main` today.

The three unannotated slices that render `pr: null` each have **no open PR**. There is no row on this estate whose PR the board is hiding.

## The real half is the half the mechanism cannot touch

The report says the row shows `(unnamed)` **and** no link. The plan treats them as one defect:

- **the link** — `prsByHeadMap`, host-derived, annotation-free. Shipped and working.
- **`(unnamed)`** — `UNNAMED_SLICE` (`schema.ts:1429`), the slice's **name**, from a `###` heading missing on the read ref. **`byHead` cannot supply a slice name.**

The plan's last `Done when` half-notices this and defers it to the PR body, while its Design proposes only the `byHead` resolution. **A plan whose mechanism is built and whose one live question is out of scope should be rewritten around the name, not amended around the link.**

## The cited precedent is a debt already paid

`plot-impl-status.sh` resolves per branch from `origin/<default>`, on the operator's clock, for a delivery gate. The board's row path is a render loop over a host map already in memory. The precedent supports the direction, and **the board already went further than it**.

## Disposition

- **Plan → Rejected.** Nothing to amend into: the mechanism exists and the proposed precedence would regress it.
- **#1057 → rephrased, not closed.** The reporter saw something real on Bitbucket. A replacement must first establish whether `prsByHead` was populated at all when that row rendered — Bitbucket refreshes at 4× the GitHub period (`prRefreshMsFor`), so a cold map is likelier, and **if it was empty, reading it harder cannot help.**

## The juror's own reservation, worth keeping

Its live test is GitHub/`main`; the report is Bitbucket/`develop`. A host-specific failure to populate `byHead` would produce the reported symptom and this test would miss it. **That strengthens the rejection rather than weakening it:** the plan's fix presupposes the map its own failure mode would have emptied.
