## Implementation brief — a-worker-prompt-has-a-template (slice: The prompt template Plot never shipped)

- **Plan (canonical):** `docs/plans/2026-09-05-a-second-slice-needs-its-own-session.md` on `main`
- **Branch:** `bug/a-worker-prompt-has-a-template` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

Slice 2 of two. **Blocked until `bug/a-second-slice-needs-its-own-session` merges** — the template ships the invocation that slice defines, so writing it first would ship the wrong file.

## The gap

**Measured 2026-09-05: `find skills -name '*worker-prompt*'` returns nothing.**

`.plot/worker-prompt.sh` is invoked on every prompt of every agent — `plot-worker-loop.sh:1000` sources it — and Plot ships no template, no generator and no example for it. Every adopting project writes it from prose, and the prose it follows is a comment inside the loop.

**This bug is what that costs.** A rule written once in a docstring, implemented once by hand, wrong on the second slice, and invisible until three agents stalled simultaneously.

## What to build

### `plot-init` writes the file from a shipped template

**The pattern already exists.** `skills/plot-init/SKILL.md:129` copies a **Plan template** into `.plot/templates/plan.md`, and the `Plan template` config key makes it overridable. The worker prompt takes the same shape: shipped, copied on adoption, overridable by any project wanting different wording.

**A TEMPLATE IS A GATE; DOCUMENTATION IS NOT.** CLAUDE.md's test — *can you answer "did I complete this?" without doing the work?* — is answered **yes** by a documented migration and **no** by a file that is either present or absent.

### The template carries wording, not logic

**No session decision lives in it.** Slice 1 puts that in the loop, which exports a finished flag; the template interpolates it and states nothing about resuming. That is what keeps this slice about distribution rather than about the rule — and why a project rewriting its prompt wholesale still cannot reintroduce the bug.

**Plot does not own the wording.** `plot-worker-loop.sh:19` settles that the prompt file belongs to the project. A starting point is not ownership: what the agent is *told* stays the project's, and only the invocation is Plot's.

### An existing file is OFFERED the update, never given it

**`plot-init` proposes rather than imposes** — its own guiding rule is *"propose, don't interrogate"* (`SKILL.md:23`), and `plot-detect-repo.sh`'s every field is *"a proposal a human confirms."* So it detects an out-of-date prompt and offers the template, leaving the operator's wording theirs to keep.

**A release note would not have reached this repo.** The prompt file here was written by hand, has been edited twice since, and would have gone on passing `--session-id` until a second slice failed again. Detection at adoption is where the mismatch is visible.

## Testing

`pnpm test` validates that every skill parses. A test that `plot-init` writes the file in a fresh repository, and that it does not overwrite an existing one, is the pair worth having.

Gates: `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`.

## Done when

- `plot-init` writes `.plot/worker-prompt.sh` in a fresh repository
- it offers the update where one already exists, and overwrites nothing
- the template contains no session decision of its own
- this repo's copy handles a second slice
- the gates above pass

## Do not

- **Do not start before slice 1 merges.** The template ships the invocation that slice defines.
- **Do not put session logic in the template.** The loop decides; the template interpolates.
- **Do not overwrite an existing `.plot/worker-prompt.sh`.** Offer it. A project's prompt wording is the project's.
- **Do not hardcode this repo's prompt as the template.** Ours carries 1,400 characters of project-specific instruction — CLAUDE.md rules, test discipline, PR conventions. The template is a starting point, not a copy of this estate.
- **Do not run `pnpm run test:e2e`** locally. CI is its gate.
