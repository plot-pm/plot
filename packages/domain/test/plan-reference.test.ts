import { describe, it, expect } from 'vitest';
import { planIndexOf, planRefOfRow, planReference, planRoute, planRouteOfDocLink, type PlanIndex } from '../src/rules/plan-reference.js';

describe('planRoute', () => {
  it('routes to /plan/<basename> from a repo-relative plan path', () => {
    expect(planRoute('docs/plans/2026-07-12-foo.md')).toBe('/plan/2026-07-12-foo.md');
  });

  it('uses only the basename regardless of nesting (e.g. active/ symlinks)', () => {
    expect(planRoute('docs/plans/active/bar.md')).toBe('/plan/bar.md');
  });

  it('percent-encodes unusual characters in the basename', () => {
    expect(planRoute('docs/plans/a b&c.md')).toBe('/plan/a%20b%26c.md');
  });

  it('extracts the basename from a Windows-separator path', () => {
    // card.path uses the OS separator (path.relative); on Windows that is a
    // backslash. Splitting only on '/' would leave the whole path as the
    // "basename" and produce a broken /plan/docs%5Cplans%5C... URL.
    expect(planRoute('docs\\plans\\2026-07-12-foo.md')).toBe('/plan/2026-07-12-foo.md');
  });
});

describe('planRouteOfDocLink', () => {
  it('rewrites a relative plan link to its board route, dropping the date prefix', () => {
    expect(planRouteOfDocLink('../../plans/2026-08-16-slug.md')).toBe('/plan/slug.md');
  });

  it('rewrites a relative story link to its board route', () => {
    expect(planRouteOfDocLink('../stories/a-story/STORY-a-story.md')).toBe('/story/a-story');
  });

  it('passes any other link through unchanged', () => {
    expect(planRouteOfDocLink('https://x/y')).toBe('https://x/y');
  });
});

describe('the plan row label', () => {
  // Moved verbatim from packages/board/test/unit/a-plan-row-names-its-ticket.test.ts:84-99.
  const facts = { plan: 'a-plan', planFile: '2026-09-30-a-plan.md', phase: 'Development', waitingDays: null };

  it('prefixes the keys the way the ticket row prints them', () => {
    expect(planReference({ slug: facts.plan, file: facts.planFile, issues: ['1089'] }, planIndexOf({})).label).toBe('1089: a-plan');
    expect(planReference({ slug: facts.plan, file: facts.planFile, issues: ['1090', '1091'] }, planIndexOf({})).label).toBe('1090, 1091: a-plan');
    expect(planReference({ slug: facts.plan, file: facts.planFile, issues: ['EWZKUS-3430'] }, planIndexOf({})).label).toBe('EWZKUS-3430: a-plan');
  });

  it('prints the slug alone where the plan names no issue', () => {
    expect(planReference({ slug: facts.plan, file: facts.planFile, issues: [] }, planIndexOf({})).label).toBe('a-plan');
  });

  it('keeps the link on the plan', () => {
    expect(planReference({ slug: facts.plan, file: facts.planFile, issues: ['1089'] }, planIndexOf({})).href).toBe('/plan/2026-09-30-a-plan.md');
  });
});

describe('planReference', () => {
  it('shows no prefix where the plan has no issues', () => {
    expect(planReference({ slug: 'a' }, planIndexOf({})).label).toBe('a');
  });

  it('prefixes one key', () => {
    expect(planReference({ slug: 'a', issues: ['1089'] }, planIndexOf({})).label).toBe('1089: a');
  });

  it('prefixes three keys, as GitHub numbers and a Jira key are stored', () => {
    const answer = planReference({ slug: 'a', issues: [1085, '1086', '#1101'] }, planIndexOf({}));
    expect(answer.label).toBe('1085, 1086, 1101: a');
    expect(answer.issues).toEqual(['1085', '1086', '1101']);
  });

  it('prefixes a bare Jira key as stored', () => {
    expect(planReference({ slug: 'a', issues: ['EWZKUS-3430'] }, planIndexOf({})).label).toBe('EWZKUS-3430: a');
  });

  it('drops blank and duplicate keys, keeping the first occurrence', () => {
    expect(planReference({ slug: 'a', issues: ['1090', '', '1090'] }, planIndexOf({})).issues).toEqual(['1090']);
  });

  it('lets the index entry win over the reference\'s own issues', () => {
    const index = planIndexOf({ cards: [{ slug: 'a', title: '', path: 'a.md', issues: ['2'] }] });
    expect(planReference({ slug: 'a', issues: ['1'] }, index).label).toBe('2: a');
  });

  it('resolves a draft plan with no card by its slug', () => {
    const index = planIndexOf({
      drafts: [{ plan: 'a', planFile: 'a.md', title: '', issues: ['7'] }],
    });
    const answer = planReference({ slug: 'a' }, index);
    expect(answer.label).toBe('7: a');
    expect(answer.href).toBe('/plan/a.md');
  });

  it('resolves a reference naming only a slug through the card already in the index', () => {
    const index = planIndexOf({ cards: [{ slug: 'a', title: '', path: 'docs/plans/2026-07-12-a.md', issues: [] }] });
    expect(planReference({ slug: 'a' }, index).href).toBe('/plan/2026-07-12-a.md');
  });

  it('links from its own file before the index resolves anything', () => {
    const answer = planReference({ file: 'gone.md' }, planIndexOf({}));
    expect(answer.label).toBe('gone');
    expect(answer.href).toBe('/plan/gone.md');
    expect(answer.exists).toBe(true);
  });

  it('answers no link where nothing resolves', () => {
    const answer = planReference({ slug: 'gone', issues: ['5'] }, planIndexOf({}));
    expect(answer.label).toBe('5: gone');
    expect(answer.href).toBeNull();
    expect(answer.exists).toBe(false);
  });

  it('shows the inferred plan on an issue row: its issue prefix, and no link', () => {
    const answer = planReference({ slug: '<inferred name>', issues: ['42'] }, planIndexOf({}));
    expect(answer.label).toBe('42: <inferred name>');
    expect(answer.href).toBeNull();
  });

  it('builds an index from cards, drafts and fleet plans together, keyed by basename and by slug', () => {
    const index: PlanIndex = planIndexOf({
      cards: [{ slug: 'card-plan', title: 'Card title', path: 'docs/plans/card-plan.md', issues: ['1'] }],
      drafts: [{ plan: 'draft-plan', planFile: 'draft-plan.md', title: 'Draft title', issues: ['2'] }],
      fleetPlans: { 'fleet-plan': { file: 'fleet-plan.md', issues: ['3'] } },
    });
    expect(planReference({ slug: 'card-plan' }, index).title).toBe('Card title');
    expect(planReference({ file: 'draft-plan.md' }, index).title).toBe('Draft title');
    expect(planReference({ slug: 'fleet-plan' }, index).issues).toEqual(['3']);
  });

  it('answers an empty slug for a reference naming neither file nor slug and resolving no index entry', () => {
    const answer = planReference({ issues: ['9'] }, planIndexOf({}));
    expect(answer.label).toBe('9: ');
    expect(answer.href).toBeNull();
  });

  it('does not index a card or draft under an unnamed file or slug', () => {
    const index = planIndexOf({
      cards: [{ slug: '', title: 'No slug', path: 'docs/plans/no-slug.md', issues: [] }],
      drafts: [{ plan: 'draft-no-file', planFile: '', title: 'No file', issues: [] }],
    });
    expect(planReference({ slug: '' }, index).title).toBe('');
    expect(planReference({ file: 'no-slug.md' }, index).title).toBe('No slug');
    expect(planReference({ slug: 'draft-no-file' }, index).title).toBe('No file');
  });
});

describe('planRefOfRow', () => {
  it('names a row that already carries its plan directly', () => {
    const ref = planRefOfRow({ kind: 'branch', branch: 'feature/x', plan: 'a', planFile: 'a.md' });
    expect(ref).toEqual({ file: 'a.md', slug: 'a' });
  });

  it('reads the slug from the branch of an idea row the scan has not reached yet', () => {
    const ref = planRefOfRow({ kind: 'plan', branch: 'idea/a', plan: '', planFile: '' });
    expect(ref).toEqual({ slug: 'a' });
  });

  it('resolves that reference through the index once a draft card names the same slug', () => {
    const index = planIndexOf({
      cards: [{ slug: 'a', title: 'A', path: 'docs/plans/2026-11-01-a.md', issues: ['7'] }],
    });
    const ref = planRefOfRow({ kind: 'plan', branch: 'idea/a', plan: '', planFile: '' });
    expect(ref).not.toBeNull();
    const answer = planReference(ref!, index);
    expect(answer.label).toBe('7: a');
    expect(answer.href).toBe('/plan/2026-11-01-a.md');
  });

  it('answers null for a non-plan row that names no plan', () => {
    expect(planRefOfRow({ kind: 'branch', branch: 'feature/x', plan: '', planFile: '' })).toBeNull();
  });
});
