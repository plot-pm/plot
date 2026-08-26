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

### Half of this is already built, and the plan was wrong to imply otherwise

**Measured 2026-08-26.** `/plot-board-setup` step 2 is called *"Propose, then
confirm"*, and it already does:

> *Detected: Node 24 · git root is the CWD · plugin artifact · `docs/plans/`
> with 7 plans · host `github`, `gh` authenticated · `jen` installed,
> `Jenkinsfile` present, Jenkins token missing.*
> *Proposed: … Add `CI: jenkins` and `Jenkins instance: apps` to Plot Config.*

It presents one block the user corrects rather than composes, and asks only what
the probe could not answer. Git host, CI and Jenkins instance are all handled.

**`Tracker` appears ZERO times in the entire skill.** That is the real gap, and
it is exactly the key this sprint's Jira backend will read.

So wave 1 is **Tracker plus an audit**, not a rebuild. The audit matters because
the existing inferences were written for a GitHub-shaped repo and this sprint's
population is not one: a Bitbucket remote and a Jira-tracked estate are cases
nobody has run this skill against.

### A wrong Tracker is as dangerous as a wrong Jenkins slug

The skill already refuses to guess a Jenkins instance when unattended, and its
reason is precise:

> `jen -I <bogus> auth status` prints `Keycloak: signed in` and exits 0, so a
> guessed slug buys a green light that verifies nothing.

**`Tracker` has the same shape.** A wrong `Tracker: jira` sends `issue-list` to
the wrong system, which answers — with an empty list. The board then renders an
empty inbox, which reads as *you have no tickets*: the exact failure the story
`the-board-is-blank-where-it-matters` is named for, caused by the tool meant to
prevent it.

So `Tracker` inherits the Jenkins rule verbatim: **infer only from structural
signals, and when unattended, refuse rather than guess.** No key is better than
a wrong key, and this is the second field where that is demonstrably true.

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

### Two signals is a question, not a tie-break

A repo can carry a `Jenkinsfile` **and** `.github/workflows/`, and many
migrating teams carry both for months. `plot-board-probe.sh` already reports
them as two independent booleans — `ci_signals: {jenkinsfile, gh_workflows}` —
so the ambiguity is representable today, not hypothetical.

Where both are true, setup **does not propose**. It asks, and names what it
found:

> *Found a `Jenkinsfile` and 3 workflow files. Which runs your PRs?*

That is the inference doing its job: it narrows an open question to a two-option
choice with the evidence attached. A reader confirms in one keystroke and knows
why they were asked.

**Preferring the git host's CI was rejected** — GitHub remote means Actions,
Bitbucket means Jenkins. It is wrong for exactly the team this sprint is for: a
team on GitHub running Jenkins is common, and a silent wrong answer here writes
a `CI:` key that sends every build-status lookup to the wrong system.

This is the general rule for every inferred field, not a special case for CI:
**one signal proposes, two signals ask.**

### Not chosen: infer a tracker from commit messages

Tempting — Jira keys in the log are a strong signal. Rejected as unmeasured: a
`PROJ-123` in a commit message may be a coincidence, a quoted upstream issue, or
a different tracker entirely. The origin URL and the Jenkinsfile are structural;
a commit message is prose. Structural signals only, until someone measures the
prose one.

## Waves

### Proposed (Branch: feature/setup-proposes-what-it-found)

Setup proposes the **Tracker** — the one key it never mentions today — and the
existing host/CI proposals are **audited against this sprint's population**: a
Bitbucket remote, a Jira-tracked repo, a repo with both CI signals. Nothing is
assumed working because it works on a GitHub-shaped repo.

### Warned (Branch: feature/setup-names-an-unread-key)

A written key with no consumer is recorded with a warning naming the gap.

## Done when

1. **In a repo with a Bitbucket origin and a Jenkinsfile, setup proposes
   `bitbucket` and `jenkins` rather than asking open questions.**
1b. **In a repo with BOTH a Jenkinsfile and `.github/workflows/`, setup asks
   which runs the PRs, and names both signals.** It does not tie-break on the
   git host: a team on GitHub running Jenkins is common, and guessing writes a
   `CI:` key that points every build lookup at the wrong system.
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
6. **A wrong Tracker is refused, not guessed, when unattended.** Same rule the
   skill already applies to a Jenkins instance, and for the same reason: the
   wrong tracker answers with an empty list, and an empty inbox reads as *you
   have no tickets*.
7. **The existing host and CI proposals are asserted against a Bitbucket remote
   and a Jenkinsfile**, not only against this repo's shape. They were written
   for a GitHub-shaped repo and this sprint's population is not one.
8. `pnpm test` green.

## Notes

### Open Points

- [ ] Is a Jira key in commit messages a usable signal? Rejected here as
      unmeasured; worth measuring on a real customer repo before revisiting.

### Interrogated 2026-08-26

One round, on what happens when the repo answers twice.

A `Jenkinsfile` and `.github/workflows/` can both exist, and the probe already
reports them as independent booleans — so the ambiguity is representable today.
The rule that came out of it is general rather than CI-specific: **one signal
proposes, two signals ask.** Tie-breaking on the git host was rejected because it
is wrong for precisely this sprint's population, a team on GitHub running
Jenkins, and it would be wrong silently.

### Interrogated again 2026-08-26

Round two read the skill instead of the plan, and found the plan overstated the
work.

`/plot-board-setup` step 2 is already *"Propose, then confirm"* — it presents a
detected/proposed block and asks only what the probe could not answer, for git
host, CI and the Jenkins instance. **`Tracker` appears zero times in the skill.**
That is the gap, and it is the key this sprint's Jira backend reads. Wave 1
narrows to Tracker plus an audit of the existing inferences against a Bitbucket
remote and a Jira-tracked repo — cases the skill has never been run on.

The second answer imported a rule the skill had already derived elsewhere. It
refuses to guess a Jenkins instance because a bogus slug prints *"signed in"*
and exits 0 — a green light that verifies nothing. A wrong `Tracker` is the same
shape: the wrong system answers, with an empty list, and the board renders an
empty inbox reading as *you have no tickets*. So Tracker inherits the refusal
verbatim.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 2,
  "questionHistory": [
    {
      "q": "What if a repo has both a Jenkinsfile and workflows?",
      "a": "Ask, naming both \u2014 one signal proposes, two signals ask; tie-breaking on the git host is silently wrong for GitHub+Jenkins teams",
      "category": "ux"
    },
    {
      "q": "What is wave 1 actually for, given propose-then-confirm already exists?",
      "a": "Tracker (zero mentions in the skill) plus an audit of the existing host/CI inferences against a Bitbucket/Jira repo",
      "category": "technical"
    },
    {
      "q": "Does a wrong Tracker carry the Jenkins slug's danger?",
      "a": "Yes \u2014 it answers with an empty list, and an empty inbox reads as 'you have no tickets'; refuse rather than guess when unattended",
      "category": "domain"
    }
  ],
  "deferredItems": [
    {
      "q": "Is a Jira key in commit messages a usable signal?",
      "category": "technical",
      "context": "Not chosen"
    }
  ],
  "categoriesCovered": {
    "technical": {
      "stack": false,
      "architecture": true,
      "implementation": false
    },
    "domain": true,
    "ux": {
      "happyPath": true,
      "edgeCases": true,
      "errors": false,
      "accessibility": false
    },
    "nonFunctional": {
      "security": false,
      "performance": false,
      "scalability": false
    },
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
