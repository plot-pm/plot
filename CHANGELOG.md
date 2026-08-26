# plot

## 2.10.0

### Minor Changes

- [#440](https://github.com/plot-pm/plot/pull/440) [`03a8e09`](https://github.com/plot-pm/plot/commit/03a8e0908a08a73bb9f0ad0ec4fbc1c092fa422f) Thanks [@jwloka](https://github.com/jwloka)! - `/challenge-the-plan` writes `- **Rounds:** N` into a plan's `## Status`,
  alongside the metadata block it already maintains.

  Both writes take the same incremented value in the same step, so the field a
  person reads and the state the parser reads cannot disagree by construction.
  The write is replace-or-insert-after-`Impl:` and touches nothing else: `##
Status` holds the transition records, which nothing in the repo can reconstruct.

  <!--
  bumps:
    skills:
      challenge-the-plan: minor
  -->

### Patch Changes

- [#435](https://github.com/plot-pm/plot/pull/435) [`c7ebfb2`](https://github.com/plot-pm/plot/commit/c7ebfb2621155e89ec9f8ebd6db0e77d38a02b3c) Thanks [@jwloka](https://github.com/jwloka)! - CI fails a changeset that names a package outside the workspace.

  An unknown package makes `changeset version` abort the entire release rather
  than skip the file, so one bad name freezes every subsequent release PR. On
  2026-08-26 six changesets named `@plot-pm/plot`, `@plot-pm/skills` and
  `plot-deliver`; the v2.9.0 release PR sat at 8 of 98 changesets for four days,
  355 commits behind main, and nothing reported the cause.

  The valid names are derived from the workspace's own package.json files, so
  adding a package cannot leave the check stale.

- [#438](https://github.com/plot-pm/plot/pull/438) [`b3be8cf`](https://github.com/plot-pm/plot/commit/b3be8cfe1c2460a17b2ae0ca1beb476b14a1a60a) Thanks [@jwloka](https://github.com/jwloka)! - The plan parser reads `Rounds:` from three sources in preference order:
  `## Status` first, YAML front matter second, CHALLENGE-THE-PLAN-METADATA block
  last. The template declares the field. Absent means absent, not zero.

  <!--
  bumps:
    skills:
      plot: patch
  -->

## 2.9.0

### Minor Changes

- [#350](https://github.com/plot-pm/plot/pull/350) [`31ab482`](https://github.com/plot-pm/plot/commit/31ab4820373d8292d18d588f787f7a1419536e47) Thanks [@jwloka](https://github.com/jwloka)! - plot-deliver: verify by matching merged PR heads to branch names where a plan carries no `→ #N` annotation

  `/plot-deliver` verified PRs only through the `→ #N` annotations in a plan's
  `## Branches` section — written by the implementing worker, and, measured
  2026-08-23, absent in most plans (12 of 16 in the active sprint carried zero).
  So the delivery check refused on exactly the plans it exists to move, and
  clearing them by hand cost a morning of back-filling 21 annotations first.

  `plot-impl-status.sh` now reads the Branches section per BRANCH rather than per
  annotation. A line carrying `→ #N` resolves by that number as before (and a
  cross-repo `→ owner/repo#N` still routes to its repo — a form head-matching
  could never reach). A line WITHOUT one falls back to matching the branch NAME
  against the heads of merged PRs, fetched once through `plot-host.sh pr-list
--state merged`. This is the same derivation `plot-reconcile-scan.sh` already
  applies in section 2: _the missing annotation and the missing delivery share a
  cause, so an annotation-dependent check is blind to exactly the plans it exists
  to catch._

  Decided and enforced:

  - **The gate is not weakened.** A branch with no merged PR head and no
    annotation resolves nothing — never a fabricated MERGED — so a plan with an
    unmerged branch still refuses and the caller names it. Finding an
    un-annotated PR is a convenience; deciding a plan is deliverable is the same
    check.
  - **Annotations, where present, win.** Head-matching is a fallback for the
    un-annotated line, never an override of an annotated one.
  - **The host is asked through `plot-host.sh` only** — the merged-PR list and
    the per-PR state both route through the adapter, so no direct `gh`/`bb` call
    enters the delivery path.
  - **The merged-PR list is fetched once per plan**, at top level (not lazily
    inside a `$(...)` subshell, which would refetch per branch), and only when
    some branch is un-annotated — an annotated-only plan pays nothing.

    <!--
    bumps:
      skills:
        plot-deliver: minor
    -->

- [#335](https://github.com/plot-pm/plot/pull/335) [`9401ea3`](https://github.com/plot-pm/plot/commit/9401ea3c2e00199d045991c92a40aa5004742bab) Thanks [@jwloka](https://github.com/jwloka)! - Add `/plot-reslice`: a spoke command that slices a plan's multi-branch wave
  into one wave per branch. It reads the entangled branches — their diffs, PRs
  and conflicts — proposes one named wave each in an argued dependency order,
  asks a person to confirm the order, then rewrites only the plan's
  `## Branches` section, leaving the branch names and the rest of the file
  untouched. A plan already one-branch-per-wave yields no proposal, a
  `complete` wave is left alone, and unattended it stops with a `PLOT-UNASKED:`
  line rather than writing the source of truth without confirmation.

  <!--
  bumps:
    skills:
      plot-reslice: minor
  -->

- [#341](https://github.com/plot-pm/plot/pull/341) [`c6cc01d`](https://github.com/plot-pm/plot/commit/c6cc01df3979800b3086537f69ce55178640e2d3) Thanks [@jwloka](https://github.com/jwloka)! - `plot-reconcile-scan.sh` gains a section reporting unsliced waves: every `### `
  wave heading that carries more than one branch line, named with its plan file,
  its heading and its branch count, plus a machine-countable `unsliced_waves=`
  footer entry the way each existing section has one. A wave holds exactly one
  branch (MANIFESTO.md); one holding several is a shape `/plot-reslice` can
  repair, so each finding prints `reslice: /plot-reslice <slug>`.

  It REPORTS and repairs nothing — the Principle 3 split: this collects,
  `/plot-reslice` and a person conclude. The section is deliberately non-blocking:
  it is placed as section 7 (index drift renumbered to 8) and kept out of the
  `attention=` count that gates `/plot-deliver` and the `/plot` hygiene line,
  because an unsliced wave is a shape to fix, not a branch that cannot move.
  Branch counts come from `plot-plan-meta.sh`'s `waves[]` — never a second parser —
  so a backticked branch name in a plan's prose is not counted; a phase-less file
  is skipped (it is not a plan); and a `complete` wave is history that still
  counts, since hiding it would misreport the estate.

  The `/plot-deliver` delivery-landed gate is unaffected: its stop marker
  (`sed -n '/^== 7./q;p'`) already excludes the two non-blocking sections at 7
  and 8, so it needs no change; only its prose is updated to name the new section.
  `/plot-reconcile` (the scan's interpreter) and `/plot`'s hygiene line have their
  prose, example footers and Automation Output updated to name the new section and
  its `unsliced_waves=` count and to renumber index drift to 8.

  <!--
  bumps:
    skills:
      plot: minor
      plot-deliver: patch
      plot-reconcile: patch
  -->

- [#358](https://github.com/plot-pm/plot/pull/358) [`fc99e19`](https://github.com/plot-pm/plot/commit/fc99e190722adaf8741a54008c09302d47f9704f) Thanks [@jwloka](https://github.com/jwloka)! - `plot-plan-meta.sh` gains a top-level `long_wave_names` array: every wave name
  longer than a threshold judgement (`LONG_WAVE_NAME_MAX`, set clear of the
  estate's longest legitimate name `Offered first` at 13 and the 53-character
  offender), in document order, empty when every name is a label. It is a REPORT,
  never a refusal — `waves[]` is unchanged, no name is shortened or dropped, and
  the plan still parses in full. Added as a NEW field, never a change to an
  existing one, so every consumer of the existing shape is untouched.

  `plot-reconcile-scan.sh` gains a section reporting those names: every over-long
  wave heading, named with its plan file and the name, plus a machine-countable
  `prose_wave_names=` footer entry the way each existing section has one. A wave
  name is a label (Shaped, Gated, Offered first); a sentence-length heading is a
  plan-authoring mistake the board can only render badly, so each finding prints
  `rename: shorten the wave heading in prose <slug>`.

  Like the unsliced-wave section it copies, it is deliberately non-blocking: it is
  placed as section 8 (index drift renumbered to 9) and kept out of the
  `attention=` count that gates `/plot-deliver` and the `/plot` hygiene line,
  because a prose name is a shape to fix, not a branch that cannot move. The name
  is read from `plot-plan-meta.sh`'s `long_wave_names` — never a second scan of
  the file — so a backticked name in a plan's prose is not a wave name, and a
  phase-less file is skipped (it is not a plan).

  The `/plot-deliver` delivery-landed gate is unaffected: its stop marker
  (`sed -n '/^== 7./q;p'`) already excludes every non-blocking section at 7 and
  beyond, so it needs no change; only its prose is updated to name the new section
  and renumber index drift to 9. `/plot-reconcile` (the scan's interpreter) and
  `/plot`'s hygiene line have their prose, example footers and Automation Output
  updated to name the new section and its `prose_wave_names=` count.

  <!--
  bumps:
    skills:
      plot: minor
      plot-deliver: patch
      plot-reconcile: patch
  -->

- [#402](https://github.com/plot-pm/plot/pull/402) [`c55244d`](https://github.com/plot-pm/plot/commit/c55244df82a6e9b94438834cade88dcb04a0d198) Thanks [@jwloka](https://github.com/jwloka)! - A worker now loops to take the next wave of its plan.

  After completing its branch, a worker calls `plot-fleet-scan.sh --next "$PLOT_SLUG"` to ask for another claimable branch of the same plan. If one exists, it claims it via the standard ref-push mechanism, creates a worktree, and continues implementing — reusing the session that built the first wave rather than exiting and waiting for dispatch to start a new one.

  When `--next` finds nothing to start (exit 1), the loop exits cleanly. A hopping worker takes no new slot against the cap, which is the property that makes continued work free.

  Implementation notes:

  - `plot-dispatch.sh` now exports `PLOT_SLUG` so the worker knows which plan to query
  - The Worker command now calls `plot-worker-loop.sh`, a helper script that implements the claim-hop loop
  - The actual `claude -p` invocation lives in `.plot/worker-prompt.sh`, sourced by the loop script — this avoids the `plot-config.sh` parser stripping `$(...)` as parenthetical prose

  <!--
  bumps:
    skills:
      plot-dispatch: minor
  -->

### Patch Changes

- [#372](https://github.com/plot-pm/plot/pull/372) [`223b5e7`](https://github.com/plot-pm/plot/commit/223b5e73d615ddd66bd0ed7b13cf6cd0f2e6c2de) Thanks [@jwloka](https://github.com/jwloka)! - A branch whose pull request has merged now reads `merged` even when its ref
  still exists. GitHub deletes the ref at merge, but a worktree that still holds
  the branch can push it back afterwards — which a fleet does routinely — and a
  squash merge rewrites the work onto a different commit, so the local walk sees
  commits the default branch lacks and calls finished work `wip`.

  Measured 2026-08-23: a merged branch read `wip` for three hours, its wave
  reported "3 merged, the rest not yet" over four merged branches, and the plan
  sat in Development with nothing left to do. `wip` is the worst of the wrong
  answers because it claims an agent is working there, so a leftover worktree
  reads as an occupied desk.

  The state comes from the pull-request list the scan already fetches once, so
  this adds no host request. Only `MERGED` may override the local walk, and only
  toward `merged`: an open pull request over unlanded commits is still `wip`.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#370](https://github.com/plot-pm/plot/pull/370) [`5d6bac8`](https://github.com/plot-pm/plot/commit/5d6bac8e595399f6e43149fd9aece9cd481164c4) Thanks [@jwloka](https://github.com/jwloka)! - The fleet scan no longer asks the git host about branches a complete PR list
  already accounts for. Measured on this repo: 29 host calls per scan became 1,
  because 28 of them were branches an approved plan names that nobody has started
  — no ref, no PR — each paying a round trip to re-learn it still had no PR, on
  every five-second pulse. One board spent roughly 3,600 calls an hour that way
  and emptied a 5,000/hour budget in about 78 minutes.

  Absence is only an answer when the list is known whole, so `.list-complete` is
  written solely when the parsed row count is both above zero and below the
  request limit: a list returned at the limit may be truncated, and an empty list
  is a silent failure rather than a repository without pull requests. Where
  neither holds, the host is asked exactly as before.

  `PLOT_SCAN_ASK_ALWAYS=1` restores the previous behaviour on the next scan
  without a rebuild.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [`cae2930`](https://github.com/plot-pm/plot/commit/cae29301c3e6e14a57d03e35eca84f0d63894e80) Thanks [@jwloka](https://github.com/jwloka)! - Sprint scope changes mid-flight admit dispatched work only: a plan may join a
  running sprint once its branch is claimed, not merely because it is written or
  approved. Unstarted plans belong to the next sprint's planning.

  <!--
  bumps:
    skills:
      plot-sprint: minor
  -->

- [#376](https://github.com/plot-pm/plot/pull/376) [`ba79563`](https://github.com/plot-pm/plot/commit/ba79563ce68986c5951efc5fd513bc7dae799be7) Thanks [@jwloka](https://github.com/jwloka)! - The plan estate moves from `## Branches` to the `## Waves` heading form, where a
  wave's branch and pull request live in the heading rather than mixed into the
  description prose:

  ```
  old:  - `branch/name` — description → #PR
  new:  ### WaveName (Branch: branch/name, PR: #PR)
        - description
  ```

  88 plans migrate. The parser emits identical JSON from both forms — verified
  per file before and after, with the single documented exception that an unnamed
  wave gains the derived name `Implementation` (18 plans, all Delivered or
  Released).

  22 plans stay on the old form: the new heading holds ONE branch per wave, and
  those carry several. The parser supports both indefinitely, so this is a
  migration the estate completes only as those plans are sliced.

- [#404](https://github.com/plot-pm/plot/pull/404) [`61e333d`](https://github.com/plot-pm/plot/commit/61e333db2303df225567d1d45a095334367a5321) Thanks [@jwloka](https://github.com/jwloka)! - <!--
  bumps:
    skills:
      plot-dispatch: patch
  -->

  feat(plot): manifest tracks worker's current branch and wave count

  When a worker hops to a new branch via plot-worker-loop.sh, the manifest
  now updates to reflect:

  - The new branch the worker is on
  - The new worktree path
  - A wavesCount field tracking how many waves the worker has taken

  This keeps the registry accurate: readers see where a worker IS, not
  where it started. The session and pid stay fixed — it's the same worker,
  in a new place.

- [#380](https://github.com/plot-pm/plot/pull/380) [`2784a05`](https://github.com/plot-pm/plot/commit/2784a05b753cbf3851d8397ab627574984a3e8ae) Thanks [@jwloka](https://github.com/jwloka)! - reconcile: add section 9 — sprint drift

  A plan whose `Sprint:` field disagrees with the sprint file listing it, or is
  empty while a sprint lists it, is now reported. Also reports sprint members
  whose slug names no plan.

  The sprint file is the truth; when a plan's `Sprint:` disagrees, the plan's
  field is what needs editing, not the sprint file's membership. The section is
  ACTIONABLE BUT NON-BLOCKING — it carries its own footer counter (`sprint_drift=`)
  and does not affect the `attention=` count that gates delivery.

  <!--
  bumps:
    skills:
      plot-reconcile: patch
  -->

## 2.7.0

### Minor Changes

- [#237](https://github.com/plot-pm/plot/pull/237) [`71586e3`](https://github.com/plot-pm/plot/commit/71586e37a6e879fd6f95d5f9f7a55ad71808d266) Thanks [@jwloka](https://github.com/jwloka)! - plot-board-setup: a board adoption spoke

  The board runs in any repository already — it reads the CWD, not its own
  location. What was missing was everything around that: no adoption path
  (plot-init never mentioned it), no start route for other projects, and no way
  to tell a working board from a broken one.

  The verify gate asserts the cards, not the port. A plan written with a bare
  `**Phase:** Draft` line instead of the list item parses as `format: none`, and
  the board then boots, serves valid JSON, and renders nothing — indistinguishable
  at the browser from a broken board, and passed cleanly by an HTTP 200 check.
  When the board comes back empty, plot-plan-meta.sh names the offending files.

  CLI auth is reported as ok/failed/unknown rather than a boolean. `jen -I <slug>
auth status` exits 0 and prints "Keycloak: signed in" for a slug that does not
  exist, because the slug expands into a URL pattern without being reached; only
  the `Jenkins auth:` line answers, and an unrecognised output reads as _cannot
  verify_ rather than authenticated.

  The board is started by a script rather than by skill prose, because the
  teardown must be guaranteed rather than remembered: `trap cleanup EXIT` reaps
  the server on the failure paths where an instruction would be forgotten.

  `--start` is the daily action beside the once-per-repo ceremony, and it needs
  evidence more than setup does. The board answers a busy port by printing
  "already running" and exiting 0 — deliberately, since several worktrees run
  boards side by side and one shooting down another is the worse failure. But
  that means the exit code answers a different question from the one `--start`
  asks, and it was measured answering it wrongly: 7777 was held by a different
  Plot installation while the operator's board was not running. So `--start`
  fetches `/api/board` from the board that stays up and reconciles its cards
  against the probe's plan count, rather than trusting an exit code.

  Artifact selection prefers the live `marketplaces/` copy and falls back to
  newest mtime. A machine carries several artifacts — one measured setup had
  three, including a build two weeks stale — and lexical path order picks among
  them by accident.

  Jenkins is recorded and verified, not rendered — the `CI` and `Jenkins instance`
  keys are read back by the skill to check auth against the right instance, and
  the skill says plainly that the board does not yet display Jenkins status.

      <!--
      bumps:
        skills:
          plot-board-setup: minor
          plot-init: patch
          plot: patch
      -->

- [#253](https://github.com/plot-pm/plot/pull/253) [`2e389a1`](https://github.com/plot-pm/plot/commit/2e389a12eef6c928fc8b8127103b1c04df8c512d) Thanks [@jwloka](https://github.com/jwloka)! - plot-sprint: sprint creation proposes the plans that serve the goal

  Sprint creation asked "Found N active plans. Add any to this sprint?" and listed
  them unordered. The list was identical for every goal — a sprint about the board
  and a sprint about the release process were offered the same wall of slugs — so
  the operator did the matching in their head, which is the work the sprint was
  supposed to help with. That cost lands before any payoff, and it is a candidate
  explanation for six months of sprints going unused.

  Step 4 now reads the goal against each unfinished plan's title, story and
  changelog and proposes the ones that serve it, ranked, with `--all` for the full
  estate. It proposes only: the operator selects, and nothing reaches the sprint's
  tiers without an explicit selection, because which MoSCoW tier a plan belongs to
  is a statement about what the team is committing to.

  **Every proposed row carries the sentence that earned it a place.** The proposal
  will be wrong sometimes, and a ranked list whose mistakes are invisible is worse
  than an unranked one — it hides them behind an order. With the reason visible, a
  wrong match reads as a wrong match.

  **The Model Guidance table now names the step Frontier, and the blanket "No
  Frontier needed" sentence is gone.** That sentence was true before this step and
  false after it, and a table that under-states its own requirement sends a small
  model into a judgement it will answer confidently and wrongly. This is also the
  one step in the skill where a smaller model cannot degrade into asking the human
  — handing the operator every open plan is precisely the behaviour being replaced
  — so it degrades into the previous behaviour and **says so**: listing everything
  grouped by story without announcing it leaves a reader trusting an ordering that
  is alphabetical.

  `plot-sprint-candidates.sh` supplies the facts and ranks nothing, which is the
  design rather than a division of labour: the case this feature exists for is the
  goal _"the board tells the truth"_ against the plan _"none printed before the
  first fetch"_ — the same subject, sharing no word. Any score a shell script could
  compute ranks that plan last, so a `score` field in the helper would be a wrong
  answer wearing a helper's clothes. A contract test forbids one.

  Candidacy is read from the phase, not from `docs/plans/active/`: that index is a
  symlink view that drifts, and a plan missing from it is still unfinished work. A
  file with no phase at all is skipped — `docs/plans/` also holds decision logs and
  blocked-worker reports, and one of them says in its own header that it is not a
  plan.

  The helper assembles its JSON through `node` rather than `sed`. This is not a
  style preference: a `"title":"[^"]*"` extraction truncates at the first escaped
  quote, and this repo titles plans things like `... is not "no commits yet"`. One
  such title turns the output into unparseable JSON, silently, for the one caller
  that most needs to read it.

  `PLOT_UNATTENDED=1` still creates the sprint with empty tiers and stops.

  <!--
  bumps:
    skills:
      plot-sprint: minor
      plot: patch
  -->

- [#247](https://github.com/plot-pm/plot/pull/247) [`c363f3e`](https://github.com/plot-pm/plot/commit/c363f3efbdd3ed46431c1f9e3010106f22015a68) Thanks [@jwloka](https://github.com/jwloka)! - A terminal branch is asked once

  A merged branch stays merged. Measured on this repo 2026-08-19, after the
  `pr-list` join ([#232](https://github.com/plot-pm/plot/issues/232)) landed: 26 of 54 branches are terminal — merged or
  deferred — so nearly half the scan asked, every 5 s, about facts that cannot
  change.

  **What the join left behind, measured in a sandbox before any of this was
  written.** Two branch shapes, at two sizes:

  | Branch shape               | 3 branches   | 9 branches   | scales?      |
  | -------------------------- | ------------ | ------------ | ------------ |
  | merged, ref kept           | 1 `pr-list`  | 1 `pr-list`  | no           |
  | squash-merged, ref deleted | 3 `pr-state` | 9 `pr-state` | **yes, 1:1** |

  So after the join the only per-branch host cost left is the no-ref `--ask` arm
  PR [#216](https://github.com/plot-pm/plot/issues/216) put there — and that arm _is_ the terminal population: a branch whose
  ref is gone and whose merge already landed. The cache lands exactly there and
  nowhere else, which is why **a live branch cannot be cached even by accident**:
  a live branch has a ref and never reaches the call. The invariant is structural
  rather than a check that could be forgotten.

  **The cache is a derivation, not a record, and that distinction is the whole
  design.** Git is consulted on _every_ pass; only the host round trip is skipped.
  The asymmetry is the point — git is local and cheap, the host is remote and
  metered — and a cache that also skipped git would be a record of the past rather
  than a derivation of the present, which Manifesto Principle 1 rules out.

  So an entry carries the _evidence_ that made the branch terminal —
  `branch, state, plan-oid, main-oid` — and every pass asks git whether it still
  holds. A reappeared ref is not served and not even reached, because a branch
  name is reusable: merge `bug/flaky`, delete it, push it again, and serving the
  first attempt's `merged` would settle a wave and open the next one on work that
  has not landed. An edited plan invalidates its branches, because a plan is an
  _input_ to the derivation and not just a list of names — `deferred:`
  annotations, wave membership and the plan's phase all decide what an answer
  means. It is content-addressed by blob hash, so an edit is caught without
  trusting a timestamp, and hashed once per plan rather than once per branch.

  **Only a decided answer is terminal.** `-` means the question could not be
  answered, and caching it would freeze one bad afternoon into every later pulse —
  the 2026-08-17 outage multiplied by the life of the board rather than by the
  branch count. `MERGED` and `CLOSED` are settled; `OPEN` and `NONE` are not.

  **The board holds the map because the board is the only long-lived process.**
  The scan is spawned fresh every pulse, so nothing inside it can span two — an
  in-memory map in the scan would die before the pulse that could use it. The scan
  receives the map in the _environment_ and reports the map the next pulse should
  hold on _stderr_, leaving stdout byte-identical to a run with no cache at all. A
  served entry re-reports itself, so what arrives back is the whole map rather than
  a delta the board would have to merge; merging would let an entry no scan
  re-derived survive on nothing but its own age.

  **It never touches disk and never outlives a process.** No file, no `.plot/`
  state — a restart re-derives everything, and the map is adopted only on a scan
  that succeeded, so a pulse killed at the 30 s timeout does not install the
  partial map it had reached.

  <!--
  bumps:
    skills:
      plot: minor
      plot-fleet: patch
  -->

- [#248](https://github.com/plot-pm/plot/pull/248) [`a52df71`](https://github.com/plot-pm/plot/commit/a52df713412aa38a2f3ef7e9a8a7a1ac62849386) Thanks [@jwloka](https://github.com/jwloka)! - plot: an issue becomes a Draft plan

  The issue row has carried an empty actions cell since [#236](https://github.com/plot-pm/plot/issues/236), with a comment
  saying why: an empty menu is better than one offering something that does not
  work yet. This fills it with the row's one action.

  _Create plan_ hands the issue to `/plot-idea` as a problem statement and stops
  at **Draft**. That boundary is the design rather than a detail: the row exists
  because an issue is _not a plan in an earlier state, it is a signal that has not
  become one yet_, and the decision it asks for is _is this worth planning?_ An
  action that produced an approved plan would answer that question instead of
  posing it, so the armed label names the boundary — `Create plan — Draft for
[#228](https://github.com/plot-pm/plot/issues/228)?` — and the prompt says it twice more.

  **The reference is what makes the row disappear.** The created plan records
  `- **Issue:** #<n>` in its `## Status` block, which is the field the board reads
  to know an issue has become a plan. Get it wrong and the row survives its own
  answer — the exact failure this feature exists to remove — so the round trip is
  asserted by parsing a plan built from the prompt's own instruction with
  `plot-plan-meta.sh`, never by matching a string. Both plan templates gained the
  field as a documented, optional slot; its example `[#228](https://github.com/plot-pm/plot/issues/228)` sits inside an HTML
  comment, and `strip_placeholder` was verified to drop it rather than have every
  new plan silently claim to answer that issue.

  **Nothing is written to the tracker.** The one new host op — `issue-view` —
  reads one issue's body, and the adapter test asserts against the argv `gh`
  actually receives that no `comment`, `edit`, `close`, `label` or `lock` reaches
  it. Plot reads the tracker and never writes to it; a plan referencing an issue
  is Plot's record, not the tracker's.

  `issue-list` deliberately omits bodies because it runs on the 60 s PR timer for
  every open issue. `issue-view` asks for the one issue somebody just pointed at,
  so its cadence is a human's — one call per click, none per refresh. It reuses
  `issue-list`'s exit codes (4 = this host cannot be asked, non-zero = the lookup
  failed) so a consumer needs one mapping rather than two.

  `POST /api/idea` is the shape `/api/approve`, `/api/continue` and `/api/dispatch`
  already established, not a fourth one: the same-origin guard and the bounded body
  reader are IMPORTED from `dispatch.ts` rather than restated, because a second
  copy of a security decision is a second place for it to be weakened. The request
  carries **only a number** — the title and body are read from the host by the
  server, so no text a page holds can become the problem statement an agent runs
  on — and the statement reaches the repo as a FILE whose path travels in the
  environment, because `Idea command` is a shell fragment and an issue body is
  written by whoever can file an issue.

  A tracker that cannot be asked offers no action, and the guarantee turned out to
  be structural: wave 1 renders issue rows only where `issueAnswer === 'answered'`,
  so `unsupported` and `failed` produce no row at all — better than a disabled
  button, so it was kept. `refusalReason` remains as defence in depth for the day a
  row reaches the page on a `failed` answer, which is reachable in principle since
  a failed lookup keeps the last good list; its branches are pinned by unit test
  rather than left to a page that cannot show them.

  `Idea command` is a new agent-runner key, and it is REQUIRED where
  `Approve command` is optional. Approving has `plot-approve.sh` to fall back to;
  creating a plan has no such script and cannot have one, since every step of
  `/plot-idea` is judgement and no script here can invoke a skill. An absent key
  therefore refuses and names itself, rather than accepting the click and doing
  nothing — and the spawn sets `PLOT_UNATTENDED=1` and states the Type, because
  `/plot-idea` unattended stops without one and writes no plan file, which is
  exactly the exit-0-having-done-nothing failure `docs/unattended.md` documents.

      <!--
      bumps:
        skills:
          plot: minor
          plot-idea: minor
      -->

- [#242](https://github.com/plot-pm/plot/pull/242) [`5c2cf58`](https://github.com/plot-pm/plot/commit/5c2cf58faaade305776a7bc1a6cc52a570260058) Thanks [@jwloka](https://github.com/jwloka)! - The board renders what has arrived

  The board asked every 5 s for something that took 18.3 s. Measured on this repo
  2026-08-19 after the `pr-list` join landed: a full scan is 18.3 s against a
  `REFRESH_MS` of 5 s, and git alone on 84 branches is 12.7 s. So the wait is
  structural — even a perfect host fix leaves twelve seconds of it — and the only
  thing that removes it is not waiting for the whole document.

  `plot-fleet-scan.sh --stream` emits the same derivation as it resolves: one
  `{"kind":"plan"}` line the moment a plan is fully derived, then one
  `{"kind":"pulse"}` line carrying the identical document `--json` prints whole.
  Measured on this repo, the first plan lands roughly nine seconds before the
  last. The plan object is COMPOSED ONCE and sent to both destinations rather than
  printed twice — a second `printf` of the same shape is a second implementation
  of it, and the first field added to one and not the other is a streamed board
  that quietly renders less than a batch one.

  **The terminal line is what says the scan finished**, and a closed pipe is not.
  A killed scan closes the pipe too, so a consumer that inferred completion from
  the stream ending would read every interrupted scan as a complete answer about a
  smaller fleet. A scan that exits 0 without its terminal line is therefore treated
  as a failure rather than as an empty fleet.

  **A badge whose source has not arrived is absent, never zero and never guessed.**
  This is the rule the whole board is built on and streaming makes it load-bearing
  rather than occasional: for most of an 18 s scan, most rows are genuinely
  partial. `summariseFromPulse` already omitted `claimed`/`eligible` on a cold
  cache; the case it missed is a pulse that is real and has simply not reached this
  plan yet. Rendering that as `claimed: 0` is a fresh, confident, wrong answer —
  worse than the cold-cache one, which at least looked empty.

  **A scan that fails midway keeps what arrived and says the rest is unknown.**
  Discarding a partial result throws away facts that were correctly measured. The
  plans that landed stay; `complete: false` says the rest did not. That field is a
  third state `ready` cannot express — `ready` asks _has anything arrived_, this
  asks _has everything_ — and it sits beside it for the same reason `shrink` sits
  beside `error`.

  **A partial summary is recounted from the plans in hand, never carried over.** A
  summary describing 24 plans beside a `plans` array holding 3 is a measurement of
  one document presented as a measurement of another. The rows themselves are not
  qualified and must not be: each is fully derived from its plan and its refs, and
  is exactly as true mid-scan as it will be at the end. Only the TOTAL is
  provisional, so only the total says so.

  The cache's one-directional rule survives the change but had to be restated for
  it. Plans now land _during_ a scan, so `pulseShrink` is compared against the last
  COMPLETE answer rather than against `entry.pulse` — which this scan's own partial
  writes have been overwriting for the last eighteen seconds, and comparing a
  finished scan to the partial view of itself reports every shrink as zero.

  <!--
  bumps:
    skills:
      plot: minor
      plot-fleet: patch
  -->

- [#236](https://github.com/plot-pm/plot/pull/236) [`8abac87`](https://github.com/plot-pm/plot/commit/8abac87e5992c963466730d1293084e377bcfdfa) Thanks [@jwloka](https://github.com/jwloka)! - <!--
  bumps:
    skills:
      plot: minor
  -->

  board: an issue is a signal the board can see

  Three issues sat open for hours — [#226](https://github.com/plot-pm/plot/issues/226), [#227](https://github.com/plot-pm/plot/issues/227) and [#228](https://github.com/plot-pm/plot/issues/228) — each written with
  request counts, timings, file paths and line numbers already in place. None
  appeared on the board, because the board reads `docs/plans/` and an issue is
  not a plan. Correct by the old design, and useless: the work existed and
  nothing surfaced it.

  WAITING ON YOU now lists open tracker issues **no plan references**. The
  section is for what needs a human decision, and the decision here is not _fix
  it_ — it is _is this worth a plan?_

  Not a fifth phase. The manifesto keeps issues as the inbox — signals, not
  commitments — and the four phases describe the path of a plan. So this is a row
  that is **not a plan**: `IssueRow` is its own shape rather than an `AgentRow`
  with six empty fields, because every field on that type describes a branch and
  an issue has not entered the lifecycle.

  The row takes the PR row's shape on the same seven tracks, with an issue glyph.
  Three refusals, each removing a fabrication:

  - **the inferred plan name is text, never an anchor** — nothing is behind it
    yet, and a link to a plan that does not exist is the fabrication this board
    keeps removing
  - **the branch column is empty** — a derived name would be indistinguishable
    from a branch nobody has claimed, a row this board already renders and which
    means something else entirely
  - **the number links to the tracker only when the host gave an address**,
    following `PrCell`'s own rule rather than inventing a URL

  `plot-plan-meta.sh` gains `issues`, read from a dedicated `## Status` `Issue:`
  line rather than from a scan of the body for `#NNN`. The plan asked which, and
  a body scan cannot tell a signal from a citation: the plan introducing this
  field cites [#226](https://github.com/plot-pm/plot/issues/226), [#227](https://github.com/plot-pm/plot/issues/227) and [#228](https://github.com/plot-pm/plot/issues/228) as history in its Motivation while naming
  PR [#232](https://github.com/plot-pm/plot/issues/232) two sections later. `prs` already answered the same ambiguity by
  reading only `→ #NNN`.

  `plot-host.sh` gains read-only `issue-list`, and three outcomes stay apart: an
  empty list means the host answered, a non-zero exit with empty stdout means the
  question failed, and exit 4 means the host cannot be asked at all (`bb` exposes
  no issue listing). `issueAnswer` carries that distinction to the client and
  defaults to `unsupported`, so an older server's silence never renders as an
  inbox that is clear — a failed lookup says so in the section rather than
  showing nothing.

  The reference is what makes a row disappear, and it is read from every plan
  file rather than from the fleet pulse: the pulse carries a rolling 24 hours of
  delivered plans, which is the right window for branches and the wrong one for
  decisions. A plan delivered last week is still the decision about its issue.

  Read-only in both directions — no labels, no assignees, no close-on-merge.

- [#252](https://github.com/plot-pm/plot/pull/252) [`4e75501`](https://github.com/plot-pm/plot/commit/4e755017a3753f480d55fd9c106b9371b9d31397) Thanks [@jwloka](https://github.com/jwloka)! - plot: plot-plan-meta.sh reports the plan's changelog

  `plot-plan-meta.sh` is the plan-format contract, and it reported everything
  about a plan except what the plan _changes_. `title` says what it is called,
  `story` says what it belongs to, `phase` says how far along it is — and the one
  section that states the change in a sentence was unreadable to every consumer.
  `/plot-release` extracts it by hand today; the sprint proposal that ranks plans
  against a goal cannot rank on a field that does not exist.

  **`changelog` reports ENTRIES, not lines**, and that is the one place the
  measurement corrected the plan. The plan proposed the field on the finding that
  no changelog in the repo contains a code block, and concluded from it that
  entries are single lines. Re-measured on 2026-08-19 across all 34 changelogs:
  **9 of them wrap a bullet across two or more lines**, and 8 close the section
  with a flush-left `Board impact:` paragraph. Line-per-line would have shredded a
  quarter of the estate into fragments, and handed a ranking consumer the reviewer
  note as if it were a release note. So a bullet opens an entry, an indented line
  continues it, and a blank or flush-left line closes it. An indented _bullet_
  folds in the same way — no changelog nests today, and the rule is what stops a
  sub-point being promoted to a headline beside its own parent the day one does.

  **Additive, and `test/reconcile/parser.test.mjs` is the proof — untouched.** The
  new assertions live in their own file for that reason: a contract test that had
  to be edited to make room would have disproved the claim it was there to
  support. Every existing field stays byte-identical.

  **Escaping is asserted by parsing the output back, never by reading it.** A
  changelog carrying backticks, a markdown link, double quotes and backslashes
  round-trips through `JSON.parse`, and the whole 64-plan estate is parsed as a
  final check — because the failure mode of hand-rolled escaping is output that
  still looks like JSON and no longer is. `jesc()` already handled all of it; the
  test is what says so.

  A plan with no changelog reports `[]`. An unfilled template section reports `[]`
  too: the template's `## Changelog` is a guidance comment plus a placeholder
  bullet, and a plan that changes nothing yet must not claim a placeholder as a
  release note. The board needs no change to receive the field — `PlanMetaSchema`
  is a plain `z.object`, which strips unknown keys rather than rejecting them, so
  the new key reaches consumers that ask for it and is invisible to the rest.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#238](https://github.com/plot-pm/plot/pull/238) [`a7864d5`](https://github.com/plot-pm/plot/commit/a7864d5db61d8139dcf3e4f3f5c2b691f624ddfc) Thanks [@jwloka](https://github.com/jwloka)! - plot-fleet-scan: report when a branch last CHANGED, not only what state it is in

  `local_ahead` and `local_dirty` are **state**, not **change**, and that is the
  gap. Measured 2026-08-18 across four concurrent workers:

  | Branch                           | Runtime | Commits | Outcome                                       |
  | -------------------------------- | ------- | ------- | --------------------------------------------- |
  | `the-gate-reads-what-was-shared` | 55 min  | 4       | **opened its PR** — the session's hardest bug |
  | `the-scan-enumerates-the-ref`    | 27 min  | 0       | uncommitted, nothing written for 6 min        |

  The branch that had just opened a PR read `ahead=0 dirty=False` — commits
  pushed, tree tidy — bit-identical to a branch claimed a minute earlier and
  abandoned. Two opposite situations, one row. Runtime could not separate them
  either: the **longest-running worker was the most productive**, so an operator
  watching the clock would have restarted exactly the wrong one.

  `--json` now carries `changed_ago_seconds` per branch, the max of three sources:

  - the newest commit (`git log -1 --format=%ct`, the **committer** date — a
    rebase or amend rewrites it, and the rewrite is the evidence of work)
  - the newest mtime of real work on the floor, editor leftovers excluded
  - the worker log's mtime, when one exists

  Verified on the live estate: `bug/the-scan-prunes-what-it-fetches` and
  `bug/finished-is-not-a-verdict` both read `ahead=0 dirty=False` and last changed
  **8.8 and 8.7 hours ago**, while `feature/the-worker-log-is-readable` reads the
  same `dirty=True` as three others and last changed **1 second ago**.

  ## It is a measurement, and never a verdict

  No threshold, no `stalled`, no "probably stuck". "Stuck" depends on what the
  branch is doing: fifteen minutes of silence is alarming during an edit and
  unremarkable during `test:board`, which takes about that long by itself. The
  threshold belongs to the reader; the measurement belongs in the scan
  (Principle 3). `plot-worker-state.sh` owns worker verdicts and gained
  `waiting`/`stalled` in [#219](https://github.com/plot-pm/plot/issues/219) — this adds a number, not an opinion.

  **A fact measured after the plan was written:** a worker deep in a serial test
  run writes no file for minutes while its _child processes_ work. This reports
  that worker as quiet, and the number is honest — nothing was written. A consumer
  that renders "quiet" as "stuck" will restart a healthy worker mid-suite and redo
  everything it had done, which is the failure the plan measured. Stated in the
  scan's header, not only here.

  ## Absent is `null`, never `0`

  A branch with no worktree on this machine reports nothing — the same _cannot
  see_ that `worker: elsewhere` already gives. The other local signals have an
  absent value that is also a real value (`false`, `0`, `""`); seconds have none.
  A `0` would read as "changed this instant", the most reassuring answer
  available, handed to every branch nobody can observe.

  ## The open point, decided: the pushed branch is NOT covered

  `git log -1 origin/<branch>` would catch a worker on another machine moving a
  ref. Declined on two grounds. The cost lands **exactly on the population that
  must stay free** — a branch with no local worktree is the one whose remote ref
  would be its only source, so the call cannot be skipped for precisely the
  branches this skips, and the plan's cost argument depends on skipping them. And
  the field would stop meaning one thing: every other `local_*` signal answers
  _what this machine can see_, while a remote ref is what the refs say, which the
  scan already reports as `state` and `claimed`. Deferred rather than rejected — if
  the fleet ever spans machines in practice, the right shape is a separate field
  with its own absent value. A test asserts the call is absent, so it cannot
  reappear silently.

  ## Three things the plan did not anticipate

  **One `stat` per file would have been slower than the work it measures.** The
  plan budgeted "one directory stat per worktree"; the design it describes implies
  one per _file_, and a worker mid-build has hundreds. Measured here: 50
  sequential forks cost 3.1 s, one batched call over three paths cost 0.023 s.
  `stat` takes many paths and prints one line each on both dialects, so the whole
  list costs one fork.

  **One `git status` per worktree, not two.** Asking `plot_worker_dirty` for the
  file list ran a _second_ status on a worktree the sweep had already asked.
  `fleet.test.mjs` counts those calls and caught it — the board polls this every
  5 s. The filter is now split from the fetch (`plot_worker_dirty_filter`) and the
  newest-mtime is reduced to one integer in the worktree table, where the status
  output already exists.

  **The scan may not name `.plot-worker.` at all.** `workerstate.test.mjs` asserts
  it, because a read-only scan that touches the worker record has started
  classifying workers again — the duplication removed on 2026-08-18 after the two
  copies had drifted. The log lookup moved to `plot_worker_log()` in the shared
  file, which owns those filenames; the scan asks for a path and reads the time.

  Two constants were extracted rather than copied, on the file's own stated rule:
  `PLOT_EDITOR_LEFTOVER` (the `.tmp*`/`.swp`/`.orig`/`.rej`/`.bak` list, inline
  while it had one caller and now shared, so a `.tmp1` cannot reset this clock
  while being excluded from `worker_dirty_paths`), and the `stat`-format detection,
  now probed once per run and lazily inside `file_mtime` so the function stays
  independently extractable — `fleetdelivered.test.mjs` lifts it out by regex and
  caught the reshape.

  <!--
  bumps:
    skills:
      plot: minor
  -->

  `plot` alone: `plot-fleet-scan.sh` and `plot-worker-state.sh` both live under
  `skills/plot/scripts/`. No board change — the `/api/fleet` schema strips unknown
  keys, so an older board ignores the new field and the change stays additive.
  Whether the Agents tab wants a column remains open in the plan, deliberately: a
  raw age invites the operator to build the threshold in their head, which is the
  habit the plan is trying to replace.

- [#259](https://github.com/plot-pm/plot/pull/259) [`9985886`](https://github.com/plot-pm/plot/commit/9985886e3039ea0fda8c076fa1029e3ac0569df0) Thanks [@jwloka](https://github.com/jwloka)! - plot: plot-plan-meta.sh knows Design as a phase, and reports its record

  `Design` was the one board column that named no phase. It was computed in
  `toBoardPhase` as `approved && !started` — approved work with no commits on its
  branch — and that inference reads a queue as a design stage. Measured on the
  live board 2026-08-20: all three plans sitting in Design were fully specified,
  interrogated and approved, every one carrying a brief and waiting for an agent.
  Not one of them was being designed. A column defined by the _absence_ of work
  told its reader the opposite of what its name said.

  So the parser learns the word. A plan in Design is one that cannot yet be handed
  to development because it needs a spec, a spike or a tracer bullet first — a
  statement about outstanding design work, which "nobody has picked this up"
  cannot make. The two states want opposite reactions from whoever reads the
  board, and only one of them was expressible.

  **`design` is a phase, not a synonym.** `ready-for-review` and `in-review`
  normalize onto `approved` because they _are_ approved by another name; `design`
  gets its own token beside `draft` and `approved`, because folding it into either
  would re-create the conflation this removes.

  **`design_raw` mirrors the three transition records exactly** — an `fm_design`
  and a `canon_design`, front matter winning over the `## Status` body, resolved
  through the same `strip_placeholder` precedence, emitted beside `approved_raw`.
  It is reported for any plan carrying the line whatever its phase, the way
  `approved_raw` outlives the Approved phase: a plan that _went through_ design
  keeps the record.

  **Additive, and `test/reconcile/parser.test.mjs` proves it — 32 pre-existing
  cases pass unedited, 156 lines added and none removed.** The six phase words
  that parsed before parse identically now, asserted on the fixtures that already
  existed rather than on new ones, and the two synonyms still fold onto
  `approved`. All 66 plans in `docs/plans` parse byte-identically apart from an
  empty `design_raw`. The error-path JSON gains the field too, so a caller
  reading a missing file still gets the same shape as one reading a real plan.

  **`design` is the one record whose name collides with a template section.**
  Both plan templates carry a `## Design` heading, and every plan written from
  them has prose under it. The record is read from `## Status` only, like its
  three neighbours — a test pins that, because without it `design_raw` would fill
  itself from the first sentence of the design discussion on most plans in the
  repo.

  Contract-level only. The gates (`plot-approve.sh`, `plot-phase-gate.sh`) and the
  board column are separate waves — until the board wave lands, `toBoardPhase`
  returns `null` for `design` and a plan written with the new phase is parsed but
  not yet drawn, so nothing should be _set_ to Design ahead of it.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#261](https://github.com/plot-pm/plot/pull/261) [`62a1ce3`](https://github.com/plot-pm/plot/commit/62a1ce361a054f2a89920d2edcde0ba4b734d323) Thanks [@jwloka](https://github.com/jwloka)! - plot-dispatch: a held branch is refused, not offered

  `plot-dispatch.sh --dry-run` reported `claimed=0` across a fleet with four live
  agents, and offered `feature/the-row-carries-its-verdict` and
  `feature/reconcile-calls-the-index-advisory` — both already implemented, tested
  and green — as dispatchable. Acting on that output puts a second agent on
  finished work.

  `plot-fleet-scan.sh` derives every state from `origin/<branch>`, and both
  branches had no remote ref at all: one local commit each, never pushed. No
  remote ref means no claim, and no claim reads `eligible`. The scan is right
  about what it reads — the worktree is on the other side of the machine.

  The evidence was already being collected. `plot-dispatch.sh` enumerates local
  refs and worktrees for its `in flight:` collision report, for the reason
  documented beside it: dispatch creates worktrees on THIS machine, so a check
  blind to this machine is blind precisely where it acts. It could see what a
  branch _touched_ and not that someone was _holding_ it, because the two facts
  came from different sources in the same script. It is now asked both.

  A gate rather than a rule. "Always dispatch through `plot-dispatch.sh` so the
  claim ref exists" was violated four times in one evening by an operator who had
  read it that evening — the check _"did I claim this?"_ is answerable without
  doing it.

  Held needs both halves, because either alone is wrong. Without a worktree there
  is no desk and nobody at it, and a bare local branch is not a hold — plenty
  exist for other reasons. And the work must be unlanded: six of the thirty-six
  worktrees on the machine that measured this were leftovers whose work had
  merged, so refusing a merged tip would make the gate fire on exactly the
  branches that are safe, which is the fastest way to teach an operator to route
  around it.

  Two findings from running the gate against this repo after it was written and
  green, each of which a tip-only check gets wrong:

  **Uncommitted work counts, and is checked first.** A worktree cut minutes ago
  points at whatever main was then, so `--is-ancestor` calls it _landed_ —
  `ahead=0, behind=N`, indistinguishable by history from the merged leftover the
  gate must not refuse. `plot-wt-a-branch-row-carries-its-link` was in exactly
  that shape with six modified files and no commit, held by a live agent, and the
  first version of this gate offered it. Only the file state separates the two
  cases, and `uncommitted_files` was already collecting it for the in-flight
  report a few lines above.

  **The worktree is found by asking git, not by rebuilding its path.** The first
  version derived the path from the branch name via dispatch's own flattening
  rule and missed that same six-file worktree: every hand-made worktree on the
  machine drops the branch _type_, so `bug/a-branch-row-carries-its-link` lived in
  `plot-wt-a-branch-row-carries-its-link` where the rule says
  `plot-wt-bug-a-branch-row-carries-its-link`. That failure lands in the worst
  possible population — worktrees dispatch did not create are precisely the ones
  carrying no claim ref, which is the whole reason the gate exists, so a
  convention-matching check could only ever catch the already-claimed.

  Three things it deliberately does not do:

  - **It does not claim on the operator's behalf.** A claim ref for a worktree
    this script did not create is a record in git nobody asked for, and a stale
    claim is worse than an absent one — the reaper cannot tell it from a real one.
    The gate reports the path and stops; the operator decides.
  - **It does not refuse a leftover worktree on a merged branch**, per above.
  - **`--allow-local` does not override it.** That flag is the named escape for a
    repo whose `origin/<main>` cannot be resolved; it says something about reading
    a _phase_ and nothing about whether a human is mid-edit. It is absent from the
    check by construction rather than by a conditional, and a test pins that.

  `--dry-run` refuses identically, through the same function rather than a second
  message that agrees today: a dry run that offers what a real run would refuse is
  worse than no dry run — the same wrong answer with a reassurance attached. Its
  summary footer carried a hardcoded `skipped=0` until the gate gave it something
  to count.

  One existing test changed fixture, not assertion. _"the candidate is never
  reported as blocking itself"_ gave the candidate a worktree with unpushed
  commits, which is now precisely what the gate refuses — so the candidate became
  un-offerable and the report unreachable, by the mirror image of the route the
  test was already written to avoid. It now prepares that branch with **no
  worktree**: the property under test belongs to `committed_files`, which reads
  refs and needs no desk. Both properties keep their own fixture, because they are
  close enough to collide.

  <!--
  bumps:
    skills:
      plot-dispatch: minor
      plot: minor
  -->

- [#271](https://github.com/plot-pm/plot/pull/271) [`f55f957`](https://github.com/plot-pm/plot/commit/f55f957be7d513743c9140705bb9262fc730ac3d) Thanks [@jwloka](https://github.com/jwloka)! - plot: the issue poll slows down for a rate limit, as the PR refresh already does

  Measured on this repo 2026-08-20 while the board was live: GraphQL **0/5000**.
  The board's PR refresh recognised the rate limit and backed off — `fleet.ts:1295`
  routes its failure through `rateLimitBackoffMs`, which reads the host's own
  message and waits. The issue poll did not: it recorded the error at `:1136` and
  re-fired on the ordinary 60 s cadence, spending the exhausted budget to be
  refused again. One host consumer slowed down and its neighbour kept knocking.

  `refreshIssues` runs on the **same gate** as the PR fetch (`prNextAt`), so the
  fix is to route its rate-limit failure through the same throttle and push that
  gate out — never pull it in. The backoff comes from the host's message exactly
  as the PR refresh derives it, and it is applied **extend-only**: a longer backoff
  the PR fetch set a tick earlier is a floor the host named, and the issue poll's
  own 120 s ceiling has no business shortening it — the "more conservative only"
  rule `prNextDueAt` already follows.

  Behaviour unchanged in every other case: a non-rate-limit failure (a VPN blip)
  keeps the ordinary rhythm, Bitbucket's exit-4 _this host cannot be asked_ still
  clears the error and empties the list without touching the gate, and the PR
  refresh's own backoff is untouched.

  This is the first of the plan's _Slows_ branches; the wait still comes from the
  constant ceiling where the message carries no reset — `feature/the-wait-comes-from-the-host`
  supplies the free `rate_limit` read that replaces it.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#256](https://github.com/plot-pm/plot/pull/256) [`c1041a7`](https://github.com/plot-pm/plot/commit/c1041a760a6581907f33e97f03e026829b627d56) Thanks [@jwloka](https://github.com/jwloka)! - plot-reconcile: an unlinked plan is not orphaned any more

  `plot-reconcile-scan.sh` section 5 called a plan with no symlink in `active/` or
  `delivered/` **orphaned**, and counted it as `attention`. That was accurate when
  it was written, and it is not any more.

  **Nothing about the report was wrong. It expired.** Until the phase grouping
  became derived from plan content ([#254](https://github.com/plot-pm/plot/issues/254)), the index directories _were_ the query
  path — `plot-fleet-scan.sh` globbed `active/`, so a plan with no symlink was
  genuinely unreachable: invisible to every unscoped pulse, absent from the board,
  undispatchable. _Orphaned_ was the right word for that, and the fix command was
  worth interrupting a person for. Once the scan enumerates the plan directory and
  groups by declared phase, the same plan is visible everywhere that decides
  anything, and only `ls docs/plans/active/` misses it.

  So the severity drops to **convenience**, in a new section:

  ```
  == 7. Index drift (convenience — nothing depends on these) ==
    2026-08-19-a-plan.md — phase 'Approved', no symlink in docs/plans/active/ or docs/plans/delivered/ (browsing only)
      optional: ln -s ../2026-08-19-a-plan.md docs/plans/active/a-plan.md
  ```

  A separate section rather than a softer line inside section 5, because that
  count is load-bearing: `/plot-deliver`'s delivery-landed gate and the `/plot`
  hygiene line both read `attention=` from the footer. A section mixing _worth a
  glance_ with _needs a decision_ would leave every reader of that number to
  re-derive the split from the body — which is what a machine-countable footer
  exists to avoid. The footer gains `index_drift=N`; the command reads `optional:`
  where section 1's read `fix:`.

  **A dangling symlink keeps its severity, and until now had none at all.** A link
  pointing at nothing is a broken pointer — `cat active/foo.md` fails, a
  bookmarked path 404s — and no amount of deriving makes that harmless. It was
  reported _nowhere_ before: the loop walks plans and asks "does a link point at
  me", so a link whose target no longer exists matched no plan and was silently
  skipped. The check ran in the one direction that cannot see it. It is now
  reported in section 5, with no `fix:` command: repointing the link at a renamed
  plan and removing a link whose plan is gone are different remedies, and the
  script cannot tell which applies without knowing why the target vanished.

  **A file with no `Phase:` field is not a plan — a disagreement between two
  scripts, settled.** [#254](https://github.com/plot-pm/plot/issues/254) decided the rule for the fleet scan: a `.md` file whose
  phase parses as `NONE` never claimed to be a plan, so the pulse does not
  enumerate it. Measured in this repo, the two such files are a worker report and
  an open-questions note. This script called the same file _a plan needing
  attention_. Two consumers of one directory answering opposite is the exact shape
  of the invisible-plan incident this plan exists to close, so the split is closed
  rather than left for a reader to find.

  Settled in [#254](https://github.com/plot-pm/plot/issues/254)'s direction, because the alternative puts the format contract in
  two places: `plot-plan-meta.sh` is the contract (Principle 3), "is this a plan"
  is its answer, and a maintenance sweep answering differently would be a second
  implementation free to drift from the first. The file is not silently dropped —
  the visibility the old line bought was real — it moves to section 7 as `not a
plan (decision log / note?)`. What changes is the claim, and that it no longer
  inflates a gating count.

  `UNKNOWN` stays in section 5 for the same reason it stays a plan in the fleet
  scan: a declared-but-unrecognised phase _is_ a plan with a bad field.

  **Measured before and after, on this repo:** `attention=1` before, and the one
  entry was `2026-08-18-the-repair-exists-report.md — no phase field` — not an
  unlinked plan at all. After: `attention=0 index_drift=1`, same file, stated as
  what it is.

  **`/plot-deliver`'s gate needed one change, and it was not optional.** Step 7b
  greps the scan output for the delivered plan's basename and hard-stops on any
  match in a plan-finding line. Section 7 is a new plan-finding section, so a plan
  delivered without a symlink would have matched it and tripped the gate — a false
  stop, and precisely the failure this change removes elsewhere. The gate now
  slices the report at section 7 (`sed -n '/^== 7\./q;p'`) before grepping, so the
  sections that mean _defect_ still block and the convenience section never does.

      <!--
      bumps:
        skills:
          plot: minor
          plot-reconcile: minor
          plot-deliver: patch
      -->

- [#265](https://github.com/plot-pm/plot/pull/265) [`e50de93`](https://github.com/plot-pm/plot/commit/e50de93c0d075efa36ee4b211cf62542ee0f3a7e) Thanks [@jwloka](https://github.com/jwloka)! - plot: the two pre-Approved gates know the Design phase

  Wave 1 (`design-is-a-phase`) taught `plot-plan-meta.sh` the word `design`. This
  wave teaches the two **gates** that guard the transition out of it, so a plan in
  Design is treated the way its name says rather than falling through a case
  written only for Draft.

  **`plot-phase-gate.sh` blocks implementation commits in Design as it does in
  Draft.** Both are the phases before Approved: in Draft nobody has committed to
  the plan, in Design the approach itself is still open — a spike or a tracer
  bullet answering whether it works. Implementation only ever references an
  _approved_ plan (Manifesto P2), so both wait. The refusal now **names the phase
  it read** — "still Design" over a Design plan, "still Draft" over a Draft one —
  because a gate that says Draft over a Design plan sends the reader hunting for a
  word that is not in the file. Plan-only commits still pass in both phases:
  refining the plan is how it becomes approvable.

  **`plot-approve.sh` accepts a Design plan as it accepts a Draft one.** Approving
  is Design's forward exit — the spike answered its question, so the plan advances
  to Approved. The refusal case now accepts `draft|design|approved` (approved
  staying the idempotent repair), and `flip_phase()` rewrites `Design` → `Approved`
  as it already rewrote `Draft`. The wildcard refusal message no longer implies
  only Draft is approvable.

  **`/plot-implement` is unchanged in behaviour, and that is the load-bearing
  part.** It still requires phase `approved`, so Design cannot become a way to
  start work early — a Design plan is refused exactly as a Draft one is. The prose
  only gains the word: the stop message now names Design alongside Draft rather
  than describing a Design plan with a message written for Draft.

  Tests: a Design plan blocks an implementation commit with the phase named; a
  Design plan on a same-branch shared ref blocks too; approving from Design flips
  the phase and fills `Approved:`; every existing Draft, Approved and offline path
  is byte-identical.

  <!--
  bumps:
    skills:
      plot: minor
      plot-implement: patch
  -->

- [#296](https://github.com/plot-pm/plot/pull/296) [`a4026c5`](https://github.com/plot-pm/plot/commit/a4026c535583cc6c7bcda46959e703c99dbb287d) Thanks [@jwloka](https://github.com/jwloka)! - plot-idea, plot-deliver: the lifecycle does not need the symlink

  The readers stopped depending on `docs/plans/active/` in [#254](https://github.com/plot-pm/plot/issues/254) and [#256](https://github.com/plot-pm/plot/issues/256). The
  **writers** still did, and one of them was strictly worse off for it: a plan
  carrying no symlink was undeliverable, and `/plot-deliver` said it did not
  exist.

  `/plot-deliver` step 2 asked `ls docs/plans/active/<slug>.md` and treated a
  miss as _no plan found_. Step 1 listed candidates the same way. So a plan
  written directly rather than through `/plot-idea` — valid, approved, pushed,
  already dispatched — could not be delivered, and the message named the wrong
  cause. Three plans in this repo were in exactly that state on 2026-08-20.
  Existence is now a fact about the resolved file's `Phase:` field, and the slug
  resolves through the same precedence `plot-fleet-scan.sh`, `plot-approve.sh`
  and `plot-dispatch.sh` already use — dated file, then `active/`, then
  `delivered/` — so one slug means one plan whoever asks.

  **`/plot-idea`'s duplicate check was a gate a missing symlink could bypass.**
  It read `ls docs/plans/active/`, and its own text calls the slug-collision
  check a hard gate. A plan not in the index was invisible to it, so the gate
  passed for precisely the slugs most likely to collide — the ones written
  directly. It now reads the plan directory, which holds every plan by
  construction. _Gates Over Rules_ (`CLAUDE.md`) is the reason this is a fix and
  not a tidy-up: a gate that can be satisfied without doing the work is a rule.

  **The index writes become best-effort, and the ordering changed.** Both skills
  staged the plan file and the symlink together, and `/plot-deliver` ran a bare
  `git rm docs/plans/active/<slug>.md`. `git rm` on an absent path exits
  non-zero, so the ordinary shape for a directly-written plan _aborted the
  delivery of finished work_ — a transition blocked by the state of a browsing
  aid. The plan file is now staged first, every index operation is
  `|| true`-guarded, and `ln -sfn` replaces `ln -s` so re-running a delivery
  repairs the link instead of failing on it.

  **Symlinks are still created.** The plan's first Open Point — whether stable
  slug-named paths are worth generating once nothing reads them — stays open, and
  this change is deliberately correct either way. What ends is anything
  _depending_ on them.

  **Measured, not assumed: the `Delivered:` record is load-bearing.** Writing the
  e2e flow, a plan flipped to `Phase: Delivered` with no `Delivered:` record was
  reported by the derived scan as **zero plans**. `plot-fleet-scan.sh` shows
  delivered plans for a rolling window and reads that window from
  `delivered_raw`, so a phase flip alone trades a missing symlink for a missing
  field — the same invisibility one level in. The skill now states both edits as
  the transition rather than mentioning the record in a comment, and says why.

  The e2e harness could not have caught any of this: `instantiatePlan()` created
  the symlink unconditionally, so the fixture guaranteed the precondition under
  test. It takes `link: false`, and flow e asserts the plan's own three claims for
  an unlinked plan — discoverable, deliverable, reportable. Dispatchability and
  board visibility already held (wave 1, plus the `$PLAN_DIR` fallback
  `plot-dispatch.sh` and `plot-approve.sh` carried); they are asserted anyway,
  because _still true after this change_ is the property that matters and nothing
  held it.

  <!--
  bumps:
    skills:
      plot-idea: minor
      plot-deliver: minor
  -->

- [#254](https://github.com/plot-pm/plot/pull/254) [`9d26fda`](https://github.com/plot-pm/plot/commit/9d26fda12ed90b8d11c1eb44fe8ecd6dcd5ffbda) Thanks [@jwloka](https://github.com/jwloka)! - plot-fleet-scan: the plan list is derived from phase, not from symlinks

  The scan globbed `docs/plans/active/` and appended a glob over
  `docs/plans/delivered/`, so two hand-maintained facts decided a plan's fate:
  whether it appeared at all, and which group it landed in. Both are copies of
  something the plan already states in its own `Phase:` field, and a copy
  maintained by hand disagrees with its original the moment somebody forgets.

  The failure is silent in the direction that matters. Measured 2026-08-18: an
  agent wrote a plan file directly rather than through `/plot-idea`. It parsed
  `canonical`, carried `Phase: Approved`, named three branches in two waves and
  sat on `origin/main` — and every unscoped scan reported 12 plans without it
  while two agents were already working its branches. The scan did not say "one
  plan is unindexed"; it said nothing at all, and its footer count was simply
  lower than reality. Nothing in the output distinguishes _this plan does not
  exist_ from _this plan is not indexed_, which is why it was misdiagnosed three
  times as a board defect before anyone looked at the index.

  So `$PLAN_DIR` is enumerated and each file is grouped by the phase it declares.
  A stale link is now inert in both directions, and the second is the one people
  forget: an unlinked Approved plan appears, and a link pointing at a delivered
  plan cannot resurrect it. A test that only proved the first would pass on an
  implementation where `active/` still won — the link would merely be additive.

  What counts as a plan had to be decided rather than inherited. The old glob
  excluded non-plans by _accident_ — nobody had linked them — so enumerating the
  directory without a rule trades a list that is wrongly short for one that is
  wrongly long. The rule is the parser's own answer: a `.md` file directly in
  `$PLAN_DIR` whose `phase` is anything other than `NONE`. Measured in this repo:
  64 files, 62 plans, and two notes carrying no `Phase:` field at all.
  `UNKNOWN` counts as a plan, deliberately — it means the file declared a phase
  whose value the parser did not recognise, and hiding a plan for a misspelling
  would rebuild this exact invisibility one level down, where it is harder to see
  than a missing symlink was.

  `rejected` and `superseded` route to the terminal group alongside `delivered`
  and `released`, for the same reason `/plot-deliver` files all four under the
  delivered index (issue [#33](https://github.com/plot-pm/plot/issues/33)): they are outcomes, not work.

  The delivered mtime pre-filter goes with the directory it read, and it was
  buying less than it appeared to. It keyed off the `$DELIVERED_DIR` symlink's
  mtime, and a fresh checkout stamps every symlink at once — 56 of 56 delivered
  links admitted here, so the parse it existed to avoid was already being paid in
  full. `delivered_in_window` (the `Delivered:` record) was always the filter that
  actually decided, and the pre-filter's own documented contract was that it may
  only ever OVER-admit. Removing it takes that contract to its limit.

  Cost, measured rather than assumed: 64 plans parse in 371 ms, ~5.8 ms each,
  against a full scan this file's own comments record at 500–1050 ms — 18.3 s with
  the host round trips. The plan's fixture measurement puts the worst realistic
  case at ~300 ms extra for 1000 plans, a scale no Plot repo has reached, behind
  the board's 5 s cache.

  `active/` is untouched: still written, still read for a NAMED SLUG, which is the
  one place its stable undated names are the question rather than a copy of an
  answer. Whether it survives as a browsing convenience stays open in the plan.
  The output shape is unchanged for every plan that is linked — verified by
  diffing `--json` against the previous implementation on this repo, where the
  only differing fields were `changed_ago_seconds` and `local_dirty`, both of
  which measure the moment the scan ran.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#262](https://github.com/plot-pm/plot/pull/262) [`e6853d5`](https://github.com/plot-pm/plot/commit/e6853d50d185a9e5231580db6de5d48f19278d27) Thanks [@jwloka](https://github.com/jwloka)! - plot-fleet: batch the reads that were asked once per plan and once per branch

  The board showed `Last scan failed: timed out after 30000ms` through four rounds
  of optimisation, all of which targeted host round trips. Measured with a wrapper
  counting every `git` invocation: the host was already **one** `pr-list`, and the
  scan spawned **459 git processes** at 56 ms of launch overhead each — roughly
  24 s before git did any work.

  **There was no hotspot**, which is why five rounds of hunting for one failed. The
  distribution was 68 `rev-list`, 68 `ls-tree`, 67 `show`, 59 `show-ref`: about 8
  spawns per branch across 54 branches, and the cost was the _spawning_. The cheap
  suspects totalled 2 s of 105 — `fetch` 0 s, `pr-list` 1 s, all 54 ancestry walks
  1 s together.

  Three questions were asked once per plan or per branch, each with a batched form:

  |                     | before        | after                  |
  | ------------------- | ------------- | ---------------------- |
  | `show-ref --verify` | 59            | one `for-each-ref`     |
  | plan modes          | 69 `ls-tree`  | one `ls-tree -r`       |
  | plan content        | 68 `git show` | one `cat-file --batch` |

  **The plan reads were the whole win.** One `git show` of a plan blob cost
  407-621 ms — variable because several worktrees were hitting one object store —
  and 68 of them is ~31 s in a single call site, against a 30 s budget.
  `cat-file --batch` read nineteen blobs in 559 ms, so reading _every_ plan costs
  about what reading one did. The other two batches cut 117 spawns and bought
  almost no time; those calls were cheap.

  **Measured end to end on this repo: 279 s → 43 s, 459 spawns → 208, and the
  verdicts are identical** across 20 plans and 57 branches — compared field by
  field, with one difference: `changed_ago_seconds` moved by the seconds between
  the two runs. A clock, not a verdict.

  **The `cat-file` framing is by byte count, not by pattern**, and that is why it
  is perl rather than awk. `--batch` emits `<oid> blob <size>` then exactly
  `<size>` bytes; a plan containing a line shaped like `deadbeef blob 42` would
  desynchronise any split that matches the header instead of counting. Two earlier
  attempts here did exactly that, and one wrote **nothing at all, silently** —
  every plan fell through to the per-plan `show`, the spawn count stayed at 68, and
  no error appeared anywhere.

  **A per-branch tail remains and is not claimed to be fixed.** Measured at 6 vs
  14 branches: `diff` 12→28, `rev-list` 12→28, `merge-base` 6→14, `merge-tree`
  6→14, `log` 7→15 — seven spawns per branch, linear in the branch count. They are
  individually cheap, so the tail is survivable and is the _next_ ceiling rather
  than this one. An earlier version of the regression test asserted "at most one
  new spawn per branch" and failed against its own fix, because it asserted a
  change nobody had made.

  The new test holds the property that was actually established: the five batched
  reads cost the **same** at 6 and 14 branches. Verified by mutation — against the
  pre-change script `show-ref` reads 13→29 and the test fails; with the change it
  reads 1→1 and passes. That regression could otherwise return with every verdict
  still correct and nothing but the clock to report it.

  Why this matters beyond one repo: on Bitbucket a single host call was measured at
  ~10 s against GitHub's 461 ms, and the board serves **no rows** without a
  completed pulse — a fresh process has no previous one to fall back on. An
  over-budget scan is an empty Agents tab, not a stale one.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#272](https://github.com/plot-pm/plot/pull/272) [`21fc299`](https://github.com/plot-pm/plot/commit/21fc299b7aca09ebcbe16b8eb8acf09052de63f3) Thanks [@jwloka](https://github.com/jwloka)! - plot-fleet: a bare rate-limit message waits for the host's real reset, not a constant

  `rateLimitBackoffMs` reads three shapes and is correct for all three: a named
  wait (_"try again in 45 seconds"_), an absolute reset stamp, and the bare
  exhaustion message. The first two carry their own answer; the third did not, and
  fell back to `PR_BACKOFF_MAX_MS` — a 120 s guess that could retry four times into
  a closed door when the budget had eight minutes left to run.

  The bare message names no reset, but the host still knows one. `gh api
rate_limit` states it per resource and is itself **free** — the rate-limit
  endpoint is not rate-limited. Measured 2026-08-20 while GraphQL read `0/5000`,
  it reported the reset ~8 minutes out. So on the bare branch the throttle now asks
  once, waits for the stated reset, and keeps the constant only as the last resort
  behind an unreadable answer.

  **The read is confined to the one branch that needs it.** A message naming
  seconds already holds the answer and asks nothing; a reset stamp already holds
  it and asks nothing; a non-rate-limit failure returns null and must not spend a
  call — free-but-still-real — on its way there. GraphQL because that is the budget
  `gh pr list` spends: the endpoint reports every resource's reset, and waiting on
  the wrong one would wait for a budget that was never exhausted.

  **Once per backoff, never per call**, structurally: `rateLimitBackoffMs` is
  called once per failed refresh, and the fetcher is consulted at most once inside
  it. The decision stays a pure function — the fetcher is injected, so the branch
  logic (missing GraphQL resource, expired reset, malformed JSON → the ceiling) is
  covered without the network. The one line the tests cannot reach is the `run('gh
api rate_limit')` that feeds the pure parser, and it returns null on any throw so
  a failure inside a catch block does not propagate a second error out of it.

  **Bitbucket is untouched.** `bb` has no free reset endpoint; the fetcher is
  passed only when the backend is `github`, so a Bitbucket board's bare message
  keeps the ceiling exactly as before. And the ceiling still answers when no
  fetcher is supplied — the pure path the issue poll and the scan's host questions
  keep until the sibling change routes them through this same throttle.

  Scope: the _value_ of the wait on the bare branch. Routing more callers through
  the throttle is `feature/every-host-consumer-slows-down`; the banner and the note
  that say a spent budget from an unreachable host are the two `Says` branches.

      <!--
      bumps:
        skills:
          plot: minor
      -->

### Patch Changes

- [#245](https://github.com/plot-pm/plot/pull/245) [`8e2b283`](https://github.com/plot-pm/plot/commit/8e2b2830918acdd5b9c5eabf71d678405dc04b93) Thanks [@jwloka](https://github.com/jwloka)! - The board's PR refresh cadence accounts for what a refresh costs on the
  configured host

  `PR_REFRESH_MS` is 60 s, and the reasoning behind it treats a refresh as one
  request: _"a check turning green is a minutes-scale event, so five-second
  freshness buys nothing here."_ That reasoning is right, and on GitHub the cost
  matches it. On Bitbucket a refresh is **three** requests — `plot-host.sh`
  expands `--state all` into `open`, `merged` and `declined` because `bb` has no
  `all` state — so the same cadence spent 180 requests an hour there against 60
  on GitHub. Measured against `bitbucket.org/quatico/ekzweb` (issue [#226](https://github.com/plot-pm/plot/issues/226)): a
  board left open a working day made ~1400 requests just watching, and reached
  `HTTP 429 — Rate limit for this resource has been exceeded` account-wide, with
  every `bb` call from the operator's own shell failing too.

  The adapter knew a call cost three and the board knew the cadence; neither knew
  the other. The cadence now asks: `prRefreshMsFor(backend)` is
  `PR_REFRESH_MS × PR_REQUESTS_PER_REFRESH[backend]`, so refreshes are spaced by
  what they cost and **every host spends the same requests per hour** — 60,
  whether that is 60 refreshes of one request or 20 of three.

  **A GitHub board is unchanged**, and this is asserted rather than assumed: the
  multiplier is 1 there, so `prNextDueAt` returns the number it always returned.
  The uncommon case must not slow the common one down.

  Derived, not configured — the plan left that open and this answers it that way
  deliberately. A configured cadence is a second number someone must keep true;
  this one follows from a fact the adapter already states. The multiplier is read
  once from `plot-host.sh backend`, which reads `PLOT_HOST` or the `Git host` key
  and touches no network. It is never inferred by counting responses, which would
  make the cadence depend on the very calls it is rationing.

  Only `pr-list` is counted, and that is not an omission. A refresh also runs
  `issue-list` and `runs`, and on Bitbucket both cost zero requests — `bb`
  exposes neither, so `plot-host.sh` exits before touching the network. Counting
  calls that cannot be made would overstate the bill and slow the board down for
  requests nobody sends.

  **The rate-limit backoff is untouched.** The multiplier is applied after the
  backoff arm returns, so a floor the host named is never edited — a cost-aware
  cadence may only ever be more conservative than a backoff, never less. That
  includes the case where the backoff is _shorter_ than the stretched cadence
  (120 s against 180 s on Bitbucket): a backoff is a floor on when the host may
  be called, not a ceiling on how long the board may wait.

  `PR_TICK_SLACK_MS` stays absolute rather than scaling with the multiplier. It
  answers "how far can `setInterval` miss its mark", which is a property of the
  timer — still firing every 60 s on every host — not of the period the gate aims
  at. Scaling it would widen the licence to fetch early on exactly the host that
  can least afford it.

  The trade is stated rather than hidden: a Bitbucket board's PR badges are up to
  three minutes old instead of one. That is the right side to err on for data
  whose events are minutes-scale anyway, and the alternative is not a fresher
  board but a rate-limited one, which is how this was measured.

  Tested as arithmetic against a fake clock, driving the real `prNextDueAt` /
  `prGateOpen` pair: requests per hour are asserted as a **count**, since the
  count is what the host meters and an interval assertion would pass for a
  change that lengthened the period and left the multiplier wrong. The naive
  cadence is kept in the test as a control, asserted to fail the bar the shipped
  one clears.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#250](https://github.com/plot-pm/plot/pull/250) [`f555b27`](https://github.com/plot-pm/plot/commit/f555b2736f0fe398f37d3b93955ab23b849c2a40) Thanks [@jwloka](https://github.com/jwloka)! - plot: the two paths that launch unattended agents say so

  Wave 1 ([#230](https://github.com/plot-pm/plot/issues/230)) taught fifteen skills what to do when nobody can answer a
  question, and documented it once in `skills/plot/docs/unattended.md`. **Nothing
  set the variable.** This repo's own `Worker command` did not, and neither did
  `ralph-plot-sprint`'s loop — so every dispatched worker and every sprint
  iteration ran as if a person were watching, and the behaviour wave 1 built was
  reachable only by an operator who exported it by hand.

  What stood in for it was brief wording — _"if you must stop and ask, write
  PLOT-BLOCKED"_ — which is a rule an agent can rationalise around rather than a
  condition it cannot meet. Both launch paths now set `PLOT_UNATTENDED=1`.

  **The failure this closes is not a hang, and the distinction changes the test.**
  Wave 1 measured what actually happens under `claude -p`: `AskUserQuestion` is
  not registered at all. The agent notices, writes what it would have asked into
  its prose, and **exits 0**. So a worker launched without the variable does not
  wait and does not fail — it improvises and reports success, which a caller
  reading `$?` cannot tell from a finished job. There is no runtime symptom to
  assert against, which is why the tests assert the variable's _arrival_ rather
  than any behaviour downstream of it.

  **Asserted from the launch path, not from the prose.** `test/e2e/unattended-launch.test.mjs`
  dispatches a real worker whose `Worker command` is a recorder — it dumps the
  environment it was handed — and reads `PLOT_UNATTENDED=1` out of that dump. The
  indirection is the point: two transforms sit between the text a human edits and
  the process that runs. `plot-config.sh` rewrites the value it parses (it strips
  backticks and parenthetical prose), and `plot-dispatch.sh` re-wraps the result
  in `sh -c`. Neither is visible to a reader of `CLAUDE.md`, and a grep of that
  file would have passed while the variable was eaten in transit.

  **A negative control ships beside it.** The same launch path with no prefix must
  yield a worker with no `PLOT_UNATTENDED` at all. Without that control the first
  test would stay green for a repo that never set the variable, proving only that
  `sh -c` propagates an assignment. It also pins a design decision: dispatch
  injects nothing of its own. The variable belongs to a repo's `Worker command`,
  because a repo that never runs Plot unattended must see no change at all
  (Principle 4) — and `plot-dispatch.sh` hardcodes no agent tooling (Principle 5).
  Setting it in the script would have been one line and would have made every
  adopting repo unattended without being asked.

  **`ralph-sprint.sh` exports it once rather than prefixing each call.** The loop
  has three call sites — the iteration, the wrap-up, and whatever
  `$RALPH_SPRINT_CLAUDE` expands to — and a fourth added later would silently miss
  a per-invocation prefix. It sits beside the existing `export CLAUDE_NTFY_SKIP=1`,
  which is the same kind of statement about the same absent human. A test asserts
  the export precedes the first invocation, since an export below a call site
  covers nothing.

  **The one rule is asserted, not asserted-about.** `PLOT_UNATTENDED=1` never
  converts a gate into a pass, so the suite runs the real phase gate against a
  Draft plan twice — variable set, then unset — and requires the same refusal
  both times. The attended run is checked first as a control: if the gate did not
  fire there, the comparison would pass for the wrong reason. The variable answers
  _may I ask?_, never _may I proceed?_, and its power has to stay strictly smaller
  than the operator's precisely because it is set where supervision is thinnest.

  **What deliberately did not change.** The skills are untouched — wave 1 owns
  what happens when the variable is set, and this wave supplies only the signal.
  The `PLOT-BLOCKED` marker instruction stays in the `Worker command`, and a test
  pins it there: the two answer different situations. `PLOT_UNATTENDED` says
  _nobody can answer, take your documented path_; the marker says _I stopped
  anyway, and here is why_. A worker that hits something genuinely undecidable
  still needs the marker, and `plot-worker-state.sh` reads it to report `waiting`.
  No path a person actually watches sets the variable.

  <!--
  bumps:
    skills:
      ralph-plot-sprint: minor
  -->

  `ralph-plot-sprint` bumps because the skill ships `ralph-sprint.sh`, whose loop
  now declares itself unattended. No other skill bumps: the `Worker command` lives
  in this repo's `CLAUDE.md`, which is adopting-project configuration rather than
  skill content, and the fifteen skills that read the variable were shipped by
  wave 1 unchanged.

- [#266](https://github.com/plot-pm/plot/pull/266) [`7d3509f`](https://github.com/plot-pm/plot/commit/7d3509fbfe558b8e113a5993bdbdcc60ba3483c8) Thanks [@jwloka](https://github.com/jwloka)! - plot-fleet-scan: report `held` — a worktree holds a branch whose tip has not merged

  The board reported `WORKING: none — nothing to do, just look` while four agents
  were editing files in four worktrees, and offered three of their branches as
  _"eligible — nobody has taken it"_. Both halves are correct readings of the wrong
  evidence: `WORKING` inferred activity from an uncommitted diff, `NOT STARTED`
  inferred freedom from an absent claim ref, and a branch held by an agent that had
  committed satisfied both.

  The fact nobody recorded is **who holds this branch**. The scan already had every
  ingredient to answer it: `git worktree list` names the worktree checked out on
  each branch here, and the ancestry walk already computes whether a tip has
  merged. This adds one derived field, `held`, that is the AND of the two:

      held = (a worktree here has the branch checked out) AND (its tip is not merged)

  **Why the AND, and not just `local_worktree`.** The worktree path alone already
  travels on the row, but it also fires on a CLEAN worktree left on a branch whose
  work has _landed_ — a leftover directory, of which there are several on any
  machine that has run a fleet. Lifting that to WORKING is the merged-leftover
  misread. `local_worktree` answers _where is this checked out_; `held` answers _is
  that checkout somebody holding the branch_, and the merged-tip exclusion is the
  whole difference between the two.

  **Additive, never a downgrade.** `held` can only be true where a worktree is
  present, so every branch on every other machine — every detached worker, every
  teammate's laptop, every CI run — reports `held: false` and answers from its refs
  exactly as before. The claim ref stays the primary, cross-machine signal: worktree
  evidence can move a branch from free to held, never the reverse. A claim ref with
  no worktree here still reads `claimed`.

  **It is reported, never fed back into the wave arithmetic.** A wave still settles
  on `merged` alone; a held branch neither completes its own wave nor opens the
  next. Verified: a held, unmerged branch keeps its wave eligible and the next wave
  stays blocked behind it.

  The field defaults to `false` in `FleetBranchSchema`, so a pulse from an older
  scan still validates — absent and "nothing here holds it" are the same statement.
  The board consumers that read it (WORKING, NOT STARTED, and the dispatch gate)
  are separate branches of the governing plan; this branch only produces the fact.

  Tests (`test/reconcile/fleet.test.mjs`): a committed-and-clean worktree reads
  held; a dirty worktree reads held; a clean worktree on a merged branch does not;
  a claim ref with no worktree still reads claimed and not held; a branch with no
  worktree reports held false; holding a branch does not change its wave
  eligibility.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [`95a08ee`](https://github.com/plot-pm/plot/commit/95a08ee46e095f9782cd7d56d2338e962f0c6869) Thanks [@jwloka](https://github.com/jwloka)! - ci: a hung step fails instead of blocking

  Measured 2026-08-19: **eleven runs hung on `Install Playwright browser`**,
  10 to 57 minutes each, every one ended by hand. Roughly two to three
  hours of waiting in one day, spent on the same manual remedy — cancel,
  re-run, watch.

  The defect was never the slow CDN. It was that the hang **did not fail**.
  `.github/workflows/ci.yml` carried no `timeout-minutes` anywhere, so a
  wedged download ran against GitHub's 360-minute default, and a run sitting
  in `in_progress` is indistinguishable from one doing work.

  Three bounds, and a cache so the common case stops needing them:

  - `timeout-minutes: 3` on the browser install — the step takes ~45 s warm
    and ~90 s cold, and every measured hang sat past 10 minutes with no
    output. A tight bound turns silence into a fast, re-runnable failure.
  - `actions/cache` for `~/.cache/ms-playwright`, keyed on the resolved
    Playwright version rather than the lockfile hash: the browser build is
    chosen by that version and nothing else, so an unrelated dependency
    change must not evict a browser that is still correct.
  - `timeout-minutes: 15` on the integration suite and `25` on the job — a
    ceiling rather than a target. A green run is about 7 minutes.

  This is the repo's own "Gates Over Rules" rule applied to its pipeline: a
  timeout is a gate, and watching for hangs was a rule somebody had to
  remember.

- [#255](https://github.com/plot-pm/plot/pull/255) [`1f369a3`](https://github.com/plot-pm/plot/commit/1f369a328b9e72638d992e92012484a318995a41) Thanks [@jwloka](https://github.com/jwloka)! - The no-ref arm already reads the join, and now a test says so

  This branch set out to stop the no-ref arm of `branch_state` from asking the
  host about a branch the repo-wide `pr-list` had already answered for. It turns
  out to do that already. What was missing was a test, and the reason the gap
  mattered is that the property is invisible from the outside: every answer is
  correct either way, and only the clock differs.

  **What was measured, and what it showed.** The reported symptom was real and
  reproduced exactly — a counting wrapper around `gh` recorded **16 calls, 15 of
  them `pr view`**, on a 34.7 s scan against the board's 30 s budget. But the 15
  are not what the diagnosis assumed. Every one of them has no ref on origin
  _and_ is absent from the list that arrived:

  | The 15, checked individually               |             |
  | ------------------------------------------ | ----------- |
  | refs on origin                             | 0 of 15     |
  | named by the arrived `pr list --state all` | **0 of 15** |

  They are branches a plan names that nobody has pushed yet — no ref because the
  work has not started, and no PR because none was opened. That is the case the
  plan itself calls "the genuinely unknown branch … which correctly costs one
  call". Reducing it would mean reading an arrived list's silence as evidence of
  no PR, which is `an-outage-is-not-an-answer` inverted.

  **The branches offered as proof of the defect already cost nothing.** PRs [#252](https://github.com/plot-pm/plot/issues/252),
  [#253](https://github.com/plot-pm/plot/issues/253) and [#254](https://github.com/plot-pm/plot/issues/254) — `feature/the-plan-meta-reports-a-changelog`,
  `feature/a-sprint-proposes-its-work`, `feature/the-scan-derives-its-plan-list`
  — are each named by an active plan, each return 0 refs from
  `git ls-remote --heads`, and each appear in the list as `MERGED`. The counting
  wrapper recorded **zero** `pr view` calls for all three.

  **Why it already works, and why that is fragile.** `merged_by_host` does pass
  `--ask` unconditionally, which is what the diagnosis pointed at — but
  `host_pr_state` consults the per-branch cache _before_ it reaches the `--ask`
  arm, so a joined branch returns from the join and the flag never costs
  anything. The saving therefore rests entirely on the order of two adjacent
  blocks. Hoist the ask above the cache read, or gate the cache read on the
  no-ask path, and every merged-and-deleted branch pays a round trip again with
  every rendered verdict still correct. On Bitbucket, where one call was measured
  at ~10 s against GitHub's 461 ms, that silent reordering is the difference
  between a scan and a timeout.

  **So the cost shape is the opposite of what was feared.** Shipping a branch
  makes it appear in the list and costs nothing; the scan does not get slower as
  the team ships. _Planning_ a branch costs one call until someone pushes it, so
  the remaining cost tracks planned-but-not-started work — bounded by the plan
  estate rather than growing with completed work.

  The test that pins this arrives with the list _naming_ the branch, which is what
  separates it from the two count tests already beside it: both of those stub
  `pr-list` to emit nothing, so they establish what a no-ref branch costs when the
  join cannot answer and neither establishes what it costs when the join can. It
  asserts zero `pr-state` calls, one `pr-list`, and — because a count that fell to
  zero by losing the answer would settle nothing and block the successor wave
  forever — that the branch still reads `merged` and its wave still completes.
  Confirmed to fail on the reordering it describes, rather than merely to pass
  today.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#264](https://github.com/plot-pm/plot/pull/264) [`0d021d3`](https://github.com/plot-pm/plot/commit/0d021d300398df71c3efada049a0c053f4b30552) Thanks [@jwloka](https://github.com/jwloka)! - plot-fleet: one walk per branch, not two

  `branch_state` asked `git rev-list --count "origin/$MAIN..origin/$br"` for the
  total commit count, then called `real_commits_beyond_main`, which walks **the
  same range** with `git log` to classify each commit. Two spawns for one
  question, once per branch — **64 `rev-list` calls** measured on this repo, the
  last per-branch block left after [#262](https://github.com/plot-pm/plot/issues/262) batched the plan reads.

  The walk already visits every commit to classify it, so the total was a counter
  it was computing and throwing away. It now returns `<total> <real>` and the
  separate `rev-list` is gone.

  **Both numbers from one reading also keeps them consistent by construction.** A
  total and a real count taken from two walks can disagree if a ref moves between
  them, and the caller compares the two to decide whether a branch is a bare claim.

  `for-each-ref`'s `ahead-behind` would answer this repo-wide in a single call, and
  needs git **2.41**. macOS ships **2.39**, so it is not available here.

  **Measured on this repo:** 52 s → **20 s**, 203 spawns → 199, `rev-list` 64 → 58.
  Verdicts identical across 20 plans and 58 branches, compared field by field
  against `main`.

  That puts the scan back under the original 30 s budget, so the 90 s raise in the
  sibling change is now headroom rather than a requirement.

- [#273](https://github.com/plot-pm/plot/pull/273) [`aa9a591`](https://github.com/plot-pm/plot/commit/aa9a591b1d5b94df09ed6d6a10a4b6682b4417db) Thanks [@jwloka](https://github.com/jwloka)! - plot-fleet: thin the per-branch history walk the ref/tree batching left behind

  The plan this branch belongs to was scoped against a **459-spawn** scan and named
  "the 68 per-branch `rev-list` calls" as the target. That number was measured
  _before_ its sibling ([#262](https://github.com/plot-pm/plot/issues/262)) landed. Re-measured on the same repo after [#262](https://github.com/plot-pm/plot/issues/262), with
  a wrapper counting every `git` invocation:

  |                     | brief's premise | measured after [#262](https://github.com/plot-pm/plot/issues/262) |
  | ------------------- | --------------- | ----------------------------------------------------------------- |
  | git spawns per scan | 459             | **123** (prose) / 232 (`--json`)                                  |
  | `rev-list` spawns   | 68              | **9** (prose) / 74 (`--json`)                                     |
  | total git time      | dominant        | **4.1 s** (0.73 s of it the one `fetch`)                          |
  | wall clock          | 105 s           | **~15 s, under the 30 s budget**                                  |

  [#262](https://github.com/plot-pm/plot/issues/262) did not only batch the ref/tree/plan reads — by collapsing them it shrank
  the branch population the ancestry walk touches. The 68-per-branch `rev-list` the
  brief set out to batch no longer exists, and the one clean batch form for
  per-branch ahead-counts (`for-each-ref %(ahead-behind)`) needs git 2.41, above
  the 2.38 floor this scan states its reasons for holding. So the brief's literal
  mechanism is both unnecessary and, within the git floor, not available. What
  remains is the per-branch tail [#262](https://github.com/plot-pm/plot/issues/262) named as "the _next_ ceiling," and this
  change thins two provably-zero-cost spawns out of it — every verdict identical,
  which the whole fleet suite pins.

  **The dead `merge-base --is-ancestor` per `wip` branch is removed.** `branch_state`
  reached it only inside the `ahead > 0` arm and asked "has the work already
  landed?" — a question the `ahead` count above it had answered: a branch carrying
  a commit `main` lacks cannot be an ancestor of `main`, so the call was false on
  every branch that reached it and its `merged` was unreachable. The landed-work
  case is still answered one level up (a fully-merged branch counts `ahead = 0`;
  a merge that deleted the ref never reaches this arm). Removes one spawn per `wip`
  branch — `merge-base` 6→14 in the sibling test's measurement, now 0.

  **`local_ahead_of` no longer spawns for a branch with no local head.** In `--json`
  mode (what the board polls) it ran `rev-list refs/remotes/origin/<br>..refs/heads/<br>`
  once per branch — 64 calls on this repo, **25 of them** against branches living
  only on another machine, where the missing `refs/heads/<br>` makes the walk exit
  128 and answer 0. A one-call `LOCAL_HEADS` batch (the shape [#262](https://github.com/plot-pm/plot/issues/262) gave the remote
  refs) gates the spawn: an absent local head answers 0 without a process. `rev-list`
  in `--json` mode drops 74→49 for the cost of one extra `for-each-ref`.

  **Only the absent-head case is skipped.** A local head that _has no upstream_
  (committed, never pushed) still spawns the walk and still reads its 128-failure
  as 0 — the `a MISSING upstream is detected, not read as zero` invariant, which
  the brief flagged as fragile and which stays green. The new test asserts the
  _skip_, not merely the 0: a git-argv shim confirms the ahead query is never
  issued for a branch with no local head, because a 0 alone would pass whether the
  spawn happened or not.

  The regression test now holds `merge-base` constant (0→0) alongside the batched
  reads, so a reappearing per-`wip`-branch ancestry check fails the suite the way
  a de-batched `show-ref` would — with every verdict still correct and nothing but
  the clock to report it.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#292](https://github.com/plot-pm/plot/pull/292) [`67352f0`](https://github.com/plot-pm/plot/commit/67352f0380ff8997a038c3a72c64f81352e7b29e) Thanks [@jwloka](https://github.com/jwloka)! - board: the killed-search test stops racing the clock

  `markerIn`'s timeout assertion — _a search killed by its budget answers `""`
  rather than rejecting_ — reached that error path by giving a real `git grep` a
  **1 ms budget** and expecting the kill to win. Three runs under
  `--fileParallelism` went **pass, fail, pass**: on a machine busy enough, grep
  sometimes finished first and returned the marker it was supposed to be killed
  before finding. The serial default was not preventing that race, only keeping
  the machine quiet enough that it usually resolved the same way.

  **The file count never controlled the outcome.** The previous round of this bug
  was fixed by raising the repo from two files to 2,000, with a comment claiming
  the kill was then "deterministic rather than likely". Measured 2026-08-20
  against that exact setup:

  | repo                 | budget | who won                          |
  | -------------------- | ------ | -------------------------------- |
  | 2,000 files          | 1 ms   | the kill — assertion passes      |
  | 2,000 files          | 50 ms  | the kill — assertion passes      |
  | 2,000 files          | 400 ms | **`git grep` — assertion fails** |
  | **no filler at all** | 1 ms   | the kill — assertion passes      |

  A bare process launch already exceeds a millisecond, so the 2,000 files were not
  what made the test pass — spawn latency against the budget was, and neither is a
  property of the module under test. The 400 ms row is the same race the CI
  failure was, reached by moving the other variable.

  `markerIn` now takes its search runner as a third parameter defaulting to
  `execFile`, and the suite injects a runner that reports a kill the way `execFile`
  does. The assertion is about the handling, so it holds with the repo reduced to
  **one file and no filler**: if it ever depended on search duration again, the
  absent 1,999 would be how it showed. Verified by raising the injected budget to
  **60 s** — where the old test failed at 400 ms — with the assertions unchanged.

  **One test became four, because the original conflated failures with different
  causes.** Answering `""` and _not rejecting_ are separate assertions: a rejection
  inside `workerQuestions`' `Promise.all` loses every other branch's answer, not
  just this one. `if (err && !stdout)` has a second half no kill test reaches — a
  `grep -m1` that wrote its hit before the kill landed leaves an error **and**
  usable output, and discarding it would turn a marker that was found into _reason
  unavailable_. The fourth guards the seam itself: it asserts the caller's budget
  still reaches the runner, without which breaking the timeout wiring is silent.

  **The seam also made an existing test load-bearing.** Every killed-search test
  injects its runner, so none would notice `markerIn` losing its `execFile`
  default and spawning nothing. `finds a marker in a committed file` passes no
  runner, so it is now the only proof that the seam has a production wiring — a
  duty it did not have before, and its comment says so.

  Each was checked against a deliberately broken implementation — wrong error-path
  value (7 tests fail), budget not forwarded (**1** test fails, the one written for
  it), default runner stubbed (4 fail).

  Ten consecutive runs under `--fileParallelism` agree. This unblocks
  `feature/unit-tests-run-in-parallel`, which the race would otherwise have made
  intermittently red.

- [#298](https://github.com/plot-pm/plot/pull/298) [`4cef559`](https://github.com/plot-pm/plot/commit/4cef559a9ca16c03d206e6d867759f25af9bf4bd) Thanks [@jwloka](https://github.com/jwloka)! - board: the test files that take no port and no browser run in parallel

  `vitest.config.ts` set `fileParallelism: false` for every vitest file, and its
  comment gave the reason honestly: _"The UI layer boots a server and launches
  Chromium — generous timeouts, and no cross-file parallelism so server spawns
  don't contend."_ That reason is real for the files it describes. The ~50 in
  `test/unit` spawn no server and launch no browser, and waited on a constraint
  that was not about them.

  Two projects now carry the parallelism each half needs, so the suite no longer
  takes the stricter of the two.

  **Split on the contended RESOURCE, not the directory and not the filename.**
  There are exactly two things to contend for — a port and a Chromium process —
  and a file that takes neither has nothing to fight over. Measured, the directory
  name is wrong in both directions: three files named `.browser.test.ts` start no
  server, and three not named `.browser.` (`tiny-garden.data|plan|story`) do. An
  earlier cut of this branch keyed the split on the `.browser.` suffix and put
  those three port-taking files in the parallel group; `PORT=0` makes that safe
  today, but it makes the config's grouping depend on a property of a helper rather
  than on the reason the comment states.

  |                                       | takes                     | parallelism |
  | ------------------------------------- | ------------------------- | ----------- |
  | `parallel` project — `test/unit`      | neither                   | parallel    |
  | `serial` project — `test/integration` | a port, Chromium, or both | serial      |

  The four Chromium-without-server files are **not** broken out into a third,
  port-free project. Chromium is itself contended and nothing here has measured
  how many instances this machine tolerates; a third project would need a
  concurrency number, and an unmeasured number is the next unfounded figure.

  **The premise is now a gate, not a comment.** The split is only safe because the
  parallel group takes neither resource, and that is a claim about the contents of
  a directory — exactly the kind a comment cannot keep true. Adding `startServer`
  to a file in `test/unit` would not fail; it would make the parallel project
  contend for ports intermittently and surface weeks later as an unrelated test
  flaking on a busy machine. `parallel-project-takes-no-resource.test.ts` asserts
  it instead, names the offending file, and says which project it belongs in.
  Verified against a planted violation: exactly the port assertion fails, and it
  prints the planted filename. Comments are stripped before matching, following
  `no-network.test.ts` — a check that fired on prose would push the next author to
  delete the reasoning to go green — and the file excludes itself, because both
  markers appear in its own assertion messages.

  **`fileParallelism` is honoured per project — verified, not read.** The vitest 4
  type declarations put it on the _root_ config beside `projects`, which reads like
  a global a project cannot override; `maxWorkers: 1` would have been the
  workaround for a problem that does not exist. Types cannot distinguish _accepted
  and ignored_ from _accepted and honoured_, so it was measured: two probe projects
  of three 1.2 s-sleeping files each, timestamping every file's start. The parallel
  project's three all started at +0 ms and ended together at +1202 ms; the serial
  project's started 1.3 s apart, at +1296, +2630, +3911. Vitest also runs the
  projects one after another, so the serial project never contends with the
  parallel one.

  `testTimeout: 30_000` is unchanged in both projects. A browser test that boots a
  server needs it, and a unit file that needs 30 s is a separate finding.

  **What it buys, and the honest shape of the number.** The plan's open point asks
  for an idle-machine measurement before the benefit is quoted. This machine was
  never idle — 16 CPUs, load average 7.2–8.0, nine sibling vitest processes from
  other agents throughout — so that point stays open and no single percentage here
  should be lifted as _the_ figure. Four A/B pairs of the same project, each leg
  run back to back, only `--fileParallelism` differing:

  | pair | serial  | parallel |       |
  | ---- | ------- | -------- | ----- |
  | 1    | 91.0 s  | 35.5 s   | −61 % |
  | 2    | 60.2 s  | 41.1 s   | −32 % |
  | 3    | 85.9 s  | 53.0 s   | −38 % |
  | 4    | 141.7 s | 49.6 s   | −65 % |

  **The spread is the finding, not an error bar to average away.** The serial leg
  swings 60 s → 142 s, a 2.4x range on identical work; the parallel leg stays
  inside 35–53 s. Serial wall-clock tracks ambient load almost directly, because
  one slow file blocks the queue behind it and nothing else proceeds. Parallel
  absorbs the same contention across 16 CPUs.

  So the defensible claim is not a percentage but a shape: **parallel is faster in
  every pair measured, and it is also far more predictable — and the gap widens
  exactly when the machine is busy.** That is when a rebase happens, which is the
  case this plan was written for. A reader wanting one number should take the
  worst-case pair, −32 %, rather than the best.

  **The full `vitest run` moves much less: 779 s → 750 s, −3.7 %.** The serial
  project is ~700 s of that total, measured alone, so it dominates the suite and
  this change deliberately does not touch it. Anyone quoting the plan's −42 % for
  the whole suite is quoting a measurement of the unit half in isolation. Where
  this lands is the question a rebase actually asks — _did I break anything that is
  not the browser_ — which is now a ~40 s answer via `vitest run --project=parallel`.

  **The plan's open point is answered, and answering it cost one repair.** _Does
  any unit file depend on serial execution for a legitimate reason?_ No — but ten
  parallel runs found one that depended on it ACCIDENTALLY. `continue-route.test.ts`
  asserted `PLOT_CONTINUATION` with `actual: ''`, once in ten: its worker writes the
  witness with `>`, which creates and truncates the file before `printf` writes into
  it, so a poll on `existsSync` could be satisfied by a file that was real and
  still empty. Six serial runs at the same load failed zero times.

  Parallelism **surfaced** that rather than causing it — the worker is detached, so
  nothing in the test was ever synchronised with its write, and the window existed
  at any load. The worker now writes a scratch file and renames it into place, so
  the witness name appears only when its content is complete, and the poll waits
  for content instead of for a filename. Verified falsifiable before landing: with
  the worker reporting a deliberately wrong value, the assertion fails and prints
  that value rather than an empty string.

  That is the same shape as this plan's wave-1 fix, one level up — an assumption
  about timing replaced by an assertion about the thing actually meant. It is also
  why _ten consecutive runs_ was the right bar: nine would have shipped it.

  **Two browser files were already failing before this change**, under the
  untouched serial config, and the failing set shifts between runs
  (`button-claims`, `stuck-rows`, `start-work-refusal` — 1 to 3 files depending on
  load). They fail on a config this branch does not alter, in files it does not
  touch; the before-measurement is what establishes that, rather than the parallel
  switch being blamed for surfacing them.

## 2.6.0

### Minor Changes

- [#229](https://github.com/plot-pm/plot/pull/229) [`89d1cbc`](https://github.com/plot-pm/plot/commit/89d1cbc605f643a04d0efc364b89d37d1c3c2db6) Thanks [@jwloka](https://github.com/jwloka)! - A sprint can name the release it is working toward, and `/plot-release` reads it as a gate

  `Release:` is a new optional field in the sprint format. When present,
  `/plot-release` refuses to cut past an unfinished **Must Have** and names every
  one; `--ignore-sprint` is the named escape, and using it writes the version, the
  date and the open items into the sprint's `## Notes`. Unfinished **Should Haves**
  prompt instead of blocking — no flag, because the confirmation is the record that
  a person looked. **Could Haves** neither block nor prompt. Under
  `PLOT_UNATTENDED=1` the prompt degrades to a warning while the Must-Have gate
  still refuses.

  `/plot-sprint close` reports the release state and never refuses on it: a timebox
  whose release slipped still ends.

  A sprint with no `Release:` behaves exactly as before.

  New helper: `plot-sprint-release.sh` reports a sprint's target and per-item
  states as JSON and decides nothing.

  <!--
  bumps:
    skills:
      plot: minor
      plot-release: minor
      plot-sprint: minor
  -->

- [#230](https://github.com/plot-pm/plot/pull/230) [`f44b816`](https://github.com/plot-pm/plot/commit/f44b816f58fe1a3df1d2f6bff9a2f3e7d1c1880e) Thanks [@jwloka](https://github.com/jwloka)! - Skills declare what to do when nobody is there to answer

  Fifteen skills told an agent to use `AskUserQuestion`. Under `claude -p` there
  is no one to answer, and the plan behind this change assumed the run would hang
  until the harness killed it.

  **Measured first, as the plan required — and the assumption was wrong.** The
  tool is not registered at all under `claude -p`: it is absent from the session's
  tool list and from the deferred tools `ToolSearch` can load. Nothing waits.

  The real failure is quieter and worse. The agent notices the tool is missing,
  writes what it would have asked into its prose, and **exits 0** — so a CI job
  reading `$?` sees success and a dispatcher sees a finished worker. The refusal
  exists only in text nobody parses. That is this repo's recurring defect, an
  unobserved thing reported as an observed one, arriving through the exit code.

  So the design holds but its purpose changes: not to prevent a wait, but to make
  the skipped question land somewhere a machine reads, and to make the outcome a
  decision a skill author wrote down rather than one a model improvised well.

  - `PLOT_UNATTENDED=1`, stated explicitly and never inferred from a missing TTY
  - Each question site declares its own shape — proceed with the documented
    default, refuse, or report and stop cleanly
  - Every skipped question is named in a greppable
    `PLOT-UNASKED: <question> — <shape> — <outcome>` line, with a count per run
  - **Gates refuse in both modes.** The variable answers _may I ask?_, never
    _may I proceed?_

  One shared reference (`skills/plot/docs/unattended.md`) with the shapes declared
  inline at each question, rather than fifteen copies of an unattended clause: the
  interaction line spread by copy, and copies are what drifted. A contract test
  pins the reference, the links, the disclosure lines and the gates.

  <!--
  bumps:
    skills:
      plot: minor
      plot-approve: minor
      plot-deliver: minor
      plot-dispatch: minor
      plot-fleet: patch
      plot-idea: minor
      plot-implement: minor
      plot-init: minor
      plot-merge-queue: patch
      plot-reconcile: minor
      plot-reject: minor
      plot-release: minor
      plot-sprint: minor
      ralph-plot-sprint: minor
      challenge-the-plan: minor
  -->

### Patch Changes

- [#232](https://github.com/plot-pm/plot/pull/232) [`0386bcb`](https://github.com/plot-pm/plot/commit/0386bcbf933b3d026f294dbaa53c499b135f6f7e) Thanks [@jwloka](https://github.com/jwloka)! - Fleet scan resolves branch PR state from one `pr-list` response joined locally,
  instead of one `pr-state` lookup per branch.

  Measured 2026-08-18: 84 branches x 438 ms was 34 s, past the board's own 30 s
  `run()` timeout (`fleet.ts:260`) — so the board served a pulse 644 s old while
  reporting `Command failed`. On Bitbucket (issue [#228](https://github.com/plot-pm/plot/issues/228)) 14 branches cost 39 `bb`
  calls and the scan did not finish inside 110 s. On this repo the scan now makes
  20 host calls for 86 branches instead of 87.

  PR [#216](https://github.com/plot-pm/plot/issues/216)'s no-ref lookup stays: it asks about a branch a repo-wide list may
  legitimately not contain, and is bounded by absent branches rather than by all
  of them. A list that failed still reads as unanswerable, never as "no PR".

  <!--
  bumps:
    skills:
      plot: patch
  -->

## 2.5.2

### Patch Changes

- [#220](https://github.com/plot-pm/plot/pull/220) [`26dda6b`](https://github.com/plot-pm/plot/commit/26dda6b182bf7113cc6dc6e785f0b455ab1fc10a) Thanks [@jwloka](https://github.com/jwloka)! - The PR refresh stops losing a whole period to its own gate, so a 60 s cadence is actually 60 s.

  Measured on a running board on 2026-08-18:

  ```
  74 branches across 37 plans · scanned 19s ago · PR data 111s ago
  ```

  `PR_REFRESH_MS` is 60 000, so 111 s is a **missed refresh, not a stale one** —
  and the cause was local. A host call was measured at 1.4 s with 4986/5000 core
  quota remaining, so nothing was slow and nothing was throttled.

  The timer and the gate were two clocks set to the same period that could not
  both be met. `setInterval` fires at rigid multiples of 60 s, while `prNextAt`
  was stamped from the fetch's **finish** and so landed at 60 s + the call's
  duration — a hair past the tick meant to satisfy it. That tick was refused, the
  next came a full period later, and the board ran a 120 s cadence from a 60 s
  setting. Any non-zero fetch duration cost a whole period; the defect was
  bistable rather than gradual, because the refusal repeated forever.

  **`prNextAt` is now measured from the fetch's START.** The plan named two
  possible shapes and left the choice open. The other — running the timer at a
  fraction of the gate — was rejected on measurement rather than taste: because
  its gate still anchors to the finish, `prNextAt` keeps drifting forward by the
  call's duration every cycle, and a quarter-period timer can only round that
  drift up to the next quarter tick. Simulated at a 1.4 s call it lands the
  observed age at 73.6 s, still over the 60 s the Definition of Done requires,
  and it pays four wakeups per period for the privilege. Anchoring to the start
  removes the drift at its source instead of sampling around it, and keeps one
  tick per period.

  `prAt` still stamps at the finish, because it answers a different question:
  _how old is this data_, and data is not fetched until it has landed. The two
  stamps were the same number in one place, and that was the bug.

  **The gate still refuses, and a rate-limit backoff still holds for its full
  delay.** `maybeRefreshPrs` refusing early is load-bearing — it is what turns a
  rate limit into a wait rather than a tighter loop — so nothing here bypasses it.

  Anchoring to the start does, however, put the gate and the tick on the _same
  instant_, which is correct and knife-edge: `setInterval` does not promise to
  fire late, and one millisecond of early drift reopened the entire defect, since
  a single refusal still costs a full period. A fix that merely makes the bug rare
  is worse than none, because it stops reproducing in tests while still failing in
  production. So an ordinary cadence tick is now honoured if it arrives within a
  small tolerance (`PR_REFRESH_MS / 50`, 1.2 s at the 60 s cadence).

  That tolerance is applied to the ordinary cadence **only**. `prNextAt` had been
  carrying two different promises in one number: a soft target the timer is trying
  to hit, and a hard floor the host named. A single tolerance wide enough to
  absorb timer jitter is also wide enough to fire a second before a 61 s reset —
  spending quota to be refused again, the precise thing the backoff exists to
  prevent. The distinction is now carried in the data (`prNextIsBackoff`), and a
  backoff is compared exactly, with no slack whatsoever.

  The scheduling decision lives in one exported function, `prNextDueAt`, so the
  anchor is testable as arithmetic rather than only observable through a live 60 s
  timer. The tests drive it and `prGateOpen` against a fake clock, and the anchor
  they replaced is kept in the test file as an explicit control: it is asserted to
  **fail** the bar the shipped one clears, reproducing the measured 111 s. A first
  attempt modelled both anchors inside the test helper and so passed no matter
  what the source said — it was rewritten to bind to the real functions, and
  verified by reverting the anchor and watching six tests fail.

  `PR_REFRESH_MS` itself is unchanged. 60 s is a deliberate figure because the
  host is metered; the bug was that 60 s was not achieved, not that it was wrong.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#219](https://github.com/plot-pm/plot/pull/219) [`a4ecf36`](https://github.com/plot-pm/plot/commit/a4ecf3632db03b9c40f7062a304eabcd742f481e) Thanks [@jwloka](https://github.com/jwloka)! - <!--
          bumps:
            skills:
              plot: minor
              plot-dispatch: minor
              plot-fleet: minor
          -->

  plot: `finished` is not a verdict

  Every worker exits 0 — the one that opened its PR and reported cleanly, the one
  that stopped rather than claim a test run it had not seen, and the one that
  stopped to ask which retry semantics were wanted. Measured across seven
  worktrees during a four-agent fleet run. All three read `finished`, whose
  documented move is _review it_, and two of the three needed an answer instead.

  The process reports how it TERMINATED, never whether the task is DONE. So a
  clean exit is now refined by the tree, which is where the difference lives:

  | Condition                    | State                                  |
  | ---------------------------- | -------------------------------------- |
  | process alive                | `running`                              |
  | an open or merged PR         | `finished` — the work reached review   |
  | a blocked marker in the tree | `waiting` — a person owes it an answer |
  | uncommitted or unpushed work | `stalled` — work on the floor, no PR   |
  | otherwise                    | `finished`                             |

  Added **once**, to `plot-worker-state.sh`, which is the whole reason wave 1
  merged the duplicate first. `failed`, `ended` and `none` are untouched: each
  already says something specific about the process, and none of them is the
  `finished`-means-everything blur this splits.

  `waiting` and `stalled` are as opposite as `failed` and `finished` — _answer it_
  sends a person to a question, _resume it_ sends a worker back to work. A marker
  therefore outranks work on the floor: a worker that stops to ask has almost
  always left its work uncommitted beside the question, and reporting that as
  stalled invites a restart into the same wait. Measured happening twice to one
  branch, the second restart re-running what the first had finished.

  **Plot now names the marker: `PLOT-BLOCKED:`.** `TODO(you)` emerged from workers
  and was documented nowhere, so it could drift into `TODO(human)` — which it
  already had, in the same session — or into `ASK:` or prose, and a marker the
  classifier cannot find is a `waiting` reported as `stalled`. Both emergent
  spellings stay recognised beside the defined one: they exist in trees right now,
  and dropping them would silently regress every worker already running. The
  defined marker is what Plot **asks** for; the emergent ones are what it still
  **accepts**.

  The marker is read from the TREE, never the log. The log records that a question
  _was asked_; only the tree records that it is still _unanswered_, and only the
  tree clears when someone writes the answer.

  **`stalled` carries what is on the floor** — the count and the file names, not
  just a number. The names make the row actionable without a second command,
  which is the point of reporting it at all.

  **The PR fact travels as an argument**, supplied by each caller. The scan caches
  one host reply per branch per run behind its `--offline` gate; `plot-dispatch
--status` asks per branch when a person types it. A lookup inside the classifier
  would fork a `gh` per branch on a scan the board polls every 5 s, or break
  `--offline`'s promise of no network. Unanswerable is never a yes — offline, no
  backend, or a host returning 503 falls through to the local signals and reads
  `stalled`: _go and look_, rather than _stop looking_.

  **Editor leftovers are not work** (`.tmp*`, `.swp`, `.orig`, `.rej`, `.bak`) —
  a guard restarted a branch over an orphaned `plot-dispatch.sh.tmp1` while its
  worker was making progress. Nor is Plot's own bookkeeping: `.plot-worker.pid`,
  `.plot-worker.exit` and `.plot-worker.log` are untracked files the fleet writes
  into the worktree, and counting them made every tidily-finished worker read
  `stalled`. The exclusion stays narrow otherwise — an uncommitted source file is
  exactly the case this detection exists for.

  Two silent failures were caught while building this, both in the reassuring
  direction and both invisible behind `2>/dev/null`. `git grep --no-index
--untracked` is a fatal error (the flags are mutually exclusive), and `git grep
-qIE <pattern> --untracked` parses `--untracked` as a revision — each exits 128
  having matched nothing, so every waiting worker would have read `stalled`. And
  an unpushed-count fallback against `origin/main` reported every clean branch
  `stalled` in a repo with no remote, because `rev-list --count "..HEAD"` with an
  empty left side counts the whole history from the root. Only the branch's own
  `@{upstream}` answers that question; with no upstream it is unanswerable, and an
  unanswerable question licenses no verdict.

  The board reports both states in `waiting-on-you` with distinct notes — _waiting
  on an answer from you_ versus _stopped with work unfinished — resume it_.

  **Nothing is restarted.** The scan is read-only (Manifesto Principle 1); a
  `stalled` row names the branch and what is on the floor, and the decision to
  relaunch stays in `/plot-dispatch`. The reaper is untouched: it classifies
  _empty_ claims and answers a different question, and a stalled worker has work
  worth keeping.

  The prototype `.dev/scripts/fleet-pulse.sh` — corrected three times by watching
  it act — is deleted. Two things computing verdicts from one dataset is how they
  drift, which is the defect wave 1 removed.

- [#225](https://github.com/plot-pm/plot/pull/225) [`6baa654`](https://github.com/plot-pm/plot/commit/6baa654def0f03ddc44bd683fd6a754ec8ddb94c) Thanks [@jwloka](https://github.com/jwloka)! - plot-host: `pr-state` stops asking once a state has answered

  Resolving one branch to one PR walked all three Bitbucket states
  unconditionally. The ordering already decides the winner — open outranks
  merged outranks declined, and the filter takes the first match — so the
  later calls could never change the answer. They were pure cost.

  The cost was not small. Measured against a real Bitbucket on 2026-08-18:
  one `bb pr list` call takes ~10s, so every branch lookup cost 25.7s. The
  board's fleet scan calls `pr-state` once per branch and exceeded its own
  timeout on a five-branch plan, rendering `Last scan failed` with no
  indication that nothing was broken — it was merely slow.

  Same lookup after the fix: **1.8s**. The full `--json` scan over 14
  branches across 2 plans: **12s**, where it previously did not finish.

  A declined-only branch, or one with no PR at all, still pays for all
  three calls — those are the cases where the last call carries the answer.

  <!--
  bumps:
    skills:
  -->

  No skill version bumps: `plot-host.sh` is called by skills but documented
  by none, and no skill's behaviour changed — only how long it waits.

## 2.5.1

### Patch Changes

- [#210](https://github.com/plot-pm/plot/pull/210) [`139f025`](https://github.com/plot-pm/plot/commit/139f025580f97709959e1fe2a902b0cea79055e1) Thanks [@jwloka](https://github.com/jwloka)! - plot-host: translate --state into Bitbucket's vocabulary before sending it

  `plot-host.sh` is the one adapter over both hosts, and it already knew the two
  vocabularies differ — every response mapper turns Bitbucket's DECLINED into
  CLOSED. The translation only ever ran in that direction. The request carried the
  caller's GitHub word unchanged, so `bb` rejected `--state all` and
  `--state closed` outright and every history-wide query failed:

  ```
  error: invalid --state 'ALL' (must be open, merged, declined, or superseded)
  ```

  Observed 2026-08-18 against bitbucket.org with `bb` 1.0.0, where it left every
  PR-dependent group on the board reporting "PR data unavailable".

  `all` becomes SEPARATE CALLS rather than repeated flags. Measured: `bb` accepts
  `--state open --state merged` and silently keeps only the last, returning 50
  PRs — all MERGED, with the 3 open ones gone. No error, a plausible list, and the
  wrong answer. One call per state avoids depending on a `bb` fix, and the three
  states partition the set (74 PRs, 74 unique ids, 0 duplicates on the repo
  measured).

  `superseded` is deliberately not part of `all`: such a PR is replaced by a newer
  one for the same branch, and a board with one row per branch would show that
  branch twice. `gh`'s `all` has no equivalent, so nothing is lost — a caller
  wanting it asks by name.

  The GitHub path is unchanged, and was regression-checked: `--state open` and
  `--state all` both still return PRs.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#218](https://github.com/plot-pm/plot/pull/218) [`42146e4`](https://github.com/plot-pm/plot/commit/42146e41ae0cb4712bc641fb7cdb79bf85360b51) Thanks [@jwloka](https://github.com/jwloka)! - <!--
  bumps:
    skills:
      plot: patch
      plot-dispatch: patch
      plot-fleet: patch
  -->

  plot: a worker has one state, not one per reader

  `worker_state()` in `plot-dispatch.sh` and an inline copy in
  `plot-fleet-scan.sh` classified the same worker independently — same
  `.plot-worker.pid` read, same `kill -0`, same rejection of pid `0`, same
  exit-code mapping. They were written to agree and were never asked the same
  question about the same worktree, so nothing held them together.

  They had already drifted. A non-numeric `.plot-worker.exit` read as `ended`
  in the scan and `failed (exit abc)` in `plot-dispatch` — two verdicts from
  one fact, where whichever a reader consulted first would win. Found by
  running both against one fixture, which is a thing no test had done before.

  The classification now lives once, in `plot-worker-state.sh`, sourced by
  both. It returns facts — state, pid, exit code — and renders nothing: the
  two output shapes are real interfaces and both survive unchanged.
  `--status` still prints prose for a person (`failed 1234 (exit 3)`),
  `--json` still emits tab-separated fields for a machine (`failed\t1234\t3`).

  The drift is resolved toward `ended`, on the principle the scan already
  stated for the empty case: an unreadable record licenses no verdict, and
  "failed with code abc" invents one exactly as much as "finished" would. No
  previously asserted behaviour changes — the scan's suite already pinned
  `ended`, and `plot-dispatch`'s pinned only `0`, `3`, and an absent file.

  **No behaviour changes otherwise.** The six states keep their names and
  meanings. `elsewhere` stays the scan's alone: it answers "this machine has
  no worktree to look in", asked before there is anything to look inside.

  The new contract test drives BOTH consumers from ONE fixture across every
  state — that agreement is the point — and asserts structurally that the
  liveness check exists once, so a re-inlined copy fails rather than drifts.
  It also pins that every answer carries three tab-separated fields: POSIX
  `cut` prints a line unchanged when it holds no delimiter, so a bare `none`
  would put the state word in the exit-code slot without erroring anywhere.

- [#208](https://github.com/plot-pm/plot/pull/208) [`6c14571`](https://github.com/plot-pm/plot/commit/6c14571e5ff5e53ec9385f0cba628a332c251508) Thanks [@jwloka](https://github.com/jwloka)! - Add `plot-board-probe.sh`: a strictly read-only probe that emits one JSON
  object describing whether the Plot board can run in the current repository —
  node version, repo shape, board artifact location, Plot Config presence, plan
  count, CI signals, and CLI auth states.

  The probe decides nothing. Which artifact to recommend and what an empty board
  means are the consuming skill's judgment, not the script's (Manifesto
  Principle 3).

  Two details are load-bearing:

  - The artifact is resolved by _structure_, not by sorting. `marketplaces/` is
    the installed copy and `cache/<version>/` is history, so the former is
    matched explicitly and newest-mtime is only a fallback. Sorting paths picks
    the lexically-last one, and version strings sort so that `2.10.0` < `2.5.0`.
  - `auth` is a three-state enum (`ok`/`failed`/`unknown`), never a boolean. An
    unrecognised output reads as _cannot verify_, never as _authenticated_.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#215](https://github.com/plot-pm/plot/pull/215) [`2175cb5`](https://github.com/plot-pm/plot/commit/2175cb561ec6d4e6cd1518e131b3a32556ebd73e) Thanks [@jwloka](https://github.com/jwloka)! - <!--
            bumps:
              skills:
                plot: patch
                plot-dispatch: patch
            -->

  plot: the phase gate reads the plan from the shared ref

  Both phase gates parsed the plan file in the **working tree** — the least
  trustworthy surface available in a repo with several agents in it. It carries
  whatever branch was last checked out, plus whatever is uncommitted, and neither
  is a fact anyone else shares. That got the gate wrong in both directions, each
  reproduced in a sandbox 2026-08-18.

  **It refused work that was approved.** With the plan `Approved` on
  `origin/main` and the checkout parked on another branch carrying an older copy:

  ```
  origin/main phase:  Approved
  what plot reads:    draft
  plot-dispatch: plan '...' is still Draft — nothing may be dispatched.
  ```

  This bit three times in one session. A concurrent agent's `git checkout` moved
  the shared checkout, and `/plot-dispatch` refused two correctly-approved plans
  whose approvals were sitting on `origin/main` the whole time.

  **It permitted work that was not.** With the plan `Draft` on `origin/main` and
  an approval committed to a local branch and never pushed, the fan-out ran.

  The second is the serious one. Manifesto Principle 2 is _plans are approved
  before implementation_, and the gate is what enforces it. A gate that accepts an
  approval nobody else can see does not enforce that principle — it enforces
  "someone typed Approved in this filesystem". Nothing was reviewed, nothing was
  shared, and agents fan out anyway.

  Both gates now read the plan blob from `origin/<main>` — `git show
origin/<main>:<path>` — so the question they ask is the one they mean: _has this
  been approved where everyone can see it?_ Every refusal names the ref and sha it
  read; `origin/main@1beb3b97:plans/...` is debuggable in seconds, where "still
  Draft" alone sent an operator looking at a file that already said `Approved`.

  **They diverge on exactly one case, deliberately.** When `origin/<main>` cannot
  be resolved (no remote, fresh clone, offline):

  - `plot-dispatch.sh` **refuses**, naming the ref it could not read, and
    `--allow-local` is the explicit escape — named in the refusal so an operator
    learns it exists at the moment they need it.
  - `plot-phase-gate.sh` **allows the commit and says so**, emitting
    `plot-phase-gate: cannot read origin/main — phase unverified, allowing the
commit.` It is a PreToolUse hook; refusing every commit when offline would
    make the repo unusable, and the fail-open is a deliberate property.

  The reason for the divergence is blast radius: dispatch refusing costs one
  fan-out you can retry; the hook refusing costs every commit in the repository.
  An operator who sees that line knows the gate did not run — the whole difference
  between failing open and failing silently.

  **Neither ever falls back to the working tree**, which would reintroduce the bug
  precisely where nothing could catch it. Two implementation details enforce that
  rather than merely intending it:

  - **The `mktemp` template's `X`s must trail.** BSD `mktemp` (macOS) rejects a
    suffix after them where GNU accepts it. The first version wrote
    `plot-gate-XXXXXX.md`, failed on macOS, and — because the failure fell back to
    the working tree — silently resumed reading the exact surface this fix exists
    to stop reading. There is now no such fallback: an unreadable blob refuses.
  - **The hook's `MAIN` resolution needs `|| true` on every step.** Its fail-open
    guard is `trap 'exit 0' ERR`, so a bare `git symbolic-ref` that fails — the
    offline case exactly — exited the hook _before_ the "phase unverified" line
    could print. Failing open is correct; failing open without saying so is the
    bug being fixed.

  The active index is a directory of symlinks, and git stores a symlink as mode
  `120000` whose blob content is the target path — so `git show <ref>:active/g.md`
  yields `../2026-01-01-g.md`, not the plan. On a filesystem `[ -e ]` follows the
  link and this never comes up; against a ref it is dereferenced by hand, or the
  gate parses a one-line path as a plan and reports an unreadable phase instead of
  the real one.

  **`Impl: same branch` needed a case the plan did not anticipate.** In that flow
  the plan rides the WORK BRANCH and is never on `origin/<main>` at all, so a
  strict main-only read finds no plan and stops gating the flow entirely — caught
  by the e2e lifecycle suite. For those plans the hook falls back to
  `origin/<branch>`: still a shared ref, so a purely local approval is still
  refused, just the right shared ref for a flow where plan and code travel
  together. `origin/<main>` is tried first, so the ordinary flow is unaffected and
  a plan on main cannot be shadowed by a copy pushed to a branch. A plan on
  neither shared ref (a fresh `/plot-idea`, nothing pushed yet) allows the commit
  and says the phase went unverified — an unshared plan is not evidence of an
  approval, but it is not evidence of a Draft either, and the hook must not block
  a repo out of its own bootstrap.

  Tests cover both directions for both consumers, the same-branch flow in all
  three of its states, and the hook's offline behaviour both ways — that it still
  allows the commit _and_ that it emits the unverified line. The gate fixtures
  gained a real bare `origin`: without one they exercised the fail-open path
  rather than the gate, so the suite would have kept passing while testing
  nothing.

- [#213](https://github.com/plot-pm/plot/pull/213) [`cf2f0e2`](https://github.com/plot-pm/plot/commit/cf2f0e2827d6e88759d142822f695fcf4ad4eb6f) Thanks [@jwloka](https://github.com/jwloka)! - <!--
  bumps:
    skills:
      plot: patch
  -->

  plot-fleet: the pulse names the ref it read

  `plot-fleet-scan.sh` derived every fact from `origin/$MAIN` but built its
  banner from local `HEAD`. On `main` right after a fetch the two agree, which
  is why it survived — the common case made it look correct.

  Measured 2026-08-18, standing on a feature branch:

      scan header: plot-fleet pulse — 91a9a60 on origin/main
      local HEAD:  91a9a60
      origin/main: ee199aa

  The sentence was false in the only part a reader uses, and the same value
  travelled in `--json` as `head`, so every consumer — the board's Agents tab
  included — inherited it.

  The banner now names `origin/$MAIN`, and adds one clause when the checkout
  differs: `(not your checkout <sha>, N behind)`. The clause points at the
  report, not the tree — an operator told their checkout is behind still has
  no reason to doubt the numbers underneath it.

  `--json` gains `read_ref` and `local_head`. `head` remains as an alias for
  `local_head` for one release; the board reads it today and must not break.

  An unresolvable `origin/$MAIN` (no remote, fresh clone) reports `unknown`
  rather than falling back to `HEAD` — that fallback would reintroduce this
  bug in the one case where nothing can catch it, and `unknown` gets
  investigated in seconds where a real-looking SHA gets believed.

- [#217](https://github.com/plot-pm/plot/pull/217) [`ec7187c`](https://github.com/plot-pm/plot/commit/ec7187ccc8e76d72e867b5800020672b482470d3) Thanks [@jwloka](https://github.com/jwloka)! - <!--
  bumps:
    skills:
      plot: patch
  -->

  plot-fleet: the scan enumerates the ref it names

  `plot-fleet-scan.sh` derived every fact from `origin/$MAIN` and said so in its
  banner, but built the plan list from a filesystem glob over the active index.
  `git fetch` updates refs; a glob cannot see them. Measured in a two-clone
  sandbox, 2026-08-18:

      origin/main active plans (the REF): 3
      working tree active plans:          2
      scan --json reports:                2 plans

  The fetch **succeeded**. `origin/main` genuinely carried a third plan pushed by
  a second agent minutes earlier, and the scan reported two and exited 0 — so
  nothing anywhere could tell that answer from a correct one. The board's plan
  list was only ever as current as the operator's last `git pull`.

  It is worse during the fleet run the board exists to watch: rebases, checkouts
  and worker commits rewrite the working tree continuously, so the glob can
  return a different set on each 5 s poll while exiting 0 every time. That is the
  flicker `bug/a-smaller-pulse-is-not-silently-better` guards against; this is
  the cause underneath it.

  Plans are now enumerated with `git ls-tree origin/$MAIN` and read with
  `git show`, so the scan describes **one atomic commit**. Two polls of the same
  ref return the same plans no matter what is happening on disk.

  **Worktree observation stays local.** `local_dirty`, `local_worktree` and the
  `.git/index.lock` check describe _this machine_ on purpose — they are the one
  place the scan knows more than the refs do, and moving them to the ref would
  delete the signal rather than fix it. The split is: plan enumeration from the
  ref, worktree observation local.

  **An uncommitted plan is now invisible, deliberately.** The plan's Open Points
  asked for this to be decided rather than left implicit. Three reasons it is
  right: the fleet view answers _what may a worker claim_, and workers are
  detached agents in other worktrees and on other machines — not one of them can
  claim a plan that exists only in the operator's editor buffer; `/plot-idea`
  commits and pushes in the same flow, so the window is seconds wide, not a state
  anyone opens a board to watch; and a board that mixes shared state with one
  machine's scratch is the bug this file keeps fixing — `local_dirty` exists
  precisely so local facts travel _labelled_ as local. The rule is: committed is
  shared, and the fleet view shows what is shared.

  **A failed fetch is reported rather than discarded.** The old line was
  `git fetch … 2>/dev/null` with its status dropped, so a 503, a held ref lock or
  an offline laptop produced a scan indistinguishable from a healthy one. The
  scan still runs — `origin/$MAIN` from an hour ago is a real answer about a real
  commit, and refusing to report it would trade a slightly stale board for no
  board at all, exactly when the operator is most likely watching something go
  wrong. What changes is that the staleness is carried: `fetch_failed` and
  `fetch_error` in `--json`, a note in the prose. `--offline` is not a failure —
  the operator asked for local refs and got them.

  When `origin/$MAIN` cannot be resolved at all (a fresh clone, no remote) the
  scan falls back to the checkout and **says so** via `plan_source`. Falling back
  is honest; falling back silently would recreate this bug in the one case where
  nothing can catch it.

  Two faults found while building this, both invisible in the output:

  - The temp dir holding materialized blobs was created inside
    `$(ref_plan_file …)` — a **subshell** — so the parent's variable stayed empty
    and the `EXIT` trap cleaned nothing: one leaked directory per plan, per 5 s
    poll. Its lifetime is now owned outside the function.
  - An **absolute** symlink target (`ln -s "$(pwd)/…"`, which the board's own
    fixtures write) names no path inside a repository, so prefixing it with the
    link's directory resolved to nothing and the plan silently left the pulse.
    Caught by three board suites going from 104 passing to 93. Only the basename
    of an absolute target can be trusted, and only inside `$PLAN_DIR`.

- [#209](https://github.com/plot-pm/plot/pull/209) [`a263711`](https://github.com/plot-pm/plot/commit/a263711243fe18308661688f0a4adfad05d5bd6e) Thanks [@jwloka](https://github.com/jwloka)! - Board verification is a trap-guarded script, so the server is reaped on the path that fails.

  `plot-board-verify.sh` starts the board on an OS-assigned port, fetches
  `/api/board`, prints the payload, and stops the server — on every exit path.

  **The teardown is the whole reason this is a file.** The sequence is four
  commands; writing it into a SKILL.md as prose was the obvious alternative and
  the wrong one, for the reason `CLAUDE.md`'s _Gates Over Rules_ gives. "Always
  stop the server" is a **rule**: an agent can answer _did I complete this?_
  without having done it. `trap cleanup EXIT INT TERM` is a **gate** — the shell
  reaps the process whether the script returns, throws, or is interrupted,
  including the assertion-failure path prose forgets. A verification step that
  leaks a node process when its assertion fails is worse than no verification,
  because the leak is invisible until the machine runs out of ports.

  So the failure path is the one the tests prove: an artifact that answers 404 on
  `/api/board` must make the script exit non-zero **and** leave nothing behind.
  Measured against the real artifact on 2026-08-18 by exact PID set difference —
  success path and `SIGINT` path both leave zero processes that did not exist
  before the run.

  Two smaller decisions, both about not asserting what the script cannot know:

  `PORT=0` asks the OS for a free port rather than naming one. A verification run
  therefore cannot collide with a board the user already has open — and the bound
  port is not knowable in advance, which is why the script polls the server's own
  printed `localhost:<port>` line instead of sleeping a guessed interval. A fixed
  sleep is either flaky or slow. The poll also checks the process is still alive,
  so an artifact that dies on startup fails immediately with its own output
  attached instead of hanging out the full timeout.

  `set -uo pipefail` deliberately omits `-e`: under `-e`, the `[ -n "$pid" ] &&
kill` guard inside `cleanup` would abort the trap whenever `pid` was empty and
  skip the tempfile removal — the handler that exists to prevent a leak would
  become one.

            <!--
            bumps:
              skills:
                plot: patch
            -->

- [#214](https://github.com/plot-pm/plot/pull/214) [`890163c`](https://github.com/plot-pm/plot/commit/890163cb551d97c1e5bd34279ad2cbc4d0922e3b) Thanks [@jwloka](https://github.com/jwloka)! - Board test suite retries git calls when index.lock is held by the servers scan

  CI failed on a commit that added only markdown, with git reporting Unable to
  create /.git/index.lock File exists. The test fixtures start a real board
  server against the repo they then mutate, and both sides contend for the lock.

  The tests git helper now retries a bounded, lock-specific number of times on
  a transient index.lock hold, but fails immediately on any other git error.
  This is the same approach plot-fleet-scan.sh already takes in production —
  a lock reads as "an agent is writing HERE, RIGHT NOW", a state to handle rather
  than an error to propagate.

  The retry is bounded (10 attempts, 25 ms each = ~250 ms patience) and keyed on
  the lock message specifically. A blanket retry would paper over real git errors
  and turn a deterministic failure into a slow flaky one.

  Tested deliberately: a test holds index.lock from another process and asserts
  the helper survives it. A non-lock error still fails on the first attempt. The
  race is load-dependent — it failed in CI under four-agent load and passed 11/11
  in isolation — so neither test relies on the race happening.

  The same race also broke teardown. `after()` hooks await `server.stop()`, but
  that resolves when the server process exits — not when the git children it
  spawned mid-scan do. A grandchild is outside the scope of that SIGTERM, so it
  can still write into the fixture while `rmSync` walks it, and `rmdir` then fails
  with ENOTEMPTY. CI failed exactly this way on `outer/.git`. Awaiting the server
  was the earlier attempt at this and did not hold, because it addressed the
  process that was waited for rather than the ones that were not.

  A matching `rmTree` helper retries only ENOTEMPTY/EBUSY/EPERM, and every
  suite that starts a server against a git repo now uses it. `read-ref` also
  carried its own non-retrying copy of the git helper; it now imports the shared
  one, so there is again a single implementation.

  Its tests inject the failure rather than race for it: a real writer could not be
  made to lose reliably — measured, a child recreating the file every 1 ms still
  let a plain `rmSync` succeed — so a test built that way would pass whether or
  not the retry existed.

  <!--
  bumps:
    skills:
      plot: patch
  -->

## 2.5.0

### Minor Changes

- [#124](https://github.com/plot-pm/plot/pull/124) [`d6d5d8d`](https://github.com/plot-pm/plot/commit/d6d5d8db56e54124d2e0bbe4095d164d7ff8ac3f) Thanks [@jwloka](https://github.com/jwloka)! - `/plot-dispatch` now records a `Started:` entry when it fans out, so a
  dispatched plan reads as started.

  `/plot-implement` has always written that record; dispatch never got the
  equivalent, so a fanned-out plan sat in Design badged _Ready_ while agents
  edited its branches — the board's two tabs disagreeing by construction, because
  the card reads the plan file while the Agents tab reads git refs.

  The record is written **on the default branch**, through a disposable
  `plot/start-<slug>` branch pushed with `plot-push-main.sh`. That is the whole
  difficulty: `plot-dispatch.sh` finds the plan in its local working tree on
  whatever branch the dispatcher is standing on, while the board reads the plan
  from the default branch. Appending to the local file would book the start where
  the board never looks.

  One line per branch the run newly claimed, written **after** the claim push
  succeeds — a `Started:` record for a branch another dispatcher won would be a
  lie in the file. A re-run adopts existing worktrees and books nothing it did
  not newly claim.

  **A failed booking never unwinds a fan-out.** Offline, refused, or beaten to
  the ref: by then the worktrees exist and the claims are pushed, and those are
  the real state. The script reports that the record is missing and carries on.
  `--dry-run` writes no branch, no commit and no push.

  <!--
  bumps:
    skills:
      plot-dispatch: minor
  -->

- [#115](https://github.com/plot-pm/plot/pull/115) [`93be66e`](https://github.com/plot-pm/plot/commit/93be66ee6e95a9c64d875b9a5959143d33c00ca0) Thanks [@jwloka](https://github.com/jwloka)! - Plot now reports when a push to the default branch bypassed branch protection.

  `/plot-approve`, `/plot-deliver` and the hub's phase-fix sequence push a
  disposable branch straight at the default branch. Where protection is
  configured but not enforced for the pushing actor, the remote waves the push
  through — exit 0, with only a notice on stderr — so the documented "if that
  push is rejected" fallback never fired, and bookkeeping commits landed past a
  rule requiring a pull request without the required check ever running.

  The new `plot-push-main.sh` performs the push and classifies the outcome:
  `clean`, `bypassed` (landed, protection waived — it names the rules stepped
  over and the checks that did not run), `unknown` (landed, the remote said
  something unrecognised — never reported as clean), or `rejected` (exit 1, the
  only outcome where the micro-PR fallback applies). The exit code answers one
  question: did the commit land?

  The plan template also gains an optional `Story:` field, which the plan parser
  and the board have always read but the template never offered.

  <!--
  bumps:
    skills:
      plot: minor
      plot-approve: minor
      plot-deliver: minor
  -->

- [#176](https://github.com/plot-pm/plot/pull/176) [`465141f`](https://github.com/plot-pm/plot/commit/465141fdf75f5dc364d05902366e740b9ebe4224) Thanks [@jwloka](https://github.com/jwloka)! - An acting button on the board now carries a spinner while it acts.

  The seeing half of a report from 2026-08-17: _"Click on actions like 'Start
  work' or 'Approve' don't have an activity indicator … User does not see that.
  Action is going to be executed."_ Measured, an indicator did exist — the label
  swaps to `starting…` / `approving…` and `aria-busy` is set — and it is a word
  change in a small text button, easy to miss on a control the reader is not
  looking directly at, and indistinguishable at a glance from a button that did
  nothing. The fix is to make the existing feedback loud, not to add feedback.

  **A spinner, deliberately not the WORKING rows' pulsing dot.** The two claims
  differ by lifetime: a row's `isLive` is `group === 'working'`, so it can pulse
  for hours with no known end, and rotation there would promise a progress
  nothing measures — the reason `working-rows-show-motion` chose a pulse. A click
  resolves in seconds and there is never more than one in flight, so neither
  reason survives the move onto a button. Unifying the two was rejected in both
  directions, and the regression is asserted: the row's dot must stay a dot.

  **`motion-reduce` stops the rotation and keeps the marker** — inherited from
  `working-rows-show-motion` rather than re-decided, because removing the element
  would take the marker away with the motion and leave a reader who prefers
  reduced motion with less information rather than the same information held
  still.

  **The marker is `aria-hidden`** — the state is announced twice already, by the
  label and by `aria-busy`. **The label still changes**, beside the marker rather
  than instead of it: motion is never the only carrier of a fact. **The button
  dims** on the same state that drives the label, never on a timer of its own, so
  three channels — motion, text, contrast — each say it once.

  Last of three waves. The order was deliberate: the double-click guard was
  pinned and latched first, then what the button watches for success was
  corrected — until that landed, a spinner would have been motion over an outcome
  the button was reading wrong.

  <!--
  bumps:
    skills: {}
  -->

- [#177](https://github.com/plot-pm/plot/pull/177) [`4c7e3ca`](https://github.com/plot-pm/plot/commit/4c7e3cab76d9a26a194399e5c4e9778391f8f674) Thanks [@jwloka](https://github.com/jwloka)! - A Draft card shows how hard its plan has been questioned.

  `/plot:challenge-the-plan` records its state in the plan file as a multi-line HTML comment. The parser's standing rule is that multi-line comment interiors are non-content — template guidance blocks live there — so the round it writes was invisible to everything downstream. Measured on 2026-08-17: `plot-plan-meta.sh` returned 22 keys for `docs/plans/2026-08-17-acting-buttons-show-they-act.md`, and `round` was not among them, although the file carries `"round": 2`.

  **The parser reports it.** `plot-plan-meta.sh` gains a `rounds` field, read from the block via its `CHALLENGE-THE-PLAN-METADATA` sentinel rather than by recognising "a comment that looks like JSON". Keying on the sentinel is what keeps the general rule intact: `canonical-comment-block.md` still parses as all-absent, and a guidance comment still contributes nothing.

  **Absent is not zero, and the field is omitted rather than defaulted.** `0 rounds` reads as _interrogated and found nothing_; a missing block means _nobody has looked_. Those want opposite reactions from a reader, so the key is left out of the JSON entirely and carried as `.optional()` through the contract — the same rule, for the same reason, that `claimed` and `eligible` already follow on `WaveSummarySchema`. A recorded `0` survives as `0` and stays distinguishable from both.

  **The badge is Draft-only.** Past Discovery the count is history: approval settled the question it answers, and a number nobody acts on is the crowding this board keeps removing. The split is deliberate — the SERVER carries `rounds` for any plan that records one, and the CLIENT decides where to show it (`roundsBadgeText`), so a display rule stays in display logic rather than making the data field mean different things per column.

  **The agent row does not gain it.** A row is a statement about one branch, and most rows name a plan whose design phase closed long ago; attaching a design-time count there would put it on every one of them. Card-only, the same split `waveSummary` already follows, and pinned by a test asserting the field is absent from `AgentRowSchema`.

  **A malformed block costs only the round.** `plot-plan-meta.sh` is the plan-format contract and every other command depends on it, so a truncated or non-JSON metadata comment must not cost a plan its phase, type or branches. It does not; the round is simply absent.

  The script collects and does not interpret (Manifesto Principle 3): it reports the number it finds, with no judgement about whether two rounds is enough.

  Tests assert against **real plan files** in `docs/plans`, not hand-made fixtures. That is load-bearing here rather than stylistic: a fixture-shaped test would have passed against a format the skill does not emit, which is exactly how the field came to be missing in the first place.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#167](https://github.com/plot-pm/plot/pull/167) [`15a2e06`](https://github.com/plot-pm/plot/commit/15a2e06ce5c16f618a68efd220a679724719af68) Thanks [@jwloka](https://github.com/jwloka)! - `/plot-dispatch` now says in its **summary** why no worker started, and asks
  once — at the first fan-out — how the project runs an agent headless.

  `started=0` was always in the footer. The reason lived in per-branch output,
  printed by `start_worker` after the fan-out had already happened. On 2026-08-17
  that message was printed and missed five times: worktrees sat claimed with
  nobody working on them, and the last line a caller read said `started=0` with
  nothing beside it.

  So the fact now travels twice, both in the summary block:

  ```
  2 worktrees prepared, 0 workers started, no `Worker command` configured
  summary: dispatched=2 reused=0 skipped=0 started=0 brief=missing worker=unconfigured
  ```

  **The footer stays pure `key=value` and stays last**, as every footer in this
  repo is — consumers read that one line, never the prose. The sentence sits above
  it, the way the failed-booking note already does. In the footer it would have
  been readable and unparseable; only in the footer, parseable and unread.

  `worker=` has four values, because collapsing any two re-creates the defect this
  change exists to remove — one label over states whose actions differ:

  | Value          | Means                                                             |
  | -------------- | ----------------------------------------------------------------- |
  | `configured`   | a `Worker command` exists                                         |
  | `unconfigured` | nobody has been asked                                             |
  | `declined`     | `Worker command: none` — asked, and this repo starts them by hand |
  | `suppressed`   | `--no-start`                                                      |

  **`declined` is not `unconfigured`.** `plot-config.sh` returns the default for a
  missing key and an empty one alike, so an empty answer left blank would be
  indistinguishable from never having asked — and the question would come back at
  every fan-out. `none` is the repo's established sentinel for a deliberate
  absence (`Implementation home: none`), and it is what makes _"I start them
  myself"_ a recordable answer rather than a deferral. It is never run as a
  command: a worker per branch failing with `none: command not found` would turn a
  decision into N crashes.

  **The asking belongs to the skill, and to the first dispatch.** A bash script
  cannot put a question to a human inside an agent session — scripts collect and
  report, skills interpret — so the prompt lives in `skills/plot-dispatch/SKILL.md`
  as step 3, after the dry run, with the count in hand. Not at `/plot-init`:
  adoption runs long before anyone fans out work, so the question meets a need the
  answerer does not have, gets a shrug, and writes an empty key nobody revisits —
  an answered-and-wrong config is harder to fix than a missing one, because
  nothing later notices it was never really decided.

  **It asks; it never suggests.** No example command in the prompt. An example
  becomes a template, and then Plot has effectively hardcoded a tool it is not
  supposed to know (Principle 5). The problem was never _which_ command — it was
  that nobody learned the option existed.

  **`--no-start` is untouched and means exactly what it says.** Its zero reports
  as a choice, not a config gap; the inspect-first workflow was never the defect.
  A `--dry-run` explains nothing at all — it starts nothing by construction, so
  the line would be true, useless, and would train the reader to skip it on the
  run where it matters.

  <!--
  bumps:
    skills:
      plot-dispatch: minor
  -->

- [#156](https://github.com/plot-pm/plot/pull/156) [`30f40a7`](https://github.com/plot-pm/plot/commit/30f40a7de7ee0c26bb8ccca591af4fe4c3735b6c) Thanks [@jwloka](https://github.com/jwloka)! - `plot-dispatch` now reports what work is already in flight before it fans out.

  Waves are a within-plan ordering, so a correctly eligible branch can still name
  a file an agent has open on a different plan's branch — nothing in the wave
  model represents that. Each candidate line is now followed by what is held:

  ```
  would dispatch feature/agent-view-phase-ui → …
    in flight: bug/board-shows-staleness holds App.tsx, AgentList.tsx
  ```

  Measured from **local refs and worktrees**, not the remote: the collision that
  blocked a dispatch on 2026-08-16 lived in an unpushed commit, and uncommitted
  work is invisible to refs entirely. That is sound rather than a violation of
  refs-as-truth, because dispatch is inherently machine-specific — it creates the
  worktrees here.

  Each branch is compared against **its own merge-base**, so a rebased branch does
  not report every commit it picked up from main as its own work. The generated
  `board-server.mjs` is excluded: every board branch rebuilds it, so including it
  would make every board pair look like a collision.

  The report is **bounded** — at most 8 branches, at most 6 files each, with the
  remainder counted. Measured against this repo's real state, the unbounded
  version printed 13 branches under one candidate, one of them naming 18 paths.
  Both caps are plain truncation, never a judgment about which branch or file
  matters.

  It **reports and refuses nothing** — nothing on the candidate side is predicted,
  so there is no prediction worth acting on. `git merge-tree` cannot help at this
  moment (dispatch creates the candidate branch, so it is identical to main and
  the comparison is clean for every candidate, forever), and a `Touches:`
  self-declaration would fire on nearly every board pair because the real scope
  guards nest inside one another.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#158](https://github.com/plot-pm/plot/pull/158) [`0cf29ad`](https://github.com/plot-pm/plot/commit/0cf29ad0c5d1a4d34250be6f388cf944030d8631) Thanks [@jwloka](https://github.com/jwloka)! - `/plot-dispatch` now writes a hand-off brief per branch it fans out, by
  invoking `/plot-implement` — the step it has always skipped.

  Dispatch created a worktree, pushed a claim and booked a `Started:` record,
  then stopped. Writing the brief was left to a person, and on 2026-08-17 a
  person supplied it every time: three rows sat in WORKING with a pulsing green
  dot while nobody was working on any of them. The claim was real; the hand-off
  was never made.

  **The caller is the SKILL, not the script.** No script in this repo invokes a
  skill, and bash cannot reach one at all — skills exist inside an agent session.
  That is the Manifesto's direction rather than an omission (_skills interpret and
  adapt; scripts collect and report_), and a brief is interpretation: what it adds
  over the plan is the alternatives already rejected and the measurements that
  killed them. `skills/plot-dispatch/SKILL.md` is the session-level layer that
  already drives the script through its phases, so the brief step lives there.
  `plot-dispatch.sh` keeps doing exactly what it did.

  **One definition of what an implementer needs to know.** A template string in
  the dispatcher would be a second one, and it would drift from the first the way
  every duplicated rule here has.

  `plot-implement`'s brief template grew from 8 lines — a shape nobody had ever
  used — to the shape the briefs written by hand actually take: a _what to build_
  narrative, the settled decisions each with the measurement that killed the
  obvious alternative, the assertions a naive implementation would pass without, a
  bookkeeping duty and a scope guard naming the branches in flight. Real briefs
  run 111–127 lines, and the difference is not padding. The brief lands at
  `.plot/briefs/<branch>.md`, committed to the default branch, so a resumed or
  replaced agent can read it without the dispatching session.

  The brief step is Frontier tier in both skills' Model Guidance: naming which
  alternatives a plan rejected is judgment, not template filling.

  **A direct script call reports the gap rather than refusing.** The summary gains
  a constant `brief=missing` field — the script cannot write a brief and never
  will, so it says what it left undone instead of leaving a claimed worktree
  looking handed over. It does not refuse: `--dry-run` and `--status` are the
  normal way to look before leaping, and a gate that blocks looking is a gate in
  the wrong place. `--no-start` suppresses workers, not briefs.

  <!--
  bumps:
    skills:
      plot-dispatch: minor
      plot-implement: minor
  -->

- [#186](https://github.com/plot-pm/plot/pull/186) [`6aff2c3`](https://github.com/plot-pm/plot/commit/6aff2c386ac414fc1cfa5d06e8ea8f056f31ac47) Thanks [@jwloka](https://github.com/jwloka)! - The board now repairs an artifact-only merge conflict by itself — the **one**
  automatic write this system grants.

  `skills/plot/scripts/board/board-server.mjs` is generated output, and two
  branches touching entirely disjoint sources still collide in it. On 2026-08-17
  that happened twice in one afternoon, and both times a human did the same five
  fixed steps: merge, take a side, `pnpm build:board`, `pnpm run test:board`,
  push. About five minutes each, with no decision anywhere in it.

  **The permission rests on three verified properties and on nothing else.**
  `.gitattributes` marks the artifact `-merge`, so git keeps one side whole and
  writes no conflict markers — the file stays buildable JavaScript _through_ a
  conflict. `build.mjs` embeds no timestamp and no randomness, so the rebuild's
  output does not depend on which side was kept. And CI's no-diff gate fails the
  build if the committed artifact does not match a fresh rebuild. Together they
  make this the one repair whose correctness is checkable **without judgement**.
  No other failure has those properties, and none may be added to this path.

  **It is a script, not an agent.** The sequence is fully determined and nothing
  between its steps is a decision — which is precisely what licenses the
  automation. Handing it to an agent would introduce judgement exactly where its
  absence is the permission.

  **Tests run before the push.** CI's gate runs only _after_ a push, so a
  resolver that pushed and waited would manufacture the very state this plan
  defines as stuck: a red PR in the queue. The sequence ends on `test:board`
  green in the branch's own worktree, and a failing suite pushes nothing and
  leaves the branch reported as a conflict a human owns.

  The fences are the design, and each has a test aimed at an implementation that
  would satisfy the happy path without it: the entry condition is _exactly_ the
  artifact-only conflict set (never _is the artifact among the conflicts_), a
  host verdict with no observed conflict set is refused, two repairs never run on
  one branch at once, and every repair is reported on the row — running, pushed,
  or abandoned. A silent automatic write is indistinguishable from a defect,
  which is the failure mode this whole plan exists to remove.

  The localhost guard on `/api/dispatch` and `/api/approve` is untouched: the
  resolver rides the scan timer and is not a route at all.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#183](https://github.com/plot-pm/plot/pull/183) [`29f0bd0`](https://github.com/plot-pm/plot/commit/29f0bd08c65c335390671e9cc48826c70f2a9000) Thanks [@jwloka](https://github.com/jwloka)! - The scan reports that a branch cannot MOVE, not only what it is

  `plot-fleet-scan.sh` has always reported what a branch _is_ — claimed, eligible,
  blocked, in progress. Five branches got stuck in one afternoon on 2026-08-17 and
  not one of them showed up as anything but normal:

  | Incident                                                                | What it cost                                       |
  | ----------------------------------------------------------------------- | -------------------------------------------------- |
  | [#176](https://github.com/plot-pm/plot/issues/176) artifact conflict    | recreate worktree, take a side, rebuild, 547 tests |
  | [#177](https://github.com/plot-pm/plot/issues/177) artifact conflict    | the same again                                     |
  | [#177](https://github.com/plot-pm/plot/issues/177) rebase never pushed  | noticed by accident; 30 minutes of dead CI         |
  | [#179](https://github.com/plot-pm/plot/issues/179) Playwright CDN `403` | read the log, compare run history, rerun           |
  | [#172](https://github.com/plot-pm/plot/issues/172) fixture regression   | add the missing field                              |

  The [#177](https://github.com/plot-pm/plot/issues/177) case is the sharp one: from outside, a rebase that stayed local is
  indistinguishable from an agent that stopped.

  **Four stuck states, each named separately, each with its evidence.** _Stuck_ as
  one label would be the one-label-many-states defect this repo keeps removing —
  the four differ in the only way that matters, which is what a person does next:
  an artifact-only conflict, a real conflict, unpushed work, and a failing check.

  **Artifact-only is not artifact-among.** The mechanically resolvable case is a
  conflict set of _exactly one file_, that file being the board artifact. A
  conflict touching the artifact _and_ anything else needs judgement as a whole,
  even though one of its files does not. An implementation asking _is the artifact
  among the conflicts?_ passes the artifact-only case and silently misclassifies
  every mixed one, so the set — not the artifact's presence in it — decides.

  **A failing check is reported as evidence and never judged.** The row carries
  the failing check names, the branch's changed paths, and the branch's own recent
  run history; a human concludes. A heuristic mapping failing steps to changed
  paths was rejected: that table is unmaintained by construction and goes silently
  wrong the first time a workflow is restructured (Principle 3).

  **Unpushed work is reported and never fixed.** Pushing someone else's
  uncommitted judgement is not mechanical, and the count is true only on the
  machine doing the looking.

  **A branch that is not stuck produces nothing.** A watcher that flags everything
  flags nothing.

  Read-only and stateless throughout. `git merge-tree --write-tree` computes the
  merge entirely in memory, so a conflict is _foreseen_ rather than present, and
  every state is re-derived from git and the host on each run — there is no
  watcher state to become stale.

  New in the pulse: `conflicts`, `conflicts_known` and `changed_paths` per branch.
  `conflicts_known` is what keeps an empty list from meaning two things, since
  _merges cleanly_ and _nobody could ask_ arrive in the same shape. New on the
  host adapter: `failing_checks` on `pr-list --rich` (same response, no extra
  call) and a `runs <branch>` op, metered and asked only where a failure has
  already been observed.

  The display is a separate wave, and the one granted repair another: this writes
  nothing, pushes nothing and resolves nothing.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#169](https://github.com/plot-pm/plot/pull/169) [`2432cdf`](https://github.com/plot-pm/plot/commit/2432cdf18835dee8bc6e60ca57bc0d7d1853073d) Thanks [@jwloka](https://github.com/jwloka)! - The board's `Approve` button no longer needs a configuration key.

  **Two controls on one surface asked different questions.** `Start work` called `plot-dispatch.sh`, a script Plot ships, and worked out of the box. `Approve` beside it called `sh -c '<Approve command> "<prompt>"'` and did not — it rendered dimmed on every card in this repo, naming a key nobody had set. The board reported it plainly: `"available": false, "reason": "no `Approve command` in this project's Plot Config"`.

  **The justification did not survive the comparison.** `Worker command` is per-project because dispatch starts an agent that writes an _implementation_ — genuinely unknowable to Plot. Approving under `Review: pr` merges a PR whose number the plan already records and writes a dated line into a known field. The real difference was never _approve needs an agent_; it was **approve had no script**, and the board reached for an agent because there was nothing else to reach for. `plot-approve.sh` now exists, so `approveAvailability()` asks exactly what `dispatchAvailability()` asks: is this a local, same-origin request.

  **`Approve command` is demoted, not removed** — and the two entrances are not two implementations. A project that wants the full skill (the ceremony questions, the tracer-bullet heuristic, the `in-session` walkthrough) still declares one, and the board prefers it when present. The skill itself calls `plot-approve.sh`, so the seven mechanical steps go through one implementation either way:

  ```
  no Approve command:    board → plot-approve.sh
  with Approve command:  board → agent → SKILL.md → plot-approve.sh
  ```

  Without that, demoting rather than removing would leave two paths to one outcome, free to drift — the duplication this change exists to remove, reintroduced as a configuration option.

  **Over a non-localhost binding the button stays disabled, and that is correct.** The binding is the authorisation, and a Tailscale address is deliberately not localhost. The phone that reads the board perfectly well does not approve from it: approving merges a PR and writes to the default branch, which is a different decision from reading a status away from the desk. `Start work` behaves identically for the same reason, and a future reader finding both disabled on a phone should find this paragraph rather than a bug.

  **`ApproveButton` moves off the native `disabled` attribute to `aria-disabled`.** A natively disabled control leaves the tab order and takes its `title` explanation with it, out of reach of exactly the reader who cannot see that it is dimmed. `StartWorkButton` settled that in an earlier change; the two were built in parallel and this one did not see the decision. The refusal is now stated twice on purpose — the attribute is what assistive technology reads, and a guard in the click handler is what makes it true.

  Also: the test harness now stubs `plot-approve.sh` alongside `plot-dispatch.sh`. It is what `/api/approve` spawns where no command is declared, and a real run merges a plan PR on the git host — a symlink to the real script would have put that one `git rev-parse` away from CI.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#168](https://github.com/plot-pm/plot/pull/168) [`3e511de`](https://github.com/plot-pm/plot/commit/3e511de91915efcd676cf4860089a1f7108286c5) Thanks [@jwloka](https://github.com/jwloka)! - `plot-approve.sh` — approving no longer needs an agent

  `Start work` on the board calls a script Plot ships and works out of the box;
  `Approve` beside it called a per-project `Approve command` and did not, because
  no such script existed. The justification did not survive the comparison:
  `Worker command` is per-project because dispatch starts an agent that writes an
  _implementation_, while approving under `Review: pr` is seven writes with no
  judgement in any of them — merge the plan PR, flip the phase, fill `Approved:`,
  clear the `.plot/hold` entry for each branch the plan names, update the sprint
  annotation, push via `plot-push-main.sh`.

  The script is **idempotent**, because step 2 merges the PR and that write cannot
  be undone while everything after it is local. Every step tests the source it
  would have written — `pr-state`, `plot-plan-meta.sh`, the hold file, the sprint
  file — never a progress file of its own, so a run interrupted between the merge
  and the push is repaired by running it again.

  It refuses, with the reason reaching the caller, a plan that is not Draft, a
  `Review:` other than `pr` (`in-session` and `ballot` need a human in the room),
  and a PR that is draft, closed, or absent.

  `plot-approve/SKILL.md` now calls it instead of describing it, and keeps only
  what needs a reader: whether a draft is ready, the in-session walkthrough, the
  ballot tally, the ceremony questions, and the tracer-bullet heuristic.

  <!--
  bumps:
    skills:
      plot: minor
      plot-approve: minor
  -->

- [#161](https://github.com/plot-pm/plot/pull/161) [`e60645a`](https://github.com/plot-pm/plot/commit/e60645a172e851531cc7593dbf47f836ab95c07f) Thanks [@jwloka](https://github.com/jwloka)! - A Draft plan card can now be approved from the board, behind one confirmation.

  **A Draft plan in Discovery offered nothing to do.** Since the Discovery column existed, a plan under PR review renders as a card — and the obvious next step from looking at it is approving it, which the card had no affordance for. The reader had to remember the slug and switch to a terminal. Eight plans were approved in a single evening this way, each through the identical sequence.

  **Approve ACTS; it does not copy a command.** An earlier design had it merely show and copy `/plot-approve <slug>`, on the grounds that the command merges the plan PR, rewrites the phase, writes the `Approved:` record and clears `.plot/hold` — writing to the git host, undoable only by more git, where `Start work` merely creates a worktree and a wrong click costs a `git worktree remove`. That asymmetry is real and it is not the whole picture: the same irreversibility exists when the command is typed in a terminal, where nothing confirms anything, and it gets typed _by rote_. A button is not more dangerous than a command someone runs without thinking; it is the same act with less friction. A copy-a-command affordance would also have put two buttons side by side — one acting, one merely offering text, indistinguishable by looking — onto a surface that had exactly one action vocabulary.

  **One confirmation, in the button itself.** The first click turns `Approve` into `Approve — merges PR #<n>?`; the second runs it; a click anywhere else, or Escape, cancels. No dialog, no modal above a modal, no new pattern. The armed label names the **consequence** rather than repeating the verb, which is the part a reader needs before committing. A failed attempt re-arms rather than re-running, so the confirmation is required every time rather than once ever. The first click is asserted to make **no request at all** — a single-click implementation passes every test that only checks the end result, and fails exactly there.

  **It appears on every Draft card, and only on Draft cards.** Only: an approved plan has nothing to approve, and offering it would invite a second approval whose one effect is a confusing error. Every: including plans whose PR is not yet marked ready, a state that occurred repeatedly in one evening. Hiding the button there would mean the board knew Approve's preconditions and had to keep them in step with the skill — the same rule in two places. The command refuses in its own words instead, and the card shows them. The board's whole test is the column: `Discovery` **is** Draft, one-to-one.

  **A failure shows the command's own message.** `/plot-approve` already explains itself — _"Plan is still a draft. Mark it ready for review first."_, a closed PR, a rejected push. Surfacing that beats replacing it with "failed": a failure without a reason sends the reader to a terminal, and then the command could have been typed there in the first place. Because the route spawns detached and answers before the command finishes (the same constraint `/api/dispatch` lives under, on a single-threaded server that must not freeze every viewer's board for one person's click), the reason cannot ride on the 202 — so it is read back from `GET /api/approve/<slug>`, which reports `unknown`, `running`, `done` or `failed` with the command's last words. `unknown` is not a degraded `failed`: nothing has been attempted for that plan, and a red message on a card whose button was never pressed would be the board asserting something it does not know.

  **It runs through the same door as `Start work`** — `POST /api/approve`, with the localhost binding, the same-origin check and the slug validation **imported** from `/api/dispatch` rather than restated, because a second copy of a security decision is a second place for it to be weakened. The load-bearing test is the same one that route has: a refused request ran **nothing**, which matters more here, since a wrong dispatch costs a `git worktree remove` and a wrong approval merges a PR.

  **What the plan did not anticipate: there is no `plot-approve.sh`.** The design assumed a symmetry with `/api/dispatch` spawning `plot-dispatch.sh`, and `/plot-approve` is a _skill_, not an executable — it branches three ways on the plan's declared review channel, asks the two ceremony questions on a pre-Plot-2 plan, weighs a tracer-bullet heuristic, and merges only in the `pr` case. Writing a script that did all that would put the approval rules in exactly the two places the plan forbids. So the board asks for the skill **by name** and lets the adopting project say what runs it, through a new optional `Approve command` config key — the same shape `plot-dispatch.sh` already uses for `Worker command`, and for the same reason: how to run an agent headless is a per-project answer Plot must not hardcode.

  That gives approve its **own** availability, separate from dispatch, which the plan also did not anticipate. A board on localhost can always dispatch, because `plot-dispatch.sh` ships with Plot; it can approve only where the project has declared a command. One shared flag would be wrong for one of the two whichever way it was set, so `/api/board` reports both — and an unavailable Approve **names the config key** rather than saying "unavailable", since not configured is a next step, not a fault.

  **Also found, and deliberately not fixed here:** the `tiny-garden` test fixture's own `CLAUDE.md` is shadowed. `plot-config.sh` locates configuration via `git rev-parse --show-toplevel`, so a fixture nested inside the plot checkout has every key read from plot's own config instead — unnoticed until now because the two agreed on the keys that existed. The Approve browser tests run against a copy of the garden outside the repository rather than papering over it; the shadowing is a real finding and belongs in its own change, where whatever else depends on it can be examined.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#114](https://github.com/plot-pm/plot/pull/114) [`ff4b419`](https://github.com/plot-pm/plot/commit/ff4b419eac8604c8113d6be4816b58a5365e94a5) Thanks [@jwloka](https://github.com/jwloka)! - The board links to what its rows and cards name: the plan, the pull request, and the story.

  Every one of those was a dead end. To see the PR you left for the browser, to read the plan you left for the editor — on a view whose whole job is telling you where work stands.

  **The href had to come from somewhere, and it could not come from the board.** `pr-list --rich` projected `number, title, state, head, draft, checks, review` and dropped the URL on both backends, so the board had PR _numbers_ and no way to turn one into a link. It must not learn one: nothing under `packages/board/src` distinguishes github.com from a self-hosted Bitbucket, and templating an address from a config key produces a plausible link and a wrong one for GitHub Enterprise. So `pr-list --rich` gains `url` — one jq field per backend, read from the same places `pr-state` already reads — and `plot-host.sh` stays the one thing that knows what a host URL looks like. Where the adapter reports no URL, the number renders as plain text. Inventing one where the adapter has the real one is how a link becomes confidently broken.

  **PR numbers were parsed and dropped without anything in between.** `PlanMetaSchema` read `prs` as `z.array(z.number())`, `CardSchema` had no such field, and `board.ts` contained no occurrence of the string `prs` at all. Cards now carry them, each paired with the URL the host gave us or an empty string.

  **`--state all` needed `--limit` to mean anything.** Both host CLIs page at 30. That is invisible with `--state open` — few repos have thirty open PRs — and bites the moment the board asks for merged ones too, where the newest thirty crowd out every older PR and leave exactly the finished work unlinked. `pr-list` takes `--limit` now; without it the host's own default stands, so no existing caller's result changes. The single fetch serves both indexes, and the by-head map the fleet classifies from is filtered back down to open, so a merged PR can never answer for a branch whose merge already answered.

  Agent rows carry the plan's **filename** beside its display name. Stripping the date prefix is lossy on purpose (it is noise in a column), which is why the filename travels separately rather than being reconstructed by whatever needs to build a `/plan/` href.

  Anchors throughout, following the card's existing convention: cmd/ctrl/shift/middle-click open natively and only a plain primary click is intercepted. A story badge is the one that needs help — lanes are what render a story as a row, so the jump turns lanes on first and scrolls on the next frame, once the row it aims at exists.

- [#123](https://github.com/plot-pm/plot/pull/123) [`16f3427`](https://github.com/plot-pm/plot/commit/16f342756f1be0b8af3fed817ba3da1a15244511) Thanks [@jwloka](https://github.com/jwloka)! - The board asks git how much work is in flight, instead of asking the plan file about facts that live in git refs.

  **A card's `claimed` count was always 0, and could never have been anything else.** It came from `summariseWaves`, which counted `b.claimed` — a field `plot-plan-meta.sh` parses from a plan-file annotation _nobody writes_. Claims are taken by pushing a ref (an empty `plot: claim <branch>` commit), which is Principle 1 working exactly as designed, so the annotation is a note _about_ a claim that no command produces. The number was therefore not stale but permanently wrong, and the Agents tab — reading the same refs through the fleet scan — showed the claim the same second the card denied it. `summariseWaves` is deleted rather than left beside its replacement: a function that reads a field nobody writes is a trap for the next reader.

  **Cards gain `eligible`, a number `WaveSummary` could not carry at all.** The fleet scan has computed it all along (`verdict=eligible` per wave); the card simply never asked. It counts branches that could be started _now_ — still `open`, in an eligible wave — which is deliberately narrower than "outstanding": a blocked wave's open branches are real work but not startable work, and conflating them would tell someone to begin a branch whose seam has not landed.

  **Absent is not zero, and the two must not render alike.** Both counts are optional in the contract. The fleet cache is empty for the first seconds after start-up and a scan can fail, so a card built without a pulse omits them rather than showing zeros — `claimed: 0` and _"I have not looked"_ rendering identically is the very confusion being removed, and re-creating it one layer over would be no improvement. The wave and branch counts stay plan-derived and keep rendering: those genuinely do come from the plan file, and they are still true when git is unreadable.

  **Single-wave plans get a summary too.** The card builder guarded with `if (meta.waves.length > 1)`, which would have withheld the new numbers from exactly the plans this repo has most of. That guard was right about _"waves · branches"_ — noise when there is one of each — and wrong about occupancy: whether someone is working on a single-wave plan's one branch is the same question, and just as worth answering. The summary is computed for every plan; what the tile renders stays a display decision, and a card with nothing in flight shows no badge rather than an empty one.

  The route was already proven: `board.ts` reaches into the fleet cache for PR links via `prsByNumber(opts)`, synchronous and `| null` on a cold cache, so `pulseFor(opts)` is a second export of that shape rather than a new mechanism. `buildBoard` stays synchronous — awaiting a scan would block `/api/board` for 0.5–1.05 s on a single-threaded server, which is the reason the cache exists at all.

  **The board also stops asking the git host for PR state every five seconds.** `refresh()` fired both a `plot-fleet-scan.sh` (git, local, free) and a `pr-list --rich --state all --limit 300` (GitHub GraphQL, metered) on one 5 s timer. At 720 calls an hour that exhausts a 5000/hour budget in well under a working day — and did, on this repo, while the plan for this change was being written (`remaining 0/5000, used 5007`). PR state does not change on a five-second horizon; a review or a check landing is a minutes-scale event. Git now refreshes at 5 s and PRs on their own 60 s timer, backing off to the reset the host names — or to two minutes when it names none. `refreshPrs` already had its own timestamp, its own error, and a comment stating the two sources are independent, so this separates a cadence that was never deliberately joined.

  `--limit 300` stays: without it the board sees only the newest 30 PRs and exactly the finished work goes unlinked. The defect was the frequency, never the page size. An ordinary failure — a VPN blip, a missing CLI — keeps the normal rhythm rather than buying two minutes of silence, so only a genuine quota slows the board down.

  Verified against a real repo rather than a fixture object: a git repo with a bare local remote and an actual pushed `plot: claim` ref, served by the built artifact, reports `claimed: 1` for the taken branch and `eligible: 1` for the free one — while the plan file on disk carries no claim annotation at all.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#155](https://github.com/plot-pm/plot/pull/155) [`ea1829f`](https://github.com/plot-pm/plot/commit/ea1829fa4b6c13828ea3d9d4f937b65120428603) Thanks [@jwloka](https://github.com/jwloka)! - Long board columns now show their most recent cards and offer the rest.

  **`Released` only ever grows.** Thirteen delivered plans today, and every one of them was worth seeing once; none is worth scrolling past forever. A column past the threshold now renders its most recent cards plus a control for the remainder — not a scrollbar, which hides the count, and not a hard cut, which hides the work.

  **The threshold is five, and it is measured rather than chosen.** The plan deliberately named no number, on the grounds that the right one depends on how tall a column gets before it stops being scannable — a question for a browser, not for a plan file. Measured against the live board at 1440×900, 1728×1117 and 1920×1080: a plan card renders 161–226px tall (median 176) and the columns begin 110px down the page, so the number of cards fully visible without scrolling is **four** on a 900px laptop and **five** on a 1080p display, at every width tried. Six overruns the fold on all three. Five is therefore the largest number that costs nothing on the common desktop, and it takes the page from 1.8–2.2 viewports tall to roughly one.

  **Recency is by the phase's own date**, which is the part that makes the cut honest: a column claiming to show the latest five while showing five arbitrary ones is worse than showing all thirteen, because the reader cannot tell the difference. `Released` sorts by its release date, `Endgame` by its delivery date, `Design` and `Development` by approval. `Discovery` has none — a Draft plan has recorded no transition, so there is nothing it is recent _by_ — and those cards keep the order they arrived in.

  Cards gain a single `phaseDate` field rather than four date fields, and the server picks which record fills it. One field per phase would put the phase→record mapping in every consumer, and a column would then quietly sort by a clock that is not its own — a failure that looks exactly like a sorted column. There is deliberately **no fallback** down to the filename's date prefix: that prefix is when a plan was _written_, which for the plans in `Released` today is months from when they shipped. `""` is the honest answer, and a card carrying it sorts last rather than sorting wrong. The same rule the fleet's row sort follows for an unknown age: _we do not know_ is not _newest_.

  **The header count keeps counting the whole column.** `Released (13)` above five cards states plainly that eight are hidden; a header that counted the five would read as _there are five_, which is the exact failure truncating must not introduce. The control below says the number too — `Show 8 older`, not `Show more` — because that is the fact a reader deciding whether to click actually needs, and _older_ is what tells them the eight are the oldest rather than an arbitrary remainder. This matches how the Agents tab's collapsing groups word the same idea (`QUIET (7)`) rather than inventing a second vocabulary for "how many are hidden".

  **It applies to any column past the threshold, not to `Released` alone.** `Endgame` holds ten and will reach it next, and a rule with one hard-coded exception is a rule someone has to remember — and has to remove the week the exception stops being true.

  **A highlighted card is never truncated away**, which the plan did not anticipate. The board scrolls to `#plan-<slug>` when a reader arrives via `?plan=` or the plan modal's _Show in board_, and a card the cut removed is not merely un-scrolled-to: `getElementById` returns null and the arrival lands nowhere, silently. That is reachable today — _Show in board_ on a plan delivered in July aims at a card the newest five would not include. The highlighted card is kept **in addition** to the limit rather than in place of one of them, so following a link never costs the reader a card they would otherwise have seen.

  Expansion is component state, not the URL and not `localStorage`. The query string holds what is worth _sending_ to someone — `?tab`, `?lanes`, `?plan` — and "I unfolded Released" is not; nor is it worth persisting, since it is opened to answer one question and the truncated view is the one worth returning to.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#130](https://github.com/plot-pm/plot/pull/130) [`90c5259`](https://github.com/plot-pm/plot/commit/90c525924d4b6b13aa77fb021e98cf52819a73f2) Thanks [@jwloka](https://github.com/jwloka)! - The Discovery column can finally hold something, and what it holds is the work a person is actually doing.

  **One of the board's five columns could never contain anything.** `Board.tsx` renders every column the API returns, so Discovery was a real column with a real count — but `toBoardPhase` mapped `draft → Design`, `approved → Design | Development`, `delivered → Endgame`, `released → Released`. No plan phase mapped to Discovery, ever. The column was not empty because nothing was happening; it was empty because nothing _could_ be.

  **Draft is the discovery phase, and no new vocabulary was needed to say so.** What sits in a Draft plan is not a transcription of a decision already made — it is the investigation deciding whether there is one. The two plans under review while this was written had five commits and 545 lines between them and zero lines of code: throwaway fixtures built, a first-parent filter measured and discarded, a second-parent check tested and discarded, 197 ms weighed against 79 ms, a design found to break under GitFlow. That is a spike, merely carried in a plan file, and approval is the moment it ends. So `draft` now maps to `Discovery`, and Design means exactly one thing — designed, not yet started — which is what its cards already were: two plans waiting for capacity, one for three weeks and one for six months, neither being designed by anyone.

  **The swimlane view drops its Discovery filter in the same change**, because it has to. `Swimlanes.tsx` used Discovery as the row header and removed it from the plan columns (`BOARD_PHASES.filter((p) => p !== 'Discovery')`). That was coherent only _while the column held nothing_ — the filter hid nothing because there was nothing to hide. Once Draft plans land there, a row header that silently drops them is the same bug wearing different clothes, so the two renderers are now pinned against one board payload rather than trusted to agree.

  **Remapping alone would have changed nothing visible, because a Draft plan under review is not on the default branch at all.** `collectPlanFiles()` walks `docs/plans/{active,delivered,}` on the filesystem — one branch's working tree — and of every plan file on the default branch, not one is in phase Draft. Draft was not rare there; it was unreachable. So plan files are now additionally sourced from branches under the configured `Branch prefixes` that are **not** on the default branch. That set _is_ the Draft plans, and it needs no new convention: a plan under review lives on its own branch until its PR merges, and everything else on that branch matches the default branch because the branch was cut from it. Nothing is inferred from the branch _name_ beyond where to look — the phase is still read out of the file by `plot-plan-meta.sh`, exactly as for a working-tree plan. Searching the whole prefix list rather than `idea/` alone is deliberate: an `Impl: same branch` plan rides `feature/<slug>`, so its Draft phase was invisible for the identical reason.

  **The local ref mirror, never the network.** Measured: `git ls-remote --heads origin` costs 459 ms against 8 ms for `git for-each-ref refs/remotes/origin/*`. The board's plan walk runs on every request and the client polls, so the wire call would quietly make a poll loop depend on the git host being reachable — and the local answer is already correct, because the fleet scan fetches on its own timer. Timing assertions would not have caught the wrong call, since ~450 ms passes any generous threshold, so the choice is pinned in a test that reads the source: no `ls-remote`, no `fetch`, and `for-each-ref` present rather than merely absent.

  **A plan's identity is its canonical path, not wherever it was staged.** `plot-plan-meta.sh` takes paths rather than content, so a git-sourced plan must be written somewhere before it can be parsed — and the `file` field it returns is then that staging path. `PlanCard` renders `card.path` verbatim, so a Discovery card would have displayed `/var/folders/…/probe.md`. The repo-relative path is restored before anything is derived from it, and the exact string is asserted, because this fails silently and looks merely untidy rather than wrong. Only regular blobs are read, never the `active/` symlinks git reports beside them: a symlink entry holds its target's path as content, which would both feed the parser a line of text and double-count every indexed plan.

  **The branch read is cached on the tips it read.** Each `git` invocation costs ~55 ms of process spawn no matter how little work it does, so reading a dozen branches' plan trees is around two seconds — on a path the client polls every few seconds. The refs barely move, though: a plan branch changes when someone pushes to it. So the tip SHAs, which `for-each-ref` already returns in the one call that has to happen anyway, are the cache key; an unchanged fleet of branches costs exactly that call, and any branch moving, appearing, or disappearing re-reads everything. Pinned by a test that pushes a plan to a new branch after the first read and requires it to show up — a cache that never invalidated would be worse than no feature, since the board would show a stale picture and look right doing it.

  **A repo with no prefixed branches behaves exactly as before** — additive and silent when empty, which is the common case for an adopting project — and a repository is only read when the board's root _is_ the repository. git resolves upwards from the cwd, so a plans directory nested inside an unrelated checkout would otherwise inherit that checkout's branches and raise cards for a different project entirely. That is not hypothetical: this repo's own test fixture lives inside the plot checkout, and without the containment check the board read plot's eight prefixed branches on every request in order to serve a garden.

  Verified against a real repo rather than a fixture object: a git repo with a bare local remote whose Draft plans exist _only_ as blobs on prefixed branches — with the working-tree copies deleted, so the filesystem walk genuinely cannot see them — served by the built artifact, renders both in Discovery, with repo-relative paths, no duplicates across branches cut from the same point, and no staging directory left behind over repeated requests.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#119](https://github.com/plot-pm/plot/pull/119) [`c1ae02c`](https://github.com/plot-pm/plot/commit/c1ae02c28efdc50ac3a3c93af31b2ebf639b278a) Thanks [@jwloka](https://github.com/jwloka)! - The board acts through Plot: a **Start work** button on an approved plan card, which runs `plot-dispatch.sh` exactly as `/plot-dispatch` does.

  The board expresses an **intent about a plan**, and the existing chain decides everything else — which branch, whether the wave is open, whether the claim wins its race, whether the phase gate allows it. The board cannot bypass a rule it never evaluates. That is also why the button sits on the plan card rather than an agent row: `plot-dispatch.sh` takes a _slug_, then asks `plot-fleet-scan.sh --next` which branch is eligible, so a button on a branch row would promise "start this one" and deliver "start whichever is next".

  **The board gains its first non-GET route, which is a change in kind rather than degree.** `handleRequest` opens with a blanket `if (req.method !== 'GET') return 405`, which is why no existing route has ever had to think about verbs. Rather than remove that guard, `POST /api/dispatch` is allow-listed _ahead_ of it: `/api/board`, `/api/fleet` and `/plan/*` stay protected exactly as today, and precisely one path-and-verb pair slips past. Per-route method checks would be the conventional shape and are rejected for the reason this repo rejects prose MUSTs — a check every future route has to remember is a rule, while a default that refuses is a gate.

  **The binding is the authorisation, and the browser is not a network question.** The route exists only while the server listens on localhost; with `HOST=0.0.0.0` it returns 403 and the button renders disabled with the reason. That is a deliberate refusal to invent an auth scheme — whoever reaches `localhost:7777` is sitting at the machine that owns the worktrees. But binding answers _reachability_: any website the user visits can `fetch('http://localhost:7777/api/dispatch', {method:'POST', mode:'no-cors'})`, and the attacker cannot read the reply and does not need to — the worktree exists and the claim is pushed before the response is written. So the route also requires `Sec-Fetch-Site: same-origin` / a matching `Origin`, both browser-set and unforgeable by page JavaScript.

  **The 202 is a real 202, and cannot carry a result.** A dispatch creates a worktree and pushes a claim — a network write, strictly slower than the scan that already forced the fleet cache to exist on this single-threaded server. Awaiting it would freeze every viewer's board for the duration of someone else's click. The server therefore picks the log path _before_ spawning, keyed by slug (`<repo>/../plot-dispatch-<slug>.log`), because it cannot know the branch: `--max 1` asks `--next` at runtime. Where no `Worker command` is configured, `start_worker` returns 1 and **that is not an error** — it creates the worktree, pushes the claim, and prints a `cd <path>` plus a config hint. Those lines land in the log verbatim rather than being paraphrased into a second copy that can drift.

  **Feedback is derived, never asserted.** The button does not move the row; the pulse re-reads git and the row travels on its own. After about three pulses with no change it says **"no change — see log"** with the path, and does _not_ guess which of the failure modes occurred — the claim lost its race, no branch was eligible, the script failed. The script already wrote the truth to the log. An optimistic update would be faster and would make the board display something it does not know.

  The button condition is the gate's condition, `phase === approved` — not a board column. "Development" means approved _and_ started, so an approved-but-unstarted plan renders under Design, which is the first-dispatch case the button is most for. It reuses the exact expression the **Ready** badge already computed, so the badge and the button cannot disagree.

  Only start, never stop: a start is reversible for the price of `--stop`, while a stop kills a running session and whatever it had not committed. `--status` and `--stop` stay in the terminal.

  The route's tests never run a real dispatch — a stub script via `PLOT_SCRIPTS_DIR` stands in, so no worktree is created and nothing is pushed from CI. The assertion that matters most is that a **refused request spawned nothing**, since every other one can pass while the side effect still happened.

- [#151](https://github.com/plot-pm/plot/pull/151) [`f58340c`](https://github.com/plot-pm/plot/commit/f58340cf32ea7bfa0f5c459a7fdb8195e7fb86c2) Thanks [@jwloka](https://github.com/jwloka)! - A story is now an artefact you can open from the board.

  **Stories were the board's axis and its dead end.** A plan card names its story as a badge, the swimlane view uses stories as row headers — and neither led anywhere. `StoryCardSchema` carried `slug`, `title` and `status` and **no path**, and the server had a `/plan/<file>` route but no `/story/`. The one concept that spans months, the thing plans belong to, was the only artefact the board could not open.

  **Both viewer routes share ONE hardened resolver, rather than the second copying the first.** `/plan/` defends against two attacks and only the first is obvious. Traversal is handled structurally: a name resolves against the documents the board itself collected, never joined into a path — which matters more for a story than for a plan, since a story slug is a directory name _and_ part of the filename (`<slug>/STORY-<slug>.md`), so a `../` has two positions to land in. The second attack is one line: `decodeURIComponent` **throws** a `URIError` on a malformed `%` escape (`/story/%E0%A4%A`), and an uncaught throw inside the request listener takes the single-process server down. A `/story/` route written from scratch would very plausibly get the allowlist right and that wrong, and one malformed URL would then kill the board. So the decode, the try/catch, the 400-vs-404, the CSP and the `?embed=1` handling are one code path; the routes differ only in which allowlist they consult, and that difference is a two-line table. The malformed-escape case is asserted for both routes **in one test**, because a test that checked each alone would still pass the day someone forked the handler.

  **`StoryCardSchema` gains the resolved path**, for the same reason `planFile` exists on a fleet row: the consumer must not reconstruct it, because stripping and rebuilding a path is where the mistakes live. **A story with no file gets an empty path and renders no link** — the rule plan rows already follow for `planFile: ''`. The card keeps its title and status, which are true regardless; hiding it would lose real information to avoid a broken link, when not linking suffices.

  **The plan modal gains an `Open story` button, and the badge becomes a link.** Both, not either — they answer different questions. The badge is where the story is _named_, on the card, at triage time; the button is where you _go_, in the modal, once you have stopped triaging. That is the same split the worktree path already makes. An earlier draft had only the badge, which satisfies "a story can be opened" while leaving the action invisible to anyone scanning the header for something to do — so the button is asserted as a `<button>`, not merely as reachable. It appears only when the story resolves to a file, rather than offering an action that 404s.

  The badge no longer jumps to the story's swimlane row. A badge that sometimes opens a document and sometimes moves the page teaches a reader nothing about which it will do; the name refers to an artefact, so it points at the artefact. The `Story lanes` toggle still reaches every lane, and the story overlay's own _Show in board_ lands on the row when lanes are on.

  **The swimlane row header opens its story too** — the lane view is the other place a story is named and led nowhere. Both surfaces follow the same rule: a header naming a story with no file (the orphan and catch-all rows) stays plain text.

  **The overlay's header mirrors the plan modal's exactly** — _Show in board_, _Open in new tab_, _Close_. Three, not two. Symmetry matters more than novelty: a reader who has learned the plan modal should not have to learn a second set of controls. They are the same component, which makes "they match" a fact rather than a promise — and the test asserts it by **comparing the two headers** rather than listing three names in both places, since a listing would still pass the day one modal grew a fourth control.

  **The body is the story's own.** The header answers _where do I go_; the body answers _what now_, and a story has no worktree. What belongs there is the thing the story card cannot say: **which plans make it up, and what phase each is in** — derived from the board's own cards, which already carry `story` and `phase`, rather than parsed from the STORY file's hand-maintained "Current Plan" prose. Hand-maintained is precisely the problem: nothing marks an item resolved when its plan lands, and four of twelve open points in one story were stale when swept. A derived list cannot drift. Asserted against a fixture whose hand-written section names a plan that does not exist and omits both that do — the derived list must win, and the stale prose is confirmed present in the rendered document below it, so the assertion is a disagreement rather than an absence.

  **Opening a story from an open plan modal replaces it, and does not stack.** An overlay above an overlay gives two Close buttons and an ambiguous Escape, for the sake of keeping context the header already names. Replacement is predictable, and the way back is the same click in reverse — a plan opened from the story overlay replaces it in turn.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#132](https://github.com/plot-pm/plot/pull/132) [`7af7d0a`](https://github.com/plot-pm/plot/commit/7af7d0ae3a32c25ed69db1f3dcdf4cc020832704) Thanks [@jwloka](https://github.com/jwloka)! - The agent view stops making you work out what it already knows.

  Three frictions in the Agents tab, all of the same kind: the view held the information and left the reader to reconstruct it.

  **The footer counted up, not down.** `scanned 2s ago · PR data 74s ago` is honest about staleness and silent about the thing that matters while you watch a fan-out — _when does this change next?_ Both ages now carry a countdown, and the pair is the point: how old is this, and when does it move. The git countdown is derived from `FLEET_POLL_MS`, which the client owns, and it answers _when can this display change_ rather than _when does git get re-read_ — `/api/fleet` reads a cache the server rescans on its own timer, and that is the only question the client can answer honestly.

  **The PR countdown needed a field, and must not guess without it.** `PR_REFRESH_MS` is 60 s and backs off to 120 s when the host reports a rate limit, so a client assuming 60 s would count to zero and sit there through the wait — rendering _"I don't know"_ as _"any moment now"_, which is the exact failure this view exists to remove. `FleetSchema` gains one optional field carrying the server's own intention, read from `prNextAt` — the single gate the fetch obeys, so it reports the truth rather than a second copy of the cadence that could drift from it. **Absent, no PR countdown is shown at all**: an older server, or a board built before this change, still tells the truth with the age alone. Both counters stop when the agents tab is not open, because `App.tsx` already stops polling and a counter ticking toward a refresh that is not coming is the same false statement.

  **The groups were ordered errand-before-opportunity.** `QUIET` sat above `NOT STARTED`, so a reader with ten minutes met "go check whether this died" before "here is work nobody has taken". Actionable now precedes diagnostic — the same _workable top to bottom_ principle the ordering always claimed, applied to the one pair that had it backwards. The order lives in two arrays (one sorts, one renders) and a test pins them equal, because a disagreement there would not read as two lists drifting apart; it would read as rows landing in the wrong group.

  **An unstarted row now says how long it has been waiting.** It rendered `—`, because `ageMinutes` dates a branch tip and there is no branch — while the age that matters, how long the plan has been waiting to be _started_, sat unused in the `Approved:` record. It is a **different clock** from every other row's age: days rather than minutes, approval rather than commit. So it rides in its own field and is labelled (`waiting 22d`) rather than folded into `ageMinutes` — overloading one field with two meanings is exactly what would make "22d, no commits for three weeks" indistinguishable from "22d, never begun". Only branches with no tip carry it; a branch that exists has a real age, and a second beside it would only compete. **No recorded date shows nothing** — not zero, not "just now" — which is the common path rather than the edge: this repo's only unstarted plan predates the `Approved:` field entirely.

  **Rows were grouped only by waiting-state.** Fifteen branches across seven plans put six slices of _one_ plan in `QUIET (6)` while three rows of another sat apart in `DONE`. The plan name was on every row, so the grouping existed in the data and was left for the eye to do. Rows now group by plan inside each waiting-group — by plan and not by story, because the waiting-groups answer _what needs me next_ and the useful unit within that is the thing whose waves are being worked. Plans are ordered by their most urgent row, so a plan holding one stale branch cannot outrank one whose branch just moved, and rows keep their age order inside a plan. **A group with one plan gets no sub-heading** — chrome that never varies is noise — and `DONE` is grouped like every other group, because a rule with an exception for the group nobody reads is a rule someone has to remember.

  **The row reads plan, then branch** — what this belongs to, then which slice of it. Not merely preference: with the branch first, six rows of one plan carried the plan name to the right of six branch names of differing length, so the plan column frayed exactly where the grouping says those rows belong together. Plan first makes them a visible column, reinforcing the grouping rather than duplicating it.

  **Every link now goes where its text says.** One link per row, on the wrong word: the branch name opened the PR while `PR [#130](https://github.com/plot-pm/plot/issues/130)` beside it was plain text. Both halves were surprising. The branch name links to the branch, `PR #<n>` links to the pull request, and a test asserts the two targets _differ_ — "a link exists" passes on the bug.

  **The branch URL is read from the origin, not derived from the PR URL.** That derivation was rejected because it only works for rows that _have_ a PR, and `not-started`, `quiet` and fresh claims — where "go look at the branch" is most useful — have none. `git remote get-url origin` is read once per scan, beside the branch ages, never per row, and the host's own word for the page is used (`/tree/` on GitHub, `/branch/` on Bitbucket Cloud), keeping the host verbatim so a GitHub Enterprise install links to itself. An origin whose shape the board does not recognise — a self-hosted Bitbucket, whose branches live under `/projects/KEY/repos/name/branches` — yields no link at all rather than a guessed URL shape. **A merged branch gets no branch link**: its remote page is gone, and the standing rule in this contract is that a missing address renders as plain text rather than an invented one. `green` stays plain text and that is a deliberate stop — the row carries no checks URL, and adding one is a change through `plot-host.sh` and the pulse rather than a display change.

  **Clicking a plan opened the rendered markdown and left the board.** The Agents tab is a live view that polls every 4 s; navigating away costs the reader the thing they came to watch. The plan now opens in `PlanModal` in place, and the modal gains a **Show in board** button that closes it, switches tabs, filters to the plan's story and lands on the card.

  **The filter alone is not the feature.** `plot-board` has nine plans, so filtering to a story still leaves you scanning a column. The button also names the plan in the URL — `?plan=<slug>`, the same sync the story and sprint filters use — and the matching card scrolls into view with a highlight ring. Naming it in the URL is what makes the landing shareable and survivable: a reload keeps you on the card. The highlight is transient, clearing on the next interaction rather than persisting as a second kind of filter, and `prefers-reduced-motion` suppresses the scroll _animation_, not the scroll — arriving at the card is the point. A `?plan=` matching nothing is **ignored**, because an empty filtered column would read as "this story has no plans".

  A fleet row is not a card — it carries `planFile`, and `PlanModal` takes a `Card` — so the card is looked up from the board data. **Where the board has no matching card the plan name stays a plain link to `/plan/<file>`** rather than opening an empty modal; a plan outside the walked directories has a row and no card. "The board has not loaded yet" is deliberately not the same answer: against a real repo `/api/board` takes seconds, so a click made in that window is held and resolved once the cards land, never spent navigating away from a live view.

  Verified by running the built board against this repo, not only against the fixture: sixteen rows over eight plans, countdowns ticking, `DONE` carrying five plan sub-headings, every live branch linked to `github.com/plot-pm/plot/tree/<branch>` and every merged one plain, the modal opening in place and its button landing on the highlighted card.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#140](https://github.com/plot-pm/plot/pull/140) [`b12af2c`](https://github.com/plot-pm/plot/commit/b12af2cd02b366a7d8a10d3e6dbc4e550a9d9b1a) Thanks [@jwloka](https://github.com/jwloka)! - Every fleet row carries the **phase** its work is in, the pulse keeps a rolling day of finished work, and a draft PR with red CI finally says so.

  **The Agents tab decided everything by TIME and could not say what the time was about.** `classify()` asks whether a commit landed inside the quiet window and nothing else — the right answer for _is anything moving_, and structurally unable to answer _moving on what_. Two consequences shared that one cause. WORKING could not tell a human drafting from an agent building: `board-ui-polish` was written, interrogated over several rounds, and approved **on the branch an agent then built on**, so one row passed through three phases in sequence and the tab showed the same thing for every one of them. And NOT STARTED could not say what kind of not-started — it should mean _discovered, planned, ready to pick up_, and meant only "no branch tip we can date".

  **The phase is derived from the PAIR — the plan's phase AND the branch's git state — never from the plan file alone.** The obvious implementation carries the plan's phase onto its rows and maps it with `toBoardPhase`; that produces rows that contradict themselves, and the repo had the example sitting in it. `opus5-longhorizon-hardening` is `Phase: Approved` with **zero** `Started:` records while six of its branches carry real commits: the board reads the file and says _Design_, the pulse reads git and says _in progress_. A row labelled _Design_ beside a note reading _no commit for 22 days_ is two statements about one branch that cannot both be true, and that is the exact defect class this board has hit three times (`merged` vs a deleted ref, `claimed` vs resumed, `open` vs merged-and-deleted). Git supplies the started half, so those rows read **Development** while the card keeps saying Design until someone records the start — and that divergence is _itself information_, meaning the plan's bookkeeping is behind.

  **Per branch, not per plan.** A row is a statement about one branch, so the plan's `Started:` count deliberately does not travel with it: a three-branch plan with one branch built and two untouched is in Development _as a plan_, while its untouched rows are the hand-off point, which is what Design means. Carrying the count onto them would print `Development` beside _eligible — nobody has taken it_.

  **"git wins" applies to an ABSENT record, not to a recorded decision, and the asymmetry is the point.** A missing `Started:` line is nobody having written something down, and a commit outranks it. A commit landing under a plan already marked `delivered` is a **contradiction of something a human wrote**, and a follow-up fix does not repeal it — so the row stays at Endgame and its age shows that something moved. Treating every late commit as a phase reversal would send a plan visibly backwards for a typo fix, which teaches readers to distrust the column. The symmetric implementation passes every other assertion in this change and fails only that one, so it has its own test.

  **`deferred` sends the row back a phase, and stops displacing the note.** The annotation is not "paused, resuming later": the vocabulary says the branch _isn't needed_ and was _given up deliberately_, and `plot-deliver` skips deferred branches in its completeness gate — a plan delivers without them. So a branch with real commits under an approved plan reads **Design**, not Development (nobody is working on it) and not silently-Design (indistinguishable from never-begun — `state` still says `deferred`, which is what a badge renders from). It can never read WORKING even with a minutes-old commit; that is the one place intent outranks git, because the group is about the claim the row makes rather than the age of a commit. And `classify()` no longer answers `{ note: 'deferred' }` unconditionally, which used to erase whatever else the row had to say: the fact rides beside the note instead of replacing it, the same shape as the `no story` badge on a plan card.

  **DONE lost the work at the moment it finished.** Measured rather than guessed: `plot-fleet-scan.sh` read `docs/plans/active/` only, and delivering a plan moves its symlink to `delivered/` — so the plan left the pulse in that instant, taking every branch with it. Five plans delivered in one day named eight branches between them and DONE showed **one**, because merge and delivery are minutes apart and only whichever branch happened to sit in the gap survived. A group that is full by accident is worse than one that is empty by rule. The pulse now also reads recently delivered plans, **bounded by time rather than by count** — "what finished today" empties itself as the day passes, while "the last five" shows five whether the newest is an hour old or six months.

  **A rolling 24 hours, and a bare date anchored at the END of its day.** Literally "delivered today" is easier to explain and wrong at exactly the wrong moment: a plan delivered at 23:50 vanishes ten minutes later, mid-session, while the branches it names are still on screen. 24 is also the one freshness bound this repo already uses (`Claim stale after`). The anchor is what makes _rolling_ true rather than merely stated — every `Delivered:` record here is a bare date, which names no time, so measuring from 00:00 would start the clock up to a day **before** the delivery and collapse the window straight back into the calendar boundary. Anchoring at 23:59:59 over-admits by at most the delivery day, which is the safe direction; a record that carries a time is honoured exactly.

  **The window filters before the parse.** Measured: ~57 ms per plan through `plot-plan-meta.sh` against a scan that already runs 500–1050 ms, so parsing all fourteen delivered plans to discard thirteen would roughly double the pulse — and that cost grows with the archive, which only ever gets larger, while the answer it produces stays the size of a day's work. So the cheap signal comes first (the delivered symlink's own mtime) and only the candidates it admits are parsed. The pre-filter may **over-admit and pay a parse, never exclude**: a checkout can freshen an old file, so the `Delivered:` record keeps the last word. On a fresh clone or a CI worktree every file shares one checkout timestamp and everything is admitted — correct, merely slower, once. Reaching for `git log` per plan to avoid that would spend a git call to save a parse.

  **No date, no row.** `docs/plans/delivered/reconcile-scan-accuracy.md` sits in the delivered index today with an empty `Delivered:` record, and it must not appear: no date means no membership in any window, the same rule the waiting age already follows. Showing it always creates the one row that can never age out of DONE, and the missing record is a bookkeeping fault `plot-reconcile-scan.sh` exists to report — a view that quietly compensates for it makes the fault harder to see. `--next` and `--list-eligible` skip delivered plans entirely rather than filtering afterwards: their question is _what may a worker claim_, and a delivered plan answers nothing to it.

  **A draft PR's red CI was invisible.** Found on this plan's own PR — `[#131](https://github.com/plot-pm/plot/issues/131)` reported `checks: failing` and the board rendered `PR [#131](https://github.com/plot-pm/plot/issues/131), draft`. The cause was an ordering rather than an omission: the row asked `pr.draft` **before** anything asked about checks. Both halves were right about their own question — `classify` declines to claim a _green_ draft ("a draft is still the author's, not yours"), and the shortcut is right that a draft belongs in `waiting-on-you` regardless, since the author is the reader — but neither noticed that the shortcut answered for **every** draft, so a green draft and a red one produced the identical row. The group happened to be correct; the note lost the only fact that changes what the author should do next. The checks now speak inside the draft framing (`PR [#131](https://github.com/plot-pm/plot/issues/131), draft, checks failing`) and the group stays put, since moving a failing draft would claim a review nobody asked for. A green draft says nothing extra: "draft" already means _not ready for you_, and appending "checks green" would put the reassuring word on the row whose whole point is that it is unfinished.

  **`plot-plan-meta.sh` reports `delivered_raw`.** The delivery record was the one transition the parser did not carry, so the board could read `phase: delivered` but never _when_ — and "delivered with an empty record" is a real state here that a phase alone cannot distinguish from a dated delivery.

  The pulse carries the plan's `phase` verbatim and interprets nothing: which column a row reads is judgment, and it belongs one layer up (Manifesto Principle 3). `toBoardPhase` stays the single definition of the mapping and gains no second implementation — the row derivation composes it, and a test asserts the agreement across every phase and state rather than trusting inspection, because a second copy is how the two views drift apart.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#137](https://github.com/plot-pm/plot/pull/137) [`ad2b369`](https://github.com/plot-pm/plot/commit/ad2b3696bcf97efe4c3b7ab6499c04b464effcd7) Thanks [@jwloka](https://github.com/jwloka)! - A branch whose local worktree has uncommitted changes reads as **working** rather than quiet, with a note saying the evidence is local.

  **Three agents were dispatched and all three were working; the board showed two.** The third branch had been claimed a day earlier and _resumed_, so its claim commit was 21 hours old while its work was minutes old. The row read `quiet · no commit for 21 hours` — a true note under a wrong heading, and the heading is the thing this tab does. QUIET carries an instruction: _go check whether it died._ Following it found a live agent with three modified files. That is the same mis-answer already fixed twice — merged branches reading as quiet, fresh claims reading as quiet — but with one difference: the earlier two were fixed with data the classifier already had, and here the refs genuinely do not know. An agent that has edited files and not committed has written nothing git can see.

  **The scan already stands where the answer is.** `git worktree list --porcelain` names every worktree and its branch, and `git -C <path> status --porcelain` says whether the tree is dirty. Both are local, and `plot-fleet-scan.sh` runs on the machine that owns them. Its `--json` output gains two per-branch fields — `local_dirty` and `local_worktree` — and `classify()` uses the first for exactly one thing: to _lift_ a branch out of quiet. The prose report is unchanged; it is a human interface, and the row this feeds lives in the board.

  **Absent is not false, and that is what makes it additive.** On a machine with no worktree for a branch — every detached worker, every teammate's laptop, every CI run — the field is false and the branch answers from refs exactly as before. The signal is strictly one-directional: it may _add_ an answer where this machine knows more, never downgrade one. Two people looking at the same fleet from different machines will see different notes on the same row, and that is correct, because they genuinely know different things. The fleet derives state from refs _precisely so_ it works for workers elsewhere; keeping local knowledge one-directional is what lets both hold at once.

  **The note says local, because a reader has to be able to judge it.** Work that has not been committed is also work nobody else can see, and a row claiming _working_ on grounds the next person cannot verify would be its own kind of lie. It also declines to say _who_: git records no author on an uncommitted change, and on an `Impl: same branch` plan the person and the agent share one branch by design. So the note reports what was observed and where — _uncommitted work in a local worktree_ — and a reader who recognises their own editor is not misled, where "agent working" would have misled them.

  **Dirty, not present.** A worktree that exists but is clean is equally consistent with an agent that finished and one that never started, so it lifts nothing and shows nothing in the row. **Any state that would otherwise read quiet**, not only `claimed`: the motivating case was a resumed claim, but every quiet row on the board that day was `wip` with a three-week-old commit, and a dirty worktree means the same thing whatever put the branch there.

  **Empty had to stop meaning two things.** A worktree directory can be deleted without `git worktree remove`, and the entry survives in `git worktree list`. `git status` there exits **128 and prints nothing** — so a check written as _"is the output non-empty"_ reads "clean" and is right _by accident_. Two guards make empty mean one thing: `prunable` entries are skipped (the list already marks them, so running `git status` on a directory known to be gone asks a question answered a line earlier), and the **exit code** is read rather than the emptiness, because a failure to observe is not evidence of cleanliness.

  **No cap, and the measurement is the reason:** 6.6 ms per worktree, so twenty cost ≈133 ms against a scan that already runs 500–1050 ms. A cap would be stock against a problem the numbers rule out, and caps drop results silently unless they also report saturation. The worktree list is read once per run, not once per branch — the same bundling the merge walk uses, for the same reason: the board polls every 5 s.

  **The plan modal shows the local worktree path.** `git worktree list --porcelain` returns it beside the branch and the scan previously dropped it; keeping it costs nothing and answers a question the row cannot — _where is this checked out on my machine._ In the modal rather than the row, because a row is a triage line and already full, while a path is what you want once you have decided to go look. Shown for **clean** worktrees too: that is the one place the clean/dirty distinction inverts, and consistently so — dirtiness is evidence of _work_, presence is evidence of _location_, and the modal asks about location. A modal opened on a teammate's laptop shows no path rather than one that does not exist there.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#149](https://github.com/plot-pm/plot/pull/149) [`eee81f5`](https://github.com/plot-pm/plot/commit/eee81f5afe8c00bcdc2c9df503561f4da8fd05bd) Thanks [@jwloka](https://github.com/jwloka)! - A branch holding commits nobody has pushed reads as **working** rather than quiet, and the row says how many.

  **`local_dirty` cannot answer this case, by construction.** It reports _someone is editing_, and committing **clears** it. So the moment a worker finishes tidily and pauses before pushing, the worktree is clean, the flag is false, and the board reads **"claimed, no commits yet"** for a branch holding a complete implementation. That is not hypothetical: it happened on 2026-08-16 on `bug/fleet-sees-local-work` — the very branch that fixed the other half of this blindness — at 3 commits ahead, 0 dirty files, no PR. The gap opens **exactly when the work is most complete**, and complete-but-unpushed work is also work with no backup and nothing for a merge-queue check to inspect. That day it also blocked a dispatch: a branch could not start while the collision it had to avoid existed only on one machine's disk.

  **It is a ref question, not a worktree question** — and getting that wrong was this plan's own first draft. `local_dirty` has to go through the worktree list because dirtiness is a property of a _working directory_: only the checkout knows whether files were edited. Aheadness is not. Worktrees share one ref database, so `refs/heads/<branch>` answers from the main repo for a branch checked out in a _different_ worktree, and the comparison needs no `git -C` at all. Binding it to the worktree list would have been _consistent_ with `local_dirty` and wrong: a local branch with no worktree — checked out once and moved away from, or fetched from a colleague — still holds commits nobody else can see, and the worktree-shaped version would silently skip exactly those. Two signals that answer different questions read from the sources that actually hold the answers.

  **Ahead only; divergence is not this question.** `rev-list --count A..B` counts one direction, and that is the right one. The question is _does work exist here that nobody else can see_, and unpushed commits are exactly that whether or not the branch also trails the remote. Being _behind_ is not an invisible state — it is sitting in the remote for anyone to read — and reporting it would answer a second question with no action attached.

  **It obeys the same rules as the signal it joins**, which is the argument for adding it here rather than designing something new. _Absent is not false_: a branch with no local ref answers from refs exactly as today, so every detached worker, every teammate's laptop and every CI run is unaffected. _One-directional_: it may lift a branch out of quiet and may never downgrade a group, and a branch with an open PR still answers about its PR. _Read the exit code, not the emptiness_: a missing upstream exits **128 with empty output** — bit-identical to the deleted-worktree signature the shipped code already handles — so empty output must not read as "zero ahead", for exactly the reason empty `git status` output must not read as "clean". _No cap_: 5.2 ms per call against the 6.6 ms per worktree the scan already accepts, so twenty branches cost ≈104 ms on a scan that runs 500–1050 ms, and the count follows the plans rather than the checkout.

  **Dirty and ahead are different facts, and the row says both, unpushed first.** `local_dirty` means _someone is editing_; `local_ahead` means _finished work exists that nobody else can see_. An earlier draft reported only the unpushed commits, on the grounds that they are the more urgent fact. That is true and not a reason to drop the other: suppressing a true fact because a second one outranks it is precisely the displacement `deferred` used to cause to the note text. The two together also change the advice — _push this_ versus _push this, and someone is still working_ — which is the whole reason to distinguish them. A branch whose only local evidence is uncommitted edits reads exactly what it read before.

  **An unpushed count is not an age, and is not shown as one.** _"2 commits not pushed locally"_ answers a question no timestamp can: it names an action, and the action belongs to a specific machine.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#159](https://github.com/plot-pm/plot/pull/159) [`cca0c29`](https://github.com/plot-pm/plot/commit/cca0c2978bf00eeda6ae3cc025e2e3f65bd6a368) Thanks [@jwloka](https://github.com/jwloka)! - The fleet pulse now says whether a claimed branch actually has a **worker**, and the row says so. A claim is a push — it means a dispatcher _took_ the branch, and nothing more. On 2026-08-17 three rows sat in **WORKING** with a pulsing green dot while nobody was working on any of them: the claim was real, the worker was never started, and the row had no word for the difference.

  **The states already existed and nothing read them.** `worker_state()` in `plot-dispatch.sh` has distinguished **five** outcomes since the day it was written — `running <pid>`, `finished <pid>`, `failed <pid> (exit N)`, `ended <pid> (status unknown)` and `no worker` — and it already handles the traps, including rejecting a pid of `0` explicitly. Measured against the board: `grep -rn "plot-worker.pid" packages/board/src` returned **nothing**. The information was richer than the board assumed and reached no screen. So this adds no liveness check; it reports the one that exists.

  **All five travel, because collapsing them re-creates the very defect being fixed.** `failed (exit 1)` and `finished` are **opposite actions** — a crashed worker needs restarting, a finished one needs reviewing — and a row that says "ended" for both leaves the reader to open a log to find out which. That is the same one-label-two-states shape as `no commits yet` covering both an idle branch and a finished-but-unpushed one. A failed worker is also not a _working_ row: it goes where its action is, `waiting-on-you`, because a person has to decide whether to restart it. A crashed worker wearing a pulsing dot is the exact misreport this removes.

  **A missing pid means _unknown_, not _nobody_.** `plot-dispatch` writes `.plot-worker.pid` only where it started the worker itself, so a hand-started agent leaves none — and hand-starting is the normal case for as long as `Worker command` is unset. **Five agents were started that way in one session**; reading a missing pid as "nobody is working" would have reported every one of them dead. So the group does not move, and only the sentence changes: the row says _claimed, no known worker_ instead of promising commits are on the way. Absent is not false, the rule the scan already applies to every other missing signal.

  **A branch with no worktree here is a third state, not the second one.** The pid lives _in_ the worktree, so a branch claimed and started on another machine has no path to look at — this machine cannot answer the question at all, which differs from looking and finding nothing:

  | claim | worktree | pid | row says                                                        |
  | ----- | -------- | --- | --------------------------------------------------------------- |
  | ✓     | ✓        | ✓   | `worker running (pid N)` — or the finished/failed/ended variant |
  | ✓     | ✓        | —   | `claimed, no known worker`                                      |
  | ✓     | —        | n/a | `claimed elsewhere`                                             |

  The actions differ, which is what earns the third string: _look in this checkout_ versus _ask the machine that took it_. Same split as `local_dirty` and `local_ahead` — two questions answered from the sources that hold the answers, rather than one signal stretched across both.

  **A pid of `0` never reads as running.** `kill -0 0` signals the whole process **group** and succeeds, so a naive liveness check reports it alive forever. The scan rejects it exactly as `worker_state()` does, and the verdict travels to the board as a value rather than being re-derived there — re-deriving liveness on the far side would spring the same trap a second time. Its test spawns a **real** process for the running case, because `kill -0` is a real syscall and a fabricated pid would agree with a broken implementation by luck.

  **The read costs one file check at a stop the scan already makes.** `worktree_rows()` visits every worktree and already knows which branch each holds, so there is no new traversal and the no-worktree case falls out of the existing structure rather than needing a guard. It obeys the same rules as the local signals it joins: git-only (no host call, so the board can keep polling every 5 s), one-directional — a stopped worker may lift a row up to `waiting-on-you`, and `none`/`elsewhere` move no group at all — and the human report is left byte-identical, because the worker fact belongs to `--json` and the row it feeds.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#165](https://github.com/plot-pm/plot/pull/165) [`a53f443`](https://github.com/plot-pm/plot/commit/a53f4435a20d60007451b9c266fcd4ad444f736e) Thanks [@jwloka](https://github.com/jwloka)! - A pull request's condition now travels to the board as data rather than as a
  sentence, and `conflicts` stops masquerading as `no checks`.

  `AgentRow.pr` grew from `{ number, url }` to carry the PR's own state:
  `{ number, url, draft, state }`, where `state` is one of `green`, `pending`,
  `failing`, `none`, `conflicts` or `unknown`. Everything else about a PR — green,
  draft, no checks — used to exist solely inside the row's note, assembled by
  different branches of the server's classifier. That is why one row read
  `PR [#57](https://github.com/plot-pm/plot/issues/57) green` and the next `PR [#116](https://github.com/plot-pm/plot/issues/116), no checks`: nothing downstream could make
  them agree, and nothing could render a badge from a sentence without parsing it
  back apart.

  **`draft` stays a separate boolean and is deliberately not one of the states.**
  It answers a different question — _is this offered for review_ — and the two are
  independent: a draft has CI like anything else, which `draftNote` already says
  ("draft, CI running"). Folding it into the enum would move the short-circuit
  that kept WAITING ON A MACHINE empty out of the classifier and into the
  contract, where it is harder to see and shared by every consumer.

  **`conflicts` needed one field from the host.** `plot-host.sh pr-list --rich`
  now fetches `mergeable` (with `mergeStateStatus` corroborating), because GitHub
  starts no workflow for a branch that does not merge cleanly — so a conflicting
  PR reports an _empty_ check rollup and read as `no checks`, indistinguishable
  from a bot PR whose run awaits a human click. One wants a rebase, the other
  wants a click. Measured twice on this repo's own PRs: [#149](https://github.com/plot-pm/plot/issues/149) and [#160](https://github.com/plot-pm/plot/issues/160) both said
  `no checks` while GitHub said _this branch has conflicts that must be resolved_.

  `conflicts` outranks `none` where both hold, because it is the cause and the
  other its consequence. A workflow genuinely awaiting a human still says
  `no checks`.

  Bitbucket reports `mergeable: "unknown"`, following the precedent beside it:
  `bb pr list` carries no mergeability verdict any more than it carries a check
  rollup, and the honest gap beats an invented answer. Consumers must not read it
  as clean — absent is not false.

  Nothing new renders yet: this is the field the row's PR cell will be built from.

- [#170](https://github.com/plot-pm/plot/pull/170) [`9adf0ca`](https://github.com/plot-pm/plot/commit/9adf0ca7e66cc447c0cbd972896daf875597e8c2) Thanks [@jwloka](https://github.com/jwloka)! - A worktree holding `.git/index.lock` reads as **working** — a write is in progress this instant — rather than being skipped in silence.

  **The function that makes agents visible was the one that tripped over them.** Since [#137](https://github.com/plot-pm/plot/issues/137) `plot-fleet-scan.sh` runs `git status` inside every worktree on the machine. When that call could not answer, the loop hit `continue`: the worktree was not reported at all, and the branch fell back to answering from refs exactly as though this machine had no checkout for it. The row then read _claimed, no commits yet_ while an agent was committing to it. The branch that looked least active was the one being written to.

  **Absent was the right instinct applied to the wrong question.** An earlier draft of the plan had the defect wrong and the measurement corrected it: the scan does _not_ read a failed `git status` as clean. It already reads the exit code, and the file argues the rule at length — _a failure to observe is not evidence of cleanliness_. That half was shipped and correct. What was wrong is that a lock is **not a failure to observe**. It is the most informative state a worktree can be in: `.git/index.lock` means _an agent is writing here, right now_, which is precisely what the fleet view exists to show. The fact was computed, discarded, and replaced by silence.

  **A third signal, because it answers a third question.** `local_locked` joins `local_dirty` and `local_ahead` under the same five rules, and none of the three is a flavour of another: _someone is editing_, _finished work nobody else can see_, _a write is in progress this instant_. Collapsing any pair would repeat the one-label-two-states defect this story keeps finding. Like its two neighbours it is strictly **one-directional** — it may only _lift_ a branch out of quiet, never downgrade an answer — so a branch whose PR already answers keeps that answer, and `false` is what every branch on every other machine reports.

  **The lock is observed directly, and that corrects the plan.** The plan expected a lock to announce itself by _failing_ `git status`, so that reading the exit code would be enough. Measured on 2026-08-17, it does not: `git status --porcelain` exits **0** under a held lock in every ordinary condition — clean tree, modified file, staged change, untracked file, stale stat info. Git takes the index lock only when it decides to _write_ a refreshed index back, which it skips whenever cached stat info already answers. The failure the plan was written from is real and **racy** — it reproduces when the index is stale enough to force a refresh-and-write, and not otherwise. Keying the signal on that exit code would report a lock on some runs and not others for the same worktree in the same state, and a flaky signal is worse than none: it teaches the reader to disbelieve the row. So the question is asked of the filesystem, where the answer is unambiguous.

  **Locked stayed distinguishable from missing**, which is what the direct check buys. Both would otherwise fail `git status` with identical empty output, and collapsing them would recreate the very absence ambiguity the exit-code rule exists to remove — one label over two states, in a new place. They are now two independent observations: a vanished directory has no git dir to look in and reports nothing at all, exactly as before.

  **No git call, because the filesystem already states it.** A linked worktree does not keep its index beside the repository's — `.git` there is a file reading `gitdir: <repo>/.git/worktrees/<name>`, and that is where its `index.lock` lives. Testing `$wt/.git/index.lock` would answer for the main checkout only and report every dispatched agent's worktree unlocked, which is the whole population this signal is about. `git rev-parse --absolute-git-dir` would answer both shapes and costs **14 ms** measured — against the 6.6 ms per worktree the sweep already accepts, so asking it per worktree would roughly triple the cost of the local signals to learn something a stat and a 50-byte read already say.

  **It never retries and never waits.** A lock held through a rebase can last seconds, the next poll is 4 s away and will find it unlocked, and a scan that blocks on one worktree makes the pulse late for every branch on the board — a worse version of the defect being fixed. Reporting beats blocking, and the test asserts it by counting status calls rather than by timing, because a timing assertion cannot tell a retry that happened to be fast from no retry at all.

  **The note says the lock alone.** Under a lock the reader is being told to _wait_, where _2 commits not pushed_ tells them to act; saying both would give one row two opposite instructions. The other signals keep their own evidence — a locked worktree that is also dirty still reports both facts in the JSON, each on its own observation, because neither is derived from the other.

  <!--
  bumps:
    skills:
      plot: minor
  -->

### Patch Changes

- [`de4e660`](https://github.com/plot-pm/plot/commit/de4e660ba6104441c5b8261282d2f1d97ddfa8bd) Thanks [@jwloka](https://github.com/jwloka)! - `/plot-dispatch` now writes its `Started:` record into the empty
  `- **Started:**` placeholder the plan template ships, instead of appending it
  after the last item in `## Status`.

  The old rule found the last list item under the heading, which is correct only
  if `Started:` is the final field — it is not, `Delivered:` is. So the record
  landed below `Delivered:`, leaving a Status block that listed a start after a
  delivery. Nothing failed loudly, because the parser reads the record wherever
  it sits; both plans dispatched on 2026-08-16 had to be tidied by hand.

  Plans with no placeholder (pre-Plot-2 files) keep the old append behaviour.

- [#154](https://github.com/plot-pm/plot/pull/154) [`9226c29`](https://github.com/plot-pm/plot/commit/9226c29e5510a310a3f0a608dde61ce5e837bea2) Thanks [@jwloka](https://github.com/jwloka)! - A drafted plan's branches stop reading `eligible — nobody has taken it`

  NOT STARTED means _discovered, planned, ready for an agent to pick up_. A plan
  still under review has not reached that point, and `plot-dispatch` refuses its
  branches — so the row was offering an action the tool declines, which is the
  same mismatch the Start button already avoids by appearing only on eligible
  rows.

  Seen live twice: a plan drafted minutes earlier, its plan PR still in CI, its
  branches immediately indistinguishable from work that had been waiting since
  February. Such a row now reads `plan not approved yet — still in review`,
  naming the review rather than merely saying _blocked_ — and loses its Start
  button by construction, since the button matches the eligible sentence.

  Derived, never stored: the pulse has carried each plan's phase since [#140](https://github.com/plot-pm/plot/issues/140),
  deliberately as data, and the row re-derives from it on every scan. Approving
  the plan flips the note on the next scan with nothing to clear.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#144](https://github.com/plot-pm/plot/pull/144) [`3d69fd7`](https://github.com/plot-pm/plot/commit/3d69fd7ba447c6ec7d37c6b4cb920a41513ac317) Thanks [@jwloka](https://github.com/jwloka)! - Conflicts in the board bundle are settled by rebuilding, not by reading.

  `skills/plot/scripts/board/board-server.mjs` is generated output: **177 lines holding 796 KB**, roughly 4,500 characters each. Git merges line by line, so every board change — whatever source file it came from — lands in the same handful of enormous lines. Two branches touching entirely disjoint sources still collide there, and the diff cannot be meaningfully read.

  That was the binding constraint on parallel board work, three times on 2026-08-16. PR [#141](https://github.com/plot-pm/plot/issues/141) demonstrated it while the plan was being written: `merge-tree` named exactly one conflicting file, this one, with zero source conflicts. `App.tsx` and `AgentList.tsx` merged cleanly; the generated bundle did not.

  **A conflict in a reproducible file is not information.** `pnpm build:board` regenerates the artifact from sources that merged cleanly, so any version of it is exactly as good as any other. `.gitattributes` now marks it `-merge`, and git stops trying to reconcile it.

  The measured difference is sharper than "no conflict". Without the attribute, git splices conflict markers **into** the bundle, leaving 796 KB of unparseable JavaScript that a rebuild cannot even run against. With it, git keeps one version whole and reports the conflict, so the file stays valid and buildable:

  ```bash
  git checkout --ours skills/plot/scripts/board/board-server.mjs   # either side
  pnpm build:board
  git add skills/plot/scripts/board/board-server.mjs
  ```

  **An attribute, not a custom merge driver.** `merge=rebuild` invoking the build is the more elegant idea and the more dangerous one: `.gitattributes` is versioned and travels with the repo, but a driver _definition_ lives in each clone's `git config`. On CI and fresh clones the attribute would name a driver that does not exist, and git falls back to a normal merge **silently** — a rule that works only where someone remembered to install it.

  **The resolution names no side, and that is load-bearing.** Measured on the real artifact: a `git merge` keeps the branch being merged into, a `git rebase` keeps the upstream. "Ours" inverts between them, and agents here rebase routinely, so a side-named instruction is right in one flow and wrong in the other. Since the rebuild overwrites whatever was kept, the instruction is _take either version, then rebuild_.

  **The file stays in git and the CI gate is untouched.** `pnpm board` starts it with no build step and the plugin ships it; CI runs `pnpm run build:board` itself and byte-diffs, so the committed file is an expectation rather than an input. The gate is what keeps this honest — resolve by keeping a stale artifact and forget to rebuild, and the no-diff check fails. The strategy removes the _conflict_; the gate still enforces _correctness_.

  `test/reconcile/artifact.test.mjs` asserts this against the real artifact rather than a fixture, since the 177-line shape is what causes the failure: that disjoint-source branches leave the bundle whole and marker-free, that a merge and a rebase commit byte-identical artifacts, that it works in a clone which configured nothing, and — as a control — that without the attribute the same merge corrupts the file.

  One thing this deliberately does **not** change: `git merge-tree` still predicts the conflict, because `-merge` governs how git _resolves_ the file rather than whether it _reports_ one. `plot-merge-queue` therefore goes on flagging every board pair — now over-cautious rather than wrong, since what it names costs a rebuild instead of an afternoon of reading. Prediction is this plan's second wave; the behaviour is pinned in a test so it is recorded rather than rediscovered.

  The procedure is documented in `docs/definition-of-done.md`, with the short form in `CLAUDE.md` and `AGENTS.md` where an agent hitting the conflict will already have it in context.

  <!--
  bumps:
    skills: {}
  -->

- [#143](https://github.com/plot-pm/plot/pull/143) [`eed6880`](https://github.com/plot-pm/plot/commit/eed6880a9621575bec1e0ca8f26140b49fde8e71) Thanks [@jwloka](https://github.com/jwloka)! - The board binds its port once and reports the port it bound.

  A port was chosen at one moment and used at another, with nothing carrying the
  answer between them. On 2026-08-16 that cost three separate incidents: a CI
  flake on PR [#131](https://github.com/plot-pm/plot/issues/131) (`a plans dir NESTED in an unrelated repo borrows nothing from
it`, passing on rerun with the identical commit), a `pnpm board` that refused to
  start with a raw `EADDRINUSE` stack trace, and a tab bookmarked on a port whose
  server had died.

  **`PORT=0` binds zero and reports what the OS assigned.** The default stays
  7777 — a development board on a random address is not bookmarkable, and
  `pnpm board` would land somewhere new every time.

  **The bound port reaches the same-origin check.** `const PORT` was evaluated at
  module load, before `listen()`. Under `PORT=0` the constant stayed `0` while the
  real port was something else, so `/api/dispatch`'s allowlist would have read
  `http://localhost:0` and refused **every** browser origin — silently disabling
  Start work, the one endpoint that spawns processes. The port now comes from
  `server.address()` inside the listen callback. That inconsistency existed
  already; `PORT=0` only made it impossible to ignore.

  **`findFreePort` is deleted**, and all 28 call sites across 8 test files read
  the started server's port instead. The helper bound port 0, read the number,
  **closed**, and handed it to a different process to bind later — a
  time-of-check-to-time-of-use race that CI, running test files in parallel on one
  machine, lost often enough to gate a plan PR. `startServer` already parsed the
  port out of the readiness line it waits on and discarded it. It is not fixed
  with a retry loop: a test that fails once in fifty runs is harder to diagnose
  than one that never does.

  **A second `pnpm board` names the running one and exits 0.** The failed
  `listen()` is the check — probing beforehand would rebuild the very race being
  removed. It reports and stops; it never kills the running board, because several
  worktrees run side by side and a `pnpm board` in one terminal shooting down
  another's is a worse failure than the one being fixed. Seven board servers
  accumulated on 2026-08-16, at 80 GraphQL calls/hour each, because nothing
  connected a new invocation to an existing one.

- [#129](https://github.com/plot-pm/plot/pull/129) [`d726385`](https://github.com/plot-pm/plot/commit/d7263858b83b0516eb3a39eebae42c8d6bf16fe2) Thanks [@jwloka](https://github.com/jwloka)! - `plot-fleet-scan.sh` tells _merged and deleted_ apart from _never started_.

  `branch_state()` opened with one question — does `refs/remotes/origin/<br>` exist? Absence carries two meanings and the script silently picked one: a branch that never existed and a branch whose PR merged with its ref deleted at merge are the same missing ref, and both answered `open`, which the wave arithmetic reads as **outstanding**. A finished wave never completed, and the branch downstream of it stayed blocked.

  That stopped being cosmetic when the gate got an automated reader. On plot's own repo, with both of `board-reads-git`'s PRs merged and both refs deleted:

  ```
  $ plot-dispatch.sh --dry-run board-reads-git
  summary: dispatched=2 reused=0 skipped=0 started=0
  ```

  The entire completed plan would be re-dispatched. Nothing downstream stops it either — `plot-dispatch.sh`'s `exhausted` guard has exactly two triggers, both _contention_ conditions, and neither fires here: the refs are gone, so each claim push **succeeds**, recreating the deleted ref and handing an agent a worktree whose diff is already on main. After the fix that same command reports `dispatched=0`.

  Nothing local survives the ref — no reflog, no packed remnant. What survives is the merge commit on the default branch, so `branch_state()` asks one question before answering `open`: did this branch land? Candidates are what is **reachable** from the configured default branch, matched by an anchored subject:

  ```
  ^Merge pull request #[0-9]+ from [^/]+/<branch>$
  ```

  A hit returns `merged` — already the state that settles a wave, so the arithmetic is untouched and no new state enters the vocabulary. Absence keeps `open`: the fix can only move a branch from `open` to `merged`, and only on positive evidence.

  **The anchoring is the whole mechanism.** Of this repo's 119 reachable merges, eleven are _backward_ merges (`Merge remote-tracking branch 'origin/main' into <branch>`) — subjects that also name a branch, with the opposite meaning. A name-only grep would read all eleven as merge evidence and report unfinished work as finished, opening the next wave on an unlanded seam. That inversion is worse than the bug being fixed. Measured: 0 of the 11 match the anchored pattern.

  **Two structural filters were tested away, and tests now keep them out.** A second-parent counter-check does not discriminate — PR merges and backward merges both have a distinct second-parent tip, so it would have passed on all eleven traps. A first-parent filter measured well at "119 merges → 109 on the chain" but against the wrong baseline; compared with the anchored pattern it scores 108 to 108, catching nothing extra, and it breaks GitFlow — a feature merged via `develop` is not on the first-parent chain and would read `open` while its work is an ancestor of main.

  The history is read **once per run**, not once per branch: `branch_state()` runs per branch and the board polls every 5 s, so the naive shape is O(history × branches) where O(history + branches) is available (197 ms vs 79 ms on a 2000-merge fixture). `MERGE_SCAN_LIMIT` is 2000 and **saturation is reported** — a blind cap re-creates this very bug, since at 300 against 2000 merges an early merge is not found and reads `open`.

  The footer gains `merge_detect=pr-merge|truncated|none`, in the shape `plot-reconcile-scan.sh` already uses for `pr_source`. `open` must stop meaning both "never started" and "I could not tell", and `truncated` is its own value because a capped walk detected but not exhaustively. `none` marks a squash/rebase repo, where `open` says nothing about merging at all.

  **The ref check stays in front, and a test pins it.** A branch name can be reused — merge `bug/flaky`, delete it, recreate it for a second attempt — and the first attempt's merge subject is still on main. That is stale evidence, and it is harmless only _by placement_: the lookup lives in the no-ref arm, and a recreated branch has a ref. Hoisting the merge check to the top of `branch_state()` is a natural tidying move that would silently report in-flight work as `merged`.

  Detection reads git and nothing else — no plan `→ #<n>` annotations (the missing annotation and the missing delivery have the same cause; `board-reads-git` had both branches merged and neither annotated) and no host calls, which is what keeps the scan free enough to poll every 5 s.

  <!--
  bumps:
    skills:
      plot: patch
      plot-fleet: patch
  -->

- [#125](https://github.com/plot-pm/plot/pull/125) [`12bc6d1`](https://github.com/plot-pm/plot/commit/12bc6d1fc12bf13925b2f27fb0355c5cc7eb9890) Thanks [@jwloka](https://github.com/jwloka)! - `plot-reconcile-scan.sh` tells _contained in an open PR_ apart from _orphaned_.

  Section 3 asked one question about open PRs — is this branch the **head** of one? A branch sitting below the head of an open PR answered no and fell through to `else`, which calls it an orphan. Stacked work is ordinary, so the section described perfectly live branches as abandoned: on plot's own repo seven of eight `stale=` entries were the `opus5-hardening` branches, all ancestors of the head of PR [#57](https://github.com/plot-pm/plot/issues/57). That is enough false noise to make a person stop reading the section, which costs the true finding hiding among them.

  The scan now also asks whether an unmerged branch is an ancestor of any open PR's head. A hit is reported in its own block and does **not** count toward `stale=`:

  ```
    -- contained in an open PR (work in flight, not stale) --
    origin/feature/stack-base — contained in open PR [#200](https://github.com/plot-pm/plot/issues/200) → not orphaned
  ```

  Printing rather than staying silent keeps the section honest about what it examined and rejected — a scan that quietly drops findings is the defect this whole plan was written to fix.

  Two ordering constraints, both load-bearing and both easy to get backwards.

  **The claim check comes first**, and the obvious justification for that is wrong. An empty claim is an ancestor of _nothing_: its claim commit puts it one commit **ahead** of the branch point, so the ancestry runs the other way. The real case is the reverse — once a worker builds on its claim, the claim commit becomes part of the working branch, which is typically the head of the PR it opens. Such a claim is legitimately contained in an open PR, and must still be reported as a **claim**, because that is the more specific fact. Inverting the two silently drops `claims=` to zero.

  **Containment is only asked for unmerged branches.** A merged branch is an ancestor of the main branch, and therefore of every open PR branched from it; asking before the merged check would swallow the entire deletion-candidate class.

  The open-PR list now carries each PR's number alongside its head branch, since the report names the PR a branch is contained in. That rides along on the bundled call already being made — still one `--state open` call per run, one extra JSON field.

  Cost is one `git merge-base` per candidate per open PR, bounded by branches × open PRs, and only reached by branches that already failed the head test. Where PR state is unavailable (`--offline`, `--no-pr`, or no host CLI) there is no list to test against, so containment is skipped rather than guessed and the branch keeps its previous verdict.

  <!--
  bumps:
    skills:
      plot: patch
      plot-reconcile: patch
  -->

- [#122](https://github.com/plot-pm/plot/pull/122) [`7ab8b05`](https://github.com/plot-pm/plot/commit/7ab8b0568bf5e29045cf99896571f94939858fc8) Thanks [@jwloka](https://github.com/jwloka)! - `plot-reconcile-scan.sh` finds plans whose implementation rode a single PR.

  Section 2 asked one question — is a branch this plan names present in `git branch -r --merged`? In single-PR mode the plan and its implementation share one idea branch, and that branch is deleted at merge. The ref is gone, so the answer was always no, and the plan sat in Approved unreported. `kanban-board-v1` hung that way for five weeks while the scan called the repo clean. The check was looking for the right thing in a place where it could not be.

  The scan now also matches each plan's named branches against the heads of merged PRs, fetched once per run beside the existing bundled open-PR list. A plan is merged-but-not-delivered if **either** signal fires. The two are OR-ed rather than swapped: fan-out plans keep being caught by the branch check, since their per-branch PRs merge at different times.

  The obvious fix — read the plan's own `prs` field and ask the host about it — was rejected because it misses its own motivating case. `kanban-board-v1` carried no PR annotation at all while it hung; `→ [#40](https://github.com/plot-pm/plot/issues/40)` was back-filled at delivery. The missing annotation and the missing delivery share a cause, so an annotation-keyed check is blind to exactly the sloppy plans it exists to catch. Matching branch names against merged PR heads needs neither a surviving ref nor a recorded number.

  Cost stays constant in plan count: one bundled `--state merged` call per run, not one `pr-state` call per plan. The list is fetched with `--limit 500`, because gh's default page of 30 reaches back only to [#90](https://github.com/plot-pm/plot/issues/90) on plot's own repo — [#40](https://github.com/plot-pm/plot/issues/40) is invisible at the default, and silently missing old plans is this check's own failure mode. Measured on that repo, 200 and 500 both cost ~0.8-1.1 s; the round trip dominates, so the headroom is nearly free.

  Both degraded paths now say so instead of printing a bare `(none)`: `--offline`/`--no-pr` note that merged-PR heads were not consulted, and a saturated list reports that older PRs went unexamined. A check that quietly skipped used to be indistinguishable from a check that found nothing, and silence reading as health is the defect this section was fixed for.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#166](https://github.com/plot-pm/plot/pull/166) [`8eeacb9`](https://github.com/plot-pm/plot/commit/8eeacb9b557aef16141b690dfd7736facb2707c6) Thanks [@jwloka](https://github.com/jwloka)! - A board server started by the test harness exits when the run that started it is gone.

  Measured on 2026-08-17 at 02:00: four `board-server.mjs` processes, two of them
  on random high ports — which only `packages/board/test/helpers.mjs` asks for,
  via `PORT=0` — with **PID 1 as their parent**. The test runs that spawned them
  were long gone, eighteen seconds apart, and both were still answering
  `/api/fleet` with 200 and still polling. That accumulation is why the Agents tab
  reported `0 branches across 0 plans` during a five-agent run: the fleet view
  exists to make parallel work visible, and the more parallel work ran, the less
  reliable the view of it became.

  **This was not a discipline problem.** 26 `startServer(` calls against 24
  `.kill()` calls in `after()` hooks — the tests clean up correctly. But
  `startServer` _returns_ a `kill` function for the caller to invoke, which makes
  cleanup a **rule** in this repo's vocabulary: you can answer "did I clean up?"
  without having done it, because `after()` never runs when the runner is killed
  rather than finishing. Ctrl-C, a dying agent, a `SIGKILL`: no hook fires, and
  POSIX hands the child to PID 1.

  **The server now measures its launcher rather than trusting one.**
  `process.ppid` becomes `1` the moment a parent dies, **however it dies** —
  measured with a probe: parent killed by `SIGKILL` (exit 137, so no handler of
  its own could run), child observed `ppid changed 20996 -> 1` within 200 ms. A
  1 s interval polls it. That is a gate rather than a rule, it needs no
  cooperation from the caller, and it survives the exact case that produces
  orphans: the one where no cleanup code runs at all. It also fails safe — a check
  that never runs leaves behaviour exactly as it was.

  **It is gated on a new variable, `PLOT_EXIT_WITH_PARENT`, and the distinction
  cannot be the ppid change itself.** The operator's board runs under
  `node --watch`, whose supervisor _replaces its child on every restart_ — so "my
  parent changed, therefore exit" is true for both, and the operator's board would
  be the one that dies. A board in a terminal the operator then closes is likewise
  meant to keep running. `helpers.mjs` already passes `PLOT_REPO_ROOT` and
  `PORT=0` to every server it starts and the operator's board has neither, so
  either could serve as a tell; neither should. `PLOT_REPO_ROOT` answers _where
  the repo is_ and `PORT=0` answers _pick a port for me_ — inferring from either
  would work by accident today and surprise whoever sets them for their actual
  meaning tomorrow. One variable, one question.

  One variable covers the agent case with no second mechanism: agents run
  `pnpm test`, which goes through this same `helpers.mjs`, so their servers
  inherit it exactly as a human's do — the case producing the most orphans is the
  same case.

  **Two neighbouring answers were checked and rejected.** A global teardown runs
  only when the suite ends **in order**, which is precisely what the per-suite
  `after()` hooks already cover; the orphans measured at 01:54 came from a run
  that did not end in order, and a teardown would have missed both. And
  `helpers.mjs` spawns _without_ `detached: true`, so these were ordinary children
  that got orphaned — adding it would have made the problem deliberate.

  Tests assert against `SIGKILL`, never `SIGTERM`: a handler-based cleanup passes
  the polite case and leaves exactly the orphans this exists to remove.

- [#128](https://github.com/plot-pm/plot/pull/128) [`ca85b5e`](https://github.com/plot-pm/plot/commit/ca85b5e4f9d085d4c9fd2d06e1152bca28e9bfb6) Thanks [@jwloka](https://github.com/jwloka)! - `plot-update-board.sh` gains a test.

  It had none, which is why a missing transition — new implementation PRs never reaching _Ready_ — survived five months before [#98](https://github.com/plot-pm/plot/issues/98) closed it. A board update that never happens is indistinguishable from a board nobody configured: nothing fails loudly, so nothing but a test could have caught it.

  The happy path needs a real GitHub Project, so the suite pins everything around it, which is where the failure actually lived. `gh` is PATH-stubbed per subcommand and every run happens in a throwaway git repo, so the tests are fully offline and never touch the host repo's board cache.

  **Argument handling.** Zero through three arguments exit 1 with the usage string, and never reach `gh`; four arguments do not exit 1 and drive the full `view → item-add → field-list → item-edit` sequence, with the status argument selecting the matching option id.

  **Graceful degradation.** All six unreachable-board paths — unresolvable project, failed `item-add`, failed `field-list`, a project with no Status field, an unknown status option, a failing `item-edit` — exit **0** with their warning on stderr rather than stdout. So does a `gh` that is missing from PATH entirely, and so does a run from outside any git repo. This is the load-bearing behaviour: the script is called from skills that must not fail when no board is configured, and it is exactly why the missing call was silent.

  **Every status has a caller.** Each of `Planning`, `Ready`, and `Done` appears in some `plot-update-board.sh` invocation under `skills/`. This is deliberately a test about skills rather than about the script — the defect was never in `plot-update-board.sh`, it was in nobody calling it. Deleting the `Ready` caller reproduces [#98](https://github.com/plot-pm/plot/issues/98) and fails exactly this test and no other.

  It asserts the status **set**, not skill-to-status pairs. Pinning `plot-approve → Ready` would be stricter and would also catch "the wrong skill calls it" — but it would break on exactly the kind of restructuring that caused the gap: Plot 2 moved branch creation from `/plot-approve` to `/plot-implement`, and a pair-based test would have gone red for a legitimate move while staying silent about the transition actually disappearing. A companion test guards the three against passing vacuously if the grep or the argument shape ever drifts.

  Two further properties ride along because they are cheap and were never pinned: project metadata is cached under `.git/` rather than into the working tree (and a second run reuses it, skipping `view` and `field-list`), and the script uses no bash-4-only constructs, since macOS ships bash 3.2.

  Assertions are per line rather than whole-output regexes — this suite has been fooled three times by patterns matching across report lines. Each test was verified to fail under a targeted mutation of the behaviour it claims to pin.

  No skill version bump: this adds coverage only — `plot-update-board.sh` and every skill that calls it are unchanged.

## 2.3.0

### Minor Changes

- [#108](https://github.com/plot-pm/plot/pull/108) [`576bde8`](https://github.com/plot-pm/plot/commit/576bde8d50d152eee8a179989a51700a7b7247a4) Thanks [@jwloka](https://github.com/jwloka)! - The board shows the four workflow phases instead of the four plan states.

  Columns are now **Discovery · Design · Development · Endgame · Released**, which asks _who leads_ rather than _what has happened_: three phases are human-led and exactly one — Development — is agent-led.

  **`Approved` spans a phase boundary**, and that is the substantive change. A plan with no `Started:` record sits at the end of Design, waiting for a person to begin; one with a record is in Development, where an agent is working. The board already carried that data as a Ready/In-progress badge and simply did not read it as a phase change. The badge stays only for the waiting half, since a card in Development is started by definition.

  **Development ends at the merge.** A column is a partition, so Delivered belongs to Endgame alone: the code landed, the agents are done, and what remains — verification and signoff — is human-led.

  Endgame cards carry the release checklist count (`22/27`), parsed from the newest `docs/releases/*-checklist.md`. "Delivered" does not answer what the column asks. A missing or unparseable file yields no badge rather than a guessed number, and the parser is pinned by tests over nested, malformed and prose-mentioning-brackets cases.

  Leadership is carried by a **symbol and a word**, with colour only repeating it — roughly one man in twelve distinguishes red from green poorly, and boards turn up in greyscale screenshots.

  `BOARD_PHASES` changes shape, which is a breaking change for `/api/board` consumers. All four inside this repo move with it: the client, both test suites, and the dev-server middleware.

- [#109](https://github.com/plot-pm/plot/pull/109) [`a2d67f5`](https://github.com/plot-pm/plot/commit/a2d67f5e32faf684b914db3f9d6c1339dcbd1ad4) Thanks [@jwloka](https://github.com/jwloka)! - Stories become swimlanes — one row per story, plans in the column their phase puts them in.

  Off by default and offered only where it can show something: with no stories, lanes would render a single "(no story)" row, which is the board with a wasted column. It is a **layout of the same board**, not a third tab — the question is still "where does this work stand", grouped by story as well as phase.

  The Discovery column doubles as the row header, carrying the story's title, slug, status and plan count. A story with no plans keeps its row: "shaped, nothing planned yet" _is_ the Discovery phase, and hiding the row would hide the one thing the header exists to show.

  Two cases the lane builder refuses to lose. A plan naming a story with **no file** — a typo, or a story not yet written — gets its own row labelled as such, because dropping it would make work vanish from the board. And a test pins the invariant that lanes **partition** the cards: counted twice would double-report work, dropped would hide it.

  Found by looking at the result: a row is as tall as its fullest cell, and the rest stay empty. Harmless in columns, multiplied across rows — one lane with four Endgame cards pushed the next story below the fold. Cells now cap and scroll internally, so every lane stays reachable without collapsing what it holds.

- [#106](https://github.com/plot-pm/plot/pull/106) [`f52fd43`](https://github.com/plot-pm/plot/commit/f52fd43573789975155558f486e751aaba245acf) Thanks [@jwloka](https://github.com/jwloka)! - The Agents tab fills its two empty groups: PR state now says whether a person or a machine is the blocker.

  `plot-host.sh pr-list --rich` carries check status and review decision, so the board never talks to the host itself — Principle 3 keeps that knowledge in one place, and a board shelling out to `gh` would silently become GitHub-only.

  **Check state has four cases, and two of them mean a person is the blocker.** A PR with an _empty_ rollup is neither green nor running: GitHub starts no workflow for a bot PR until a human approves the run, which happened in this repo today. Reporting that as pending would show "CI running" indefinitely while nothing ran, and nobody would look — so it lands in _waiting on you_ with the note **no checks**, saying why it is not green rather than implying it is. `ACTION_REQUIRED` is the same situation from the other side and is likewise not pending. One red check among green ones counts red.

  Where the host cannot report checks at all (Bitbucket), the answer is `unknown` and the row says _unavailable_. An honest gap beats an invented verdict.

  **Review state is shown and never gates.** A row carries _awaiting review_, _changes requested_ or _approved_ as a note beside its age, because an agent waiting on a review is exactly what the person reading the tab can resolve. But membership comes from checks alone: approved is approved with or without a review — a recorded approval is the plan's `Approved:` record, not a host review — and nothing downstream may treat the note as a condition.

  **The two sources cache separately, each with its own age and error.** Git and the host fail independently, so a `gh` hiccup must not stale git data that was available the whole time. The footer reports both ages; a failed PR fetch keeps the last good map rather than blanking it, which would look like state changing instead of data missing.

- [#112](https://github.com/plot-pm/plot/pull/112) [`4dd8699`](https://github.com/plot-pm/plot/commit/4dd8699a35f8cd196e7f0d08811327b0dc43da13) Thanks [@jwloka](https://github.com/jwloka)! - `/plot-release` records the release in the plans it shipped.

  Plot's fourth phase had never been reached — not once across sixteen versioned releases. Step 4 hands off to the project's own release machinery, which is correct, and nothing came back afterwards: the version shipped, the tag landed, and the plans describing that work sat at Delivered forever.

  New step 5b closes it. For each delivered plan it resolves the version **from git rather than from dates** — the last `→ #N` annotation, its merge commit, and the release tag containing it. The delivery date records when a plan was _booked_, not when its code merged; those can be months apart, and two tags may share a date, so day resolution cannot separate them even in principle.

  Three things it deliberately refuses to do. It **skips docs/infra plans**, because `/plot-deliver` already told their authors they are live on merge. It **leaves unresolvable plans alone** and says so — an invented version in a transition record is a claim nobody re-checks. And it **does not move the symlink**: `delivered/` means "no longer active", not "phase is exactly Delivered".

  The step ends with a gate in the shape `/plot-deliver` step 7b established, because this is a multi-file write followed by a push — worse than delivery's, since it touches N plans and a partial write leaves some released and some not with nothing to say which. `unreleased_delivered=0` from the real sweep clears it; anything else is a hard stop.

  It reports what it did **not** mark, with the reason. A silently skipped plan looks identical to a plan with nothing to do — precisely the confusion that hid this for sixteen releases.

- [#111](https://github.com/plot-pm/plot/pull/111) [`4e97318`](https://github.com/plot-pm/plot/commit/4e9731830d9918fd7e26eaf50c7d7a566c177682) Thanks [@jwloka](https://github.com/jwloka)! - The reconcile sweep finds delivered plans that already shipped.

  Plot's fourth phase had **never been reached** — not once across sixteen versioned releases. Nothing compared the two facts: `/plot-release` ships a version, and the plans describing that version stay at Delivered. Neither side is wrong alone, so neither complained.

  Section 6 asks the question git can answer exactly: _which release tag contains this plan's merge commit?_ Deliberately **not** a date comparison — the delivery date records when a plan was booked, not when its code merged (one plan here sat five months between the two), and two tags in this repo share a date, so day resolution cannot separate them even in principle. `plot-host.sh pr-state` now carries `mergeCommit` so the adapter, not the caller, owns that lookup.

  docs/infra plans are skipped by type: `/plot-deliver` already tells their authors "live on main — no release needed", and reporting them would contradict a message Plot itself sends, on every sweep, forever. A plan with no PR annotation is reported as **unresolvable** rather than skipped — "cannot tell" and "nothing wrong" must not look the same, which is the confusion this whole section exists to end.

  The six delivered plans in this repo are back-filled with the versions that actually shipped them (v1.0.0 through v2.2.0, and one correctly still unreleased). `plot-plan-meta.sh` gains `released_raw` so the version is readable rather than re-derivable.

  Found while building it: adding a field to the parsed rows leaked the field separator into section 2's output, because one read loop still named seven fields. A test now pins that no report line may contain it — the same class as the tab-collapse bugs this suite has caught twice.

## 2.2.0

### Minor Changes

- [#103](https://github.com/plot-pm/plot/pull/103) [`06cd57f`](https://github.com/plot-pm/plot/commit/06cd57f649884b9dc3adcd98dd5a247a95041463) Thanks [@jwloka](https://github.com/jwloka)! - The board serves `/api/fleet`: what agents are doing, and what they wait for.

  Branch state was only ever visible as terminal output — real, but gone the moment the scrollback rolled. The endpoint turns `plot-fleet-scan.sh --json` into rows grouped by **the reason each one is waiting**, because each group implies a different action: review it, nothing, nothing, go check whether it died, decide whether to start it. Sorted that way the list is workable top to bottom, and when only _working_ is populated you can walk away.

  **It never runs the scan.** Measured: 0.5–1.05 s per scan against a 4 s client poll, on a single-threaded server — that would block the event loop roughly a quarter of the time. The server refreshes a cache on its own timer using the async `execFile`, and every request reads the cache plus its age. Client poll rate and scan duration are decoupled, so twenty plans give you a _staler_ tab, not a _slower_ board.

  Two failure modes are handled as deliberate design rather than as edge cases. Until the first scan lands the endpoint reports `ready: false` — "not ready yet", never an empty fleet. And a failed refresh **never overwrites a good result**: the tab keeps the last pulse, its age, and the error. Replacing real state with emptiness because one scan failed is what makes a monitoring view untrustworthy.

  The `waiting-on-machine` group is defined but empty at this step — it needs PR data. It is still rendered, because an absent group reads as "nothing is waiting on CI", a claim this step cannot make.

  **Known limit, worth stating:** this is git-only, so unpushed local work is invisible. An agent editing files without pushing shows as `not-started`.

- [#102](https://github.com/plot-pm/plot/pull/102) [`b11ddbe`](https://github.com/plot-pm/plot/commit/b11ddbec1b9353c37b8c256e6261ed2f51e60a35) Thanks [@jwloka](https://github.com/jwloka)! - `plot-fleet-scan.sh --json` emits the pulse as one machine-readable object.

  The scan's prose is a **human** interface — mechanical enumeration a person reads, per Principle 3. That is precisely why it is not a contract: anything consuming lines like `  Tracer — eligible` breaks the day someone improves the wording. The board is about to consume exactly this data, so the scan gains a second rendering rather than a second reader.

  `--json` serialises the derivation the script already performs. Wave verdicts, per-branch state, claim notes and the summary counters come out as they exist internally: `open` · `wip` · `merged` · `claimed` · `deferred`, and `complete` · `eligible` · `blocked`. Deliberately **not** the prose labels — no consumer should parse `in progress`, a string that exists only to be read. Field names follow `plot-plan-meta.sh` (`branch`, and `""` rather than `null` for an absent claim), because two JSON conventions in one repo is worse than either.

  It is an output mode and nothing more: it composes with `--offline`, `--no-fetch` and `--loose` rather than implying any of them, so the data depends on what the caller asked for rather than how. `--next` still wins — a different question with a one-line answer.

  The test that matters here is not the one that parses the JSON. It is the one asserting the **human report stays byte-identical**: a machine mode is worth adding only if it leaves the thing people read untouched, and that is verifiable rather than assertable — the prose was diffed against its pre-change output, not merely against itself.

- [#104](https://github.com/plot-pm/plot/pull/104) [`12310cb`](https://github.com/plot-pm/plot/commit/12310cba677be3c8755a10af6058c5e4d2e6f747) Thanks [@jwloka](https://github.com/jwloka)! - The board has a second tab: **Agents** — what each branch is waiting for.

  Artifacts move in days, agents in minutes. Forcing both onto one surface answers each question halfway, so they become two tabs — which also lets them poll at different rates: the board every 30 s, the fleet every 4 s, and only while its tab is open. That poll is cheap because `/api/fleet` reads a server-refreshed cache rather than running a scan per request.

  Rows are grouped by **the reason each one waits**, because each group implies a different action: review it · nothing · nothing · go check whether it died · decide whether to start it · nothing at all. Sorted that way the list is workable top to bottom, and when only _working_ is populated you can walk away.

  Every group renders even when empty, `waiting on a machine` included — it needs PR data that does not exist yet, and an absent group would read as "nothing is waiting on CI", a claim this step cannot make. The footer carries the pulse age, so a stale view says so rather than looking live.

  Two things were wrong the moment the tab was first rendered, and neither would have failed a test that was not looking at a screen:

  - **Merged branches sat under _quiet_.** Technically right — no recent commit — and the wrong answer: "go check whether it died" is not a prompt for work that landed. Merged work now has its own **done** group, which asks nothing of you.
  - **A note read `no commit for 30300 min`.** Minutes are the right unit for the first hour and arithmetic the reader has to do after that. Ages now scale to hours and days.

- [#98](https://github.com/plot-pm/plot/pull/98) [`9d5521c`](https://github.com/plot-pm/plot/commit/9d5521c04dbf9c1ca1586051758ea65b000b1e96) Thanks [@jwloka](https://github.com/jwloka)! - `/plot-implement` sets new implementation PRs to **Ready** on a project board.

  The board-sync plan promised a five-step mapping from Plot events to board columns. Four were built; the third — _new implementation PRs land in Ready_ — was not, so those PRs sat in whatever column GitHub assigned them until `/plot-deliver` moved them to Done. The middle of the lifecycle was invisible on the board, which is the part a board exists to show.

  It was missed for a structural reason worth recording. The plan was written for Plot 1, where `/plot-approve` created the implementation branches itself, so the mapping table put the Ready transition there. Plot 2 split that apart: approval only records the approval, and `/plot-implement` starts the work. The step did not go missing so much as its home moved out from under it — and nothing failed, because a board update that never happens looks exactly like a board nobody configured.

  The status is set at the one moment the PR both exists and has not been worked on: when the implementing session creates it. That is already the moment the brief asks for the `→ #<number>` annotation, so it is one more line of bookkeeping at a point the session is stopping anyway, rather than a new obligation somewhere else.

  <!--
  bumps:
    skills:
      plot-implement: minor
  -->

## 2.1.0

### Minor Changes

- [#83](https://github.com/plot-pm/plot/pull/83) [`37f06ea`](https://github.com/plot-pm/plot/commit/37f06ea6270a2cfaf39b38e0107b137d6b034c6b) Thanks [@jwloka](https://github.com/jwloka)! - Harden the fleet commands for first real use.

  Probing the new commands from outside this repo surfaced defects that only appear in a fresh project. All are fixed:

  **`/plot-dispatch` now gates on phase and ceremony, in the script.** It refuses a plan that is not Approved, and one whose `Impl:` answer is not `own branches`. Previously that check lived only in the skill's prose — a rule an agent can rationalise around and a human calling the script directly bypasses entirely. It **fails closed**: if the phase cannot be read, it refuses. That is the opposite of `plot-phase-gate.sh`, which is a PreToolUse hook and must fail open so a broken gate never locks a repo; here the user invoked the command, and starting several agents on unapproved work is the costly mistake.

  **Workers are inspectable.** `--status` lists every fleet worktree with its worker pid, whether that process is alive, and the last line of its log; `--stop <branch>` stops one. Both work regardless of plan phase — work already running must stay reachable. `--stop` requires an explicit branch name; there is deliberately no "stop everything".

  **Claims now age.** The reaper could tell a deliberately abandoned claim from a bare one, but not a worker that is thinking from one that died days ago. A claim older than `Claim stale after` (hours, default 24) is reported as stale with its age. Still no deletion command: staleness is evidence, not permission.

  `Claim stale after` is a new key rather than a reuse of `Sprint stall limit`, which counts iterations without a deliverable in a serial run — a different quantity. Reusing it would have silently read "3 iterations" as "3 hours".

  **`/plot-merge-queue` checks its git version.** `merge-tree --write-tree` needs git ≥ 2.38. Older git has a `merge-tree` with entirely different semantics that succeeds while answering a different question, so every branch would read as conflict-free. A false all-clear is worse than a refusal.

  **Two loops and an exit code fixed.** `--next` returned 0 in a repo with no plans, so the caller pattern the skill itself recommends would accept an empty branch name as valid work — in any repo on day one. And `plot-dispatch` spun forever when a worktree could not be created, because `--next` has no memory and kept offering the same unclaimable branch.

  <!--
  bumps:
    skills:
      plot-dispatch: minor
      plot-fleet: patch
      plot-merge-queue: patch
      plot-reconcile: minor
  -->

- [#88](https://github.com/plot-pm/plot/pull/88) [`0810f02`](https://github.com/plot-pm/plot/commit/0810f02d8c06b1ce970a2471fe8b4be281ecd4d1) Thanks [@jwloka](https://github.com/jwloka)! - Fix everything a reality-check audit found — including one silent correctness bug.

  An adversarial audit ran every documented claim in throwaway repos instead of reading the code. It found that the fleet's central promise did not hold.

  **Claim-by-ref provided no mutual exclusion.** An empty claim branch points at `origin/main`, so a second dispatcher pushing the same branch pushed what was already there: "Everything up-to-date", exit 0. Both sides believed they owned it, and two real dispatchers each reported `dispatched=1` for the same branch. The `skipped (claimed by another session)` path was unreachable — dead code — and **no test exercised a contested claim**, which is how 135 green tests coexisted with the bug.

  Claims now carry an empty commit, so two independent claims diverge and the loser is rejected as non-fast-forward. Claim detection follows: a claim is a branch whose only commits beyond main are claim markers. The old shape (no commits of its own) is no longer treated as a claim — it is indistinguishable from merged work, and treating it as one hid real deletion candidates.

  **`--loose` was weaker than promised.** The plan promised "the prior wave's PRs are green and ready"; the code accepted any pushed commit, so red CI or a draft PR opened the next wave — building on a seam that was not merely unlanded but possibly broken. It now verifies PR readiness through the host adapter, and where readiness cannot be established it degrades to strict and says so. An unverifiable claim of readiness is not readiness.

  **The merge queue was wave-blind**, ordering purely by footprint, so a small wave-2 branch could be recommended ahead of a larger tracer — inverting the premise that an earlier wave proves the seam. Wave order now dominates size.

  **`declare -A` had crept in** with that fix, breaking the queue outright on stock macOS (bash 3.2). A new test now rejects bash-4-only constructs across every script — CI runs bash 5, so no fixture would have caught it.

  Also: the stall-threshold key named in the fleet skill was one no script reads; `plot-fleet-scan.sh`'s header claimed in caps that it never writes a repo file, in the `--log-pulse` mode its own skill mandates every run; `dry_seen` was unbound dead code; `--max` silently accepted non-numbers; `--help` printed a truncated range; and branches sharing a last path segment (`feature/api`, `bug/api`) collided on one worktree, so `--stop` could stop the wrong worker.

  Docs describing the claim mechanism (README, MANIFESTO, intro) are corrected to match.

- [#92](https://github.com/plot-pm/plot/pull/92) [`2171e31`](https://github.com/plot-pm/plot/commit/2171e31e46debccc7f928f44f246ff59fb79d810) Thanks [@jwloka](https://github.com/jwloka)! - Name the four phases, and state evidence over assertion as a principle.

  Plot's four phases have always been _states of a plan_ — Draft, Approved, Delivered, Released. Cutting across them are four _activities_, each turning one durable artifact into the next: Discovery makes a story, Design makes a plan, Development makes merged branches, Endgame makes a verified release. Everything needed for all four already existed; what was missing was the map. Discovery is the one that predates Plot's own states, and it is optional — small, well-understood work goes straight to Design.

  A fifth artifact runs alongside rather than between: the **session log**, recording how something was decided, including the alternatives that were rejected. The line against a plan is now written down: if it must be true _before_ building starts it belongs in the plan; if it answers "why not the other way?" it belongs in a log. Plot does not write session logs — session-scoped tools do that better, because they can reconstruct compacted history and classify session types. The new `plot-context.sh` supplies them the plot-shaped facts instead (governing plan, phase, wave, PRs), and `/plot-init` offers a `## Session Wrap Up` section wiring the two together.

  **Principle 12, "Evidence over assertion"**, states what Plot's gates already do: `/plot-deliver`'s landed check demands the scan's actual footer line rather than the word "verified", and sign-off stays human. The reasoning is specific to how agents fail — reading code and judging it uses the same mental model that wrote it, so only execution can contradict that model. Two consequences are spelled out: passing tests prove only what they test (a suite can be entirely green while the central mechanism is broken, if the untested case is the one the mechanism exists for), and verification wants a separate adversary, because checking your own work shares the blind spot that produced it.

  `/plot-deliver`'s completeness check now acts on that. Its subagents are asked to **refute** each deliverable rather than confirm it, and to report what they _executed_ versus what they only _read_ — a behaviour claim confirmed by reading a PR body is not confirmed. This is the check that catches a changelog entry written at planning time describing intent nobody built.

- [#75](https://github.com/plot-pm/plot/pull/75) [`b14113c`](https://github.com/plot-pm/plot/commit/b14113c745830bcb6a41324d916e07438ced4f20) Thanks [@jwloka](https://github.com/jwloka)! - Claim-by-ref: two sessions can no longer take the same implementation branch.

  `/plot-implement` now asks `plot-fleet-scan.sh --next` which branch to take instead of walking the plan's branch list in file order, and **claims it by pushing an empty ref before starting any work**. A ref push that would overwrite an existing branch is rejected, so a race has exactly one winner — git is the lock, and no lock manager exists or is needed. The loser asks again and takes the next free branch.

  Because `--next` only ever offers branches from an eligible wave, a session can never be handed work that builds on a seam an earlier wave has not yet proven.

  This replaces the old "create the first, list the rest — parallel sessions create theirs on pickup" instruction, which named parallelism without providing any way to coordinate it.

  Giving a branch up is annotate-and-leave: a worker that finds the work unnecessary or wrongly cut records `deferred:` / `split-from:` / `moved:` in the plan and leaves the ref alone. Cleanup belongs to `/plot-reconcile`, which needs that annotation to tell deliberate abandonment from a dead worker — both leave an identical empty branch.

  <!--
  bumps:
    skills:
      plot-implement: minor
      plot-fleet: patch
  -->

- [#76](https://github.com/plot-pm/plot/pull/76) [`1405267`](https://github.com/plot-pm/plot/commit/1405267ed73d1343864f9c0f0aaef5f56a2756ba) Thanks [@jwloka](https://github.com/jwloka)! - `/plot-dispatch`: fan one approved plan out across several agents at once.

  One git worktree and one detached worker per eligible branch, each branch claimed atomically by a ref push. This is the point where Manifesto Principle 4 — "one plan, many branches; different people, different agents, different worktrees, all working on the same plan in parallel" — stops being a description and becomes a command.

  Workers are **detached**, so the fleet outlives the dispatching session: start a fan-out, close the laptop, work continues. The command that runs them is configuration (`Worker command` in Plot Config), because how to run an agent headless is a per-project answer Plot must not hardcode. Without that key, worktrees are prepared and claimed and you start them yourself.

  Fanning out is **human-paced**: `--dry-run` first, then a count, then `--max N`. Each worker costs tokens and produces a PR someone must review, so "all eligible" is never assumed.

  Everything the dispatcher writes is idempotent or refused — a claim that would overwrite an existing branch is rejected (that rejection is the lock), existing worktrees are adopted rather than duplicated, and nothing is ever deleted. A dispatcher that dies halfway through a fan-out is safe to re-run.

  `plot-fleet-scan.sh` gains `--list-eligible` for callers that need the whole claimable set rather than one branch.

  `ralph-plot-sprint`'s "finish before starting" rule is restated, not weakened: it governs one runner's own attention. Several runners may work several branches concurrently, provided wave eligibility allows it.

  <!--
  bumps:
    skills:
      plot-dispatch: minor
      plot-fleet: patch
      ralph-plot-sprint: minor
  -->

- [#80](https://github.com/plot-pm/plot/pull/80) [`9a71dc5`](https://github.com/plot-pm/plot/commit/9a71dc5e8739c2d4969017fab44b320af733bda8) Thanks [@jwloka](https://github.com/jwloka)! - Close the three gaps between what the fleet plan promised and what it shipped.

  Delivery verification compared the plan's changelog against the actual diffs and found three entries the implementation had not backed. Rather than soften the changelog, the work was finished:

  **Wave eligibility is now genuinely configurable.** `--loose` lets a prior wave count as satisfied when its branches carry pushed work rather than merged work. Strict stays the default, because loose buys throughput and pays in rebase risk — the next wave builds on a seam that has not landed. Using it wants a stated reason; this is the one place where _less_ safety is what needs justifying.

  **The pulse can write a pulse line.** `--log-pulse` appends one line per plan to its `## Notes`, clean pulses included — without a record of quiet pulses an idle fleet and a dead fleet look identical. It stays a log rather than state: deleting the whole log changes no behaviour, because the next pulse re-derives everything from git. Without the flag the scan remains strictly read-only.

  **The board shows wave state.** Cards carry a `waveSummary` — waves, outstanding branches, claimed branches — rendered as a badge. It is a summary rather than the nested wave structure because a tile answers "how much is left, and is anyone on it?", not "which branch sits in which wave". Deferred branches are excluded from the outstanding count; counting them would make a finished plan look unfinished. Plans with one wave or none carry no badge, so pre-wave plans are untouched.

  <!--
  bumps:
    skills:
      plot-fleet: minor
  -->

- [#78](https://github.com/plot-pm/plot/pull/78) [`d3c8956`](https://github.com/plot-pm/plot/commit/d3c8956fca46e240c03292f411106ae45c5b1dfb) Thanks [@jwloka](https://github.com/jwloka)! - `/plot-merge-queue`: a safe merge order, and which branches will collide.

  When several agents finish at once their PRs land in a burst, and **each merge invalidates the others' bases** — the second PR was green when it was opened and is broken by the time anyone reaches it. Serial work never hits this; a fleet hits it constantly.

  The queue answers, before any of that: in what order is it safe to merge, and what will break? Per branch it asks two questions, both computed with `git merge-tree --write-tree` (a merge computed entirely in memory — no working tree, no index, nothing touched):

  1. Does it merge cleanly into main right now?
  2. **Does it conflict with a branch ahead of it in the queue?** This is the burst case, and the one that is invisible without a queue: every branch can be independently green while being pairwise incompatible.

  Branches are ordered by footprint, fewest changed files first — the smallest clean branch merged early invalidates the fewest other bases.

  **It merges nothing.** That is the design: most of the value is in knowing the safe order, and knowing it requires no merge rights at all. Merge authority stays with the human until the ordering has proven itself.

  Predictions are exact for textual conflicts and say nothing about semantic ones — two branches can merge cleanly and still break the build together. CI remains the arbiter.

  Requires git ≥ 2.38.

  <!--
  bumps:
    skills:
      plot-merge-queue: minor
  -->

- [#77](https://github.com/plot-pm/plot/pull/77) [`ec86196`](https://github.com/plot-pm/plot/commit/ec8619673392a296e68af5b655983aa3551179fc) Thanks [@jwloka](https://github.com/jwloka)! - The reaper: `/plot-reconcile` now tells an abandoned claim from a dead worker.

  Claim-by-ref means a worker takes a branch by pushing an empty ref. Two very different situations then leave an **identical** artifact in git — the worker deliberately gave the branch up, or the worker died. Before this change both fell into the stale-branch sweep's "ahead of main → orphan" verdict, which was doubly wrong: an empty claim is not ahead of anything, and calling it an orphan hides that someone may still be working there.

  Empty claims are now classified before that verdict, using the plan annotation as the only available signal:

  - **`deferred:` / `moved:` present** → the branch was given up on purpose. Reported as a deletion candidate, with the command.
  - **a bare `claimed:`, or nothing** → the worker may be thinking, or may be dead. Reported as needing judgment, and **no deletion command is offered** — a slow worker looks exactly like a dead one, and deleting its branch destroys work in progress.

  Reading the annotation here is the one deliberate exception to "git is the truth, the annotation is only a reflection". It is safe because this gate decides _cleanup_, not _work_: a wrong annotation costs at most a missed cleanup, never lost or duplicated work.

  The summary footer gains a `claims=N` count. Consumers that parse it (`/plot`'s hygiene line, `/plot-deliver`'s landed gate, `/plot-reconcile`'s Automation Output) see the new field in the documented position.

  This closes the gap opened by Stage 3: detached workers die without telling anyone, so the reaper is load-bearing rather than a nicety.

  <!--
  bumps:
    skills:
      plot-reconcile: minor
      plot: patch
      plot-deliver: patch
  -->

- [#72](https://github.com/plot-pm/plot/pull/72) [`95b8576`](https://github.com/plot-pm/plot/commit/95b857607b8f9b92c07d36fc0092c5cae542e893) Thanks [@jwloka](https://github.com/jwloka)! - Branch waves and the fleet pulse — the first step toward running several agents on one plan.

  Plans can now group their implementation branches into **waves** using `### ` subheadings under `## Branches`. Branches in a wave may run concurrently; a wave becomes eligible once every non-deferred branch in every prior wave is merged. The existing `### Tracer` / `### Implementation` convention is exactly this, now given meaning: the tracer proves the seam before the rest fan out. A plan with no subheadings is one wave, so every existing plan behaves as before.

  The new `/plot-fleet` command reports that state — which waves are complete, eligible, or blocked, and which branches are claimed. It is read-only and stateless: every fact is re-derived from git refs on each run, so there is no fleet database to drift, and a dead worker or killed pulse costs nothing.

  `plot-plan-meta.sh` gains a `waves[]` field (with per-branch `deferred` and `claimed` state) alongside the unchanged flat `branches[]`, and now ignores a second `## Branches` heading appearing in prose — a plan that documents the plan format no longer poisons its own branch list.

  <!--
  bumps:
    skills:
      plot-fleet: minor
      plot: patch
  -->

- [#91](https://github.com/plot-pm/plot/pull/91) [`98d8ef5`](https://github.com/plot-pm/plot/commit/98d8ef579b8fde11c191e27a997895d58c1153c5) Thanks [@jwloka](https://github.com/jwloka)! - `/plot-init`: adopt Plot in a repository without writing the config by hand.

  Adopting Plot has meant reading `## Plot Config` documentation and composing the section yourself — or, in practice, pasting a long prompt that hardcoded one organisation's parameters and went stale with every release.

  `/plot-init` probes instead of interviewing. `plot-detect-repo.sh` reads what is already visible — git host from the remote, quality-gate scripts from `package.json`, a ticket scheme from commit subjects, the commit notation, which planning directories already exist, which hub doc is present — and the skill presents a complete proposal for the user to correct rather than compose. Exactly one thing is always asked: which of the candidate scripts actually gates a merge, because only a human knows that.

  Detection is deliberately conservative, since a guess dressed up as a fact costs more than a wrong proposal. A ticket prefix must **recur** before it counts (one stray `ONEOFF-1` is not a scheme), and only recognisable gate names are offered as Definition-of-Done candidates — a repo's `deploy` script is not a quality gate.

  Adoption is additive: nothing is moved, rewritten, or deleted. A repo with four overlapping planning systems keeps all four, and the skill offers to _describe_ the boundary rather than migrate anything.

  House rules are optional extensions, each gated on a detected signal — a Bitbucket repo is offered the `bb`-not-`gh` note, a GitHub repo never hears about it. And one blocked step never sinks the adoption: an unwritable `.claude/settings.json` costs slash-command convenience and nothing else, so the skill prints the block, asks, and continues.

  `docs/sprints/` and `docs/stories/` are **not** created by default, and posture keys appear only where the answer is not the default — a new adopter should not start with directories and settings nobody chose.

### Patch Changes

- [#89](https://github.com/plot-pm/plot/pull/89) [`94d5b95`](https://github.com/plot-pm/plot/commit/94d5b95cc38245d64d81f6083a08c61406297284) Thanks [@jwloka](https://github.com/jwloka)! - Claim detection no longer trusts a commit subject alone.

  A second audit — this time of the fixes themselves — found that classifying a claim by commit subject was unsafe. A human commit titled `plot: claim handling refactor`, carrying real files, counted as an empty claim; with a `deferred:` annotation on that branch, the reaper then offered to **delete a branch holding real, unmerged work**.

  A claim marker is now required to be both titled `plot: claim …` **and** empty (its tree equals its parent's). The impostor is correctly demoted to "orphan (needs judgment)" with an inspection command instead of a deletion command, while genuine claims are still detected. Both detectors — `plot-fleet-scan.sh` and `plot-reconcile-scan.sh` — share one rule.

  Two untested surfaces are now covered. `--loose`'s positive path was unreachable in tests because every invocation passed `--offline`, which disables the fetch and so made readiness unverifiable — only the degraded path was ever exercised. A stubbed host now covers ready, draft, and unavailable. And `--max` validation had no test at all: reverting the guard left the whole suite green.

  Four doc passages still described the superseded mechanism ("an empty branch with no commits of its own is a claim"). They now describe what the code does, and `plot-fleet/README.md` records why the empty-branch design failed — it is the kind of mistake worth leaving a marker for.

- [#93](https://github.com/plot-pm/plot/pull/93) [`7cf4360`](https://github.com/plot-pm/plot/commit/7cf436099a501665fc3e66ef5dc401792ebba936) Thanks [@jwloka](https://github.com/jwloka)! - Report ambiguity instead of guessing, and pin the resolution path that no test covered.

  A second adversarial audit — this time of the recent additions — found two things worth blocking a release for.

  **`plot-context.sh` picked a plan by filename order.** When two active plans listed the same branch, the lookup broke on the first glob hit, so the "governing plan" was whichever symlink sorted first alphabetically. Renaming a file changed the answer while nothing about the work changed, and nothing signalled that a choice had been made. The script's own header promises the opposite — "a durable decision record attributed to the wrong plan is worse than one with no attribution" — and a silent pick produces exactly that. It now reports `ambiguous: true` with the candidate list and leaves `plan_slug` empty.

  **The `idea/` fast path had no test.** Disabling it left every test green, yet it is the only route that resolves a plan sitting on its own idea branch before any Branches section names it — the primary path, invisible to CI. Now pinned, and verified by sabotage in both directions.

  Three smaller findings from the same audit: `plot-detect-repo.sh` matched hosts by substring, so `git.mybitbucket.internal.example.com` read as Bitbucket and a path segment could spoof GitHub entirely — the globs are now anchored to the host position. It also read only the root `package.json`, reporting "no quality gates" for a monorepo, which is the worst possible miss given that the Definition of Done is the one question `/plot-init` insists on; workspace packages are now read too. And the RC checklist cited the wrong test count.

- [#86](https://github.com/plot-pm/plot/pull/86) [`a29b06a`](https://github.com/plot-pm/plot/commit/a29b06a37f4fdd98ba0ecdeb910e117f9284328a) Thanks [@jwloka](https://github.com/jwloka)! - Document the fleet: motivation, a 101 walkthrough, and the design anchored in the manifesto.

  The commands shipped before the prose did. `intro-to-using-plot.md` had promised since long before any of this that "different people, different agents, different worktrees can all work on the same plan in parallel" — a description of something that did not exist yet. It now explains how.

  **Intro** gains _Working several branches at once_: what waves are and why the tracer goes first, why claiming is a `git push` and nothing more, what `/plot-dispatch` does with worktrees and detached workers, how to read the merge queue, and what to do when something goes quiet. Written for someone who knows Plot and is meeting the fleet for the first time.

  **README** gains a _Several agents, one plan_ section stating the case: two questions hand-coordination answers badly, answered without adding a database.

  **MANIFESTO** anchors the design decisions that until now lived only in a plan file and commit messages. Principle 4 gains waves and claim-by-ref as its mechanism — both derived from Principle 1 rather than added alongside it, which is why fleet state is derived and never stored. Pacing gains the sort that is not obvious: watching a fleet is automate-ASAP, fanning one out is human-paced because it commits scope, and merging stays human-paced _even once the order is computed_ — automating the ordering removes guesswork, automating the merge would remove the last review point in a workflow that just multiplied its throughput.

- [#84](https://github.com/plot-pm/plot/pull/84) [`565166a`](https://github.com/plot-pm/plot/commit/565166a5464e7ffc9c76a2172e10e73a1b137e11) Thanks [@jwloka](https://github.com/jwloka)! - End-to-end flow tests for the parallel fleet.

  The unit tests check each fleet script against a hand-built fixture. These five flows check that the scripts actually feed each other on real refs in sandbox repos: a wave-structured plan is read with its waves, `--next` names a branch from it, `plot-dispatch` claims that exact branch, the pulse then reports it as claimed, and the merge queue orders what comes out.

  The wave transition is the part no unit test can reach — "wave 1 merges, wave 2 becomes eligible" is a property of git state changing _between_ two runs of a stateless command, which only a flow test can stage. It was previously verified only by hand.

  Also covered: a second dispatcher cannot steal a claimed branch or duplicate its worktree; the phase gate refuses a Draft plan before anything is created (including when the script is called directly, which is how skill prose gets bypassed); and the merge queue reports a collision against the branch _ahead of it in the queue_ rather than against main, without advancing `origin/main`.

- [#87](https://github.com/plot-pm/plot/pull/87) [`914e12e`](https://github.com/plot-pm/plot/commit/914e12e5ce37357aa0d2aed5637f070cdd0bafa9) Thanks [@jwloka](https://github.com/jwloka)! - Sharpen the fleet's positioning, and make clean pulses the default.

  Re-checking the README against the two designs that shaped the fleet surfaced one real behavioural gap and two weak arguments.

  **Clean pulses are now the norm.** The Lloyd pattern names "silent agent death" as a failure it prevents by logging every heartbeat, including the quiet ones. Plot had the capability behind `--log-pulse` and defaulted it _off_, so an idle fleet and a dead fleet still looked identical. `/plot-fleet` now passes the flag on every run.

  The _script_ still defaults to writing nothing, and that tension is worth naming: `/plot-implement` and `/plot-dispatch` call it internally to ask what to work on, and claiming a branch must never amend a plan as a side effect. So the default lives in the human-facing command rather than the script — both invariants hold, and a test now pins the script's silence.

  **Two arguments were being undersold.** That every step is doable by hand — claiming is `git push`, isolating is `git worktree add` — is Plot's strongest distinction from tools that need an app or a database running, and it was only in the manifesto. And "no database" read as a missing feature rather than the point: an orchestrator needs one when its tickets have no home, whereas Plot's plans _are_ the work table and its branches _are_ the claims.

  **New: a short comparison section**, naming Scape and the Lloyd pattern, what was taken from each, and what was deliberately left out (autonomous merging, agent-to-agent messaging, a general automation layer). Being explicit about the boundary is more useful than implying Plot competes on scale — it competes on how many agents can safely work one reviewed plan.

- [#94](https://github.com/plot-pm/plot/pull/94) [`e4f6338`](https://github.com/plot-pm/plot/commit/e4f633876bc0696c413b52c7ff62baac42fd676f) Thanks [@jwloka](https://github.com/jwloka)! - `--status` tells a finished worker from a crashed one.

  Found by running a real worker for the first time. Every automated test uses `--no-start`, so nothing had ever exercised the path that starts a process — and a worker that completed its job was reported as **`dead`**, which reads as a crash. A user would see a healthy fleet and assume failure.

  `kill -0` can only separate running from not-running; whether a stopped worker succeeded or crashed is gone unless the exit code was recorded. The wrapper now records it, and `--status` reports four states instead of two: **running**, **finished**, **failed (exit N)**, and **ended (status unknown)** for workers started before this existed or killed outright. Unknown stays its own answer — guessing "finished" would be the same mistake in the other direction.

  Two traps surfaced while fixing it, both now pinned by a test that starts an actual process:

  - A `Worker command` ending in `exit 0` terminated the wrapper shell _before_ the exit code could be written. The command now runs in a subshell, so its `exit` confines itself.
  - `$?` inside a double-quoted `sh -c` string was substituted by the _outer_ shell before `sh` ever saw it. The wrapper is single-quoted and the exit-file path travels as an environment variable, so no quoting level can mangle it.

  Also: a pid of `0` read as running forever, because `kill -0 0` signals the caller's whole process group and succeeds.

## 2.0.0

### Major Changes

- [#61](https://github.com/plot-pm/plot/pull/61) [`3712eea`](https://github.com/plot-pm/plot/commit/3712eeae5c4cc831314cb23616394a950af63549) Thanks [@eins78](https://github.com/eins78)! - **Plot 2** — ceremony matched to the plan's weight.

  If plot ever opened a pull request in a repository that never wanted one, this is the release that stops it. Every plan now records two choices — who reviews it, and where the work happens — and plot defaults to the lightest path the repository allows.

  **Ceremony is a recorded choice, not a default.** `/plot-idea` asks two questions and writes the answers into the plan: `Review:` (a pull request, an in-session walkthrough, or an async ballot) and `Impl:` (own branches, the same branch, another repository, or nowhere). Repositories declare their bounds once in `## Plot Config` — `Plan PRs`, `Implementation home`, `Hosts plans`, `Tracker`, `Git host` — and `Plan PRs: never` and `Hosts plans: no` are enforced gates, not guidelines.

  **Approval is no longer a starting gun.** `/plot-approve` only records the approval through the declared channel. Implementation starts when the new `/plot-implement` says so: it checks the plan for staleness, sets up branches per the recorded answers, and writes a hand-off brief so the implementing agent never guesses. The board splits Approved into Ready vs In progress, and a PreToolUse phase gate blocks implementation commits on Draft plans — including the explicit `.plot/hold` review hold.

  **Bitbucket and split-home setups are first-class.** The Git-host adapter `plot-host.sh` (gh/bb) makes every spoke host-neutral, and `plot-impl-status.sh` follows cross-repository `owner/repo#N` references, the `Plan directory` key, and the remote default branch.

  **The companion skills grow a discipline layer.** story-tracking gains a triage front door: the ticket (or an existing story, or a plain plan) is the umbrella until knowledge genuinely overflows it — with named overflow signals, late promotion with guided backfill, and an ask-and-advise stance where the human always has the last word. Add mirror-resistance ("reference, never copy") and one-home-for-narrative rules, a richer status vocabulary, the new `plot-story-lint.sh` for story-estate drift, and `/plot-sprint` declining where an external tracker owns sprints. The "Plot in the Pipeline" doc draws the boundary between plot (plan mechanics) and the skills that write plan content or implement it.

  **Upgrading**: no action required — repositories without posture keys keep the classic behavior, and pre-2.0 plans (without `Review:`/`Impl:`) keep working. Declare `## Plot Config` posture keys when you want the gates. Update with `/plugin update plot`.

  **Validated before release**: a deterministic e2e harness (`pnpm test:e2e`, in CI) drives four full lifecycles in sandbox repositories, and promptfoo eval suites — run against the release candidate before merge — caught two skill-text defects that were fixed in this release.

  <!--
  bumps:
    skills:
      plot: major
      plot-idea: major
      plot-approve: major
      story-tracking: major
      plot-sprint: minor
      plot-deliver: minor
      plot-release: patch
      plot-reconcile: patch
  -->

## 1.8.1

### Patch Changes

- [#59](https://github.com/plot-pm/plot/pull/59) [`bfb66a7`](https://github.com/plot-pm/plot/commit/bfb66a7e14c0dc7b978c5aabe228e9c75b108a35) Thanks [@eins78](https://github.com/eins78)! - story-tracking, plot: two leftover `docs/stories/` hardcodes in instructions

  v1.8.0 made the story directory configurable, but two places still stated the
  old default as fact rather than offering it as a default:

  - `STORY-template.md` told the author to move an archived story to
    `docs/stories/archived/` — wrong in any repo that declares a different
    `Story directory`, which is now the whole point of the key.
  - The `plot` hub skill described stories as living at `docs/stories/{slug}/`.

  Both now name `<story directory>/` and point at the key. No behaviour change;
  the default itself is unchanged.

  <!--
  bumps:
    skills:
      plot: patch
      story-tracking: patch
  -->

## 1.8.0

### Minor Changes

- [#58](https://github.com/plot-pm/plot/pull/58) [`6c36ddf`](https://github.com/plot-pm/plot/commit/6c36ddfc0f6a30b177ef2299d425297f67b15924) Thanks [@eins78](https://github.com/eins78)! - story-tracking resolves its directory from `## Plot Config` instead of
  hardcoding `docs/stories/`, and supports one story home per sub-unit in
  aggregating repos. `Story directory` and `Story index` are now documented in
  Setup — `Story directory` was already read by the board but never listed, so a
  project that configured it got a board and a skill that disagreed about where
  stories live. Story creation names its intended home and confirms before
  creating; archiving derives the home from the story's own path so a sub-unit
  story archives beside itself. The paste-in CLAUDE.md snippet no longer emits a
  hardcoded path.

  <!--
  bumps:
    skills:
      story-tracking: minor
      plot: patch
  -->

- [#48](https://github.com/plot-pm/plot/pull/48) [`649cd17`](https://github.com/plot-pm/plot/commit/649cd17f794d2e1b0ac9baa2937f1b2c28e80f5f) Thanks [@jwloka](https://github.com/jwloka)! - Plan: harden Plot against documented Claude Opus 5 long-horizon failure modes. Bounds the `ralph-plot-sprint` loop (wall-clock budget, per-iteration deliverable checkpoint, ship-partial fallback, heartbeat), bounds `challenge-the-plan` (question budget, material-vs-marginal filter, falsifiable stopping rule), tightens `plot-deliver` gates so subagent claims must cite file-path evidence, states `plot-reconcile` read-only-ness as a design invariant, promotes tracer bullets to the default recommendation in `plot-approve`, adds Manifesto Principle 10 ("an agent that has gone quiet has failed, not finished"), and records model provenance for the skills. Adds three optional `## Plot Config` keys with documented defaults: `Sprint wall clock`, `Sprint stall limit`, `Challenge question budget`.

  <!--
  bumps:
    skills:
      plot: minor
  -->

## 1.7.1

### Patch Changes

- [#46](https://github.com/plot-pm/plot/pull/46) [`075ae62`](https://github.com/plot-pm/plot/commit/075ae62d5310e86695b6da0d1f2fb52230380713) Thanks [@eins78](https://github.com/eins78)! - `plot-config.sh` now falls back to `AGENTS.md` when the repo-root `CLAUDE.md` has no `## Plot Config` section. `CLAUDE.md` is still checked first for backwards compatibility; `AGENTS.md` is the fallback for repos that have migrated to a hub-and-spoke agent-rules layout. ([#45](https://github.com/plot-pm/plot/issues/45), thanks @damoeb)

## 1.7.0

### Minor Changes

- [#40](https://github.com/plot-pm/plot/pull/40) [`21070f0`](https://github.com/plot-pm/plot/commit/21070f054a038f063ec4ba3b1eda329699121271) Thanks [@eins78](https://github.com/eins78)! - Graduate the local Kanban board to a first-class Plot component. The board is now its own TypeScript package (`@plot-pm/board`, vite + react + shadcn + zod) built into a single self-contained artifact the plugin ships; `pnpm board` runs it with no install step. It reads plans through `plot-plan-meta.sh` (so front-matter plans render too), adds multi-select sprint **and** story filters, and its health is part of the Definition of Done, gated in CI.

  <!--
  bumps:
    skills:
      plot: minor
  -->

### Patch Changes

- [#40](https://github.com/plot-pm/plot/pull/40) [`5005532`](https://github.com/plot-pm/plot/commit/50055323aa811f784ddd847ac667c82790f5c456) Thanks [@eins78](https://github.com/eins78)! - Support a project-local plan-template override through the existing config
  mechanism: a `Plan template` key in `## Plot Config`. `/plot-idea` resolves the
  template with `plot-config.sh get "Plan template" skills/plot/templates/plan.md`
  — a project that declares `Plan template:` (a repo-root-relative path) uses its
  own template; otherwise the shipped template is used. Reuses `plot-config.sh`
  (plot's one adopter-config reader) rather than adding a bespoke resolver, so the
  shipped plan template stays generic and projects opt in explicitly.

  <!--
  bumps:
    skills:
      plot: patch
      plot-idea: minor
  -->

- [#40](https://github.com/plot-pm/plot/pull/40) [`8ecc02a`](https://github.com/plot-pm/plot/commit/8ecc02a570e7b42892e82be91a1f9f9da0654528) Thanks [@eins78](https://github.com/eins78)! - Fix `plot-config.sh` to tolerate real-world `## Plot Config` values written as
  backtick-quoted markdown with trailing prose (e.g. `` **Plan directory:** `docs/plans/` (note) ``),
  and multi-value lists whose items are backticked and annotated (e.g. branch
  prefixes) — without truncating the list to its first backtick span. Backticks
  and parenthetical prose are stripped from the extracted value.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#41](https://github.com/plot-pm/plot/pull/41) [`e5d8cf7`](https://github.com/plot-pm/plot/commit/e5d8cf754d816489b861c8fd3c6321aa08443d10) Thanks [@michaelaemisegger](https://github.com/michaelaemisegger)! - Rename the "Open Questions" section to "Open Points" across the planning workflow — the plan and story templates (`plan.md`, `STORY-template.md`, plus story-tracking's SKILL.md reference) and the challenge-the-plan skill, whose tracking section, phase name and container references now read "Open Points". "Open Points" reads as more decisive and action-oriented for an unresolved-items list. Individual deferred _questions_ keep their "question" wording — a deferred question is genuinely a question; it is just filed under the Open Points section.

  <!--
  bumps:
    skills:
      plot: patch
      story-tracking: patch
      challenge-the-plan: patch
  -->

## 1.6.0

### Minor Changes

- [#34](https://github.com/plot-pm/plot/pull/34) [`c138ee4`](https://github.com/plot-pm/plot/commit/c138ee4f3c67e25ba6cae05a86454ec1ce98f064) Thanks [@jwloka](https://github.com/jwloka)! - Add `/plot-reconcile` — a read-only plan/branch reconciliation sweep — plus the shared plan parser and Plot Config accessor it is built on.

  A new spoke command that surfaces drift that per-delivery attention misses and only becomes visible in aggregate: a plan's phase disagreeing with which index dir (`active/` vs `delivered/`) its symlink lives in; an `Approved` plan whose impl branch already merged; merged-but-undeleted branches; and malformed plans (missing phase, front-matter `status:`/`phase:` disagreement).

  - **plot-reconcile** (new skill, v1.0.0) — two-stage Scan→Act command. Stage 1 runs `plot-reconcile-scan.sh`, a deterministic five-section report where each finding carries its exact remediating command as copy-paste text. Stage 2 is the human's judgment on what to run. Read-only by construction — the only writes are `git fetch` and (when unset) the local `origin/HEAD` ref.
  - **plot** (dispatcher) — add `/plot-reconcile` to the spoke command list, plus two new shared helpers all tooling should build on: `plot-plan-meta.sh` (plan metadata as JSON — parses both the canonical `## Status` body format and YAML front matter; the plan-format contract, specified by example in `test/reconcile/`) and `plot-config.sh` (the `## Plot Config` reader).

  Forge-aware: open-PR enumeration binds to the forge of the `origin` remote — `gh` on GitHub, `bb` on Bitbucket — and degrades to git merge-state alone otherwise. The main branch is detected from `origin/HEAD` (override with `- **Main branch:** <name>` in `## Plot Config`); plan directory, indexes, and branch prefixes are read from `## Plot Config` too.

  Proven twice in a downstream monorepo (each run caught genuine drift a human then fixed) before being contributed upstream; contract-tested end-to-end in CI.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#35](https://github.com/plot-pm/plot/pull/35) [`ade7164`](https://github.com/plot-pm/plot/commit/ade7164f325023651a4d89c9c02e02046c97bbb0) Thanks [@eins78](https://github.com/eins78)! - Close the drift loop: `/plot` hygiene line + `/plot-deliver` verification gate.

  - **plot** (dispatcher) — step 1 now runs the reconcile scan and reads its one summary line; when findings exist, the Status Summary gains a single `⚠ N hygiene findings — run /plot-reconcile` line (nothing when clean). To make that ambient-cheap, `plot-plan-meta.sh` parses any number of plan files in one awk pass (measured: 3.4s → 0.6s on a 12-plan repo; the old per-file subprocess chain would have cost ~15s at 90 plans) and the scan parses each plan once, reusing the rows across sections.
  - **plot-reconcile** — the report now ends with a machine-countable summary footer (`summary: drift=… merged_not_delivered=… stale=… attention=… concurrent=… pr_source=… main=…`); the dispatcher hygiene line and the Automation Output read it instead of parsing section bodies.
  - **plot-deliver** — new step 7b: after the delivery push, re-run the reconcile scan and grep for the delivered plan's dated basename. A hit means the delivery half-landed (phase flipped but symlink not moved, or vice versa) — the finding and its fix surface immediately instead of weeks later. Supersedes the opt-in post-deliver nudge idea from [#33](https://github.com/plot-pm/plot/issues/33): a targeted post-condition needs no config key and no prompt.

  <!--
  bumps:
    skills:
      plot: minor
      plot-deliver: minor
      plot-reconcile: patch
  -->

### Patch Changes

- [#37](https://github.com/plot-pm/plot/pull/37) [`68ce035`](https://github.com/plot-pm/plot/commit/68ce035d7b67e8db6f4135552af88853f0786e7b) Thanks [@eins78](https://github.com/eins78)! - Follow-up fixes to the reconcile drift loop ([#34](https://github.com/plot-pm/plot/issues/34)/[#35](https://github.com/plot-pm/plot/issues/35)), from review of the combined set:

  - **plot-deliver** — step 7b recast from a rule into a real gate: progression is gated on the reconcile scan's actual output (the grep result / `summary:` footer), not a self-asserted "Verified" bullet (which was emittable without running the scan). Also `mkdir -p docs/plans/delivered` before the symlink move, so the first-ever delivery in a fresh adopter repo can't half-land.
  - **plot** — the reconcile scan now (1) fails loudly with a `command -v jq` guard instead of silently reporting `drift=0` when jq is absent; (2) routes terminal-state (`Superseded`/`Rejected`) symlinks to the `delivered/` terminal index instead of the wrong `active/` default, and flags a terminal plan still symlinked in `active/` as §1 drift; (3) gains `--no-pr`/`--offline` flags, and the `/plot` hygiene line uses `--offline` so it makes no forge network call (previously `--no-fetch` still ran `gh/bb pr list` on every `/plot`). `pr_source` reports `off` for the deliberate skip.
  - **docs** — `CLAUDE.md` Helper Scripts table lists `plot-plan-meta.sh`, `plot-config.sh`, and `plot-reconcile-scan.sh`.

  <!--
  bumps:
    skills:
      plot: patch
      plot-deliver: patch
      plot-reconcile: patch
  -->

## 1.5.0

### Minor Changes

- [#29](https://github.com/plot-pm/plot/pull/29) [`852d2fc`](https://github.com/plot-pm/plot/commit/852d2fcfe366a931b85bdfb53207700033eaa295) Thanks [@eins78](https://github.com/eins78)! - Address remaining points from plot-pm/plot#1:

  - **plot-approve** — set project-board status to "In Progress" (not "Ready") when the impl PR is created; approved work is actively being implemented. Add a "Finishing an impl branch" subsection so the agent knows to run `gh pr ready <number>` when work is done. Reviewers filter by PR state, not by chat messages.
  - **plot** (dispatcher) — replace the single >7-day "stale drafts" heuristic with two distinct signals: **Completed drafts** (draft PRs with real commits — suggest marking ready) and **Abandoned drafts** (>7 days idle — surface for cleanup).
  - **plot-release** — reframe as a participant in the project's release process, not the driver. Step 4 is now "Hand-off to Project Release Process" — version bump, tag, and push belong to the project's release tooling (changesets, CI, or manual), not to plot-release. Summary no longer frames release mechanics as "what remains" for plot to do.

  <!--
  bumps:
    skills:
      plot-approve: patch
      plot: patch
      plot-release: minor
  -->

## 1.4.0

### Minor Changes

- [#25](https://github.com/plot-pm/plot/pull/25) [`e0d5bcb`](https://github.com/plot-pm/plot/commit/e0d5bcb73fcb668799194c871e6f95bc0a7ab580) Thanks [@eins78](https://github.com/eins78)! - story-tracking: define how to archive a completed story. Adds an "Archiving a Story" section (set `status: done` + `archived:` date, `git mv` the folder into `docs/stories/archived/`, repoint inbound links, update the index) plus a matching `archived:` frontmatter field in the template. Previously the skill had no defined end-of-life step for a story. Ported from quatico-solutions/agent-skills#13, which was stranded by the skill's move to this repo.

  <!--
  bumps:
    skills:
      story-tracking: minor
  -->

## 1.3.0

### Minor Changes

- [#23](https://github.com/plot-pm/plot/pull/23) [`08999f8`](https://github.com/plot-pm/plot/commit/08999f81b484e52a0524059bad72002deb59f222) Thanks [@eins78](https://github.com/eins78)! - New skill: challenge-the-plan — deep plan interrogation via adaptive interviews, adopted from quatico-solutions/agent-skills. The design-phase companion: idea → challenge → optional tracer → approve. Plot's companion pool now covers the full design loop (challenge-the-plan, tracer-bullets) plus long-running tracking (story-tracking).

  Also ships the `/challenge-the-plan` command (`commands/challenge-the-plan.md`) — the plugin's first command.

  No `bumps:` block — the skill is new to this repo and ships at its authored version (1.0.0).

- [#22](https://github.com/plot-pm/plot/pull/22) [`dd3737a`](https://github.com/plot-pm/plot/commit/dd3737a8a370a61902eeb269f5092d53a45b5357) Thanks [@eins78](https://github.com/eins78)! - New skill: story-tracking — multi-session work tracking in markdown folders, adopted from quatico-solutions/agent-skills. Stories are the long-running umbrella (research, decisions, session narrative); plans remain the approved, actionable units — sibling concepts, now one plugin. Cross-plugin references softened (markdown/bye skills now optional mentions); provenance noted in the skill README.

  No `bumps:` block — the skill is new to this repo and ships at its authored version (1.0.0).

- [#20](https://github.com/plot-pm/plot/pull/20) [`aa22711`](https://github.com/plot-pm/plot/commit/aa22711ebf167b0237b7c77deb55d5c8df1f1529) Thanks [@eins78](https://github.com/eins78)! - New skill: tracer-bullets — thin vertical slice strategy, adopted from eins78/agent-skills. It returns home: the skill was designed in the Plot workflow family (part of the pre-split 1.0.0 lineage) and `/plot-approve`, the plan template, and the quickstart already reference it as a sibling. Those references now resolve in-repo. Repo-level docs (README, CLAUDE.md, plot SKILL.md sibling section) updated to reflect bundling.

  No `bumps:` block — the skill is new to this repo and ships at its authored version (1.0.0-beta.1).

### Patch Changes

- [#21](https://github.com/plot-pm/plot/pull/21) [`f33b1ef`](https://github.com/plot-pm/plot/commit/f33b1ef3f8685d029cda4858c33917c75ed182ba) Thanks [@eins78](https://github.com/eins78)! - Repo moved to the plot-pm org: github.com/plot-pm/plot (old eins78/plot URLs redirect). All live references updated — README install instructions, CLAUDE.md, package.json, plugin manifest, changeset changelog config, and `metadata.repo` in every SKILL.md. CHANGELOG and sessionlogs left as historical record.

  <!--
  bumps:
    skills:
      plot: patch
      plot-idea: patch
      plot-approve: patch
      plot-deliver: patch
      plot-reject: patch
      plot-release: patch
      plot-sprint: patch
      ralph-plot-sprint: patch
  -->

## 1.2.0

### Minor Changes

- [#18](https://github.com/eins78/plot/pull/18) [`adc77c7`](https://github.com/eins78/plot/commit/adc77c782ab238822513bb5def9c3d3c0cb48c59) - Add local Kanban status board (`pnpm board`) to the plot skill

  <!--
  bumps:
    skills:
      plot: minor
  -->

## 1.0.1

### Patch Changes

- [#15](https://github.com/eins78/plot/pull/15) [`66c6d6c`](https://github.com/eins78/plot/commit/66c6d6ca6555c80c8114345a8581fb1dee689aca) - Add a narrative tutorial for new users, and clarify how Plot relates to GitHub Issues.

  `skills/plot/intro-to-using-plot.md` is a new second-person walkthrough of the lifecycle (Draft → Approved → Delivered → Released), modeled on [changesets' `intro-to-using-changesets.md`](https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md). It closes the gap between the high-level `README.md` and the AI-facing reference manual in `SKILL.md`. Linked from both.

  The MANIFESTO's "Not an issue tracker" bullet is reframed to match. Previously it said GitHub Issues "overlap and conflict" with Plot. The updated wording keeps the strong stance that Plot replaces issue trackers for _planned implementation work_, while acknowledging that issues remain useful **upstream** of the workflow — as the inbox for external feedback (bug reports, user-submitted feature requests, high-level user stories or business goals) that may eventually become plans. The boundary: issues are signals; plans are commitments.

  <!--
  bumps:
    skills:
      plot: patch
  -->

## 1.0.0

### Minor Changes

- [#9](https://github.com/eins78/plot/pull/9) [`230a981`](https://github.com/eins78/plot/commit/230a98185ac5c7d0d70ee2acb9f4ea5b2d7a9ccb) - `plot-sprint`: detect false-positive completions at close. Step 2 of `/plot-sprint <slug> close` now verifies, for each `[x] [slug]` item, that the referenced plan lives in `docs/plans/delivered/` (not `active/`). If any are still in `active/` or missing, close is blocked until resolved via `/plot-deliver`, unchecking the box, or an explicit override that logs a one-liner reason in `## Notes > ### Scope Changes`. The same flag also surfaces in `/plot-sprint status` so the discrepancy is visible during routine checks. Adds a `## Common Mistakes` section. Closes the gap surfaced in [issue #2 / observation 5](https://github.com/eins78/plot/issues/2#issuecomment-4057881195).

- [#11](https://github.com/eins78/plot/pull/11) [`2da3da9`](https://github.com/eins78/plot/commit/2da3da9fde1ba95e130c49359ea54c08514ce851) - `plot-sprint`: optional PR-aware lifecycle for sprint planning.

  After the initial skeleton lands on main (unchanged), Planning-phase refinement may now optionally happen on a `sprint/<slug>` branch with a draft PR. Use a PR when multiple stakeholders need to review scope, when readiness/deferral decisions deserve their own commits, or when scope conversations benefit from inline comments.

  `/plot-sprint <slug> commit` is now PR-aware:

  - If a `sprint/<slug>` PR exists and isn't merged: bump phase to Committed on the PR branch, push, mark ready, and merge with `--merge` (planning history preserved).
  - Otherwise: direct main commit, unchanged from before.

  Default merge strategy is `--merge` (mirrors `plot-approve` for plan PRs). Squash is explicitly forbidden by default — it collapses readiness/defer/date commits into one and erases reasoning. Adds an entry in the new `## Common Mistakes` section.

  Frontmatter `compatibility:` line and intro paragraph updated to reflect the optional PR path. Closes [issue #2](https://github.com/eins78/plot/issues/2) observations 2, 3, 5, and 6 — the "Theme A: Sprint PR lifecycle" bundle from the plot-skills-improvement plan.

### Patch Changes

- [#10](https://github.com/eins78/plot/pull/10) [`c4a9b6c`](https://github.com/eins78/plot/commit/c4a9b6c47bcee44ae5d66ed28a38a5b8cdf74f71) - `plot-sprint`: make the phase-transition rule explicit, and document multiline create input.

  Renames `## Guardrail` → `## Guardrails` and adds a `### Phase Transitions` sub-section stating that the `Phase` field is updated only by named subcommands (`commit`, `start`, `close`). All other actions — opening a PR, refining items, fixing typos — leave the phase unchanged. Closes the gap behind [issue #2 / observation 1](https://github.com/eins78/plot/issues/2) where "start a PR for the sprint" was misread as `/plot-sprint <slug> start`.

  Also adds a one-paragraph note on multiline `$ARGUMENTS` to the Create step 1 (Parse Input): subsequent lines after the first become the body of `## Sprint Goal`, not the one-line headline. Closes [issue #2 / observation 4](https://github.com/eins78/plot/issues/2).

- [#13](https://github.com/eins78/plot/pull/13) [`93152ad`](https://github.com/eins78/plot/commit/93152adaf631fdc00b20d4765136ac8b987baefc) - Release pipeline cleanups:

  - **CHANGELOG.md**: rename `## 1.0.0` heading to `## 1.0.0 — Initial release (pre-changeset history)` to prevent a duplicate heading when changesets generates the real `## 1.0.0` stable-release entry in the future.
  - **ralph-plot-sprint version drift**: bump `skills/ralph-plot-sprint/SKILL.md` from `1.0.0-beta.2` → `1.0.0-beta.3` to align with the rest of the skill versions (pre-existing drift; no content change).
  - **RELEASING.md**: create release guide with a `## Downstream: plot-marketplace` section documenting the manual post-release step and open questions for the maintainer.

## 1.0.0 — Initial release (pre-changeset history)

### Features

- Add Plot skill: git-native planning workflow with hub-and-spoke architecture
- Add `plot-idea`: create plan branches with plan files and draft PRs
- Add `plot-approve`: merge approved plans and fan out implementation branches
- Add `plot-deliver`: verify implementation PRs and deliver plans
- Add `plot-release`: cut versioned releases with changelogs
- Add `plot-sprint`: time-boxed sprint management with MoSCoW prioritization
- Add `ralph-plot-sprint`: automated sprint runner with shell loop wrapper
- Add `tracer-bullets`: standalone thin-vertical-slice skill with plot integration
- Add MANIFESTO.md: founding principles and design boundaries
- Add helper scripts (`plot-pr-state.sh`, `plot-impl-status.sh`, `plot-review-status.sh`) for structured JSON output
- Add model tier guidance (Haiku/Sonnet/Opus) to all skills and scripts
- Add batch mode, automation output mode, and sprint item annotations
- Add quickstart guide and troubleshooting section
- Externalize plan, sprint, and retrospective templates
- Add review tracking with SHA comparison
- Add self-improvement rules to technical skills

### Bug Fixes

- Fix phase mismatch in `plot-approve` — update phase to Approved on main
- Fix `ralph-sprint` worktree staleness and RC re-tag detection
- Fix CSO violation handling and AUTOMERGE=false stall case in `ralph-plot-sprint`

### Refactoring

- Split plot skills into standalone repo from eins78/skills
- Rewrite CLAUDE.md as Plot-specific contributor guide
- Standardize tooling discovery format, third-person voice, and sync comments
