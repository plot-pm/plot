## Implementation brief — reconcile-23-ignores-a-plan-s

- **Plan (canonical):** `docs/plans/2026-10-21-reconcile-23-ignores-a-plan-s.md` on main
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2270 merged
- **Branch:** `bug/reconcile-23-ignores-a-plan-s` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

The plan's only slice. Nothing waits on it and it waits on nothing.

### What to build

`plot-reconcile-scan.sh` §23 ("a finished plan's issue is still open") builds
its per-plan rows (`oi_claims`) from a plan's `issues[]` array only — the
`- **Issue:**` line, as `plot-plan-meta.sh` parses it. A plan that carries its
tracker key only in `ticket:` frontmatter has an empty `issues[]`, so today it
is filtered out of `oi_claims` before the row is even built
(`plot-reconcile-scan.sh:3007`, `select((.issues // []) | length > 0)`) and
falls instead into `oi_keyless` — the "not checked: N finished plan(s) name
no Jira key" line (`:3157`). Measured 2026-10-21 on ewz-kus-portal: 33 of 40
EWZKUS plans carry their key only in `ticket:` frontmatter, so they read
"not checked" even though their key is sitting right there in the parse. Make
§23 read `ticket:` too, resolved in the same fixed order the sprint/release
gate now uses.

### The decisions the plan settles — do not re-derive them

**The plan's Open Question is answered — and the dependency landed mid-session, so re-check it before you start.**
PR #2265 ("Key resolution") merged as commit `5d8e6c520` **during this brief's
own preparation** — it was still open when the plan was approved and when
drafting started, and merged to `main` moments before this brief was
committed. `git fetch origin main && git log HEAD..origin/main --oneline` is
how that was caught; run the equivalent before trusting any line number below,
in case something else lands between this brief and your first commit. PR
#2266 ("Jira keys in section 23", #2249) merged earlier the same day and is
why §23 already has `oi_keyless` reporting at all — it is not new code this
slice adds.

**Line numbers below are as of `main@4b4ce3299` — re-grep before trusting them if anything else has landed since; main moved twice (`5d8e6c520`, `4b4ce3299`) while this brief was being written.**

**#2265 ships the shared resolver this plan's Design section asks for — do
not write a second one.** `packages/domain/src/rules/sprint-release.ts`
exports `resolveItemKey(issueLineKeys, ticketFrontmatter, itemText,
ticketPrefixes)`: first Jira-shaped (`JIRA_KEY = /[A-Z][A-Z0-9]*-[0-9]+/`)
entry in `issueLineKeys` wins, else the trimmed `ticketFrontmatter` if it
matches the same shape, else a `ticketPrefixes`-scoped match inside
`itemText`, else `''`. That is "the `Issue:` line, then `ticket:`" exactly.
§23 only needs the first two sources — a finished plan has no "item text" the
way a sprint Must-have does — so call it with `itemText=''`,
`ticketPrefixes=[]` (both fall through to `''` harmlessly), or reimplement
just the two-source subset directly in shell/jq (see the next point on why
shell, not a bundle call, is the expected shape here).

**`plot-plan-meta.sh` already emits the field — it is sitting in `plan_json`
for free.** The merged diff adds a `"ticket":"<value>"` key to
`plot-plan-meta.sh`'s JSON, placed right after `"issues":[...]`
(`plot-plan-meta.sh:678`), fed from a new `fm_ticket` captured by `^ticket:`
in the frontmatter scanner (`:1043`). §23's `oi_claims` and `oi_keyless`
(`plot-reconcile-scan.sh:3005-3012`) both already read off `plan_json` — the
one `plot-plan-meta.sh` run the whole sweep shares — so `.ticket` is already
present in every row that reaches these two `jq` filters; nothing needs a
second parse or a second process spawn.

**The two filters to change (`plot-reconcile-scan.sh:3006-3014`):**

```
oi_claims=$(printf '%s\n' "$plan_json" | jq -r '
  select(.phase == "delivered" or .phase == "released")
  | select((.issues // []) | length > 0)
  | "\(.file)\t\(.phase)\t\(.issues | map(tostring) | join(","))"' 2>/dev/null)
oi_keyless=$(printf '%s\n' "$plan_json" | jq -r 'select((.phase == "delivered" or .phase == "released") and ((.issues // []) | length == 0)) | .file | split("/") | last | sub("\\.md$"; "") | sub("^[0-9]{4}-[0-9]{2}-[0-9]{2}-"; "")' 2>/dev/null | paste -sd, - | sed 's/,/, /g')
```

`oi_claims`'s `select((.issues // []) | length > 0)` is the line that drops a
ticket-frontmatter-only plan before it ever reaches a row — that is the bug.
`oi_keyless`'s matching `length == 0` is its mirror: a plan resolving a key
only from `ticket:` must move from one filter's population to the other's.
The resolved key also needs to reach `oi_nums` in `oi_claims`'s third field
(today `.issues | map(tostring) | join(",")`) so it flows unchanged through
the existing per-issue loop and membership test below — neither of those
needs to change.

**Follow `plot-sprint-release.sh`'s shape for *reading* the field, not a
bundle call — this is a per-agent-per-pass site.** #2265 resolves the key in
TypeScript for the board's sprint/release gate (one hop, one call), but for
its own shell sibling it does **not** shell out to a domain bundle per plan:
`plot-sprint-release.sh`'s `plan_delivery()` reads `"issues"` and `"ticket"`
out of the same `plot-plan-meta.sh` JSON with one extended `sed` capture
(three fields, space-separated — `[A-Za-z]` dodges BSD `sed`'s literal `\t`
bug in a replacement). §23 already holds the full parse in `plan_json` as a
`jq`-friendly value, so the natural analogue here is extending the `jq`
filter/select, not shelling to `node` per plan. This is exactly the
"per-agent-per-pass" tier `docs/shell-and-domain.md` names as the one where a
declared shell-side duplicate of a domain rule is allowed and expected — but
only if the two readings cannot silently drift. The Jira-shape test in both
`jq` and in `JIRA_KEY` is `[A-Z][A-Z0-9]*-[0-9]+` — mirror that pattern
exactly in whatever `jq` regex or shell test you add, rather than
approximating it, so §23's reading cannot diverge from the resolver's. If you
decide a domain call is the better fit for this specific site after all, say
so explicitly in the PR description — this brief states the expected shape,
not an unconditional rule.

**The downstream membership test and reporting are untouched by this
change.** `plot-host.sh`'s Jira `issue-list` arm already returns Jira keys as
strings (`number: .key`), and §23's membership test (`grep -x -F -f`,
`:3136`) is plain fixed-string line matching against `oi_nums` — it already
works unchanged for a `ticket:`-resolved key once that key is in the same
tab-separated row `oi_claims` has always produced. Nothing past
`oi_claims`'s construction (the loop starting around `:3127`, the
`oi_keyless` "not checked" summary line, the "Jira inbox" scoping note near
the end of the section) needs to change — they already treat whatever is in
`oi_nums` as the key to check, regardless of where it came from.

### Done when

The plan's Changelog line is the specification: **"§23 reads a plan's
`ticket:` frontmatter key when the plan has no `Issue:` line, so fewer
finished plans read 'not checked' under a Jira tracker."** Write (or extend)
a `test/reconcile/scan.test.mjs` fixture: a finished plan (`delivered` or
`released`) carrying `ticket: PROJ-123` frontmatter and no `Issue:` line,
under `Tracker: jira`, and assert §23's output names it in the normal
open/closed check rather than in the `oi_keyless` "not checked" line. Keep a
second fixture with both an `Issue:` line and a *different* `ticket:` value,
and assert the `Issue:` line's key is the one compared — that is the one case
a naive "use `ticket:` whenever `issues[]` looks sparse" shortcut would get
right by accident while actually implementing the wrong priority, so assert
the order explicitly rather than trusting the emptiness check alone.
`test/reconcile/scan.test.mjs` already grew substantially in the #2265/#2266
merge (234 lines changed) — read its current Jira-tracker fixtures first, to
match its existing fixture-building helpers rather than writing new ones.

Plus: the repo's gates — a changeset is required (patch bump for `plot`,
likely a `plot-reconcile` skill bump per `bumps:`), and the standard CI
suites. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs`
from the repo root before each push and run what it prints; the suites in the
`CI suites` config key run in CI, and a failure there comes back as a
correction. List no full suite here.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under
`skills/` is longer than at its merge base. This slice touches
`plot-reconcile-scan.sh`, a `.sh` file — if the fix grows it, pay for the
growth in the same change (remove shell elsewhere, or push more of the
comparison into the domain and call it through a bundle), since the gate
stores no number and grants no exemption.

### Bookkeeping

Open the PR through the controller once the branch exists:

```
../plot/scripts/plot-open-pr.sh          # current branch, non-draft
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Never `gh pr create`. Push the first real commit as soon as it exists. When
the PR is created, append `→ #<number>` to this branch's line under
`docs/plans/2026-10-21-reconcile-23-ignores-a-plan-s.md`'s `## Slices`
heading.

### Scope guard

This branch owns `skills/plot/scripts/plot-reconcile-scan.sh` (§23 only —
currently lines roughly 2994-3176) and whatever test fixtures under
`test/reconcile/` cover it. It does not own `skills/plot/scripts/plot-plan-meta.sh`,
`skills/plot/scripts/plot-sprint-release.sh`, or
`packages/domain/src/rules/sprint-release.ts` — those shipped with #2265 and
#2266, both already merged to main; re-verify there is no third in-flight PR
touching §23 before starting (`git log --oneline -- skills/plot/scripts/plot-reconcile-scan.sh`
since this brief was written), since the section has already changed shape
twice in one day.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
