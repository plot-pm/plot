## Implementation brief — a-slice-waits-on-every-branch-it-names (slice 2: The parser reads every wait)

- **Plan (canonical):** `docs/plans/2026-10-02-a-slice-waits-on-every-branch-it-names.md` on `main`
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/the-parser-reads-every-wait` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

This slice waits on `bug/every-wait-reaches-the-verdict`, which merged as #1253 (`84ec3299d`). Nothing waits on this slice. It is the one that changes what the parser emits, so it is the first slice after which `main` behaves differently.

### What to build

A slice with two prerequisites reads eligible while the first one has not merged (#1153). `plot-plan-meta.sh` keeps only the last `<!-- waits: … -->` marker on a line, because `sub(/^.*<!--[ \t]*waits:[ \t]*/, …)` is greedy. Two live plans carry the shape today: `2026-10-01-a-desk-and-its-manifest-name-each-other.md` and `2026-10-01-idle-is-read-from-what-the-desk-recorded.md` each have a slice with two markers on one line. The parser reports one wait for each, and nothing says the other was dropped.

Slice 1 made every domain and board reader take a list. The scan still sends one name, so nothing changed on `main`. This slice teaches the producers: the parser emits `"waits_on":["bug/a","bug/b"]`, the scan carries the list in its columns and its payload, dispatch checks every prerequisite, `branchOf` maps the array, and reconcile reports a `waits:` value it cannot read. The plan is canonical. This brief records what the plan does not say and what drifted since it was approved.

### Decisions the plan settles — do not re-derive them

**The field is a list, not `waits_on` plus `waits_on_all`.** A second field keeps `waits_on` as a lossy first value, so every reader nobody migrates still reads one prerequisite and nothing fails to show it. The type change is what makes an unmigrated reader fail.

**The unmigrated reader that fails silently is dispatch.** `waits_pairs` (`plot-dispatch.sh:3057`) matches `"waits_on":"[^"]*"`. That pattern does not match a list, so an unmigrated dispatch reads every slice as waiting on nothing and dispatches a held slice. That is the defect this plan exists to remove, reintroduced by the fix. Migrate it in the same commit as the parser, and keep a dispatch test with two prerequisites that fails if the pattern is left alone.

**Absent is not empty.** A branch with no wait carries no `waits_on` key. The parser never emits `[]`. The key stays gated on `waits_set[i] == 1` (`plot-plan-meta.sh:622`). `branchOf` already turns absence into `[]` in the domain.

**Two spellings, one answer.** Several `<!-- waits: x -->` comments on one line, or one `<!-- waits: x, y -->`, give the same list in the line's order, duplicates removed. The parser reads every marker on the line and splits each value on commas. Each name must still match `^(PREFIXES)/[^ \t,]+$`: that rule keeps a syntax example in prose from becoming a declaration, and the comma joins the excluded characters because it is now the separator.

**A wait the parser cannot read is reported, never dropped.** On a line that names a branch (a list item or a `(Branch: …)` heading), a `waits:` marker whose value is not a branch name goes to a new per-plan field `unread_waits[]` as `{ branch, value }`. A marker on a prose line stays silent, as today: the plan documents the annotation in prose, and reporting that would fire on every such plan. Reconcile prints a new section `unread_waits=` beside section 24, which reports `unread_headings=`. It reports and never gates.

**Reconcile §18 does not change.** It reads the raw line for the presence of a marker (`plot-reconcile-scan.sh:2239`, `:2249`). A test asserts that a line with two markers still counts as annotated.

### Drift since the plan was approved — verified on `84ec3299d`

The plan's references predate #1244, #1247 and #1253. Re-find each by name. Measured today:

| The plan says | Now |
|---|---|
| list-item block `:1076-1095`, slice-heading block `:1295-1314` in `plot-plan-meta.sh` | `:1078-1095` and `:1297-1314`. Two copies of one block: change both, and keep them identical |
| `waits_of[n]` at `:1169`, `:1354` | `:1169` and `:1354`, with `waits_set` beside each; the emitter is `:622` |
| header comment `:133` | `:133` (`names ONE branch`); the sentence runs to `:136` |
| fleet scan shim `plot-fleet-scan.sh:2892-2902` | `:3131-3140`: `(b.get("waits_on") or "-")` |
| fleet scan readings `:3772-3779`, `:3821-3830` | `:4353-4367` and `:4442-4446` carry the column through `waits` unchanged |
| fleet scan payload `:4040-4049` | `:4691-4700`: `json_branches+=",\"waits_on\":\"…\""` |
| `waits_pairs` `plot-dispatch.sh:2928-2948` | `:3057-3071`, consumed at `:3167`, with the refusal text at `:3158-3166` |
| `waits_pr_state` producer `:4276-4284` | `:4414-4422`, the refill that replaces field 10 |
| reconcile §24 `unread_headings=` | section header at `plot-reconcile-scan.sh:3120`, counter `n_unread` at `:2944` and `:3132`, summary line `:3344` |
| `branchOf` `plan-store-shell.ts:46-51` | `:46-60`: `waitsOn: raw.waits_on ? [raw.waits_on] : []`, with a comment naming this slice |

**The consumer side is already built, so match its format.** `entry/branch-state.ts:190-210` reads field 9 as a comma-separated name list (`-` for none) and field 10 as a parallel comma-separated PR-state list in the same order (`?` for *not read yet*, a single flag for the whole branch). A name list and a state list of different lengths throws. So the scan must write both columns as comma-joined lists of equal length:

- Field 9: the parser's list joined with `,`. The shim at `:3139` joins with commas where `waits_on` is a list, and still emits `-` for absent. A string in the old shape (a plan blob parsed by an old parser) is one name and still works.
- Field 10: `waits_pr_state` is called once per prerequisite, and the answers are joined with `,` in the same order. `host_pr_state`'s run cache keeps this at one host call per prerequisite per run. Do not split the column in the refill: `cut -f1-9` and `cut -f11` keep their meaning.
- The readings then pass to `branch-state.ts`, whose `waitVerdict` already takes the list and ranks `blocked` over `waiting`.

**The payload is an array.** `"waits_on":[…]` with `json_str` on each name. `FleetBranchSchema` reads both shapes since #1253, so a persisted `.plot/state/last-pulse.json` still parses. A branch with no wait emits `[]` here, not an absent key: the schema's old default was `''`, the new one is `[]`, and the payload has always carried the key. Check `fleet.test.ts` and the tiny-garden fixture before you change the emitter.

**The scan's note names every prerequisite.** `plot-fleet-scan.sh:4616` prints `waiting on $waits` and `:4621` prints `blocked — no PR found for $waits`. With one name both stay byte-identical. With several, `waiting on a, b`; the `blocked` sentence names the prerequisites, not which one lacks a PR, because the scan has the verdict and not the per-prerequisite answer here. Do not add a per-prerequisite answer to the payload: that is a plan amendment, and slice 1 already reported it.

**Dispatch prints one line per prerequisite that has not cleared.** `waits_pairs` prints one `branch<TAB>prerequisite` pair per prerequisite, in the plan's order. The refusal loop (`:3141-3167`) then prints one `skipped` line per pair, so a branch with two unmerged prerequisites prints twice. Avoid that: count `n_skipped` and fill `waits_held` once per branch. The test asserts the refusal names the unmerged prerequisite, and a branch with `[merged, unmerged]` names only the second. `--allow-waiting` keeps its line per prerequisite.

**awk here is BWK awk 20200816 on macOS, and POSIX awk elsewhere.** `match(s, re, arr)` and `gensub` are gawk-only and fail here with a syntax error. The parser's existing blocks use `sub`, `match` without an array, and `split`. Loop with `match` plus `substr` over the rest of the line, and keep the `<!--[ \t]*waits:` anchor so `<!-- waits: x -->` and `<!--waits:x-->` both read.

**Rules carried over unchanged.** Absent is not false. Read the exit code, not the emptiness. The host is asked, never the refs: `plot-release-refs.sh` deletes merged branches' refs, so a rule that reads them holds a dependent forever. A duplicated rule joins the corpus tier: `branch-state.corpus.test.ts` and `eligible.corpus.test.ts` compare the shell's verdict with the domain's, and slice 1 already maps `waits_on` to a list there. On a disagreement the branch stops: do not adjust either side to make the corpus pass.

### Done when

The plan's `## Done when` list is the specification. For this slice that is the `test/reconcile` and `parser.test.mjs` items. The `packages/domain` items shipped in #1253 and stay green.

Assertions that exist because a naive implementation passes without them:

- **Both dialects.** A heading and a list item each with two markers. A fix in one block passes the other dialect's test only if the test is missing. `parser.test.mjs:1857-1924` holds today's single-wait tests: they assert `waits_on` as a string, and they change to arrays (`'bug/prereq'` to `['bug/prereq']`).
- **Order and duplicates.** `<!-- waits: bug/b --> <!-- waits: bug/a, bug/b -->` gives `["bug/b","bug/a"]`. A reader that sorts or keeps the repeat passes the two-name test and fails this one.
- **The live plans.** Parse both Draft plans named in #1153 and assert both waits. This is the measurement that killed the single-value reading.
- **A bad name beside a good one.** `<!-- waits: bug/a --> <!-- waits: <branch> -->` on a branch line gives `waits_on: ["bug/a"]` and one `unread_waits` row. The same marker on a prose line gives neither.
- **Beside `deferred:`.** The two existing tests (`waits:` and `deferred:` on one branch, both orders) hold with arrays. A greedy rewrite of the waits block can swallow the neighbour's marker.
- **Dispatch with two prerequisites.** `[merged, unmerged]` is refused and names the second. `[merged, merged]` dispatches. A dispatch reading nothing from a list passes the second and fails the first. It lives in `test/reconcile/dispatchwaits.test.mjs`.
- **Scan, end to end.** The fleet scan reports the slice `waiting` while one of two prerequisites has not merged, and the payload carries both names. Put both states in the test: with the first merged and the second not, and the reverse. A scan reading the first or the last name passes one of them.
- **Reconcile.** `unread_waits=1` on a branch line whose value is not a branch, `unread_waits=0` on every plan on `main`, and a two-marker line still counts as annotated in §18. The summary line and `plot-reconcile-scan.sh`'s header comment list the new counter, and `skills/plot/scripts/README.md` and the reconcile skill's output table name it.

Plus: rebuild the bundles with `pnpm build:board` and commit what changes. On a conflict in `board-server.mjs` do not read the diff: take either side and rebuild. Add a changeset for `plot` and `@plot-pm/board`, copying the format of `.changeset/a-closed-pr-carries-no-branch.md`: package frontmatter, the description first, the `plan:` and `bumps:` block last. Files in `.changeset/` that are not yours belong to sibling branches: touch none. Update the parser's header comment (`:133`) from *names ONE branch* to the list, and document `unread_waits` beside `unread_branch_headings` (`:203`).

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI. A failure there comes back as a correction. Do not run `pnpm run test:e2e`.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh`, never `gh pr create`. Append `→ #<number>` to this branch's line under `## Slices` in the plan when it exists. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-plan-meta.sh`, the `waits` handling in `plot-fleet-scan.sh` (`:3131-3140`, `:4353-4446`, `:4600-4700`), `waits_pairs` and its loop in `plot-dispatch.sh`, the `unread_waits=` section in `plot-reconcile-scan.sh`, `branchOf` in `plan-store-shell.ts` with its test, and the tests named above.

In flight and verified at dispatch: `bug/a-pr-carries-no-bundle` (#1257, `the-branch-carries-no-built-bundle`) edits `plot-fleet-scan.sh` at `:1996` and `:2032` only, the desk-reader filter, so the two do not overlap by line. No other open branch touches `plot-plan-meta.sh`, `plot-reconcile-scan.sh` or `plan-store-shell.ts`. Slice 1 changed the board and domain readers and is merged: do not edit `rules/`, `transitions/`, `entities/fleet.ts` or `entry/branch-state.ts` except to fix a defect your tests find in them, and report that defect in the PR body.

Not in scope: a wait across repositories (a prerequisite is a branch in this repo); a per-prerequisite answer in the pulse; wiring a caller for `prerequisiteCleared`. If you find a reader of `waits_on` the plan does not name, it belongs here (plan Notes): change it and say so in the PR body.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
