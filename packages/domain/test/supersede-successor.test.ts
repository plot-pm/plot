import { describe, expect, it } from 'vitest';
import {
  repositoryOfRemote,
  successorCandidates,
  successorEntry,
  successorHere,
  successorName,
  successorPreconditions,
  successorReference,
  supersessionRefusalReason,
} from '../src/rules/supersede-successor.js';
import { supersede, type TransitionPlan } from '../src/transitions/plan.js';

const plan: TransitionPlan = {
  slug: 'old',
  phase: 'approved',
  review: 'pr',
  approvedRecord: '2026-11-01 by jw',
  deliveredRecord: '',
  releasedRecord: '',
};

describe('successorPreconditions', () => {
  it('meets both readings for a different plan that has a file', () => {
    const readings = successorPreconditions({ slug: 'old', by: 'new', reference: successorReference('new'), successorFile: 'docs/plans/2026-11-02-new.md' });
    expect(readings.map((r) => [r.name, r.met])).toEqual([['same-plan', true], ['successor-not-found', true]]);
    expect(supersede(plan, { on: '2026-11-15', by: 'new', preconditions: readings })).toMatchObject({
      outcome: 'decided',
      phase: 'superseded',
      record: '2026-11-15, by `new`',
    });
  });

  it('refuses a successor that names the plan itself as same-plan', () => {
    const readings = successorPreconditions({ slug: 'old', by: ' old ', reference: successorReference(' old '), successorFile: 'docs/plans/2026-11-01-old.md' });
    const decided = supersede(plan, { on: '2026-11-15', by: 'old', preconditions: readings });
    expect(decided).toMatchObject({ outcome: 'refused', reason: 'precondition-unmet' });
    expect(decided.outcome === 'refused' && decided.detail).toContain("'same-plan'");
  });

  it('refuses a successor with no plan file as successor-not-found', () => {
    const readings = successorPreconditions({ slug: 'old', by: 'nowhere', reference: successorReference('nowhere'), successorFile: '' });
    const decided = supersede(plan, { on: '2026-11-15', by: 'nowhere', preconditions: readings });
    expect(decided).toMatchObject({ outcome: 'refused', reason: 'precondition-unmet' });
    expect(decided.outcome === 'refused' && decided.detail).toContain("'successor-not-found'");
  });

  it('produces no reading for an empty successor, which supersede refuses as successor-missing', () => {
    const readings = successorPreconditions({ slug: 'old', by: '', reference: successorReference(''), successorFile: '' });
    expect(readings).toEqual([]);
    expect(supersede(plan, { on: '2026-11-15', by: '', preconditions: readings })).toMatchObject({
      outcome: 'refused',
      reason: 'successor-missing',
    });
  });
});

describe('supersessionRefusalReason', () => {
  it('names the unmet successor reading', () => {
    const readings = successorPreconditions({ slug: 'old', by: 'nowhere', reference: successorReference('nowhere'), successorFile: '' });
    const decided = supersede(plan, { on: '2026-11-15', by: 'nowhere', preconditions: readings });
    expect(decided.outcome === 'refused' && supersessionRefusalReason(decided, readings)).toBe('successor-not-found');
  });

  it('keeps the domain reason for a state refusal', () => {
    const readings = successorPreconditions({ slug: 'old', by: 'new', reference: successorReference('new'), successorFile: 'docs/plans/new.md' });
    const decided = supersede({ ...plan, phase: 'delivered' }, { on: '2026-11-15', by: 'new', preconditions: readings });
    expect(decided.outcome === 'refused' && supersessionRefusalReason(decided, readings)).toBe('state-terminal');
  });

  it('keeps precondition-unmet where the unmet reading is not a successor one', () => {
    const readings = [
      ...successorPreconditions({ slug: 'old', by: 'new', reference: successorReference('new'), successorFile: 'docs/plans/new.md' }),
      { name: 'tree-clean', met: false, detail: 'the tree is dirty' },
    ];
    const decided = supersede(plan, { on: '2026-11-15', by: 'new', preconditions: readings });
    expect(decided.outcome === 'refused' && supersessionRefusalReason(decided, readings)).toBe('precondition-unmet');
  });
});

describe('successorCandidates', () => {
  it('offers every other plan once, sorted', () => {
    expect(successorCandidates('old', ['zeta', 'old', 'alpha', 'zeta'])).toEqual(['alpha', 'zeta']);
  });
});

describe('successorEntry', () => {
  it('is ready for another slug, trimmed', () => {
    expect(successorEntry('old', ' new ')).toEqual({ by: 'new', ready: true, reason: null });
  });

  it('is not ready while empty, naming the missing successor', () => {
    expect(successorEntry('old', '  ')).toEqual({ by: '', ready: false, reason: 'name the successor plan first' });
  });

  it('is not ready for the plan itself', () => {
    expect(successorEntry('old', 'old')).toEqual({ by: 'old', ready: false, reason: 'a plan cannot supersede itself' });
  });
});

describe('successorReference', () => {
  it('reads a bare slug as a plan in this repository, trimmed', () => {
    expect(successorReference(' plot-init-checks-bb ')).toEqual({ repo: '', slug: 'plot-init-checks-bb' });
  });

  it('reads owner/repo:slug as a plan in another repository', () => {
    expect(successorReference('quatico-solutions/agent-skills-internal:plot-init-checks-bb')).toEqual({
      repo: 'quatico-solutions/agent-skills-internal',
      slug: 'plot-init-checks-bb',
    });
  });

  it.each(['owner/:x', '/repo:x', 'owner/repo:', 'a/b/c:x', 'owner/repo', 'owner/repo: x', 'own er/repo:x', 'x y', ':x', 'owner/repo:-x'])(
    'refuses %j as unparsed',
    (by) => {
      expect(successorReference(by)).toBe('unparsed');
    },
  );
});

describe('repositoryOfRemote', () => {
  it.each([
    ['git@github.com:plot-pm/plot.git', 'plot-pm/plot'],
    ['https://github.com/plot-pm/plot', 'plot-pm/plot'],
    ['ssh://git@github.com:22/plot-pm/plot.git/', 'plot-pm/plot'],
  ])('reads %s as %s', (url, repo) => {
    expect(repositoryOfRemote(url)).toBe(repo);
  });

  it.each(['/tmp/origin.git', 'file:///tmp/origin.git', '', 'https://example.org/a/b/c'])('reads %j as no repository', (url) => {
    expect(repositoryOfRemote(url)).toBeNull();
  });
});

describe('successorHere', () => {
  it('reads a reference naming this repository as a bare slug, ignoring case', () => {
    expect(successorHere(successorReference('Plot-PM/plot:new'), 'plot-pm/plot')).toEqual({ repo: '', slug: 'new' });
  });

  it('keeps another repository, and keeps every reference where this repository was not read', () => {
    expect(successorHere(successorReference('other/repo:new'), 'plot-pm/plot')).toEqual({ repo: 'other/repo', slug: 'new' });
    expect(successorHere(successorReference('plot-pm/plot:new'), null)).toEqual({ repo: 'plot-pm/plot', slug: 'new' });
    expect(successorHere('unparsed', 'plot-pm/plot')).toBe('unparsed');
  });
});

describe('successorPreconditions for a successor in another repository', () => {
  const foreign = 'quatico-solutions/agent-skills-internal:plot-init-checks-bb';

  it('records the foreign successor unverified, with no plan file', () => {
    const readings = successorPreconditions({ slug: 'old', by: foreign, reference: successorReference(foreign), successorFile: '' });
    expect(readings).toEqual([]);
    expect(supersede(plan, { on: '2026-11-27', by: foreign, unverified: true, preconditions: readings })).toMatchObject({
      outcome: 'decided',
      record: '2026-11-27, by `quatico-solutions/agent-skills-internal:plot-init-checks-bb` (unverified)',
    });
  });

  it('accepts a foreign successor that carries the plan\'s own slug', () => {
    const readings = successorPreconditions({ slug: 'old', by: 'other/repo:old', reference: successorReference('other/repo:old'), successorFile: '' });
    expect(supersede(plan, { on: '2026-11-27', by: 'other/repo:old', unverified: true, preconditions: readings })).toMatchObject({ outcome: 'decided' });
  });

  it('refuses an unparsed successor as successor-unparsed, not precondition-unmet', () => {
    const readings = successorPreconditions({ slug: 'old', by: 'owner/:x', reference: successorReference('owner/:x'), successorFile: '' });
    expect(readings.map((r) => [r.name, r.met])).toEqual([['successor-unparsed', false]]);
    const decided = supersede(plan, { on: '2026-11-27', by: 'owner/:x', preconditions: readings });
    expect(decided).toMatchObject({ outcome: 'refused', reason: 'precondition-unmet' });
    expect(decided.outcome === 'refused' && supersessionRefusalReason(decided, readings)).toBe('successor-unparsed');
  });

  it('checks this repository\'s own owner/repo as a local slug', () => {
    const reference = successorHere(successorReference('plot-pm/plot:nowhere'), 'plot-pm/plot');
    const readings = successorPreconditions({ slug: 'old', by: 'plot-pm/plot:nowhere', reference, successorFile: '' });
    const decided = supersede(plan, { on: '2026-11-27', by: 'nowhere', preconditions: readings });
    expect(decided.outcome === 'refused' && supersessionRefusalReason(decided, readings)).toBe('successor-not-found');
  });

  it('keeps an already-written record and does not append (unverified) twice', () => {
    const written = '2026-11-20, by `other/repo:new` (unverified)';
    const decided = supersede({ ...plan, phase: 'superseded', supersededRecord: written }, { on: '2026-11-27', by: 'other/repo:new', unverified: true, preconditions: [] });
    expect(decided).toMatchObject({ outcome: 'decided', record: written, alreadyRecorded: true });
  });
});

describe('successorName', () => {
  it('names a plan in this repository by its slug, and one in another repository as owner/repo:slug', () => {
    expect(successorName({ repo: '', slug: 'new' })).toBe('new');
    expect(successorName({ repo: 'other/repo', slug: 'new' })).toBe('other/repo:new');
  });
});
