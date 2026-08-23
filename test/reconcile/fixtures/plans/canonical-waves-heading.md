# Plan with wave-heading branches

> The new shape: `## Waves`, and each wave heading names its branch and PR.
> The line below the heading keeps the work — meta and content no longer share
> a sentence. One heading, one wave, one branch.

## Status

- **Phase:** Approved
- **Type:** feature
- **Review:** pr
- **Impl:** own branches

## Waves

### Tracer (Branch: feature/thin-slice, PR: #10)
- proves the seam. A description may cite `feature/not-a-branch` in prose and
  it must NOT become a branch — the heading is the only source. → #999 in prose
  is not a PR either.

### Implementation (Branch: feature/api, PR: #11)
- endpoint + schema

### Deferred one (Branch: feature/dropped) <!-- deferred: covered by feature/api -->
- not needed after all

### Wave four (Branch: feature/migration)
- backfill, needs api landed, no PR yet

## Notes

Nothing here should affect wave parsing.
