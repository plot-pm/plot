# Session: Stories Tab Enhancements

**Date:** 2026-08-29
**Duration:** ~2 hours
**Focus:** Sprint modal, story status derivation, topic extraction, markdown rendering

## Accomplished

### Sprint Modal
- Created `SprintModal.tsx` with MoSCoW-grouped members, progress bar, goal display, dates
- Added sprint modal state to `App.tsx` with fallback synthesis for sprints without files
- Added `goal`, `start`, `end` fields to `SprintCardSchema`

### Plan Link Fixes
- Fixed symlink resolution in `workingTreePlans` - tracks entry names so plans via `active/` or `delivered/` symlinks resolve correctly
- Added `rewritePlanLinks` to transform relative markdown links to board routes (both server and client-side)

### Story Status Derivation
- Status now derived from plan phases:
  - All released → archived
  - All delivered → done
  - Any approved → active
  - Otherwise → draft
- Status drift warning when declared status differs from derived

### Tag Cloud Redesign
- Compact pill-style badges with count inside
- Variable sizing based on topic count (small/medium/large)
- Highlighted border for selected tag

### Topic Extraction Improvements
- Domain-focused approach using story slugs and compound terms
- Extensive stop word filtering (generic software terms, common verbs)
- Extracts bigrams and hyphenated compounds
- Filters numeric/noise terms

### Markdown Rendering
- Story card objectives now render `**bold**` and `*italic*` properly

## Files Modified

- `packages/board/src/app/components/SprintModal.tsx` (new)
- `packages/board/src/app/components/StoriesTab.tsx`
- `packages/board/src/app/components/StoryModal.tsx`
- `packages/board/src/app/components/DocModal.tsx`
- `packages/board/src/app/App.tsx`
- `packages/board/src/server/board.ts`
- `packages/board/src/server/topics.ts`
- `packages/board/src/server/index.ts`
- `packages/board/src/contract/schema.ts`
- `packages/board/test/board.test.mjs`
- `.changeset/20260829-sprint-modal.md`

## Commits

- `board: add sprint modal overlay with goal, dates, and MoSCoW members`
- `board: fix plan link resolution for symlinked plans`
- `board: derive story status from plan phases and restyle tag cloud`
- `board: improve topic extraction with domain-focused approach`
- `board: add variable topic sizing and markdown rendering in story cards`
- `chore: update changeset with all Stories tab improvements`

## Pending

- [ ] Consider using NLP library for better topic extraction (blocked by npm registry auth)
- [ ] Review topic quality with more stories in the system

## Notes

- Attempted to use `retext-keywords` for NLP-based topic extraction but blocked by Quatico npm proxy authentication issues
- Pure TypeScript implementation works well for current corpus size
