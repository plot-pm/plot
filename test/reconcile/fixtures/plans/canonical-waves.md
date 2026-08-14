# Plan with wave-grouped branches

> Waves express which branches may run concurrently: a wave is eligible when
> every non-deferred branch in every prior wave has a merged PR.

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
- `feature/ui` — form and validation <!-- claimed: 2026-08-14T10:22Z, session-3 -->
- `feature/dropped` — not needed after all <!-- deferred: covered by feature/api -->

### Wave 3
- `feature/migration` — backfill, needs api landed
- `feature/wrapped` — a long description that wraps onto
  the next line <!-- deferred: annotation on a continuation line does NOT count -->

## Notes

Nothing here should affect wave parsing.
