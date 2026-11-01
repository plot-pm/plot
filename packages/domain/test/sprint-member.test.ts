import { describe, it, expect } from 'vitest';
import {
  addSprintMember, deferSprintMember, removeSprintMember, type SprintFile, type SprintMemberContext,
} from '../src/index.js';

/**
 * `addSprintMember`, `deferSprintMember` and `removeSprintMember` tested at
 * the domain boundary — fed the sprint and plan text directly, never a path.
 */

const SPRINT = (body: string, state = 'Active') => `# Sprint: Example

## Status

- **State:** ${state}
- **Start:** 2026-10-29
- **End:** 2026-11-05
- **Release:** 2.30.0

## Sprint Goal

An example sprint.

### Must Have

<!-- add items here -->

### Should Have

<!-- add items here -->

### Could Have

<!-- add items here -->

### Deferred

<!-- Items moved here during sprint when they won't make the timebox -->

## Notes

### Scope Changes

${body}
`;

const PLAN = (statusBody: string) => `# A plan that does something

## Status

${statusBody}

## Changelog

- Did something.
`;

const ctx = (overrides: Partial<SprintMemberContext> = {}): SprintMemberContext => ({
  sprint: 'example',
  slug: 'a',
  otherSprints: [],
  date: '2026-11-01',
  ...overrides,
});

describe('addSprintMember', () => {
  it('writes the member line, a dated Added line and the Sprint field, after Type', () => {
    const sprintText = SPRINT('<!-- nothing yet -->');
    const planText = PLAN(`- **State:** Draft
- **Type:** feature
- **Issue:** #42`);

    const result = addSprintMember(sprintText, planText, 'must', ctx());
    if (result.outcome !== 'write') throw new Error(`expected write, got ${result.outcome}`);

    expect(result.sprintText).toContain('- [ ] [a] A plan that does something (#42)');
    expect(result.sprintText).toContain('- 2026-11-01: Added [a] to Must');
    expect(result.planText).toContain('- **Type:** feature\n- **Sprint:** example');
  });

  it('logs nothing in a Planning sprint', () => {
    const sprintText = SPRINT('<!-- nothing yet -->', 'Planning');
    const planText = PLAN(`- **State:** Draft
- **Type:** feature`);

    const result = addSprintMember(sprintText, planText, 'must', ctx());
    if (result.outcome !== 'write') throw new Error(`expected write, got ${result.outcome}`);

    expect(result.sprintText).toContain('- [ ] [a] A plan that does something');
    expect(result.sprintText).not.toContain('Added [a]');
    expect(result.planText).toContain('- **Sprint:** example');
  });

  describe('every field form', () => {
    const cases: Array<[string, string]> = [
      ['no line', `- **State:** Draft\n- **Type:** feature`],
      ['empty value', `- **State:** Draft\n- **Type:** feature\n- **Sprint:**`],
      ['bare placeholder', `- **State:** Draft\n- **Type:** feature\n- **Sprint:** <!-- optional -->`],
      ['template placeholder', `- **State:** Draft\n- **Type:** feature\n- **Sprint:** <!-- optional, filled when plan is added to a sprint -->`],
      ['already set to this sprint', `- **State:** Draft\n- **Type:** feature\n- **Sprint:** example`],
    ];

    for (const [label, statusBody] of cases) {
      it(`converges to the field value — ${label}`, () => {
        const sprintText = SPRINT('<!-- nothing yet -->');
        const planText = PLAN(statusBody);
        const result = addSprintMember(sprintText, planText, 'must', ctx());
        if (result.outcome === 'refused') throw new Error(`unexpected refusal: ${result.reason}`);
        const text = result.outcome === 'write' ? result.planText : planText;
        expect(text).toMatch(/^- \*\*Sprint:\*\* example$/m);
      });
    }

    it('refuses field-record on another comment', () => {
      const sprintText = SPRINT('<!-- nothing yet -->');
      const planText = PLAN(`- **State:** Draft
- **Type:** feature
- **Sprint:** <!-- not a member; the sprint closed 2026-08-26 -->`);
      const result = addSprintMember(sprintText, planText, 'must', ctx());
      expect(result).toMatchObject({ outcome: 'refused', reason: 'field-record', slug: 'a', sprint: 'example' });
    });
  });

  it('writes only the first ## Status, leaving a quoted block in prose unchanged', () => {
    const sprintText = SPRINT('<!-- nothing yet -->');
    const planText = `${PLAN(`- **State:** Draft\n- **Type:** feature`)}

## Example

Here is a quoted block:

\`\`\`
## Status

- **State:** Draft
\`\`\`
`;
    const result = addSprintMember(sprintText, planText, 'must', ctx());
    if (result.outcome !== 'write') throw new Error(`expected write, got ${result.outcome}`);
    expect(result.planText).toContain('```\n## Status\n\n- **State:** Draft\n```');
    expect(result.planText.match(/- \*\*Sprint:\*\* example/g)).toHaveLength(1);
  });

  it('annotates with the plan PR and first branch when the plan is Approved', () => {
    const sprintText = SPRINT('<!-- nothing yet -->');
    const planText = `${PLAN(`- **State:** Approved
- **Type:** feature
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #123 merged`)}

## Slices

### Writer

- \`feature/does-a-thing\` — does the thing.
`;
    const result = addSprintMember(sprintText, planText, 'must', ctx());
    if (result.outcome !== 'write') throw new Error(`expected write, got ${result.outcome}`);
    expect(result.sprintText).toMatch(/\[a\].*<!-- pr: #123, branch: feature\/does-a-thing -->/);
    expect(result.sprintText).toContain('- [ ] [a]');
  });

  it('annotates and ticks when the plan is Delivered', () => {
    const sprintText = SPRINT('<!-- nothing yet -->');
    const planText = `${PLAN(`- **State:** Delivered
- **Type:** feature
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #123 merged`)}

## Slices

### Writer

- \`feature/does-a-thing\` — does the thing.
`;
    const result = addSprintMember(sprintText, planText, 'must', ctx());
    if (result.outcome !== 'write') throw new Error(`expected write, got ${result.outcome}`);
    expect(result.sprintText).toContain('- [x] [a]');
    expect(result.sprintText).toMatch(/pr: #123/);
  });

  it('moves a plan from Must to Should, logging a Reprioritized line', () => {
    const sprintText = SPRINT('<!-- nothing yet -->').replace(
      '### Must Have\n\n<!-- add items here -->',
      '### Must Have\n\n- [ ] [a] A plan that does something',
    );
    const planText = PLAN(`- **State:** Draft\n- **Type:** feature\n- **Sprint:** example`);

    const result = addSprintMember(sprintText, planText, 'should', ctx());
    if (result.outcome !== 'write') throw new Error(`expected write, got ${result.outcome}`);

    expect(result.sprintText).toContain('- 2026-11-01: Reprioritized [a] Must → Should');
    const mustSection = result.sprintText.split('### Must Have')[1]!.split('### Should Have')[0]!;
    expect(mustSection).not.toContain('[a]');
    const shouldSection = result.sprintText.split('### Should Have')[1]!.split('### Could Have')[0]!;
    expect(shouldSection).toContain('[a]');
  });

  it('moves the field on carry-over from a Closed sprint\'s Deferred line', () => {
    const closedSprint: SprintFile = {
      file: 'docs/sprints/2026-W40-old.md',
      content: SPRINT('<!-- nothing yet -->', 'Closed').replace(
        '### Deferred\n\n<!-- Items moved here during sprint when they won\'t make the timebox -->',
        '### Deferred\n\n- [ ] [a] A plan that does something',
      ),
    };
    const nextSprintText = SPRINT('<!-- nothing yet -->', 'Planning');
    const planText = PLAN(`- **State:** Draft\n- **Type:** feature\n- **Sprint:** old`);

    const result = addSprintMember(nextSprintText, planText, 'must', ctx({ otherSprints: [closedSprint] }));
    if (result.outcome !== 'write') throw new Error(`expected write, got ${result.outcome}`);
    expect(result.planText).toMatch(/^- \*\*Sprint:\*\* example$/m);
  });

  it('refuses listed-elsewhere when another open sprint already lists the plan', () => {
    const otherOpen: SprintFile = {
      file: 'docs/sprints/2026-W41-other.md',
      content: SPRINT('<!-- nothing yet -->').replace(
        '### Must Have\n\n<!-- add items here -->',
        '### Must Have\n\n- [ ] [a] A plan that does something',
      ),
    };
    const sprintText = SPRINT('<!-- nothing yet -->');
    const planText = PLAN(`- **State:** Draft\n- **Type:** feature\n- **Sprint:** other`);

    const result = addSprintMember(sprintText, planText, 'must', ctx({ otherSprints: [otherOpen] }));
    expect(result).toMatchObject({ outcome: 'refused', reason: 'listed-elsewhere', slug: 'a', sprint: 'example' });
  });

  it('refuses sprint-closed', () => {
    const sprintText = SPRINT('<!-- nothing yet -->', 'Closed');
    const planText = PLAN(`- **State:** Draft\n- **Type:** feature`);
    const result = addSprintMember(sprintText, planText, 'must', ctx());
    expect(result).toMatchObject({ outcome: 'refused', reason: 'sprint-closed' });
  });

  it('is a no-op on a re-run with the same arguments', () => {
    const sprintText = SPRINT('<!-- nothing yet -->');
    const planText = PLAN(`- **State:** Draft\n- **Type:** feature`);
    const first = addSprintMember(sprintText, planText, 'must', ctx());
    if (first.outcome !== 'write') throw new Error(`expected write, got ${first.outcome}`);

    const second = addSprintMember(first.sprintText, first.planText, 'must', ctx());
    expect(second).toEqual({ outcome: 'noop' });
  });
});

describe('deferSprintMember', () => {
  it('moves the member line to Deferred, logs a Deferred line, and keeps the field', () => {
    const sprintText = SPRINT('<!-- nothing yet -->').replace(
      '### Must Have\n\n<!-- add items here -->',
      '### Must Have\n\n- [ ] [a] A plan that does something',
    );
    const planText = PLAN(`- **State:** Draft\n- **Type:** feature\n- **Sprint:** example`);

    const result = deferSprintMember(sprintText, planText, ctx());
    if (result.outcome !== 'write') throw new Error(`expected write, got ${result.outcome}`);

    expect(result.sprintText).toContain('- 2026-11-01: Deferred [a] from Must');
    const deferredSection = result.sprintText.split('### Deferred')[1]!.split('## Notes')[0]!;
    expect(deferredSection).toContain('[a]');
    expect(result.planText).toBe(planText);
  });

  it('refuses not-a-member', () => {
    const sprintText = SPRINT('<!-- nothing yet -->');
    const planText = PLAN(`- **State:** Draft\n- **Type:** feature`);
    const result = deferSprintMember(sprintText, planText, ctx());
    expect(result).toMatchObject({ outcome: 'refused', reason: 'not-a-member' });
  });

  it('refuses sprint-closed', () => {
    const sprintText = SPRINT('<!-- nothing yet -->', 'Closed').replace(
      '### Must Have\n\n<!-- add items here -->',
      '### Must Have\n\n- [ ] [a] A plan that does something',
    );
    const planText = PLAN(`- **State:** Draft\n- **Type:** feature\n- **Sprint:** example`);
    const result = deferSprintMember(sprintText, planText, ctx());
    expect(result).toMatchObject({ outcome: 'refused', reason: 'sprint-closed' });
  });
});

describe('removeSprintMember', () => {
  it('strikes the reference, logs a Removed line, and clears the field when no other open sprint lists it', () => {
    const sprintText = SPRINT('<!-- nothing yet -->').replace(
      '### Must Have\n\n<!-- add items here -->',
      '### Must Have\n\n- [ ] [a] A plan that does something',
    );
    const planText = PLAN(`- **State:** Draft\n- **Type:** feature\n- **Sprint:** example`);

    const result = removeSprintMember(sprintText, planText, ctx());
    if (result.outcome !== 'write') throw new Error(`expected write, got ${result.outcome}`);

    expect(result.sprintText).toContain('- [ ] ~~[a]~~ A plan that does something');
    expect(result.sprintText).toContain('- 2026-11-01: Removed [a] from Must');
    expect(result.planText).toMatch(/^- \*\*Sprint:\*\* $/m);
  });

  it('keeps another open sprint\'s name when one still lists the plan', () => {
    const otherOpen: SprintFile = {
      file: 'docs/sprints/2026-W41-other.md',
      content: SPRINT('<!-- nothing yet -->').replace(
        '### Must Have\n\n<!-- add items here -->',
        '### Must Have\n\n- [ ] [a] A plan that does something',
      ),
    };
    const sprintText = SPRINT('<!-- nothing yet -->').replace(
      '### Must Have\n\n<!-- add items here -->',
      '### Must Have\n\n- [ ] [a] A plan that does something',
    );
    const planText = PLAN(`- **State:** Draft\n- **Type:** feature\n- **Sprint:** example`);

    const result = removeSprintMember(sprintText, planText, ctx({ otherSprints: [otherOpen] }));
    if (result.outcome !== 'write') throw new Error(`expected write, got ${result.outcome}`);
    expect(result.planText).toMatch(/^- \*\*Sprint:\*\* other$/m);
  });

  it('deletes the line outright in a Planning sprint, with no log line', () => {
    const sprintText = SPRINT('<!-- nothing yet -->', 'Planning').replace(
      '### Must Have\n\n<!-- add items here -->',
      '### Must Have\n\n- [ ] [a] A plan that does something',
    );
    const planText = PLAN(`- **State:** Draft\n- **Type:** feature\n- **Sprint:** example`);

    const result = removeSprintMember(sprintText, planText, ctx());
    if (result.outcome !== 'write') throw new Error(`expected write, got ${result.outcome}`);

    expect(result.sprintText).not.toContain('[a]');
    expect(result.sprintText).not.toContain('Removed [a]');
  });

  it('refuses not-a-member', () => {
    const sprintText = SPRINT('<!-- nothing yet -->');
    const planText = PLAN(`- **State:** Draft\n- **Type:** feature`);
    const result = removeSprintMember(sprintText, planText, ctx());
    expect(result).toMatchObject({ outcome: 'refused', reason: 'not-a-member' });
  });

  it('refuses sprint-closed', () => {
    const sprintText = SPRINT('<!-- nothing yet -->', 'Closed').replace(
      '### Must Have\n\n<!-- add items here -->',
      '### Must Have\n\n- [ ] [a] A plan that does something',
    );
    const planText = PLAN(`- **State:** Draft\n- **Type:** feature\n- **Sprint:** example`);
    const result = removeSprintMember(sprintText, planText, ctx());
    expect(result).toMatchObject({ outcome: 'refused', reason: 'sprint-closed' });
  });

  it('refuses field-record rather than overwriting another comment', () => {
    const sprintText = SPRINT('<!-- nothing yet -->').replace(
      '### Must Have\n\n<!-- add items here -->',
      '### Must Have\n\n- [ ] [a] A plan that does something',
    );
    const planText = PLAN(`- **State:** Draft
- **Type:** feature
- **Sprint:** <!-- not a member; the sprint closed 2026-08-26 -->`);
    const result = removeSprintMember(sprintText, planText, ctx());
    expect(result).toMatchObject({ outcome: 'refused', reason: 'field-record' });
  });
});
