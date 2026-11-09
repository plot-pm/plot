import { describe, expect, it } from 'vitest';
import { storyPlanTableSlugs } from '../src/rules/story-plan-table.js';

const bare = `# Story

## Design

| Name | Note |
|---|---|
| not-a-plan | named in design |

## Candidate Plans

| Candidate plan | Phase |
|---|---|
| process-census-gate | 1 |
| no-tab-no-pulse | 2 |

## Notes

| x | y |
|---|---|
| also-not-a-plan | z |
`;

const linked = `## Plans

| Plan | State |
|------|-------|
| [process-census-gate](../../plans/2026-08-28-process-census-gate.md) | Released |
| [no-tab-no-pulse](../../plans/2026-09-01-no-tab-no-pulse.md) | Delivered |
`;

describe('storyPlanTableSlugs', () => {
  it('reads bare slugs from the table under a heading ending in Plans', () => {
    expect(storyPlanTableSlugs(bare)).toEqual(['process-census-gate', 'no-tab-no-pulse']);
  });

  it('reads the slug out of a link target without its directory and date', () => {
    expect(storyPlanTableSlugs(linked)).toEqual(['process-census-gate', 'no-tab-no-pulse']);
  });

  it('yields the same slugs for both shapes', () => {
    expect(storyPlanTableSlugs(linked)).toEqual(storyPlanTableSlugs(bare));
  });

  it('reads zero slugs where the story has no plan table', () => {
    expect(storyPlanTableSlugs('# S\n\n## Design\n\nsome-slug here\n')).toEqual([]);
  });

  it('skips a first-column cell that names no plan, and a row repeated', () => {
    const text = '## Plans\n\n| Plan | State |\n|---|---|\n| Free text here | x |\n| `a-plan` | x |\n| a-plan | x |\n';
    expect(storyPlanTableSlugs(text)).toEqual(['a-plan']);
  });

  it('ends a table at a blank line and reads the next table as a fresh one', () => {
    const text = '## Plans\n\n| Plan |\n|---|\n| one |\n\n| Plan |\n|---|\n| two |\n';
    expect(storyPlanTableSlugs(text)).toEqual(['one', 'two']);
  });
});
