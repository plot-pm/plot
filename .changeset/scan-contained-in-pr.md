---
"plot": patch
---

`plot-reconcile-scan.sh` tells *contained in an open PR* apart from *orphaned*.

Section 3 asked one question about open PRs — is this branch the **head** of one? A branch sitting below the head of an open PR answered no and fell through to `else`, which calls it an orphan. Stacked work is ordinary, so the section described perfectly live branches as abandoned: on plot's own repo seven of eight `stale=` entries were the `opus5-hardening` branches, all ancestors of the head of PR #57. That is enough false noise to make a person stop reading the section, which costs the true finding hiding among them.

The scan now also asks whether an unmerged branch is an ancestor of any open PR's head. A hit is reported in its own block and does **not** count toward `stale=`:

```
  -- contained in an open PR (work in flight, not stale) --
  origin/feature/stack-base — contained in open PR #200 → not orphaned
```

Printing rather than staying silent keeps the section honest about what it examined and rejected — a scan that quietly drops findings is the defect this whole plan was written to fix.

Two ordering constraints, both load-bearing and both easy to get backwards.

**The claim check comes first**, and the obvious justification for that is wrong. An empty claim is an ancestor of *nothing*: its claim commit puts it one commit **ahead** of the branch point, so the ancestry runs the other way. The real case is the reverse — once a worker builds on its claim, the claim commit becomes part of the working branch, which is typically the head of the PR it opens. Such a claim is legitimately contained in an open PR, and must still be reported as a **claim**, because that is the more specific fact. Inverting the two silently drops `claims=` to zero.

**Containment is only asked for unmerged branches.** A merged branch is an ancestor of the main branch, and therefore of every open PR branched from it; asking before the merged check would swallow the entire deletion-candidate class.

The open-PR list now carries each PR's number alongside its head branch, since the report names the PR a branch is contained in. That rides along on the bundled call already being made — still one `--state open` call per run, one extra JSON field.

Cost is one `git merge-base` per candidate per open PR, bounded by branches × open PRs, and only reached by branches that already failed the head test. Where PR state is unavailable (`--offline`, `--no-pr`, or no host CLI) there is no list to test against, so containment is skipped rather than guessed and the branch keeps its previous verdict.

<!--
bumps:
  skills:
    plot: patch
    plot-reconcile: patch
-->
