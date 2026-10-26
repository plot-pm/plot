## Implementation brief — release-deliver-and-merge-controllers-close (wave: Cleanup)

- **Plan (canonical):** docs/plans/2026-10-24-release-deliver-and-merge-controllers-close.md on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2505 merged
- **Branch:** `bug/remove-dead-pin-and-approve-branches` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per `Review: pr` — plan-PR convention, reviewed as a normal PR

This slice is independent of the plan's other four waves (Shared issues, Release chain, Merge path, One parser) — no ordering dependency either way. `bug/merge-pins-only-resolvable-short-shas` (Merge path) does not touch the files this slice owns; its own brief notes the same thing from its side. If both are in flight, there is no real conflict, only possibly nearby diff noise in `controller-gate.ts` if a future change touches it — not expected here.

### What to build

The plan groups four findings under "Dead code and a false changeset" (#2443, #2073). All four are still live on current `main` — none were already fixed by the three sibling slices that merged first:

1. **`approve.ts`'s dead `hostRefusal` precedence branch (LOW, #2443).** `packages/board/src/server/entry/approve.ts:1008-1011` guards `throw hostRefusal` behind `verdict.reason === 'pr-closed' || verdict.reason === 'pr-absent' || verdict.reason === 'pr-ambiguous'`. The comment immediately above it (lines 1000-1007) already says why this can never be true: whenever `hostRefusal` is set, the placeholder PR at line 939 is constructed as `{ number: 0, state: 'OPEN', draft: false }` — `state` is hardcoded to `'OPEN'`, so none of those three `verdict.reason` values can ever arise from it. Remove the dead `if` and its long guarding comment; `hostRefusal` should fall straight through to the unconditional `if (hostRefusal !== undefined) throw hostRefusal;` three lines below (line 1016), which already covers every other case. Keep that unconditional throw — it's the real precedence rule, just not the one with the comment.

2. **`gate.ts` keeps three names dead since `hostPinsMerges` narrowed to always-true (LOW, #2073).** PR #2067 (`Bitbucket merge pin`, commit `e639774`) changed `packages/board/src/server/entry/host-pin.ts:16`'s `hostPinsMerges` to unconditionally `return true` — Bitbucket's merge arm now re-reads the head and pins via `head-moved` refusal instead of being exempted. That made three things dead:
   - `pinUnavailable` (`packages/domain/src/rules/controller-gate.ts:382-383`) — `program === 'plot-host' && !hostPins`, where `hostPins` now always arrives `true`, so this always evaluates `false`.
   - `UNPINNABLE_NOTE` (`controller-gate.ts:386-387`) — only ever written at `gate.ts:685`, inside the branch `pinUnavailable` can no longer enter.
   - `canPinMerge` (`host-pin.ts:24-27`) — wraps `hostPinsMerges`, called from `approve.ts:1083` and `merge.ts:57`; both call sites branch on its result, and since it always resolves `true`, the `else` side of each branch is dead too. **Check both call sites** (not just the ones named in the plan) before deciding how far to simplify — a mechanical "always true" inline may be cleaner than keeping an async wrapper around a constant, but that's your call to make and record, not assumed here.
   - `gate.ts:632-684`'s TSDoc and inline comments reference `hostPinsMerges` under the *old* exemption behaviour ("allows `plot-host.sh pr-merge` unpinned where `plot-host.sh` resolves Bitbucket, which cannot pin" — compare the TSDoc at `controllerGateOf`, lines 613-635). Update the prose to state current behaviour: every backend now pins, full stop.

3. **The `plot-approve-reports-no-pr-found.md` changeset overclaims (LOW/MEDIUM, #2443).** `.changeset/plot-approve-reports-no-pr-found.md` (plan: `docs/plans/2026-10-23-plot-approve-reports-no-pr-found.md`) says the PR fixed issue #2407 — a held host refusal (e.g. HTTP 429 on `pr-list`) now reports its reason instead of "no PR found"/"no plan found". That description is accurate for *most* of what the PR did, but the one path item 1 above just named (the `pr-closed`/`pr-absent`/`pr-ambiguous` precedence guard) never did anything, because the state it switches on is hardcoded. **This changeset is already merged into `CHANGELOG.md:195`** (verify with `grep -n '2407\|held host refusal' CHANGELOG.md` before editing) — the generated changelog is not yours to hand-edit (see CLAUDE.md on the board artifact / generated output convention; same spirit applies to `CHANGELOG.md`, which `changeset version` regenerates on release). What you correct is the *source*: if the changeset file itself still exists unreleased in `.changeset/`, correct its description there; if it has already been consumed (which `grep` above will show), the "false changeset" finding is really about the dead code it describes, which item 1 removes — note in the PR description that the changeset text was already released and cite the CHANGELOG line, rather than silently editing published history.

4. **Two test files describe history instead of current behaviour (LOW, #2443, #2073).**
   - `packages/board/test/unit/approve.test.ts:253` carries a doc comment (directly above the `'reports slice-unnamed, not a held host refusal, when a plan fact refuses first'` test) explaining the *now-removed* precedence rule in detail. Once item 1 removes the dead branch, this comment's claim — "a held host refusal wins only over a refusal reached FROM the placeholder PR reading" — needs to either go or be rewritten to describe what `approve.ts` actually does post-cleanup. The test itself (asserting `slice-unnamed` still surfaces over a held host refusal) should keep passing unchanged; only the comment is stale, and only once the code it narrates is gone.
   - `packages/board/test/unit/merge-entry.test.ts:68`: `'pins on bitbucket too, which now honours --match-head via a re-read'`. "now" narrates the PR #2067 change rather than stating current behaviour. Rename to something like `'pins on bitbucket too, via a head re-read'` — check the rest of the file for the same pattern (`now pins`, `now requires`) per the plan's phrasing; `merge-entry.test.ts:56` in the plan's Motivation is this same file, just a different grep snapshot's line number.

### Decisions already settled — do not re-derive them

- **This slice does not touch `same-commit.ts`, sha-pinning length, or `approve.ts`'s status-posting sha.** That's the Merge path slice (`bug/merge-pins-only-resolvable-short-shas`), already Started. Its own brief confirms `writeApprovalStatus` and the `--match-head` call already use the full `pr.headSha` — nothing for this slice to do there.
- **Do not hand-edit `CHANGELOG.md`.** It's generated by `changeset version` on release; a PR that touches it directly gets flagged. If the #2407 changeset text needs correcting and it's already been released (check first), say so in the PR description instead of editing the generated file.
- **`canPinMerge`/`hostPinsMerges` removal is a judgment call on how far to go, not a fixed scope.** The plan says "remove the dead approve.ts and gate.ts code" — it does not mandate collapsing `canPinMerge` into a literal `true` at both call sites versus keeping it as a one-line documented constant for future hosts that might not pin. Either is defensible; pick one, and say why in the PR description. What is NOT optional: `pinUnavailable` and `UNPINNABLE_NOTE` are unreachable now and must go, since nothing in the plan's other slices reintroduces a host that can't pin.

### Done when

The plan's `## Done when` states: "Dead branches in `approve.ts` and `gate.ts` are removed, and the changeset for #2407 describes what the code does." Concretely:

- `approve.ts`'s `pr-closed`/`pr-absent`/`pr-ambiguous` precedence guard and its comment are gone; `hostRefusal` still throws unconditionally when set (the line below it, already there).
- `gate.ts`'s `pinUnavailable`/`UNPINNABLE_NOTE` call sites are gone or no longer reachable by construction (not just by a `false` runtime check) — if you keep `canPinMerge`, its callers' dead `else` branches in `approve.ts:1083` and `merge.ts:57` are simplified too, consistently with whatever you decide for `canPinMerge` itself.
- `controller-gate.ts`'s `pinUnavailable`/`UNPINNABLE_NOTE` exports are removed if nothing calls them after the above, not left as unused exports.
- `gate.ts`'s `controllerGateOf` TSDoc states current behaviour (every backend pins), not the pre-#2067 exemption.
- The #2407 changeset situation is resolved per the decision above (corrected in place, or explained as already-released in the PR body) — not silently left contradicting the code.
- `approve.test.ts`'s stale precedence comment is rewritten or removed to match post-cleanup code; its test assertions still pass unchanged.
- `merge-entry.test.ts`'s `now honours`-style test names are rewritten to state current behaviour; check the whole file for the same pattern, not just line 68.
- Every existing test in `approve.test.ts`, `merge-entry.test.ts`, and any test exercising `controller-gate.ts`'s `pinUnavailable`/`UNPINNABLE_NOTE` still passes — a removed branch that was genuinely dead should have no test depending on it firing; if you find one that does, that's a sign the branch was not actually dead, and you should stop and report it rather than deleting the test to make the removal pass.

Plus the repo's gates: no bundle diff (`scripts/check-no-bundle-diff.sh` — this slice touches `packages/board/src/server/entry/*` and `packages/domain/src/rules/controller-gate.ts`, not the board bundle itself, but verify `git status` is clean of generated paths before pushing — run `pnpm build:board` only to test locally, never commit it). A changeset for this fix, description first and `bumps:` block last (CLAUDE.md § Versioning); `plan:` line pointing at this plan is optional but welcome. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it resolves `@plot-pm/board`'s and `@plot-pm/domain`'s related vitest suites and typecheck for the files you touch. The `CI suites` config key's suites run in CI on every PR; do not run the full suite locally.

Name the shell gate too, even though this slice is TypeScript-only: `scripts/check-shell-lines.sh` only fires if you touch a `.sh` file under `skills/`, which this slice's scope does not require.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR through the controller, not `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

It reads the plan and opens the PR titled from this slice's wave heading, with the plan and this brief linked in the body. When the PR exists, append `→ #<number>` to this branch's line under `### Cleanup` in the plan's `## Slices` section, on `main`.

### Scope guard

This branch owns: `packages/board/src/server/entry/approve.ts` (the `hostRefusal` precedence branch only — not the sha/pin logic the Merge path slice owns), `packages/board/src/server/entry/gate.ts` (TSDoc and the `pinUnavailable`/`UNPINNABLE_NOTE` call site), `packages/board/src/server/entry/host-pin.ts` (`canPinMerge`, if you simplify it), `packages/domain/src/rules/controller-gate.ts` (`pinUnavailable`, `UNPINNABLE_NOTE` exports), `.changeset/plot-approve-reports-no-pr-found.md` (if still unreleased), `packages/board/test/unit/approve.test.ts` (comment only, near line 253), `packages/board/test/unit/merge-entry.test.ts` (test names, near line 68 and any sibling with the same pattern).

Other branches from this plan, in flight or pending, and what they hold (verified against the plan's `## Slices` section at brief-writing time, not guessed):
- `bug/shared-issue-close-reads-every-sibling` — Started 2026-10-24, PR #2578 — `deliver.ts` sibling-read and skip-list logic. No file overlap.
- `bug/release-chain-reads-every-page-and-hop` — Started 2026-10-25, PR #2686 — `pr-merge-dest`, `release-chain.ts`. No file overlap.
- `bug/merge-pins-only-resolvable-short-shas` — Started 2026-10-25, PR #2691 — `same-commit.ts` and its corpus test, `plot-host.sh`'s Bitbucket pin-matching expression; its own brief explicitly confirms it does not touch `controller-gate.ts`. No file overlap with this slice.
- `bug/one-remote-url-parser` — not yet started — `remote-slug.ts`, `pathOf`, `bitbucket-slug.ts`'s doc comment, the same-commit corpus test's relationship to `plot-host.sh`, the CHANGELOG `#N`-in-code-spans generator fix. No file overlap with this slice.

If you find a fifth dead-code site the plan did not name, or discover that one of the four items above was already fixed on `main` (re-check each against `HEAD` before writing a test, per the plan's own Open Question #4), report it in the PR description rather than silently expanding or shrinking scope.
