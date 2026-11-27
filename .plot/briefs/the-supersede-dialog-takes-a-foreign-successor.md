## Implementation brief — supersede-names-a-plan-in-another-repository (wave 2: Board)

- **Plan (canonical):** docs/plans/2026-11-27-supersede-names-a-plan-in-another-repository.md on main
- **Approved:** 2026-11-27, jwloka, plan-PR #3740 merged
- **Branch:** `feature/the-supersede-dialog-takes-a-foreign-successor` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This slice waits on `feature/supersede-takes-a-foreign-successor` (Command), which merged as #3744. Its exports are on `main` at dispatch: `successorReference`, `successorHere`, `successorName`, `repositoryOfRemote`, the `successor-unparsed` refusal, and the `(unverified)` record. Import them; do not re-implement any of them.

### What to build

After #3744, `plot-supersede.mjs --by owner/repo:slug` records a successor in another repository. The board still cannot. Three places in `packages/board` still accept a slug only:

- **The route.** `handleSupersede` (`packages/board/src/server/supersede.ts`) tests `by` against `SLUG_RE` and answers 400 `by must name the successor plan by its slug` for `owner/repo:slug`, so the request never reaches `supersedePlan`. Replace that test with the domain's `successorReference`. A `by` that is not a string still answers 400. A string that parses as neither form reaches `supersedePlan` and answers 422 `successor-unparsed` — the controller already produces that refusal, and `refusalStatus` already maps every reason it does not list to 422. `slug` keeps its `SLUG_RE` test.
- **The dialog.** `successorEntry` (`packages/domain/src/rules/supersede-successor.ts`) says a typed value is ready unless it is empty or the plan's own slug. It must accept `owner/repo:slug` as free text beside the datalist of local slugs, and it must keep refusing an empty entry and the plan's own bare slug. `SupersedeButton.tsx` renders the entry's `ready` and `reason`; change its placeholder to name both forms. The datalist stays: it offers local slugs only.
- **The plan card.** The card names a foreign successor as text, with no link, because this checkout holds no file for it. A Superseded plan's record is not on the card today: `PlanRecordsReading` (`packages/domain/src/rules/plan-card-facts.ts:61`) carries design, approved, started, delivered and released records and no superseded one. Add the successor's reading there, decide it in the domain (a property of `planCardFacts`, read in a unit test), and render only what the domain returns. The `Superseded:` record is `<date>, by \`<name>\`` and, for a foreign successor, `<date>, by \`owner/repo:slug\` (unverified)`. The card shows the name and the word `unverified`; it shows nothing for a plan with no `Superseded:` record.

### Settled decisions — do not re-derive them

**The route does not verify the foreign plan.** `[question-verify-foreign]` in the plan settles it: no. Verification needs a new `Host` file read, costs a host call per supersession through a connector, and fails on a repository the account cannot read. The dialog and the card carry `unverified` as the statement of what was not checked. Do not add a `Host` operation and do not call `gh` or `plot-host.sh`.

**One host only.** `[question-host-reference]` puts a successor on another host out of scope. Do not add a host prefix to the grammar the dialog accepts.

**One parser, in the domain.** `successorEntry`, the route and the card all read `by` through `successorReference`. A second regex in a component or in the route is the defect this plan was written to remove; the route's `SLUG_RE` and the Command slice's grammar had to agree, and the way to keep them agreeing is that only one of them parses.

**`successorEntry` does not read the repository.** Whether `owner/repo` names this checkout's own repository is the controller's reading (`repositoryHere`, `successorHere` in `entry/supersession.ts`). The dialog submits what was typed, and a local successor typed as `this/repo:slug` is refused `successor-not-found` by the controller where no such file exists. Do not give the dialog a repository name to compare with.

**`same-plan` never applies to a foreign reference.** `other/repo:<this plan's slug>` is ready in the dialog. A bare `<this plan's slug>` stays refused (`a plan cannot supersede itself`).

**No hidden UI.** The Supersede control stays visible and keeps its disabled reason through the card's disabled-action outline (`supersedeAction`, unchanged). Do not hide the successor line on a plan with no foreign successor by omitting a fact the card grammar expects; the domain answers `null`, and the component renders nothing for `null`.

**Rules carried over unchanged.** A refusal names its reason and writes nothing. `PLOT_UNATTENDED=1` refuses `unattended` (403) before anything is read, and `refusalStatus` is unchanged. The route's cross-origin check (403) and its 400 for a body without a string `slug` stay. An absent `by` is not a successor: it answers 400, not 422.

### Done when

The plan's `## Slices` test line is the specification, and its two assertions are:

- The route answers 200 for `owner/repo:slug` and 422 `successor-unparsed` for a malformed reference. This catches an implementation that leaves the `SLUG_RE` test in place, which answers 400 for both. Put the route tests in `packages/board/test/unit/supersede-route.test.ts` beside the existing ones, with an injected `context`, and assert the `by` that reaches `supersedePlan` is the string typed, trimmed.
- The card's successor text is a domain property read in a unit test (`packages/domain/test/plan-card-facts.test.ts`), not asserted by rendering. This catches a decision made in the `.tsx`.

Add these, because a naive implementation passes without them:

- `successorEntry('p', 'owner/repo:p')` is ready, and `successorEntry('p', 'p')` is not. This catches `same-plan` applying to the foreign arm.
- `successorEntry` is not ready for `owner/:x`, `/repo:x`, `owner/repo:`, `a/b/c:x`, `owner/repo` with no slug, and an entry with whitespace inside. This catches an entry that accepts anything containing a colon, which the route would then refuse as 422 after the person pressed the button.
- A plan whose `Superseded:` record carries no `(unverified)` shows the local successor's name with no `unverified` word, and a foreign one shows both. This catches the suffix leaking onto the local reading.
- One browser test proves the dialog accepts `owner/repo:slug` and the card shows the successor text. Behaviour is decided in the domain; this test is where it is seen. Reuse the existing supersede browser test's fixture, and do not start a second board server for a unit assertion.

Plus: add a changeset (`'@plot-pm/board': minor`, description first, `bumps:` block last, `plan:` line pointing at the plan file). The bundles under `skills/plot/scripts/board/` are generated; do not commit a rebuild (`scripts/check-no-bundle-diff.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count here; if a change does reach one, pay for growth in the same change. New functions are arrows, in a `.tsx` and a test too. TSDoc states what an export does and how it fails, with no history.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/server/supersede.ts`, `packages/board/src/app/components/SupersedeButton.tsx`, `successorEntry` in `packages/domain/src/rules/supersede-successor.ts`, the superseded-successor reading in `packages/domain/src/rules/plan-card-facts.ts` and its wiring through `packages/board/src/server/plan-facts.ts` and the plan-card component, their tests, and the changeset.

Leave `successorReference`, `successorPreconditions`, `successorHere`, `supersessionRefusalReason`, `packages/domain/src/transitions/plan.ts`, `packages/board/src/server/entry/supersede.ts` and `entry/supersession.ts` as #3744 left them. If the controller refuses an input the route should have accepted, report it rather than changing the controller here.

No other slice of this plan is in flight: the Command slice merged. Before editing `plan-card-facts.ts`, run `git log --oneline origin/main -- packages/domain/src/rules/plan-card-facts.ts` to see whether a card-grammar change landed since this brief.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
