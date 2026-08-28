# Sprint: The board serves an enterprise stack

> A team on Bitbucket, Jenkins and Jira opens the board and sees the same four
> facts a GitHub team sees: its tickets, its branches, its pull requests and its
> build status. Where the setup cannot be inferred, the setup skill asks.

## Status

- **Phase:** Active
- **Start:** 2026-08-26
- **End:** 2026-09-09
- **Release:** 2.11.0

## Sprint Goal

**Every origin the board renders has a working backend for the enterprise stack.**

Measured on `main` 2026-08-26, per operation in `plot-host.sh`:

```
                 github      bitbucket
pr-state           ✓            ✓
pr-create          ✓            ✓
pr-merge           ✓            ✓
pr-list            ✓            ✓  (capped at 50/state — silently)
pr-body            ✓            ✓
issue-list         ✓          exit 4
issue-view         ✓          exit 4
build status       ✓  (gh check rollup)   NOTHING
```

Two findings shaped this sprint, and both cut against the obvious framing:

**Bitbucket is not broken for pull requests.** Five of seven PR operations
already work. The gap is narrower and sharper than "Bitbucket support" —
it is tickets, build status, and one silent truncation.

**Jenkins and Jira are half-built, and the half that exists is the probe.**
`plot-board-probe.sh` detects the `jen` CLI, a Jenkinsfile and its auth state;
`plot-config.sh` documents `Tracker: jira`, `CI: jenkins` and `Jenkins
instance`. But `plot-host.sh` contains **zero** references to `jen`, and nothing
in the board reads a Jenkins build status. The configuration is asked for,
recorded, and never consumed — which is worse than absent, because it reads as
supported.

## MoSCoW

Each Must Have blocks an enterprise user outright: without it the board shows a
GitHub team a fact and an enterprise team a blank.

### Must Have

Stories: [[the-board-is-blank-where-it-matters]] (the first three),
[[setup-asks-what-the-repo-already-knows]] (the fourth).

- [x] [my-jira-tickets-are-in-the-inbox] My Jira tickets appear in the board's inbox, so I can turn one into a plan without leaving the board <!-- status: delivered -->
      `jira` backend, so `Tracker: jira` stops being a key nothing reads. The
      board's ticket inbox is the one section an enterprise team cannot get any
      other way.
- [x] [i-can-see-whether-my-build-passed] I can see whether my build passed, from the board, without opening Jenkins <!-- status: delivered -->
      path. The probe already finds `jen`, a Jenkinsfile, and the instance —
      `plot-host.sh` has no `jen` reference at all, so the trail ends before the
      board.
- [ ] [my-bitbucket-issues-are-in-the-inbox] My Bitbucket issues appear in the inbox instead of an empty section that reads as *you have no tickets*
      on Bitbucket. Exit 4 is honest — *cannot be asked* is not *empty* — but a
      team whose tickets live in Bitbucket sees an empty inbox forever.
- [ ] [setup-tells-me-what-it-found] Setup tells me what it found in my repo and asks only what it could not work out — and never records a key nothing reads
      tracker and CI from real signals and asks only what it cannot settle,
      writing every answer into `## Plot Config`. It currently asks and refuses
      well, but infers less than the repo already reveals.

### Should Have

Story: [[the-board-is-blank-where-it-matters]].

- [ ] [the-board-says-how-old-its-plans-are] The board reports how far behind
      its checkout is. Measured 2026-08-26: the board worktree fell 33 commits
      behind, was pulled, and gained 23 more in one session — rendering
      `Phase: Draft` for plans approved minutes earlier. Its two halves have
      different sources: the scan reads `origin/main`, the plan cards read the
      working tree, and nothing pulls it.
- [ ] [a-dead-fetch-is-not-a-slow-one] The doc viewers bound their fetch. A
      request killed by the board's own `node --watch` restart neither resolves
      nor rejects, so the panel shows "Loading…" forever while its correct error
      branch never fires.
- [ ] [the-adapter-checks-the-cli-it-got] A `bb` too old for the flags Plot
      passes makes every Bitbucket PR read as *no PR*. Measured 2026-08-26:
      homebrew's `bb` 0.6.0 has no `--json` and shadows 1.0.0 on PATH, the
      error goes to `/dev/null`, and `jq` exits 0. Blocks the plan below —
      truncation detection is meaningless while the adapter reaches nothing.
- [ ] [the-pr-list-join-is-silently] The Bitbucket 50-per-state page cap
      (issue #333). Past 50 PRs the join is silently partial and a branch reads
      *no PR* — the fabricated verdict the scan refuses everywhere else. A plan
      exists in **PR #408** — unmerged, so `docs/plans/` on main does not carry
      it yet — with two open questions its interrogation must settle.
- [ ] [an-unreachable-host-is-not-an-answer] A host that cannot be reached must
      not read as a host with nothing to say. Draft plan on main; the enterprise
      stack multiplies the ways a call can fail.
- [ ] [a-degraded-scan-says-why] `/plot-reconcile` reported `pr_source=degraded`
      — *no git-host CLI available* — with `bb` installed, authenticated and
      correct; the call had returned HTTP 429. Twelve branches were listed as
      orphans, **nine of them heads of open PRs**, each with a command inviting
      deletion. The sibling above fixes `plot-host.sh`; the scan calls `gh`/`bb`
      directly and is not reached by it. Measured 2026-08-26 on
      `quatico/ewz-leg`.

- [ ] [a-dispatch-hands-over-a-brief] A board **Start work** hands the worker its
      brief. The `Worker command`'s first instruction is to read it, and a
      dispatch that starts without one sends an agent to re-derive settled
      decisions — the race this sprint lost four times in one day.
- [ ] [the-budget-is-spent-where-it-is-needed] GraphQL sits at 0/5000 while REST
      is untouched at 4999/5000. The board asks the host the same question
      through the exhausted bucket. Directly relevant to the enterprise stack,
      where a 429 already broke every `bb` call on this machine.
- [ ] [a-claimed-branch-is-not-startable] Auto-dispatch spends its budget only on
      branches a dispatch can claim. **Was filed against W34, which has closed**
      — moved here rather than left orphaned in a finished timebox.

### Could Have

- [ ] [the-header-names-the-branch-it-is-serving] The Master Agent row names the branch the board is serving, instead of rendering blank where a fact belongs
- [ ] [a-folded-row-still-says-what-matters] A folded head carries its tally and says what is live
- [ ] [the-plan-the-board-holds] The row carries the plan's own records rather than re-deriving them
- [x] [the-page-is-as-tall-as-the-screen] Every board scrolls by 13px whatever it contains <!-- status: closed not-a-defect, 2026-08-26 -->
      **No change shipped.** Measured against the running board: the wrapper
      starts at the document origin and overflow is exactly 0 at any viewport
      that holds the content. The 13px was the board's own rows at a viewport
      too short for them.
- [ ] [loose-checks-what-it-promises] `--loose` verifies green rather than not-draft
- [ ] [the-worktrees-live-in-one-place] Worktrees under a configurable root.
      Interrogated twice, Draft, unrelated to the enterprise stack but ready.
- [ ] [a-closed-sprint-says-what-it-achieved] Closing reconciles the tally
      against plan phases. Written today after two closed sprints were found
      understating their own results.

- [ ] [a-citation-is-not-a-claim] `## Branches` cites other plans' branches to
      declare dependencies, and the parser reads every backticked name as a
      branch to dispatch. A prose mention becomes a work item.
- [ ] [a-branch-with-work-is-visible] A branch carrying real work is visible to
      the fleet rather than filtered out of it.
- [ ] [a-ticket-becomes-a-plan-or-a-story] A ticket gets one of two treatments —
      `/plot-idea` for a plan, `/story-tracking` for a story — from the board,
      where the operator already is.
- [ ] [the-plan-file-states-what-the-board-shows] A plan states its interrogation
      rounds in `## Status`, where every other lifecycle fact lives. Measured
      today: the parser reads `rounds` ONLY from the challenge metadata block, so
      the Status field is decorative.
- [ ] [release-candidate-publishing] The board package publishes to npm when a
      release candidate is cut, and at no other time; the per-push prerelease job
      is removed.

## Notes

### Why these four and not "Bitbucket support"

The obvious sprint would have been *make Bitbucket work*. Measuring first showed
that framing to be wrong: the PR operations already work, and the real gaps sit
in three different places — one backend that exits 4, one that does not exist,
and one config key with no consumer. Naming them separately is what lets each be
finished rather than perpetually two-thirds done.

### The setup skill is a Must, not a Should

It is tempting to treat `/plot-board-setup` as polish that follows the backends.
It does not: a backend nobody can configure is a backend nobody uses, and the
current skill records `Tracker: jira` for a tracker no code reads. The setup
skill and the backends are the same feature seen from two ends.

### Six Coulds against three Musts

Worth naming rather than leaving as an accident of arithmetic. The Musts are
what this sprint is FOR — an enterprise team seeing its tickets and its builds.
The six Coulds are ready work that had nowhere else to sit: four deferred when
the last sprint closed early on its release, two written along the way.

That is a legitimate shape for a sprint with a clear subject and a healthy
backlog, and it is also the shape that most easily loses its subject. If
capacity gets spent bottom-up, this sprint delivers six board improvements and
no enterprise support — which would satisfy the tally and miss the point. The
Musts are the gate; the Coulds are what a spare agent picks up.

### What this sprint does not claim

Nothing here makes Plot *multi-host at once*. A repo has one git host, one
tracker, one CI. Serving an enterprise stack means each of those can be the
enterprise choice — not that a plan can span GitHub and Bitbucket.

### Five of the eight have no plan yet

Deliberate. A sprint opens by naming what it is for; `/plot-idea` writes the
plans. The three that DO have plans on main — `an-unreachable-host-is-not-an-answer`,
`the-worktrees-live-in-one-place` and `a-closed-sprint-says-what-it-achieved` —
were already Draft and are pulled in rather than rewritten.

`the-pr-list-join-is-silently` is the exception worth watching: its plan exists
only on PR #408, so the sprint names a slug `docs/plans/` cannot resolve until
that merges. The reconcile scan will report it as sprint drift, correctly.

### Scope Changes

- 2026-08-26: **the-page-is-as-tall-as-the-screen** closed as not-a-defect.
  Its premise (a 13px wrapper offset) was falsified by measurement; the wave is
  retired unbuilt and the plan kept as the record.

- 2026-08-26: **my-bitbucket-issues-are-in-the-inbox** moved back Should → Must,
  hours after being demoted. The demotion argued it might be moot — its own first
  Done-when was *establish whether `bb` can list issues at all*. Round 2 ran that
  check: **`bb` 0.6.0 has `issue list` and `issue view`**, so the adapter's
  *"bb exposes none"* is stale, not principled, and a Bitbucket team with its
  tracker enabled is blocked today by a refusal that stopped being true.

- 2026-08-26: pulled in the **four Could Haves deferred when
  `the-board-tells-the-truth-in-every-section` closed**. Each is a Draft plan
  with no ref pushed — nothing was started, so nothing was lost — and each was
  deferred because that sprint closed on its release seven days early, not
  because the work was judged unnecessary. They keep the Could tier here: they
  are ready, they are not what this sprint is FOR, and a sprint whose Coulds
  outnumber its Musts should say so rather than pretend they are the subject.

- 2026-08-26: **my-bitbucket-issues-are-in-the-inbox** moved Must → Should
  during interrogation. Its own plan says it may correctly deliver nothing — its
  first Done-when is a measurement of whether `bb` or the API can list issues at
  all — and most Bitbucket teams track in Jira and never enable the tracker. A
  Must that might close as *the refusal was right* is mis-tiered; the Jira plan
  already serves the population that matters.

- 2026-08-26: retargeted from **2.10.0** to **2.11.0** before any work started.
  Four changesets were already merged on main — the changeset package-name
  guard, both waves of `Rounds:` in `## Status`, and the sprint-filter fix — and
  one is a `minor`, so they compute to 2.10.0 and cannot ship as a patch. The
  sprint's target was a claim about the future with no work behind it yet, which
  makes it the cheap side to move.
