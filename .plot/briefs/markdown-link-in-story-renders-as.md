## Implementation brief — markdown-link-in-story-renders-as (wave 1: Story link reduction)

- **Plan (canonical):** `docs/plans/2026-10-23-markdown-link-in-story-renders-as.md` on `main`
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2432 merged
- **Branch:** `bug/markdown-link-in-story-renders-as` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is the plan's only wave. Nothing waits on it.

### What to build

`plot-plan-meta.sh` returns a `Story:` value verbatim. A plan that writes ``- **Story:** [`EWZKUS-3845-gpsync-abloesen`](../stories/EWZKUS-3845-gpsync-abloesen/STORY-EWZKUS-3845-gpsync-abloesen.md)`` reaches `/api/board` as that whole string, and the Planning card prints it as the chip (issue #2411, observed 2026-10-23 on Plot 2.28.0 with Bitbucket; several EWZKUS-3874 plans use the form). Reduce the value once, where it is read, so every consumer sees a slug. The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

**Reduce in the parser, not in the board.** `plot-plan-meta.sh` is the only reader of `Story:` in the scripts: it parses the value at `:1041` (front-matter style line) and `:1156` (canonical Status line), and `plot-sprint-candidates.sh:94` only passes `m.story` through. A reduction in `PlanCard.tsx` would fix the chip and leave the story lanes and the story filter comparing `card.story` against a link string. Reduce at both read sites through one awk helper next to `val_after_colon` (`:418`) and `strip_placeholder` (`:424`), so the two sites cannot drift. The plan's open question about a second reader in `packages/domain/src`: confirm with a grep before you start.

**Forms.** Reduce `[text](target)` only, and remove backticks around `text`. A plain slug, an empty value and a `<!-- ... -->` placeholder pass through exactly as today; `strip_placeholder` runs at `:569` after the read, so check that a placeholder still reads as absent. Autolinks `<target>` and reference-style links stay unreduced unless you find a plan in this repo or in ewz-kus-portal that uses one. Say which you chose in the PR.

**Drop the link target.** The board resolves a story from its slug, and a second `story_link` field adds a JSON key every consumer of `plot-plan-meta.sh` must carry for no reader. Confirm by reading how `StoryModal.tsx` and `StoriesTab.tsx` find a story; if one needs the path, stop and report instead of adding the field.

**Absent is not false.** An unparseable link (`[text](` with no close, `[]()`) keeps the raw value and never reduces to an empty string, because an empty `story` means "no story" and moves the card to the no-story lane.

**No change under `packages/board/src/app/`.** `Swimlanes.tsx`, `Board.tsx` and `lib/filters.ts` compare `card.story` to the slug and need nothing once `story` holds it. The board test proves that and changes no component.

### Done when

The plan's slice line is the specification: a contract test for the link form, the plain form and an empty value, and a board test that the story filter matches the reduced slug. Add the assertions a naive fix would pass without:

- **Both read sites.** One fixture with the link in front-matter style (`story: [x](y)`) and one in the canonical Status line. A fix at `:1156` only passes the canonical test and fails the other.
- **A plain slug stays byte-identical** before and after, including a slug that ends in hyphen and digits, so the reduction cannot change a legitimate value.
- **Backticked and plain link text** both reduce to the bare text.
- **A malformed link keeps the raw value** (see above).
- **Board test:** a plan row whose `story` is the reduced slug is selected by the story filter for that slug and sits in that slug's lane. The test starts from the `/api/board` shape and not from a hand-written `card.story`.

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base: the helper adds awk lines to `plot-plan-meta.sh`, so remove an equal number of shell lines elsewhere in the same change, or keep the helper to a few lines. The gate stores no number and has no override. Add a changeset for `plot` (`patch`) with the description first and the `bumps:` block last, and do not commit a rebuilt board bundle.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. Open the PR with `../plot/scripts/plot-open-pr.sh`, never `gh pr create`.

### Scope guard

This branch owns `skills/plot/scripts/plot-plan-meta.sh`, its contract test under `test/reconcile/` (extend `parser.test.mjs` or add a sibling), one board test and the changeset. No other branch of this plan is in flight. If you find something the plan did not anticipate, report it rather than improvising outside scope.
