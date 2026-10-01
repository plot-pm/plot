# Merge subject
The sentence a git host writes on a merge commit, which names the branch that landed.
- Layer: Domain
- Concept status: implemented

## Terms

- **Merge subject** — the subject line of a merge commit on the default branch. A host writes it to a template, so it can be read back.
- **Form** — one host's template, carrying up to three placeholders: `<branch>`, `<owner>` and `<number>`. Every other character is literal text.
- **Refless branch** — a branch with no `origin/<branch>` ref. It means two things at once: never started, or merged with its ref deleted at merge.
- **Age rule** — a subject proves a branch for a plan only when the merge is not contained in the commit that added that plan's file.

## The rule

`mergedBySubject({ subjects, branches, forms, owner })` answers which branch each merge subject names, for the branches asked about.

A subject matches a form as a **whole line**. The branch and the owner match as literal text; the owner is compared without case; the number is one or more digits. An `owner` of `null` matches any owner. An empty form list answers nothing, and so does a form carrying no `<branch>` placeholder — such a form can prove nothing whatever it matches.

It answers **one entry per merge**, not per branch. A name merged twice yields two entries, because which of them predates a plan is decided by an ancestry test the caller runs per pair.

The rule names no host. `ownerOfRemote(url)` is its companion: it answers the account an `https`, `ssh://` or `[user@]host:path` URL names, lowercased, and `null` for a local path or any other shape. One parser, so the scan and the supervisor read one answer.

## The forms live in the adapter

| Backend | Form |
|---|---|
| `github` | `Merge pull request #<number> from <owner>/<branch>` |
| `bitbucket` | `Merged in <branch> (pull request #<number>)` |
| any other | none |

`adapters/host/merge-subjects.ts` holds them as data. A domain rule may not name a vendor — CI greps for it — so the words live in the adapter that already drives those two CLIs, and the rule takes them as a parameter.

A backend with no form proves nothing, and every branch falls through to the host as it does today. Bitbucket Data Center writes `Pull request #N: <title>`, which names a title rather than a branch, so it gets no form rather than a wrong one.

## Positive evidence, in the wave gate only

A subject may only move a refless branch from outstanding to `merged`. Where no subject exists — a squash or rebase merge, a hand-written subject, a branch genuinely never started — the branch keeps the answer it had.

**The ref check stays in front.** A branch with a ref never reaches the subject arm. A name can be reused: merge `bug/flaky`, delete it, recreate it for a second attempt — the first attempt's subject is still on the default branch, and it now describes work that landed while the branch of that name carries work that has not.

## The age rule, and its two limits

A later plan may reuse a merged branch name. A reopened ticket does it on a Jira-keyed estate, and one measured repository holds 87 reused names. So a subject proves a branch for a plan only when `git merge-base --is-ancestor <merge> <added>` is false, where `<added>` is the commit that first added that plan's file.

**The plan file is the dated file, read on `origin/<main>`.** Never the symlink under `active/` or `delivered/`: a delivery moves the symlink as a git rename, so the symlink's adding commit is the delivery commit. Measured on one estate, a delivered plan keeps 4 of 4 subjects through its target and 0 of 4 through its symlink.

**A plan drafted on its own branch keeps a window.** Its adding commit lies on that branch, so the ancestry test excludes only the merges before the branch forked. A reused name merged on the default branch between the fork and the plan's own merge still counts. A first-parent walk would close this window, and it would also exclude the merge of a plan written on the work branch it implements — which sends that plan's own slice to the host. The window is the cheaper error.

**A renamed plan keeps the first add's age.** With git's default rename detection a retitled plan is listed `R` and never `A`, so the walk reads `R` lines in the same call and follows each back to the original `A`. A chain ending in no `A` line inside the walk leaves the plan with no subjects, and its branches go to the host.

A subject refused for age is reported rather than silently dropped: the scan footer counts `subject_predates_plan` and the branch carries `subjectIgnored: "predates-plan"`. A slice with no subject and a slice whose subject was refused both read the same state, and only the second has an explanation.

## The boundary: no destructive decision reads a subject

| Reader | What it does | What holds it |
|---|---|---|
| wave gate, queue | offers the next slice | nothing needed — opening a slice is reversible |
| auto-dispatch | calls an agent free | an agent's branch has a claim ref and never reaches the subject arm |
| auto-delivery | starts a delivery | `allSlicesConfirmed` reads a subject-only branch as `unknown`, so no tick starts one |
| the board's Deliver control | offers a delivery to a person | the same rule, so the control does not offer what the re-gate behind it refuses |
| the plan's status word | renders a word | nothing needed — a status word starts no action |
| reap, ref deletion | removes a desk or a ref | both read the host's `mergedAt` |

`allSlicesConfirmed(meta, pulse, complete)` is `allSlicesMerged`'s answer with one refusal added: a non-deferred branch carrying `evidence: "subject"` makes the answer `unknown`. `unknown` rather than `not-merged`, because the work is probably in and unconfirmed — and `unknown` is what makes a caller wait.

**The fields are declared on the entity or the rule reads nothing.** `BranchSchema` is a plain `z.object` and strips a key it does not declare, so a scan emitting `evidence` against a schema without it would reach the rule with the field gone, the rule would answer as `allSlicesMerged` does, and a test building its pulse as a typed literal would stay green. Both fields are declared, and the tick tests parse their pulses.

## The cost

Three readings per scan, none per plan. The per-plan lookup this replaced cost 6 to 37 ms per plan, 5.23 s for 140 plans.

1. One `git log origin/<main> --diff-filter=AR --name-status --format=@%H -- <plan dir>` for every plan file's adding commit — 0.10 s for 392 plan files.
2. One `git log origin/<main> --merges --max-count=<cap> --format='%H %s'`, the walk the scan already ran, now carrying the hash.
3. One `git merge-base --is-ancestor` per matched pair — 4 ms each, a few calls per scan.

A proven branch costs no host call. The one exception is a delivery candidate — an Approved plan whose every non-deferred branch reads `merged` — and even then the question is put only when `HOST_VERDICT` is `ok` or `partial`, because a question the host is refusing is new spend in exactly the condition this reading exists for.

## What stays held

A merged predecessor is released by its subject, and the next slice is then held on its own branch. An unstarted branch has no PR number and no index row, and a refless branch with no subject may be a squash merge whose ref was deleted — so no host-free answer for it exists. The gain is that one per-branch host answer now releases the next slice, where the whole listing was needed before.
