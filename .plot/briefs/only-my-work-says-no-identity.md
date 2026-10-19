## Implementation brief — only-my-work-says-no-identity

- **Plan (canonical):** [docs/plans/2026-10-19-only-my-work-says-no-identity.md](../../docs/plans/2026-10-19-only-my-work-says-no-identity.md) on `main`
- **Approved:** 2026-10-19, Jan Wloka, plan-PR #2081 merged
- **Branch:** `bug/only-my-work-says-no-identity` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per plan (`Review: pr`)

Single-slice plan — no wave ordering to track.

### What to build

A browser test proving the symptom, then the fix. On 2026-10-19 the Delivery
tab's "Only my work" control showed `no identity configured — nothing to
match` while `/api/board` answered `{"hostUser":"jwloka","gitEmail":"jan.wloka@quatico.com", ...}`
non-empty. `AgentList.tsx:976` computes `const known = (reader.hostUser ?? '') !== '' || (reader.gitEmail ?? '') !== ''`
and renders the "no identity" hint when `known` is false — so `known` was
false against a payload that was not.

### The investigation already narrowed — do not re-walk the other two candidates

The plan's Design section lists three candidates. One is now backed by code,
read during brief-writing, not by re-deriving from scratch:

**Candidate #1 (cast, not parsed) is the live lead.** `App.tsx:340` reads
`const data = (await res.json()) as Board | { error: string }` — a type
assertion, never `BoardSchema.parse()`/`.safeParse()`. Grepping `App.tsx` for
`.parse(` and `safeParse` returns nothing. `ServerInfoSchema` exists
(`contract/schema.ts:1256`, used as the `.default({...})` for the `server`
field) and would catch a payload missing `hostUser`/`gitEmail`, but nothing on
this path calls it. If the server occasionally answers (or the client
occasionally receives) a `server` object missing those two fields, the cast
accepts it silently and `reader.hostUser`/`reader.gitEmail` read `undefined`
— which `readerFrom` (`mine-filter.ts:120`) passes straight through as
`undefined`, and `known` reads false. Check first: does adding a real parse at
the `App.tsx:340` boundary ever reject a payload in practice (log what it
rejects before deciding), or does it always validate clean — which would kill
this candidate and point back at #2/#3.

**Candidate #3, sharpened: there are TWO independent reader memos, not one.**
`App.tsx:146` already computes `const reader = useMemo(() => readerFrom(board?.server), [board?.server])`
— a value `App.tsx` holds but, as far as this brief's reading went, does not
appear to pass to `AgentList`. `AgentList.tsx:465` computes its own,
independent `const reader = useMemo(() => readerFrom(server), [server])` from
a `server` *prop*. Two memos deriving the same thing from what should be the
same source is exactly the shape that diverges: confirm what `App.tsx:146`'s
`reader` is actually used for (if anything — it may be dead code, which is
its own small finding worth a line in the PR), and confirm the `server` prop
`AgentList` receives is the SAME object `board?.server` that backs the
`App.tsx` memo at the moment the hint renders, not a stale closure over an
earlier `board` render.

**Candidate #2 (stale bundle) is the fast, cheap elimination.** The board
does not reload its own bundle on a file change alone — a server restart is
not enough: fast-forward AND restart, then verify the *served* page (fetch
it), not just that the file on disk changed. Rule this out first if the
repro does not reproduce against a fresh `pnpm build:board` + restart — if
it only reproduces against a stale bundle, that IS the bug and no code in
`App.tsx`/`AgentList.tsx` needs to change.

**Rule placement, already decided by the plan — do not relitigate it.**
Whether `known` holds is a *rendered* view state (the hint shown/hidden), so
per *Every rendered state is a domain property* (root `CLAUDE.md`) it moves
into `mine-filter.ts` (or the ownership rule) as a property of the reader,
with its own unit test — not computed inline in the component as it is today
at `AgentList.tsx:976`. The browser test proves the hint renders correctly;
the unit test proves `known`'s logic without a browser.

### Done when

The plan's Done when is implicit in its single slice — treat this as the
specification:
- A browser test exists where `/api/board` names `hostUser` or `gitEmail`
  non-empty and the "no identity configured" hint is **absent**.
- The fix (wherever the investigation lands — parse boundary, prop plumbing,
  or bundle staleness) makes that test pass.
- `known` (or its replacement) is extracted as a domain property with its own
  unit test — not left as an inline boolean in `AgentList.tsx`.

Also assert the inverse explicitly: a reader with BOTH `hostUser` and
`gitEmail` empty still shows the hint — a fix that makes the positive case
pass by always showing `known: true` would be wrong and this is the test
that would catch it.

Plus: any generated board artifact this branch touches must not be
committed (`scripts/check-no-bundle-diff.sh` — run `pnpm build:board` only to
verify locally, then restore generated paths before pushing). Run
`node ../plot/scripts/board/plot-local-checks.mjs` before each push and run
what it prints — the suites in `CI suites` run in CI, not locally; a failure
there comes back as a correction. List no full suite.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows
past its merge base — not expected to apply here (`packages/board/src/app`
only), but if the slice touches a `.sh` file, growth must be paid for by
removing shell elsewhere in the same change.

### Bookkeeping

Open the PR through the controller once the branch has its first real
commit:

```bash
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Do not run `gh pr create` directly. When the PR is created, append
`→ #<number>` to this branch's line in the plan's `## Slices` section.

### Scope guard

- This branch owns `packages/board/src/app/components/AgentList.tsx`,
  `packages/board/src/app/lib/agent-rows/mine-filter.ts`, `packages/board/src/app/App.tsx`
  (read-mostly — only the reader-memo plumbing, if that's where the fix
  lands), and whichever domain/rule module `known` moves into.
- No other branch is in flight against this plan (single-slice plan, no
  waves). Verified at brief-writing: no local or remote branch named
  `bug/only-my-work-says-no-identity` existed yet, and no commits landed on
  `packages/board/src/app` since the plan's approval today.

If the investigation turns up a fourth candidate the plan does not name,
report it rather than improvising a fix outside this scope.
