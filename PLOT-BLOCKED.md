PLOT-BLOCKED: The branch this slice waits on has not landed — should it be dispatched first, or should this slice proceed against an unwritten `ci_system` field?

## The wait is unmet

The brief states: **"Waits on: `feature/the-probe-reads-the-ci-system` — do not start before it lands."**

Measured on this worktree, 2026-09-08, against `origin/main` at `7e119591`:

| Fact | Measurement |
|---|---|
| `ci_system` in `plot-detect-repo.sh` on main | absent — `grep -c ci_system` returns `0` |
| `feature/the-probe-reads-the-ci-system` remote ref | does not exist (`git ls-remote origin` finds no such head) |
| Its PR | none open; PR #811 is the **old** merge the plan itself names as carrying zero files |
| `feature/a-probe-reports-and-the-domain-judges` (which that slice in turn waits on) | claim commit `872e2228` only, zero file diff against main |
| `proposeStack` in `packages/domain/src` | does not exist |

So the chain is unstarted at every link, not merely unmerged at the last one.

## Why this slice cannot honestly proceed

**This slice's first done-when clause names the missing field.** *"Adoption proposes `Jenkins instance` wherever it proposes `CI: jenkins`"* — and `CI: jenkins` is proposed from `ci_system`, which no code emits. The prose could be written against the specification, but that is precisely the defect this plan was filed to fix: `skills/plot-init/README.md:206` already records one inert proposal reading a field the probe does not report, and the plan's Motivation calls the resulting tests *"fifteen green tests over a feature that does not exist"*. Adding a second proposal in the same condition reproduces the bug rather than the fix.

**The upstream slice is contracted to rewrite the file my tests belong in.** Its done-when reads: *"the three prose-matching `ci_system` tests are gone and their replacements run the script."* Those three tests are `test/reconcile/init-stack.test.mjs:83`, `:96` and `:111` — the CI block where a `Jenkins instance` test would sit. Writing into that block now guarantees a conflict with a rewrite whose shape is already specified.

**The field's shape is still being settled upstream.** The plan reversed it once during interrogation: `ci_system` carries `{jenkinsfile, gh_workflows, reading}` in the slice body, while its own done-when says *"emits `ci_system` as booleans alone — the word is `proposeStack`'s"*. Which of those lands decides how this slice reads *"wherever it proposes `CI: jenkins`"*. Guessing costs the round the interrogation paid for.

**The plan already priced this wait and accepted it.** *"THE COST IS THAT JENKINS ADOPTION WAITS ON A REFACTOR, which is a real price and worth naming. It is paid because the alternative writes `ci_system` twice into the file with the most readers in the adoption path."*

## What is genuinely independent, if you want it split

One clause needs no upstream work: **reading a Jenkins instance slug from the repository.** The plan's measurement — `quaweb-website`'s README carrying `jenkins-ci-webbloqs.internal.quatico.dev` — is a new probe field that does not touch `ci_system`, `proposeStack`, or the CI test block. It could ship as its own slice. It is **not** what this branch is scoped to, and the brief forbids widening, so it is named here rather than built.

## The question

Choose one:

1. **Dispatch the chain first** — `a-probe-reports-and-the-domain-judges`, then `the-probe-reads-the-ci-system`, then restart this branch. This is what the plan's own ordering asks for.
2. **Reslice** — split the slug-reading clause into a slice with no wait, and leave the `CI: jenkins` coupling for after the probe lands.
3. **Override the wait** — if the `ci_system` shape is settled and you want the prose written against the specification now, say which shape landed (booleans alone, or booleans plus `reading`) and this slice will proceed against it.

Nothing was written on this branch. No files changed, no tests added, no PR opened.
