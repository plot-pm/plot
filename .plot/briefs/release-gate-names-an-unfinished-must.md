## Implementation brief — release-gate-names-an-unfinished-must

- **Plan (canonical):** [docs/plans/2026-10-21-release-gate-names-an-unfinished-must.md](../../docs/plans/2026-10-21-release-gate-names-an-unfinished-must.md) on `main`
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2291 merged
- **Branch:** `bug/release-gate-names-an-unfinished-must` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — PR review

### What to build

`workflows/release.ts`'s `must-haves-open` refusal names each open Must Have
as `[${i.plan}]`. For an item with a plan slug that prints fine — `[a-sprint-
names-its-release]`. For a plan-less item (a lightweight task tracked only in
the sprint checklist, `i.plan === ''`), it prints a bare `[]`, repeated once
per open item with no other distinguishing text.

Measured on ewz-kus-portal, main `b33d3ee22`: `plot-release-gate.sh` refused
with `must-haves-open — 6 unfinished Must Have(s): [] — not delivered (sprint
kafka-gp-sync); [] — …`, six times over. All six Musts carry a Jira key only
in their item text (no plan). This is the first message an operator sees from
`/plot-release` on a Jira project, and today it names nothing actionable.

The fix: carry a label through from the collector to the domain, and use it
wherever an item with no plan would otherwise print `[]`. The label is the
item's Jira key when its text has one, else the raw item text.

### The decisions the plan settles — do not re-derive them

**The label does not reuse `resolveItemKey`.** `packages/domain/src/rules/
sprint-release.ts`'s `resolveItemKey` already does three-source key
resolution (`Issue:` line → `ticket:` frontmatter → item text against
`Ticket prefixes`) — but it exists for the *Sprint/Release comparison*
(`sprintReleaseDrift`, delivered 2026-10-21 in `#2265`) and needs
`ticketPrefixes` from `## Plot Config`'s `Ticket prefixes`, which this gate's
wire does not read. Re-deriving that whole pipeline here would pull a
tracker-config dependency into a code path (`release-gate.ts`) that is
otherwise config-free. Per the plan's Design section: extract the first
Jira-shaped key (`[A-Z][A-Z0-9]+-\d+`, unanchored) directly from the item
text — a strict subset of `resolveItemKey`'s own `JIRA_KEY` pattern
(`sprint-release.ts:56`), reused for its shape but not its machinery. If the
`## Plot Config` `Ticket prefixes` key is set, a narrower project-scoped match
is preferable to the bare shape regex — check this repo's config usage
pattern in `sprint-release.ts` before deciding whether to thread it through;
the plan leaves this an Open Question, not a settled answer, so use judgement
and say what you chose.

**The wire (`release-gate.ts`) carries the label; the domain decides its use.**
`tierFrom` (`release-gate.ts:88`) already drops everything except `slug` into
`ReleaseSprintItem.plan`. `plot-sprint-release.sh` already emits `text` per
item (`skills/plot/scripts/plot-sprint-release.sh:286`, `"text":...`) — the
collector needs no change. Add a field to `ReleaseSprintItem` (`release.ts:30`)
carrying the item's own text, and have `tierFrom` read `entry.text` and pass
it through. The domain, not the wire, decides whether to show the Jira key or
the raw text — keeping that judgement unit-testable without a board, per the
plan's Design section and the repo's "every rendered state is a domain
property" rule (`CLAUDE.md` § The Domain Package).

**All four `[${i.plan}]` call sites need the fix, not just the one the issue
cites.** The issue (#2281) and the plan's Open Question #3 point at
`release-gate.ts:113` (the `plan` field itself) and `release.ts:195` (the
`openMusts` refusal message). Grepping `workflows/release.ts` for `.plan\b`
found two more sites formatting the same pattern with the same bug:

- `release.ts:187` — the `withdrawn` list: `` `[${i.plan}] — withdrawn (sprint ${i.sprint})` ``
- `release.ts:291` — the `--ignore-sprint` override note written into the sprint file's `## Notes`: `` `[${i.plan}]` `` joined by comma

Both print a bare `[]` for a plan-less item today, by the same mechanism as
the refusal message the issue reports. The plan's Open Question #3 asks you to
"confirm no other message formats `plan` the same way" — this brief answers
that: there are two others, found by grep, not three total as the issue text
alone implies. Fix all four from one label-producing helper rather than
patching the one line the issue screenshots; a fix that only touches line 195
leaves the override note and the withdrawn list printing the same defect the
PR claims to close.

**`openShoulds`/`openCoulds` (`release.ts:316-317`) are out of scope.** They
return bare slug arrays consumed by the gate's unattended-prompt text
(`release-gate.ts`), not formatted with brackets inline in this file — check
whether the board or a skill template wraps them in `[...]` downstream before
deciding whether they need the same label, but do not assume they do without
checking; the plan's Motivation section only measures the Must-Have refusal
path.

**An item with a plan keeps `[<plan>]` unchanged.** The label only applies
where `plan === ''`. Do not touch the formatting for a slugged item — that
path already prints something actionable and the plan does not ask you to
touch it.

### Done when

The plan's `## Done when` is implicit in its Slices line — restated here:
a plan-less unfinished Must Have is named by its Jira key, else its item
text, everywhere the refusal, the withdrawn list, and the override note today
print `[]`. Concretely:

- A domain unit test in `packages/domain/src/workflows/release.test.ts`
  (new file — none exists today despite the "FIXTURE-VERIFIED ONLY" header
  comment) asserting: a plan-less Must Have whose text contains a Jira-shaped
  key labels with the key; a plan-less Must Have whose text has no such key
  labels with the raw text; a slugged item is unaffected.
- A wire test in `packages/board/src/server/entry/release-gate.test.ts` (new
  file) asserting `tierFrom`/`itemsFrom` carries the item's text through to
  the label the domain receives — covering the collector→wire→domain seam,
  since `plot-sprint-release.sh` itself needs no change (it already emits
  `text`).
- All four `[${i.plan}]` sites (`release.ts:187`, `195`, `291`;
  `release-gate.ts:113`) print the label instead of a bare `[]` for a
  plan-less item.

Plus: `packages/domain/exec vitest related --run {changed}` and
`packages/domain/exec tsc --noEmit -p .` for anything under
`packages/domain/src/**`; `packages/board/exec vitest related --run
{changed}` and `pnpm run typecheck` for anything under
`packages/board/src/**` (per this repo's `## Plot Config` Local checks key).
Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push
and run what it prints — do not run the full `CI suites` locally (`pnpm run
test:e2e` is CI's gate, not a local one, per `CLAUDE.md` § Testing).

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grew
past its merge base. This slice touches no `.sh` file (the collector already
emits what's needed), so this gate should be a non-issue — but if you do end
up changing `plot-sprint-release.sh`, growth there must be paid for by
removing an equal number of shell lines elsewhere in the same change.

### Bookkeeping

Open the PR through the controller, not `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # on the branch, once committed
```

It reads the plan, titles the PR from the plan's wave heading, and refuses a
branch with no commit beyond a `PLOT-BLOCKED` marker. When the PR exists,
append `→ #<number>` to this branch's line in the plan's `## Slices` section
(`docs/plans/2026-10-21-release-gate-names-an-unfinished-must.md`), and push
the first real commit as soon as it exists so the branch is visible on the
board/fleet before the PR opens.

### Scope guard

This branch owns:
- `packages/domain/src/workflows/release.ts` (+ new `release.test.ts`)
- `packages/board/src/server/entry/release-gate.ts` (+ new `release-gate.test.ts`)

It does **not** own `packages/domain/src/rules/sprint-release.ts`
(`resolveItemKey`, `sprintReleaseDrift`) — that file belongs to the already-
delivered `sprint-release-comparison-drops-must-haves` plan (merged
2026-10-21, PR #2265). Read it for the pattern, do not edit it; if the label
logic here turns out to want `Ticket prefixes` config after all, that is a
new, narrow addition to `release-gate.ts`/`release.ts`'s own input reading —
not a refactor of `sprint-release.ts`'s existing public API.

This is the plan's only slice — no sibling branches to collide with. If you
find the fix wants to touch the collector (`plot-sprint-release.sh`) after
all, report that rather than assuming it's in scope: the plan's Design
section states the collector already emits everything needed.
