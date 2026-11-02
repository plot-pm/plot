import { readFileSync } from 'node:fs';
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
      ['shipped template placeholder', `- **State:** Draft\n- **Type:** feature\n- **Sprint:** <!-- optional, filled when plan is added to a sprint — a time-boxed selection of planned work -->`],
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

  describe('a plan created from a template file', () => {
    const templates: Array<[string, string]> = [
      ['the shipped template', '../../../skills/plot/templates/plan.md'],
      ['the repo template', '../../../.plot/templates/plan.md'],
    ];

    for (const [label, path] of templates) {
      it(`writes the Sprint field over ${label}'s placeholder`, () => {
        const planText = readFileSync(new URL(path, import.meta.url), 'utf8');
        expect(planText).toMatch(/^- \*\*Sprint:\*\* <!--/m);
        const result = addSprintMember(SPRINT('<!-- nothing yet -->'), planText, 'must', ctx());
        if (result.outcome !== 'write') throw new Error(`expected write, got ${JSON.stringify(result)}`);
        expect(result.planText).toMatch(/^- \*\*Sprint:\*\* example$/m);
        expect(result.sprintText).toContain('- 2026-11-01: Added [a] to Must');
      });
    }
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

  it('writes the owed annotation and tick onto a member line already in the tier', () => {
    const planText = `${PLAN(`- **State:** Delivered
- **Type:** feature
- **Sprint:** example
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #123 merged`)}

## Slices

### Writer

- \`feature/does-a-thing\` — does the thing.
`;
    const sprintText = SPRINT('<!-- nothing yet -->').replace(
      '### Should Have\n\n<!-- add items here -->',
      '### Should Have\n\n- [ ] [a] A plan that does something',
    );
    const result = addSprintMember(sprintText, planText, 'should', ctx());
    if (result.outcome !== 'write') throw new Error(`expected write, got ${result.outcome}`);
    expect(result.sprintText).toMatch(/- \[x\] \[a\].*<!-- pr: #123, branch: feature\/does-a-thing -->/);
    expect(result.planText).toBe(planText);
    expect(addSprintMember(result.sprintText, result.planText, 'should', ctx())).toEqual({ outcome: 'noop' });
  });

  describe('the branch an Approved plan annotates with', () => {
    const APPROVED_WITH_PROSE_BULLETS = `${PLAN(`- **State:** Approved
- **Type:** feature
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #123 merged`)}

## Approach

- \`/plot-approve\` annotates the member line.
- \`plot-review-status.sh\` reads the annotation.

## Slices

### Writer

- \`feature/does-a-thing\` — does the thing.
- \`feature/does-another-thing\` — does the other thing.
`;

    it('takes the first slice branch, not a backticked bullet before `## Slices`', () => {
      const result = addSprintMember(SPRINT('<!-- nothing yet -->'), APPROVED_WITH_PROSE_BULLETS, 'must', ctx());
      if (result.outcome !== 'write') throw new Error(`expected write, got ${result.outcome}`);
      expect(result.sprintText).toContain('<!-- pr: #123, branch: feature/does-a-thing -->');
      expect(result.sprintText).not.toContain('branch: /plot-approve');
    });

    it('takes the caller-supplied parser branch over its own reading', () => {
      const result = addSprintMember(SPRINT('<!-- nothing yet -->'), APPROVED_WITH_PROSE_BULLETS, 'must', ctx({ firstBranch: 'feature/does-another-thing' }));
      if (result.outcome !== 'write') throw new Error(`expected write, got ${result.outcome}`);
      expect(result.sprintText).toContain('<!-- pr: #123, branch: feature/does-another-thing -->');
    });

    it('reads an older plan\'s `## Branches` section', () => {
      const older = APPROVED_WITH_PROSE_BULLETS.replace('## Slices', '## Branches');
      const result = addSprintMember(SPRINT('<!-- nothing yet -->'), older, 'must', ctx());
      if (result.outcome !== 'write') throw new Error(`expected write, got ${result.outcome}`);
      expect(result.sprintText).toContain('branch: feature/does-a-thing -->');
    });

    it('keeps a correct existing `branch:` annotation when a move re-annotates', () => {
      const sprintText = SPRINT('<!-- nothing yet -->').replace(
        '### Must Have\n\n<!-- add items here -->',
        '### Must Have\n\n- [ ] [a] A plan that does something <!-- pr: #123, branch: feature/does-a-thing -->',
      );
      const planText = APPROVED_WITH_PROSE_BULLETS.replace('- **Type:** feature', '- **Type:** feature\n- **Sprint:** example');
      const result = addSprintMember(sprintText, planText, 'should', ctx());
      if (result.outcome !== 'write') throw new Error(`expected write, got ${result.outcome}`);
      const shouldSection = result.sprintText.split('### Should Have')[1]!.split('### Could Have')[0]!;
      expect(shouldSection).toContain('<!-- pr: #123, branch: feature/does-a-thing -->');
      expect(result.sprintText).not.toContain('/plot-approve');
    });
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

describe('sprint-member edge forms', () => {
  const write = (r: ReturnType<typeof addSprintMember>) => {
    if (r.outcome !== 'write') throw new Error(`expected write, got ${r.outcome}`);
    return r;
  };
  const refusal = (r: ReturnType<typeof addSprintMember>) => {
    if (r.outcome !== 'refused') throw new Error(`expected refused, got ${r.outcome}`);
    return r.reason;
  };
  const PLAIN = PLAN('- **State:** Draft\n- **Type:** feature');

  it('refuses every verb on a sprint that names no State', () => {
    const bare = SPRINT('x').replace('- **State:** Active\n', '');
    expect(refusal(addSprintMember(bare, PLAIN, 'must', ctx()))).toBe('sprint-not-found');
    expect(refusal(deferSprintMember(bare, PLAIN, ctx()))).toBe('sprint-not-found');
    expect(refusal(removeSprintMember(bare, PLAIN, ctx()))).toBe('sprint-not-found');
  });

  it('refuses add, defer and remove on a missing tier or Deferred heading', () => {
    const noMust = SPRINT('x').replace('### Must Have', '### Other');
    expect(refusal(addSprintMember(noMust, PLAIN, 'must', ctx()))).toBe('sprint-not-found');
    const withLine = SPRINT('x').replace('### Deferred', '### Other').replace('<!-- add items here -->', '- [ ] [a] A');
    expect(refusal(deferSprintMember(withLine, PLAIN, ctx()))).toBe('sprint-not-found');
  });

  it('appends after existing member lines and existing Scope Changes lines, before the next heading', () => {
    const sprint = SPRINT('- 2026-10-30: Added [z] to Must')
      .replace('<!-- add items here -->', '- [ ] [z] Z')
      .concat('\n## Appendix\n\ntext\n');
    const r = write(addSprintMember(sprint, PLAIN, 'must', ctx({ reason: 'urgent' })));
    expect(r.sprintText).toContain('- [ ] [z] Z\n- [ ] [a]');
    expect(r.sprintText).toContain('- 2026-10-30: Added [z] to Must\n- 2026-11-01: Added [a] to Must — urgent\n');
    expect(r.sprintText.indexOf('Added [a]')).toBeLessThan(r.sprintText.indexOf('## Appendix'));
  });

  it('writes no log line when the sprint has no Scope Changes heading', () => {
    const sprint = SPRINT('x').replace('### Scope Changes', '### Elsewhere');
    expect(write(addSprintMember(sprint, PLAIN, 'must', ctx())).sprintText).not.toContain('Added [a]');
  });

  it('builds the member line from a plan with no title and no Issue', () => {
    const r = write(addSprintMember(SPRINT('x'), '## Status\n\n- **State:** Draft\n', 'must', ctx()));
    expect(r.sprintText).toContain('- [ ] [a]\n');
  });

  it('writes the Sprint field into a plan that has no Status section, and after the last line without a Type', () => {
    expect(write(addSprintMember(SPRINT('x'), '# T\n\ntext\n', 'must', ctx())).planText).toBe('# T\n\ntext\n');
    const noType = PLAN('- **State:** Draft\n- **Issue:** #7\n');
    expect(write(addSprintMember(SPRINT('x'), noType, 'must', ctx())).planText).toContain('- **Issue:** #7\n- **Sprint:** example');
  });

  it('overwrites the shipped long placeholder and refuses a recorded comment', () => {
    const shipped = PLAN('- **State:** Draft\n- **Sprint:** <!-- optional, filled when plan is added to a sprint — a time-boxed selection of planned work -->');
    expect(write(addSprintMember(SPRINT('x'), shipped, 'must', ctx())).planText).toContain('- **Sprint:** example');
    const recorded = PLAN('- **State:** Draft\n- **Sprint:** <!-- not a member; closed -->');
    expect(refusal(addSprintMember(SPRINT('x'), recorded, 'must', ctx()))).toBe('field-record');
  });

  it('does not annotate an Approved plan that names no plan PR', () => {
    const approved = PLAN('- **State:** Approved\n- **Type:** feature');
    expect(write(addSprintMember(SPRINT('x'), approved, 'must', ctx())).sprintText).not.toContain('PR #');
  });

  it('re-adds a deferred line to a live tier and logs it as Added', () => {
    const sprint = SPRINT('x').replace('<!-- Items moved here during sprint when they won\'t make the timebox -->', '- [ ] [a] A');
    const r = write(addSprintMember(sprint, PLAIN, 'should', ctx()));
    expect(r.sprintText.split('### Should Have')[1]!.split('### Could Have')[0]).toContain('- [ ] [a] A');
    expect(r.sprintText.split('### Deferred')[1]!.split('## Notes')[0]).not.toContain('[a]');
    expect(r.sprintText).toContain('Added [a] to Should');
  });

  it('re-adds a struck line unstruck, in the same tier and in another tier', () => {
    const struck = SPRINT('x').replace('<!-- add items here -->', '- [ ] ~~[a]~~ A');
    const same = write(addSprintMember(struck, PLAIN, 'must', ctx()));
    expect(same.sprintText).toContain('- [ ] [a] A');
    expect(same.sprintText).not.toContain('~~[a]~~');
    const other = write(addSprintMember(struck, PLAIN, 'could', ctx()));
    expect(other.sprintText.split('### Could Have')[1]!.split('### Deferred')[0]).toContain('- [ ] [a] A');
    expect(other.sprintText).toContain('Added [a] to Could');
  });

  it('defer is a no-op on a re-run, and refuses a struck line', () => {
    const live = SPRINT('x').replace('<!-- add items here -->', '- [ ] [a] A');
    const first = write(deferSprintMember(live, PLAIN, ctx({ reason: 'slipped' })));
    expect(first.sprintText).toContain('Deferred [a] from Must — slipped');
    expect(deferSprintMember(first.sprintText, PLAIN, ctx()).outcome).toBe('noop');
    const struck = SPRINT('x').replace('<!-- add items here -->', '- [ ] ~~[a]~~ A');
    expect(refusal(deferSprintMember(struck, PLAIN, ctx()))).toBe('not-a-member');
  });

  it('remove is a no-op on a struck line, and handles a Deferred line without logging a tier', () => {
    const struck = SPRINT('x').replace('<!-- add items here -->', '- [ ] ~~[a]~~ A');
    expect(removeSprintMember(struck, PLAIN, ctx()).outcome).toBe('noop');
    const deferred = SPRINT('x').replace('<!-- Items moved here during sprint when they won\'t make the timebox -->', '- [ ] [a] A');
    const r = write(removeSprintMember(deferred, PLAIN, ctx({ reason: 'dropped' })));
    expect(r.sprintText).toContain('- [ ] ~~[a]~~ A');
    expect(r.sprintText).not.toContain('Removed [a]');
  });

  it('logs a Removed line with the reason from a live tier', () => {
    const live = SPRINT('x').replace('<!-- add items here -->', '- [ ] [a] A');
    expect(write(removeSprintMember(live, PLAIN, ctx({ reason: 'dropped' }))).sprintText).toContain('Removed [a] from Must — dropped');
  });

  it('annotates an Approved plan that names a PR but no branch', () => {
    const approved = PLAN('- **State:** Approved\n- **Approved:** 2026-10-30, jwloka, plan-PR #12');
    expect(write(addSprintMember(SPRINT('x'), approved, 'must', ctx())).sprintText).toContain('#12');
  });

  it('defers without a log line in a Planning sprint', () => {
    const live = SPRINT('x', 'Planning').replace('<!-- add items here -->', '- [ ] [a] A');
    expect(write(deferSprintMember(live, PLAIN, ctx())).sprintText).not.toContain('Deferred [a]');
  });
});
