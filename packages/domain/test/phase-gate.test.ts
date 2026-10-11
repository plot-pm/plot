import { describe, expect, it } from 'vitest';

import {
  holdRefusal,
  implementationPrefixesOf,
  isPlanFileFor,
  outsidePlanDir,
  outsideReviewArtifacts,
  phaseGateRefusal,
  phaseWordOf,
  planPathFor,
  planPhaseOf,
  slugOfBranch,
  unpushedPlanNote,
  unreadableRefNote,
} from '../src/rules/phase-gate.js';

const homes = { planDir: 'docs/plans', storyDir: 'docs/stories' };
const doc = (state: string): string => `# P\n\n## Status\n\n- **State:** ${state}\n`;

describe('phaseWordOf', () => {
  it.each([
    ['Draft', 'draft'],
    ['**Design**', 'design'],
    ['Approved — 2026-10-10', 'approved'],
    ['ready-for-review', 'approved'],
    ['in-review', 'approved'],
    ['Released', 'released'],
  ])('reads %j as %s', (raw, phase) => {
    expect(phaseWordOf(raw)).toBe(phase);
  });

  it('answers null where no word is known', () => {
    expect(phaseWordOf('Planned')).toBeNull();
    expect(phaseWordOf('')).toBeNull();
  });
});

describe('planPhaseOf', () => {
  it('reads the State line in ## Status', () => {
    expect(planPhaseOf(doc('Draft'))).toBe('draft');
    expect(planPhaseOf(doc('Design'))).toBe('design');
  });

  it('reads front-matter status, which wins over phase', () => {
    expect(planPhaseOf('---\nphase: draft\nstatus: Approved\n---\n# P\n')).toBe('approved');
    expect(planPhaseOf('---\nphase: "Draft"\n---\n# P\n')).toBe('draft');
  });

  it('keeps the first of a repeated key', () => {
    expect(planPhaseOf('---\nstatus: Draft\nstatus: Approved\nphase: Released\nphase: Design\n---\n')).toBe('draft');
    expect(planPhaseOf('---\nphase: Design\nphase: Approved\n---\n')).toBe('design');
  });

  it('answers null for a plan that names no phase', () => {
    expect(planPhaseOf('# P\n\nno status\n')).toBeNull();
  });
});

describe('branch and slug', () => {
  it('drops idea from the configured prefixes', () => {
    expect(implementationPrefixesOf('idea/, feature/, bug/')).toEqual(['feature', 'bug']);
  });

  it('falls back to the four implementation prefixes', () => {
    expect(implementationPrefixesOf('idea/')).toEqual(['feature', 'bug', 'docs', 'infra']);
  });

  it('cuts the slug after the first slash and gates nothing else', () => {
    const prefixes = implementationPrefixesOf('idea/, feature/, bug/');
    expect(slugOfBranch('feature/a-b', prefixes)).toBe('a-b');
    expect(slugOfBranch('idea/a-b', prefixes)).toBeNull();
    expect(slugOfBranch('main', prefixes)).toBeNull();
    expect(slugOfBranch('feature-x/a', prefixes)).toBeNull();
  });
});

describe('plan file match', () => {
  it('matches the dated basename by equality', () => {
    expect(isPlanFileFor('2026-10-10-the-slug.md', 'the-slug')).toBe(true);
  });

  it('does not match a longer slug that begins with the branch slug', () => {
    expect(isPlanFileFor('2026-10-10-the-slug-two.md', 'the-slug')).toBe(false);
  });

  it('treats a regex character in the slug as literal', () => {
    expect(isPlanFileFor('2026-10-10-axb.md', 'a.b')).toBe(false);
    expect(isPlanFileFor('2026-10-10-a.b.md', 'a.b')).toBe(true);
  });

  it('finds the plan by directory and basename', () => {
    const paths = ['docs/plans/2026-10-10-x-y.md', 'other/2026-10-10-x.md', 'docs/plans/2026-10-11-x.md'];
    expect(planPathFor(paths, 'docs/plans/', 'x')).toBe('docs/plans/2026-10-11-x.md');
    expect(planPathFor(paths, 'docs/plans', 'z')).toBeNull();
  });
});

describe('outsideReviewArtifacts', () => {
  it.each([
    ['docs/plans/2026-10-10-x.md', false],
    ['docs/stories/s/README.md', false],
    ['.plot/briefs/x.md', false],
    ['clients/acme/stories/s/README.md', false],
    ['src/a.ts', true],
    ['docs/other.md', true],
  ])('%s outside = %s', (path, outside) => {
    expect(outsideReviewArtifacts(path, homes)).toBe(outside);
  });
});

describe('holdRefusal', () => {
  const base = { branch: 'feature/x', paths: ['src/a.ts'], ...homes };

  it('refuses a held branch and carries the reason', () => {
    const out = holdRefusal({ ...base, hold: 'feature/x waiting on legal\n' });
    expect(out).toContain("branch 'feature/x' is under an explicit review hold (.plot/hold): waiting on legal");
  });

  it('says no reason was recorded for a bare entry', () => {
    expect(holdRefusal({ ...base, hold: 'feature/x' })).toContain('no reason recorded');
  });

  it('compares the first field by equality, not as a pattern', () => {
    expect(holdRefusal({ ...base, hold: 'feature/.* reason' })).toBeNull();
    expect(holdRefusal({ ...base, hold: 'feature/xy reason' })).toBeNull();
  });

  it('passes with no hold or with only plan paths', () => {
    expect(holdRefusal({ ...base, hold: null })).toBeNull();
    expect(holdRefusal({ ...base, hold: 'feature/x r', paths: ['docs/plans/2026-10-10-x.md'] })).toBeNull();
  });
});

describe('phaseGateRefusal', () => {
  const base = { branch: 'feature/x', slug: 'x', ref: 'origin/main', paths: ['src/a.ts'], ...homes };

  it('names Draft and Design as read', () => {
    expect(phaseGateRefusal({ ...base, phase: 'draft' })).toContain('still Draft on origin/main');
    expect(phaseGateRefusal({ ...base, phase: 'design' })).toContain('still Design on origin/main');
    expect(phaseGateRefusal({ ...base, phase: 'draft' })).toContain('/plot-approve x');
  });

  it.each(['approved', 'delivered', 'released', null] as const)('allows phase %s', (phase) => {
    expect(phaseGateRefusal({ ...base, phase })).toBeNull();
  });

  it('allows a commit carrying only plan-directory paths', () => {
    const paths = ['docs/plans/2026-10-10-x.md', 'docs/plans/active/x.md'];
    expect(phaseGateRefusal({ ...base, phase: 'draft', paths })).toBeNull();
  });

  it.each([
    'docs/stories/s/README.md',
    '.plot/notes.md',
    'clients/acme/stories/x.md',
    'epics/e/x.md',
  ])('refuses a Draft commit carrying only %s', (path) => {
    expect(phaseGateRefusal({ ...base, phase: 'draft', paths: [path] })).toContain('still Draft');
  });
});

describe('outsidePlanDir', () => {
  it('passes only the plan directory, with or without a trailing slash', () => {
    expect(outsidePlanDir('docs/plans/a.md', 'docs/plans/')).toBe(false);
    expect(outsidePlanDir('docs/plans/a.md', 'docs/plans')).toBe(false);
    expect(outsidePlanDir('docs/plansx/a.md', 'docs/plans')).toBe(true);
    expect(outsidePlanDir('docs/stories/s/a.md', 'docs/plans')).toBe(true);
  });
});

describe('notes', () => {
  it('name the ref and the remedy', () => {
    expect(unpushedPlanNote('x', 'origin/main', 'feature/x')).toContain('origin/feature/x');
    expect(unreadableRefNote('origin/main')).toContain('git fetch');
  });
});
