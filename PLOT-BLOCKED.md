PLOT-BLOCKED: This slice was dispatched before the branch it waits on landed. Should it wait for `feature/the-probe-reads-the-ci-system` to merge and be re-dispatched, or should it be re-sliced so the tracker half ships alone?

## The measurement

The brief states the wait plainly:

> **Waits on:** `feature/the-probe-reads-the-ci-system` — do not start before it lands. The plan says why.
> **AND READ WHAT YOU WAIT ON.** This slice was ordered behind `feature/the-probe-reads-the-ci-system` for a stated reason — a contract it needs, or a shape it should not invent twice. Its PR is the input to yours.

It has not landed, and there is no PR to read:

- `gh pr list --state all --limit 200` — **no PR** on `feature/the-probe-reads-the-ci-system`, open, merged or closed.
- `origin/feature/the-probe-reads-the-ci-system` is at `3b241b80`, whose only commit ahead of `main` is `plot: claim feature/the-probe-reads-the-ci-system`, dated **2026-09-07 22:37:35 +0200**.
- `git show 3b241b80:skills/plot/scripts/plot-detect-repo.sh | grep ci_system` — **no match**. The field does not exist on the branch, nor on `main`.
- `git worktree list` shows the branch checked out at `.worktrees/free-97dece0c`. **Another agent holds it and is working now.**

So the wait did not fail because the upstream slice was abandoned. Both slices were dispatched into the same wave, minutes apart, and this one is the downstream half.

## Why this is not implementable now

The slice's done-when has four clauses. Two depend on a field that does not exist:

> **Done when** a recurring ticket prefix yields a `Tracker:` proposal, **`ci_system` yields a `CI:` proposal**, the evidence is printed with each, the base URL is the one thing asked, and an unattended run reports the gap rather than guessing.

`plot-detect-repo.sh` emits ten fields today — `git_host`, `default_branch`, `dod_candidates`, `ticket_prefix`, `commit_style`, `existing_systems`, `hub_docs`, `has_plot_config`, `has_settings`, `language_hint`. There is no `ci_system` to read.

**Writing the `CI:` proposal now means inventing that field's contract** — its name, whether both signals present is a list or a joined string, what `none` looks like on the wire. The upstream slice settles exactly those, and the plan is specific about the ones that matter:

> **A `Jenkinsfile` IS EVIDENCE AND SO IS `.github/workflows/`.** Both present means a person decides, and the field must say **both were found** rather than picking one.
> **NO EVIDENCE IS `none`, NOT EMPTY.**

Two agents deciding that independently is the *"shape it should not invent twice"* the brief names. Whichever lands second gets rewritten, and if mine lands first the upstream agent writes its probe against a consumer it never saw.

## The judgement I did not make

The tracker half — `ticket_prefix` → `Tracker: jira` + the base-URL ask + the unattended `PLOT-UNASKED` report — **is** implementable today. `ticket_prefix` already works (`plot-detect-repo.sh:79`) and `/plot-init:71` already prints it.

I did not ship that half alone, because the choice is yours and not mine:

- The plan puts both proposals in **one** step-2 proposal block, which `/plot-init` presents as *"a complete proposal ... in one block, so the user corrects rather than composes"*. Splitting it means two agents editing the same block in the same wave — a guaranteed conflict in prose that no rebuild resolves.
- Shipping half a slice against a done-when that names four clauses would leave the plan reading delivered with `CI:` never proposed.

## Two ways forward

1. **Wait and re-dispatch.** Leave this branch claimed; once the upstream PR merges, `/plot-dispatch --restart feature/adoption-proposes-the-stack` hands it to a worker that can read the real `ci_system` contract. Nothing is lost — this branch holds only its claim commit.
2. **Re-slice.** If the tracker half is wanted sooner, `/plot-reslice` can cut it into its own wave ahead of the CI half, and the wave order then states what the branch line currently only implies.

Recommendation: **(1)**. The upstream slice started 22:37 today and is small — one field on one script.

## One thing the plan did not anticipate

The `waits:` annotation is on the slice heading in the plan and is repeated in the brief, and the branch was dispatched anyway, concurrently with what it waits on. Whatever consumed the annotation at dispatch time did not hold it. That is worth a look independently of this slice's outcome — the guard is written, and it did not gate.
