## Implementation brief — the-scan-drift-counter-is-acted-on (wave 1: Section 9 separates its three findings)

- **Plan (canonical):** `docs/plans/2026-09-11-the-scan-drift-counter-is-acted-on.md` on `main`
- **Approved:** 2026-09-11, Jan Wloka, plan-PR #887 merged
- **Branch:** `bug/the-scan-drift-counter-is-acted-on` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention

Sole wave — nothing waits on this and it waits on nothing. One sibling branch is in flight and it edits the same file; see **Scope guard**.

### What to build

`plot-reconcile-scan.sh` section 9 emits one counter, `sprint_drift=`, over three unrelated findings. Split it into three counters with three headings, each keeping the `inspect:`/`backfill:`/`fix:` line it already prints.

The failure is measured. The counter read **27** when it was filed as a W36 Should, and **57** on 2026-09-11 when that sprint closed with the item unbuilt — it more than doubled while nothing consumed it. The 57 is three facts:

| shape | count | is it drift? | line today |
|---|---|---|---|
| sprint member names no plan | 18 | **no** | `scan:1411` — `inspect:` |
| plan has no `Sprint:` field | 18 | yes, mechanically fixable | `scan:1419` — `backfill:` |
| plan's `Sprint:` names a different sprint | 21 | yes, needs a person | `scan:1423` — `fix:` |

The three branches already exist in the code, at `plot-reconcile-scan.sh:1409-1426`. Each increments the same `n_sprint_drift` and appends to the same `sprint_drift_out`. The change is to give each its own accumulator, its own counter variable, its own `echo "== N. ... =="` heading, and its own footer key — not to change what any of them detects.

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**A member naming no plan is reported, and is not called drift.** This is the plan's central argument and the easiest one to lose while editing. Of the 18, W36 contributes 8 whose own sprint note says *"Nothing here has a plan yet"* — deliberate, and it closed that way — and W39 contributes 8 that every one **shipped**: `a-rejection-is-a-controller-command` (#843), `a-release-is-a-controller-command` (#848), `adoption-is-a-controller-command` (#840), `a-pr-is-opened-by-a-controller` (#846), `a-lifecycle-field-has-one-writer` (#851), `the-board-says-which-ci-answered` (#881), plus two verified complete by measurement. A slice that merges as a PR with no plan file is normal on this estate. **So this component rises as work succeeds**, which is why it keeps its own name and its own number rather than being deleted or folded.

**Do not render any of this on the board, and do not add a gate.** The plan's Notes answer the W36 item's own wording — *"reach a reader instead of a footer"* — with a refusal: a board chip showing 57 moves the uselessness somewhere more expensive. `attention=` stays the only blocking counter. All three new counters sit **below** the `== blocking sections end ==` marker, exactly where section 9 sits today.

**Do not backfill the `Sprint:` field automatically.** It is a claim about intent, and a script writing one would be inventing it. The `backfill:` line stays copy-paste text a person runs.

**The split has a precedent chain, and three prior sections already argued it.** `docs/plans/2026-09-06-a-sprint-knows-when-it-ended.md:81`, `.plot/briefs/a-sprint-phase-meets-its-index.md:21` and `.plot/briefs/a-sprint-names-a-shipped-release.md:46` each refused to fold a new finding into `sprint_drift=`, with the same sentence: one number answering two questions is one a reader must re-derive the split from. This slice applies that rule to `sprint_drift=` itself. It is not a new principle and does not need re-arguing in the PR.

**Section numbering is safe below the marker, and no consumer reads a number.** `/plot-deliver`'s gate reads to the `== blocking sections end ==` line rather than to `== 7.`, precisely because this scan has been renumbered twice. Renumber sections 10–19 without ceremony.

**The header comment at `scan:11` is already stale — do not treat it as the contract.** It lists `unsliced_waves=` and `prose_wave_names=`, while the footer at `scan:2441` emits `uncut_slices=` and `prose_slice_names=`. The emission line is the contract. Fix the header while you are in it, but a disagreement you find there is pre-existing, not yours.

### Done when

The plan's `## Done when` list is the specification. Lifting the assertions a naive implementation would pass without:

- **Each of the three counters is separately non-zero on this estate, and the three sum to 57.** A split that merely renames the key, or that leaves two findings sharing one accumulator, passes every structural test and fails this one. Re-measure after the change: **18 / 18 / 21**.
- **A member with no plan is reported under its own heading, never as drift.** The heading wording is what a reader acts on; a split whose three headings all say "drift" has not done the work.
- **Both real findings still print both names.** The `Sprint:` mismatch line names the sprint and the plan's own value today — a reader cannot act without both.
- **`attention=` does not move**, and all three headings sit below `== blocking sections end ==`.

Three test sites read the old key and all three must be updated together: `test/reconcile/scan.test.mjs:275` (the full footer string), `:2505` and `:2744` (both `assert.match(footer, /\bsprint_drift=0\b/)`, each guarding a *different* section's independence). Missing one fails in a test whose name mentions neither sprint drift nor this plan.

Plus the repo gates: `pnpm test`, `pnpm run test:contracts`, a changeset (`plot: patch`, description first, `bumps:` block last). Run `nvm use` first — pnpm crashes on Node 26. Do **not** run `test:e2e`; it is CI's gate.

### Bookkeeping

Open the PR through the controller — `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work is still moving). Do not run `gh pr create`: it takes the title from the last commit subject, which on this estate is routinely `plot: build the board artifact`.

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.

Push the first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-reconcile-scan.sh` section 9 and its footer key, and `test/reconcile/scan.test.mjs` where it reads that key.

**One sibling branch is in flight and it edits the same file:** `feature/a-merge-without-a-changeset-is-named` adds a *new advisory section* to `plot-reconcile-scan.sh` with its own footer counter, also below the blocking marker. Measured at dispatch, it carries no commits yet. The two will collide on the footer emission line (`scan:2441`) and on the section numbering below the marker. Neither change depends on the other — resolve by keeping both key sets, and re-run the scan to confirm the footer parses.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
