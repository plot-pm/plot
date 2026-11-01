import { describe, it, expect } from 'vitest';
import {
  sprintMemberRefusals, sprintFieldNotices, sprintMemberRefusalText, planSprintField,
  type SprintFile,
} from '../src/index.js';

const SPRINT_FILE = '2026-W44-delivery-loop.md';
const sprint = (state: string, body: string) => `# Sprint: Delivery loop

## Status

- **State:** ${state}
- **Start:** 2026-10-29

${body}
`;
const plan = (field: string | null) => `# Plan

## Status

- **State:** Approved
${field === null ? '' : `- **Sprint:** ${field}\n`}
## Design
`;
const PLAN_FILE = 'docs/plans/2026-11-01-a.md';
const sprintsOf = (...contents: string[]): SprintFile[] =>
  contents.map((content, i) => ({ file: i === 0 ? SPRINT_FILE : `2026-W4${i}-other-${i}.md`, content }));
const run = (before: string | null, after: string, field: string | null) =>
  sprintMemberRefusals([{ file: SPRINT_FILE, before, after }], sprintsOf(after), [{ file: PLAN_FILE, content: plan(field) }]);

const WITH = (line: string, tier = 'Should Have') => sprint('Active', `### ${tier}\n\n${line}\n`);
const A = '- [ ] [a] Do it';

describe('sprintMemberRefusals', () => {
  it('refuses an added member whose field is empty', () => {
    const r = run(sprint('Active', '### Should Have\n'), WITH(A), '');
    expect(r).toMatchObject([{ slug: 'a', sprint: 'delivery-loop', tier: 'should', field: '' }]);
    expect(sprintMemberRefusalText(r)).toContain('plot-sprint-member.mjs add delivery-loop a --tier should');
  });

  it('passes a member whose plan names the sprint', () => {
    expect(run(null, WITH(A), 'delivery-loop')).toEqual([]);
  });

  it('passes a tick', () => {
    expect(run(WITH(A), WITH('- [x] [a] Do it'), '')).toEqual([]);
  });

  it('ignores drift a commit did not add', () => {
    const before = WITH(`${A}\n- [ ] [b] Other`);
    const after = WITH(`${A}\n- [x] [b] Other`);
    expect(run(before, after, '')).toEqual([]);
  });

  it('ignores a Closed sprint', () => {
    expect(run(null, sprint('Closed', `### Should Have\n\n${A}\n`), '')).toEqual([]);
  });

  it('ignores a Deferred line and a struck line', () => {
    expect(run(null, WITH(A, 'Deferred'), '')).toEqual([]);
    expect(run(null, WITH('- [ ] ~~[a]~~ Dropped'), '')).toEqual([]);
  });

  it('refuses a field that names another sprint', () => {
    expect(run(null, WITH(A), 'bugfix')).toHaveLength(1);
  });

  it('checks a tier move', () => {
    expect(run(WITH(A, 'Deferred'), WITH(A, 'Must Have'), '')).toHaveLength(1);
    expect(run(WITH(A, 'Should Have'), WITH(A, 'Must Have'), '')).toHaveLength(1);
  });

  it('passes a member with no plan', () => {
    const after = WITH(A);
    expect(sprintMemberRefusals([{ file: SPRINT_FILE, before: null, after }], sprintsOf(after), [])).toEqual([]);
  });

  it('returns null text for no refusals', () => {
    expect(sprintMemberRefusalText([])).toBeNull();
  });
});

describe('sprintFieldNotices', () => {
  it('reports a field naming a sprint that does not list the plan', () => {
    const sprints = sprintsOf(WITH('- [ ] [z] Other'));
    expect(sprintFieldNotices([{ file: PLAN_FILE, before: plan(''), after: plan('delivery-loop') }], sprints))
      .toEqual([{ slug: 'a', field: 'delivery-loop' }]);
  });

  it('reports nothing where the sprint lists the plan or the field is unchanged', () => {
    const sprints = sprintsOf(WITH(A));
    expect(sprintFieldNotices([{ file: PLAN_FILE, before: plan(''), after: plan('delivery-loop') }], sprints)).toEqual([]);
    expect(sprintFieldNotices([{ file: PLAN_FILE, before: plan('x'), after: plan('x') }], [])).toEqual([]);
  });
});

describe('planSprintField', () => {
  it('strips comments and trims', () => {
    expect(planSprintField(plan('<!-- optional -->'))).toBe('');
    expect(planSprintField(plan('  delivery-loop '))).toBe('delivery-loop');
    expect(planSprintField(plan(null))).toBe('');
  });
});
