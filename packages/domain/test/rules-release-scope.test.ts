import { describe, expect, it } from 'vitest';
import {
  namedOutsideScope,
  releaseOwed,
  releaseScope,
  scopeSlugs,
  type ReleaseScopePlan,
  type ReleaseTagPlanReading,
  type ReleaseTagSlices,
} from '../src/rules/release-scope.js';
import type { ReleaseTagPrRow } from '../src/rules/release-tag.js';

describe('scopeSlugs', () => {
  it('reads unstruck items under Must, Should and Could once each, and nothing under other headings', () => {
    const sprint = [
      '## Sprint Goal', '- [ ] [goal-item] not scope', '',
      '### Must Have', '- [x] [alpha] a', '- [ ] ~~[struck]~~ left', '- [ ] [alpha] again',
      '### Should Have', '- [ ] [beta] b',
      '## Could Have', '- [ ] [gamma] c',
      '## Notes', '- [ ] [note-item] n',
    ].join('\n');
    expect(scopeSlugs(sprint)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('answers an empty list for a file with no tier', () => {
    expect(scopeSlugs('# S\n\ntext\n')).toEqual([]);
  });
});

describe('namedOutsideScope', () => {
  it('names each plan outside the scope once, through its slug, and skips in-scope and plan-less changesets', () => {
    const shipped = [
      { file: 'a.md', plan: 'docs/plans/2026-10-01-alpha.md' },
      { file: 'b.md', plan: 'docs/plans/2026-10-02-omega.md' },
      { file: 'c.md', plan: 'docs/plans/2026-10-02-omega.md' },
      { file: 'd.md', plan: '' },
    ];
    expect(namedOutsideScope(shipped, ['alpha'])).toEqual(['omega']);
  });
});

describe('releaseScope — the tag arm', () => {
  const plan = (slug: string, over: Partial<ReleaseScopePlan> = {}): ReleaseScopePlan => ({
    slug,
    file: `docs/plans/2026-11-01-${slug}.md`,
    phase: 'delivered',
    releasedRecord: '',
    ...over,
  });
  const pr = (number: number, at: string, tags: readonly string[]): ReleaseTagPrRow => ({
    number,
    mergeCommit: `m${number}`,
    mergedAt: at,
    containingTags: tags,
  });
  const reading = (merges: readonly ReleaseTagPrRow[], over: Partial<ReleaseTagPlanReading> = {}): ReleaseTagPlanReading => ({
    references: merges.map((m) => ({ reference: { repo: '', number: m.number }, deferred: false })),
    merges,
    foreignCommit: false,
    ...over,
  });
  const scopeOf = (plans: readonly ReleaseScopePlan[], slices: ReleaseTagSlices, version = 'v2.37.0') =>
    releaseScope(version, '2026-11-27', [], [], slices, plans);

  it('books a Delivered plan whose every slice first shipped in the tag', () => {
    const slices = new Map([['a', reading([pr(1, '2026-11-25T00:00:00Z', ['v2.37.0']), pr(2, '2026-11-26T00:00:00Z', ['v2.37.0', 'v2.38.0'])])]]);
    expect(scopeOf([plan('a')], slices)).toMatchObject({ tagged: ['a'], tagSkipped: [] });
  });

  it('leaves a plan with one slice before the tag and one after, and the next release books it', () => {
    const slices = new Map([['a', reading([pr(1, '2026-11-25T00:00:00Z', ['v2.37.0', 'v2.38.0']), pr(2, '2026-11-28T00:00:00Z', ['v2.38.0'])])]]);
    expect(scopeOf([plan('a')], slices)).toMatchObject({ tagged: [], tagSkipped: [{ slug: 'a', reason: 'slice-after-tag' }] });
    expect(scopeOf([plan('a')], slices, 'v2.38.0')).toMatchObject({ tagged: ['a'], tagSkipped: [] });
  });

  it('leaves out a plan whose slices all lie before the previous tag, and names nothing', () => {
    const slices = new Map([['a', reading([pr(1, '2026-10-01T00:00:00Z', ['v2.35.0', 'v2.36.0', 'v2.37.0'])])]]);
    expect(scopeOf([plan('a')], slices)).toMatchObject({ tagged: [], tagSkipped: [] });
  });

  it('names a plan with a slice merged with no merge subject, and a branch naming no PR', () => {
    const unmerged = reading([pr(1, '2026-11-25T00:00:00Z', ['v2.37.0']), { number: 2, mergeCommit: '', mergedAt: '', containingTags: [] }]);
    const bare = reading([pr(3, '2026-11-25T00:00:00Z', ['v2.37.0'])], {
      references: [{ reference: { repo: '', number: 3 }, deferred: false }, { reference: null, deferred: false }],
    });
    const slices = new Map([['a', unmerged], ['b', bare]]);
    expect(scopeOf([plan('a'), plan('b')], slices).tagSkipped).toEqual([
      { slug: 'a', reason: 'no-merge-subject' },
      { slug: 'b', reason: 'no-merge-subject' },
    ]);
  });

  it('names a plan whose slice lives in another repository', () => {
    const foreign = reading([pr(1, '2026-11-25T00:00:00Z', ['v2.37.0'])], { foreignCommit: true });
    expect(scopeOf([plan('a')], new Map([['a', foreign]])).tagSkipped).toEqual([{ slug: 'a', reason: 'slice-foreign' }]);
  });

  it('ignores a deferred branch with no PR', () => {
    const r = reading([pr(1, '2026-11-25T00:00:00Z', ['v2.37.0'])], {
      references: [{ reference: { repo: '', number: 1 }, deferred: false }, { reference: null, deferred: true }],
    });
    expect(scopeOf([plan('a')], new Map([['a', r]])).tagged).toEqual(['a']);
  });

  it('names an Approved plan and a Released plan with a slice in the tag, and books neither', () => {
    const r = reading([pr(1, '2026-11-25T00:00:00Z', ['v2.37.0'])]);
    const slices = new Map([['a', r], ['b', r], ['c', r]]);
    const plans = [plan('a', { phase: 'approved' }), plan('b', { phase: 'released' }), plan('c', { releasedRecord: '2026-11-27, v2.37.0' })];
    expect(scopeOf(plans, slices)).toMatchObject({
      tagged: [],
      tagSkipped: [
        { slug: 'a', reason: 'not-delivered' },
        { slug: 'b', reason: 'already-released' },
        { slug: 'c', reason: 'already-released' },
      ],
    });
  });

  it('books a plan the commits it names ship in the tag', () => {
    const r = reading([{ number: 0, mergeCommit: 'abc1234', mergedAt: '2026-11-25T00:00:00Z', containingTags: ['v2.37.0'] }], { references: [] });
    expect(scopeOf([plan('a')], new Map([['a', r]])).tagged).toEqual(['a']);
  });

  it('books nothing from the tag where the tag reading is unaskable', () => {
    expect(scopeOf([plan('a')], 'unaskable')).toMatchObject({ tagged: [], tagSkipped: [] });
  });

  it('leaves the tag arm a plan the sprint or a changeset already holds', () => {
    const r = reading([pr(1, '2026-11-25T00:00:00Z', ['v2.37.0'])]);
    const sprints = [{ slug: 's', state: 'Active', start: '', release: '2.37.0', slugs: ['a'] }];
    const shipped = [{ file: 'x.md', plan: 'docs/plans/2026-11-01-b.md' }];
    const scope = releaseScope('v2.37.0', '2026-11-27', sprints, shipped, new Map([['a', r], ['b', r], ['c', r]]), [plan('a'), plan('b'), plan('c')]);
    expect(scope).toMatchObject({ sprintSlugs: ['a'], named: ['b'], tagged: ['c'] });
    expect(releaseOwed(scope, [plan('a'), plan('b'), plan('c')])).toEqual(['a', 'b', 'c']);
  });
});
