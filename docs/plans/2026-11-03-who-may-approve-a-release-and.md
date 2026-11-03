# Who may approve a release, and the reviewer as a role agent

> `release-approve` cannot tell a person from a master agent, a board started by an unattended process refuses a person's clicks, and the reviewer starts without its role file. Each is a trust-boundary question that needs a decision before code.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #3077
- **Story:** <!-- optional, story slug this plan is part of (docs/stories/<slug>/) -->
- **Review:** pr
- **Impl:** own branches

## Changelog

- To be decided in review. The candidate outcomes: `release-approve` refuses a caller that is not a person, the board names the clicking person on `POST /api/release` and `POST /api/restart`, `releaseFinish` names (or books) a Delivered plan outside the sprint, and the reviewer loads `.claude/agents/reviewer.md` from `origin/<default>`.

Board impact: expected on the release row (refusal names) and on the release and restart buttons (how a click identifies its person). The plan format, template and helper scripts keep their shape.

## Motivation

Two slices left the plan for #3069 on 2026-11-03, by jwloka's decision after its four-juror panel. Both change a trust boundary, so they get their own Design phase. Line references below are against `origin/main` at `a518552f1`; re-read them before relying on them.

### Release approval (#2927, #2918)

- MEDIUM: `releaseFinish` books only the sprint's scope plans (`packages/domain/src/workflows/release-finish.ts:110-175`; the scope reading is built at `packages/board/src/server/entry/release-finish.ts:223`). A Delivered plan outside the sprint whose changesets ship under the tag stays Delivered, and the finish does not name it. (#2927)
- MEDIUM: `releaseApprove` refuses only an `unattended` caller (`packages/domain/src/workflows/release-approve.ts:73`). A master agent in the person's session can run `plot-ask.mjs release-approve`, which merges and pushes the finish to `main`. `Caller` is `'person' | 'unattended' | 'fleetd'` (`packages/domain/src/workflows/decision.ts:23`), so no reading tells a master agent from a person. (#2927)
- LOW: a board that an unattended process started refuses a person's release and restart clicks. The caller comes from the board's own `PLOT_UNATTENDED` (`packages/board/src/server/entry/deliver.ts:791`, `packages/board/src/server/restart.ts:70`; `packages/board/src/server/release.ts:211` only spawns the script). (#2918)

### Reviewer role (#2918)

- MEDIUM: the reviewer starts from `reviewerCommand` (`packages/board/src/server/entry/review.ts:345`), and no code loads `.claude/agents/reviewer.md`. The role-file load exists twice and differs: the fixer reads `fixer.md` from the main checkout (`packages/fleet/src/shared/auto-fixer.ts:454-461`), and main-repair reads `main-repair.md` from `origin/<default>` through `Refs.showFile` (`packages/fleet/src/shared/repair-role.ts:112-113`). The claim "the reviewer definition loads from the default branch" has no owner.

## Design

### Approach

Not chosen. The slices below are a starting shape for the Design phase; the questions under *Open Questions* decide them.

### Open Questions

- [ ] Who may approve a release, and from which reading? An HTTP request carries no identity, and the controller gate allows a desk's own calls. If the board routes pass every request as `person`, an unattended process that POSTs passes as a person, and a refusal of a master agent at `release-approve` loses its effect through the board (layering, safety).
- [ ] Which mechanism names the clicking person on `POST /api/release` and `POST /api/restart`, for example a per-board token only the served page holds (safety)?
- [ ] Does `releaseFinish` book a plan outside the sprint, or only name it? The changeset `plan:` line is optional, so the match "ships under the tag" is not mechanical. Safety proposes: book only plans a changeset's `plan:` line names, and name every other candidate (safety A9, seams).
- [ ] #3071 states that plans outside the sprint stay out of its scope, and its tracker step reads a Delivered plan outside the booking as keeping an issue open. Booking such plans changes that test's meaning, so this work waits on both #3071 slices (seams).
- [ ] Three plans edit the `release-approve` refusal sentence in `CLAUDE.md` (#3070, #3071 and this one). Which order lands them without a conflict (seams)?
- [ ] Reviewer: extract one role-file loader (a domain rule over the `Refs` port, reading from `origin/<default>`) and move the fixer onto it, or add the reviewer only (layering)?
- [ ] Reviewer: keep the `rules/role-gate.ts` exception that lets the reviewer write `plot/review`, and the identity #3074 compares against (seams).
- [ ] Reviewer: if the reviewer stops starting after the move, `review-not-passed` refuses every merge with no refusal that names the cause. The test must prove a review run still writes `plot/review` on a head end to end, and the slice lands alone (safety).
- [ ] Order against #3070's `feature/the-release-review-is-switched-on` (which makes the reviewer start live on every slice PR) and #3067's unblocker, which also starts a role through `roleCommand` (seams).

The panel's verdicts are on the plan branch `idea/open-plot-review-findings-from-the`, under `.plot/panels/2026-11-03-open-plot-review-findings-from-the/`.

## Slices

### Release caller

<!-- Provisional: the Design phase decides whether a caller identity exists at all. -->

- `feature/release-approve-names-its-caller` — `release-approve` and the board's release and restart routes carry a caller that tells a person from a master agent and an unattended process <!-- builds: a caller reading for release-approve that separates a person from a master agent -->

### Release finish scope

- `feature/release-finish-names-unbooked-plans` — `releaseFinish` names every Delivered plan outside the sprint whose changeset ships under the tag, and books those a changeset's `plan:` line names <!-- builds: a release-finish report of Delivered plans outside the sprint scope --> <!-- waits: bug/release-approve-tells-its-tracker -->

### Reviewer role

- `feature/the-reviewer-loads-its-role-file` — the reviewer starts with `.claude/agents/reviewer.md` read from `origin/<default>`, through one role-file loader <!-- builds: a role-file loader over the Refs port shared by reviewer, fixer and main-repair --> <!-- waits: feature/the-release-review-is-switched-on -->

## Notes

- Created from tracker issue #3077 by `/plot-idea`, unattended. No `Design:` answer was given, so the plan starts in Draft. The reader decides whether it moves to Design.
- Deliverable search found no existing caller reading for `release-approve` and no shared role-file loader; the two existing loads are in `auto-fixer.ts` and `repair-role.ts`.
- Refs #3069.
