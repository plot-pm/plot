## Implementation brief — release-gate-labels-must-haves-by

- **Plan (canonical):** [docs/plans/2026-10-22-release-gate-labels-must-haves-by.md](../../docs/plans/2026-10-22-release-gate-labels-must-haves-by.md) on `main`
- **Approved:** 2026-10-22, Jan Wloka, plan-PR #2327 merged
- **Branch:** `bug/release-gate-labels-must-haves-by` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — PR review

Single slice, single wave. It builds on `0780f9982` (#2299, the plan-less label) and `4f3d9b7a7` (#2300), both already on `main`.

### What to build

`plot-release-gate.sh` on ewz-kus-portal (main `da789acff`) refuses correctly but names the four open Must Haves `[AP-0]`, `[AP-1]`, `[AP-2]`, `[AP-2]` instead of `[EWZKUS-3859]` … `[EWZKUS-3862]`, and `openShoulds` / `openCoulds` come back as `["","",""]`. The operator cannot tell which items block the release.

Two defects, both in `packages/domain/src/workflows/release.ts`:

- `itemLabel` (`:56`) takes the first token matching `JIRA_KEY = /[A-Z][A-Z0-9]+-[0-9]+/` (`:47`). A token like `AP-2a` in the item text wins over the ticket key. Scope the match to `Ticket prefixes` — `\b(<prefixes>)-[0-9]+\b`, as `resolveItemKey` does at `rules/sprint-release.ts`.
- `openShoulds` / `openCoulds` (`:339-340`) map through `i.plan`, which is `''` for a plan-less item. Map them through `itemLabel`, as `openMusts` already is at `:314`.

The wire is `packages/board/src/server/entry/release-gate.ts`. `tierFrom` already passes `entry.text` through (`:115`), so the collector needs no change. That entry has no config reader today; `sprint-release-gate.ts:313-325` already reads `Ticket prefixes` through `world.config` and splits it on commas — follow that shape.

### Decisions the plan settles — do not re-derive them

**One key rule, not two.** Do not keep a second regex in `release.ts`. `rules/sprint-release.ts` holds the prefix-scoped extraction inside `resolveItemKey`, which takes three sources (`Issue:` line, `ticket:` frontmatter, item text). Extract the item-text step into an exported helper in that file and call it from both `resolveItemKey` and `itemLabel`. Escaping stays with `escapeRegExp`; do not re-implement it. A bare shape regex is what produced `AP-2a`, so the shape regex must not survive in `release.ts`.

**The domain stays a function of its input.** `release.ts` must not read config. The prefixes arrive on the workflow input (`ticketPrefixes?: readonly string[]`, optional so existing callers and tests keep compiling), and `itemLabel(item, ticketPrefixes)` takes them as a second parameter. This settles Open Question 1: a parameter on the helper, carried by the input on the workflow. Callers of `itemLabel` that pass no prefixes get the no-prefix behaviour below.

**No `Ticket prefixes` declared: no key is matched.** The label falls back to `[<text>]`, then `[unnamed item]`, as today. The bare-shape match is deleted, not kept as a fallback — keeping it keeps the bug for every repository that has not declared prefixes.

**A plan slug still wins.** `item.plan !== ''` returns `[<plan>]` before any key scan, as today. The ewz items are plan-less; do not change the order for planned items.

**Open Question 2 is out of scope: text only.** `Issue:` line and `ticket:` frontmatter need the plan's `issues` array, which `release-gate.ts`'s `tierFrom` does not carry and the plan's Approach does not add. Label from item text scoped to prefixes; name the richer resolution as a follow-up in the PR rather than widening the wire. Say in the PR that you chose this.

**No corpus test.** Shell and domain duplicate no rule here (`plot-release-gate.sh` only pipes the collector's JSON to the bundle). A unit test fixes the agreement between `itemLabel` and the `sprint-release` extraction on the ewz item texts instead.

**Do not grow shell.** `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base, with no override. Read `Ticket prefixes` in the bundle through a config reader (the way `sprint-release-gate.ts` does), not by adding a `plot-config.sh get` call and a new flag to `plot-release-gate.sh`.

**Rules carried over:** absent is not false — a missing or empty `Ticket prefixes` means "no key matched", never "match any". An `escapeRegExp`-less prefix such as `A.B` would match `AxB`; escape.

### Done when

The plan's slice line is the specification: `itemLabel` is scoped to `Ticket prefixes`, Should and Could items are labelled through it, and unit tests cover `AP-2a` text and plan-less Should and Could items. Lift these assertions, which a naive change passes without:

- Item text `AP-2a EWZKUS-3861 …` with prefixes `['EWZKUS']` labels `[EWZKUS-3861]`. It catches a change that keeps the bare shape regex and only reorders it.
- The same text with no prefixes labels `[AP-2a EWZKUS-3861 …]`, the text. It catches a kept bare-shape fallback.
- A plan-less Should and a plan-less Could appear in `openShoulds` / `openCoulds` as their key, never `''`. It catches mapping through `i.plan` again.
- `itemLabel` and the exported `sprint-release` extraction agree on every ewz-kus-portal item text in the fixture. It catches the two rules drifting.
- A prefix containing a regex metacharacter (`A.B`) does not match `AxB-1`.

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Rebuild the bundle only to test locally (`pnpm build:board`) and restore the generated paths before you push — a PR must carry no generated bundle (`scripts/check-no-bundle-diff.sh`). Add a changeset (description first, `bumps:` block last). `scripts/check-shell-lines.sh`: no `.sh` growth expected; if you touch one, pay for the lines in the same change.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/workflows/release.ts`, `packages/domain/src/rules/sprint-release.ts` (the extracted helper only), `packages/board/src/server/entry/release-gate.ts`, their tests (`packages/domain/test/`, `packages/board/test/unit/release-gate.test.ts`), and one changeset.

Do not touch `plot-sprint-release.sh`, `plot-release-gate.sh`, or `sprint-release-gate.ts`'s own flow. The other slice in the same sprint, `jenkins-runs-lists-every-build-twice`, works in the Jenkins connector and holds none of these files.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
