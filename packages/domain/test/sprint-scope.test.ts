import { describe, it, expect } from 'vitest';
import { sprintScope, planSlug, type FleetReading } from '../src/index.js';

/**
 * `sprintScope` tested at the domain boundary — fed sprint texts and a fleet
 * pulse directly, never a ref or a path. The adapter test
 * (`sprint-scope-ref.test.ts`) covers the git-reading half.
 */

const SPRINT = (body: string) => `# Sprint: Reviewing slice PRs

## Status

- **State:** Active
- **Start:** 2026-10-29
- **End:** 2026-11-05
- **Release:** 2.30.0

## Sprint Goal

**fleetd reviews every slice PR it can.**

### Must Have

${body}
`;

const slice = (name: string, branches: string[]) => ({
  name,
  verdict: 'complete' as const,
  branches: branches.map((branch) => ({
    branch,
    state: 'merged' as const,
    deferred: false,
    deferred_reason: '',
    claimed: '',
    local_dirty: false,
    local_worktree: '',
  })),
});

const pulse = (plans: Array<{ file: string; slices: ReturnType<typeof slice>[] }>): FleetReading =>
  ({
    main: 'main',
    head: 'abc1234',
    plans: plans.map(({ file, slices }) => ({ file, phase: '', tracer: false, slices, unreadBranchItems: [] })),
    summary: { plans: plans.length, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
  }) as unknown as FleetReading;

describe('sprintScope — zero or many active sprints', () => {
  it('answers none with no-active-sprint for zero sprint texts', () => {
    expect(sprintScope({ sprintTexts: [], pulse: null, planSlug })).toEqual({
      read: 'none',
      why: 'no-active-sprint',
    });
  });

  it('answers none with multiple-active-sprints for two or more sprint texts', () => {
    const texts = [
      { content: SPRINT('- [ ] [a-plan](../plans/2026-10-01-a-plan.md) — does a thing'), slug: 'one' },
      { content: SPRINT('- [ ] [b-plan](../plans/2026-10-01-b-plan.md) — does another thing'), slug: 'two' },
    ];
    expect(sprintScope({ sprintTexts: texts, pulse: null, planSlug })).toEqual({
      read: 'none',
      why: 'multiple-active-sprints',
    });
  });
});

describe('sprintScope — struck items drop out', () => {
  it('excludes a struck slug while an unstruck sibling remains in scope', () => {
    const content = SPRINT(
      [
        '- [ ] [a-kept-plan](../plans/2026-10-01-a-kept-plan.md) — stays in scope',
        '- [x] ~~[a-dropped-plan](../plans/2026-10-01-a-dropped-plan.md)~~ — withdrawn',
      ].join('\n'),
    );
    const result = sprintScope({
      sprintTexts: [{ content, slug: 'the-sprint' }],
      pulse: null,
      planSlug,
    });
    expect(result.read).toBe('scope');
    if (result.read !== 'scope') throw new Error('unreachable');
    expect(result.slugs).toContain('a-kept-plan');
    expect(result.slugs).not.toContain('a-dropped-plan');
  });

  it('answers none with no-unstruck-items when every item is struck', () => {
    const content = SPRINT('- [x] ~~[a-dropped-plan](../plans/2026-10-01-a-dropped-plan.md)~~ — withdrawn');
    expect(
      sprintScope({ sprintTexts: [{ content, slug: 'the-sprint' }], pulse: null, planSlug }),
    ).toEqual({ read: 'none', why: 'no-unstruck-items' });
  });

  it('answers none with no-unstruck-items when the sprint names no items at all', () => {
    const content = SPRINT('');
    expect(
      sprintScope({ sprintTexts: [{ content, slug: 'the-sprint' }], pulse: null, planSlug }),
    ).toEqual({ read: 'none', why: 'no-unstruck-items' });
  });
});

describe('sprintScope — the branch map goes through the pulse', () => {
  const content = SPRINT('- [ ] [a-plan](../plans/2026-10-01-a-plan.md) — in scope');

  it('names the branches a scope plan carries in the pulse', () => {
    const reading = pulse([
      { file: '2026-10-01-a-plan.md', slices: [slice('Only slice', ['feature/a-branch'])] },
    ]);
    const result = sprintScope({ sprintTexts: [{ content, slug: 'the-sprint' }], pulse: reading, planSlug });
    expect(result.read).toBe('scope');
    if (result.read !== 'scope') throw new Error('unreachable');
    expect(result.slugs).toEqual(['a-plan']);
    expect(result.branches).toEqual(['feature/a-branch']);
  });

  it('omits a branch the pulse does not carry even though its plan is in scope', () => {
    // The plan's slug is in scope, but this slice has not been dispatched yet
    // — the pulse carries no branches for it, so none are in scope either.
    const reading = pulse([{ file: '2026-10-01-a-plan.md', slices: [] }]);
    const result = sprintScope({ sprintTexts: [{ content, slug: 'the-sprint' }], pulse: reading, planSlug });
    expect(result.read).toBe('scope');
    if (result.read !== 'scope') throw new Error('unreachable');
    expect(result.slugs).toEqual(['a-plan']);
    expect(result.branches).toEqual([]);
  });

  it('ignores a pulse plan whose slug the sprint does not name', () => {
    const reading = pulse([
      { file: '2026-10-01-a-plan.md', slices: [slice('In scope', ['feature/a-branch'])] },
      { file: '2026-10-01-an-unrelated-plan.md', slices: [slice('Not in scope', ['feature/other'])] },
    ]);
    const result = sprintScope({ sprintTexts: [{ content, slug: 'the-sprint' }], pulse: reading, planSlug });
    expect(result.read).toBe('scope');
    if (result.read !== 'scope') throw new Error('unreachable');
    expect(result.branches).toEqual(['feature/a-branch']);
  });

  it('answers no branches when there is no pulse at all', () => {
    const result = sprintScope({ sprintTexts: [{ content, slug: 'the-sprint' }], pulse: null, planSlug });
    expect(result.read).toBe('scope');
    if (result.read !== 'scope') throw new Error('unreachable');
    expect(result.branches).toEqual([]);
  });
});
