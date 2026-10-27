## Implementation brief — plot-undeliver-never-refuses-refs-swept (wave 2: Controller)

- **Plan (canonical):** `docs/plans/2026-10-27-plot-undeliver-never-refuses-refs-swept.md` on `main`
- **Approved:** 2026-10-27, Jan Wloka, plan-PR #2787 merged
- **Branch:** `bug/plot-reject-calls-plot-undeliver` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR
- **Issue:** #2764

Wave 1 (`bug/plot-undeliver-reads-slices`, → #2795) merged. `plot-undeliver.sh`
now reads both slice formats, decides `refs-swept` / `refs-unknown` through the
domain, records its own state receipt, and moves the `delivered/` → `active/`
index entry. `owningCommand` already names `/plot-reject` for Delivered →
Approved (`packages/domain/src/rules/state-transition.ts:146`). This wave is
unblocked — build on `main`, not on the old branch.

### What to build

`skills/plot-reject/SKILL.md` steps 3–6 predate `plot-undeliver.sh` and do not
call it. Step 3 shells out to `gh pr list --state merged --head <branch>`
directly. Step 4 writes `**State:** Delivered` → `**State:** Approved` by hand
and declares that write with `plot-state-receipt.sh --unowned`, citing its own
reason text: *"/plot-reject has no controller — the backwards move has no rule
at all"*. Step 5 moves the plan from `docs/plans/delivered/` to
`docs/plans/active/` by hand (`git rm` the old symlink, `ln -s` a new one).
None of this can refuse: a rejection on a plan whose refs are actually still
in flight, or whose origin is unreachable, proceeds anyway, because nothing in
the skill can say `refs-swept` or `refs-unknown`.

Rewrite steps 3–6 to call `plot-undeliver.sh <slug> --why <reason>` once, and
delete everything it now makes redundant:

1. **Step 3** asks merged state through `plot-pr-merged.sh`'s `pr_merged`
   (sourced, three-reading result: `found` / `none` / `unaskable`) in place of
   the direct `gh pr list` call, for the "M/N branches built" report shown to
   the operator before confirmation. This is reporting only — it does not gate
   anything and does not duplicate the domain's `refs-swept` rule; it exists so
   the person approving the rejection sees the same shape of answer
   `plot-undeliver.sh` will act on a moment later.
2. **Step 4** calls `plot-undeliver.sh <slug> --why <reason>` instead of
   editing `State:` by hand. The script performs the whole write: `State:`
   flips to whatever the domain decided (normally `Approved`, but a refusal
   means nothing was written — see below), the `Rejected:` record is added
   above the kept `Delivered:` line, and the script's own
   `record_state_receipt` call declares it. **Delete the
   `plot-state-receipt.sh --unowned` call and its reason string entirely** —
   there is no more unowned write to declare.
3. **Step 5 (symlink move) is deleted outright.** `plot-undeliver.sh` already
   moves `docs/plans/delivered/<slug>.md` to `docs/plans/active/<slug>.md` in
   the same write as the state flip (its last three lines: `ln -sfn` then
   `rm -f`). A second move in the skill would race its own script.
4. **A refusal ends the rejection.** `plot-undeliver.sh` exits 1 and prints the
   refused rule and the plan slug; it writes nothing to the plan file on a
   refusal (see its own comment: *"it writes only what the domain decided, and
   never on a refusal"*). The skill must stop at that point — no fallback to
   the old hand-edit path, per [The Master Agent Uses The Controllers]
   (`../../CLAUDE.md`): *"what the controller refuses does not happen."* State
   the operator's next move per refusal name:
   - `refs-swept` — the rejection found branches with no ref, no host
     `mergedAt`, and a closed-unmerged PR: real work is unaccounted for.
     Tell the operator to write a new plan capturing that lost work before
     retrying the rejection (or to confirm the loss is acceptable and handle
     it outside `/plot-reject`).
   - `refs-unknown` — origin or the host did not answer for at least one
     branch. Tell the operator to retry once both answer; the refusal does
     not claim anything was deleted.
5. **Step 6 (sprint annotation)** is unchanged in shape — it still reads
   `merged:` / `remaining:` PR numbers and branch names for the annotation
   comment — but now sources those numbers from the same `pr_merged` calls
   step 3 already made, rather than a second `gh pr list` round-trip.
6. **Step 7 (commit)** changes what it stages: `plot-undeliver.sh` already
   wrote and left-in-place the plan file and the two symlinks (one removed,
   one created) as working-tree changes. Step 7 becomes `git add
   docs/plans/ docs/sprints/ && git commit ... && git push`, same as today,
   just with no hand-written `State:` edit in the diff to review.

### Decisions the plan settles — do not re-derive them

- **`plot-undeliver.sh` performs the whole write; the skill no longer edits
  `State:`, the `Rejected:`/`Delivered:` lines, or either symlink.** Writing
  any of those by hand after this wave reintroduces exactly the ungated path
  this plan closes, and `plot-state-gate.sh` will refuse the commit for a
  `State:` line not written by a script it recognizes.
- **The `--unowned` receipt and its reason text are deleted, not merely
  unused.** The reason string (*"/plot-reject has no controller"*) is now
  false — the controller is `plot-undeliver.sh`. Leaving the call present but
  dead would read as if the gap still existed.
- **A refusal is the end of the action, not advice to weigh.** Both halves of
  `## The Master Agent Uses The Controllers` apply together: route through the
  controller, and stop when it refuses. Do not add a bypass for "but I can see
  the branch is fine" — that is the judgment call this plan moved into the
  domain specifically so no reader has to make it by eye.
- **Step 3's `gh pr list` replacement is reporting, not a second rule.**
  `pr_merged` here only shapes what the operator sees before confirming; the
  refusal decision itself lives entirely inside `plot-undeliver.sh` (which
  step 4 calls). Do not have step 3 pre-empt or second-guess what step 4's
  call will decide.
- **Out of scope, confirmed by the plan:** no `undeliver` controller endpoint,
  no board HTTP route, no Bitbucket fixture. This wave only rewires the skill
  to call the script that already exists.

Rules carried over unchanged: read the exit code, not the emptiness —
`plot-undeliver.sh` exit 1 means refused, never "ran and found nothing."
`pr_merged`'s `unaskable` reading is not `none`; do not fold them together in
the step-3/step-6 reporting.

### Done when

The plan's `## Done when` list is the specification. The skill/repo items are
this wave's whole scope:

- [ ] `skills/plot-reject/SKILL.md` contains no `--unowned`, no `gh pr list`,
  and no hand edit of `State:` or of either index symlink.
- [ ] `scripts/check-shell-lines.sh pr` shows zero net growth for this PR.
  Wave 1 already paid down the shell budget; this wave should be a net
  deletion (removing the hand-edit steps, the `--unowned` call, and the
  symlink-move block), so there is likely headroom rather than a debt to pay.

Also update, because the skill's own Model Guidance and docs name the old
shape:

- `skills/plot-reject/SKILL.md`'s Model Guidance table (currently "All steps
  are mechanical" — still true, but the step list it describes changes).
- `skills/plot-reject/README.md` if it documents the `--unowned` path or the
  manual symlink move.
- The `plot-state-receipt.sh` header comment at line 17 (*"and `/plot-reject`
  writes Delivered -> Approved"* in the list of unowned writers) and the
  `--unowned` usage text at line 284 (`/plot-reject reverting Delivered ->
  Approved` as an example) — both describe `/plot-reject` as an unowned
  writer, which stops being true once this wave lands.

There is no dedicated script test suite for `skills/plot-reject/` today
(`test/reconcile/` holds wave 1's script tests for `plot-undeliver.sh`
itself) — this wave's correctness is the skill text calling the right script
in the right order and stopping on refusal, which is what a full lifecycle
walkthrough (`/plot-reject` against a sandbox Delivered plan, both the normal
path and a forced `refs-swept`/`refs-unknown` refusal) is for. See
`skills/plot/README.md` for documented test runs and CLAUDE.md's
`## Testing` → *"Behavioral testing is manual."*

Gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each
push and run what it prints. The suites in the `CI suites` config key run in
CI, and a failure there comes back as a correction. Do not run `test:e2e`
locally. `scripts/check-shell-lines.sh pr` refuses a pull request whose shell
under `skills/` grows past its merge base — this wave should net-shrink it.
Add a changeset (description first, `bumps:` block last, `plan:` line inside
the block, bumping the `plot-reject` skill).

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the
work moves), never `gh pr create`. When the PR exists, append `→ #<number>`
to this branch's line in the plan's `## Slices`. Push the first real commit
as soon as it exists.

### Scope guard

This branch owns: `skills/plot-reject/SKILL.md`, `skills/plot-reject/README.md`,
and the two `/plot-reject`-describing comments in `plot-state-receipt.sh`
noted above. It does not touch `plot-undeliver.sh`,
`packages/board/src/server/entry/plan-undeliver.ts`, or
`packages/domain/src/transitions/plan.ts` — those are wave 1's, already merged.
No other branch is in flight on this plan; wave 1 is the only sibling and it
is done.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
