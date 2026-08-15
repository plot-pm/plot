# plot

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
