## Implementation brief — an-issue-shows-its-plan-s (wave: Plan source)

- **Plan (canonical):** [docs/plans/2026-11-01-an-issue-shows-its-plan-s.md](../../docs/plans/2026-11-01-an-issue-shows-its-plan-s.md) on `main`
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #2998 merged
- **Branch:** `bug/an-issue-reads-its-plan-from-main` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (`plot-review`, gated on CI green)

This is the first wave. Three later waves wait on it: `bug/an-added-issue-owes-its-phase` and `bug/settled-finding-tickets-close` wait on the sibling wave `bug/the-plan-comment-has-one-writer` (not this one), but the plan's Notes section records a cross-plan order — `every-plan-reference-shows-its-issue`'s slice `feature/the-fleet-payload-indexes-its-plans` builds `/api/fleet`'s plan index from the metas `planMetasOf` returns, so **this branch merges before that one** (the moderator recorded the same order in that plan too). `bug/a-slice-row-reads-its-head-s-checks` is independent of this wave and may run concurrently.

### What to build

Today, three separate call sites read "which plans name this issue" by walking the **local working-tree checkout** with `fs.readdirSync` — `planMetasOf` (`packages/board/src/server/fleet.ts:1583-1619`), and a second, independent copy of the same walk in `referencedIssues` (`packages/board/src/server/idea.ts:401` onward). Both miss a plan the moment it merges on `origin/main` but the local checkout hasn't moved. Measured 2026-11-01: issue #2993's plan (PR #2994 merged, slice PR #2996 open) showed *Open* on the Stories tab while the Delivery tab — which already reads `origin/main` via a different path — showed it correctly in progress. The local checkout was 10 commits behind.

Build **one** new board helper, `planMetasAtDefault`, that replaces `planMetasOf`'s body and becomes the single source `ticketPlansOf`, the lanes (`ticketLaneData`), and `idea.ts`'s `referencedIssues` all call. `referencedIssues` in `fleet.ts` goes away entirely once nothing calls it.

1. Resolve `origin/<default>` once to an oid.
2. List the plan directory at that oid with **one** `Refs.listBlobs` call (`git ls-tree`) — the same port method `readPlansFromRef` already uses at `packages/board/src/server/board.ts:716`.
3. Read every plan blob with **one** `Refs.readBlobs` call (`git cat-file --batch`) — same port, same file, `:744` onward. Follow its exact batching contract: parse by declared byte length, never by string index (the file's own comment at `:705-710` explains why — `—`/`→` desync UTF-16 length from byte length).
4. Stage those blobs plus the open draft plans (`draftPlanFiles`, `fleet.ts:1676`) to one scratch directory, and parse them in the single existing `scriptsFor(opts).planMeta(files)` call `planMetasOf` already makes — `plot-plan-meta.sh` takes paths, not blobs, so staging to scratch is still required.
5. Where `origin/<default>` does not resolve (no remote, never fetched), fall back to the working tree's plan directory — this is `plan-walk-estate.ts:71-73`'s existing rule, reused rather than reinvented.
6. On any failure — unresolved ref, a listing or blob-read or parse failure — answer `null`, **never** an empty list. `fleet.ts:1553-1556` already documents why: an empty list reads as "nothing is planned" and would surface every tracked issue as unplanned. Every existing caller's null branch is unchanged.
7. Keep Released, Rejected and Superseded plans in the result (the pulse already drops Released plans for a different reason — `fleet.ts:1540-1547` — and this helper must not inherit that).
8. Read no pulse. The pulse holds release scope only; it is not a valid substitute source.

### The decisions the plan settles — do not re-derive them

**Why not read through the pulse or the domain's `readEstate`?** Two alternatives were raised and rejected by the panel (`.plot/panels/an-issue-shows-its-plan-s/panel.md`, decided 2026-11-01): the pulse drops Released plans and carries only release scope (`fleet.ts:1540-1547` states why `referencedIssues` must keep them); `readEstate` with a new `PlanRecord.issues` field is recorded as a **later** option (Notes section) because it needs a port change the walk's own slices ("the-plan-walk-moves-into-the") are still touching. Building that now would mean touching a port mid-flight under another plan — don't go there.

**Cost and caching are settled with real numbers, not guesses.** Measured 2026-11-01 on this machine: the working-tree parse running today takes 598-673ms for 623 plans — **not** the 132ms the comment at `fleet.ts:1549-1551` currently claims for 59 plans (that comment is stale and this slice corrects it). `ls-tree` + `cat-file --batch` take 63ms for 623 blobs (7.5MB); parsing the staged blobs takes ~780ms — slower than the stale 132ms figure, which is why the helper **must** cache: key the cache entry on the resolved `origin/<default>` oid plus the tip oid of every draft branch read, **never on a ref name**. A request whose key matches spawns only the cheap `rev-parse` + `for-each-ref` needed to compute the key, not the parse.

**`idea.ts:401`'s exported name and injectable `deps.referenced` stay.** `idea.ts:473` already has `const readReferenced = deps.referenced ?? referencedIssues;` for test injection — keep that shape, just make the body call the new shared helper so the two readers can never drift apart again. Also make it count open draft plans (it currently doesn't), which closes a second gap: a second `/plot-idea` run for an issue whose plan is still under review should be refused too.

**This is Gap 1 and Behaviour 1 only — gaps 2-5 are separate slices/waves and out of scope here.** Specifically: no `released-labels.ts`, no `review-issue.ts`, no `tracker-plan-state.ts`, no `pr-row.ts` changes belong on this branch. `TicketLaneReading.plans` / `TicketLanesReading.plans` (Behaviour 1's domain-side type change, from `boolean`/`Set<string>` to `readonly TicketPlan[]` / `ReadonlyMap<string, readonly TicketPlan[]>`) **is** in scope — it's how the lane rule gets the data this slice now supplies.

**Lane precedence is a straight port of `ticketPhase`'s existing order, not new policy.** `ticketPhase` (`packages/domain/src/rules/ticket-phase.ts:51`) already ranks `draft`/`design` → Open, `approved` → In progress, `delivered` → Done. For an open issue, the **least advanced** placed plan decides. All-Released/Rejected/Superseded named plans → Open (reopened, or no live plan answers it). No named plan → Open. A stated tracker `statusCategory` (Jira) or a closed issue still wins first, unchanged from today.

**`fleet.ts` is churning — rebase before review, not just before merge.** The Notes section flags 24 commits touching this file between 2026-10-25 and 2026-11-01 (two more landed today per the staleness check run before this brief was written, both unrelated plan-walk work with no overlap on `planMetasOf`'s body). Confirmed clean at dispatch time; re-verify at review time regardless.

### Done when

The plan's `## Done when` table rows tagged **Plan source** are the specification — nine rows, spanning `packages/domain/test/ticket-lane.test.ts`, `ticket-lanes.test.ts`, and `packages/board/test/unit/fleet.test.ts`, `offline-issue-rows-into.test.ts`, `idea-route.test.ts`. Call out the ones a naive port would pass without:

- **"An unreadable ref is not 'nothing planned'"** — `origin/main` resolves but `cat-file` fails → helper answers `null`, and the lanes **keep their last answer** rather than clearing. A naive implementation that falls through to an empty array on any exception fails this silently; it looks identical to "no plans" until an issue vanishes from every lane.
- **"The cache keys on the oid"** — two reads at one oid cost one parse; a new commit forces a second. A naive cache keyed by wall-clock TTL or ref name passes functionally but violates the whole reason the cache exists (correctness on exactly this kind of staleness), and reintroduces a race between "ref moved" and "cache still warm."
- **"A merged plan names its issue with a stale checkout"** — the literal regression case: git sandbox whose `origin/main` is one commit ahead of the checkout, new commit adds a plan naming #7. Old code lanes it Open; this must lane it by the plan's actual phase.
- **"A released plan keeps its issue named"** — don't accidentally filter Released out while fixing the pulse-vs-default-branch split; a plan reader that copies the pulse's Released-dropping behavior passes everything else and fails only this row.

Plus: the repo's gates — no committed `board-server.mjs` diff (`scripts/check-no-bundle-diff.sh`), a changeset naming `plot` or `@plot-pm/board`. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it maps changed paths (`packages/board/**`, `packages/domain/**`) to the right suites and gate tests. The suites in the `CI suites` config key run in CI; a failure there comes back as a correction. List no full suite.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grew past its merge base. This slice should need no `.sh` changes at all — if it turns out to, pay for the growth in the same change (remove shell elsewhere, or push the rule into the domain and ask it through a bundle). The gate counts commands, not lines; joining with `;`/`&&` or folding `fi`/`done` onto the prior line is not a payment.

### Bookkeeping

Open the PR through the controller once there's a first real commit: `../plot/scripts/plot-open-pr.sh` (or `--draft` while still moving). Do not run `gh pr create` — it takes its title from the last commit subject, which is not the wave heading the controller would use. Once the PR exists, append `→ #<number>` to this branch's line under the plan's `## Slices` → `### Plan source` heading, and push the first real commit as soon as it exists so the branch isn't silently idle.

### Scope guard

**This branch owns:** `packages/board/src/server/fleet.ts` (`planMetasOf` → `planMetasAtDefault`, `ticketPlansOf`, `ticketLaneData`, removing `referencedIssues`), `packages/board/src/server/idea.ts` (`referencedIssues`'s body only — keep its exported name and `deps.referenced` injection point), `packages/domain/src/rules/ticket-lane.ts` (`TicketLaneReading.plans`), `packages/domain/src/rules/ticket-lanes.ts` (`TicketLanesReading.plans`), `packages/board/src/server/discovery-lanes.ts` (passes the new map through).

**Other branches in flight, verified at dispatch time (2026-11-01):** none of this plan's other five branches (`bug/the-plan-comment-has-one-writer`, `infra/released-issues-carry-their-label`, `bug/an-added-issue-owes-its-phase`, `bug/settled-finding-tickets-close`, `bug/a-slice-row-reads-its-head-s-checks`) have started yet — no `Started:` records exist on the plan. `fleet.ts` itself saw two commits land today (`6de0ed8ef`, `0846ab0e1`) from the unrelated `the-plan-walk-moves-into-the` plan — both touch call sites near but outside `planMetasOf`'s body (3 and 11 lines respectively, plumbing for `plan_source: worktree`), confirmed non-overlapping with this slice's target lines (`:1583-1619`) at dispatch time. Rebase on `origin/main` before opening the PR regardless, since this file churns fast.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
