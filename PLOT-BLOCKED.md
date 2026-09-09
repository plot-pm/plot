PLOT-BLOCKED: `ci_scheme()` is not on `main` — slice 1 has not landed. Dispatch slice 1 (`bug/the-ci-key-splits-into-scheme-and-instance`) and restart this branch after it merges, or confirm the intended order changed.

## The dependency the brief names

`.plot/briefs/the-ci-callers-match-the-scheme.md` states it as a stop condition:

> **IT WAITS FOR `bug/the-ci-key-splits-into-scheme-and-instance`.** That slice
> writes `ci_scheme()`; this one moves every caller onto it and deletes
> `ci_backend()`. [...] If `ci_scheme()` is not on `main` yet, write
> `PLOT-BLOCKED.md` naming what is missing and stop — do not write the function
> yourself.

## What is missing

`ci_scheme()` and `ci_instance()` in `skills/plot/scripts/plot-host.sh`. This
slice moves four call sites onto `ci_scheme()` and deletes `ci_backend()`; with
no `ci_scheme()` to call, every call site would break.

## Measured 2026-09-09

Three readings, three angles, one answer:

| reading | command | result |
|---|---|---|
| `origin/main` | `git show origin/main:skills/plot/scripts/plot-host.sh \| grep -n 'ci_scheme\|ci_instance\|ci_backend'` | `548:ci_backend()` and its four callers at `:2417`, `:2692`, `:2794`, `:3336`. No `ci_scheme`, no `ci_instance`. |
| slice 1's branch | `git log --oneline origin/main..origin/bug/the-ci-key-splits-into-scheme-and-instance` | one commit, `92c44d2f3 plot: claim …`; `git diff --stat origin/main...` prints **nothing**. The ref is a claim marker, not work. |
| slice 1's PR | `plot-host.sh pr-state bug/the-ci-key-splits-into-scheme-and-instance` | `{"number":0,"state":"NONE",...}` — no PR was ever opened. |

**Every remote branch was swept**, not just the two named: `git grep 'ci_scheme()'` over `origin/<branch>` for all heads returns **zero hits**. So the work has not merged under another branch name — the case where re-implementing here would revert a sibling's landed work is ruled out.

## Why this slice cannot proceed under any assumption

Writing `ci_scheme()` here is the one move the brief forbids by name, and its
scope guard repeats it: *"Slice 1 owns `ci_scheme()` and `ci_instance()`
themselves."* Slice 1 carries four asserted behaviours this slice neither
specifies nor tests — `ci_scheme()` returning `jenkins` for all four real
spellings, `ci_instance()` returning a host or nothing and never a prose
fragment, the `Jenkins instance` config key winning over `CI:` prose, and
`$JENKINS_INSTANCE` winning over both. A second implementation written from
this brief would be an undeclared duplicate of a rule, which
`docs/shell-and-domain.md` treats as the defect rather than the workaround.

Nothing in this slice's scope is separable: all four call sites and the
`budget.ts:15` citation reference the function that does not exist yet. There is
no partial delivery to leave behind, so this branch has no commits.

## To clear it

1. Dispatch and merge `bug/the-ci-key-splits-into-scheme-and-instance`.
2. Restart this branch. It rebases onto `main` and proceeds — the brief's
   step-1 check (`ci_scheme()` present) then passes.
3. Delete this file as part of that run.

Plan: `docs/plans/2026-09-09-the-ci-key-carries-its-instance.md`
