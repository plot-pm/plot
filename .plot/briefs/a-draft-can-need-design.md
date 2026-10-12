## Implementation brief — the-phases-are-declared (wave: Needs design)

- **Plan (canonical):** [docs/plans/2026-10-12-the-phases-are-declared.md](../../docs/plans/2026-10-12-the-phases-are-declared.md) on `main`
- **Approved:** 2026-10-12, Jan Wloka, plan-PR #1608 merged
- **Branch:** `feature/a-draft-can-need-design` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** standard PR review

This branch waits on `feature/the-design-approvals-are-gated`, the spike of the sibling plan `design-work-proves-the-path` — merged as PR #1616 on 2026-10-12. The wait is satisfied: `main` already carries `approvalArm` (`packages/domain/src/rules/approval-arm.ts`), the `person`/`inSession` split in `workflows/approve.ts` and `transitions/plan.ts`, and the `stateTransitionOf` gate fix. Nothing in this slice re-derives any of that; it is the first slice to *write* `State: Design` through a command rather than by hand. No other branch of this plan is in flight — `the-idea-asks-about-design` (#1628), `the-card-carries-its-controls` (#1617) and `the-board-draws-the-declared-phases` (#1623) are merged; `the-prose-names-the-declared-phases` has not started.

### What to build

Today the only way a plan reaches `State: Design` is a hand edit or the board's *Commission design* agent writing it directly — and `plot-state-gate.sh` already refuses that hand edit, because no command leaves a receipt for a `Design` write (`gate.ts:248-253`). This slice is the first command that leaves one. Build:

1. **`needsDesign(plan, input)`** in `packages/domain/src/transitions/plan.ts` — a new transition beside `approve`. It moves `draft` → `design` and refuses every other state **by name** (the same shape as `approve`'s `state-terminal`/`state-wrong`/`state-unreadable` switch at the top of that function — reuse that pattern, don't invent a new refusal vocabulary). On success it writes `State: Design`, a `Design:` record shaped exactly like `Approved:` (`<date>, <who>, <channel>`, channel is `board` or `cli`), and an empty `## Spec` section with the placeholder `_To be filled in during Design._`.
2. **The state union growth.** `transitions/plan.ts:133-136` (the state union) and `:138` (the record-field union) gain `'design'`/`'Design'`. `workflows/decision.ts:76`'s `PlanRecordWrite.field` union gains `'Design'` alongside `'Approved' | 'Started' | 'Delivered' | 'Released' | 'Verified'`.
3. **`workflows/needs-design.ts`** (new) — decides where the write lands, mirroring `workflows/approve.ts`'s shape. Four targets, read off `TransitionPlan.review` and `impl`:
   - **A plan with an open plan PR** (`Review: pr`, PR state `OPEN`): commit onto the plan PR's head branch, in a worktree checked out on that branch; the push writes that branch itself.
   - **`Impl: same branch`**: the caller's checkout, no push — same as `/plot-approve` records there.
   - **Any other plan** (`Review: in-session` or `ballot`, on the default branch): a booking worktree on `plot/needs-design-<slug>` cut from `origin/<main>`, pushed through the shared ladder (`entry/ladder.ts`) with its micro-PR fallback — the same mechanism `bookApproval` uses (`entry/approve.ts:667-700`).
   - **A `Review: pr` plan with no open plan PR**: refuse as `plan-pr-absent`, naming the PR state. Write nothing.
4. **`server/entry/needs-design.ts`** — the bundle, built to `board/plot-needs-design.mjs` (see *Registrations* below). After the plan file write, it writes the state receipt through `recordStateReceipt(ctx.repoRoot, rel, 'Design')` (`server/entry/ladder.ts:64`) **in the caller's checkout** — the same checkout `entry/approve.ts:346` writes `Approved`'s receipt in, and the same `.plot/state/state-receipts/` the gate reads (`gate.ts:231`). The bundle refuses outright under `PLOT_UNATTENDED=1`: D3 gives this move to a person, and the fleet never decides it — this is not a graceful-degrade, it's a hard refusal with no `--who` escape hatch (unlike `approve`, which accepts `--who` unattended-adjacent; *Needs design* accepts none).
5. **`POST /api/needs-design`** on the board, calling the bundle.
6. **`cardControls` gains `needsDesign`** (true on a `draft` plan only — this is a new field on the rule that already shipped in the `the-card-carries-its-controls` slice, `rules/card-controls.ts`), the board's *Needs design* button reading it, and `menus.tsx:1466`'s Commission entry reading the same field (this keeps today's answer — Draft only — unchanged, just re-derived from the new field instead of whatever it reads today).
7. **`owningCommand`** (`rules/state-transition.ts:93-105`) gains a `design` arm naming this bundle, and its fallback lifecycle text becomes `Draft > Design > Approved > Delivered > Released`.
8. **`plot-plan-meta.sh:246-248`** — the `Design:` comment already documents `design_raw` (this landed with the spike). Confirm the comment's shape matches `Approved:`'s and needs no further edit; if it does, the edit must be net-zero shell lines.
9. **`CLAUDE.md:499`'s controller-endpoints paragraph** — rewrite to list the endpoints with **no count word** ("These actions exist as controller endpoints today — `dispatch`, `approve`, `deliver`, `idea`, `implement`, `drop`, `reslice`, `commission`, `continue`, `needs-design`. `merge` has no endpoint.") and add `plot-needs-design.mjs` as a route with no board the controller gate doesn't see. `:518` (the writer list admitting a `State:` change) gains this bundle. Run `./scripts/check-agents-md.sh --write` after — CI refuses an `AGENTS.md` mirror that differs.

### Decisions already made — do not re-derive them

**Why `needsDesign` writes no action receipt.** The controller gate's action list (`controller-gate.ts:11`, `:50`) and `plot-state-receipt.sh:173-180`'s `_action_of` do **not** list *Needs design* — same as `idea` and `commission` today. Those two already carry no action receipt; this is not a gap this slice closes, it's the precedent this slice follows. Don't add `needs-design` to those lists expecting symmetry with `approve`/`deliver` — asymmetry here is intentional (per `CLAUDE.md`'s *The Master Agent Uses The Controllers* section, only `dispatch`, `approve`, `deliver`, `idea`, `reslice`, `commission`, `implement`, `drop`, `continue` are controller-gated actions, and `needs-design` joins the ungated pile `idea`/`commission` already occupy).

**Why the state receipt still fires even though the action isn't gated.** Two separate mechanisms: the **controller gate** (which actions must route through a controller) and the **state gate** (which commits may change a `State:` line). This slice is invisible to the first and essential to the second — `recordStateReceipt('Design')` is what makes `plot-state-gate.sh` stop refusing a `Draft`→`Design` commit this bundle makes. Conflating "no action-gate entry" with "no receipt" would leave the state gate refusing every real `/plot-idea`-adjacent Design move, which is the exact defect `CLAUDE.md`'s *A Decision Reads The Index* section's sibling paragraph (*Gates Over Rules*, the state-gate example) describes as already-closed for `Approved`/`Delivered`/`Released` — this slice closes it for `Design`.

**Why the write-target logic has four arms, not the two `approve` has.** `approve` merges a PR or books directly; it never writes mid-flight to an *open* plan PR's branch, because approval is the PR's merge. *Needs design* is different: the plan is still Draft, so there usually **is** an open plan PR, and the natural place for `State: Design` is that PR's own branch (letting the later `approve` of the *design-work-proves-the-path* plan's Design state carry through the same merge). Don't collapse this into `bookApproval`'s two-arm shape — the "open plan PR" arm has no equivalent in `approve` and needs its own code path in `needs-design.ts`.

**Why a `Review: pr` plan with no open PR refuses instead of booking onto main.** Writing `State: Design` straight onto the default branch for a plan whose review channel is `pr` would silently change where its *next* review happens (a Draft file on `main` has no PR gating its Design entry). The plan's Design section is explicit: refuse as `plan-pr-absent`, naming the PR's actual state (closed, merged, or simply absent) — don't improvise a booking fallback for this arm.

**Why no `--who` escape hatch under `PLOT_UNATTENDED=1`.** `approve` accepts `--who` from an unattended caller in some paths (a declared handle in `People` is enough). *Needs design* does not — D3 says a **person** makes this call, full stop, and the fleet "never decides it." The refusal is unconditional: no flag flips it. This is a stricter rule than `approve`'s, not a smaller version of the same one — don't generalize `approve`'s refusal code to cover both without preserving this asymmetry.

**Rules carried over unchanged from the merged spike, worth not re-breaking:**
- `approvalArm` keys on `phase` and `review` only, never on a record — a hand-edit can't flip it. This slice's `design` state plumbing rides on that; don't add a second record-based gate.
- `PLOT_UNATTENDED=1` is read from the board **process's own** environment, never an HTTP caller's field — the script arm of a future `POST /api/needs-design` trusts its caller the same (known, accepted) way `POST /api/approve` does.
- A refusal stops the write. `plan-pr-absent` and the state-union refusals must actually return without touching the file — matching this repo's *Gates Over Rules* convention.

### Done when

The plan's `## Status` and the *Needs design* bullet of *Tests per slice* are the specification:

- `packages/domain/test/transitions.test.ts`: `needsDesign` moves `draft`→`design` and refuses every other state (`approved`, `delivered`, `released`, `rejected`, `superseded`, `none`) **by name** — one assertion per state, not a generic "refuses non-draft" catch-all, because a naive implementation would pass a single wildcard test while actually refusing with the wrong reason text.
- `packages/domain/test/workflows-needs-design.test.ts` (new): the four write targets of *Where the write lands* — open-plan-PR branch, same-branch caller checkout, booking worktree for in-session/ballot, and the `plan-pr-absent` refusal when `Review: pr` has no open PR.
- `packages/domain/test/state-transition.test.ts`: the new `design` arm of `owningCommand` and its rewritten lifecycle fallback text.
- `packages/domain/test/card-controls.test.ts`: `needsDesign` is true on `draft` only, false on every other state — this is what proves the button and the menu entry didn't just move to reading a field that silently always returns the old hardcoded answer.
- A board unit test for `POST /api/needs-design` (success path) **and** one for the bundle's `PLOT_UNATTENDED=1` refusal — the second one is the assertion that actually exercises D3; skipping it would let an unattended caller slip through untested.
- `test/reconcile/state-gate.test.mjs`: a `Draft`→`Design` commit **passes** when it carries this bundle's receipt and is **refused** without one — both halves, because a test asserting only the pass side would not catch a receipt that's written to the wrong path or under the wrong field name.
- The two bundle gates: `scripts/check-bundle-attributes.sh` (the `.gitattributes` `-merge` line) and `scripts/check-helper-table.sh` (the `skills/plot/scripts/README.md` row) — both fail CI silently-non-obviously if skipped, i.e. they don't fail *this* PR's own build step, they fail the next unrelated PR that touches the generated bundle.

Plus: a changeset, description first and `bumps:` block last (`CLAUDE.md` *Versioning* — 11% of past changesets got this backwards). Bump `plot` and `@plot-pm/board` — this is new behavior (minor), not a fix. Run `./scripts/check-agents-md.sh --write` after editing `CLAUDE.md:499`/`:518` — CI refuses a mirror that differs.

For tests: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it resolves the related tests and typecheck for `packages/domain` and `packages/board` plus the relevant `scripts/check-*.sh` gates for whatever you touched. The suites under the `CI suites` config key (`test:e2e`, `test:contracts`, `test:board`, domain coverage, `test/reconcile/*.test.mjs`) run in CI on this PR — don't run them locally; a failure there comes back as a correction, not a local obligation.

Name the shell gate explicitly if you touch `plot-plan-meta.sh`: `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows past its merge base, with no stored allowance. The `Design:` comment edit (if any) must be net-zero shell lines — remove elsewhere in the same change if it isn't.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

It reads which plan names this branch and opens the PR with the "Needs design" slice heading as title, the plan and this brief in the body. Push the first real commit as soon as it exists — a branch with no PR and no commits is invisible to the fleet. Once the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section (the `feature/a-draft-can-need-design` line under `### Needs design`).

### Scope guard

This branch owns:
- `packages/domain/src/transitions/plan.ts` — `needsDesign` and the state/record-field union growth
- `packages/domain/src/workflows/needs-design.ts` (new)
- `packages/domain/src/workflows/decision.ts` — `PlanRecordWrite.field` union growth
- `packages/domain/src/rules/card-controls.ts` — `needsDesign` field
- `packages/domain/src/rules/state-transition.ts` — `owningCommand`'s `design` arm and lifecycle text
- `packages/board/src/server/entry/needs-design.ts` (new), built to `board/plot-needs-design.mjs`
- `packages/board/build.mjs` — the new `shipped…` output
- `.gitattributes` — the new `-merge` line for the bundle
- `skills/plot/scripts/README.md` — the new helper row
- The board's *Needs design* button and `menus.tsx:1466`
- `skills/plot/scripts/plot-plan-meta.sh:246-248` (comment only, if it needs adjustment)
- `CLAUDE.md:499`, `:518` and generated `AGENTS.md`
- A changeset file

No other branch of this plan is in flight: the three merged siblings (`the-idea-asks-about-design` #1628, `the-card-carries-its-controls` #1617, `the-board-draws-the-declared-phases` #1623) already hold their changes on `main`, and `the-prose-names-the-declared-phases` has not started — so there is no live collision to track on this plan.

**A cross-plan collision does exist, though.** PR #1629 (`feature/the-spike-is-approved-alone`, sibling plan `design-work-proves-the-path`, open as of 2026-10-12) touches `transitions/plan.ts`, `rules/state-transition.ts`, `rules/card-controls.ts`, `workflows/decision.ts` and `skills/plot-approve/SKILL.md` — five of the files this brief lists under *Scope guard*. It is a different plan's branch, not a wave this slice waits on, so there is no ordering rule forcing a sequence; whichever of the two merges second absorbs a rebase. Check `gh pr view 1629 --json state,headRefName` before starting: if it has merged, rebase onto main and re-read the current shape of those files before adding `needsDesign`/`design`'s plumbing rather than assuming this brief's line numbers still hold; if still open, expect your own PR's review to flag the overlap and budget a rebase pass near the end rather than being surprised by one.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
