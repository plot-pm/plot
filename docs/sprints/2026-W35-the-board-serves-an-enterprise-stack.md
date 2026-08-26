# Sprint: The board serves an enterprise stack

> A team on Bitbucket, Jenkins and Jira opens the board and sees the same four
> facts a GitHub team sees: its tickets, its branches, its pull requests and its
> build status. Where the setup cannot be inferred, the setup skill asks.

## Status

- **Phase:** Active
- **Start:** 2026-08-26
- **End:** 2026-09-09
- **Release:** 2.10.0

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

- [ ] [a-jira-ticket-reaches-the-board] `issue-list` and `issue-view` gain a
      `jira` backend, so `Tracker: jira` stops being a key nothing reads. The
      board's ticket inbox is the one section an enterprise team cannot get any
      other way.
- [ ] [a-jenkins-build-has-a-status] Build status resolves through a Jenkins
      path. The probe already finds `jen`, a Jenkinsfile, and the instance —
      `plot-host.sh` has no `jen` reference at all, so the trail ends before the
      board.
- [ ] [a-bitbucket-issue-is-a-ticket] `issue-list`/`issue-view` stop exiting 4
      on Bitbucket. Exit 4 is honest — *cannot be asked* is not *empty* — but a
      team whose tickets live in Bitbucket sees an empty inbox forever.
- [ ] [the-setup-skill-probes-then-asks] `/plot-board-setup` infers git host,
      tracker and CI from real signals and asks only what it cannot settle,
      writing every answer into `## Plot Config`. It currently asks and refuses
      well, but infers less than the repo already reveals.

### Should Have

- [ ] [the-pr-list-join-is-silently] The Bitbucket 50-per-state page cap
      (issue #333). Past 50 PRs the join is silently partial and a branch reads
      *no PR* — the fabricated verdict the scan refuses everywhere else. A plan
      exists in **PR #408** — unmerged, so `docs/plans/` on main does not carry
      it yet — with two open questions its interrogation must settle.
- [ ] [an-unreachable-host-is-not-an-answer] A host that cannot be reached must
      not read as a host with nothing to say. Draft plan on main; the enterprise
      stack multiplies the ways a call can fail.

### Could Have

- [ ] [the-worktrees-live-in-one-place] Worktrees under a configurable root.
      Interrogated twice, Draft, unrelated to the enterprise stack but ready.
- [ ] [a-closed-sprint-says-what-it-achieved] Closing reconciles the tally
      against plan phases. Written today after two closed sprints were found
      understating their own results.

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
