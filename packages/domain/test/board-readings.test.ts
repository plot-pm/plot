import { describe, expect, it } from 'vitest';

import { planOf } from '../src/adapters/plan-store/plan-store-shell.js';
import { branchPlanSet, isPlanBlob } from '../src/rules/branch-plans.js';
import { parsedPlans } from '../src/rules/parsed-plans.js';
import { sprintMembersOf, sprintRecordOf, UNADMITTED_STATE } from '../src/rules/sprint-record.js';
import { designDocsIn, storyRecordOf, unquoteScalar } from '../src/rules/story-record.js';
import { refutedClaims, verificationClaimLines, verificationOf, verificationText } from '../src/rules/verification-record.js';

const blob = (path: string, sha = 'f'.repeat(40), mode = '100644') => ({ path, sha, mode });

describe('parsedPlans', () => {
  it('drops a record with error and keeps the rest in order', () => {
    const records = [{ file: 'a' }, { file: 'b', error: 'file not found' }, { file: 'c' }];
    expect(parsedPlans(records).map((r) => r.file)).toEqual(['a', 'c']);
  });
});

describe('planOf maps the card fields of plot-plan-meta.sh', () => {
  it('maps issues as strings, design, verified, rounds and keeps error', () => {
    const record = planOf({ file: 'p.md', issues: [226, 'PROJ-12'], design_raw: 'd', verified_raw: 'v', rounds: 0, error: 'file not found' });
    expect(record).toMatchObject({ issues: ['226', 'PROJ-12'], designRaw: 'd', verifiedRaw: 'v', rounds: 0, error: 'file not found' });
  });

  it('leaves rounds and error absent where the parser omits them', () => {
    const record = planOf({ file: 'p.md' });
    expect(record).toMatchObject({ issues: [], designRaw: '', verifiedRaw: '' });
    expect('rounds' in record).toBe(false);
    expect('error' in record).toBe(false);
  });
});

describe('branchPlanSet', () => {
  it('holds a Draft plan on a feature/ branch and a plan whose basename differs from its branch slug', () => {
    const picked = branchPlanSet(
      [
        { branch: 'feature/x', merged: 'no', blobs: [blob('docs/plans/2026-01-01-x.md', 'a'.repeat(40))] },
        { branch: 'idea/short', merged: 'unknown', blobs: [blob('docs/plans/2026-01-02-a-longer-name.md', 'b'.repeat(40))] },
      ],
      new Set(),
    );
    expect(picked).toEqual([
      { branch: 'feature/x', path: 'docs/plans/2026-01-01-x.md', sha: 'a'.repeat(40) },
      { branch: 'idea/short', path: 'docs/plans/2026-01-02-a-longer-name.md', sha: 'b'.repeat(40) },
    ]);
  });

  it('skips a merged branch, an unlisted branch, a path on the default branch, a symlink and a non-markdown file', () => {
    const picked = branchPlanSet(
      [
        { branch: 'feature/merged', merged: 'yes', blobs: [blob('docs/plans/m.md')] },
        { branch: 'feature/unlisted', merged: 'no', blobs: null },
        {
          branch: 'feature/y',
          merged: 'no',
          blobs: [blob('docs/plans/main.md'), blob('docs/plans/active/y.md', 'c'.repeat(40), '120000'), blob('docs/plans/notes.txt'), blob('docs/plans/y.md')],
        },
      ],
      new Set(['docs/plans/main.md']),
    );
    expect(picked.map((p) => p.path)).toEqual(['docs/plans/y.md']);
  });

  it('takes a path two branches carry from the first branch', () => {
    const picked = branchPlanSet(
      [
        { branch: 'idea/a', merged: 'no', blobs: [blob('docs/plans/p.md', 'a'.repeat(40))] },
        { branch: 'idea/b', merged: 'no', blobs: [blob('docs/plans/p.md', 'b'.repeat(40))] },
      ],
      new Set(),
    );
    expect(picked).toEqual([{ branch: 'idea/a', path: 'docs/plans/p.md', sha: 'a'.repeat(40) }]);
  });

  it('reads an executable blob as a plan file', () => {
    expect(isPlanBlob(blob('a.md', 'a', '100755'))).toBe(true);
  });
});

const SPRINT = [
  '# Sprint: Desk probes',
  '',
  '> the goal line',
  '',
  '## Status',
  '',
  '- **State:** Active',
  '- **Release:** 2.35.0',
  '- **Start:** 2026-11-02',
  '- **End:** 2026-11-13',
  '',
  '## Plans',
  '',
  '- [ ] [outside] not under a tier',
  '',
  '### Must Have',
  '',
  '- [ ] [a] first',
  '- [x] ~~[b]~~ struck',
  '- [ ] [a] again',
  '- [ ] a bare item',
  '- [ ] a bare item',
  'prose',
  '',
  '### Could Have',
  '',
  '- [ ] [c]',
  '',
  '### Notes',
  '',
  '- [ ] [d] in notes',
].join('\n');

describe('sprintRecordOf', () => {
  it('reads the status fields, the slug and the members', () => {
    const sprint = sprintRecordOf(SPRINT, 'docs/sprints/active/2026-W45-desk-probes.md');
    expect(sprint).toMatchObject({ slug: 'desk-probes', title: 'Desk probes', phase: 'Active', release: '2.35.0', start: '2026-11-02', end: '2026-11-13' });
    expect(sprint?.goal).not.toBe('');
    expect(sprint?.members).toEqual([
      { slug: 'a', text: 'first', tier: 'must', checked: false },
      { slug: 'b', text: '~~ struck', tier: 'must', checked: true },
      { slug: '', text: 'a bare item', tier: 'must', checked: false },
      { slug: '', text: 'a bare item', tier: 'must', checked: false },
      { slug: 'c', text: '', tier: 'could', checked: false },
    ]);
  });

  it('reads the legacy Phase line, an unadmitted state, and falls back to the file name', () => {
    const sprint = sprintRecordOf('## Status\n\n- **Phase:** Planned\n', 'plain.md');
    expect(sprint).toMatchObject({ slug: 'plain', title: 'plain', phase: UNADMITTED_STATE, release: '', start: '', end: '', members: [] });
  });

  it('answers null for a file with no state line', () => {
    expect(sprintRecordOf('# README\n', 'README.md')).toBeNull();
    expect(sprintMembersOf('')).toEqual([]);
  });
});

const STORY = [
  '---',
  'title: "Nothing changed, nothing runs"',
  'status: active',
  'author: jwloka',
  "created: '2026-11-01'",
  'updated: "2026-11-02"',
  'issue: "#3170" # the ticket',
  '---',
  '',
  '# Heading',
  '',
  '## Objective',
  '',
  `"${'word '.repeat(60).trim()}"`,
  '',
  '## Design',
  '',
  'The design.',
  '',
  '## Open Points',
  '',
  '## Session Log',
].join('\n');

describe('storyRecordOf', () => {
  it('reads the front matter and the sections', () => {
    const story = storyRecordOf(STORY, 'nothing', 'docs/stories/nothing/STORY-nothing.md', ['DESIGN-a.md']);
    expect(story).toMatchObject({
      slug: 'nothing',
      title: 'Nothing changed, nothing runs',
      status: 'active',
      declaredStatus: 'active',
      issue: '#3170',
      author: 'jwloka',
      created: '2026-11-01',
      updated: '2026-11-02',
      design: 'The design.',
      path: 'docs/stories/nothing/STORY-nothing.md',
      designDocs: ['DESIGN-a.md'],
      hasOpenPoints: true,
      hasSessionLog: true,
    });
    expect(story.objective.endsWith('…')).toBe(true);
    expect(story.objective.length).toBeLessThanOrEqual(201);
  });

  it('reads an unadmitted status and falls back to the heading, then to the slug', () => {
    expect(storyRecordOf('---\nstatus: archived\n---\n# Head\n', 's', 'p', [])).toMatchObject({ status: UNADMITTED_STATE, title: 'Head', issue: '' });
    expect(storyRecordOf('no front matter', 's', 'p', [])).toMatchObject({ status: '', title: 's', objective: '', design: '' });
    expect(storyRecordOf('---\nauthor: a\n---\n', 's', 'p', [])).toMatchObject({ status: '', title: 's' });
  });

  it('cuts an objective with no space at its length', () => {
    const story = storyRecordOf(`## Objective\n\n${'x'.repeat(250)}\n`, 's', 'p', []);
    expect(story.objective).toBe(`${'x'.repeat(200)}…`);
  });

  it('lists the design documents that sit directly in the story directory', () => {
    expect(
      designDocsIn(['docs/stories/s/DESIGN-b.md', 'docs/stories/s/DESIGN-a.md', 'docs/stories/s/STORY-s.md', 'docs/stories/s/sub/DESIGN-c.md', 'docs/stories/t/DESIGN-d.md'], 'docs/stories/s'),
    ).toEqual(['DESIGN-a.md', 'DESIGN-b.md']);
  });

  it('unquotes one matching pair only', () => {
    expect(unquoteScalar("'a'")).toBe('a');
    expect(unquoteScalar('"a')).toBe('"a');
    expect(unquoteScalar('a')).toBe('a');
  });
});

describe('the verification inputs of a Delivered plan', () => {
  const TEXT = [
    '# P',
    '',
    '## Status',
    '',
    '- **Delivered:** 2026-11-01',
    '- **Verified:** delivery 2026-11-01 at abc1234',
    '',
    '## Verification',
    '',
    'Some prose that is not a claim.',
    '',
    '- Claim-1 supported — it works — lens',
    '- Claim-2 refuted — it breaks — lens — #1712',
    '',
    '```',
    '- Claim-3 refuted — fenced — lens',
    '```',
    '',
    '## Notes',
    '',
    '- Claim-4 refuted — outside the section — lens',
  ].join('\r\n');

  it('carries the claim lines and no other text of the plan', () => {
    const lines = verificationClaimLines(TEXT);
    expect(lines).toEqual(['- Claim-1 supported — it works — lens', '- Claim-2 refuted — it breaks — lens — #1712']);
    expect(lines.join('\n')).not.toContain('# P');
    expect(lines.join('\n')).not.toContain('prose');
  });

  it('answers verificationOf and refutedClaims as the whole text does', () => {
    const plan = { tracer: false, deliveredRaw: '2026-11-01', verifiedRaw: 'delivery 2026-11-01 at abc1234' };
    const rebuilt = verificationText(verificationClaimLines(TEXT));
    expect(verificationOf({ ...plan, text: rebuilt }, 'abc1234')).toBe(verificationOf({ ...plan, text: TEXT }, 'abc1234'));
    expect(verificationOf({ ...plan, text: rebuilt }, 'abc1234')).toBe('refuted');
    expect(refutedClaims(rebuilt)).toEqual(refutedClaims(TEXT));
    expect(verificationText([])).toBe('## Verification');
  });
});
