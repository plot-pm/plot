## Implementation brief — a-merge-refuses-when-the-head

- **Plan (canonical):** docs/plans/2026-10-18-a-merge-refuses-when-the-head.md on main
- **Approved:** 2026-10-18, Jan Wloka, plan-PR #2061 merged
- **Branch:** `bug/a-merge-refuses-when-the-head` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** pr

This plan has one slice and one branch — no wave ordering to track.

### What to build

On Bitbucket, `plot-host.sh pr-merge --match-head <sha>` exits 4 with
"cannot pin a merge to a commit" (`skills/plot/scripts/plot-host.sh:3940`)
and merges unpinned. On GitHub the same flag passes through to
`gh pr merge --match-head-commit` (`skills/plot/scripts/plot-host.sh:3939`),
so a push landing after review and checks refuses the merge there but not
on Bitbucket. The gate (`packages/board/src/server/entry/gate.ts:559`,
via `hostPinsMerges` in `host-pin.ts:12`) and `CLAUDE.md` both currently
encode this as an accepted exemption rather than a gap to close.

Close it: the Bitbucket arm of `pr-merge` must refuse with `head-moved`
(the same refusal name `packages/domain/src/workflows/merge.ts:97` already
uses for GitHub) when the PR head differs from the caller's `--match-head`
sha — either by passing a real precondition to Bitbucket's merge endpoint,
or by re-reading the head immediately before merging and refusing on a
mismatch. The plan is canonical for the full design; this is orientation
on where the seams are.

### The decisions the plan settles — do not re-derive them

**Measure before choosing the mechanism.** The plan's step 1 is not
optional ceremony: whether Bitbucket Cloud's merge endpoint
(`POST /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/merge`)
accepts a head/version precondition decides between step 2 (pass it
through, exact GitHub parity) and step 3 (re-read-then-merge, a reduced
but nonzero window). Do this measurement first and record the result with
its date in the plan's `## Notes` — don't guess and don't skip straight to
implementing the re-read fallback because it looks safer; the plan
explicitly wants the stronger mechanism if the endpoint supports it.

**No new refusal word.** `head-moved` already exists in
`packages/domain/src/workflows/merge.ts:13` and is raised at line 97 for
exactly this condition (`pr.headSha !== input.sha`). The Bitbucket arm
reuses that name verbatim — this is a parity fix, not a new vocabulary
addition.

**The gate exemption is bitbucket-specific and lives in two places that
must move together.** `hostPinsMerges` (`host-pin.ts:12`) returns `false`
for `bitbucket`, and `gate.ts:559` calls it via `pinUnavailable(...)` to
let an unpinned Bitbucket `pr-merge` through the controller gate. Once the
Bitbucket arm honours `--match-head` (by either mechanism), both must be
updated together — leaving one stale means either the gate still waves
through what is now pinned (silently correct but misleading), or it
refuses what is now safe (a regression). `CLAUDE.md`'s "The Master Agent
Uses The Controllers" section states this exemption in prose (around the
"except where `plot-host.sh` resolves Bitbucket, which cannot pin a
merge" sentence) — rewrite it to state the new result, then run
`scripts/check-agents-md.sh --write` so `AGENTS.md` regenerates; CI
refuses a mirror that differs.

**Exit code 4 is the existing "refused, nothing merged" signal.** The
current Bitbucket refusal (`plot-host.sh:3940`) already exits 4 for the
unpinnable case. Confirm whatever exit code the new `head-moved` refusal
uses is consistent with how `plot-ask.mjs merge` maps refusals today —
don't introduce a second exit code meaning the same thing without reading
how the existing mapping works first.

**Absent is not false.** No PR head field, no `bb` CLI precondition
support, or an unreadable Bitbucket response should read as "proceed
unpinned" — treat an inability to confirm the head as a refusal, not a
green light, consistent with how this estate treats every other missing
answer as "ask the host" rather than "assume safe."

### Done when

The plan's `## Done when` is implicit in its `## Slices` line: "Tests
cover a head that moved between check and merge: the merge refuses with
`head-moved` and nothing merges, and a matching head merges." Both halves
need their own test — a passing case alone would not catch a refusal that
never fires, and a refusing case alone would not catch one that always
fires.

Plus: the repo's gates. `scripts/check-shell-lines.sh` refuses a PR whose
shell under `skills/` is longer than at its merge base — this slice edits
`plot-host.sh`, so any net growth must be paid for by removing shell
elsewhere in the same change, or by moving the logic into the domain and
calling it through a bundle. The gate stores no number and has no
override. Run `node skills/plot/scripts/board/plot-local-checks.mjs`
before each push and run what it prints — the suites in the repo's `CI
suites` config key run in CI, and a failure there comes back as a
correction. Don't run a full suite preemptively.

### Bookkeeping

Open the PR through the controller once the branch has its first real
commit: `../plot/scripts/plot-open-pr.sh` (or `--draft` while still
moving). Do not run `gh pr create`. When the PR exists, append
`→ #<number>` to this branch's line under
`docs/plans/2026-10-18-a-merge-refuses-when-the-head.md`'s `## Slices`
section. Push the first real commit as soon as it exists rather than
batching.

### Scope guard

This branch owns: `skills/plot/scripts/plot-host.sh` (the Bitbucket
`pr-merge` arm), `packages/board/src/server/entry/host-pin.ts`,
`packages/board/src/server/entry/gate.ts` (the Bitbucket exemption only),
`CLAUDE.md` (the one sentence naming the exemption, plus the generated
`AGENTS.md` mirror), and this plan's `## Notes` (recording the Bitbucket
Cloud merge-endpoint measurement). No other branch is in flight for this
plan — it has exactly one slice and one wave.

If the Bitbucket Cloud API measurement turns up something the plan did
not anticipate (e.g. a precondition that only partially covers the race,
or an endpoint that requires a different auth scope), report it rather
than improvising a workaround outside this scope.
