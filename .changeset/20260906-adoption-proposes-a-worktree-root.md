---
'plot': minor
---

Adoption proposes where dispatched desks live, and writes the `.gitignore` line that comes with it. Measured 2026-09-06: `plot-init` named `Worktree root` **zero times** and `.gitignore` **zero times**, so an adopting repository got the layout without being told, without the ignore rule, and without a chance to choose otherwise — and a dispatched agent's desk became untracked work in the repository root until somebody noticed, one `git add -A` away from staging a whole checkout.

The key and the line are **one decision**, confirmed together and written together. Either half alone is worse than neither: the key moves desks inside the repository, and the line is what keeps them out of `git status`. With no key at all, dispatch uses the repository's PARENT with a `plot-wt-` prefix, so this proposal changes where desks go — which is the reason to make it rather than leave the default implicit.

**`.gitignore` is a file adoption has never touched**, and the skill says so plainly: appended, never rewritten, created only where absent, and never printed for a human to paste. Printing it is how a repository ends up with desks as untracked files, which is the defect rather than the fix — and a directory and a plan skeleton are larger commitments that adoption already writes.

It stays a proposal. `plot-init`'s rule is *propose, don't interrogate*, so the skill reads `git worktree list` first: a repository whose worktrees already live somewhere keeps that arrangement and the ignore line follows it. Relocating is `/plot-dispatch --migrate`'s job, on a person's say. An absolute root lies outside the repository and gets no ignore line at all, rather than one matching nothing.

The desk's own `.git/info/exclude` rule is untouched. It is per-clone because a rule living in branch content is invisible to a worktree cut from an older branch, and it belongs to `plot-dispatch.sh`.

<!--
bumps:
  skills:
    plot-init: minor
-->
