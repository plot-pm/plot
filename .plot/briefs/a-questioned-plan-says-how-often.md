## Implementation brief — a-questioned-plan-says-how-often (wave Noticing)

- **Plan (canonical):** `docs/plans/2026-09-01-an-interrogation-records-itself.md` on main
- **Approved:** 2026-09-01, Jan Wloka, in-session
- **Branch:** `bug/a-questioned-plan-says-how-often` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

The plan's second and last wave. `Recording` is `docs/an-interrogation-writes-its-round` → #599, and it owns the skill sentence and the plan-format documentation for `Rounds:`. Check whether #599 has merged before you start: if it has not, this branch is still independent of it, because this wave adds a scan section and touches neither the skill nor the docs.

### What to build

A thirteenth section in `skills/plot/scripts/plot-reconcile-scan.sh` that reports a Draft plan amended since its last recorded interrogation round, plus a `rounds_drift=` counter in the machine-countable footer.

The finding is the **disagreement** between a plan's edit history and its stated rounds. A plan that records no round is not a finding: an unquestioned plan is honestly unquestioned. A plan that records round 2 and has been rewritten twice since is the case the board's badge gets wrong, because the badge shows 2 and the reader cannot see that the questioning predates the current text.

### The decisions the plan settles — do not re-derive them

**A MISSING ROUND IS NOT A DEFECT.** The plan states it directly: *"a plan nobody has questioned is honestly unquestioned."* So a plan with no `Rounds:` field produces no finding here. Only a plan that HAS a round and has been amended after it can disagree with itself.

**CONVENIENCE, NEVER A GATE.** Section 10 is the precedent and its comment states the reason: `attention=` is load-bearing, because `/plot-deliver`'s delivery-landed gate and the `/plot` hygiene line both read that number from the footer. A stale round is a hint about a badge; it must not stop a delivery. Carry a separate footer counter the way `unsliced_waves=`, `prose_wave_names=`, `sprint_drift=`, `stale_tally=`, `index_drift=` and `double_claims=` each do, and stay out of `attention=`.

**PLACEMENT: LAST, AFTER SECTION 12.** Section 12's comment states the constraint and it applies unchanged here: `/plot-deliver`'s gate marker is `sed -n '/^== 7./q;p'`, which stops before the first non-blocking section, and that stays true only while nothing is inserted below 7. Number the new section 13 and put it after 12, so every existing section number keeps its meaning.

**`rounds: 0` AND ABSENT ARE DIFFERENT VALUES, AND THE PARSER ALREADY SEPARATES THEM.** Measured 2026-09-01 on the current tree: a plan with `- **Rounds:** 0` emits `"rounds":0`, and a plan with no `Rounds:` line emits no `rounds` key at all. `PlanCard.tsx:284` renders no badge for either and says why — *"No badge where the plan records no interrogation: silence, not a zero."* Read the key's PRESENCE, not its truthiness: a shell test that treats `0` as empty would silence the one plan that has explicitly said it was never questioned.

**THE PARSER IS THE SOURCE, NOT A SECOND GREP.** `plot-plan-meta.sh` already reads `Rounds:` from three sources in a fixed order — `## Status` first, YAML front matter second, the `CHALLENGE-THE-PLAN-METADATA` block last — and the scan already captures its output as `plan_json` at `skills/plot/scripts/plot-reconcile-scan.sh:396`. Read `rounds` from there. Re-deriving it with a grep would reproduce the defect wave 1 of the reslice work removed, one layer up, and would silently disagree with the board whenever a plan uses front matter or the block.

**A FILE WITH NO `Phase:` IS NOT A PLAN.** Sections 1, 7, 8 and 12 all skip such a file, and `docs/plans/` holds decision logs and worker reports. Apply the same rule.

**REJECTED — INFERRING ROUNDS FROM GIT HISTORY.** The plan settles this: bookkeeping commits, PR annotations and phase flips all touch a plan, so a commit count over-counts; an interrogation whose findings land in one commit under-counts. *"A round is a judgement about what happened, not a diff count."* This section does not count rounds. It compares a recorded round against an edit date, and reports only that the two disagree.

**THE COMPARISON NEEDS A DATE THE ROUND WAS RECORDED IN.** The plan does not settle how to obtain it. Decide it, state your choice in the section's comment, and keep the finding weaker than the fact. `git log -1 --format=%ct` on the plan file gives the last edit; `git log -S` on the `Rounds:` line gives the commit that last changed the recorded value. The scan already uses `git log -1 --format=%ct` at line 461. Report the comparison you actually made and name the commit you compared against, the way the brief-staleness report does — a hint that names its inputs can be judged, a bare verdict cannot.

**SCOPE: DRAFT PLANS.** The plan says *"a Draft plan that has been amended since its last recorded round."* An Approved plan has passed the review the questioning feeds; a Draft plan is the one whose card a reader judges by the badge. Only one plan in `docs/plans/` is Draft today, so build the fixture rather than relying on the live estate.

### Known tripwire

`test/reconcile/scan.test.mjs:264` asserts the **exact** footer string:

```
summary: drift=2 merged_not_delivered=1 stale=2 claims=0 attention=1 concurrent=2 unreleased_delivered=1 unsliced_waves=0 prose_wave_names=0 sprint_drift=0 stale_tally=0 index_drift=3 double_claims=0 pr_source=degraded main=main
```

A new counter breaks that assertion by design. Update the expected string in the same commit that adds the counter; the exactness is the ratchet and it is doing its job.

### Done when

- The scan reports a Draft plan whose recorded round predates its last amendment, and names the round and the commit it compared against.
- A plan with **no** `Rounds:` field produces no finding. Assert this — it is the half a careless implementation gets wrong.
- A plan recording `Rounds: 0` is treated as a recorded value, not as absence. Assert it separately from the case above.
- The finding appears in section 13 and **not** in section 5, and `attention=` is unchanged by it. Assert the footer.
- The footer carries `rounds_drift=` and `scan.test.mjs`'s exact-footer assertion is updated to match.
- Sections 1 through 12 keep their numbers, so `sed -n '/^== 7./q;p'` still cuts where `/plot-deliver` expects.

### Repo gates

Node 24 (`nvm use`). `pnpm test`, `pnpm run test:reconcile`, `pnpm run typecheck`. Run `pnpm run test:board` if you touch anything the board reads; this slice should not. **Do not run `pnpm run test:e2e`** — it is CI's gate, it dispatches real workers, and two concurrent local runs took this machine to load average 8.69.

### Changeset

`'plot': patch`, **description first**, `bumps:` block last. Changesets publishes the first line after the frontmatter, so a `bumps:` block written first becomes the release note and the description behind it never ships.

### Bookkeeping

- Push the first real commit as soon as it exists — the ref push is the claim.
- When the PR exists, append `→ #<number>` to this branch's line under `## Branches`.
- **Never begin a line with a backticked branch name** in a Branches section: the loose matcher reads it as a claim, the anchored one does not, and `parser.test.mjs`'s estate-wide differential fails.

### Scope guard

**This branch owns** `skills/plot/scripts/plot-reconcile-scan.sh` and `test/reconcile/scan.test.mjs`.

**It does not own** `plot-plan-meta.sh`'s parsing, which already works; `PlanCard.tsx`, which already renders; or `skills/challenge-the-plan/SKILL.md` and the plan-format docs, which belong to #599.

Report anything the plan did not anticipate rather than improvising outside scope.
