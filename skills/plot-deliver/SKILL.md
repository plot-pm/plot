---
name: plot-deliver
description: >-
  Verify all implementation is done, then deliver the plan.
  Part of the Plot workflow. Use on /plot-deliver.
globs: []
license: MIT
metadata:
  author: eins78
  repo: https://github.com/plot-pm/plot
  version: 1.9.0
compatibility: Designed for Claude Code and Cursor. Requires git. Host operations (PRs, default branch) go through plot-host.sh (GitHub or Bitbucket).
---

# Plot: Deliver Plan

Verify all implementation is done, then deliver the plan. This workflow can be run manually (using git and the git-host CLI), by an AI agent interpreting this skill, or via a workflow script (once available).

For docs/infra work, this is the end — live when merged. For features/bugs, `/plot-release` follows when the team is ready to cut a versioned release.

**Input:** `$ARGUMENTS` is the `<slug>` of a plan on main.

Example: `/plot-deliver sse-backpressure`

<!-- keep in sync with plot/SKILL.md Setup -->
## Setup

Add a `## Plot Config` section to the adopting project's `CLAUDE.md`:

    ## Plot Config
    <!-- Optional: uncomment if using a GitHub Projects board -->
    <!-- - **Project board:** owner/number (e.g. eins78/5) -->
    - **Branch prefixes:** idea/, feature/, bug/, docs/, infra/
    - **Plan directory:** docs/plans/
    - **Active index:** docs/plans/active/
    - **Delivered index:** docs/plans/delivered/

## Model Guidance

| Steps | Min. Tier | Notes |
|-------|-----------|-------|
| 1-4. Parse through Verify PRs | Small | Git/gh commands, helper script, state checks; discovery and existence read each plan's declared phase via `plot-plan-meta.sh` — the index is never asked |
| 5. Verify Completeness | Frontier (orchestrator + jurors) + Small (the gate) | Orchestrator extracts deliverables and reads the panel's moderation; `/plot-panel` fans out one juror per lens, each running `gh pr diff` across the plan's PRs; the two commitment checks are one script call each |
| 6. Release Note Check | Small | File existence checks |
| 7-8. Deliver and Board Status | Small | File ops, git commands, board sync; the phase edit plus the `Delivered:` record are the transition, the index write is best-effort |
| 7b. Delivery-Landed Gate | Small | Run the reconcile scan, grep for the delivered plan; gate progression on the real grep result |
| 9. Summary | Small | Template formatting |

Step 5 is the prime example of subagent delegation: a frontier orchestrator handles the judgment (extracting deliverables, consolidating Done/Partial/Missing), while the jurors handle the evidence in parallel. Without subagents, the frontier model does everything sequentially.

**Step 5 delegates the fan-out itself to [`/plot-panel`](../plot-panel/SKILL.md).** The jurors are Frontier because judging a delivery against a plan is the whole task; the two commitment checks are Small because an exit code decides them. A run without `skills/plot-panel/` falls back to step 2b's per-PR refutation and is reported as a delivery no lens questioned.

> **User interaction:** Use `AskUserQuestion` (Claude Code) / `ask_question` (Cursor) for all questions, proposals, and confirmations.
>
> **No user present?** If `PLOT_UNATTENDED=1` is set, do not call the question tool — each question below declares what to do instead, and every skipped question is named in the output. See [Running unattended](../plot/docs/unattended.md).

### 1. Parse Input

If `$ARGUMENTS` is empty or missing:
- List deliverable plans — every plan in the plan directory whose **declared
  phase** is `Approved`, not whatever is linked in `active/`:

  ```bash
  for f in docs/plans/*.md; do
    ph=$(../plot/scripts/plot-plan-meta.sh "$f" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("phase",""))')
    [ "$ph" = approved ] && echo "$f"
  done
  ```

  A file whose phase does not parse is not a plan (`docs/plans/` also holds
  decision logs and worker reports) — the parser's own answer decides, so the
  skill never becomes a second implementation of the plan format.
- If exactly one exists, propose: "Found plan `<slug>`. Deliver it?"
- If multiple exist, list them and ask which one to deliver

> **Unattended (`PLOT_UNATTENDED=1`):** stop unless `$ARGUMENTS` named the slug.
> `PLOT-UNASKED: Which plan should be delivered? — stopped — <n> candidates; none delivered`
- If none exist, explain: "No plans with `State: Approved` found in
  `docs/plans/`."

Extract `slug` from `$ARGUMENTS` (trimmed, lowercase, hyphens only).

### 2. Verify Plan Exists

Resolve the slug to a plan **file**, then judge the file's own phase. The
dated file first, then the two index directories — the same precedence
`plot-fleet-scan.sh`, `plot-approve.sh` and `plot-dispatch.sh` already use, so
a slug resolves identically whoever is asking:

```bash
for cand in docs/plans/*<slug>.md docs/plans/active/<slug>.md docs/plans/delivered/<slug>.md; do
  [ -e "$cand" ] && { PLAN_FILE="$cand"; break; }
done
```

- If no candidate exists: "No plan found for `<slug>`."
- Read the resolved file's **Phase** field. If already `Delivered` (or
  `Released`): "Already delivered." If `Draft`: stop — an unapproved plan is
  not deliverable.

> **The phase decides, not the directory.** This step asked
> `ls docs/plans/active/<slug>.md` until 2026-08-20 and treated a miss as *no
> plan*. A plan written directly rather than through `/plot-idea` carries no
> symlink, so a valid, approved, pushed plan was undeliverable — and the
> message said it did not exist. Three plans in this repo were in exactly that
> state on the day this changed, and `active/` no longer decides anything a
> reader asks (`feature/the-scan-derives-its-plan-list`, #254). An index that
> can only ever make a plan invisible is not a check; it is a second source of
> truth about a fact the file already states.

### 3. Read and Parse Plan

Read the plan file (`$PLAN_FILE`, resolved in step 2) and find the section headed with "Branches" (matches `## Branches`, `## Implementation Branches`, `### Implementation Branches`, or any heading containing the word "Branches"). Parse it for PR references. If the plan has a `Sprint: <name>` field in its Status section, extract it for the summary.

Expected format once PRs exist (annotated at PR creation or back-filled above):
```markdown
- `feature/name` — description → #12
```

### 4. Verify All PRs Merged

Run the helper:

```bash
../plot/scripts/plot-impl-status.sh <slug>
```

**Annotations are a convenience here, not a precondition.** The helper reads the
`## Branches` section per BRANCH: a line carrying `→ #N` (or a cross-repo
`→ owner/repo#N`) resolves by that number, and a line WITHOUT one falls back to
matching the branch NAME against the heads of merged PRs — the same derivation
`plot-reconcile-scan.sh` uses in section 2, so the verification works on a plan
whose worker never annotated. All host access stays inside `plot-host.sh`
(a single bundled `pr-list --state merged` for the whole plan, then a per-PR
`pr-state`); nothing here calls `gh`/`bb` directly.

Matching does NOT weaken the gate: a branch with no merged PR head and no
annotation resolves nothing — it is never fabricated as merged — so a plan with
an unmerged branch still fails this step and is named in 4b below.

**Optionally back-fill the annotations you resolved.** The `→ #N` annotations
persist the mapping for the next reader (and for tools that read the plan file
rather than the host, like `plot-reconcile-scan.sh`'s release check). This is
housekeeping, not a gate: for each un-annotated branch line the helper
resolved, append `→ #<number>` and commit the plan update. Delivery proceeds
whether or not you do.

Or for each PR number found in the Branches section:

```bash
../plot/scripts/plot-host.sh pr-state <number>   # {"number","state","draft","url"}
```

- If all are `MERGED`: proceed to step 5
- If any are `OPEN`:
  - If any open PRs have `draft: true`, list them and mark each one ready for review (`gh pr ready` / `bb pr edit --ready`) — this is part of the delivery flow, not optional
  - Split-home plans (`Impl: other repo`): the PR references carry a repo prefix (`owner/repo#N`) and `plot-impl-status.sh` resolves them in that repo via the host adapter — delivery works unchanged; only the merge itself happens over there
  - List all remaining open PRs and ask the user: "These PRs are still open. Merge them first, or deliver anyway?"

> **Unattended (`PLOT_UNATTENDED=1`):** **refuse.** "Deliver anyway" over open
> implementation PRs is one of Plot's four phase guardrails, and it stays a
> refusal in both modes — delivering work that is not merged records something
> untrue in the plan. List the open PRs and change nothing.
> `PLOT-UNASKED: Merge the <n> open PRs first, or deliver anyway? — refused — gate; phase unchanged`
  - If user declines, stop and list the unfinished PRs
- If any are `CLOSED` (not merged): warn — these need manual attention

### 4b. Verify All Plan Branches Accounted For

Re-read the plan's branches section (heading containing "Branches"). For each branch listed (skipping branches marked with a deferred annotation):

**Deferred annotation format:** `<!-- deferred: <reason> -->` — must begin with exactly `<!-- deferred:` (case-sensitive, with colon and space). Appears at end of a branch line. Branches without this exact prefix are NOT considered deferred.

For each non-deferred branch:

1. Check if a merged PR exists for that branch: `gh pr list --state merged --head <branch-name> --json number`
2. If no merged PR exists for the exact branch name, check if another merged PR covers that branch's scope (e.g., branches were consolidated into fewer PRs)
3. If a branch has no merged PR AND no consolidation evidence, it is **unaccounted for**

**If any branches are unaccounted for:**
- List them with their descriptions from the plan
- Ask: "These plan branches have no merged PRs. Were they consolidated into other PRs, deferred, or not yet implemented?"
- If deferred or not implemented: **stop delivery** — "Cannot deliver: N branches have no implementation. Build them first, or update the plan to remove/defer them."
- If consolidated: user confirms which PR covers the scope, proceed

**This is a hard gate.** Do not proceed to Step 5 if branches are unaccounted for.

### 5. Verify Plan Completeness

> **Model tiers for this step:**
> - **Frontier (e.g., Opus):** Full deliverable extraction, the lens panel through `/plot-panel` (each juror reads the plan's merged diffs and runs what the deliverables claim), reading the moderation into a Done/Partial/Missing checklist.
> - **Mid (e.g., Sonnet):** Extract deliverables and run the panel with fewer lenses, or check PR titles/descriptions and skip the diff review. Present a simplified checklist based on PR metadata rather than code changes. Ask user to verify.
> - **Small (e.g., Haiku):** Skip entirely. Verify all PRs are merged (step 4), then ask: "All implementation PRs are merged. Ready to deliver this plan?" Human judgment is the final gate.
>
> **The commitment checks are Small at every tier** — `plot-panel.mjs check` is one script call per label per juror and an exit code decides it. A tier that skips the panel is reported as a delivery no lens questioned, never as a clean one.

Compare what the plan promised against what was actually delivered.

1. **Extract deliverables** from the plan file. Look for actionable items in sections like `## Design`, `## Branches`, or bulleted lists that describe what should be built. Number each deliverable for reference.

2. **Question the delivery with a panel, through [`/plot-panel`](../plot-panel/SKILL.md).**

   This step **calls the mechanism and implements none of it.** The fan-out, the
   commitment gate and the reconciler belong to `/plot-panel`. If you find
   yourself launching `Task` agents here or parsing a verdict file, stop: that is
   the mechanism's job, and a second copy drifts from it.

   > **If `skills/plot-panel/` is absent, this step cannot run as a panel.** That
   > is a broken or partial installation, **not a clean delivery** — say so, fall
   > back to the per-PR refutation in step 2b, and record that the delivery went
   > unquestioned by lenses. **Absent is not false.**

   **Ask them to *refute*, not to confirm** (Principle 12): an agent asked "which
   deliverables does this PR cover?" pattern-matches its way to yes, while one
   asked "show me this was NOT delivered" has to go and look. That is the rubric
   for every lens below.

   #### The subject, and how lenses compose with the PRs

   **The subject is the PLAN — one panel per delivery, never one per PR.** The
   lenses read *all* the plan's merged PRs; the PR is not the subject.

   Two reasons, and the first is the mechanism's rule. `/plot-panel` takes **one
   plan file** and refuses a cohort, because *"four personas asked to interrogate
   a scheduling cohort produce four answers with no shared subject"* — and a
   per-PR panel makes the PR the subject, which a plan's deliverables cross.
   A deliverable implemented across two PRs is invisible to a juror holding one.

   The second is the blast radius. `readPanel` refuses **the whole panel** on any
   single hedge — *"a juror that hedged has not dissented, it has not reviewed"*
   — so the cost of one refusal is the panel's size. Measured 2026-09-12 over 268
   plans: **214 carry at least one merged PR, and 191 of those (89%) carry one to
   three.** A per-PR panel would spend N panels to read one plan and re-run a
   whole panel per hedge; per-plan spends one panel of L jurors whatever N is.

   ```
   subject:  docs/plans/<the plan>.md     ← ONE plan, the panel's subject
   evidence: every merged PR the plan names ← what the jurors read
   ```

   **The per-PR fan-out is not deleted; it is what a juror does.** Each juror
   still runs `gh pr diff` across the plan's PRs — the fan-out moved inside the
   lens instead of being the only axis.

   #### The lenses

   **These are this caller's and do not transfer from the Draft panel.** An
   estate lens asking *does this already exist?* is meaningless here, where the
   thing is built. Four is not a target — `/plot-panel` takes N.

   | Lens | The reading position |
   |---|---|
   | **Deliverable** | Does every deliverable the plan named appear in a merged diff? Read the plan's claims against the PRs, not the PR titles. |
   | **Behaviour** | For each deliverable that names a behaviour — a command works, a flag is honoured, a refusal fires — run it. Report what the command printed. |
   | **Changelog** | Does the `## Changelog` describe what the diffs actually do? This is the shape step 5 exists for: an entry written at planning time that describes intent nobody built. |

   **Brief each juror to look, not to agree.** A juror told *"you are the
   behaviour lens"* and asked what it finds is doing the job; one told *"find
   unimplemented behaviour"* will find some whether or not it is there.

   **Prose quality is deliberately not a lens** — a juror reporting awkward
   wording beside a missed deliverable dilutes both.

   #### The commitment: two lines, and what each one gates

   ```
   Position: supported | refuted
   Evidence: executed | read
   ```

   **Two commitment lines rather than one, and this is the slice's one real
   design decision — so here is what it does and does not catch.**

   Step 5 asked in prose for the distinction that matters: *"State separately
   what you EXECUTED versus what you only READ."* That is a rule in CLAUDE.md's
   sense — a juror can answer *"did I state that?"* with yes without it being
   true, and the run still goes green.

   **A command appended to the position line does not fix it.** Measured
   2026-09-12 against the shipped bundle: `readJuror` splits the claimed line at
   the first whitespace and discards the remainder (`panel.ts:149-153`), so

   ```
   Position: supported (ran pnpm test:contracts)   → committed  supported
   Position: supported ran-nothing-at-all          → committed  supported
   Position: supported                             → committed  supported
   ```

   all three pass identically. The command text is never validated.

   So the distinction gets **its own commitment line with its own vocabulary**,
   checked by a second `check` call. Measured the same day: a file missing the
   `Evidence:` line exits **3** and names it, and `executed`/`read` become words
   the gate reads rather than prose it cannot.

   **What this still does not catch, stated plainly:** the gate checks that a
   juror *claimed* `executed`, not that the command it names ran or that its
   output matches. Naming the command stays prose in the body, and the
   moderator's judgement carries it — `/plot-panel` step 5 already asks for
   *"what each juror actually looked at."* A juror that writes `Evidence:
   executed` having run nothing defeats this, and only a person reading the
   verdict will see it.

   **This uses the mechanism as designed and changes nothing in it.**
   `Commitment { label, positions }` is a parameter, so two labels are two calls
   — no domain change, and `readJuror` learns no delivery vocabulary.

   #### Running it

   Hand `/plot-panel` its four parameters — Subject, Lenses, Commitment, Rubric
   — and let it fan out, gate every verdict and reconcile. The rubric is
   **identical across lenses**; only the persona line differs. If you are writing
   a second rubric for a second lens, the lens is doing work the rubric should.

   Both labels are gated, once per juror:

   ```bash
   node skills/plot/scripts/board/plot-panel.mjs check "Position" "supported,refuted" "$LENS" < "$PANEL/$LENS.md"
   node skills/plot/scripts/board/plot-panel.mjs check "Evidence" "executed,read"     "$LENS" < "$PANEL/$LENS.md"
   ```

   **Read the exit code, not the emptiness.** `0` is a commitment, `3` a refusal,
   `2` unusable arguments. A missing bundle means the panel ran **ungated** rather
   than clean, and a delivery with no panel record is **unquestioned, not clean**.

   > **Unattended (`PLOT_UNATTENDED=1`):** run the panel. Fanning out, gating and
   > reconciling all have defined behaviour with nobody watching, and this is the
   > case the panel exists for. Acting on the result is step 5.4's decision and
   > still stops.
   > `PLOT-UNASKED: Run the delivery panel, or fall back to the per-PR refutation? — default — panel run, moderation written, nothing delivered`

2b. **Without the panel: the per-PR refutation, unchanged.** This is the fallback
   when `skills/plot-panel/` is absent — and it is reported as a delivery nobody
   questioned by lenses, never as a clean one.

   Launch one Task agent per merged PR, in parallel, with this shape of brief:

   > Deliverable N claims: "<text from the plan>". Try to establish it was NOT
   > delivered by PR #M. Run `gh pr diff <M>` and read `gh pr view <M> --json
   > title,body,files`. Report one of: REFUTED (with the evidence that it is
   > absent), or SUPPORTED (naming the specific file/hunk that implements it).
   > **State separately what you EXECUTED versus what you only READ** — a
   > deliverable confirmed by reading a PR body rather than a diff is not
   > confirmed.

   A deliverable that names a behaviour (a command works, a flag is honoured)
   is only SUPPORTED when someone *ran* it. "The diff appears to add it" is a
   reading, and readings are how a promise that was never implemented survives
   review.

3. **Consolidate results.** Read the panel's moderation at
   `.plot/panels/<subject>/panel.md` — the reconciliation is the mechanism's
   artifact, and this step acts on it rather than re-deriving it. Without the
   panel, merge the step 2b per-PR reports instead.

   For each deliverable, mark it:
   - **Done** — a juror found the specific implementing change, could not refute
     it, and committed `Evidence: executed` where the deliverable names a
     behaviour
   - **Partial** — some work done but not fully matching the plan
   - **Missing** — no evidence found in any PR, or every attempt to support it
     came back `Evidence: read` rather than `executed`

   **A divided panel is not a tie to average.** `/plot-panel` reports `divided`
   with each position and who holds it; carry that into the checklist as the
   disagreement it is, naming the lens. A number replaces the one thing the user
   needs to decide.

   **A refused panel is not a finding of nothing.** `readPanel` refuses the whole
   panel on any hedge, and a refusal means the delivery was **not reviewed** —
   report it as such rather than as a clean checklist.

   **Watch for the shape this catches:** a changelog entry written at planning
   time that describes intent nobody built. It reads as delivered because the
   plan says so — the diffs are the only place the truth lives.

4. **Present the checklist** to the user and **ask to confirm** the plan is complete enough to deliver.
   - If all items are done: "All deliverables verified. Proceed with delivery?"
   - If any are partial/missing: list them and ask "Deliver anyway, or hold off?"

> **Unattended (`PLOT_UNATTENDED=1`):** stop. Whether partial work counts as
> delivered is a judgement about the plan's intent, and it has no safe default
> in either direction. Name what is partial or missing and leave the phase alone.
> `PLOT-UNASKED: Deliver with <n> partial/missing items, or hold off? — stopped — phase unchanged`
   - If the user declines, stop — do not deliver.

### 6. Check for Release Note Entries

For feature and bug plans, check whether release note entries exist:

**Discover release note tooling** — check in this order, stop at first match:

1. **Changesets:** Does `.changeset/config.json` exist? If so, the project uses `@changesets/cli`. Check if `.changeset/*.md` files (excluding README.md) exist on main.
2. **Project rules:** Read `CLAUDE.md` and `AGENTS.md` for release note instructions (e.g., custom scripts, specific commands).
3. **Custom scripts:** Check `package.json` for release-related scripts (e.g., `release`, `version`, `changelog`).

If no tooling is found, skip this step.

If tooling was found but no release note entries exist for this plan's work, **warn** the user: "No release note entries found for this feature. Consider adding one before releasing."

This is a warning, not a blocker — proceed with delivery regardless.

Skip this step entirely for docs/infra plans (they don't need release notes).

### 7. Deliver Plan

The plan file stays in place. **The phase edit and the `Delivered:` record
are the transition**; moving the symlink is convenience for human browsing and
cannot fail the delivery.

Run the delivery helper — it performs all mechanical writes (phase flip, record,
index symlink, sprint annotation, push) and is idempotent:

```bash
../plot/scripts/plot-deliver.sh <slug>
```

The script:
- Refuses if the plan is not `Approved` or if any non-deferred branch is unmerged
  (the gate step 4 already verified, so this is a safety check)
- Flips `State: Approved` → `Delivered` and fills the `Delivered:` record
- Moves the `active/` → `delivered/` symlink (best effort, cannot fail the delivery)
- Checks the sprint item's box
- Pushes via `plot-push-main.sh`, with micro-PR fallback for branch protection

Output is one `step:` line per operation, then a `summary:` line:

```
step: verified 3 branch(es) merged, 1 deferred
  push: clean — plot/deliver-slug → main
summary: phase=flipped record=written index=moved sprint=updated push=clean
```

The push status (`clean`, `bypassed`, `unknown`, `rejected`) comes from
`plot-push-main.sh`. Only `rejected` needs action — the script opens a micro-PR
automatically if branch protection refuses the push.

> **Why the index writes are best-effort.** A repo with no `active/` link (a plan
> written directly), no `delivered/` directory (a fresh adopter), or a read-only
> checkout still delivers, because nothing downstream reads these links to
> decide anything.

> **The `Delivered:` record is load-bearing, not provenance.**
> `plot-fleet-scan.sh` shows delivered plans for a rolling window and reads
> that window from `delivered_raw` — the record itself. Measured 2026-08-20
> while writing e2e flow e: a plan flipped to `State: Delivered` with no
> record was filtered out of the terminal group entirely, so the scan reported
> **zero** plans for it. A phase flip without the record trades a missing
> symlink for a missing field — the same invisibility one level in. Write both,
> in the same commit.

### 7b. Delivery-Landed Gate

Delivery is a multi-step write (flip phase, write the `Delivered:` record, commit, push) — the biggest drift source in practice is a delivery that half-lands. The index move is no longer one of the steps that can half-land it: it is best-effort, and the scan's index-drift section reports its absence as convenience rather than drift. This step is a **gate, not a rule**: the objective, checkable condition is *the reconcile scan's own output shows no drift for the plan you just delivered*. You cannot answer "did the delivery land?" without running the scan and reading its result — so run it, and **show the real output**. Do not declare delivery complete (do not proceed to the Summary) on a self-asserted claim; proceed only on the pasted evidence below.

Run the scan and capture both its `summary:` footer and the targeted grep:

```bash
../plot/scripts/plot-reconcile-scan.sh 2>/dev/null | tee /tmp/plot-deliver-gate.txt | grep "YYYY-MM-DD-<slug>.md"
tail -1 /tmp/plot-deliver-gate.txt   # the summary: footer — paste this as the gate artifact
```

Grep the **findings that block**, not every mention of the plan. The scan emits a `== blocking sections end ==` line between the two kinds: above it are the defects that stop a delivery, below it the shapes somebody fixes — uncut slices, prose slice names, the three sprint-membership findings, stale tallies, the convenience index, double claims, stale rounds. A delivered plan that never had a symlink appears below the line by design, and so does an uncut slice: neither is a half-landed delivery.

**Read to the marker, not to a section number.** The gate used to stop at `== 7.`, which meant *the first non-blocking section* and said *seven*; the scan has been renumbered twice, and each time somebody had to notice that a section inserted below 7 would silently shrink this gate. The marker moves with the boundary because it IS the boundary:

```bash
sed -n '/^== blocking sections end ==/q;p' /tmp/plot-deliver-gate.txt | grep "YYYY-MM-DD-<slug>.md"
```

Read the **grep's exit result**, which is the gate condition (the scan fetches first, so it sees the delivery push):

- **grep printed a line (exit 0) → the delivery half-landed.** This is a hard stop. Show the finding and its printed `fix:` command, apply it (with confirmation), then **re-run the scan and grep** — repeat until the grep is empty. Only an empty grep on a real run clears the gate.

  **Before each re-run, ask whether the estate actually moved.** The scan is the most expensive step in this skill — measured on the plot repo 2026-08-31, `--offline` took **279.9 s** — and the re-run reads an estate the previous run already measured. When the applied fix changed nothing the scan reads, the second run is the same question asked twice:

  ```bash
  ../plot/scripts/plot-estate-changed.sh /tmp/plot-deliver-estate.txt \
    && ../plot/scripts/plot-reconcile-scan.sh 2>/dev/null | tee /tmp/plot-deliver-gate.txt \
    || echo "estate unchanged — the previous scan's result stands"
  sed -n '/^== blocking sections end ==/q;p' /tmp/plot-deliver-gate.txt | grep "YYYY-MM-DD-<slug>.md"
  ```

  **This changes how often the gate asks, never what it decides.** The grep, the boundary marker and both exit conditions are exactly as above; only a scan whose inputs are byte-for-byte unchanged is skipped, and the held output is re-grepped rather than assumed clean.

  **It is a measurement, not a timer.** The guard hashes what the scan reads — every remote ref's SHA and every plan file's content — so the gate's own fix is always seen: a phase flip changes plan bytes, and the push that follows moves a ref. Nothing expires; an estate that changed produces a second scan every time.

  **It fails toward scanning.** Every path that cannot take a measurement — no git, no plan directory, an unwritable state file — exits 0 and the scan runs. A guard that failed the other way would turn this gate back into a rule.

  Delete `/tmp/plot-deliver-estate.txt` when the gate clears: the guard cannot see a PR merged on the host, so its state must not outlive this run.
- **grep printed nothing (exit 1) → gate cleared.** Carry the actual `summary:` footer line forward as the Summary's gate evidence.

Two expected non-failures (neither trips the gate — the grep does not match branch lines):

- The plan may appear in the **index-drift section** — no symlink in either index. Since the phase grouping is derived from plan content this blocks nothing, which is why that section sits below the boundary marker the gate grep stops at. Do not treat it as a half-landed delivery and do not create the symlink to silence it.
- The plan may appear in the **uncut-slices section** — a wave carrying more than one branch. That is a shape `/plot-reslice` can repair, not a delivery fault; it is non-blocking and the gate grep already excludes it. Do not treat it as a half-landed delivery.
- The plan may appear in the **prose-slice-names section** — a wave heading written as a sentence rather than a label. That is a shape to fix by renaming the heading in the plan, not a delivery fault; it is non-blocking and the gate grep already excludes it. Do not treat it as a half-landed delivery.
- The just-merged **impl branches** may now show in section 3 as deletion candidates — that is normal post-delivery housekeeping, not a failed delivery. Mention it in the summary as optional cleanup (the printed `git push origin --delete <branch>` commands), don't act unasked.
- If the scan is genuinely unavailable (older plot install, or it errors — e.g. `jq` missing, which the scan now reports on stderr and exits non-zero), you cannot clear the gate by asserting success. Skip the step **explicitly**, and say so in the Summary in place of the gate evidence: `Delivery-landed gate: SKIPPED — scan unavailable (<reason>)`. The delivery itself is unaffected, but the reader must see the check did not run.

### 8. Update Board Status

If `## Plot Config` includes a project board (`owner/number`), update all implementation PRs to "Done":

For each merged implementation PR from the Branches section:

```bash
../plot/scripts/plot-update-board.sh <impl-pr-url> "Done" <owner> <number>
```

If no project board is configured, skip this step.

### 9. Summary

**Orient, don't enumerate** (Manifesto Principle 11): open the summary
with where the work now stands, what falls out next, and why — the
mechanical details follow.

Print:
- Delivered: `<slug>`
- Plan file: `docs/plans/YYYY-MM-DD-<slug>.md` (unchanged location)
- Transition: `State: Delivered` + `Delivered:` record on main (this is the
  delivery — report the index move, if it happened, as a separate convenience
  line, and say so plainly if it was skipped)
- All implementation PRs: merged
- Delivery-landed gate: paste the **actual** `summary:` footer line the scan produced in step 7b (the objective artifact — not the words "verified" or "clean"), e.g. `summary: drift=0 merged_not_delivered=0 stale=… claims=… attention=0 concurrent=… unreleased_delivered=… unsliced_waves=… prose_wave_names=… index_drift=… pr_source=… main=…`. If the gate was skipped, print `Delivery-landed gate: SKIPPED — scan unavailable (<reason>)` instead. Add any optional branch-cleanup commands the scan suggested.
- If the plan has a Sprint field: show sprint progress ("N/M sprint items delivered")
- Progress: `[ ] Draft > [ ] Approved > [x] Delivered > [ ] Released`
- Type reminder:
  - If feature/bug: "Run `/plot-release` when ready to cut a versioned release."
  - If docs/infra: "Live on main — no release needed."
- Tip: Run `/plot` to see overall status and what to do next
