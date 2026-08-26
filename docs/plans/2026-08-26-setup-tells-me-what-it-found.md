# Setup tells me what it found

> `/plot-board-setup` reads what the repo already reveals, proposes it, and asks
> only what it could not work out — and never records a key nothing reads.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** the-board-serves-an-enterprise-stack
- **Issue:** <!-- optional -->
- **Story:** setup-asks-what-the-repo-already-knows
- **Review:** in-session
- **Impl:** own branches
- **Approved:** <!-- YYYY-MM-DD, who, channel -->
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

- `/plot-board-setup` proposes the git host, tracker and CI it inferred from the
  repo, asks only what it could not infer, and warns when a key it writes has no
  backend yet.

## Motivation

A user runs setup in a repo with a Bitbucket remote, a `Jenkinsfile` at the
root, and Jira keys in the commit log. It asks them which git host, which
tracker, which CI.

Then it records `Tracker: jira`, and **nothing reads that key**. The board looks
configured and behaves unconfigured, so the reasonable conclusion is *I set it
up wrong*.

### The signals already exist and are already read

- `plot-detect-repo.sh` derives `git_host` from origin's URL
- `plot-board-probe.sh` reports `ci_signals.jenkinsfile`, and whether `gh`, `bb`
  and `jen` are installed and authenticated

They are reported and never turned into proposals. This is closer to wiring than
to research.

## Design

### Infer, propose, confirm — never assert

Every inferred value is a **proposal a human confirms**, the rule
`plot-detect-repo.sh` already states about its own output: *"every field is a
proposal a human confirms."*

Inferring and asking are not alternatives. The inference is what turns three
questions into one keystroke — *"Bitbucket, Jenkins, Jira — right?"* — rather
than removing the question.

### The skill already refuses well

Worth keeping and not rebuilding. It carries explicit `PLOT-UNASKED` lines for
the unattended case, e.g. *"which Jenkins instance — refused — no Jenkins
instance key written; jen auth unverified"*. It refuses rather than guessing.
The gap is inference, not manners.

### A key with no backend must say so

During this sprint `Tracker: jira` is writable before it is readable. Three
options were considered:

- **Refuse to write it** — blocks the configuration the backends need
- **Write it silently** — recreates today's failure exactly
- **Write it with a warning that names the gap** — chosen

The warning is the honest form: the key is what the backend will read, and
saying *"recorded; no backend reads this yet"* is a fact about Plot's state, not
about the user's repo.

### Not chosen: infer a tracker from commit messages

Tempting — Jira keys in the log are a strong signal. Rejected as unmeasured: a
`PROJ-123` in a commit message may be a coincidence, a quoted upstream issue, or
a different tracker entirely. The origin URL and the Jenkinsfile are structural;
a commit message is prose. Structural signals only, until someone measures the
prose one.

## Waves

### Proposed (Branch: feature/setup-proposes-what-it-found)

Setup infers git host, tracker and CI from the structural signals the probes
already report, presents them as one confirmation, and asks only for what it
could not infer.

### Warned (Branch: feature/setup-names-an-unread-key)

A written key with no consumer is recorded with a warning naming the gap.

## Done when

1. **In a repo with a Bitbucket origin and a Jenkinsfile, setup proposes
   `bitbucket` and `jenkins` rather than asking open questions.**
2. **Every proposal is confirmable and overridable.** Nothing is written that
   the user did not see.
3. **What cannot be inferred is still asked** — the Jira instance, the tracker
   where no structural signal exists. Inference narrows the questions; it does
   not remove them.
4. **A key with no backend is written with a warning that names it.** Asserted
   on `Tracker: jira` while its backend is unbuilt.
5. **The unattended path still refuses rather than guessing.** The existing
   `PLOT-UNASKED` lines still fire, and inference does not become a licence to
   assume under `PLOT_UNATTENDED=1`.
6. `pnpm test` green.

## Notes

### Open Points

- [ ] Is a Jira key in commit messages a usable signal? Rejected here as
      unmeasured; worth measuring on a real customer repo before revisiting.
