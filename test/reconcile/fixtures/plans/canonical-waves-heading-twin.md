# Plan with wave-heading branches

> The OLD shape twin of canonical-waves-heading.md: `## Branches`, the branch in
> the list line. Both must parse to byte-identical branches/prs/waves JSON —
> that identity is what makes wave 3's migration provably a re-spelling.

## Status

- **Phase:** Approved
- **Type:** feature
- **Review:** pr
- **Impl:** own branches

## Branches

### Tracer
- `feature/thin-slice` — proves the seam → #10

### Implementation
- `feature/api` — endpoint + schema → #11

### Deferred one
- `feature/dropped` — not needed after all <!-- deferred: covered by feature/api -->

### Wave four
- `feature/migration` — backfill, needs api landed, no PR yet

## Notes

Nothing here should affect wave parsing.
